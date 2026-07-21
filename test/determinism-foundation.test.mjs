import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_RNG_STREAMS,
  RNG_ALGORITHM,
  createRngSuite,
  normalizeSeed,
} from '../web/js/rng.js';
import {
  STATE_HASH_ALGORITHM,
  hashState,
  stableStringify,
  xxh64,
} from '../web/js/state-hash.js';

const vectors = JSON.parse(await readFile(new URL('./determinism-vectors.json', import.meta.url), 'utf8'));
const stateHex = (generator) => generator.snapshot().state.map((word) => word.toString(16).padStart(8, '0'));

test('xoshiro128** named streams match the published v1 vectors', () => {
  const suite = createRngSuite({
    algorithm: vectors.rng.algorithm,
    seed: vectors.rng.seed,
    streams: Object.keys(vectors.rng.streams),
  });
  assert.equal(RNG_ALGORITHM, vectors.rng.algorithm);
  assert.equal(suite.seed, vectors.rng.seed);
  for (const [name, vector] of Object.entries(vectors.rng.streams)) {
    const generator = suite.stream(name);
    assert.deepEqual(stateHex(generator), vector.initialStateHex, `${name} initial state`);
    assert.deepEqual(Array.from({ length: vector.firstU32.length }, () => generator.nextU32()), vector.firstU32, `${name} output`);
    assert.equal(generator.draws, vector.firstU32.length, `${name} draw count`);
  }
});

test('presentation streams cannot perturb canonical rules or AI streams', () => {
  const untouched = createRngSuite({ seed: vectors.rng.seed });
  const noisy = createRngSuite({ seed: vectors.rng.seed });
  for (let i = 0; i < 100; i++) {
    noisy.stream('visual').nextU32();
    noisy.stream('audio').nextU32();
  }
  for (const name of ['rules', 'ai:0', 'ai:1']) {
    assert.deepEqual(
      Array.from({ length: 16 }, () => noisy.stream(name).nextU32()),
      Array.from({ length: 16 }, () => untouched.stream(name).nextU32()),
      name,
    );
  }
  assert.deepEqual(Object.keys(noisy.snapshot({ canonicalOnly: true })), ['rules', 'ai:0', 'ai:1']);
});

test('RNG snapshots restore the exact continuation', () => {
  const suite = createRngSuite({ seed: 'daily-challenge-001', streams: DEFAULT_RNG_STREAMS });
  const rules = suite.stream('rules');
  for (let i = 0; i < 7; i++) rules.nextU32();
  const snapshot = rules.snapshot();
  const expected = Array.from({ length: 12 }, () => rules.nextU32());
  rules.restore(snapshot);
  assert.deepEqual(Array.from({ length: 12 }, () => rules.nextU32()), expected);
  assert.equal(rules.draws, snapshot.draws + expected.length);
  assert.equal(normalizeSeed(-1), '0xffffffffffffffff');
});

test('xxh64 matches published seed-zero vectors', () => {
  assert.equal(STATE_HASH_ALGORITHM, 'xxh64-v1');
  for (const [source, expected] of Object.entries(vectors.xxh64)) assert.equal(xxh64(source), expected, source);
});

test('hashState is stable across object key order and JSON edge cases', () => {
  const state = {
    turn: 'G',
    ignored: undefined,
    meta: { z: 2, a: 1 },
    cells: [null, 'T', 'G'],
  };
  const reordered = {
    cells: [null, 'T', 'G'],
    meta: { a: 1, z: 2 },
    turn: 'G',
  };
  assert.equal(stableStringify(state), vectors.stateHash.canonical);
  assert.equal(stableStringify(reordered), vectors.stateHash.canonical);
  assert.equal(hashState(state), vectors.stateHash.hex);
  assert.equal(hashState(reordered), vectors.stateHash.hex);
  assert.equal(stableStringify([1, undefined, Number.NaN, , 4]), '[1,null,null,null,4]');
});

test('canonical state rejects cycles and non-JSON object types', () => {
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => stableStringify(cyclic), /cycles/);
  assert.throws(() => stableStringify(new Map()), /plain objects/);
  assert.throws(() => stableStringify({ counter: 1n }), /bigint/);
});
