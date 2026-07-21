// Deterministic AI-vs-AI log generation and read-only replay handoff.
// This module has no save, profile, daily, achievement, demo-flag, or storage dependency.
// Keep it byte-identical across games after cross-review.
import { append, setResult } from './action-log.js';
import { isCanonicalStream } from './rng.js';

const MAX_LOG_BYTES = 1024 * 1024;
const MAX_ACTIONS = 4096;
const HASH = /^[0-9a-f]{16}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

function assertBoundedData(value, path = 'value') {
  const stack = [{ value, path, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop();
    if (++nodes > 8192) throw new RangeError(`${path} is too complex`);
    if (item.depth > 20) throw new RangeError(`${item.path} is too deep`);
    const current = item.value;
    if (current === null || typeof current === 'boolean') continue;
    if (typeof current === 'string') {
      if (current.length > 4096) throw new RangeError(`${item.path} is too long`);
      continue;
    }
    if (typeof current === 'number') {
      if (!Number.isSafeInteger(current)) throw new TypeError(`${item.path} must be a safe integer`);
      continue;
    }
    if (Array.isArray(current)) {
      if (current.length > MAX_ACTIONS) throw new RangeError(`${item.path} has too many items`);
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current[index], path: `${item.path}[${index}]`, depth: item.depth + 1 });
      }
      continue;
    }
    if (!isPlainObject(current)) throw new TypeError(`${item.path} must contain plain data`);
    const keys = Object.keys(current);
    if (keys.length > 128) throw new RangeError(`${item.path} has too many keys`);
    for (const key of keys) {
      if (FORBIDDEN_KEYS.has(key)) throw new TypeError(`${item.path}.${key} is forbidden`);
      stack.push({ value: current[key], path: `${item.path}.${key}`, depth: item.depth + 1 });
    }
  }
}

function cloneFreshLog(log) {
  if (!isPlainObject(log) || log.schema !== 1) throw new TypeError('spectate requires an action-log');
  assertBoundedData(log, 'spectate log');
  if (!Array.isArray(log.actions) || log.actions.length !== 0) {
    throw new RangeError('spectate requires a fresh log with no actions');
  }
  if (!Array.isArray(log.checkpoints) || log.checkpoints.length !== 0 || log.result !== null) {
    throw new RangeError('spectate requires a setup-derived log without checkpoints or result');
  }
  if (!isPlainObject(log.rng) || typeof log.rng.algorithm !== 'string'
    || !['string', 'number'].includes(typeof log.rng.seed)) {
    throw new TypeError('spectate log requires explicit RNG algorithm and seed');
  }
  const text = JSON.stringify(log);
  if (new TextEncoder().encode(text).byteLength > MAX_LOG_BYTES) throw new RangeError('spectate log is too large');
  return JSON.parse(text);
}

function snapshot(rng) {
  if (rng == null) return null;
  if (typeof rng.snapshot !== 'function' || typeof rng.restore !== 'function') {
    throw new TypeError('spectate RNG must support snapshot and restore');
  }
  const value = rng.snapshot();
  assertBoundedData(value, 'spectate RNG snapshot');
  return value;
}

function rngUsesBetween(before, after) {
  if (before === null && after === null) return [];
  if (!isPlainObject(before) || !isPlainObject(after)) throw new TypeError('spectate RNG snapshots are invalid');
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const uses = [];
  for (const name of names) {
    const left = before[name]?.draws;
    const right = after[name]?.draws;
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || right < left) {
      throw new RangeError(`spectate RNG stream ${name} moved backwards or disappeared`);
    }
    const draws = right - left;
    if (draws > 0) {
      if (!isCanonicalStream(name)) throw new RangeError(`spectate driver used noncanonical RNG stream ${name}`);
      uses.push({ stream: name, draws });
    }
  }
  return uses;
}

function normalizeUses(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 16) throw new TypeError('spectate rngUses must be a bounded array');
  const seen = new Set();
  return value.map((use) => {
    if (!isPlainObject(use) || Object.keys(use).length !== 2
      || typeof use.stream !== 'string' || !isCanonicalStream(use.stream)
      || !Number.isSafeInteger(use.draws) || use.draws < 1 || seen.has(use.stream)) {
      throw new TypeError('spectate rngUses entries must be unique canonical stream draw counts');
    }
    seen.add(use.stream);
    return { stream: use.stream, draws: use.draws };
  }).sort((left, right) => (left.stream < right.stream ? -1 : left.stream > right.stream ? 1 : 0));
}

function sameUses(left, right) {
  return left.length === right.length
    && left.every((use, index) => use.stream === right[index].stream && use.draws === right[index].draws);
}

function validateDecision(decision) {
  if (!isPlainObject(decision)) throw new TypeError('spectate driver.next must return a decision or null');
  const allowed = new Set(['side', 'action', 'rngUses']);
  for (const key of Object.keys(decision)) if (!allowed.has(key)) throw new TypeError(`spectate decision ${key} is not allowed`);
  if (!Object.hasOwn(decision, 'side') || !Object.hasOwn(decision, 'action')) {
    throw new TypeError('spectate decision requires side and action');
  }
  const side = decision.side;
  if (!(Number.isSafeInteger(side) || (typeof side === 'string' && side.length >= 1 && side.length <= 16))) {
    throw new TypeError('spectate decision side is invalid');
  }
  assertBoundedData(decision.action, 'spectate decision action');
  return decision;
}

function terminalWinner(state) {
  return isPlainObject(state) && Object.hasOwn(state, 'winner') && state.winner != null
    ? state.winner
    : null;
}

function finish(generated, reason, stateHash, state) {
  const afterAction = generated.actions.length;
  const winner = terminalWinner(state);
  const result = Object.freeze({
    reason,
    afterAction,
    stateHash,
    ...(reason === 'terminal' ? { winner } : {}),
  });
  if (reason === 'terminal') {
    setResult(generated, { winner, afterAction });
  } else {
    setResult(generated, {
      kind: 'spectate-stop',
      reason,
      afterAction,
      stateHash,
    });
  }
  return Object.freeze({ log: generated, result });
}

export function buildSpectateLog({
  log,
  adapter,
  driver,
  maxActions = 512,
  repetition = 3,
} = {}) {
  if (!adapter || typeof adapter.setup !== 'function' || typeof adapter.apply !== 'function'
    || typeof adapter.hash !== 'function') {
    throw new TypeError('buildSpectateLog requires an action-log adapter');
  }
  if (!driver || typeof driver.next !== 'function') throw new TypeError('buildSpectateLog requires driver.next');
  if (!Number.isSafeInteger(maxActions) || maxActions < 1 || maxActions > MAX_ACTIONS) {
    throw new RangeError(`spectate maxActions must be 1..${MAX_ACTIONS}`);
  }
  if (!Number.isSafeInteger(repetition) || repetition < 2 || repetition > 16) {
    throw new RangeError('spectate repetition must be 2..16');
  }
  const generated = cloneFreshLog(log);
  const setup = adapter.setup(generated);
  if (!setup || !Object.hasOwn(setup, 'state')) throw new TypeError('spectate adapter setup is invalid');
  let { state, rng } = setup;
  let stateHash = adapter.hash(state);
  if (!HASH.test(stateHash)) throw new TypeError('spectate adapter hash must be a lowercase 64-bit hex string');
  const repetitions = new Map([[stateHash, 1]]);

  for (let actionIndex = 0; actionIndex < maxActions; actionIndex += 1) {
    if (terminalWinner(state) !== null) return finish(generated, 'terminal', stateHash, state);
    const stateBeforeDriver = adapter.hash(state);
    const rngBefore = snapshot(rng);
    const decision = driver.next(Object.freeze({ state, rng, actionIndex }));
    if (decision && typeof decision.then === 'function') {
      throw new TypeError('spectate driver.next must be synchronous and budget-bounded');
    }
    if (decision == null) {
      if (actionIndex === 0) throw new RangeError('spectate driver stopped before producing an action');
      return finish(generated, 'driver-stop', stateHash, state);
    }
    validateDecision(decision);
    if (adapter.hash(state) !== stateBeforeDriver) throw new TypeError('spectate driver must not mutate state');
    const rngAfterDriver = snapshot(rng);
    const measuredUses = rngUsesBetween(rngBefore, rngAfterDriver);
    const declaredUses = normalizeUses(decision.rngUses);
    if (!sameUses(measuredUses, declaredUses)) {
      throw new RangeError('spectate driver rngUses do not match canonical RNG draws');
    }
    if (rng !== null) rng.restore(rngBefore);
    const entry = {
      side: decision.side,
      action: JSON.parse(JSON.stringify(decision.action)),
      ...(measuredUses.length ? { rngUses: measuredUses } : {}),
    };
    state = adapter.apply(state, entry, rng);
    if (rng !== null && JSON.stringify(snapshot(rng)) !== JSON.stringify(rngAfterDriver)) {
      throw new RangeError('spectate adapter RNG replay diverged from driver accounting');
    }
    stateHash = adapter.hash(state);
    if (!HASH.test(stateHash)) throw new TypeError('spectate adapter hash must be a lowercase 64-bit hex string');
    append(generated, { ...entry, stateHash });
    if (terminalWinner(state) !== null) return finish(generated, 'terminal', stateHash, state);
    const count = (repetitions.get(stateHash) ?? 0) + 1;
    repetitions.set(stateHash, count);
    if (count >= repetition) return finish(generated, 'repetition', stateHash, state);
  }
  return finish(generated, 'max-actions', stateHash, state);
}

export function initSpectate({
  generate,
  replayUI,
  restoreLive = null,
  reducedMotion = false,
  saveData = false,
} = {}) {
  if (typeof generate !== 'function') throw new TypeError('initSpectate requires generate');
  if (!replayUI || typeof replayUI.load !== 'function'
    || typeof replayUI.pause !== 'function' || typeof replayUI.step !== 'function') {
    throw new TypeError('initSpectate requires replayUI load/pause/step');
  }
  if (restoreLive !== null && typeof restoreLive !== 'function') throw new TypeError('restoreLive must be a function');
  let sequence = 0;
  let active = false;
  let playing = false;
  let current = null;
  let stepMs = 900;
  let timer = null;
  const autoplay = !reducedMotion && !saveData;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function pause() {
    clearTimer();
    replayUI.pause();
    playing = false;
    return api;
  }

  function schedule() {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (!active || !playing) return;
      const advanced = replayUI.step(1);
      const complete = advanced === false
        || (Number.isSafeInteger(replayUI.index) && Number.isSafeInteger(replayUI.total)
          && replayUI.index >= replayUI.total);
      if (complete) {
        playing = false;
        return;
      }
      schedule();
    }, stepMs);
  }

  function play() {
    if (!active || !autoplay) return false;
    playing = true;
    schedule();
    return true;
  }

  async function start(seed) {
    const ticket = ++sequence;
    pause();
    const generated = await generate(seed);
    if (ticket !== sequence) return null;
    if (!generated || !isPlainObject(generated.log) || !isPlainObject(generated.result)) {
      throw new TypeError('spectate generate must return { log, result }');
    }
    if (replayUI.load(generated.log) === false) throw new Error('generated spectate replay was rejected');
    current = generated;
    active = true;
    if (autoplay) play();
    return generated;
  }

  function step() {
    if (!active) return false;
    pause();
    return replayUI.step(1);
  }

  function setSpeed(value) {
    const next = Number(value);
    if (!Number.isSafeInteger(next) || next < 100 || next > 5000) {
      throw new RangeError('spectate speed must be 100..5000 milliseconds');
    }
    const resume = api.playing;
    pause();
    stepMs = next;
    if (resume) play();
    return api;
  }

  function skip() {
    sequence += 1;
    const wasActive = active || replayUI.active === true;
    pause();
    active = false;
    current = null;
    if (wasActive && typeof replayUI.close === 'function') replayUI.close();
    else restoreLive?.();
    return true;
  }

  async function exportReplay() {
    if (!current || typeof replayUI.exportCurrent !== 'function') return null;
    return replayUI.exportCurrent();
  }

  const api = Object.freeze({
    start,
    play,
    pause,
    step,
    skip,
    setSpeed,
    exportReplay,
    get active() { return active; },
    get playing() { return playing; },
    get current() { return current; },
    get speed() { return stepMs; },
    get autoplay() { return autoplay; },
  });
  return api;
}
