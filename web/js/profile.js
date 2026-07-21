// Local Profile v1: per-install PN counters plus a grow-only set of solved daily ordinals.
// Byte-identical across games (drift-guarded). No account, server, or cross-origin dependency.
import { dailyOrdinal } from './daily.js';

export const PROFILE_SCHEMA = 1;
export const MAX_PROFILE_CHARS = 65536;

const COUNTER_NAME = /^(?=.{1,48}$)[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/;
const ACTOR_ID = /^[A-Za-z0-9_-]{8,128}$/;
let fallbackSequence = 0;

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const nowValue = (now) => {
  const value = typeof now === 'function' ? now() : Date.now();
  if (!Number.isFinite(value) || value < 0) throw new TypeError('profile clock must return a timestamp');
  return Math.floor(value);
};

function newInstallId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  fallbackSequence += 1;
  return `local-${Date.now().toString(36)}-${fallbackSequence.toString(36).padStart(4, '0')}`;
}

function emptyProfile(game, { installId = newInstallId(), now = Date.now } = {}) {
  if (typeof game !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(game)) {
    throw new TypeError('profile id must be a short lowercase game id');
  }
  if (!ACTOR_ID.test(installId)) throw new TypeError('invalid profile install id');
  const createdAt = nowValue(now);
  return {
    schema: PROFILE_SCHEMA,
    game,
    installId,
    createdAt,
    updatedAt: createdAt,
    counters: {},
    daily: { ordinals: [] },
  };
}

function validateComponents(components, path) {
  if (!isPlainObject(components) || Object.keys(components).length > 256) {
    throw new TypeError(`${path} must be a bounded component map`);
  }
  for (const [actor, value] of Object.entries(components)) {
    if (!ACTOR_ID.test(actor) || !Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${path}.${actor} must be a non-negative safe integer`);
    }
  }
}

export function validateProfile(profile, { game } = {}) {
  if (!isPlainObject(profile) || profile.schema !== PROFILE_SCHEMA) throw new RangeError('unsupported profile schema');
  if (typeof profile.game !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(profile.game)) {
    throw new TypeError('invalid profile game');
  }
  if (game && profile.game !== game) throw new RangeError(`profile game ${profile.game} does not match ${game}`);
  if (!ACTOR_ID.test(profile.installId)) throw new TypeError('invalid profile install id');
  for (const field of ['createdAt', 'updatedAt']) {
    if (!Number.isSafeInteger(profile[field]) || profile[field] < 0) throw new TypeError(`invalid profile ${field}`);
  }
  if (!isPlainObject(profile.counters) || Object.keys(profile.counters).length > 64) {
    throw new TypeError('profile counters must be a bounded object');
  }
  for (const [name, counter] of Object.entries(profile.counters)) {
    if (!COUNTER_NAME.test(name) || !isPlainObject(counter)) throw new TypeError(`invalid profile counter ${name}`);
    validateComponents(counter.p, `profile.counters.${name}.p`);
    validateComponents(counter.n, `profile.counters.${name}.n`);
  }
  const ordinals = profile.daily?.ordinals;
  if (!Array.isArray(ordinals) || ordinals.length > 10000
    || ordinals.some((ordinal) => !Number.isSafeInteger(ordinal))) {
    throw new TypeError('profile daily ordinals must be a bounded integer array');
  }
  if (new Set(ordinals).size !== ordinals.length) throw new TypeError('profile daily ordinals must be unique');
  if (ordinals.some((ordinal, index) => index > 0 && ordinal <= ordinals[index - 1])) {
    throw new TypeError('profile daily ordinals must be sorted');
  }
  return true;
}

function parseProfile(text, game) {
  if (typeof text !== 'string' || text.length > MAX_PROFILE_CHARS) throw new RangeError('profile import is too large');
  const profile = JSON.parse(text);
  validateProfile(profile, { game });
  return profile;
}

const componentMax = (left = {}, right = {}) => {
  const merged = {};
  for (const actor of new Set([...Object.keys(left), ...Object.keys(right)])) {
    merged[actor] = Math.max(left[actor] ?? 0, right[actor] ?? 0);
  }
  return merged;
};

export function mergeProfiles(left, right, { installId = left?.installId } = {}) {
  validateProfile(left);
  validateProfile(right, { game: left.game });
  if (!ACTOR_ID.test(installId)) throw new TypeError('merge install id is invalid');
  const counters = {};
  for (const name of new Set([...Object.keys(left.counters), ...Object.keys(right.counters)])) {
    counters[name] = {
      p: componentMax(left.counters[name]?.p, right.counters[name]?.p),
      n: componentMax(left.counters[name]?.n, right.counters[name]?.n),
    };
  }
  const merged = {
    schema: PROFILE_SCHEMA,
    game: left.game,
    installId,
    createdAt: Math.min(left.createdAt, right.createdAt),
    updatedAt: Math.max(left.updatedAt, right.updatedAt),
    counters,
    daily: { ordinals: [...new Set([...left.daily.ordinals, ...right.daily.ordinals])].sort((a, b) => a - b) },
  };
  validateProfile(merged);
  return merged;
}

export function counterValue(profile, name) {
  validateProfile(profile);
  if (!COUNTER_NAME.test(name)) throw new TypeError('invalid counter name');
  const counter = profile.counters[name] ?? { p: {}, n: {} };
  const sum = (components) => Object.values(components).reduce((total, value) => total + value, 0);
  const value = sum(counter.p) - sum(counter.n);
  if (!Number.isSafeInteger(value)) throw new RangeError('profile counter exceeds the safe integer range');
  return value;
}

export function streakValue(profile, date = new Date()) {
  validateProfile(profile);
  const days = profile.daily.ordinals;
  if (!days.length) return { current: 0, best: 0, last: null };
  let best = 1, run = 1;
  for (let i = 1; i < days.length; i += 1) {
    run = days[i] === days[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  const today = dailyOrdinal(date);
  const last = days.at(-1);
  let current = 0;
  if (last === today || last === today - 1) {
    current = 1;
    for (let i = days.length - 1; i > 0 && days[i - 1] === days[i] - 1; i -= 1) current += 1;
  }
  return { current, best, last };
}

export function initProfile({ id, storage = globalThis.localStorage, now = Date.now } = {}) {
  const key = `tbg.${id}.profile.v1`;
  let state = null;
  const persist = () => {
    state.updatedAt = Math.max(state.updatedAt, nowValue(now));
    try { storage?.setItem?.(key, JSON.stringify(state)); } catch { /* profile remains available in memory */ }
  };
  const load = () => {
    if (state) return clone(state);
    try {
      const text = storage?.getItem?.(key);
      state = text ? parseProfile(text, id) : emptyProfile(id, { now });
    } catch {
      state = emptyProfile(id, { now });
    }
    persist();
    return clone(state);
  };
  const ensure = () => { if (!state) load(); return state; };
  const bump = (name, amount = 1) => {
    if (!COUNTER_NAME.test(name) || !Number.isSafeInteger(amount) || amount === 0) {
      throw new TypeError('bump requires a counter name and non-zero safe integer');
    }
    const profile = ensure();
    const counter = profile.counters[name] ??= { p: {}, n: {} };
    const side = amount > 0 ? counter.p : counter.n;
    side[profile.installId] = (side[profile.installId] ?? 0) + Math.abs(amount);
    if (!Number.isSafeInteger(side[profile.installId])) throw new RangeError('profile counter overflow');
    persist();
    return counterValue(profile, name);
  };
  const markDaily = (date = new Date()) => {
    const profile = ensure();
    const ordinal = dailyOrdinal(date);
    if (!profile.daily.ordinals.includes(ordinal)) {
      profile.daily.ordinals.push(ordinal);
      profile.daily.ordinals.sort((a, b) => a - b);
      persist();
    }
    return streakValue(profile, date);
  };
  const merge = (other) => {
    const profile = ensure();
    const incoming = typeof other === 'string' ? parseProfile(other, id) : other;
    state = mergeProfiles(profile, incoming, { installId: profile.installId });
    persist();
    return clone(state);
  };
  return Object.freeze({
    key,
    load,
    bump,
    markDaily,
    value: (name) => counterValue(ensure(), name),
    streak: (date) => streakValue(ensure(), date),
    snapshot: () => clone(ensure()),
    export: () => JSON.stringify(ensure()),
    import: (text) => merge(text),
    merge,
  });
}
