// Compact, checksummed #c= challenge links. Decode is deliberately total: malformed input returns null.
// Byte-identical across games (drift-guarded).
import { stableStringify } from './state-hash.js';

export const CHALLENGE_LINK_VERSION = 1;
export const MAX_CHALLENGE_HASH = 1800;
export const MAX_CHALLENGE_JSON = 4096;
export const MAX_CHALLENGE_COMPRESSED = 1300;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const SAFE_KEY = /^[A-Za-z0-9_.-]{1,96}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

function assertParams(value, path = 'challenge.params', depth = 0, budget = { nodes: 0 }) {
  budget.nodes += 1;
  if (budget.nodes > 256 || depth > 6) throw new RangeError('challenge params are too complex');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
    return;
  }
  if (typeof value === 'string') {
    if (value.length > 256) throw new RangeError(`${path} string is too long`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 64) throw new RangeError(`${path} array is too long`);
    value.forEach((item, index) => assertParams(item, `${path}[${index}]`, depth + 1, budget));
    return;
  }
  if (!isPlainObject(value) || Object.keys(value).length > 64) throw new TypeError(`${path} must contain plain data`);
  for (const [key, item] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key) || key.length > 64) throw new TypeError(`${path} contains an unsafe key`);
    assertParams(item, `${path}.${key}`, depth + 1, budget);
  }
}

export function validateChallenge(value) {
  if (!isPlainObject(value)) throw new TypeError('challenge must be a plain object');
  const allowed = new Set(['game', 'puzzleId', 'seed', 'ruleset', 'params']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`unknown challenge field: ${key}`);
  if (typeof value.game !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(value.game)) {
    throw new TypeError('challenge.game must be a short lowercase id');
  }
  const hasPuzzle = Object.hasOwn(value, 'puzzleId');
  const hasSeed = Object.hasOwn(value, 'seed');
  if (hasPuzzle === hasSeed) throw new TypeError('challenge requires exactly one of puzzleId or seed');
  if (hasPuzzle && (typeof value.puzzleId !== 'string' || !SAFE_KEY.test(value.puzzleId))) {
    throw new TypeError('challenge.puzzleId is invalid');
  }
  if (hasSeed) {
    const validSeed = (typeof value.seed === 'string' && value.seed.length > 0 && value.seed.length <= 128)
      || (typeof value.seed === 'number' && Number.isFinite(value.seed));
    if (!validSeed) throw new TypeError('challenge.seed is invalid');
  }
  if (value.ruleset !== undefined) {
    const version = value.ruleset?.version;
    const validVersion = (typeof version === 'string' && version.length > 0 && version.length <= 64)
      || (typeof version === 'number' && Number.isSafeInteger(version) && version >= 0);
    if (!isPlainObject(value.ruleset) || !SAFE_KEY.test(value.ruleset.id) || !validVersion) {
      throw new TypeError('challenge.ruleset must be { id, version }');
    }
    if (Object.keys(value.ruleset).some((key) => !['id', 'version'].includes(key))) {
      throw new TypeError('challenge.ruleset contains unknown fields');
    }
  }
  if (value.params !== undefined) assertParams(value.params);
  return true;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

function base64urlEncode(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64urlDecode(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new TypeError('invalid base64url');
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function transform(bytes, format, decompress = false, limit = Infinity) {
  const Ctor = decompress ? globalThis.DecompressionStream : globalThis.CompressionStream;
  if (typeof Ctor !== 'function') throw new Error(`${decompress ? 'Decompression' : 'Compression'}Stream unavailable`);
  const reader = new Blob([bytes]).stream().pipeThrough(new Ctor(format)).getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new RangeError('challenge payload exceeds its decoded size cap');
    }
    chunks.push(value);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

export async function encode(challenge) {
  validateChallenge(challenge);
  const json = stableStringify(challenge);
  const plain = encoder.encode(json);
  if (plain.byteLength > MAX_CHALLENGE_JSON) throw new RangeError('challenge JSON is too large');
  const compressed = await transform(plain, 'deflate');
  if (compressed.byteLength > MAX_CHALLENGE_COMPRESSED) throw new RangeError('compressed challenge is too large');
  const token = `${CHALLENGE_LINK_VERSION}.${base64urlEncode(compressed)}.${crc32(compressed)}`;
  const hash = `#c=${token}`;
  if (hash.length > MAX_CHALLENGE_HASH) throw new RangeError('challenge link is too long');
  return hash;
}

export async function decode(hash) {
  try {
    if (typeof hash !== 'string' || hash.length > MAX_CHALLENGE_HASH) return null;
    const token = hash.startsWith('#c=') ? hash.slice(3) : (hash.startsWith('c=') ? hash.slice(2) : null);
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== String(CHALLENGE_LINK_VERSION) || !/^[0-9a-f]{8}$/.test(parts[2])) return null;
    const compressed = base64urlDecode(parts[1]);
    if (!compressed.length || compressed.byteLength > MAX_CHALLENGE_COMPRESSED) return null;
    if (crc32(compressed) !== parts[2]) return null;
    const plain = await transform(compressed, 'deflate', true, MAX_CHALLENGE_JSON);
    const challenge = JSON.parse(decoder.decode(plain));
    validateChallenge(challenge);
    return JSON.parse(stableStringify(challenge));
  } catch {
    return null;
  }
}
