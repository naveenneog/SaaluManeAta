import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpectateLog } from '../web/js/spectate.js';
import { createSmaSpectateDriver } from '../web/js/spectate-driver.js';
import { createLog, verify } from '../web/js/action-log.js';
import { newGame, applyMove, canonicalState } from '../web/js/logic.js';
import { hashState } from '../web/js/state-hash.js';
import { createRngSuite } from '../web/js/rng.js';

// Saalu Mane Ata is deterministic and RNG-free: the move IS the action, and the adapter uses no rng.
const adapter = {
  setup: () => ({ state: newGame(), rng: null }),
  apply: (st, entry) => applyMove(st, entry.action),
  hash: (st) => hashState(canonicalState(st)),
};
// The log still carries rng metadata (createLog requires it); the adapter simply never draws.
const freshLog = (seed) => createLog({
  game: 'sma', engine: { version: '1.5.0' }, ruleset: { id: 'sma.base', version: 1 },
  world: 'parampare', rng: createRngSuite({ seed, streams: ['rules'] }),
});

test('SMA spectate: builds a deterministic RNG-free log that re-derives cleanly', () => {
  const out = buildSpectateLog({ log: freshLog('sp-sma-1'), adapter, driver: createSmaSpectateDriver({ level: 2 }), maxActions: 400, repetition: 3 });
  assert.ok(out.log.actions.length > 0);
  assert.equal(verify(out.log, adapter).ok, true);
  assert.ok(out.log.actions.every((e) => e.rngUses == null || e.rngUses.length === 0));
  assert.ok(['terminal', 'repetition', 'max-actions', 'driver-stop'].includes(out.result.reason));
});

test('SMA spectate: every action is a valid place/move/remove with an integer side', () => {
  const out = buildSpectateLog({ log: freshLog('sp-sma-2'), adapter, driver: createSmaSpectateDriver({}), maxActions: 400 });
  for (const e of out.log.actions) {
    assert.ok(Number.isInteger(e.side) && (e.side === 0 || e.side === 1));
    assert.ok(['place', 'move', 'remove'].includes(e.action.type));
    if (e.action.type === 'place') assert.ok(Number.isInteger(e.action.to) && e.action.from === undefined);
    if (e.action.type === 'move') assert.ok(Number.isInteger(e.action.from) && Number.isInteger(e.action.to));
    if (e.action.type === 'remove') assert.ok(Number.isInteger(e.action.at));
  }
});

test('SMA spectate: identical inputs => identical actions and final hash (determinism)', () => {
  const a = buildSpectateLog({ log: freshLog('k'), adapter, driver: createSmaSpectateDriver({}), maxActions: 400 });
  const b = buildSpectateLog({ log: freshLog('k'), adapter, driver: createSmaSpectateDriver({}), maxActions: 400 });
  assert.deepEqual(a.log.actions, b.log.actions);
  assert.equal(a.result.stateHash, b.result.stateHash);
});

test('SMA spectate: an already-terminal state cannot be spectated (driver stops immediately)', () => {
  // A driver that never yields an action must throw at index 0 rather than fabricate a result.
  const emptyDriver = { next: () => null };
  assert.throws(() => buildSpectateLog({ log: freshLog('z'), adapter, driver: emptyDriver }), /before producing an action/);
});
