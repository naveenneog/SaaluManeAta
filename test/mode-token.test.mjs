import test from 'node:test';
import assert from 'node:assert/strict';
import { createModeToken } from '../web/js/mode-token.js';

test('begin invalidates older async work in the same mode', () => {
  const modes = createModeToken();
  const first = modes.begin();
  assert.equal(modes.isCurrent(first, 'live'), true);
  const second = modes.begin();
  assert.equal(modes.isCurrent(first, 'live'), false);
  assert.equal(modes.isCurrent(second, 'live'), true);
});

test('enter changes mode and invalidates every previous lease', () => {
  const modes = createModeToken('opening');
  const opening = modes.capture();
  const replay = modes.enter('replay');
  assert.equal(modes.isCurrent(opening), false);
  assert.equal(modes.isCurrent(replay, 'replay'), true);
  assert.equal(modes.mode, 'replay');
});

test('cancel invalidates work without changing mode', () => {
  const modes = createModeToken('puzzle');
  const work = modes.begin();
  const cancelled = modes.cancel();
  assert.equal(modes.mode, 'puzzle');
  assert.equal(modes.isCurrent(work), false);
  assert.equal(modes.isCurrent(cancelled), true);
});

test('tokens and modes are bounded and immutable', () => {
  assert.throws(() => createModeToken('Raw English mode'), /short lowercase mode/);
  const modes = createModeToken();
  const token = modes.begin();
  assert.equal(Object.isFrozen(token), true);
  assert.throws(() => { token.mode = 'replay'; }, TypeError);
  assert.equal(modes.isCurrent({ generation: 1, mode: 'replay' }), false);
});
