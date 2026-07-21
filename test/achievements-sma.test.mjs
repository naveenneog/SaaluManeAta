import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateAchievementRegistry, evaluateAchievements, newUnlocks, recordUnlocks } from '../web/js/achievements.js';
import { createSmaAchievementEvaluators } from '../web/js/achievement-insights.js';
import { isContentId } from '../web/js/content-id.js';
import { initProfile } from '../web/js/profile.js';
import { createLog, append } from '../web/js/action-log.js';
import { newGame, applyMove, canonicalState, bestMove, other } from '../web/js/logic.js';
import { hashState } from '../web/js/state-hash.js';
import { createRngSuite } from '../web/js/rng.js';

const dir = fileURLToPath(new URL('../web/achievements/', import.meta.url));
const registry = JSON.parse(await readFile(`${dir}registry.json`, 'utf8'));
const catalog = JSON.parse(await readFile(`${dir}content.en.json`, 'utf8'));

const adapter = {
  setup: () => ({ state: newGame(), rng: createRngSuite({ seed: 'sma' }) }),
  apply: (st, entry) => applyMove(st, entry.action),
  hash: (st) => hashState(canonicalState(st)),
};
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }; };

function playGame() {
  const log = createLog({ game: 'sma', engine: { version: '1.5.0' }, ruleset: { id: 'sma.base', version: 1 }, world: 'saalu', rng: createRngSuite({ seed: 'sma', streams: ['rules'] }) });
  let state = newGame();
  let guard = 0;
  while (state.winner === null && guard++ < 500) {
    const move = bestMove(state, 2);
    if (!move) { state = { ...state, winner: other(state.turn) }; break; }
    const side = state.turn;
    state = applyMove(state, move);
    append(log, { side, action: move, stateHash: hashState(canonicalState(state)) });
  }
  return { state, log };
}

test('the SMA achievement registry is valid and every key is a catalogued content-id', () => {
  assert.equal(validateAchievementRegistry(registry), true);
  assert.equal(registry.achievements.length, 9);
  for (const a of registry.achievements) {
    for (const key of [a.titleKey, a.descKey]) {
      assert.ok(isContentId(key), `${a.id}: ${key} not a content-id`);
      assert.ok(catalog[key] && catalog[key].trim(), `${a.id}: no English for ${key}`);
    }
  }
});

test('a completed live game unlocks the expected achievements, idempotently', () => {
  const { state, log } = playGame();
  assert.ok(log.actions.length > 0);
  const profile = initProfile({ id: 'sma', storage: memStorage() });
  profile.load();
  profile.bump('games.played');
  if (state.winner === 0) profile.bump('games.won');

  const evaluators = createSmaAchievementEvaluators({ adapter });
  const results = evaluateAchievements(registry, { profile: profile.snapshot(), log, finalState: state, evaluators, context: { source: 'live' } });
  assert.equal(results.length, 9);

  const unlocked = newUnlocks(results, profile.snapshot());
  const ids = new Set(unlocked.map((u) => u.id));
  assert.ok(ids.has('first-match'));
  // a substantial morris game always closes at least one mill, so first-mill must be earned
  assert.ok(ids.has('first-mill'), 'first-mill should unlock from a completed game');

  assert.equal(recordUnlocks(profile, unlocked).length, unlocked.length);
  const again = newUnlocks(evaluateAchievements(registry, { profile: profile.snapshot(), log, finalState: state, evaluators, context: { source: 'live' } }), profile.snapshot());
  assert.equal(again.length, 0);
});
