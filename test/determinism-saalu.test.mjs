import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, applyMove, bestMove, canonicalState } from '../web/js/logic.js';
import { createLog, append, derive, verify } from '../web/js/action-log.js';
import { createRngSuite } from '../web/js/rng.js';
import { hashState } from '../web/js/state-hash.js';

// Saalu has NO canonical randomness (bestMove is a deterministic alpha-beta), so the move IS the
// action and applyMove is the pure applier. The rng suite exists only to satisfy the log schema.
const engine = {
  setup: () => ({ state: newGame(), rng: null }),
  apply: (state, entry) => applyMove(state, entry.action),
  hash: (state) => hashState(canonicalState(state)),
};

function playGame(cap = 80, level = 2) {
  const log = createLog({ game: 'sma', engine: { version: '1.5.0' }, rng: createRngSuite({ seed: 'sma', streams: ['rules'] }) });
  let state = newGame();
  let n = 0;
  while (state.winner === null && n < cap) {
    const move = bestMove(state, level);
    if (!move) break;
    const side = state.turn;
    state = applyMove(state, move);
    append(log, { side, action: move, stateHash: hashState(canonicalState(state)) });
    n += 1;
  }
  return { log, state };
}

test('a full Saalu game is deterministic and derive() reproduces it exactly', () => {
  const { log, state } = playGame();
  assert.ok(log.actions.length > 10, 'game produced a substantial log');
  assert.equal(hashState(canonicalState(derive(log, engine).state)), hashState(canonicalState(state)));
  assert.equal(verify(log, engine).ok, true);
});

test('replaying at every prefix matches recorded hashes', () => {
  const { log } = playGame();
  for (let k = 1; k <= log.actions.length; k += 1) {
    assert.equal(hashState(canonicalState(derive(log, engine, k).state)), log.actions[k - 1].stateHash);
  }
});

test('deterministic AI produces the identical game every run', () => {
  const a = playGame();
  const b = playGame();
  assert.deepEqual(a.log.actions.map((e) => e.stateHash), b.log.actions.map((e) => e.stateHash));
});

test('actions are place/move/remove and stay legal on replay', () => {
  const { log } = playGame();
  for (const e of log.actions) assert.ok(['place', 'move', 'remove'].includes(e.action.type));
  assert.equal(verify(log, engine).ok, true);
});
