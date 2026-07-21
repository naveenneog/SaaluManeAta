import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { append, createLog } from '../web/js/action-log.js';
import { exportReplay } from '../web/js/replay-format.js';
import { clampReplayIndex, initReplayUI } from '../web/js/replay-ui.js';
import { hashState } from '../web/js/state-hash.js';

const engine = { version: 'toy-engine-v1' };
const ruleset = { id: 'toy.base', version: 1 };
const adapter = {
  setup: () => ({ state: { total: 0 }, rng: {} }),
  apply: (state, entry) => ({ total: state.total + entry.action.n }),
  hash: hashState,
};
const validateAction = (action) => action?.k === 'add' && Number.isSafeInteger(action.n);
const validation = { game: 'toy', engine, ruleset, validateAction };

function makeLog() {
  const log = createLog({
    game: 'toy',
    engine,
    ruleset,
    world: 'table',
    rng: { algorithm: 'xoshiro128ss-v1', seed: 'replay-ui-test' },
  });
  let total = 0;
  for (const n of [2, 3]) {
    total += n;
    append(log, { side: 0, action: { k: 'add', n }, stateHash: hashState({ total }) });
  }
  return log;
}

test('clampReplayIndex bounds and truncates scrubber values', () => {
  assert.equal(clampReplayIndex(-4, 10), 0);
  assert.equal(clampReplayIndex(4.9, 10), 4);
  assert.equal(clampReplayIndex(40, 10), 10);
});

test('replay UI loads, steps, narrates and restores without persistence hooks', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://example.test/' });
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  try {
    const rendered = [];
    let restored = 0;
    const exported = await exportReplay(makeLog(), { adapter, validateAction });
    const ui = initReplayUI({
      id: 'toy',
      adapter,
      validation,
      renderState: (state, meta) => rendered.push({ state, meta }),
      restoreLive: () => { restored += 1; },
      describeTransition: ({ entry }) => ({
        key: 'toy.replay.add.move',
        params: { count: entry.action.n },
      }),
      translate: (key) => ({
        'toy.replay.add.move': 'Added {count}.',
        Move: 'Move',
        of: 'of',
      }[key] ?? key),
      reducedMotion: true,
    });
    assert.equal(ui.load(exported.envelope), true);
    assert.equal(ui.index, 0);
    assert.equal(ui.step(), true);
    assert.equal(ui.index, 1);
    assert.equal(document.querySelector('#rp-narration').textContent, 'Added 2.');
    assert.equal(rendered.at(-1).meta.animate, false);
    ui.seek(2);
    assert.deepEqual(rendered.at(-1).state, { total: 5 });
    ui.close();
    assert.equal(restored, 1);
    assert.equal(document.body.classList.contains('replay-viewing'), false);
  } finally {
    dom.window.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
  }
});
