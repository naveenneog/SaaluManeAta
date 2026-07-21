// action-log.js — the canonical, replayable action log for deterministic games.
// Keep this module dependency-free and byte-identical across games (drift-guarded).
//
// The structured ACTION LOG (player decisions + resolved chance outcomes) is the single source of
// truth. State is DERIVED by replaying `setup + seed` through an engine adapter; snapshots are
// checkpoints/cache only. Undo = truncate the log + re-derive. Every replay carries its engine /
// ruleset / PRNG versions, and per-action `stateHash` lets us detect desync.
//
//   createLog({ game, engine, ruleset, world, rng }) -> log
//   append(log, { side, action, rngUses?, elapsedMs?, stateHash }) -> entry
//   truncate(log, length)  -> log         // undo primitive: keep actions [0, length)
//   checkpoint(log, { afterAction, state, rngState, stateHash }) -> log
//   setResult(log, result) -> log
//   derive(log, adapter, upTo?) -> { state, rng }
//   verify(log, adapter) -> { ok, atAction?, expected?, actual? }
//
// Engine adapter (per game, lives in the engine — NOT here):
//   adapter.setup(log)            -> { state, rng }          // initial state + seeded rng suite
//   adapter.apply(state, entry, rng) -> state                // apply one action; MUST advance rng
//                                                            //   exactly as live play did
//   adapter.hash(state)           -> string                  // stable hash (usually hashState)
//   adapter.restore?(log, checkpoint) -> { state, rng }      // optional checkpoint fast-path

export const ACTION_LOG_SCHEMA = 1;

export function createLog({ game, engine = null, ruleset = null, world = null, rng }) {
  if (!game) throw new TypeError('action-log requires a game id');
  if (!rng || !rng.algorithm || rng.seed == null) {
    throw new TypeError('action-log requires rng { algorithm, seed }');
  }
  return {
    schema: ACTION_LOG_SCHEMA,
    game,
    engine,
    ruleset,
    world,
    rng: { algorithm: rng.algorithm, seed: rng.seed },
    actions: [],
    checkpoints: [],
    result: null,
  };
}

// Record a move that has ALREADY been applied to live state. `stateHash` is the hash AFTER the
// action. `rngUses` (`[{stream, draws}]`) records how many canonical draws each stream consumed so a
// replay can advance the RNG identically. `elapsedMs` is metadata and never affects derivation.
export function append(log, { side = null, action, rngUses, elapsedMs, stateHash } = {}) {
  if (action == null) throw new TypeError('append requires an action');
  const entry = { i: log.actions.length, side, action };
  if (rngUses) entry.rngUses = rngUses;
  if (typeof elapsedMs === 'number') entry.elapsedMs = elapsedMs;
  if (stateHash != null) entry.stateHash = stateHash;
  log.actions.push(entry);
  return entry;
}

// Undo primitive: keep actions [0, length); drop later actions, stale checkpoints, and the result.
export function truncate(log, length) {
  if (!Number.isInteger(length) || length < 0 || length > log.actions.length) {
    throw new RangeError('truncate length out of range');
  }
  log.actions.length = length;
  log.checkpoints = log.checkpoints.filter((c) => c.afterAction <= length);
  log.result = null;
  return log;
}

// Cache a derived state (+ rng snapshot) so re-derivation can start from the nearest checkpoint.
export function checkpoint(log, { afterAction, state, rngState = null, stateHash = null }) {
  if (!Number.isInteger(afterAction) || afterAction < 0 || afterAction > log.actions.length) {
    throw new RangeError('checkpoint afterAction out of range');
  }
  log.checkpoints = log.checkpoints.filter((c) => c.afterAction !== afterAction);
  log.checkpoints.push({ afterAction, state, rngState, stateHash });
  log.checkpoints.sort((a, b) => a.afterAction - b.afterAction);
  return log;
}

export function setResult(log, result) {
  log.result = result ?? null;
  return log;
}

// Derive the state after replaying the log through the engine adapter, up to (but not including)
// action index `upTo`. Uses the nearest checkpoint <= upTo when the adapter supports `restore`,
// otherwise replays from `setup`.
export function derive(log, adapter, upTo = log.actions.length) {
  if (!adapter || typeof adapter.setup !== 'function' || typeof adapter.apply !== 'function') {
    throw new TypeError('derive requires an adapter with setup() and apply()');
  }
  if (!Number.isInteger(upTo) || upTo < 0 || upTo > log.actions.length) {
    throw new RangeError('derive upTo out of range');
  }
  let start = 0;
  let ctx = adapter.setup(log);
  if (typeof adapter.restore === 'function') {
    const cp = log.checkpoints
      .filter((c) => c.afterAction <= upTo)
      .reduce((best, c) => (!best || c.afterAction > best.afterAction ? c : best), null);
    if (cp) { ctx = adapter.restore(log, cp); start = cp.afterAction; }
  }
  let { state, rng } = ctx;
  for (let i = start; i < upTo; i += 1) {
    state = adapter.apply(state, log.actions[i], rng);
  }
  return { state, rng };
}

// Replay the whole log from setup and assert every recorded `stateHash` matches — desync detection.
export function verify(log, adapter) {
  let { state, rng } = adapter.setup(log);
  for (let i = 0; i < log.actions.length; i += 1) {
    state = adapter.apply(state, log.actions[i], rng);
    const expected = log.actions[i].stateHash;
    if (expected != null) {
      const actual = adapter.hash(state);
      if (actual !== expected) return { ok: false, atAction: i, expected, actual };
    }
  }
  return { ok: true };
}

// The log is plain-JSON already; these are explicit for save/replay boundaries.
export function serialize(log) { return JSON.stringify(log); }
export function deserialize(text) {
  const log = typeof text === 'string' ? JSON.parse(text) : text;
  if (!log || log.schema !== ACTION_LOG_SCHEMA) throw new RangeError('unsupported action-log schema');
  return log;
}
