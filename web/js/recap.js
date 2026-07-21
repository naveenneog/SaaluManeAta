// recap.js — deterministic selection of at most three evidence-based turning points.
// Per-game analyzers emit content-ID candidates; this module owns budgets, validation, and ranking.
// Keep this module byte-identical across games (drift-guarded after cross-review).
import { validateNarrationDescriptor } from './replay-narration.js';

export const MAX_RECAP_MOMENTS = 3;
export const DEFAULT_RECAP_MAX_NODES = 200000;
export const DEFAULT_RECAP_MAX_ALTERNATIVES = 64;

const KIND = /^[a-z][a-z0-9.-]{1,63}$/;

const kindCompare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

export function validateRecapCandidate(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('recap candidate must be an object');
  }
  for (const key of Object.keys(value)) {
    if (![
      'kind', 'score', 'sentenceKey', 'params', 'focus',
      'terminal', 'coexistsWithTerminal',
    ].includes(key)) throw new TypeError(`unknown recap candidate field: ${key}`);
  }
  if (typeof value.kind !== 'string' || !KIND.test(value.kind)) {
    throw new TypeError('recap candidate kind is invalid');
  }
  if (!Number.isSafeInteger(value.score) || value.score < 0 || value.score > 1000000000) {
    throw new TypeError('recap candidate score must be a non-negative safe integer');
  }
  if (value.terminal !== undefined && typeof value.terminal !== 'boolean') {
    throw new TypeError('recap candidate terminal must be boolean');
  }
  if (value.coexistsWithTerminal !== undefined && typeof value.coexistsWithTerminal !== 'boolean') {
    throw new TypeError('recap candidate coexistsWithTerminal must be boolean');
  }
  const narration = validateNarrationDescriptor({
    key: value.sentenceKey,
    params: value.params,
    focus: value.focus,
  });
  return Object.freeze({
    index,
    kind: value.kind,
    score: value.score,
    sentenceKey: narration.key,
    params: narration.params,
    focus: narration.focus,
    terminal: value.terminal === true,
    coexistsWithTerminal: value.coexistsWithTerminal === true,
  });
}

function makeBudget(maxNodes) {
  let used = 0;
  let exhausted = false;
  return Object.freeze({
    consume(count = 1) {
      if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('recap budget count is invalid');
      if (used + count > maxNodes) { exhausted = true; return false; }
      used += count;
      return true;
    },
    get used() { return used; },
    get remaining() { return Math.max(0, maxNodes - used); },
    get exhausted() { return exhausted; },
  });
}

// Reserve the complete alternative set before making a counterfactual claim. Returning null means
// the proof would exceed maxAlternatives or the shared node budget, so the analyzer must omit it.
export function boundedAlternatives(values, context) {
  if (!Array.isArray(values)) throw new TypeError('recap alternatives must be an array');
  if (!context || !Number.isSafeInteger(context.maxAlternatives)
    || typeof context.budget?.consume !== 'function') {
    throw new TypeError('boundedAlternatives requires recap context');
  }
  if (values.length > context.maxAlternatives) return null;
  if (!context.budget.consume(values.length)) return null;
  return values;
}

function candidateSort(left, right) {
  return right.score - left.score
    || left.index - right.index
    || kindCompare(left.kind, right.kind)
    || kindCompare(left.sentenceKey, right.sentenceKey);
}

function separated(candidate, selected, spacing, terminal) {
  return selected.every((other) => {
    if (Math.abs(candidate.index - other.index) >= spacing) return true;
    if (terminal && other === terminal
      && (candidate.coexistsWithTerminal || terminal.coexistsWithTerminal)) return true;
    return false;
  });
}

export function selectRecapMoments(candidates, actionCount, maxMoments = MAX_RECAP_MOMENTS) {
  if (!Array.isArray(candidates)) throw new TypeError('recap candidates must be an array');
  if (!Number.isSafeInteger(actionCount) || actionCount < 0) throw new TypeError('recap action count is invalid');
  if (!Number.isSafeInteger(maxMoments) || maxMoments < 1 || maxMoments > MAX_RECAP_MOMENTS) {
    throw new RangeError(`recap maxMoments must be 1..${MAX_RECAP_MOMENTS}`);
  }
  const bestByIdentity = new Map();
  for (const candidate of candidates) {
    const identity = `${candidate.index}\u0000${candidate.kind}\u0000${candidate.sentenceKey}`;
    const previous = bestByIdentity.get(identity);
    if (!previous || candidateSort(candidate, previous) < 0) bestByIdentity.set(identity, candidate);
  }
  const ranked = [...bestByIdentity.values()].sort(candidateSort);
  const spacing = Math.max(2, Math.floor(actionCount / 12));
  const selected = [];
  const terminal = ranked.find((candidate) => candidate.terminal) ?? null;
  if (terminal) selected.push(terminal);
  for (const candidate of ranked) {
    if (selected.length >= maxMoments) break;
    if (candidate === terminal) continue;
    if (separated(candidate, selected, spacing, terminal)) selected.push(candidate);
  }
  return selected.sort((left, right) => left.index - right.index
    || candidateSort(left, right));
}

// analyzeTransition contract:
//   analyzeTransition({ before, after, entry, index, next? }, context) -> candidate[]
//
// candidate:
//   { kind, score, sentenceKey, params?, focus?, terminal?, coexistsWithTerminal? }
//
// context:
//   { log, adapter, perspective, actionCount, maxAlternatives, budget }
// Analyzers must call boundedAlternatives(actions, context) (and budget.consume for any further
// work) before counterfactual analysis, emitting no claim when either returns null/false.
export function buildRecap(log, {
  adapter,
  analyzeTransition,
  perspective = null,
  maxMoments = MAX_RECAP_MOMENTS,
  maxNodes = DEFAULT_RECAP_MAX_NODES,
  maxAlternatives = DEFAULT_RECAP_MAX_ALTERNATIVES,
} = {}) {
  if (!log || typeof log !== 'object' || !Array.isArray(log.actions)) {
    throw new TypeError('buildRecap requires an action log');
  }
  if (log.actions.length > 4096) throw new RangeError('recap action count exceeds the replay cap');
  if (!adapter || typeof adapter.setup !== 'function'
    || typeof adapter.apply !== 'function' || typeof adapter.hash !== 'function') {
    throw new TypeError('buildRecap requires an action-log adapter');
  }
  if (typeof analyzeTransition !== 'function') {
    throw new TypeError('buildRecap requires analyzeTransition');
  }
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 1000000) {
    throw new RangeError('recap maxNodes is invalid');
  }
  if (!Number.isSafeInteger(maxAlternatives) || maxAlternatives < 1 || maxAlternatives > 256) {
    throw new RangeError('recap maxAlternatives is invalid');
  }

  const budget = makeBudget(maxNodes);
  const transitions = [];
  let { state, rng } = adapter.setup(log);
  for (let index = 0; index < log.actions.length; index += 1) {
    if (!budget.consume()) break;
    const before = state;
    state = adapter.apply(state, log.actions[index], rng);
    const expected = log.actions[index].stateHash;
    if (expected != null) {
      const actual = adapter.hash(state);
      if (actual !== expected) throw new RangeError(`recap replay desynced at action ${index}`);
    }
    transitions.push(Object.freeze({
      before,
      after: state,
      entry: log.actions[index],
      index,
    }));
  }

  const context = Object.freeze({
    log,
    adapter,
    perspective,
    actionCount: log.actions.length,
    maxAlternatives,
    budget,
  });
  const candidates = [];
  for (let index = 0; index < transitions.length && !budget.exhausted; index += 1) {
    if (!budget.consume()) break;
    const current = transitions[index];
    const nextTransition = transitions[index + 1];
    const next = nextTransition ? Object.freeze({
      before: nextTransition.before,
      after: nextTransition.after,
      entry: nextTransition.entry,
      index: nextTransition.index,
    }) : null;
    let emitted;
    try {
      emitted = analyzeTransition(Object.freeze({ ...current, next }), context);
    } catch {
      continue;
    }
    if (emitted == null) continue;
    if (!Array.isArray(emitted) || emitted.length > 16) continue;
    for (const value of emitted) {
      try { candidates.push(validateRecapCandidate(value, current.index)); }
      catch { /* a malformed bundled candidate is omitted, never rendered */ }
    }
  }

  const derivedAll = transitions.length === log.actions.length;
  const finalStateHash = derivedAll ? adapter.hash(state) : null;
  return Object.freeze({
    winner: derivedAll ? (state?.winner ?? log.result?.winner ?? null) : null,
    finalStateHash,
    exhausted: budget.exhausted || !derivedAll,
    analyzedActions: transitions.length,
    moments: Object.freeze(derivedAll
      ? selectRecapMoments(candidates, log.actions.length, maxMoments)
      : []),
  });
}
