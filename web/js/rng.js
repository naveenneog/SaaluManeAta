// Deterministic named RNG streams for canonical rules, AI, and noncanonical presentation.
// Keep this module dependency-free and byte-identical across games.
export const RNG_ALGORITHM = 'xoshiro128ss-v1';
export const DEFAULT_RNG_STREAMS = Object.freeze(['rules', 'ai:0', 'ai:1', 'visual', 'audio']);

const MASK64 = (1n << 64n) - 1n;
const UINT32_RANGE = 0x100000000;
const SPLITMIX_GAMMA = 0x9e3779b97f4a7c15n;
const SPLITMIX_MUL1 = 0xbf58476d1ce4e5b9n;
const SPLITMIX_MUL2 = 0x94d049bb133111ebn;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const encoder = new TextEncoder();

const u64 = (value) => value & MASK64;
const rotl32 = (value, bits) => ((value << bits) | (value >>> (32 - bits))) >>> 0;

function fnv1a64(text) {
  let hash = FNV_OFFSET;
  for (const byte of encoder.encode(text)) {
    hash ^= BigInt(byte);
    hash = u64(hash * FNV_PRIME);
  }
  return hash;
}

function seedToBigInt(seed) {
  if (typeof seed === 'bigint') return u64(seed);
  if (typeof seed === 'number') {
    if (!Number.isSafeInteger(seed)) throw new TypeError('RNG seed numbers must be safe integers');
    return u64(BigInt(seed));
  }
  if (typeof seed === 'string') {
    const value = seed.trim();
    if (!value) throw new TypeError('RNG seed strings must not be empty');
    if (/^\+?0x[0-9a-f]+$/i.test(value)) return u64(BigInt(value.replace(/^\+/, '')));
    if (/^-0x[0-9a-f]+$/i.test(value)) return u64(-BigInt(value.slice(1)));
    if (/^[+-]?\d+$/.test(value)) return u64(BigInt(value));
    return fnv1a64(value);
  }
  throw new TypeError('RNG seed must be a bigint, safe integer, or string');
}

function splitmix64Next(holder) {
  holder.value = u64(holder.value + SPLITMIX_GAMMA);
  let z = holder.value;
  z = u64((z ^ (z >> 30n)) * SPLITMIX_MUL1);
  z = u64((z ^ (z >> 27n)) * SPLITMIX_MUL2);
  return u64(z ^ (z >> 31n));
}

function initialState(rootSeed, streamName) {
  const source = { value: u64(rootSeed ^ fnv1a64(`${RNG_ALGORITHM}:${streamName}`)) };
  const state = Array.from({ length: 4 }, () => Number(splitmix64Next(source) & 0xffffffffn) >>> 0);
  if (state.every((value) => value === 0)) state[0] = 0x9e3779b9;
  return state;
}

function validateState(value) {
  const state = Array.isArray(value) ? value : value?.state;
  if (!Array.isArray(state) || state.length !== 4
    || state.some((word) => !Number.isInteger(word) || word < 0 || word >= UINT32_RANGE)) {
    throw new TypeError('xoshiro128** state must contain four uint32 values');
  }
  if (state.every((word) => word === 0)) throw new RangeError('xoshiro128** state must not be all zero');
  return state.map((word) => word >>> 0);
}

function createGenerator(name, canonical, seedHex, stateWords) {
  let [s0, s1, s2, s3] = validateState(stateWords);
  let draws = 0;

  function nextU32() {
    const result = Math.imul(rotl32(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl32(s3, 11);
    draws += 1;
    return result;
  }

  function int(maxExclusive) {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
      throw new RangeError('RNG int(maxExclusive) requires an integer from 1 through 2^32');
    }
    if (maxExclusive === UINT32_RANGE) return nextU32();
    const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
    let value;
    do { value = nextU32(); } while (value >= limit);
    return value % maxExclusive;
  }

  const generator = {
    name,
    canonical,
    algorithm: RNG_ALGORITHM,
    seed: seedHex,
    get draws() { return draws; },
    nextU32,
    float: () => nextU32() / UINT32_RANGE,
    int,
    range(minInclusive, maxExclusive) {
      if (!Number.isSafeInteger(minInclusive) || !Number.isSafeInteger(maxExclusive) || maxExclusive <= minInclusive) {
        throw new RangeError('RNG range requires safe-integer bounds with maxExclusive > minInclusive');
      }
      const span = maxExclusive - minInclusive;
      if (span > UINT32_RANGE) throw new RangeError('RNG range width must not exceed 2^32');
      return minInclusive + int(span);
    },
    pick(values) {
      if (!Array.isArray(values) || values.length === 0) throw new RangeError('RNG pick requires a non-empty array');
      return values[int(values.length)];
    },
    snapshot: () => ({ algorithm: RNG_ALGORITHM, draws, state: [s0, s1, s2, s3] }),
    restore(snapshot) {
      if (snapshot?.algorithm && snapshot.algorithm !== RNG_ALGORITHM) {
        throw new RangeError(`Cannot restore RNG algorithm ${snapshot.algorithm}`);
      }
      [s0, s1, s2, s3] = validateState(snapshot);
      const restoredDraws = Array.isArray(snapshot) ? 0 : (snapshot?.draws ?? 0);
      if (!Number.isSafeInteger(restoredDraws) || restoredDraws < 0) {
        throw new TypeError('RNG snapshot draws must be a non-negative safe integer');
      }
      draws = restoredDraws;
      return generator;
    },
  };
  return Object.freeze(generator);
}

export function normalizeSeed(seed) {
  return `0x${seedToBigInt(seed).toString(16).padStart(16, '0')}`;
}

export function isCanonicalStream(name) {
  return name === 'rules' || name.startsWith('ai:');
}

export function createRngSuite({
  algorithm = RNG_ALGORITHM,
  seed,
  streams = DEFAULT_RNG_STREAMS,
} = {}) {
  if (algorithm !== RNG_ALGORITHM) throw new RangeError(`Unsupported RNG algorithm: ${algorithm}`);
  if (!Array.isArray(streams) || streams.length === 0) throw new TypeError('RNG streams must be a non-empty array');
  const names = streams.map((name) => {
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('RNG stream names must be non-empty strings');
    return name.trim();
  });
  if (new Set(names).size !== names.length) throw new RangeError('RNG stream names must be unique');

  const rootSeed = seedToBigInt(seed);
  const seedHex = normalizeSeed(rootSeed);
  const generators = Object.fromEntries(names.map((name) => [
    name,
    createGenerator(name, isCanonicalStream(name), seedHex, initialState(rootSeed, name)),
  ]));
  Object.freeze(generators);

  return Object.freeze({
    algorithm,
    seed: seedHex,
    streams: generators,
    stream(name) {
      const generator = generators[name];
      if (!generator) throw new RangeError(`Unknown RNG stream: ${name}`);
      return generator;
    },
    snapshot({ canonicalOnly = false } = {}) {
      return Object.fromEntries(names
        .filter((name) => !canonicalOnly || generators[name].canonical)
        .map((name) => [name, generators[name].snapshot()]));
    },
    restore(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') throw new TypeError('RNG suite snapshot must be an object');
      for (const [name, state] of Object.entries(snapshot)) this.stream(name).restore(state);
      return this;
    },
  });
}
