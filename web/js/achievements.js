// Heritage achievements: strict static registries, pure deterministic evaluation, and
// idempotent recording through profile.js. Imported replays and spectate are display-only.
// Keep this module byte-identical across games after cross-review.
import { assertContentId } from './content-id.js';
import { counterValue, validateProfile } from './profile.js';

export const ACHIEVEMENT_SCHEMA = 1;
export const ACHIEVEMENT_ICONS = Object.freeze([
  'board-knot',
  'victory-leaf',
  'puzzle-knot',
  'daily-lamp',
  'streak-thread',
  'trap-ring',
  'tiger-paw',
  'goat-shield',
  'seed-hand',
  'relay-loop',
  'harvest-bowl',
  'balance-scale',
  'cowrie-shell',
  'home-gate',
  'safe-cell',
  'mill-wheel',
  'flying-stone',
  'capture-ring',
]);

const ID = /^[a-z][a-z0-9-]{0,34}$/;
const GAME = /^[a-z][a-z0-9-]{1,31}$/;
const COUNTER = /^(?=.{1,48}$)[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/;
const EVALUATOR = /^(?=.{3,64}$)[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const TIERS = new Set(['bronze', 'silver', 'gold']);
const ICONS = new Set(ACHIEVEMENT_ICONS);
const SOURCES = new Set(['profile', 'live', 'puzzle', 'daily', 'imported-replay', 'spectate']);
const RECORDABLE_SOURCES = new Set(['live', 'puzzle', 'daily']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_ACHIEVEMENTS = 32;
const MAX_CONDITION_DEPTH = 8;
const MAX_CONDITION_NODES = 128;

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

function assertKeys(value, required, optional, path) {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be a plain object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!Object.hasOwn(value, key)) throw new TypeError(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${path}.${key} is not allowed`);
}

function assertPositive(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${path} must be a positive safe integer`);
}

function assertParams(value, path) {
  const stack = [{ value, path, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    if (++nodes > 64) throw new RangeError(`${path} is too complex`);
    if (current.depth > 4) throw new RangeError(`${current.path} is too deep`);
    const item = current.value;
    if (item === null || typeof item === 'boolean') continue;
    if (typeof item === 'string') {
      if (item.length > 128) throw new RangeError(`${current.path} is too long`);
      continue;
    }
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item)) throw new TypeError(`${current.path} must be a safe integer`);
      continue;
    }
    if (Array.isArray(item)) {
      if (item.length > 32) throw new RangeError(`${current.path} has too many items`);
      for (let index = item.length - 1; index >= 0; index -= 1) {
        stack.push({ value: item[index], path: `${current.path}[${index}]`, depth: current.depth + 1 });
      }
      continue;
    }
    if (!isPlainObject(item)) throw new TypeError(`${current.path} must contain plain data`);
    const keys = Object.keys(item);
    if (keys.length > 16) throw new RangeError(`${current.path} has too many keys`);
    for (const key of keys) {
      if (FORBIDDEN_KEYS.has(key)) throw new TypeError(`${current.path}.${key} is forbidden`);
      stack.push({ value: item[key], path: `${current.path}.${key}`, depth: current.depth + 1 });
    }
  }
}

function validateCondition(condition, path, budget, depth = 0) {
  if (depth > MAX_CONDITION_DEPTH) throw new RangeError(`${path} is too deep`);
  budget.nodes += 1;
  if (budget.nodes > MAX_CONDITION_NODES) throw new RangeError('achievement conditions are too complex');
  if (!isPlainObject(condition) || typeof condition.type !== 'string') {
    throw new TypeError(`${path} must be a typed condition`);
  }
  switch (condition.type) {
    case 'counterAtLeast':
      assertKeys(condition, ['type', 'counter', 'atLeast'], [], path);
      if (!COUNTER.test(condition.counter)) throw new TypeError(`${path}.counter is invalid`);
      assertPositive(condition.atLeast, `${path}.atLeast`);
      break;
    case 'streakBestAtLeast':
    case 'dailyCountAtLeast':
      assertKeys(condition, ['type', 'atLeast'], [], path);
      assertPositive(condition.atLeast, `${path}.atLeast`);
      break;
    case 'logStat':
      assertKeys(condition, ['type', 'evaluator', 'atLeast'], ['params'], path);
      if (!EVALUATOR.test(condition.evaluator)) throw new TypeError(`${path}.evaluator is invalid`);
      assertPositive(condition.atLeast, `${path}.atLeast`);
      if (Object.hasOwn(condition, 'params')) assertParams(condition.params, `${path}.params`);
      break;
    case 'all':
    case 'any':
      assertKeys(condition, ['type', 'conditions'], [], path);
      if (!Array.isArray(condition.conditions) || !condition.conditions.length || condition.conditions.length > 16) {
        throw new TypeError(`${path}.conditions must contain 1..16 conditions`);
      }
      condition.conditions.forEach((child, index) => validateCondition(child, `${path}.conditions[${index}]`, budget, depth + 1));
      break;
    case 'not':
      assertKeys(condition, ['type', 'condition'], [], path);
      validateCondition(condition.condition, `${path}.condition`, budget, depth + 1);
      break;
    default:
      throw new TypeError(`${path}.type is unsupported`);
  }
}

export function validateAchievementRegistry(registry) {
  assertKeys(registry, ['schema', 'version', 'game', 'achievements'], [], 'registry');
  if (registry.schema !== ACHIEVEMENT_SCHEMA) throw new RangeError('unsupported achievement schema');
  assertPositive(registry.version, 'registry.version');
  if (!GAME.test(registry.game)) throw new TypeError('registry.game is invalid');
  if (!Array.isArray(registry.achievements) || !registry.achievements.length
    || registry.achievements.length > MAX_ACHIEVEMENTS) {
    throw new TypeError(`registry.achievements must contain 1..${MAX_ACHIEVEMENTS} entries`);
  }
  const ids = new Set();
  const budget = { nodes: 0 };
  registry.achievements.forEach((achievement, index) => {
    const path = `registry.achievements[${index}]`;
    assertKeys(achievement, ['id', 'titleKey', 'descKey', 'icon', 'tier', 'when'], [], path);
    if (!ID.test(achievement.id)) throw new TypeError(`${path}.id is invalid`);
    if (ids.has(achievement.id)) throw new RangeError(`duplicate achievement id ${achievement.id}`);
    ids.add(achievement.id);
    assertContentId(achievement.titleKey, `${path}.titleKey`);
    assertContentId(achievement.descKey, `${path}.descKey`);
    if (!ICONS.has(achievement.icon)) throw new TypeError(`${path}.icon is not allowlisted`);
    if (!TIERS.has(achievement.tier)) throw new TypeError(`${path}.tier is invalid`);
    if (`achievements.${achievement.id}`.length > 48) throw new RangeError(`${path}.id is too long for profile counters`);
    validateCondition(achievement.when, `${path}.when`, budget);
  });
  return true;
}

function bestStreak(ordinals) {
  let best = 0;
  let run = 0;
  let previous = null;
  for (const ordinal of ordinals) {
    run = previous !== null && ordinal === previous + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = ordinal;
  }
  return best;
}

const measured = (progress, target, available = true) => ({
  available,
  earned: available && progress >= target,
  progress,
  target,
});

function evaluateCondition(condition, input) {
  switch (condition.type) {
    case 'counterAtLeast':
      return measured(counterValue(input.profile, condition.counter), condition.atLeast);
    case 'streakBestAtLeast':
      return measured(bestStreak(input.profile.daily.ordinals), condition.atLeast);
    case 'dailyCountAtLeast':
      return measured(input.profile.daily.ordinals.length, condition.atLeast);
    case 'logStat': {
      const evaluator = Object.hasOwn(input.evaluators, condition.evaluator)
        ? input.evaluators[condition.evaluator]
        : null;
      if (!input.log || typeof evaluator !== 'function') return measured(0, condition.atLeast, false);
      const progress = evaluator(Object.freeze({
        log: input.log,
        finalState: input.finalState,
        context: input.context,
        params: Object.hasOwn(condition, 'params') ? condition.params : null,
      }));
      if (!Number.isSafeInteger(progress) || progress < 0) {
        throw new TypeError(`achievement evaluator ${condition.evaluator} must return a non-negative safe integer`);
      }
      return measured(progress, condition.atLeast);
    }
    case 'all': {
      const children = condition.conditions.map((child) => evaluateCondition(child, input));
      const available = children.every((child) => child.available);
      const progress = children.filter((child) => child.earned).length;
      return { available, earned: available && progress === children.length, progress, target: children.length };
    }
    case 'any': {
      const children = condition.conditions.map((child) => evaluateCondition(child, input));
      const progress = children.filter((child) => child.earned).length;
      const available = progress > 0 || children.every((child) => child.available);
      return { available, earned: progress > 0, progress, target: 1 };
    }
    case 'not': {
      const child = evaluateCondition(condition.condition, input);
      return {
        available: child.available,
        earned: child.available && !child.earned,
        progress: child.available && !child.earned ? 1 : 0,
        target: 1,
      };
    }
    default:
      throw new TypeError(`unsupported achievement condition ${condition.type}`);
  }
}

export function evaluateAchievements(registry, {
  profile,
  log = null,
  finalState = null,
  context = {},
  evaluators = {},
} = {}) {
  validateAchievementRegistry(registry);
  validateProfile(profile, { game: registry.game });
  if (!isPlainObject(context)) throw new TypeError('achievement context must be a plain object');
  if (!isPlainObject(evaluators)) throw new TypeError('achievement evaluators must be a plain object');
  const source = context.source ?? 'profile';
  if (!SOURCES.has(source)) throw new TypeError('achievement context source is invalid');
  const recordable = RECORDABLE_SOURCES.has(source);
  const input = { profile, log, finalState, context, evaluators };
  return Object.freeze(registry.achievements.map((achievement) => {
    const result = evaluateCondition(achievement.when, input);
    return Object.freeze({
      id: achievement.id,
      titleKey: achievement.titleKey,
      descKey: achievement.descKey,
      icon: achievement.icon,
      tier: achievement.tier,
      earned: result.earned,
      recordable,
      ...(result.available ? { progress: result.progress, target: result.target } : {}),
    });
  }));
}

export function newUnlocks(results, profileSnapshot) {
  validateProfile(profileSnapshot);
  if (!Array.isArray(results) || results.length > MAX_ACHIEVEMENTS) {
    throw new TypeError('achievement results must be a bounded array');
  }
  const seen = new Set();
  const unlocked = [];
  for (const result of results) {
    if (!isPlainObject(result) || !ID.test(result.id) || typeof result.earned !== 'boolean'
      || typeof result.recordable !== 'boolean') {
      throw new TypeError('achievement result is invalid');
    }
    if (seen.has(result.id)) throw new RangeError(`duplicate achievement result ${result.id}`);
    seen.add(result.id);
    if (result.recordable && result.earned
      && counterValue(profileSnapshot, `achievements.${result.id}`) === 0) {
      unlocked.push(result);
    }
  }
  return Object.freeze(unlocked);
}

export function recordUnlocks(profile, achievements) {
  if (!profile || typeof profile.value !== 'function' || typeof profile.bump !== 'function') {
    throw new TypeError('recordUnlocks requires an initialized profile');
  }
  if (!Array.isArray(achievements) || achievements.length > MAX_ACHIEVEMENTS) {
    throw new TypeError('achievements must be a bounded array');
  }
  const seen = new Set();
  const recorded = [];
  for (const achievement of achievements) {
    if (!isPlainObject(achievement) || !ID.test(achievement.id)
      || achievement.recordable !== true || seen.has(achievement.id)) continue;
    seen.add(achievement.id);
    const counter = `achievements.${achievement.id}`;
    const current = profile.value(counter);
    if (!Number.isSafeInteger(current)) throw new TypeError(`${counter} must be a safe integer`);
    if (current === 0) {
      profile.bump(counter);
      recorded.push(achievement.id);
    }
  }
  return Object.freeze(recorded);
}
