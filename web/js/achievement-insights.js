// Saalu Mane Ata achievement evidence — derived only from the canonical completed action log.
import { derive } from './action-log.js';

function collect(log, adapter) {
  if (!adapter || typeof adapter.apply !== 'function') {
    throw new TypeError('Saalu Mane Ata achievement evaluators require an action-log adapter');
  }
  const replayed = derive(log, adapter, 0);
  let state = replayed.state;
  let mills = 0;
  let everFlying = false;
  for (const entry of log.actions) {
    state = adapter.apply(state, entry, replayed.rng);
    const ev = state.event;
    if (ev && ev.mill && ev.side === 0) mills += 1;
    if (state.onBoard[0] === 3 && state.toPlace[0] === 0) everFlying = true;
  }
  const won = state.winner === 0;
  return {
    mills,
    flyingWin: won && everFlying ? 1 : 0,
    shutoutWin: won && state.onBoard[1] >= 3 ? 1 : 0, // won by leaving the rival with no move, not by attrition
  };
}

export function createSmaAchievementEvaluators({ adapter } = {}) {
  const cache = new WeakMap();
  const stats = (log) => { if (!cache.has(log)) cache.set(log, collect(log, adapter)); return cache.get(log); };
  return Object.freeze({
    'sma.mills-formed': ({ log }) => stats(log).mills,
    'sma.flying-win': ({ log }) => stats(log).flyingWin,
    'sma.shutout-win': ({ log }) => stats(log).shutoutWin,
  });
}
