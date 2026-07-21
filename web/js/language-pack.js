// language-pack.js — dependency-free, transactional installer for trusted text/voice packs.
// Byte-identical shared module: games inject their trusted index, CacheStorage and atomic pointer DB.

export const LANGUAGE_PACK_SCHEMA = 1;
export const LANGUAGE_INDEX_FORMAT = 'tbg-language-index';
export const LANGUAGE_PACK_FORMAT = 'tbg-language-pack';

const GAMES = new Set(['ah', 'am', 'cb', 'sma']);
const COMPONENTS = new Set(['text', 'voice']);
const TEXT_ROLES = new Set([
  'ui', 'world', 'campaign', 'puzzle', 'recap',
  'achievement', 'share', 'provenance', 'glossary', 'tutorial',
]);
const VOICE_ROLES = new Set(['voice-manifest', 'voice']);
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm']);
const HASH = /^[a-f0-9]{64}$/;
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/;
const VERSION = /^(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})(?:-[0-9A-Za-z.-]{1,48})?$/;
const CONTENT_ID = /^[a-z][a-z0-9]*(?:\.[a-z0-9][a-z0-9_-]*){2,}$/;
const VOICE_SCOPE = /^[a-z][a-z0-9-]{0,63}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_PACK_BYTES = 256 * 1024 * 1024;
const MAX_JSON_NODES = 100000;
const MAX_JSON_DEPTH = 20;
const POINTER_SCHEMA = 1;
let cacheSequence = 0;

export class LanguagePackError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'LanguagePackError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => {
  throw new LanguagePackError(code, message, details);
};

const plain = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function exactObject(value, required, optional, label) {
  if (!plain(value)) fail('invalid-manifest', `${label} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key) || !allowed.has(key)) fail('invalid-manifest', `${label} has unknown field ${key}`);
  }
  for (const key of required) {
    if (!own(value, key)) fail('invalid-manifest', `${label} is missing ${key}`);
  }
}

function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail('invalid-manifest', `${label} must be an integer from ${min} to ${max}`);
  }
}

function boundedString(value, pattern, max, label) {
  if (typeof value !== 'string' || value.length > max || !pattern.test(value)) {
    fail('invalid-manifest', `${label} is invalid`);
  }
}

function safeData(value, { maxDepth = MAX_JSON_DEPTH, maxNodes = MAX_JSON_NODES } = {}) {
  let nodes = 0;
  const visit = (node, depth) => {
    nodes += 1;
    if (nodes > maxNodes || depth > maxDepth) fail('invalid-manifest', 'manifest structure is too large');
    if (typeof node === 'string') {
      if (node.length > 1048576) fail('invalid-manifest', 'manifest string is too large');
      assertUnicodeScalar(node);
      return;
    }
    if (node === null || typeof node === 'boolean') return;
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) fail('invalid-manifest', 'manifest contains a non-finite number');
      return;
    }
    if (Array.isArray(node)) {
      if (node.length > 4096) fail('invalid-manifest', 'manifest array is too large');
      node.forEach(item => visit(item, depth + 1));
      return;
    }
    if (!plain(node)) fail('invalid-manifest', 'manifest contains a non-JSON value');
    for (const [key, child] of Object.entries(node)) {
      if (UNSAFE_KEYS.has(key) || key.length > 256) fail('invalid-manifest', `unsafe manifest key ${key}`);
      assertUnicodeScalar(key);
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return true;
}

function assertUnicodeScalar(text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) fail('invalid-manifest', 'text contains an unpaired surrogate');
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail('invalid-manifest', 'text contains an unpaired surrogate');
    }
  }
}

function packPrefix(game, language, contentVersion) {
  return `packs/${game}/${language}/${contentVersion}/`;
}

function validateIndexEntry(entry, game, coreLanguages, seen) {
  exactObject(entry, [
    'language', 'component', 'version', 'contentVersion', 'manifestPath',
    'manifestBytes', 'manifestSha256', 'packBytes', 'packSha256',
  ], [], 'language index entry');
  boundedString(entry.language, LANGUAGE, 24, 'entry.language');
  if (coreLanguages.has(entry.language)) fail('invalid-index', 'trusted index must not package a core language');
  if (!COMPONENTS.has(entry.component)) fail('invalid-index', 'entry.component is invalid');
  boundedString(entry.version, VERSION, 72, 'entry.version');
  integer(entry.contentVersion, 1, 2147483647, 'entry.contentVersion');
  const prefix = packPrefix(game, entry.language, entry.contentVersion);
  const expectedManifest = `${prefix}${entry.component}.manifest.json`;
  if (entry.manifestPath !== expectedManifest) fail('invalid-index', `entry.manifestPath must be ${expectedManifest}`);
  integer(entry.manifestBytes, 2, MAX_MANIFEST_BYTES, 'entry.manifestBytes');
  boundedString(entry.manifestSha256, HASH, 64, 'entry.manifestSha256');
  integer(entry.packBytes, 2, MAX_PACK_BYTES, 'entry.packBytes');
  boundedString(entry.packSha256, HASH, 64, 'entry.packSha256');
  const tuple = `${entry.language}\0${entry.component}\0${entry.version}\0${entry.contentVersion}`;
  if (seen.has(tuple)) fail('invalid-index', 'language index contains a duplicate component tuple');
  seen.add(tuple);
}

export function validateLanguageIndex(index, { game } = {}) {
  safeData(index);
  exactObject(index, ['format', 'schema', 'game', 'defaultLanguage', 'coreLanguages', 'packs'], [], 'language index');
  if (index.format !== LANGUAGE_INDEX_FORMAT || index.schema !== LANGUAGE_PACK_SCHEMA) {
    fail('invalid-index', 'unsupported language index format');
  }
  if (!GAMES.has(index.game) || (game && index.game !== game)) fail('invalid-index', 'language index game mismatch');
  if (index.defaultLanguage !== 'en') fail('invalid-index', 'default language must be English');
  if (!Array.isArray(index.coreLanguages) || index.coreLanguages.length < 1 || index.coreLanguages.length > 4) {
    fail('invalid-index', 'coreLanguages must contain 1 to 4 languages');
  }
  const core = new Set();
  for (const language of index.coreLanguages) {
    boundedString(language, LANGUAGE, 24, 'core language');
    if (core.has(language)) fail('invalid-index', 'coreLanguages must be unique');
    core.add(language);
  }
  if (!core.has('en')) fail('invalid-index', 'coreLanguages must include English');
  if (!Array.isArray(index.packs) || index.packs.length < 1 || index.packs.length > 64) {
    fail('invalid-index', 'trusted index must contain 1 to 64 pack entries');
  }
  const seen = new Set();
  index.packs.forEach(entry => validateIndexEntry(entry, index.game, core, seen));
  for (const entry of index.packs) {
    if (entry.component !== 'voice') continue;
    const text = index.packs.some(candidate =>
      candidate.language === entry.language
      && candidate.component === 'text'
      && candidate.version === entry.version
      && candidate.contentVersion === entry.contentVersion);
    if (!text) fail('invalid-index', `voice pack ${entry.language} has no matching text component`);
  }
  return true;
}

function validateFile(file, manifest, seenPaths, seenContentIds) {
  exactObject(file, ['path', 'role', 'mediaType', 'bytes', 'sha256'], [
    'contentId', 'durationMs', 'voiceId',
  ], 'language pack file');
  const prefix = packPrefix(manifest.game, manifest.language, manifest.contentVersion);
  if (typeof file.path !== 'string' || file.path.length > 256 || !file.path.startsWith(prefix)
      || file.path.includes('..') || file.path.includes('//') || /[?#\\]/.test(file.path)) {
    fail('invalid-manifest', `unsafe pack file path ${file.path}`);
  }
  if (seenPaths.has(file.path)) fail('invalid-manifest', `duplicate pack file ${file.path}`);
  seenPaths.add(file.path);
  integer(file.bytes, 2, MAX_FILE_BYTES, `${file.path}.bytes`);
  boundedString(file.sha256, HASH, 64, `${file.path}.sha256`);

  if (manifest.component === 'text') {
    if (!TEXT_ROLES.has(file.role) || file.mediaType !== 'application/json' || !file.path.endsWith('.json')) {
      fail('invalid-manifest', `text pack file ${file.path} has an invalid role, type, or extension`);
    }
    if (own(file, 'contentId') || own(file, 'durationMs') || own(file, 'voiceId')) {
      fail('invalid-manifest', `text pack file ${file.path} has voice-only fields`);
    }
    return;
  }

  if (!VOICE_ROLES.has(file.role)) fail('invalid-manifest', `voice pack file ${file.path} has an invalid role`);
  if (file.role === 'voice-manifest') {
    if (file.mediaType !== 'application/json' || !file.path.endsWith('.json')
        || own(file, 'contentId') || own(file, 'durationMs') || own(file, 'voiceId')) {
      fail('invalid-manifest', 'voice manifest file is invalid');
    }
    return;
  }
  if (!AUDIO_TYPES.has(file.mediaType)) fail('invalid-manifest', `voice file ${file.path} has an invalid media type`);
  const extension = file.mediaType === 'audio/mpeg' ? '.mp3' : `.${file.mediaType.split('/')[1]}`;
  if (!file.path.endsWith(extension)) fail('invalid-manifest', `voice file ${file.path} extension does not match its type`);
  boundedString(file.contentId, CONTENT_ID, 160, `${file.path}.contentId`);
  integer(file.durationMs, 1, 600000, `${file.path}.durationMs`);
  if (typeof file.voiceId !== 'string' || file.voiceId.length > 80
      || !/^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(file.voiceId)) {
    fail('invalid-manifest', `${file.path}.voiceId is invalid`);
  }
  if (seenContentIds.has(file.contentId)) fail('invalid-manifest', `duplicate voice content id ${file.contentId}`);
  seenContentIds.add(file.contentId);
}

export function validateLanguageManifest(manifest, {
  game,
  language,
  component,
  entry,
  maxPackBytes = MAX_PACK_BYTES,
} = {}) {
  safeData(manifest);
  exactObject(manifest, [
    'format', 'schema', 'game', 'language', 'version', 'contentVersion',
    'component', 'fallbackLanguage', 'bytes', 'sha256', 'files',
  ], [], 'language pack manifest');
  if (manifest.format !== LANGUAGE_PACK_FORMAT || manifest.schema !== LANGUAGE_PACK_SCHEMA) {
    fail('invalid-manifest', 'unsupported language pack format');
  }
  if (!GAMES.has(manifest.game) || (game && manifest.game !== game)) fail('invalid-manifest', 'pack game mismatch');
  boundedString(manifest.language, LANGUAGE, 24, 'manifest.language');
  if (language && manifest.language !== language) fail('invalid-manifest', 'pack language mismatch');
  boundedString(manifest.version, VERSION, 72, 'manifest.version');
  integer(manifest.contentVersion, 1, 2147483647, 'manifest.contentVersion');
  if (!COMPONENTS.has(manifest.component) || (component && manifest.component !== component)) {
    fail('invalid-manifest', 'pack component mismatch');
  }
  if (manifest.component === 'voice') {
    if (manifest.fallbackLanguage !== null) fail('invalid-manifest', 'voice packs cannot fall back to another pack');
  } else if (manifest.language === 'en') {
    if (manifest.fallbackLanguage !== null) fail('invalid-manifest', 'English text cannot have a fallback pack');
  } else if (manifest.fallbackLanguage !== 'en') {
    fail('invalid-manifest', 'non-English text must fall back to English');
  }
  integer(maxPackBytes, 2, MAX_PACK_BYTES, 'maxPackBytes');
  integer(manifest.bytes, 2, maxPackBytes, 'manifest.bytes');
  boundedString(manifest.sha256, HASH, 64, 'manifest.sha256');
  if (!Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 4096) {
    fail('invalid-manifest', 'manifest.files must contain 1 to 4096 files');
  }
  const paths = new Set();
  const contentIds = new Set();
  manifest.files.forEach(file => validateFile(file, manifest, paths, contentIds));
  const sum = manifest.files.reduce((total, file) => total + file.bytes, 0);
  if (!Number.isSafeInteger(sum) || sum !== manifest.bytes) fail('invalid-manifest', 'manifest byte total is inconsistent');
  if (manifest.component === 'text' && !manifest.files.some(file => file.role === 'ui')) {
    fail('coverage', 'text pack must contain a UI catalog');
  }
  if (manifest.component === 'voice'
      && manifest.files.filter(file => file.role === 'voice-manifest').length !== 1) {
    fail('coverage', 'voice pack must contain exactly one voice manifest');
  }
  if (entry) {
    for (const key of ['language', 'component', 'version', 'contentVersion']) {
      if (manifest[key] !== entry[key]) fail('index-mismatch', `manifest ${key} does not match the trusted index`);
    }
    if (manifest.bytes !== entry.packBytes || manifest.sha256 !== entry.packSha256) {
      fail('index-mismatch', 'manifest size or payload hash does not match the trusted index');
    }
  }
  return true;
}

export function canonicalizeJson(value) {
  safeData(value);
  const encode = node => {
    if (node === null || typeof node === 'boolean' || typeof node === 'string') return JSON.stringify(node);
    if (typeof node === 'number') return JSON.stringify(node);
    if (Array.isArray(node)) return `[${node.map(encode).join(',')}]`;
    return `{${Object.keys(node).sort().map(key => `${JSON.stringify(key)}:${encode(node[key])}`).join(',')}}`;
  };
  return encode(value);
}

const asBytes = value => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  throw new TypeError('hash input must be bytes or text');
};

export async function sha256Hex(value, { cryptoImpl = globalThis.crypto } = {}) {
  if (typeof cryptoImpl?.subtle?.digest !== 'function') fail('crypto-unavailable', 'Web Crypto SHA-256 is unavailable');
  const digest = await cryptoImpl.subtle.digest('SHA-256', asBytes(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function voiceContentId(scope, text, options) {
  if (typeof scope !== 'string' || !VOICE_SCOPE.test(scope)) {
    throw new TypeError('voice scope must be a canonical world id or ui');
  }
  if (typeof text !== 'string' || !text || text.length > 10000) {
    throw new TypeError('voice text must be a non-empty bounded string');
  }
  assertUnicodeScalar(text);
  return `voice.${scope}.${await sha256Hex(text, options)}`;
}

export async function hashLanguageManifest(manifest, options) {
  if (!plain(manifest)) fail('invalid-manifest', 'manifest must be an object');
  const payload = { ...manifest };
  delete payload.sha256;
  return sha256Hex(new TextEncoder().encode(canonicalizeJson(payload)), options);
}

function schemaPointer(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) fail('schema', 'runtime schema uses a non-local reference');
  let value = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!plain(value) || !own(value, key)) fail('schema', `runtime schema reference ${ref} is missing`);
    value = value[key];
  }
  return value;
}

function schemaErrors(root, schema, value, location = '$', depth = 0) {
  if (depth > 80 || !plain(schema)) return [`${location}: invalid runtime schema`];
  const errors = [];
  const childErrors = child => schemaErrors(root, child, value, location, depth + 1);
  if (schema.$ref) errors.push(...childErrors(schemaPointer(root, schema.$ref)));
  if (Array.isArray(schema.allOf)) schema.allOf.forEach(child => errors.push(...childErrors(child)));
  if (Array.isArray(schema.oneOf)
      && schema.oneOf.filter(child => childErrors(child).length === 0).length !== 1) {
    errors.push(`${location}: oneOf failed`);
  }
  if (Array.isArray(schema.anyOf)
      && !schema.anyOf.some(child => childErrors(child).length === 0)) {
    errors.push(`${location}: anyOf failed`);
  }
  if (schema.not && childErrors(schema.not).length === 0) errors.push(`${location}: forbidden shape`);
  if (schema.if) {
    const branch = childErrors(schema.if).length === 0 ? schema.then : schema.else;
    if (branch) errors.push(...childErrors(branch));
  }
  if (own(schema, 'const') && !Object.is(value, schema.const)) errors.push(`${location}: const failed`);
  if (Array.isArray(schema.enum) && !schema.enum.some(item => Object.is(item, value))) {
    errors.push(`${location}: enum failed`);
  }
  const typeMatches = type => {
    if (type === 'null') return value === null;
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return plain(value);
    if (type === 'integer') return Number.isSafeInteger(value);
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    return typeof value === type;
  };
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(typeMatches)) return [...errors, `${location}: type failed`];
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength != null && length < schema.minLength) errors.push(`${location}: minLength failed`);
    if (schema.maxLength != null && length > schema.maxLength) errors.push(`${location}: maxLength failed`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${location}: pattern failed`);
  } else if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${location}: minimum failed`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${location}: maximum failed`);
  } else if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${location}: minItems failed`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${location}: maxItems failed`);
    if (schema.uniqueItems) {
      const keys = value.map(item => canonicalizeJson(item));
      if (new Set(keys).size !== keys.length) errors.push(`${location}: uniqueItems failed`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...schemaErrors(root, schema.items, item, `${location}[${index}]`, depth + 1));
      });
    }
    if (schema.contains && !value.some((item, index) =>
      schemaErrors(root, schema.contains, item, `${location}[${index}]`, depth + 1).length === 0)) {
      errors.push(`${location}: contains failed`);
    }
  } else if (plain(value)) {
    for (const key of schema.required ?? []) {
      if (!own(value, key)) errors.push(`${location}: missing ${key}`);
    }
    if (schema.additionalProperties === false && plain(schema.properties)) {
      for (const key of Object.keys(value)) {
        if (!own(schema.properties, key)) errors.push(`${location}: unknown ${key}`);
      }
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (own(value, key)) errors.push(...schemaErrors(root, child, value[key], `${location}.${key}`, depth + 1));
    }
  }
  return errors;
}

export function validateLanguagePackSchema(schema, value) {
  if (!plain(schema)
      || schema.$schema !== 'https://json-schema.org/draft/2020-12/schema'
      || !String(schema.$id ?? '').endsWith('/language-pack.schema.json')) {
    fail('schema', 'invalid bundled language-pack schema');
  }
  safeData(value);
  const errors = schemaErrors(schema, schema, value);
  if (errors.length) fail('invalid-manifest', errors[0], { errors: errors.slice(0, 32) });
  return true;
}

function abortError() {
  return new LanguagePackError('aborted', 'language pack operation was aborted');
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}

async function readBoundedResponse(response, {
  expectedBytes,
  maxBytes,
  signal,
  label,
} = {}) {
  checkAbort(signal);
  if (!response || response.ok !== true) {
    fail('fetch-failed', `${label} request failed${response?.status ? ` (${response.status})` : ''}`);
  }
  const header = response.headers?.get?.('content-length');
  if (header != null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(header)) fail('size-mismatch', `${label} has an invalid Content-Length`);
    const announced = Number(header);
    if (expectedBytes != null && announced !== expectedBytes) fail('size-mismatch', `${label} Content-Length is inconsistent`);
    if (!Number.isSafeInteger(announced) || announced > maxBytes) fail('oversized', `${label} exceeds its byte cap`);
  }

  const chunks = [];
  let total = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try {
      while (true) {
        checkAbort(signal);
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = asBytes(value);
        total += chunk.byteLength;
        if (total > maxBytes || (expectedBytes != null && total > expectedBytes)) {
          try { await reader.cancel(); } catch { /* best effort */ }
          fail('oversized', `${label} exceeds its byte cap`);
        }
        chunks.push(chunk);
      }
    } catch (error) {
      if (signal?.aborted) throw abortError();
      throw error;
    }
  } else {
    const chunk = new Uint8Array(await response.arrayBuffer());
    total = chunk.byteLength;
    if (total > maxBytes || (expectedBytes != null && total > expectedBytes)) {
      fail('oversized', `${label} exceeds its byte cap`);
    }
    chunks.push(chunk);
  }
  if (expectedBytes != null && total !== expectedBytes) fail('size-mismatch', `${label} is truncated or oversized`);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseJson(bytes, label) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('invalid-json', `${label} is not valid UTF-8`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail('invalid-json', `${label} is not valid JSON`);
  }
}

function validateCatalog(catalog, label) {
  if (!plain(catalog)) fail('coverage', `${label} must contain a JSON object`);
  const entries = Object.entries(catalog);
  if (entries.length < 1 || entries.length > 20000) fail('coverage', `${label} has invalid entry coverage`);
  for (const [key, value] of entries) {
    if (!key || key.length > 300 || UNSAFE_KEYS.has(key)
        || typeof value !== 'string' || !value || value.length > 10000) {
      fail('coverage', `${label} contains an invalid translation entry`);
    }
  }
}

function validateVoiceMap(map, manifest) {
  if (!plain(map)) fail('coverage', 'voice manifest must contain a JSON object');
  const entries = Object.entries(map);
  const voices = manifest.files.filter(file => file.role === 'voice');
  if (entries.length !== voices.length || entries.length > 4096) {
    fail('coverage', 'voice manifest does not cover the declared voice files');
  }
  const expected = new Map(voices.map(file => [file.contentId, file.path]));
  for (const [contentId, path] of entries) {
    if (!CONTENT_ID.test(contentId) || expected.get(contentId) !== path) {
      fail('coverage', `voice manifest entry ${contentId} is invalid`);
    }
  }
}

export function validateTextCatalogCoverage({
  language,
  catalogs,
  requiredByRole = {},
  requiredByPath = {},
  englishByRole = {},
  englishByPath = {},
  allowEnglishEcho = [],
} = {}) {
  boundedString(language, LANGUAGE, 24, 'coverage language');
  if (!plain(catalogs) || !plain(catalogs.byRole) || !plain(catalogs.byPath) || !plain(catalogs.merged)) {
    fail('coverage', 'coverage validation requires loaded text catalogs');
  }
  if (!plain(requiredByRole) || !plain(requiredByPath) || !plain(englishByRole) || !plain(englishByPath)
      || !Array.isArray(allowEnglishEcho) || allowEnglishEcho.length > 4096) {
    fail('coverage', 'coverage requirements are invalid');
  }
  const allowed = new Set(allowEnglishEcho);
  const validateKeys = (maps, keys, english, scope) => {
    if (!Array.isArray(keys) || keys.length > 20000 || !Array.isArray(maps) || !maps.length) {
      fail('coverage', `coverage scope ${scope} is invalid or missing`);
    }
    const unique = new Set();
    for (const key of keys) {
      if (typeof key !== 'string' || !key || key.length > 300 || unique.has(key)) {
        fail('coverage', `coverage key ${key} is invalid`);
      }
      unique.add(key);
      const translations = maps.filter(map => plain(map) && own(map, key)).map(map => map[key]);
      if (!translations.length || translations.some(value => typeof value !== 'string' || !value)) {
        fail('coverage', `text pack is missing ${scope}:${key}`);
      }
      const source = english?.[key];
      if (language !== 'en' && typeof source === 'string' && source && !allowed.has(key)
          && translations.some(value => value === source)) {
        fail('coverage', `text pack echoes English for ${scope}:${key}`);
      }
    }
  };
  for (const [role, keys] of Object.entries(requiredByRole)) {
    if (!TEXT_ROLES.has(role)) fail('coverage', `coverage role ${role} is invalid`);
    const paths = catalogs.byRole[role];
    validateKeys(paths?.map(path => catalogs.byPath[path]), keys, englishByRole[role], role);
  }
  for (const [path, keys] of Object.entries(requiredByPath)) {
    validateKeys([catalogs.byPath[path]], keys, englishByPath[path], path);
  }
  return true;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function pointerKey(game, language, component) {
  return `tbg.language-pack.${game}.${language}.${component}`;
}

function validatePointer(pointer, entry, game) {
  exactObject(pointer, [
    'schema', 'game', 'language', 'component', 'version', 'contentVersion',
    'cacheName', 'manifestPath', 'manifestSha256', 'packSha256', 'bytes', 'installedAt',
  ], [], 'language pack pointer');
  if (pointer.schema !== POINTER_SCHEMA || pointer.game !== game) fail('corrupt', 'installed pointer header is invalid');
  for (const key of ['language', 'component', 'version', 'contentVersion']) {
    if (pointer[key] !== entry[key]) fail('corrupt', `installed pointer ${key} is stale`);
  }
  if (pointer.manifestPath !== entry.manifestPath
      || pointer.manifestSha256 !== entry.manifestSha256
      || pointer.packSha256 !== entry.packSha256
      || pointer.bytes !== entry.packBytes) {
    fail('corrupt', 'installed pointer does not match the trusted index');
  }
  if (typeof pointer.cacheName !== 'string' || pointer.cacheName.length > 240
      || !pointer.cacheName.startsWith(`tbg-lp:${game}:`)) {
    fail('corrupt', 'installed pointer cache name is invalid');
  }
  integer(pointer.installedAt, 0, Number.MAX_SAFE_INTEGER, 'pointer.installedAt');
}

function dbAdapter(db) {
  if (!db || typeof db.get !== 'function') throw new TypeError('initLanguagePacks requires db.get');
  const put = db.put ?? db.set;
  const remove = db.delete ?? db.remove;
  if (typeof put !== 'function' || typeof remove !== 'function') {
    throw new TypeError('language pack db requires put/set and delete/remove');
  }
  return {
    get: key => db.get(key),
    put: (key, value) => put.call(db, key, value),
    delete: key => remove.call(db, key),
    keys: typeof db.keys === 'function' ? prefix => db.keys(prefix) : async () => [],
  };
}

export function openLanguagePackDb({
  indexedDBImpl = globalThis.indexedDB,
  name = 'tbg-language-packs',
  storeName = 'pointers',
} = {}) {
  if (!indexedDBImpl?.open) return Promise.reject(new LanguagePackError('storage-unavailable', 'IndexedDB is unavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDBImpl.open(name, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onsuccess = () => {
      const database = request.result;
      const run = (mode, operation) => new Promise((ok, bad) => {
        let result;
        const transaction = database.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        try { result = operation(store); } catch (error) { bad(error); return; }
        transaction.oncomplete = () => ok(result?.result);
        transaction.onerror = () => bad(transaction.error ?? result?.error ?? new Error('IndexedDB transaction failed'));
        transaction.onabort = () => bad(transaction.error ?? new Error('IndexedDB transaction aborted'));
      });
      resolve(Object.freeze({
        get: key => run('readonly', store => store.get(key)),
        put: (key, value) => run('readwrite', store => store.put(value, key)),
        delete: key => run('readwrite', store => store.delete(key)),
        keys: async prefix => {
          const keys = await run('readonly', store => store.getAllKeys());
          return keys.filter(key => typeof key === 'string' && key.startsWith(prefix));
        },
        close: () => database.close(),
      }));
    };
  });
}

function normalizeCompatibility(compatibility) {
  if (!compatibility) return freeze({ languages: [], components: [], loadText: null, match: null });
  const languages = compatibility.languages ?? [];
  const components = compatibility.components ?? ['text', 'voice'];
  if (!Array.isArray(languages) || languages.length > 32 || !Array.isArray(components)) {
    throw new TypeError('invalid compatibility language configuration');
  }
  const languageSet = new Set();
  languages.forEach(language => {
    boundedString(language, LANGUAGE, 24, 'compatibility language');
    languageSet.add(language);
  });
  const componentSet = new Set();
  components.forEach(component => {
    if (!COMPONENTS.has(component)) throw new TypeError('invalid compatibility component');
    componentSet.add(component);
  });
  return freeze({
    languages: [...languageSet],
    components: [...componentSet],
    loadText: typeof compatibility.loadText === 'function' ? compatibility.loadText : null,
    match: typeof compatibility.match === 'function' ? compatibility.match : null,
  });
}

export function initLanguagePacks({
  game,
  coreLanguages = ['kn', 'en'],
  trustedIndex,
  schema = null,
  fetchImpl = globalThis.fetch,
  packBaseUrl = null,
  cacheStorage = globalThis.caches,
  db,
  maxPackBytes = MAX_PACK_BYTES,
  cryptoImpl = globalThis.crypto,
  storageManager = globalThis.navigator?.storage,
  compatibility = null,
  validateText = null,
  now = Date.now,
  ResponseImpl = globalThis.Response,
} = {}) {
  if (!GAMES.has(game)) throw new TypeError('initLanguagePacks requires a known game id');
  if (schema) validateLanguagePackSchema(schema, trustedIndex);
  validateLanguageIndex(trustedIndex, { game });
  if (!Array.isArray(coreLanguages) || coreLanguages.length < 1 || coreLanguages.length > 4
      || coreLanguages.some(language => !LANGUAGE.test(language))) {
    throw new TypeError('coreLanguages must be a bounded language array');
  }
  if (new Set(coreLanguages).size !== coreLanguages.length
      || coreLanguages.some(language => !trustedIndex.coreLanguages.includes(language))) {
    throw new TypeError('coreLanguages must be unique members of the trusted index core set');
  }
  if (!coreLanguages.includes(trustedIndex.defaultLanguage)) {
    throw new TypeError('coreLanguages must include the trusted default language');
  }
  integer(maxPackBytes, 2, MAX_PACK_BYTES, 'maxPackBytes');
  if (typeof fetchImpl !== 'function') throw new TypeError('initLanguagePacks requires fetch');
  // Optional remote pack host: when the core install does not bundle web/packs/** (default-core /
  // Capacitor APK), pack manifest + file paths from the trusted index are resolved against this base
  // origin (the Pages URL) instead of the app's own origin. Unset (default) = relative fetch, unchanged.
  let packBase = null;
  if (packBaseUrl != null) {
    let parsed;
    try { parsed = new URL(String(packBaseUrl)); } catch { throw new TypeError('packBaseUrl must be an absolute URL'); }
    const localhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localhost)) {
      throw new TypeError('packBaseUrl must be https (http allowed only for localhost)');
    }
    if (!parsed.pathname.endsWith('/')) parsed.pathname = `${parsed.pathname}/`;   // ensure it resolves as a directory base
    parsed.search = '';
    parsed.hash = '';
    packBase = parsed;
  }
  if (!cacheStorage?.open || !cacheStorage?.delete || !cacheStorage?.keys) {
    throw new TypeError('initLanguagePacks requires CacheStorage');
  }
  if (typeof ResponseImpl !== 'function') throw new TypeError('initLanguagePacks requires Response');
  const store = dbAdapter(db);
  const core = new Set(coreLanguages);
  const compat = normalizeCompatibility(compatibility);
  const entryGroups = new Map();
  for (const source of trustedIndex.packs) {
    const key = `${source.language}/${source.component}`;
    const group = entryGroups.get(key) ?? [];
    group.push(freeze({ ...source }));
    entryGroups.set(key, group);
  }
  for (const group of entryGroups.values()) {
    group.sort((left, right) =>
      left.contentVersion - right.contentVersion
      || left.version.localeCompare(right.version, 'en', { numeric: true }));
    freeze(group);
  }
  const locks = new Map();
  let activeSnapshot = freeze({ language: trustedIndex.defaultLanguage, source: 'core', catalogs: null });
  const voiceManifestCache = new Map();

  const entriesFor = (language, component) => entryGroups.get(`${language}/${component}`) ?? [];
  const entryFor = (language, component) => entriesFor(language, component).at(-1) ?? null;
  const isCompatibility = (language, component) =>
    compat.languages.includes(language) && compat.components.includes(component);

  const serial = (key, operation) => {
    const previous = locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    let tracked;
    tracked = current.then(() => undefined, () => undefined).finally(() => {
      if (locks.get(key) === tracked) locks.delete(key);
    });
    locks.set(key, tracked);
    return current;
  };

  async function installedFor(language, component) {
    const candidates = entriesFor(language, component);
    if (!candidates.length) return null;
    const pointer = await store.get(pointerKey(game, language, component));
    if (!pointer) return null;
    for (const entry of candidates) {
      try {
        validatePointer(pointer, entry, game);
        return { pointer, entry };
      } catch { /* try another trusted version */ }
    }
    fail('corrupt', 'installed pointer does not match any trusted pack version');
  }

  async function status(language, component = 'text') {
    boundedString(language, LANGUAGE, 24, 'language');
    if (!COMPONENTS.has(component)) throw new TypeError('component must be text or voice');
    if (core.has(language)) return freeze({ language, component, state: 'core', bytes: 0 });
    const latest = entryFor(language, component);
    if (latest) {
      try {
        const installed = await installedFor(language, component);
        if (installed) {
          return freeze({
            language,
            component,
            state: 'installed',
            ...installed.entry,
            updateAvailable: installed.entry.packSha256 !== latest.packSha256,
          });
        }
      } catch {
        return freeze({ language, component, state: 'corrupt', ...latest });
      }
    }
    if (isCompatibility(language, component)) {
      return freeze({ language, component, state: 'compatibility', bytes: 0 });
    }
    if (latest) return freeze({ language, component, state: 'available', ...latest });
    return freeze({ language, component, state: 'unavailable', bytes: 0 });
  }

  async function list() {
    const languages = new Set([...core, ...compat.languages, ...trustedIndex.packs.map(entry => entry.language)]);
    const rows = [];
    for (const language of [...languages].sort()) {
      rows.push(freeze({
        language,
        core: core.has(language),
        text: await status(language, 'text'),
        voice: await status(language, 'voice'),
      }));
    }
    return freeze(rows);
  }

  async function verifyResponseHash(bytes, expected, label) {
    const actual = await sha256Hex(bytes, { cryptoImpl });
    if (actual !== expected) fail('hash-mismatch', `${label} SHA-256 mismatch`, { expected, actual });
  }

  // Resolve a trusted-index path (e.g. "packs/cb/ta/1/ui.json") for fetching. When a remote pack base is
  // configured, resolve against it and REQUIRE the result to stay under that base — an absolute or
  // parent-escaping path in the (SHA-verified, but defence-in-depth) index must not exfiltrate the fetch.
  function resolvePackUrl(path) {
    if (!packBase) return path;
    const resolved = new URL(path, packBase);
    if (resolved.origin !== packBase.origin || !resolved.pathname.startsWith(packBase.pathname)) {
      fail('unsafe-path', 'pack path escapes the trusted pack base');
    }
    return resolved.href;
  }

  async function fetchTrusted(path, signal, label) {
    checkAbort(signal);
    const url = resolvePackUrl(path);   // unsafe-path guard surfaces before the network try/catch
    try {
      return await fetchImpl(url, { signal, cache: 'no-store' });
    } catch (error) {
      if (signal?.aborted) throw abortError();
      fail('fetch-failed', `${label} request failed`, { cause: String(error?.message ?? error) });
    }
  }

  async function fetchManifest(entry, signal) {
    const response = await fetchTrusted(entry.manifestPath, signal, 'language manifest');
    const bytes = await readBoundedResponse(response, {
      expectedBytes: entry.manifestBytes,
      maxBytes: Math.min(MAX_MANIFEST_BYTES, entry.manifestBytes),
      signal,
      label: 'language manifest',
    });
    await verifyResponseHash(bytes, entry.manifestSha256, 'language manifest');
    const manifest = parseJson(bytes, 'language manifest');
    if (schema) validateLanguagePackSchema(schema, manifest);
    validateLanguageManifest(manifest, { game, entry, maxPackBytes });
    const payloadHash = await hashLanguageManifest(manifest, { cryptoImpl });
    if (payloadHash !== manifest.sha256 || payloadHash !== entry.packSha256) {
      fail('hash-mismatch', 'language manifest payload SHA-256 mismatch');
    }
    return { bytes, manifest };
  }

  async function loadManifestFromCache(cache, entry) {
    const response = await cache.match(entry.manifestPath);
    const bytes = await readBoundedResponse(response, {
      expectedBytes: entry.manifestBytes,
      maxBytes: entry.manifestBytes,
      label: 'cached language manifest',
    });
    await verifyResponseHash(bytes, entry.manifestSha256, 'cached language manifest');
    const manifest = parseJson(bytes, 'cached language manifest');
    if (schema) validateLanguagePackSchema(schema, manifest);
    validateLanguageManifest(manifest, { game, entry, maxPackBytes });
    const payloadHash = await hashLanguageManifest(manifest, { cryptoImpl });
    if (payloadHash !== entry.packSha256) fail('hash-mismatch', 'cached manifest payload SHA-256 mismatch');
    return manifest;
  }

  async function loadAndVerifyFiles(cache, manifest, { signal, collectText = false } = {}) {
    const byRole = Object.create(null);
    const byPath = Object.create(null);
    const merged = Object.create(null);
    const conflicts = new Set();
    let voiceMap = null;
    for (const file of manifest.files) {
      checkAbort(signal);
      const response = await cache.match(file.path);
      const bytes = await readBoundedResponse(response, {
        expectedBytes: file.bytes,
        maxBytes: file.bytes,
        signal,
        label: file.path,
      });
      await verifyResponseHash(bytes, file.sha256, file.path);
      if (manifest.component === 'text' && collectText) {
        const catalog = parseJson(bytes, file.path);
        validateCatalog(catalog, file.path);
        byPath[file.path] = catalog;
        const rolePaths = byRole[file.role] ??= [];
        rolePaths.push(file.path);
        for (const [key, value] of Object.entries(catalog)) {
          if (conflicts.has(key)) continue;
          if (own(merged, key) && merged[key] !== value) {
            delete merged[key];
            conflicts.add(key);
          } else {
            merged[key] = value;
          }
        }
      } else if (manifest.component === 'voice' && file.role === 'voice-manifest') {
        voiceMap = parseJson(bytes, file.path);
      }
    }
    if (manifest.component === 'text' && collectText) {
      const catalogs = { byRole, byPath, merged, conflicts: [...conflicts].sort() };
      if (typeof validateText === 'function') {
        const result = await validateText({ game, language: manifest.language, manifest, catalogs });
        if (result !== true && result !== undefined) {
          fail('coverage', typeof result === 'string' ? result : 'text pack coverage validation failed');
        }
      }
      return freeze(catalogs);
    }
    if (manifest.component === 'voice') validateVoiceMap(voiceMap, manifest);
    return null;
  }

  async function ensureCapacity(bytes) {
    if (!storageManager?.estimate) return;
    let estimateResult;
    try { estimateResult = await storageManager.estimate(); } catch { return; }
    const quota = Number(estimateResult?.quota);
    const usage = Number(estimateResult?.usage);
    if (Number.isFinite(quota) && Number.isFinite(usage) && quota - usage < bytes) {
      fail('quota', 'insufficient storage for language pack');
    }
  }

  async function install(language, { component = 'text', signal } = {}) {
    boundedString(language, LANGUAGE, 24, 'language');
    if (!COMPONENTS.has(component)) throw new TypeError('component must be text or voice');
    const lock = `${language}/${component}`;
    return serial(lock, async () => {
      checkAbort(signal);
      const current = await status(language, component);
      if (current.state === 'core' || current.state === 'compatibility'
          || (current.state === 'installed' && !current.updateAvailable)) return current;
      const entry = entryFor(language, component);
      if (!entry) fail('unavailable', `${language} ${component} pack is unavailable`);
      if (entry.packBytes > maxPackBytes) fail('oversized', 'pack exceeds the configured byte cap');
      if (component === 'voice') {
        const text = await status(language, 'text');
        if (!['core', 'compatibility', 'installed'].includes(text.state)) {
          fail('text-required', 'install the text component before voice');
        }
      }
      await ensureCapacity(entry.packBytes);
      const { bytes: manifestBytes, manifest } = await fetchManifest(entry, signal);
      const cacheName = [
        'tbg-lp', game, language, component, entry.version, entry.contentVersion,
        entry.packSha256.slice(0, 12), `${Date.now().toString(36)}-${++cacheSequence}`,
      ].join(':');
      const cache = await cacheStorage.open(cacheName);
      let committed = false;
      try {
        await cache.put(entry.manifestPath, new ResponseImpl(manifestBytes, {
          headers: { 'content-type': 'application/json', 'content-length': String(manifestBytes.byteLength) },
        }));
        for (const file of manifest.files) {
          checkAbort(signal);
          const response = await fetchTrusted(file.path, signal, file.path);
          const fileBytes = await readBoundedResponse(response, {
            expectedBytes: file.bytes,
            maxBytes: Math.min(file.bytes, maxPackBytes),
            signal,
            label: file.path,
          });
          await verifyResponseHash(fileBytes, file.sha256, file.path);
          if (component === 'text') validateCatalog(parseJson(fileBytes, file.path), file.path);
          await cache.put(file.path, new ResponseImpl(fileBytes, {
            headers: { 'content-type': file.mediaType, 'content-length': String(fileBytes.byteLength) },
          }));
        }
        await loadAndVerifyFiles(cache, manifest, { signal, collectText: component === 'text' });
        const previous = await installedFor(language, component).catch(() => null);
        const pointer = {
          schema: POINTER_SCHEMA,
          game,
          language,
          component,
          version: entry.version,
          contentVersion: entry.contentVersion,
          cacheName,
          manifestPath: entry.manifestPath,
          manifestSha256: entry.manifestSha256,
          packSha256: entry.packSha256,
          bytes: entry.packBytes,
          installedAt: Math.max(0, Math.floor(Number(typeof now === 'function' ? now() : now) || 0)),
        };
        validatePointer(pointer, entry, game);
        await store.put(pointerKey(game, language, component), pointer);
        committed = true;
        if (previous?.pointer.cacheName && previous.pointer.cacheName !== cacheName) {
          await cacheStorage.delete(previous.pointer.cacheName).catch(() => false);
        }
        return freeze({ language, component, state: 'installed', ...entry });
      } finally {
        if (!committed) await cacheStorage.delete(cacheName).catch(() => false);
      }
    });
  }

  async function activate(language) {
    boundedString(language, LANGUAGE, 24, 'language');
    let next;
    if (core.has(language)) {
      next = freeze({ language, source: 'core', catalogs: null });
    } else if (isCompatibility(language, 'text')) {
      let catalogs = null;
      if (compat.loadText) {
        const loaded = await compat.loadText(language);
        if (!loaded || !plain(loaded.merged ?? loaded)) fail('coverage', 'compatibility text loader returned invalid catalogs');
        catalogs = freeze(loaded.byRole && loaded.byPath ? loaded : {
          byRole: { ui: ['compatibility'] },
          byPath: { compatibility: loaded },
          merged: loaded,
          conflicts: [],
        });
      }
      next = freeze({ language, source: 'compatibility', catalogs });
    } else {
      const installed = await installedFor(language, 'text');
      if (!installed) fail('not-installed', `${language} text pack is not installed`);
      try {
        const cache = await cacheStorage.open(installed.pointer.cacheName);
        const manifest = await loadManifestFromCache(cache, installed.entry);
        const catalogs = await loadAndVerifyFiles(cache, manifest, { collectText: true });
        next = freeze({
          language,
          source: 'pack',
          version: installed.entry.version,
          contentVersion: installed.entry.contentVersion,
          catalogs,
        });
      } catch (error) {
        if (activeSnapshot.language === language) {
          activeSnapshot = freeze({ language: trustedIndex.defaultLanguage, source: 'core', catalogs: null });
        }
        throw error;
      }
    }
    activeSnapshot = next;
    return next;
  }

  async function getCatalog(language, role, { world } = {}) {
    boundedString(language, LANGUAGE, 24, 'language');
    if (role !== 'ui' && role !== 'world') throw new TypeError('role must be ui or world');
    if (role === 'world' && world !== undefined) {
      boundedString(world, /^[a-z][a-z0-9-]*$/, 64, 'world');
    }
    const snapshot = activeSnapshot;
    if (snapshot.language !== language
        || (snapshot.source !== 'pack' && snapshot.source !== 'compatibility')
        || !snapshot.catalogs) {
      return null;
    }
    const paths = snapshot.catalogs.byRole?.[role];
    if (!Array.isArray(paths) || paths.length === 0) return null;
    let path = null;
    if (role === 'ui' && typeof paths[0] === 'string') {
      [path] = paths;
    } else if (role === 'world' && typeof world === 'string') {
      path = paths.find(candidate =>
        typeof candidate === 'string' && candidate.endsWith(`/world-${world}.json`)) ?? null;
    }
    if (!path) return null;
    const catalog = snapshot.catalogs.byPath?.[path];
    return plain(catalog) ? catalog : null;
  }

  async function getVoiceFile(language, text, scope) {
    boundedString(language, LANGUAGE, 24, 'language');
    const contentId = await voiceContentId(scope, text, { cryptoImpl });
    const installed = await installedFor(language, 'voice');
    if (!installed) return null;

    let cached = voiceManifestCache.get(language);
    if (!cached || cached.cacheName !== installed.pointer.cacheName) {
      const cache = await cacheStorage.open(installed.pointer.cacheName);
      const manifest = await loadManifestFromCache(cache, installed.entry);
      const file = manifest.files.find(candidate => candidate.role === 'voice-manifest');
      if (!file) fail('coverage', 'voice pack has no voice manifest');
      const response = await cache.match(file.path);
      const bytes = await readBoundedResponse(response, {
        expectedBytes: file.bytes,
        maxBytes: file.bytes,
        label: 'cached voice manifest',
      });
      await verifyResponseHash(bytes, file.sha256, 'cached voice manifest');
      const map = parseJson(bytes, 'cached voice manifest');
      validateVoiceMap(map, manifest);
      cached = freeze({
        cacheName: installed.pointer.cacheName,
        map: freeze({ ...map }),
      });
      voiceManifestCache.set(language, cached);
    }

    const path = cached.map[contentId];
    if (typeof path !== 'string') return null;
    return match(language, 'voice', path);
  }

  async function match(language, component, path) {
    boundedString(language, LANGUAGE, 24, 'language');
    if (!COMPONENTS.has(component)) throw new TypeError('component must be text or voice');
    if (isCompatibility(language, component) && compat.match) return compat.match(language, component, path);
    const installed = await installedFor(language, component);
    if (!installed) return null;
    const manifestPrefix = packPrefix(game, language, installed.entry.contentVersion);
    if (typeof path !== 'string' || !path.startsWith(manifestPrefix)) fail('unsafe-path', 'pack path is outside the active component');
    const cache = await cacheStorage.open(installed.pointer.cacheName);
    return (await cache.match(path)) ?? null;
  }

  async function remove(language, { component = 'text' } = {}) {
    boundedString(language, LANGUAGE, 24, 'language');
    if (!COMPONENTS.has(component)) throw new TypeError('component must be text or voice');
    if (core.has(language)) fail('core', 'core language components cannot be removed');
    return serial(`${language}/${component}`, async () => {
      const entry = entryFor(language, component);
      if (!entry) return false;
      const installed = await installedFor(language, component).catch(() => null);
      await store.delete(pointerKey(game, language, component));
      if (installed?.pointer.cacheName) await cacheStorage.delete(installed.pointer.cacheName).catch(() => false);
      if (component === 'voice') voiceManifestCache.delete(language);
      if (component === 'text' && activeSnapshot.language === language) {
        activeSnapshot = freeze({ language: trustedIndex.defaultLanguage, source: 'core', catalogs: null });
      }
      return Boolean(installed);
    });
  }

  async function repair() {
    const referenced = new Set();
    const kept = [];
    const removed = [];
    for (const group of entryGroups.values()) {
      const latest = group.at(-1);
      const key = pointerKey(game, latest.language, latest.component);
      let pointer;
      try {
        pointer = await store.get(key);
        if (!pointer) continue;
        const entry = group.find(candidate => {
          try { validatePointer(pointer, candidate, game); return true; } catch { return false; }
        });
        if (!entry) fail('corrupt', 'installed pointer is no longer trusted');
        const cache = await cacheStorage.open(pointer.cacheName);
        const manifest = await loadManifestFromCache(cache, entry);
        await loadAndVerifyFiles(cache, manifest, { collectText: entry.component === 'text' });
        referenced.add(pointer.cacheName);
        kept.push(`${entry.language}/${entry.component}`);
      } catch {
        await store.delete(key).catch(() => {});
        if (pointer?.cacheName) await cacheStorage.delete(pointer.cacheName).catch(() => false);
        removed.push(`${latest.language}/${latest.component}`);
        if (activeSnapshot.language === latest.language && latest.component === 'text') {
          activeSnapshot = freeze({ language: trustedIndex.defaultLanguage, source: 'core', catalogs: null });
        }
      }
    }
    const prefix = `tbg-lp:${game}:`;
    const orphaned = [];
    for (const cacheName of await cacheStorage.keys()) {
      if (typeof cacheName === 'string' && cacheName.startsWith(prefix) && !referenced.has(cacheName)) {
        await cacheStorage.delete(cacheName).catch(() => false);
        orphaned.push(cacheName);
      }
    }
    for (const key of await store.keys(`tbg.language-pack.${game}.`)) {
      const suffix = key.slice(`tbg.language-pack.${game}.`.length);
      const split = suffix.lastIndexOf('.');
      const language = suffix.slice(0, split);
      const component = suffix.slice(split + 1);
      if (!entryFor(language, component)) {
        await store.delete(key).catch(() => {});
        removed.push(`${language}/${component}`);
      }
    }
    return freeze({ kept, removed: [...new Set(removed)], orphaned });
  }

  async function estimate() {
    let storage = {};
    try { storage = storageManager?.estimate ? await storageManager.estimate() : {}; } catch { storage = {}; }
    let installedBytes = 0;
    for (const group of entryGroups.values()) {
      const latest = group.at(-1);
      try {
        const installed = await installedFor(latest.language, latest.component);
        if (installed) installedBytes += installed.entry.packBytes;
      } catch { /* corrupt is not counted */ }
    }
    const quota = Number.isFinite(Number(storage.quota)) ? Number(storage.quota) : null;
    const usage = Number.isFinite(Number(storage.usage)) ? Number(storage.usage) : null;
    return freeze({
      quota,
      usage,
      available: quota == null || usage == null ? null : Math.max(0, quota - usage),
      installedBytes,
    });
  }

  return freeze({
    list,
    status,
    install,
    activate,
    active: () => activeSnapshot,
    getCatalog,
    getVoiceFile,
    match,
    remove,
    repair,
    estimate,
  });
}
