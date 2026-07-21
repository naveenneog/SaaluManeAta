import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PUZZLE_SCHEMA,
  validatePuzzle,
  evaluateGoal,
  replaySolution,
  solvePuzzle,
  verifyPuzzle,
  deriveStart,
  loadPuzzle,
} from '../web/js/puzzle.js';
import { createRngSuite } from '../web/js/rng.js';
import { hashState } from '../web/js/state-hash.js';

// A tiny, self-contained toy game so puzzle.js is proven UNIVERSAL (independent of any real game):
// state = { total, moves }; the player may add 1, 2 or 3 each move.
const engine = {
  setup: () => ({ state: { total: 0, moves: 0 }, rng: createRngSuite({ seed: 'toy' }) }),
  apply: (state, entry) => ({ total: state.total + entry.action.value, moves: state.moves + 1 }),
  restore: (log, saved) => ({ state: saved.state, rng: createRngSuite({ seed: 'toy' }) }),
  hash: hashState,
};
const iface = {
  engine,
  legalActions: () => [1, 2, 3].map((value) => ({ type: 'add', value })),
  apply: (state, action) => ({ total: state.total + action.value, moves: state.moves + 1 }),
  hash: hashState,
  evaluators: { even: (state) => state.total % 2 === 0 },
};

const start = { total: 0, moves: 0 };
const toyPuzzle = {
  schema: 1,
  id: 'toy.reach-five',
  game: 'toy',
  world: 'parampare',
  engine: { version: 'toy-v1' },
  ruleset: { id: 'toy.base', version: 1 },
  rng: { algorithm: 'xoshiro128ss-v1', seed: 'p' },
  titleKey: 'Reach five',
  briefKey: 'Add up to exactly five.',
  hintKeys: ['Two moves is enough.'],
  difficulty: 'easy',
  position: { kind: 'state', state: start, stateHash: hashState(start) },
  goal: { type: 'equals', path: 'total', value: 5 },
  constraints: { maxActions: 4 },
  solution: [{ type: 'add', value: 2 }, { type: 'add', value: 3 }],
  par: 2,
};

test('schema is exported and a well-formed puzzle validates', () => {
  assert.equal(PUZZLE_SCHEMA, 1);
  assert.equal(validatePuzzle(toyPuzzle), true);
});

test('validatePuzzle rejects missing goal / empty solution / bad difficulty', () => {
  const { goal, ...noGoal } = toyPuzzle;
  assert.throws(() => validatePuzzle(noGoal), /goal is required/);
  assert.throws(() => validatePuzzle({ ...toyPuzzle, solution: [] }), /non-empty array/);
  assert.throws(() => validatePuzzle({ ...toyPuzzle, difficulty: 'insane' }), /difficulty/);
});

test('evaluateGoal covers the universal goal types and a custom hook', () => {
  const s = { total: 6, winner: 1, flags: { safe: true } };
  assert.equal(evaluateGoal(s, { type: 'atLeast', path: 'total', n: 5 }), true);
  assert.equal(evaluateGoal(s, { type: 'atMost', path: 'total', n: 5 }), false);
  assert.equal(evaluateGoal(s, { type: 'equals', path: 'total', value: 6 }), true);
  assert.equal(evaluateGoal(s, { type: 'winnerIs', side: 1 }), true);
  assert.equal(evaluateGoal(s, { type: 'flag', path: 'flags.safe' }), true);
  assert.equal(evaluateGoal(s, { type: 'reachHash', hash: 'x' }, { hash: () => 'x' }), true);
  assert.equal(evaluateGoal(s, { type: 'all', of: [{ type: 'atLeast', path: 'total', n: 5 }, { type: 'winnerIs', side: 1 }] }), true);
  assert.equal(evaluateGoal(s, { type: 'any', of: [{ type: 'winnerIs', side: 0 }, { type: 'winnerIs', side: 1 }] }), true);
  assert.equal(evaluateGoal(s, { type: 'not', of: { type: 'winnerIs', side: 0 } }), true);
  assert.equal(evaluateGoal(s, { type: 'custom', name: 'even' }, { evaluators: iface.evaluators }), true);
  assert.throws(() => evaluateGoal(s, { type: 'nope' }), /Unknown goal type/);
  assert.throws(() => evaluateGoal(s, { type: 'custom', name: 'missing' }, { evaluators: {} }), /Unknown custom goal/);
});

test('deriveStart rebuilds the puzzle start position from its scenario', () => {
  assert.deepEqual(deriveStart(toyPuzzle, iface), start);
});

test('replaySolution accepts a legal line and flags an illegal action', () => {
  const good = replaySolution(start, toyPuzzle.solution, iface);
  assert.equal(good.ok, true);
  assert.deepEqual(good.state, { total: 5, moves: 2 });
  const bad = replaySolution(start, [{ type: 'add', value: 9 }], iface);
  assert.equal(bad.ok, false);
  assert.equal(bad.at, 0);
});

test('solvePuzzle finds the shortest solution, [] when already solved, null when unreachable', () => {
  const shortest = solvePuzzle(toyPuzzle, iface, { maxDepth: 4 });
  assert.equal(shortest.length, 2);
  const solved = solvePuzzle({ ...toyPuzzle, goal: { type: 'equals', path: 'total', value: 0 } }, iface);
  assert.deepEqual(solved, []);
  const unreachable = solvePuzzle({ ...toyPuzzle, goal: { type: 'equals', path: 'total', value: 7 } }, iface, { maxDepth: 2 });
  assert.equal(unreachable, null);
});

test('verifyPuzzle proves legal + reaches goal + at par, and rejects otherwise', () => {
  const ok = verifyPuzzle(toyPuzzle, iface);
  assert.deepEqual(ok, { ok: true, moves: 2, par: 2 });
  // a longer-than-necessary line (a 2-move solution exists)
  const long = verifyPuzzle({ ...toyPuzzle, solution: [{ type: 'add', value: 1 }, { type: 'add', value: 1 }, { type: 'add', value: 3 }] }, iface);
  assert.equal(long.ok, false);
  assert.match(long.reason, /shorter solution/);
  // a line that never reaches the goal
  const short = verifyPuzzle({ ...toyPuzzle, solution: [{ type: 'add', value: 1 }, { type: 'add', value: 1 }] }, iface, { checkPar: false });
  assert.equal(short.ok, false);
  assert.match(short.reason, /does not reach/);
  // exceeding constraints.maxActions
  const capped = verifyPuzzle({ ...toyPuzzle, constraints: { maxActions: 1 } }, iface, { checkPar: false });
  assert.equal(capped.ok, false);
  assert.match(capped.reason, /maxActions/);
});

test('loadPuzzle fetches, validates and (light) verifies', async () => {
  const spec = await loadPuzzle('/p.json', iface, {
    fetchImpl: async () => ({ ok: true, json: async () => toyPuzzle }),
  });
  assert.equal(spec.id, 'toy.reach-five');
  await assert.rejects(
    loadPuzzle('/bad.json', iface, { fetchImpl: async () => ({ ok: true, json: async () => ({ ...toyPuzzle, solution: [{ type: 'add', value: 1 }] }) }) }),
    /Invalid puzzle/,
  );
});

test('hardening: own-property paths, deep equals, declared-par enforcement, node budget', () => {
  // getPath reads OWN properties only (inherited props like `toString` do not resolve)
  assert.equal(evaluateGoal({}, { type: 'flag', path: 'toString' }), false);
  assert.equal(evaluateGoal(Object.create({ inherited: 7 }), { type: 'equals', path: 'inherited', value: 7 }), false);
  // equals is deep data-equality (arrays/objects compare by value)
  assert.equal(evaluateGoal({ arr: [1, 2, 3] }, { type: 'equals', path: 'arr', value: [1, 2, 3] }), true);
  assert.equal(evaluateGoal({ obj: { a: 1 } }, { type: 'equals', path: 'obj', value: { a: 2 } }), false);
  // verifyPuzzle enforces a declared par (solution length AND shortest length must equal it)
  const wrongPar = verifyPuzzle({ ...toyPuzzle, par: 3 }, iface);
  assert.equal(wrongPar.ok, false);
  assert.match(wrongPar.reason, /par/);
  // solvePuzzle honours the node budget
  assert.equal(solvePuzzle(toyPuzzle, iface, { maxNodes: 1 }), null);
});
