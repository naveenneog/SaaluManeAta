import test from 'node:test';
import assert from 'node:assert/strict';
import {
  counterValue,
  initProfile,
  mergeProfiles,
  streakValue,
  validateProfile,
} from '../web/js/profile.js';

const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
};

test('profile persists PN counters under the versioned per-game key', () => {
  const storage = memoryStorage();
  const profile = initProfile({ id: 'toy', storage, now: () => 1000 });
  assert.equal(profile.key, 'tbg.toy.profile.v1');
  assert.equal(profile.bump('games.played', 3), 3);
  assert.equal(profile.bump('games.played', -1), 2);
  assert.equal(initProfile({ id: 'toy', storage, now: () => 2000 }).value('games.played'), 2);
});

test('merge takes the max per install component and is idempotent', () => {
  const aStore = memoryStorage(), bStore = memoryStorage();
  const a = initProfile({ id: 'toy', storage: aStore, now: () => 1000 });
  const b = initProfile({ id: 'toy', storage: bStore, now: () => 2000 });
  a.bump('games.won', 2);
  b.bump('games.won', 3);
  const merged = mergeProfiles(a.snapshot(), b.snapshot());
  assert.equal(counterValue(merged, 'games.won'), 5);
  assert.deepEqual(mergeProfiles(merged, b.snapshot()), merged);
});

test('import merges without replacing the receiving install identity', () => {
  const local = initProfile({ id: 'toy', storage: memoryStorage(), now: () => 1000 });
  const remote = initProfile({ id: 'toy', storage: memoryStorage(), now: () => 2000 });
  const localId = local.load().installId;
  remote.bump('puzzles.solved', 4);
  const merged = local.import(remote.export());
  assert.equal(merged.installId, localId);
  assert.equal(local.value('puzzles.solved'), 4);
});

test('daily completion is a grow-only set and streak is derived', () => {
  const profile = initProfile({ id: 'toy', storage: memoryStorage(), now: () => 1000 });
  profile.markDaily('2026-07-12');
  profile.markDaily('2026-07-13');
  profile.markDaily('2026-07-14');
  profile.markDaily('2026-07-14');
  assert.deepEqual(profile.streak('2026-07-14'), { current: 3, best: 3, last: 20648 });
  assert.equal(profile.snapshot().daily.ordinals.length, 3);
});

test('profile validation and imports reject malformed or oversized data', () => {
  const profile = initProfile({ id: 'toy', storage: memoryStorage() });
  assert.equal(validateProfile(profile.load()), true);
  assert.throws(() => profile.import('{bad json'), /JSON/);
  assert.throws(() => profile.import('x'.repeat(70000)), /too large/);
  assert.throws(() => streakValue({}), /schema/);
});
