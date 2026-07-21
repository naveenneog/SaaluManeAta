import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAchievements,
  newUnlocks,
  recordUnlocks,
  validateAchievementRegistry,
} from '../web/js/achievements.js';
import { initProfile } from '../web/js/profile.js';

const actor = 'actor-0001';
const component = (value) => ({ p: value ? { [actor]: value } : {}, n: {} });
const profile = ({
  counters = {},
  ordinals = [],
} = {}) => ({
  schema: 1,
  game: 'ah',
  installId: actor,
  createdAt: 1,
  updatedAt: 1,
  counters: Object.fromEntries(Object.entries(counters).map(([name, value]) => [name, component(value)])),
  daily: { ordinals },
});

const registry = {
  schema: 1,
  version: 1,
  game: 'ah',
  achievements: [
    {
      id: 'first-match',
      titleKey: 'ah.achievement.first-match.title',
      descKey: 'ah.achievement.first-match.desc',
      icon: 'board-knot',
      tier: 'bronze',
      when: { type: 'counterAtLeast', counter: 'games.played', atLeast: 1 },
    },
    {
      id: 'steady-rhythm',
      titleKey: 'ah.achievement.steady-rhythm.title',
      descKey: 'ah.achievement.steady-rhythm.desc',
      icon: 'streak-thread',
      tier: 'silver',
      when: {
        type: 'all',
        conditions: [
          { type: 'streakBestAtLeast', atLeast: 3 },
          { type: 'dailyCountAtLeast', atLeast: 4 },
        ],
      },
    },
    {
      id: 'living-wall',
      titleKey: 'ah.achievement.living-wall.title',
      descKey: 'ah.achievement.living-wall.desc',
      icon: 'trap-ring',
      tier: 'gold',
      when: {
        type: 'any',
        conditions: [
          { type: 'logStat', evaluator: 'ah.goat-wall-win', atLeast: 1, params: { side: 'G' } },
          { type: 'not', condition: { type: 'counterAtLeast', counter: 'games.played', atLeast: 100 } },
        ],
      },
    },
  ],
};

test('validates strict bounded registries and content identifiers', () => {
  assert.equal(validateAchievementRegistry(registry), true);
  assert.throws(
    () => validateAchievementRegistry({
      ...registry,
      achievements: [{ ...registry.achievements[0], icon: 'https://example.invalid/icon.svg' }],
    }),
    /allowlisted/,
  );
  assert.throws(
    () => validateAchievementRegistry({
      ...registry,
      achievements: [{ ...registry.achievements[0], titleKey: 'First match' }],
    }),
    /content id/,
  );
  assert.throws(
    () => validateAchievementRegistry({
      ...registry,
      achievements: [registry.achievements[0], registry.achievements[0]],
    }),
    /duplicate/,
  );
});

test('evaluates counters, best streak, daily count, compounds, and exact progress', () => {
  const snapshot = profile({
    counters: { 'games.played': 3 },
    ordinals: [10, 11, 12, 20],
  });
  const calls = [];
  const results = evaluateAchievements(registry, {
    profile: snapshot,
    log: { actions: [] },
    finalState: { winner: 'G' },
    context: { source: 'live', ruleset: 'ah.base' },
    evaluators: {
      'ah.goat-wall-win': (input) => {
        calls.push(input);
        return 1;
      },
    },
  });
  assert.deepEqual(
    results.map(({ id, earned, progress, target, recordable }) => ({
      id, earned, progress, target, recordable,
    })),
    [
      { id: 'first-match', earned: true, progress: 3, target: 1, recordable: true },
      { id: 'steady-rhythm', earned: true, progress: 2, target: 2, recordable: true },
      { id: 'living-wall', earned: true, progress: 2, target: 1, recordable: true },
    ],
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, { side: 'G' });
  assert.equal(calls[0].context.source, 'live');
  assert.deepEqual(calls[0].finalState, { winner: 'G' });
});

test('logStat is unavailable without evidence and not cannot invert missing evidence', () => {
  const onlyNot = {
    ...registry,
    achievements: [{
      ...registry.achievements[2],
      when: {
        type: 'not',
        condition: { type: 'logStat', evaluator: 'ah.goat-wall-win', atLeast: 1 },
      },
    }],
  };
  const [result] = evaluateAchievements(onlyNot, {
    profile: profile(),
    context: { source: 'profile' },
  });
  assert.equal(result.earned, false);
  assert.equal(Object.hasOwn(result, 'progress'), false);
});

test('logStat evaluators must return non-negative safe integers', () => {
  const one = { ...registry, achievements: [registry.achievements[2]] };
  assert.throws(() => evaluateAchievements(one, {
    profile: profile(),
    log: { actions: [] },
    context: { source: 'live' },
    evaluators: { 'ah.goat-wall-win': () => true },
  }), /non-negative safe integer/);
});

test('newUnlocks and recordUnlocks are live-only and idempotent', () => {
  const storage = {
    value: null,
    getItem() { return this.value; },
    setItem(_key, value) { this.value = value; },
  };
  const local = initProfile({ id: 'ah', storage, now: () => 10 });
  local.bump('games.played');
  const results = evaluateAchievements({ ...registry, achievements: [registry.achievements[0]] }, {
    profile: local.snapshot(),
    context: { source: 'live' },
  });
  const unlocks = newUnlocks(results, local.snapshot());
  assert.deepEqual(recordUnlocks(local, unlocks), ['first-match']);
  assert.deepEqual(recordUnlocks(local, unlocks), []);
  assert.equal(local.value('achievements.first-match'), 1);

  const displayOnly = evaluateAchievements({ ...registry, achievements: [registry.achievements[0]] }, {
    profile: local.snapshot(),
    context: { source: 'imported-replay' },
  });
  assert.equal(displayOnly[0].earned, true);
  assert.equal(displayOnly[0].recordable, false);
  assert.deepEqual(newUnlocks(displayOnly, local.snapshot()), []);
});
