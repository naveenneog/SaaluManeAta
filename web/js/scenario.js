import { append, checkpoint, createLog, derive } from './action-log.js';
import { createRngSuite } from './rng.js';

export const SCENARIO_SCHEMA = 1;

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

function assertData(value, path = 'scenario', seen = new Set()) {
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

function validateActionEntry(entry, path) {
  if (!isPlainObject(entry) || entry.action == null) throw new TypeError(`${path} must contain an action`);
  if (entry.rngUses !== undefined) {
    if (!Array.isArray(entry.rngUses)) throw new TypeError(`${path}.rngUses must be an array`);
    entry.rngUses.forEach((use, index) => {
      if (!isPlainObject(use) || typeof use.stream !== 'string'
        || !Number.isSafeInteger(use.draws) || use.draws < 0) {
        throw new TypeError(`${path}.rngUses[${index}] must be { stream, draws }`);
      }
    });
  }
  if (entry.elapsedMs !== undefined && (!Number.isFinite(entry.elapsedMs) || entry.elapsedMs < 0)) {
    throw new TypeError(`${path}.elapsedMs must be a non-negative number`);
  }
  if (entry.stateHash !== undefined && entry.stateHash !== null && typeof entry.stateHash !== 'string') {
    throw new TypeError(`${path}.stateHash must be a string`);
  }
}

export function validateScenario(value, { game, id } = {}) {
  assertData(value);
  if (!isPlainObject(value)) throw new TypeError('scenario must be an object');
  if (value.schema !== SCENARIO_SCHEMA) throw new RangeError(`Unsupported scenario schema: ${value.schema}`);
  requireText(value.id, 'scenario.id');
  requireText(value.game, 'scenario.game');
  if (game && value.game !== game) throw new RangeError(`Scenario game ${value.game} does not match ${game}`);
  if (id && value.id !== id) throw new RangeError(`Scenario id ${value.id} does not match ${id}`);
  requireText(value.world, 'scenario.world');

  if (!isPlainObject(value.engine)) throw new TypeError('scenario.engine must be an object');
  requireVersion(value.engine.version, 'scenario.engine.version');
  if (!isPlainObject(value.ruleset)) throw new TypeError('scenario.ruleset must be an object');
  requireText(value.ruleset.id, 'scenario.ruleset.id');
  requireVersion(value.ruleset.version, 'scenario.ruleset.version');
  if (!isPlainObject(value.rng)) throw new TypeError('scenario.rng must be an object');
  requireText(value.rng.algorithm, 'scenario.rng.algorithm');
  if (!['string', 'number'].includes(typeof value.rng.seed)) {
    throw new TypeError('scenario.rng.seed must be a string or number');
  }

  requireText(value.titleKey, 'scenario.titleKey');
  requireText(value.briefKey, 'scenario.briefKey');
  if (!Array.isArray(value.hintKeys) || value.hintKeys.some((key) => typeof key !== 'string' || !key.trim())) {
    throw new TypeError('scenario.hintKeys must be an array of non-empty strings');
  }

  if (!isPlainObject(value.position)) throw new TypeError('scenario.position must be an object');
  if (!['initial', 'actions', 'state'].includes(value.position.kind)) {
    throw new RangeError(`Unsupported scenario position kind: ${value.position.kind}`);
  }
  if (value.position.kind === 'actions') {
    if (!Array.isArray(value.position.actions)) throw new TypeError('actions position requires position.actions');
    value.position.actions.forEach((entry, index) => validateActionEntry(entry, `scenario.position.actions[${index}]`));
  }
  if (value.position.kind === 'state' && !isPlainObject(value.position.state)) {
    throw new TypeError('state position requires position.state');
  }

  if (value.goal !== undefined && !isPlainObject(value.goal)) throw new TypeError('scenario.goal must be an object');
  if (value.constraints !== undefined) {
    if (!isPlainObject(value.constraints)) throw new TypeError('scenario.constraints must be an object');
    const { maxActions, allowUndo } = value.constraints;
    if (maxActions !== undefined && (!Number.isSafeInteger(maxActions) || maxActions < 1)) {
      throw new TypeError('scenario.constraints.maxActions must be a positive integer');
    }
    if (allowUndo !== undefined && typeof allowUndo !== 'boolean') {
      throw new TypeError('scenario.constraints.allowUndo must be boolean');
    }
  }
  if (value.solution !== undefined && !Array.isArray(value.solution)) {
    throw new TypeError('scenario.solution must be an array');
  }
  if (value.par !== undefined && (!Number.isSafeInteger(value.par) || value.par < 0)) {
    throw new TypeError('scenario.par must be a non-negative integer');
  }
  return true;
}

export function createScenario(spec) {
  validateScenario(spec);
  return cloneData(spec);
}

export function scenarioToLog(spec) {
  const scenario = createScenario(spec);
  const rng = createRngSuite({
    algorithm: scenario.rng.algorithm,
    seed: scenario.rng.seed,
  });
  const log = createLog({
    game: scenario.game,
    engine: scenario.engine,
    ruleset: scenario.ruleset,
    world: scenario.world,
    rng,
  });
  if (scenario.position.kind === 'actions') {
    for (const entry of scenario.position.actions) append(log, entry);
  } else if (scenario.position.kind === 'state') {
    checkpoint(log, {
      afterAction: 0,
      state: cloneData(scenario.position.state),
      rngState: scenario.position.rngState ? cloneData(scenario.position.rngState) : null,
      stateHash: scenario.position.stateHash ?? null,
    });
  }
  return log;
}

export function deriveScenario(spec, adapter) {
  const scenario = createScenario(spec);
  const log = scenarioToLog(scenario);
  const { state, rng } = derive(log, adapter);
  return { scenario, log, state, rng };
}

export function serializeScenario(spec, { space = 0 } = {}) {
  return JSON.stringify(createScenario(spec), null, space);
}

export function deserializeScenario(json) {
  if (typeof json !== 'string') throw new TypeError('deserializeScenario requires JSON text');
  return createScenario(JSON.parse(json));
}

export async function loadScenario(url, { fetchImpl = globalThis.fetch, game, id } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('loadScenario requires fetch');
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Scenario request failed: ${response.status}`);
  const scenario = createScenario(await response.json());
  validateScenario(scenario, { game, id });
  return scenario;
}
