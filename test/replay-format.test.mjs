import test from 'node:test';
import assert from 'node:assert/strict';
import { append, checkpoint, createLog } from '../web/js/action-log.js';
import {
  MAX_REPLAY_BYTES,
  exportReplay,
  importReplay,
  validateReplay,
  verifyReplay,
} from '../web/js/replay-format.js';
import { hashState } from '../web/js/state-hash.js';

const engine = { version: 'toy-engine-v1' };
const ruleset = { id: 'toy.base', version: 1 };
const adapter = {
  setup: () => ({ state: { total: 0 }, rng: {} }),
  apply: (state, entry) => ({ total: state.total + entry.action.n }),
  restore: (log, saved) => ({ state: structuredClone(saved.state), rng: {} }),
  hash: hashState,
};
const validateAction = (action) => {
  if (!action || Object.keys(action).length !== 2 || action.k !== 'add'
    || !Number.isSafeInteger(action.n) || action.n < 1 || action.n > 9) {
    throw new TypeError('unsupported toy action');
  }
  return true;
};
const options = { game: 'toy', engine, ruleset, validateAction };

function makeLog() {
  const log = createLog({
    game: 'toy',
    engine,
    ruleset,
    world: 'table',
    rng: { algorithm: 'xoshiro128ss-v1', seed: 'replay-format-test' },
  });
  let state = { total: 0 };
  for (const n of [2, 3, 1]) {
    state = { total: state.total + n };
    append(log, { side: state.total % 2, action: { k: 'add', n }, stateHash: hashState(state) });
  }
  return log;
}

test('export creates a versioned replay whose final hash verifies', async () => {
  const exported = await exportReplay(makeLog(), { adapter, validateAction });
  assert.equal(exported.envelope.format, 'tbg-replay');
  assert.equal(exported.envelope.schema, 1);
  assert.equal(exported.envelope.finalStateHash, hashState({ total: 6 }));
  assert.equal(verifyReplay(exported.envelope, adapter, options).ok, true);
  assert.match(exported.filename, /\.tbg-replay\.json$/);
});

test('legacy raw logs normalize and imported checkpoints are discarded', () => {
  const log = makeLog();
  checkpoint(log, {
    afterAction: 1,
    state: { total: 999 },
    rngState: {},
    stateHash: hashState({ total: 999 }),
  });
  const replay = validateReplay(log, options);
  assert.equal(replay.finalStateHash, log.actions.at(-1).stateHash);
  assert.deepEqual(replay.log.checkpoints, []);
  assert.equal(verifyReplay(replay, adapter, options).ok, true);
});

test('export refuses a semantic checkpoint that cannot be derived from setup', async () => {
  const log = makeLog();
  checkpoint(log, {
    afterAction: log.actions.length,
    state: { total: 999 },
    rngState: {},
    stateHash: hashState({ total: 999 }),
  });
  await assert.rejects(
    exportReplay(log, { adapter, validateAction }),
    /depends on a checkpoint/,
  );
});

test('per-action and final hash tampering are rejected', async () => {
  const { envelope } = await exportReplay(makeLog(), { adapter, validateAction });
  const actionTamper = structuredClone(envelope);
  actionTamper.log.actions[1].stateHash = '0000000000000000';
  assert.deepEqual(verifyReplay(actionTamper, adapter, options), {
    ok: false,
    reason: 'action-hash',
    atAction: 1,
    expected: '0000000000000000',
    actual: hashState({ total: 5 }),
  });
  const finalTamper = structuredClone(envelope);
  finalTamper.finalStateHash = 'ffffffffffffffff';
  assert.equal(verifyReplay(finalTamper, adapter, options).reason, 'final-hash');
});

test('strict boundary rejects wrong versions, malformed actions and unsafe shapes', () => {
  const log = makeLog();
  assert.throws(() => validateReplay(log, { ...options, engine: { version: 'toy-engine-v2' } }), /engine/);
  const badAction = structuredClone(log);
  badAction.actions[0].action = { k: 'add', n: 99 };
  assert.throws(() => validateReplay(badAction, options), /unsupported toy action/);
  const unsafe = JSON.parse(JSON.stringify(log).replace(
    '"action":{"k":"add","n":2}',
    '"action":{"k":"add","n":2,"__proto__":{"polluted":true}}',
  ));
  assert.throws(() => validateReplay(unsafe, options), /unsafe key/);
  assert.equal({}.polluted, undefined);
});

test('validateAction receives stable action context', () => {
  const seen = [];
  validateReplay(makeLog(), {
    ...options,
    validateAction(action, context) {
      seen.push({ action, context });
      return validateAction(action);
    },
  });
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[0].context, {
    index: 0,
    side: 0,
    game: 'toy',
    engine,
    ruleset,
  });
});

test('import is total and enforces filename, byte and integrity caps', async () => {
  const exported = await exportReplay(makeLog(), { adapter, validateAction });
  const file = {
    name: 'lesson.tbg-replay.json',
    size: exported.blob.size,
    text: async () => exported.text,
  };
  const imported = await importReplay(file, { adapter, ...options });
  assert.equal(imported.finalStateHash, exported.envelope.finalStateHash);
  assert.equal(await importReplay({ ...file, name: 'lesson.json' }, { adapter, ...options }), null);
  assert.equal(await importReplay({ ...file, size: MAX_REPLAY_BYTES + 1 }, { adapter, ...options }), null);
  assert.equal(await importReplay({ ...file, text: async () => '{' }, { adapter, ...options }), null);
  const corrupt = JSON.parse(exported.text);
  corrupt.log.actions[0].stateHash = '0000000000000000';
  assert.equal(await importReplay({
    ...file,
    text: async () => JSON.stringify(corrupt),
  }, { adapter, ...options }), null);
});
