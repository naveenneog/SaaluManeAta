import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSmaTransition, SMA_RECAP_KEYS } from '../web/js/recap-insights.js';

const ctx = { maxAlternatives: 64, budget: { consume: () => true } };
const st = (onBoard, toPlace, extra = {}) => ({ points: new Array(24).fill(null), turn: 0, onBoard, toPlace, removePending: false, winner: null, ...extra });

test('a move with no board event yields no candidate', () => {
  const after = { ...st([2, 2], [7, 7]), event: null };
  assert.deepEqual(analyzeSmaTransition({ before: st([1, 2], [8, 7]), after, entry: { action: { type: 'place', to: 0 } } }, ctx), []);
});

test('a mill scores 220, plus 120 when the removal creates a material lead', () => {
  const before = st([2, 3], [0, 0]);
  const after = { ...st([3, 3], [0, 0]), event: { type: 'move', side: 0, mill: true, from: 1, to: 2 } };
  const [base] = analyzeSmaTransition({ before, after, entry: { action: { type: 'move', from: 1, to: 2 } }, next: null }, ctx);
  assert.equal(base.kind, 'sma-mill');
  assert.equal(base.score, 220);
  assert.equal(base.sentenceKey, SMA_RECAP_KEYS.millCapture);

  // with the removal next reducing the rival, the mover gains a material lead -> +120
  const next = { after: { ...st([3, 2], [0, 0]), event: { type: 'remove', side: 0, removed: 9 } } };
  const [lead] = analyzeSmaTransition({ before, after, entry: { action: { type: 'move', from: 1, to: 2 } }, next }, ctx);
  assert.equal(lead.score, 340);
});

test('a decisive removal is a terminal 1000', () => {
  const after = { ...st([3, 2], [0, 0], { winner: 0 }), event: { type: 'remove', side: 0, removed: 9 } };
  const [c] = analyzeSmaTransition({ before: st([3, 3], [0, 0]), after, entry: { action: { type: 'remove', at: 9 } } }, ctx);
  assert.equal(c.kind, 'sma-mill-win');
  assert.equal(c.score, 1000);
  assert.equal(c.terminal, true);
  assert.equal(c.sentenceKey, SMA_RECAP_KEYS.millDeciding);
});

test('flying begins is detected for the reduced (victim) side, not the remover', () => {
  const before = st([4, 3], [0, 0]);
  const after = { ...st([3, 3], [0, 0]), event: { type: 'remove', side: 1, removed: 5 } };
  const cs = analyzeSmaTransition({ before, after, entry: { action: { type: 'remove', at: 5 } } }, ctx);
  const flying = cs.find((c) => c.kind === 'sma-flying');
  assert.ok(flying, 'expected a flying candidate for side 0');
  assert.equal(flying.sentenceKey, SMA_RECAP_KEYS.flyingBegins);
});
