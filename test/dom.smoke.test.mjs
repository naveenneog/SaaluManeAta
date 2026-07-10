import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const read = async (f) => readFile(fileURLToPath(new URL(`../web/${f}`, import.meta.url)), 'utf8');

test('play.html exposes every id the renderer queries', async () => {
  const d = new JSDOM(await read('play.html')).window.document;
  for (const id of ['stage', 'title', 'kn', 'status', 'thinking', 'card', 'win', 'winTitle', 'winText', 'winAgain', 'p0', 'p1', 'turnLabel', 'turnDot', 'phase', 'restart', 'hint', 'hintBtn']) {
    assert.ok(d.getElementById(id), `#${id} present`);
  }
  for (const sel of ['#card .kind', '#card .en', '#card .m']) assert.ok(d.querySelector(sel), `${sel}`);
  assert.ok((await read('play.html')).includes('importmap'), 'three import map');
});
test('setup.html mounts lobby controls', async () => {
  const d = new JSDOM(await read('setup.html')).window.document;
  for (const id of ['worlds', 'sideRow', 'begin']) assert.ok(d.getElementById(id), `#${id}`);
  for (const a of ['data-mode', 'data-side', 'data-level']) assert.ok(d.querySelector(`[${a}]`), a);
});
test('index links to lobby and APK', async () => {
  const html = await read('index.html');
  assert.ok(html.includes('setup.html'));
  assert.ok(/SaaluManeAta\.apk/.test(html));
});
