import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSolvedStore, recordSolve, isSolved } from '../web/js/puzzle-ui.js';
import { dailyOrdinal } from '../web/js/daily.js';

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}

function fakeProfile() {
  const bumps = {};
  let ordinals = [];
  return {
    bump: (name) => { bumps[name] = (bumps[name] || 0) + 1; },
    markDaily: () => { const o = dailyOrdinal(); if (!ordinals.includes(o)) ordinals.push(o); },
    snapshot: () => ({ daily: { ordinals: [...ordinals] } }),
    bumps,
  };
}

test('makeSolvedStore persists a de-duplicated solved set', () => {
  const storage = fakeStorage();
  const store = makeSolvedStore('cb', storage);
  assert.equal(store.has('cb-e1'), false);
  assert.equal(store.add('cb-e1'), true);   // first time
  assert.equal(store.add('cb-e1'), false);  // idempotent
  assert.equal(store.has('cb-e1'), true);
  // a fresh store over the same storage sees the persisted set
  const reopened = makeSolvedStore('cb', storage);
  assert.deepEqual(reopened.all(), ['cb-e1']);
});

test('recordSolve bumps puzzles.solved once and daily.solved only on a new ordinal', () => {
  const storage = fakeStorage();
  const store = makeSolvedStore('cb', storage);
  const profile = fakeProfile();
  const spec = { id: 'cb-e1-race-home' };

  const first = recordSolve({ spec, isDaily: true, profile, solvedStore: store });
  assert.deepEqual(first, { firstTime: true, dailyCounted: true });
  assert.equal(profile.bumps['puzzles.solved'], 1);
  assert.equal(profile.bumps['daily.solved'], 1);

  // solving the SAME puzzle again (still daily, same day) counts neither
  const second = recordSolve({ spec, isDaily: true, profile, solvedStore: store });
  assert.deepEqual(second, { firstTime: false, dailyCounted: false });
  assert.equal(profile.bumps['puzzles.solved'], 1);
  assert.equal(profile.bumps['daily.solved'], 1);
});

test('recordSolve without a profile still records the local solve', () => {
  const store = makeSolvedStore('cb', fakeStorage());
  const r = recordSolve({ spec: { id: 'x' }, isDaily: false, profile: null, solvedStore: store });
  assert.equal(r.firstTime, true);
  assert.equal(store.has('x'), true);
});

test('isSolved delegates to the goal evaluator', () => {
  const iface = { hash: () => 'h', evaluators: { even: (s) => s.n % 2 === 0 } };
  assert.equal(isSolved({ n: 6 }, { goal: { type: 'atLeast', path: 'n', n: 5 } }, iface), true);
  assert.equal(isSolved({ n: 3 }, { goal: { type: 'atLeast', path: 'n', n: 5 } }, iface), false);
  assert.equal(isSolved({ n: 6 }, { goal: { type: 'custom', name: 'even' } }, iface), true);
});
