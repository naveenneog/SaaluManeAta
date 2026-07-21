// replay-format.js — the strict, versioned boundary for untrusted .tbg-replay.json files.
// Imported checkpoints are validated but discarded: replay integrity always derives from setup.
// Keep this module dependency-light and byte-identical across games (drift-guarded after review).
import { stableStringify } from './state-hash.js';
import { derive } from './action-log.js';

export const REPLAY_FORMAT = 'tbg-replay';
export const REPLAY_SCHEMA = 1;
export const MAX_REPLAY_BYTES = 1024 * 1024;
export const MAX_REPLAY_ACTIONS = 4096;
export const MAX_REPLAY_CHECKPOINTS = 64;

const HASH = /^[0-9a-f]{16}$/;
const GAME_ID = /^[a-z][a-z0-9-]{1,31}$/;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const encoder = new TextEncoder();

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

function sameData(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function allowedKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${path} contains unknown field ${key}`);
  }
}

function assertBoundedData(value, {
  path = 'replay',
  maxDepth = 12,
  maxNodes = 200000,
  maxKeys = 256,
  maxArray = MAX_REPLAY_ACTIONS,
  maxString = 65536,
} = {}) {
  const stack = [{ value, path, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop();
    nodes += 1;
    if (nodes > maxNodes) throw new RangeError(`${path} is too complex`);
    if (item.depth > maxDepth) throw new RangeError(`${item.path} is too deeply nested`);
    const node = item.value;
    if (node === null || typeof node === 'boolean') continue;
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) throw new TypeError(`${item.path} contains a non-finite number`);
      continue;
    }
    if (typeof node === 'string') {
      if (node.length > maxString) throw new RangeError(`${item.path} string is too long`);
      continue;
    }
    if (typeof node !== 'object') throw new TypeError(`${item.path} must contain JSON data only`);
    if (Array.isArray(node)) {
      if (node.length > maxArray) throw new RangeError(`${item.path} array is too long`);
      for (let i = node.length - 1; i >= 0; i -= 1) {
        stack.push({ value: node[i], path: `${item.path}[${i}]`, depth: item.depth + 1 });
      }
      continue;
    }
    if (!isPlainObject(node)) throw new TypeError(`${item.path} must contain plain objects`);
    const keys = Object.keys(node);
    if (keys.length > maxKeys) throw new RangeError(`${item.path} has too many fields`);
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      const key = keys[i];
      if (UNSAFE_KEYS.has(key) || key.length > 128) throw new TypeError(`${item.path} contains an unsafe key`);
      stack.push({ value: node[key], path: `${item.path}.${key}`, depth: item.depth + 1 });
    }
  }
}

function assertVersion(value, path) {
  const valid = (typeof value === 'string' && value.length > 0 && value.length <= 128)
    || (Number.isSafeInteger(value) && value >= 0);
  if (!valid) throw new TypeError(`${path} must be a bounded string or non-negative integer`);
}

function assertEngine(value) {
  if (!isPlainObject(value)) throw new TypeError('replay.log.engine must be an object');
  allowedKeys(value, new Set(['id', 'version']), 'replay.log.engine');
  if (value.id !== undefined && (typeof value.id !== 'string' || !SAFE_ID.test(value.id))) {
    throw new TypeError('replay.log.engine.id is invalid');
  }
  assertVersion(value.version, 'replay.log.engine.version');
}

function assertRuleset(value) {
  if (!isPlainObject(value)) throw new TypeError('replay.log.ruleset must be an object');
  allowedKeys(value, new Set(['id', 'version']), 'replay.log.ruleset');
  if (typeof value.id !== 'string' || !SAFE_ID.test(value.id)) throw new TypeError('replay.log.ruleset.id is invalid');
  assertVersion(value.version, 'replay.log.ruleset.version');
}

function assertHash(value, path) {
  if (typeof value !== 'string' || !HASH.test(value)) throw new TypeError(`${path} must be an xxh64 hash`);
}

function assertActionData(action, path) {
  if (!isPlainObject(action)) throw new TypeError(`${path} must be a plain object`);
  assertBoundedData(action, {
    path,
    maxDepth: 6,
    maxNodes: 256,
    maxKeys: 32,
    maxArray: 64,
    maxString: 512,
  });
}

function assertRngUses(value, path) {
  if (!Array.isArray(value) || value.length > 16) throw new TypeError(`${path} must be a bounded array`);
  value.forEach((use, index) => {
    const at = `${path}[${index}]`;
    if (!isPlainObject(use)) throw new TypeError(`${at} must be an object`);
    allowedKeys(use, new Set(['stream', 'draws']), at);
    if (typeof use.stream !== 'string' || !SAFE_ID.test(use.stream)
      || !Number.isSafeInteger(use.draws) || use.draws < 0) {
      throw new TypeError(`${at} must be { stream, draws }`);
    }
  });
}

function cloneData(value) {
  return JSON.parse(stableStringify(value));
}

function replayOptions(options) {
  if (!options || typeof options !== 'object') throw new TypeError('validateReplay requires options');
  if (typeof options.game !== 'string' || !GAME_ID.test(options.game)) {
    throw new TypeError('validateReplay requires a short lowercase game id');
  }
  if (!Object.hasOwn(options, 'engine') || !Object.hasOwn(options, 'ruleset')) {
    throw new TypeError('validateReplay requires exact engine and ruleset descriptors');
  }
  if (typeof options.validateAction !== 'function') {
    throw new TypeError('validateReplay requires validateAction(action, context)');
  }
  const maxActions = options.maxActions ?? MAX_REPLAY_ACTIONS;
  const maxCheckpoints = options.maxCheckpoints ?? MAX_REPLAY_CHECKPOINTS;
  if (!Number.isSafeInteger(maxActions) || maxActions < 0 || maxActions > MAX_REPLAY_ACTIONS
    || !Number.isSafeInteger(maxCheckpoints) || maxCheckpoints < 0 || maxCheckpoints > MAX_REPLAY_CHECKPOINTS) {
    throw new RangeError('invalid replay validation budgets');
  }
  return { ...options, maxActions, maxCheckpoints };
}

// validateAction contract:
//   validateAction(action, { index, side, game, engine, ruleset }) -> true | void
// It must be pure, bounded, and throw (or return false) for an action the game adapter cannot accept.
export function validateReplay(value, options) {
  const opts = replayOptions(options);
  assertBoundedData(value);
  if (!isPlainObject(value)) throw new TypeError('replay must be an object');

  const enveloped = value.format !== undefined;
  if (enveloped) {
    allowedKeys(value, new Set(['format', 'schema', 'finalStateHash', 'log']), 'replay');
    if (value.format !== REPLAY_FORMAT || value.schema !== REPLAY_SCHEMA) {
      throw new RangeError('unsupported replay envelope');
    }
    assertHash(value.finalStateHash, 'replay.finalStateHash');
  }
  const log = enveloped ? value.log : value;
  if (!isPlainObject(log)) throw new TypeError('replay.log must be an object');
  allowedKeys(log, new Set([
    'schema', 'game', 'engine', 'ruleset', 'world', 'rng',
    'setup', 'actions', 'checkpoints', 'result',
  ]), 'replay.log');
  if (log.schema !== 1) throw new RangeError('unsupported action-log schema');
  if (log.game !== opts.game) throw new RangeError(`replay game ${log.game} does not match ${opts.game}`);
  assertEngine(log.engine);
  assertRuleset(log.ruleset);
  if (!sameData(log.engine, opts.engine)) throw new RangeError('replay engine version is unsupported');
  if (!sameData(log.ruleset, opts.ruleset)) throw new RangeError('replay ruleset version is unsupported');
  if (log.world !== null && (typeof log.world !== 'string' || !SAFE_ID.test(log.world))) {
    throw new TypeError('replay.log.world is invalid');
  }
  if (!isPlainObject(log.rng)) throw new TypeError('replay.log.rng must be an object');
  allowedKeys(log.rng, new Set(['algorithm', 'seed']), 'replay.log.rng');
  if (typeof log.rng.algorithm !== 'string' || !SAFE_ID.test(log.rng.algorithm)) {
    throw new TypeError('replay.log.rng.algorithm is invalid');
  }
  const validSeed = (typeof log.rng.seed === 'string' && log.rng.seed.length > 0 && log.rng.seed.length <= 128)
    || (Number.isSafeInteger(log.rng.seed));
  if (!validSeed) throw new TypeError('replay.log.rng.seed is invalid');

  if (!Array.isArray(log.actions) || log.actions.length > opts.maxActions) {
    throw new RangeError('replay has too many actions');
  }
  log.actions.forEach((entry, index) => {
    const path = `replay.log.actions[${index}]`;
    if (!isPlainObject(entry)) throw new TypeError(`${path} must be an object`);
    allowedKeys(entry, new Set(['i', 'side', 'action', 'rngUses', 'elapsedMs', 'stateHash']), path);
    if (entry.i !== index) throw new RangeError(`${path}.i must equal ${index}`);
    const side = entry.side;
    const genericSide = side === null || typeof side === 'string'
      || (Number.isSafeInteger(side) && side >= 0 && side <= 15);
    if (!genericSide || (opts.validateSide && opts.validateSide(side, { index, game: log.game }) === false)) {
      throw new TypeError(`${path}.side is invalid`);
    }
    assertActionData(entry.action, `${path}.action`);
    const accepted = opts.validateAction(entry.action, {
      index,
      side,
      game: log.game,
      engine: log.engine,
      ruleset: log.ruleset,
    });
    if (accepted === false) throw new RangeError(`${path}.action is not supported`);
    if (entry.rngUses !== undefined) assertRngUses(entry.rngUses, `${path}.rngUses`);
    if (entry.elapsedMs !== undefined
      && (!Number.isFinite(entry.elapsedMs) || entry.elapsedMs < 0 || entry.elapsedMs > 86400000)) {
      throw new TypeError(`${path}.elapsedMs is invalid`);
    }
    assertHash(entry.stateHash, `${path}.stateHash`);
  });

  if (!Array.isArray(log.checkpoints) || log.checkpoints.length > opts.maxCheckpoints) {
    throw new RangeError('replay has too many checkpoints');
  }
  let previousCheckpoint = -1;
  log.checkpoints.forEach((checkpoint, index) => {
    const path = `replay.log.checkpoints[${index}]`;
    if (!isPlainObject(checkpoint)) throw new TypeError(`${path} must be an object`);
    allowedKeys(checkpoint, new Set(['afterAction', 'state', 'rngState', 'stateHash']), path);
    if (!Number.isSafeInteger(checkpoint.afterAction) || checkpoint.afterAction < 0
      || checkpoint.afterAction > log.actions.length || checkpoint.afterAction <= previousCheckpoint) {
      throw new RangeError(`${path}.afterAction must be sorted, unique, and in range`);
    }
    previousCheckpoint = checkpoint.afterAction;
    if (!isPlainObject(checkpoint.state)) throw new TypeError(`${path}.state must be a plain object`);
    if (checkpoint.rngState !== null && checkpoint.rngState !== undefined
      && !isPlainObject(checkpoint.rngState)) throw new TypeError(`${path}.rngState must be a plain object or null`);
    if (checkpoint.stateHash !== null && checkpoint.stateHash !== undefined) {
      assertHash(checkpoint.stateHash, `${path}.stateHash`);
    }
  });
  if (log.result !== null && !isPlainObject(log.result)) throw new TypeError('replay.log.result must be an object or null');

  const finalStateHash = enveloped ? value.finalStateHash : log.actions.at(-1)?.stateHash;
  if (!finalStateHash) throw new RangeError('a raw replay requires at least one hashed action');
  const normalized = {
    format: REPLAY_FORMAT,
    schema: REPLAY_SCHEMA,
    finalStateHash,
    log: cloneData({ ...log, checkpoints: [] }),
  };
  const bytes = encoder.encode(stableStringify(normalized)).byteLength;
  if (bytes > MAX_REPLAY_BYTES) throw new RangeError('replay JSON is too large');
  return normalized;
}

export function verifyReplay(value, adapter, options) {
  try {
    if (!adapter || typeof adapter.setup !== 'function'
      || typeof adapter.apply !== 'function' || typeof adapter.hash !== 'function') {
      throw new TypeError('verifyReplay requires an action-log adapter');
    }
    const envelope = validateReplay(value, options);
    const { log } = envelope;
    let { state, rng } = adapter.setup(log);
    for (let index = 0; index < log.actions.length; index += 1) {
      state = adapter.apply(state, log.actions[index], rng);
      const actual = adapter.hash(state);
      const expected = log.actions[index].stateHash;
      if (actual !== expected) {
        return { ok: false, reason: 'action-hash', atAction: index, expected, actual };
      }
    }
    const finalStateHash = adapter.hash(state);
    if (finalStateHash !== envelope.finalStateHash) {
      return {
        ok: false,
        reason: 'final-hash',
        expected: envelope.finalStateHash,
        actual: finalStateHash,
      };
    }
    return { ok: true, envelope, finalState: state, finalStateHash };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

export async function importReplay(file, { adapter, ...options } = {}) {
  try {
    if (!file || typeof file.text !== 'function' || !Number.isFinite(file.size)
      || file.size < 1 || file.size > MAX_REPLAY_BYTES) return null;
    if (typeof file.name === 'string' && !/\.tbg-replay\.json$/i.test(file.name)) return null;
    const text = await file.text();
    if (encoder.encode(text).byteLength > MAX_REPLAY_BYTES) return null;
    const result = verifyReplay(JSON.parse(text), adapter, options);
    return result.ok ? result.envelope : null;
  } catch {
    return null;
  }
}

export async function exportReplay(log, {
  adapter,
  filename = `${log?.game || 'game'}.tbg-replay.json`,
  ...options
} = {}) {
  if (!adapter || typeof adapter.setup !== 'function'
    || typeof adapter.apply !== 'function' || typeof adapter.hash !== 'function') {
    throw new TypeError('exportReplay requires an action-log adapter');
  }
  if (typeof filename !== 'string' || !/^[A-Za-z0-9_.-]{1,96}\.tbg-replay\.json$/i.test(filename)) {
    throw new TypeError('invalid replay filename');
  }
  const cleanLog = cloneData({ ...log, checkpoints: [] });
  const originalFinalHash = adapter.hash(derive(log, adapter).state);
  let { state, rng } = adapter.setup(cleanLog);
  for (const entry of cleanLog.actions) state = adapter.apply(state, entry, rng);
  if (adapter.hash(state) !== originalFinalHash) {
    throw new RangeError('cannot export a replay whose position depends on a checkpoint');
  }
  const envelope = {
    format: REPLAY_FORMAT,
    schema: REPLAY_SCHEMA,
    finalStateHash: adapter.hash(state),
    log: cleanLog,
  };
  const verified = verifyReplay(envelope, adapter, {
    ...options,
    game: options.game ?? cleanLog.game,
    engine: options.engine ?? cleanLog.engine,
    ruleset: options.ruleset ?? cleanLog.ruleset,
  });
  if (!verified.ok) throw new RangeError(`cannot export replay: ${verified.reason}`);
  const text = stableStringify(verified.envelope);
  const blob = new Blob([text], { type: 'application/json' });
  if (blob.size > MAX_REPLAY_BYTES) throw new RangeError('replay JSON is too large');
  return { envelope: verified.envelope, text, blob, filename };
}
