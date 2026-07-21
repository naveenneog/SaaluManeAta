import test from 'node:test';
import assert from 'node:assert/strict';
import { createLog, append, truncate, derive, verify, serialize, deserialize } from '../web/js/action-log.js';
import { createRngSuite } from '../web/js/rng.js';
import { hashState } from '../web/js/state-hash.js';

// Toy deterministic game: each "roll" draws 1..6 from the canonical `rules` stream and appends it.
const adapter = {
  setup: (log) => ({
    state: { turn: 0, rolls: [] },
    rng: createRngSuite({ seed: log.rng.seed, streams: ['rules'] }),
  }),
  apply: (state, entry, rng) => {
    // recorded-outcome path (like Chowka dice) with a live re-draw fallback
    const roll = entry.action.outcome ?? (rng.stream('rules').int(6) + 1);
    return { turn: state.turn + 1, rolls: [...state.rolls, roll] };
  },
  hash: (state) => hashState(state),
};

function playLive(seed, n) {
  const rng = createRngSuite({ seed, streams: ['rules'] });
  const log = createLog({ game: 'toy', engine: { version: '1.5.0' }, rng });
  let state = { turn: 0, rolls: [] };
  for (let i = 0; i < n; i += 1) {
    const before = rng.stream('rules').draws;
    const roll = rng.stream('rules').int(6) + 1;
    state = { turn: state.turn + 1, rolls: [...state.rolls, roll] };
    append(log, {
      side: i % 2,
      action: { k: 'roll', outcome: roll },
      rngUses: [{ stream: 'rules', draws: rng.stream('rules').draws - before }],
      stateHash: hashState(state),
    });
  }
  return { log, state };
}

test('derive() reproduces the exact live state', () => {
  const { log, state } = playLive('seed-alpha', 8);
  const { state: derived } = derive(log, adapter);
  assert.deepEqual(derived, state);
  assert.equal(hashState(derived), hashState(state));
});

test('same seed + same actions => identical hash (determinism)', () => {
  const a = playLive('42', 10);
  const b = playLive('42', 10);
  assert.equal(hashState(a.state), hashState(b.state));
  assert.deepEqual(a.log.actions.map((e) => e.stateHash), b.log.actions.map((e) => e.stateHash));
});

test('different seeds diverge', () => {
  const a = playLive('seed-a', 12);
  const b = playLive('seed-b', 12);
  assert.notEqual(hashState(a.state), hashState(b.state));
});

test('verify() passes clean and flags a tampered stateHash', () => {
  const { log } = playLive('vseed', 6);
  assert.equal(verify(log, adapter).ok, true);
  const tampered = deserialize(serialize(log));
  tampered.actions[3].stateHash = 'deadbeefdeadbeef';
  const r = verify(tampered, adapter);
  assert.equal(r.ok, false);
  assert.equal(r.atAction, 3);
});

test('truncate() is the undo primitive: derive after truncation matches that prefix', () => {
  const { log } = playLive('undo', 9);
  const full = log.actions.length;
  const prefixHash = log.actions[5].stateHash; // state after 6 actions
  truncate(log, 6);
  assert.equal(log.actions.length, 6);
  const { state } = derive(log, adapter);
  assert.equal(hashState(state), prefixHash);
  assert.ok(full > 6);
});

test('derive(upTo) yields intermediate states matching recorded hashes', () => {
  const { log } = playLive('mid', 7);
  for (let k = 1; k <= log.actions.length; k += 1) {
    const { state } = derive(log, adapter, k);
    assert.equal(hashState(state), log.actions[k - 1].stateHash);
  }
});

test('createLog rejects a missing rng', () => {
  assert.throws(() => createLog({ game: 'toy' }), /rng/);
});
