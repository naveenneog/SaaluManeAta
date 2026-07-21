import test from 'node:test';
import assert from 'node:assert/strict';
import { append, createLog } from '../web/js/action-log.js';
import {
  boundedAlternatives,
  buildRecap,
  selectRecapMoments,
  validateRecapCandidate,
} from '../web/js/recap.js';
import { hashState } from '../web/js/state-hash.js';

const adapter = {
  setup: () => ({ state: { total: 0, winner: null }, rng: {} }),
  apply: (state, entry) => ({
    total: state.total + entry.action.n,
    winner: entry.action.win ? entry.side : null,
  }),
  hash: hashState,
};

function makeLog(count = 12) {
  const log = createLog({
    game: 'toy',
    engine: { version: 'toy-v1' },
    ruleset: { id: 'toy.base', version: 1 },
    world: 'table',
    rng: { algorithm: 'xoshiro128ss-v1', seed: 'recap-test' },
  });
  let state = { total: 0, winner: null };
  for (let index = 0; index < count; index += 1) {
    const action = { n: 1, ...(index === count - 1 ? { win: true } : {}) };
    state = adapter.apply(state, { action, side: index % 2 });
    append(log, { side: index % 2, action, stateHash: adapter.hash(state) });
  }
  return log;
}

const candidate = (index, score, kind, extras = {}) => ({
  index,
  score,
  kind,
  sentenceKey: `toy.recap.${kind}`,
  params: {},
  focus: null,
  terminal: false,
  coexistsWithTerminal: false,
  ...extras,
});

test('candidate validation enforces integer scores and content IDs', () => {
  const result = validateRecapCandidate({
    kind: 'lead-change',
    score: 180,
    sentenceKey: 'toy.recap.lead-change',
    params: { lead: 4 },
    focus: [2],
  }, 7);
  assert.equal(result.index, 7);
  assert.throws(() => validateRecapCandidate({
    kind: 'lead-change',
    score: 1.5,
    sentenceKey: 'toy.recap.lead-change',
  }, 0), /score/);
  assert.throws(() => validateRecapCandidate({
    kind: 'lead-change',
    score: 1,
    sentenceKey: 'Raw English',
  }, 0), /content id/);
});

test('selection forces the terminal moment, applies spacing, and allows an adjacent enabler', () => {
  const moments = selectRecapMoments([
    candidate(0, 90, 'opening'),
    candidate(5, 110, 'enabler', { coexistsWithTerminal: true }),
    candidate(6, 1000, 'terminal', { terminal: true }),
    candidate(7, 500, 'too-close'),
    candidate(10, 120, 'late'),
  ], 30, 3);
  assert.deepEqual(moments.map((moment) => moment.kind), ['enabler', 'terminal', 'late']);
});

test('selection tie-breaking is score, index, then ASCII kind and deduplicates identities', () => {
  const moments = selectRecapMoments([
    candidate(8, 100, 'zeta'),
    candidate(4, 100, 'zeta'),
    candidate(4, 100, 'alpha'),
    candidate(4, 90, 'alpha'),
  ], 24, 2);
  assert.deepEqual(moments.map((moment) => [moment.index, moment.kind]), [[4, 'alpha'], [8, 'zeta']]);
});

test('buildRecap derives transitions, exposes next, and returns at most three stable moments', () => {
  const seenNext = [];
  const recap = buildRecap(makeLog(12), {
    adapter,
    perspective: 0,
    analyzeTransition({ index, next }, context) {
      seenNext.push(next?.index ?? null);
      if (![1, 5, 11].includes(index)) return [];
      return [{
        kind: index === 11 ? 'terminal' : `turn-${index}`,
        score: index === 11 ? 1000 : 100 + index,
        sentenceKey: index === 11 ? 'toy.recap.terminal' : 'toy.recap.turn',
        params: { move: index + 1 },
        terminal: index === 11,
      }];
    },
  });
  assert.equal(recap.winner, 1);
  assert.equal(recap.finalStateHash, makeLog(12).actions.at(-1).stateHash);
  assert.deepEqual(recap.moments.map((moment) => moment.index), [1, 5, 11]);
  assert.deepEqual(seenNext.slice(-2), [11, null]);
  assert.equal(recap.exhausted, false);
});

test('bounded analysis marks exhaustion and emits no counterfactual after budget refusal', () => {
  const recap = buildRecap(makeLog(2), {
    adapter,
    maxNodes: 3,
    analyzeTransition(transition, context) {
      if (!context.budget.consume(1)) return [];
      return [{
        kind: 'counterfactual',
        score: 10,
        sentenceKey: 'toy.recap.counterfactual',
      }];
    },
  });
  assert.equal(recap.exhausted, true);
  assert.deepEqual(recap.moments, []);
});

test('boundedAlternatives refuses partial counterfactual proofs', () => {
  const context = {
    maxAlternatives: 2,
    budget: {
      remaining: 4,
      consume: (count) => count <= 4,
    },
  };
  assert.deepEqual(boundedAlternatives([1, 2], context), [1, 2]);
  assert.equal(boundedAlternatives([1, 2, 3], context), null);
  assert.equal(boundedAlternatives([1, 2], {
    ...context,
    budget: { consume: () => false },
  }), null);
});

test('desynced logs are refused before analysis', () => {
  const log = makeLog(3);
  log.actions[1].stateHash = '0000000000000000';
  assert.throws(() => buildRecap(log, {
    adapter,
    analyzeTransition: () => [],
  }), /desynced at action 1/);
});
