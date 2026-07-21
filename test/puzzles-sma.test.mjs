import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validatePuzzle, verifyPuzzle } from '../web/js/puzzle.js';
import { makeSmaPuzzleIface } from '../web/js/puzzle-sma.js';
import { isContentId } from '../web/js/content-id.js';

const DIR = fileURLToPath(new URL('../web/assets/puzzles/sma/', import.meta.url));
const iface = makeSmaPuzzleIface();
const readJson = async (name) => JSON.parse(await readFile(`${DIR}${name}`, 'utf8'));

const index = await readJson('index.json');
const specs = await Promise.all(index.puzzles.map((p) => readJson(`${p.id}.json`)));

test('the daily-puzzle pool is six puzzles, 2 easy / 2 medium / 2 hard', () => {
  assert.equal(index.game, 'sma');
  assert.equal(specs.length, 6);
  const byDiff = specs.reduce((m, s) => ({ ...m, [s.difficulty]: (m[s.difficulty] || 0) + 1 }), {});
  assert.deepEqual(byDiff, { easy: 2, medium: 2, hard: 2 });
});

test('every shipped puzzle validates and its stored solution is legal, on-goal and at par', () => {
  for (const spec of specs) {
    assert.equal(validatePuzzle(spec, { game: 'sma' }), true);
    const result = verifyPuzzle(spec, iface);
    assert.equal(result.ok, true, `${spec.id}: ${result.reason || ''}`);
    assert.equal(result.moves, spec.solution.length);
    assert.equal(result.par, spec.par);
  }
});

test('no puzzle file is orphaned (every .json is in the index)', async () => {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.json') && f !== 'index.json');
  assert.equal(files.length, index.puzzles.length);
  const ids = new Set(index.puzzles.map((p) => p.id));
  for (const f of files) assert.ok(ids.has(f.replace('.json', '')), `${f} missing from index`);
});

test('puzzle text is keyed by content-ids with an English catalog entry (no raw English keys)', async () => {
  const catalog = JSON.parse(await readFile(fileURLToPath(new URL('../web/puzzles/content.en.json', import.meta.url)), 'utf8'));
  for (const spec of specs) {
    for (const key of [spec.titleKey, spec.briefKey, ...spec.hintKeys]) {
      assert.ok(isContentId(key), `${spec.id}: "${key}" is not a content-id`);
      assert.ok(catalog[key] && catalog[key].trim(), `${spec.id}: no English catalog entry for ${key}`);
    }
  }
});
