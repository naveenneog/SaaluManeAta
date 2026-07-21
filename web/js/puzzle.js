// puzzle.js — a PUZZLE is a `scenario` (see scenario.js) carrying a `goal`, a stored `solution`, and a
// `difficulty`. This module is the universal, game-agnostic layer on top: a data-driven goal evaluator,
// a bounded breadth-first solver (shortest solution, deduped by state hash), and a `verifyPuzzle`
// harness that proves the stored solution is legal and reaches the goal (and, optionally, is at par).
// Byte-identical across games (drift-guarded). Games supply an `iface` with their pure rules.
//
//   iface = {
//     engine,                            // action-log adapter { setup, apply(state,entry,rng), hash, restore? }
//                                        //   used only to DERIVE the start position from the scenario
//     legalActions(state) -> action[],   // the player decisions available in `state`
//     apply(state, action) -> state,     // pure transition for a chosen action
//     hash(state) -> string,             // canonical hash (usually hashState(canonicalState(state)))
//     isTerminal?(state) -> boolean,
//     evaluators?: { [name]: (state, goal) => boolean },  // custom goal predicates
//   }
import { validateScenario, deriveScenario } from './scenario.js';
import { stableStringify } from './state-hash.js';

export const PUZZLE_SCHEMA = 1;
export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function validatePuzzle(spec, opts = {}) {
  validateScenario(spec, opts);
  if (!spec.goal || typeof spec.goal !== 'object') throw new TypeError('puzzle.goal is required');
  if (!Array.isArray(spec.solution) || spec.solution.length === 0) {
    throw new TypeError('puzzle.solution must be a non-empty array of actions');
  }
  if (!DIFFICULTIES.includes(spec.difficulty)) {
    throw new RangeError(`puzzle.difficulty must be one of ${DIFFICULTIES.join('|')}`);
  }
  if (spec.par !== undefined && (!Number.isSafeInteger(spec.par) || spec.par < 1)) {
    throw new TypeError('puzzle.par must be a positive integer');
  }
  return true;
}

// Safe dotted/array path read — own properties only (never walks the prototype chain).
function getPath(obj, path) {
  if (path == null) return obj;
  const parts = Array.isArray(path) ? path : String(path).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    if (UNSAFE_KEYS.has(p) || !Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
    cur = cur[p];
  }
  return cur;
}

const deepEqual = (a, b) => {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    try { return stableStringify(a) === stableStringify(b); } catch { return false; }
  }
  return false;
};

// Evaluate a data goal against a state. Universal goal types + a `custom` escape hatch the game fills.
export function evaluateGoal(state, goal, ctx = {}) {
  if (!goal || typeof goal !== 'object') throw new TypeError('goal must be an object');
  const { hash, evaluators = {} } = ctx;
  const rec = (g) => evaluateGoal(state, g, ctx);
  switch (goal.type) {
    case 'reachHash':
      if (typeof hash !== 'function') throw new Error('reachHash goal needs ctx.hash');
      return hash(state) === goal.hash;
    case 'winnerIs': return state != null && state.winner === goal.side;
    case 'flag': return Boolean(getPath(state, goal.path)) === (goal.value ?? true);
    case 'equals': return deepEqual(getPath(state, goal.path), goal.value);
    case 'atLeast': return Number(getPath(state, goal.path)) >= goal.n;
    case 'atMost': return Number(getPath(state, goal.path)) <= goal.n;
    case 'all': return Array.isArray(goal.of) && goal.of.every(rec);
    case 'any': return Array.isArray(goal.of) && goal.of.some(rec);
    case 'not': return !rec(goal.of);
    case 'custom': {
      const fn = evaluators[goal.name];
      if (typeof fn !== 'function') throw new Error(`Unknown custom goal: ${goal.name}`);
      return Boolean(fn(state, goal));
    }
    default: throw new RangeError(`Unknown goal type: ${goal.type}`);
  }
}

const actionKey = (a) => stableStringify(a);
const containsAction = (list, action) => {
  const k = actionKey(action);
  return list.some((a) => actionKey(a) === k);
};

// Derive the puzzle's starting position from its scenario (via the engine adapter).
export function deriveStart(spec, iface) {
  if (!iface || !iface.engine) throw new TypeError('deriveStart needs iface.engine');
  return deriveScenario(spec, iface.engine).state;
}

// Replay a stored solution from `startState`, checking each action is legal. Returns
// { ok, state, trace } or { ok:false, at, reason }.
export function replaySolution(startState, solution, iface) {
  let state = startState;
  const trace = [state];
  for (let i = 0; i < solution.length; i += 1) {
    const action = solution[i];
    if (!containsAction(iface.legalActions(state), action)) {
      return { ok: false, at: i, reason: 'illegal', state };
    }
    state = iface.apply(state, action);
    trace.push(state);
  }
  return { ok: true, state, trace };
}

// Bounded BFS for the SHORTEST action sequence that satisfies the goal. Dedupes visited states by
// hash and caps the number of expanded actions (`maxNodes`). Returns the solution (array of actions),
// [] if the start already satisfies the goal, or null (unsolved within the depth/node budget).
export function solvePuzzle(spec, iface, { maxDepth = 12, maxNodes = 200000, start } = {}) {
  const s0 = start ?? deriveStart(spec, iface);
  const met = (st) => evaluateGoal(st, spec.goal, { hash: iface.hash, evaluators: iface.evaluators });
  if (met(s0)) return [];
  const seen = new Set([iface.hash(s0)]);
  let frontier = [{ state: s0, path: [] }];
  let nodes = 0;
  for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
    const next = [];
    for (const node of frontier) {
      if (iface.isTerminal && iface.isTerminal(node.state)) continue;
      for (const action of iface.legalActions(node.state)) {
        nodes += 1;
        if (nodes > maxNodes) return null;
        const state = iface.apply(node.state, action);
        const path = node.path.concat([action]);
        if (met(state)) return path;
        const h = iface.hash(state);
        if (!seen.has(h)) { seen.add(h); next.push({ state, path }); }
      }
    }
    frontier = next;
  }
  return null;
}

// Prove a puzzle is well-formed: the stored solution is legal, respects maxActions, reaches the goal,
// and (when checkPar) is no longer than the shortest solution. Returns { ok, moves, par } or
// { ok:false, reason }.
export function verifyPuzzle(spec, iface, { checkPar = true } = {}) {
  validatePuzzle(spec);
  const start = deriveStart(spec, iface);
  const maxActions = spec.constraints?.maxActions ?? spec.solution.length;
  if (spec.solution.length > maxActions) return { ok: false, reason: 'solution exceeds constraints.maxActions' };
  const replay = replaySolution(start, spec.solution, iface);
  if (!replay.ok) return { ok: false, reason: `illegal move at index ${replay.at}` };
  if (!evaluateGoal(replay.state, spec.goal, { hash: iface.hash, evaluators: iface.evaluators })) {
    return { ok: false, reason: 'solution does not reach the goal' };
  }
  if (checkPar) {
    const shortest = solvePuzzle(spec, iface, { start, maxDepth: spec.solution.length });
    if (!shortest) return { ok: false, reason: 'solver could not reproduce a solution within the stored length' };
    if (shortest.length < spec.solution.length) {
      return { ok: false, reason: `a shorter solution exists (${shortest.length} < ${spec.solution.length})` };
    }
    if (spec.par != null && spec.par !== spec.solution.length) {
      return { ok: false, reason: `solution length ${spec.solution.length} != declared par ${spec.par}` };
    }
    if (spec.par != null && spec.par !== shortest.length) {
      return { ok: false, reason: `shortest length ${shortest.length} != declared par ${spec.par}` };
    }
    return { ok: true, moves: spec.solution.length, par: shortest.length };
  }
  return { ok: true, moves: spec.solution.length, par: spec.par ?? null };
}

export async function loadPuzzle(url, iface, { fetchImpl = globalThis.fetch, game, id, verify = true } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('loadPuzzle requires fetch');
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Puzzle request failed: ${response.status}`);
  const spec = await response.json();
  validatePuzzle(spec, { game, id });
  if (verify && iface) {
    const result = verifyPuzzle(spec, iface, { checkPar: false });
    if (!result.ok) throw new Error(`Invalid puzzle ${spec.id}: ${result.reason}`);
  }
  return spec;
}
