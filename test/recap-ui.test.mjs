import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initRecapUI } from '../web/js/recap-ui.js';

test('recap UI renders with textContent, narrates explicitly, and seeks to after-action state', () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  try {
    const spoken = [];
    const sought = [];
    const ui = initRecapUI({
      translate: (key) => ({
        'ah.recap.capture.swing': 'The tigers reached capture {captured}.',
        Move: 'Move',
      }[key] ?? key),
      narrate: (text) => spoken.push(text),
      onSeek: (stateIndex, moment) => sought.push([stateIndex, moment.index]),
    });
    ui.show({
      moments: [{
        index: 4,
        kind: 'capture-swing',
        score: 120,
        sentenceKey: 'ah.recap.capture.swing',
        params: { captured: 2 },
        focus: [1, 3],
      }],
    });
    const card = document.querySelector('.rc-card');
    assert.equal(card.querySelector('.rc-body p').textContent, 'The tigers reached capture 2.');
    card.querySelector('.rc-actions button').click();
    assert.deepEqual(spoken, ['The tigers reached capture 2.']);
    card.querySelector('.rc-actions button:last-child').click();
    assert.deepEqual(sought, [[5, 4]]);
    ui.close();
    assert.equal(ui.active, false);
  } finally {
    dom.window.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
  }
});

