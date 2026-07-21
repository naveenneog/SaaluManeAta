import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decode,
  encode,
  MAX_CHALLENGE_HASH,
  validateChallenge,
} from '../web/js/challenge-link.js';

const puzzle = {
  game: 'ah',
  puzzleId: 'ah.puzzle.tiger-leap',
  ruleset: { id: 'ah.base', version: 1 },
  params: { world: 'parampare' },
};

test('puzzle challenge links round-trip through compressed canonical JSON', async () => {
  const hash = await encode(puzzle);
  assert.match(hash, /^#c=1\./);
  assert.ok(hash.length <= MAX_CHALLENGE_HASH);
  assert.deepEqual(await decode(hash), puzzle);
});

test('seed challenges round-trip and property order does not change the link', async () => {
  const first = { game: 'am', seed: 'daily-2026-07-14', params: { level: 2, world: 'parampare' } };
  const second = { params: { world: 'parampare', level: 2 }, seed: 'daily-2026-07-14', game: 'am' };
  assert.equal(await encode(first), await encode(second));
  assert.deepEqual(await decode(await encode(first)), second);
});

test('challenge schema requires exactly one puzzle id or seed', () => {
  assert.throws(() => validateChallenge({ game: 'ah' }), /exactly one/);
  assert.throws(() => validateChallenge({ game: 'ah', puzzleId: 'a.b.c', seed: 1 }), /exactly one/);
  assert.throws(() => validateChallenge({ ...puzzle, extra: true }), /unknown/);
});

test('decode never throws for corruption, hostile shapes, or oversized input', async () => {
  const valid = await encode(puzzle);
  const corrupt = `${valid.slice(0, -1)}${valid.endsWith('0') ? '1' : '0'}`;
  assert.equal(await decode(corrupt), null);
  assert.equal(await decode('#c=1.%%%%.00000000'), null);
  assert.equal(await decode(`#c=${'x'.repeat(MAX_CHALLENGE_HASH)}`), null);
  assert.equal(await decode(null), null);
});

test('encode enforces data and size caps', async () => {
  await assert.rejects(encode({ ...puzzle, params: { text: 'x'.repeat(500) } }), /too long/);
  await assert.rejects(encode({ ...puzzle, params: { bad: undefined } }), /plain data|unsupported|JSON/);
});
