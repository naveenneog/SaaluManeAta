import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReplayNarrator,
  formatReplayText,
  validateNarrationDescriptor,
} from '../web/js/replay-narration.js';

test('narration descriptors require content IDs and bounded primitive params', () => {
  const descriptor = validateNarrationDescriptor({
    key: 'ah.replay.goat.place',
    params: { node: 4, side: 'goat' },
    focus: [4],
  });
  assert.equal(descriptor.key, 'ah.replay.goat.place');
  assert.throws(() => validateNarrationDescriptor({ key: 'A goat moved' }), /content id/);
  assert.throws(() => validateNarrationDescriptor({
    key: 'ah.replay.goat.place',
    params: { nested: { no: true } },
  }), /bounded/);
});

test('formatting substitutes only named own params', () => {
  assert.equal(formatReplayText('{side} moved to {node}.', { side: 'Goat', node: 4 }), 'Goat moved to 4.');
  assert.equal(formatReplayText('{missing} stays.', Object.create({ missing: 'bad' })), '{missing} stays.');
});

test('narrator selects before translation and speaks only when requested', () => {
  const spoken = [];
  const narrator = createReplayNarrator({
    describe: ({ entry }) => ({
      key: 'ah.replay.goat.place',
      params: { node: entry.action.to },
      focus: [entry.action.to],
    }),
    translate: (key) => key === 'ah.replay.goat.place' ? 'A goat entered point {node}.' : key,
    narrate: (text) => spoken.push(text),
  });
  const quiet = narrator.present({ entry: { action: { to: 4 } } });
  assert.equal(quiet.text, 'A goat entered point 4.');
  assert.deepEqual(spoken, []);
  narrator.present({ entry: { action: { to: 7 } } }, { speak: true });
  assert.deepEqual(spoken, ['A goat entered point 7.']);
});

test('invalid or failing per-game describers degrade to no narration', () => {
  const rawEnglish = createReplayNarrator({ describe: () => ({ key: 'Raw English' }) });
  assert.equal(rawEnglish.present({}), null);
  const throwing = createReplayNarrator({ describe: () => { throw new Error('nope'); } });
  assert.equal(throwing.present({}), null);
});

