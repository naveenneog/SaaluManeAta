// spectate-driver.js — Saalu Mane Ata: produces the next resolved AI move for deterministic AI-vs-AI
// spectate. bestMove (alpha-beta over a stable move ordering) is fully deterministic and RNG-free, so
// every decision declares no rngUses. The move object itself is the action the engine applies.
import { bestMove } from './logic.js';

export function createSmaSpectateDriver({ level = 2 } = {}) {
  return Object.freeze({
    next({ state }) {
      if (state.winner != null) return null;
      const move = bestMove(state, level);
      if (!move || typeof move.type !== 'string') return null;
      const action = { type: move.type };
      if (move.from != null) action.from = move.from;
      if (move.to != null) action.to = move.to;
      if (move.at != null) action.at = move.at;
      return { side: state.turn, action };
    },
  });
}
