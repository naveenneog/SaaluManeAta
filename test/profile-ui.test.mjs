import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, importProfile } from '../web/js/profile-ui.js';
import { initProfile } from '../web/js/profile.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}

test('computeStats reads counters + streak and derives win %', () => {
  const profile = initProfile({ id: 'cb', storage: memStorage() });
  profile.load();
  profile.bump('games.played', 4);
  profile.bump('games.won', 3);
  profile.bump('puzzles.solved', 5);
  const s = computeStats(profile);
  assert.equal(s.played, 4);
  assert.equal(s.won, 3);
  assert.equal(s.winPct, 75);
  assert.equal(s.puzzles, 5);
  assert.equal(s.daily, 0);
  assert.equal(typeof s.streakCurrent, 'number');
  assert.equal(typeof s.streakBest, 'number');
});

test('computeStats guards a zero-games win % (no divide-by-zero)', () => {
  const profile = initProfile({ id: 'cb', storage: memStorage() });
  assert.equal(computeStats(profile).winPct, 0);
});

test('importProfile merges a valid export and rejects junk', () => {
  const a = initProfile({ id: 'cb', storage: memStorage() });
  a.load(); a.bump('puzzles.solved', 2);
  const exported = a.export();

  const b = initProfile({ id: 'cb', storage: memStorage() });
  b.load(); b.bump('games.played', 1);
  const ok = importProfile(b, exported);
  assert.equal(ok.ok, true);
  // merged: b keeps its own counter and gains a's (different install ids -> summed components)
  assert.equal(computeStats(b).puzzles, 2);
  assert.equal(computeStats(b).played, 1);

  assert.equal(importProfile(b, '').ok, false);
  assert.equal(importProfile(b, 'not json').ok, false);
});
