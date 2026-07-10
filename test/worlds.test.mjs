import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateWorld } from '../web/js/logic.js';

const IDS = ['parampare', 'saalu', 'angadi', 'navagraha'];
const load = async (id) => JSON.parse(await readFile(fileURLToPath(new URL(`../web/worlds/${id}.json`, import.meta.url)), 'utf8'));

for (const id of IDS) {
  test(`world ${id} valid + themed + narratable`, async () => {
    const w = await load(id);
    assert.equal(w.id, id);
    assert.doesNotThrow(() => validateWorld(w));
    assert.ok(w.kannada.length, 'kannada name');
    assert.ok(['original', 'modern', 'fable'].includes(w.era));
    for (const b of ['mill', 'remove', 'win', 'lose']) assert.ok((w.teachings[b] || []).length >= 1, `${b} bank`);
  });
}
test('worlds span original intent and a modern re-reading', async () => {
  const eras = new Set(); for (const id of IDS) eras.add((await load(id)).era);
  assert.ok(eras.has('original') && eras.has('modern'));
});
