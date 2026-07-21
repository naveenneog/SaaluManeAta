export const RULESET_SCHEMA = 1;

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

function assertData(value, path = 'ruleset', seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must not contain non-finite numbers`);
    return;
  }
  if (typeof value !== 'object') throw new TypeError(`${path} must contain data only`);
  if (seen.has(value)) throw new TypeError(`${path} must not contain cycles`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertData(item, `${path}[${index}]`, seen));
  } else {
    if (!isPlainObject(value)) throw new TypeError(`${path} must contain plain objects only`);
    for (const [key, item] of Object.entries(value)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw new TypeError(`${path} contains an unsafe key`);
      }
      assertData(item, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

const cloneData = (value) => JSON.parse(JSON.stringify(value));
const requireText = (value, path) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${path} must be a non-empty string`);
};
const requireVersion = (value, path) => {
  const validNumber = Number.isSafeInteger(value) && value >= 0;
  if (!validNumber && (typeof value !== 'string' || !value.trim())) {
    throw new TypeError(`${path} must be a non-negative integer or non-empty string`);
  }
};

export function validateRuleset(value, { game, id } = {}) {
  assertData(value);
  if (!isPlainObject(value)) throw new TypeError('ruleset must be an object');
  if (value.schema !== RULESET_SCHEMA) throw new RangeError(`Unsupported ruleset schema: ${value.schema}`);
  requireText(value.id, 'ruleset.id');
  requireVersion(value.version, 'ruleset.version');
  requireText(value.game, 'ruleset.game');
  if (game && value.game !== game) throw new RangeError(`Ruleset game ${value.game} does not match ${game}`);
  if (id && value.id !== id) throw new RangeError(`Ruleset id ${value.id} does not match ${id}`);
  if (value.variantOf !== null && value.variantOf !== undefined) requireText(value.variantOf, 'ruleset.variantOf');
  return true;
}

export function createRuleset(spec, options) {
  validateRuleset(spec, options);
  return cloneData(spec);
}

export function rulesetRef(spec) {
  const ruleset = createRuleset(spec);
  return { id: ruleset.id, version: ruleset.version };
}

export function serializeRuleset(spec, { space = 0 } = {}) {
  return JSON.stringify(createRuleset(spec), null, space);
}

export function deserializeRuleset(json, options) {
  if (typeof json !== 'string') throw new TypeError('deserializeRuleset requires JSON text');
  return createRuleset(JSON.parse(json), options);
}

export async function loadRuleset(url, { fetchImpl = globalThis.fetch, game, id } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('loadRuleset requires fetch');
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Ruleset request failed: ${response.status}`);
  return createRuleset(await response.json(), { game, id });
}

export function createRulesetRegistry(initial = []) {
  const entries = new Map();
  const key = (id, version) => `${id}@${version}`;

  function add(spec) {
    const ruleset = createRuleset(spec);
    const exact = key(ruleset.id, ruleset.version);
    if (entries.has(exact)) throw new RangeError(`Duplicate ruleset ${exact}`);
    entries.set(exact, ruleset);
    return ruleset;
  }

  function get(id, version) {
    requireText(id, 'ruleset id');
    if (version !== undefined) return entries.get(key(id, version)) || null;
    const matches = [...entries.values()].filter((ruleset) => ruleset.id === id);
    if (!matches.length) return null;
    if (matches.length > 1) throw new RangeError(`Ruleset ${id} requires an explicit version`);
    return matches[0];
  }

  initial.forEach(add);
  return Object.freeze({
    add,
    get,
    resolve(ref) {
      if (!isPlainObject(ref)) throw new TypeError('ruleset ref must be an object');
      return get(ref.id, ref.version);
    },
    list: () => [...entries.values()].map(cloneData),
  });
}
