// recap-insights.js (Saalu Mane Ata) — deterministic, evidence-only recap candidates over the action
// log. Facts only: the mill-and-capture, the decisive mill, a strictly one-ply-proven "an open line
// was left" (only when a legal alternative would have occupied the completing point), and the flying
// transition. No search, no wall-clock, no locale-dependent decisions.
import { legalMoves, other } from './logic.js';
import { boundedAlternatives } from './recap.js';

export const SMA_RECAP_KEYS = Object.freeze({
  millCapture: 'sma.recap.mill.capture',
  millDeciding: 'sma.recap.mill.deciding',
  lineLeftOpen: 'sma.recap.line.left-open',
  flyingBegins: 'sma.recap.flying.begins',
});

const strength = (state, side) => state.onBoard[side] + state.toPlace[side];
const material = (state, side) => strength(state, side) - strength(state, other(side));
const focusOf = (ev) => [ev.to, ev.from, ev.removed].filter(Number.isSafeInteger);

export function analyzeSmaTransition({ before, after, entry, next }, context) {
  const candidates = [];
  const ev = after.event;
  if (!ev || ev.side == null) return candidates;
  const side = ev.side;

  // decisive removal — reducing the rival below three or to no move ends the game
  if (ev.type === 'remove' && after.winner != null) {
    candidates.push({ kind: 'sma-mill-win', score: 1000, sentenceKey: SMA_RECAP_KEYS.millDeciding, params: {}, focus: focusOf(ev), terminal: true });
    return candidates;
  }

  // a mill formed by this place/move — the mill-and-capture moment (lead judged after the removal)
  if (ev.mill) {
    const afterRemoval = (next?.after?.event?.type === 'remove' && next.after.event.side === side) ? next.after : after;
    const leadBonus = material(afterRemoval, side) > 0 ? 120 : 0;
    candidates.push({
      kind: 'sma-mill',
      score: 220 + leadBonus,
      sentenceKey: SMA_RECAP_KEYS.millCapture,
      params: {},
      focus: focusOf(ev),
      coexistsWithTerminal: next?.after?.winner != null,
    });
  }

  // flying begins — a side reduced to exactly three on the board (all placed) may now fly anywhere.
  // The reduction happens on the opponent's removal, so check both sides, not just the mover.
  for (const s of [0, 1]) {
    if (before.onBoard[s] > 3 && after.onBoard[s] === 3 && after.toPlace[s] === 0) {
      candidates.push({ kind: 'sma-flying', score: 80, sentenceKey: SMA_RECAP_KEYS.flyingBegins, params: {}, focus: focusOf(ev) });
    }
  }

  // missed block — STRICTLY evidenced one-ply: next action the rival completes a mill at point P, and a
  // legal alternative for this side would have occupied P (blocking that exact mill).
  const nextEv = next?.after?.event;
  if (nextEv && nextEv.mill && nextEv.side === other(side) && Number.isSafeInteger(nextEv.to) && context.budget.consume(2)) {
    const point = nextEv.to;
    const bounded = boundedAlternatives(legalMoves(before, side), context);
    if (bounded && bounded.some((move) => move.to === point)) {
      candidates.push({ kind: 'sma-line-open', score: 90, sentenceKey: SMA_RECAP_KEYS.lineLeftOpen, params: {}, focus: [point] });
    }
  }

  return candidates;
}

export const analyzeTransition = analyzeSmaTransition;
