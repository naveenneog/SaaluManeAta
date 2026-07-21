import test from 'node:test';
import assert from 'node:assert/strict';
import { createLog } from '../web/js/action-log.js';
import { createRngSuite } from '../web/js/rng.js';
import { hashState } from '../web/js/state-hash.js';
import { initSave } from '../web/js/save.js';

// minimal localStorage shim
globalThis.localStorage = {
  _s: new Map(),
  getItem(k) { return this._s.has(k) ? this._s.get(k) : null; },
  setItem(k, v) { this._s.set(k, String(v)); },
  removeItem(k) { this._s.delete(k); },
  clear() { this._s.clear(); },
};

// Toy game: each action carries a recorded outcome; human plays even turns.
const adapter = {
  setup: (log) => ({ state: { turn: 0, rolls: [], winner: null }, rng: createRngSuite({ seed: log.rng.seed, streams: ['rules'] }) }),
  apply: (state, entry, rng) => ({ turn: state.turn + 1, rolls: [...state.rolls, entry.action.outcome ?? (rng.stream('rules').int(6) + 1)], winner: null }),
  hash: hashState,
  restore: (log, cp) => ({ state: cp.state, rng: createRngSuite({ seed: log.rng.seed, streams: ['rules'] }) }),
};
const isMyTurn = (state) => state.turn % 2 === 0;

function freshSave() { localStorage.clear(); return initSave({ id: 'toy', adapter, isMyTurn }); }
function play(save, n) {
  const log = save.begin(createLog({ game: 'toy', rng: createRngSuite({ seed: 'x', streams: ['rules'] }) }));
  const rng = createRngSuite({ seed: log.rng.seed, streams: ['rules'] });
  let state = { turn: 0, rolls: [], winner: null };
  for (let i = 0; i < n; i += 1) {
    const roll = rng.stream('rules').int(6) + 1;
    state = { turn: state.turn + 1, rolls: [...state.rolls, roll], winner: null };
    save.record({ side: i % 2, action: { k: 'roll', outcome: roll }, stateHash: hashState(state) });
  }
  return state;
}

test('persist + resume derives the exact saved state', () => {
  const save = freshSave();
  const live = play(save, 6);
  const save2 = initSave({ id: 'toy', adapter, isMyTurn }); // fresh instance, same storage
  const resumed = save2.resume();
  assert.ok(resumed, 'resume returned a game');
  assert.equal(hashState(resumed.state), hashState(live));
});

test('undo rewinds to the previous human decision point and re-derives', () => {
  const save = freshSave();
  play(save, 6);
  const beforeLen = save.log.actions.length;
  assert.equal(save.canUndo(), true);
  const state = save.undo();
  assert.ok(state, 'undo returned a state');
  assert.ok(isMyTurn(state), 'landed on a human decision point');
  assert.ok(save.log.actions.length < beforeLen, 'log shrank');
  // undo persisted: a fresh instance resumes the rewound state
  const resumed = initSave({ id: 'toy', adapter, isMyTurn }).resume();
  assert.equal(hashState(resumed.state), hashState(state));
});

test('migrates a legacy v1 snapshot into a resumable log (position preserved)', () => {
  localStorage.clear();
  const snapshot = { turn: 3, rolls: [2, 5, 1], winner: null };
  localStorage.setItem('tbg.toy.save.v1', JSON.stringify({ v: 1, at: 1, state: snapshot }));
  const save = initSave({ id: 'toy', adapter, isMyTurn });
  assert.equal(save.hasSaved(), true);
  const resumed = save.resume('seed-mig');
  assert.ok(resumed);
  assert.equal(hashState(resumed.state), hashState(snapshot));
  assert.ok(localStorage.getItem('tbg.toy.save.v1.backup'), 'v1 backed up');
  // continuing play from a migrated game still works (checkpoint origin + new actions)
  save.record({ side: 1, action: { k: 'roll', outcome: 4 }, stateHash: hashState({ turn: 4, rolls: [2, 5, 1, 4], winner: null }) });
  const cont = initSave({ id: 'toy', adapter, isMyTurn }).resume();
  assert.equal(cont.state.turn, 4);
  assert.deepEqual(cont.state.rolls, [2, 5, 1, 4]);
});

test('clear removes the save', () => {
  const save = freshSave();
  play(save, 4);
  save.clear();
  assert.equal(save.hasSaved(), false);
});
