import test from 'node:test';
import assert from 'node:assert/strict';
import { createLog, append, derive, checkpoint } from '../web/js/action-log.js';
import { createRngSuite } from '../web/js/rng.js';
import { hashState } from '../web/js/state-hash.js';
import { initReplayPlayer } from '../web/js/replay-player.js';

const adapter = {
  setup: (log) => ({ state: { turn: 0, rolls: [] }, rng: createRngSuite({ seed: log.rng.seed, streams: ['rules'] }) }),
  apply: (state, entry) => ({ turn: state.turn + 1, rolls: [...state.rolls, entry.action.outcome] }),
  hash: (state) => hashState(state),
};

function buildLog(n) {
  const rng = createRngSuite({ seed: 'replay', streams: ['rules'] });
  const log = createLog({ game: 'toy', rng });
  let state = { turn: 0, rolls: [] };
  for (let k = 0; k < n; k += 1) {
    const roll = rng.stream('rules').int(6) + 1;
    state = { turn: state.turn + 1, rolls: [...state.rolls, roll] };
    append(log, { side: 0, action: { k: 'roll', outcome: roll }, stateHash: hashState(state) });
  }
  return log;
}

test('load emits the setup state at index 0', () => {
  const log = buildLog(5);
  const states = [];
  const p = initReplayPlayer({ adapter, onState: (s, i) => states.push([i, hashState(s)]) });
  p.load(log);
  assert.equal(p.index, 0);
  assert.equal(p.total, 5);
  assert.equal(states.length, 1);
  assert.equal(states[0][0], 0);
});

test('step advances one action and matches derive at that prefix', () => {
  const log = buildLog(6);
  const p = initReplayPlayer({ adapter });
  p.load(log);
  for (let k = 1; k <= 6; k += 1) {
    assert.equal(p.step(), true);
    assert.equal(p.index, k);
    assert.equal(hashState(p.state), hashState(derive(log, adapter, k).state));
  }
  assert.equal(p.step(), false, 'no step past the end');
});

test('onComplete fires exactly once at the end', () => {
  const log = buildLog(4);
  let completed = 0;
  const p = initReplayPlayer({ adapter, onComplete: () => { completed += 1; } });
  p.load(log);
  while (p.step()) { /* run to end */ }
  assert.equal(completed, 1);
  assert.equal(p.index, p.total);
});

test('seek jumps to any index and matches derive', () => {
  const log = buildLog(8);
  const p = initReplayPlayer({ adapter });
  p.load(log);
  for (const k of [3, 7, 1, 8, 0]) {
    p.seek(k);
    assert.equal(p.index, k);
    assert.equal(hashState(p.state), hashState(derive(log, adapter, k).state));
  }
});

test('restart returns to index 0', () => {
  const log = buildLog(5);
  const p = initReplayPlayer({ adapter });
  p.load(log); p.seek(4); p.restart();
  assert.equal(p.index, 0);
});

test('load honors an action-0 checkpoint (scenario initial state)', () => {
  const log = createLog({ game: 'toy', rng: createRngSuite({ seed: 'cp', streams: ['rules'] }) });
  checkpoint(log, { afterAction: 0, state: { turn: 1, rolls: [99] }, rngState: null, stateHash: null });
  const cpAdapter = {
    setup: (l) => ({ state: { turn: 0, rolls: [] }, rng: createRngSuite({ seed: l.rng.seed, streams: ['rules'] }) }),
    apply: (s, e) => ({ turn: s.turn + 1, rolls: [...s.rolls, e.action.outcome] }),
    restore: (l, cp) => ({ state: cp.state, rng: createRngSuite({ seed: l.rng.seed, streams: ['rules'] }) }),
    hash: (s) => hashState(s),
  };
  const p = initReplayPlayer({ adapter: cpAdapter });
  p.load(log);
  assert.deepEqual(p.state, { turn: 1, rolls: [99] });
});

test('play steps through to completion', async () => {
  const log = buildLog(5);
  let completed = false;
  const p = initReplayPlayer({ adapter, onComplete: () => { completed = true; }, stepMs: 5 });
  p.load(log); p.play();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(p.index, 5);
  assert.equal(completed, true);
  assert.equal(p.playing, false);
});
