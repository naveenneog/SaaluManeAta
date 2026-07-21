import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyKey, dailyIndex, dailyChallenge, dailyOrdinal } from '../web/js/daily.js';

const pool = Array.from({ length: 6 }, (_, i) => ({ id: `cb.p${i}` }));

test('dailyKey is the local civil date as YYYY-MM-DD', () => {
  assert.equal(dailyKey(new Date(2026, 6, 5)), '2026-07-05'); // month is 0-based
  assert.equal(dailyKey(new Date(2026, 11, 31)), '2026-12-31');
  // a YYYY-MM-DD string is preserved verbatim (same civil date in every time zone)
  assert.equal(dailyKey('2026-07-14'), '2026-07-14');
  assert.equal(dailyKey('2026-07-14T23:30:00-08:00'), '2026-07-14');
  assert.throws(() => dailyKey('not-a-date'), /Date or a YYYY-MM-DD/);
});

test('dailyIndex is deterministic, in-range, and depends on date+game+version', () => {
  const a = dailyIndex('cb', 1, pool.length, new Date(2026, 6, 15));
  const b = dailyIndex('cb', 1, pool.length, new Date(2026, 6, 15));
  assert.equal(a, b);                       // same inputs -> same index (same puzzle across TZs)
  assert.ok(a >= 0 && a < pool.length);
  // different date / game / version generally re-rolls
  const other = dailyIndex('cb', 1, pool.length, new Date(2026, 6, 16));
  const otherGame = dailyIndex('sma', 1, pool.length, new Date(2026, 6, 15));
  const otherVer = dailyIndex('cb', 2, pool.length, new Date(2026, 6, 15));
  assert.ok([other, otherGame, otherVer].some((v) => v !== a));
});

test('dailyIndex handles empty / invalid pools without throwing', () => {
  assert.equal(dailyIndex('cb', 1, 0, new Date(2026, 6, 15)), 0);
  assert.equal(dailyIndex('cb', 1, -3, new Date(2026, 6, 15)), 0);
});

test('dailyChallenge returns a stable descriptor pointing at a pool item', () => {
  const d = dailyChallenge('cb', 1, pool, new Date(2026, 6, 15));
  assert.equal(d.key, '2026-07-15');
  assert.equal(d.gameId, 'cb');
  assert.ok(d.index >= 0 && d.index < pool.length);
  assert.equal(d.id, pool[d.index].id);
  assert.deepEqual(d.puzzle, pool[d.index]);
  assert.equal(dailyChallenge('cb', 1, [], new Date()), null);
});

test('a full year of daily picks stays in range and uses the whole pool', () => {
  const counts = new Array(pool.length).fill(0);
  for (let day = 0; day < 365; day += 1) {
    const date = new Date(2026, 0, 1 + day);
    const idx = dailyIndex('cb', 1, pool.length, date);
    assert.ok(idx >= 0 && idx < pool.length);
    counts[idx] += 1;
  }
  assert.ok(counts.every((c) => c > 0)); // every puzzle appears at least once across the year
});

test('dailyOrdinal advances by exactly one per calendar day', () => {
  const d0 = dailyOrdinal(new Date(2026, 6, 15));
  const d1 = dailyOrdinal(new Date(2026, 6, 16));
  assert.equal(d1 - d0, 1);
});
