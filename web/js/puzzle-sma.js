// puzzle-sma.js — Saalu Mane Ata's per-game glue for the shared puzzle engine (puzzle.js). Provides
// the action-log engine adapter (used to derive a puzzle's start position) and a solver `iface`
// (legalActions / apply / hash + custom goal evaluators). NOT a shared module — each game's rules differ.
//
// Puzzle design rule (so the BFS solver never explores the opponent's reply): a puzzle's goal must be
// reachable within a single uninterrupted solver turn — a mill keeps the turn to `remove`, so
// place/move + optional remove is one turn; the goal is evaluated on the state at/within that turn.
import { newGame, legalMoves, applyMove, canonicalState, other } from './logic.js';
import { hashState } from './state-hash.js';
import { createRngSuite } from './rng.js';

export const smaEngine = {
  setup: () => ({ state: newGame(), rng: createRngSuite({ seed: 'sma' }) }),
  apply: (state, entry) => applyMove(state, entry.action),
  restore: (log, saved) => ({ state: saved.state, rng: createRngSuite({ seed: 'sma' }) }),
  hash: (state) => hashState(canonicalState(state)),
};

export function makeSmaPuzzleIface() {
  return {
    engine: smaEngine,
    legalActions: (state) => (state.winner != null ? [] : legalMoves(state)),
    apply: (state, move) => applyMove(state, move),
    hash: (state) => hashState(canonicalState(state)),
    evaluators: {
      // the rival's total remaining strength (on board + still to place) is at most `n`
      rivalDownTo: (state, goal) => (state.onBoard[other(goal.side)] + state.toPlace[other(goal.side)]) <= goal.n,
      // a specific rival point has been cleared (used to force the pedagogically-correct capture)
      rivalRemoved: (state, goal) => state.points[goal.at] !== goal.rival,
    },
  };
}
