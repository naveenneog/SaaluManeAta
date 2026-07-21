// Stable state serialization + xxHash64 for replay verification and deterministic checkpoints.
// Keep this module dependency-free and byte-identical across games.
export const STATE_HASH_ALGORITHM = 'xxh64-v1';

const MASK64 = (1n << 64n) - 1n;
const PRIME1 = 11400714785074694791n;
const PRIME2 = 14029467366897019727n;
const PRIME3 = 1609587929392839161n;
const PRIME4 = 9650029242287828579n;
const PRIME5 = 2870177450012600261n;
const encoder = new TextEncoder();

const u64 = (value) => value & MASK64;
const rotl64 = (value, bits) => u64((value << BigInt(bits)) | (value >> BigInt(64 - bits)));

function read32(bytes, offset) {
  return BigInt(bytes[offset])
    | (BigInt(bytes[offset + 1]) << 8n)
    | (BigInt(bytes[offset + 2]) << 16n)
    | (BigInt(bytes[offset + 3]) << 24n);
}

function read64(bytes, offset) {
  return read32(bytes, offset) | (read32(bytes, offset + 4) << 32n);
}

function round(accumulator, lane) {
  let value = u64(accumulator + u64(lane * PRIME2));
  value = rotl64(value, 31);
  return u64(value * PRIME1);
}

function mergeRound(accumulator, lane) {
  let value = accumulator ^ round(0n, lane);
  value = u64(value * PRIME1 + PRIME4);
  return value;
}

function bytesOf(input) {
  if (typeof input === 'string') return encoder.encode(input);
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('xxh64 input must be a string, ArrayBuffer, or byte view');
}

export function xxh64(input, seed = 0n) {
  const bytes = bytesOf(input);
  const length = bytes.length;
  const hashSeed = u64(typeof seed === 'bigint' ? seed : BigInt(seed));
  let offset = 0;
  let hash;

  if (length >= 32) {
    let v1 = u64(hashSeed + PRIME1 + PRIME2);
    let v2 = u64(hashSeed + PRIME2);
    let v3 = hashSeed;
    let v4 = u64(hashSeed - PRIME1);
    const limit = length - 32;
    while (offset <= limit) {
      v1 = round(v1, read64(bytes, offset)); offset += 8;
      v2 = round(v2, read64(bytes, offset)); offset += 8;
      v3 = round(v3, read64(bytes, offset)); offset += 8;
      v4 = round(v4, read64(bytes, offset)); offset += 8;
    }
    hash = u64(rotl64(v1, 1) + rotl64(v2, 7) + rotl64(v3, 12) + rotl64(v4, 18));
    hash = mergeRound(hash, v1);
    hash = mergeRound(hash, v2);
    hash = mergeRound(hash, v3);
    hash = mergeRound(hash, v4);
  } else {
    hash = u64(hashSeed + PRIME5);
  }

  hash = u64(hash + BigInt(length));
  while (offset + 8 <= length) {
    const lane = round(0n, read64(bytes, offset));
    hash ^= lane;
    hash = u64(rotl64(hash, 27) * PRIME1 + PRIME4);
    offset += 8;
  }
  if (offset + 4 <= length) {
    hash ^= u64(read32(bytes, offset) * PRIME1);
    hash = u64(rotl64(hash, 23) * PRIME2 + PRIME3);
    offset += 4;
  }
  while (offset < length) {
    hash ^= u64(BigInt(bytes[offset]) * PRIME5);
    hash = u64(rotl64(hash, 11) * PRIME1);
    offset += 1;
  }

  hash ^= hash >> 33n;
  hash = u64(hash * PRIME2);
  hash ^= hash >> 29n;
  hash = u64(hash * PRIME3);
  hash ^= hash >> 32n;
  return u64(hash).toString(16).padStart(16, '0');
}

function serialize(value, seen, arrayItem = false) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'bigint') throw new TypeError('Canonical state cannot contain bigint values');
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return arrayItem ? 'null' : undefined;
  }
  if (typeof value !== 'object') throw new TypeError(`Unsupported canonical state value: ${typeof value}`);
  if (seen.has(value)) throw new TypeError('Canonical state cannot contain cycles');
  seen.add(value);

  let result;
  if (Array.isArray(value)) {
    const items = Array.from({ length: value.length }, (_, index) => serialize(value[index], seen, true) ?? 'null');
    result = `[${items.join(',')}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      seen.delete(value);
      throw new TypeError('Canonical state objects must be plain objects');
    }
    const entries = [];
    for (const key of Object.keys(value).sort()) {
      const item = serialize(value[key], seen, false);
      if (item !== undefined) entries.push(`${JSON.stringify(key)}:${item}`);
    }
    result = `{${entries.join(',')}}`;
  }
  seen.delete(value);
  return result;
}

export function stableStringify(state) {
  const result = serialize(state, new Set(), false);
  if (result === undefined) throw new TypeError('Canonical state must be JSON-serializable');
  return result;
}

export function hashState(state) {
  return xxh64(stableStringify(state));
}
