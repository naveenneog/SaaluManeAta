// Saalu Mane Ata (Navakankari / Nine Men's Morris) — pure rules engine. No DOM.
//
// Three nested squares joined at their side midpoints: 24 points, 9 pieces each.
// Phase 1 place, phase 2 move to an adjacent point, phase 3 "fly" anywhere once
// reduced to three. Completing a mill (three in a connected straight line — never
// a diagonal) removes an enemy piece. You lose at two pieces or with no move.
//
// Original intent (research): alignment, foresight, planning and blocking — it
// "enhances logical thinking, foresight and strategic decision-making".

// 24 points as (x,y) on a 0..6 grid over three rings (0 outer, 1 middle, 2 inner).
export const POINTS = [
  [0, 6, 0], [3, 6, 0], [6, 6, 0],           // 0 a7  1 d7  2 g7
  [1, 5, 1], [3, 5, 1], [5, 5, 1],           // 3 b6  4 d6  5 f6
  [2, 4, 2], [3, 4, 2], [4, 4, 2],           // 6 c5  7 d5  8 e5
  [0, 3, 0], [1, 3, 1], [2, 3, 2],           // 9 a4  10 b4 11 c4
  [4, 3, 2], [5, 3, 1], [6, 3, 0],           // 12 e4 13 f4 14 g4
  [2, 2, 2], [3, 2, 2], [4, 2, 2],           // 15 c3 16 d3 17 e3
  [1, 1, 1], [3, 1, 1], [5, 1, 1],           // 18 b2 19 d2 20 f2
  [0, 0, 0], [3, 0, 0], [6, 0, 0],           // 21 a1 22 d1 23 g1
];

export const ADJ = [
  [1, 9], [0, 2, 4], [1, 14],
  [4, 10], [3, 5, 1, 7], [4, 13],
  [7, 11], [6, 8, 4], [7, 12],
  [0, 21, 10], [3, 18, 9, 11], [6, 15, 10],
  [8, 17, 13], [5, 20, 14, 12], [2, 23, 13],
  [11, 16], [15, 17, 19], [12, 16],
  [10, 19], [18, 20, 16, 22], [13, 19],
  [9, 22], [21, 23, 19], [14, 22],
];

export const MILLS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11], [12, 13, 14], [15, 16, 17], [18, 19, 20], [21, 22, 23],
  [0, 9, 21], [3, 10, 18], [6, 11, 15], [1, 4, 7], [16, 19, 22], [8, 12, 17], [5, 13, 20], [2, 14, 23],
];

// mills touching each point (precomputed)
export const MILLS_AT = POINTS.map((_, i) => MILLS.filter((m) => m.includes(i)));

export const PIECES = 9;

export function newGame() {
  return {
    points: new Array(24).fill(null),   // null | 0 | 1
    turn: 0,
    toPlace: [PIECES, PIECES],
    onBoard: [0, 0],
    removePending: false,               // a mill was just formed; remove an enemy
    winner: null,
    lastMill: null,
    event: null,
  };
}

function clone(s) { return { ...s, points: s.points.slice(), toPlace: s.toPlace.slice(), onBoard: s.onBoard.slice() }; }

export const other = (p) => (p === 0 ? 1 : 0);
export const totalPieces = (s, p) => s.onBoard[p] + s.toPlace[p];
export const inPlacing = (s) => s.toPlace[s.turn] > 0;
export const canFly = (s, p) => s.toPlace[p] === 0 && s.onBoard[p] === 3;

// does placing/having `p` at point `at` complete a mill?
function millAt(points, at, p) {
  return MILLS_AT[at].some((m) => m.every((x) => (x === at ? true : points[x] === p)));
}
function inAnyMill(points, at, p) {
  return MILLS_AT[at].some((m) => m.every((x) => points[x] === p));
}

// ---------------------------------------------------------------- legal moves
// { type:'place', to } | { type:'move', from, to } | { type:'remove', at }
export function legalMoves(state, side = state.turn) {
  const { points } = state;
  if (state.removePending) {
    const enemy = other(side);
    const all = [];
    let allInMills = true;
    for (let i = 0; i < 24; i++) if (points[i] === enemy) { all.push(i); if (!inAnyMill(points, i, enemy)) allInMills = false; }
    const targets = allInMills ? all : all.filter((i) => !inAnyMill(points, i, enemy));
    return targets.map((at) => ({ type: 'remove', at }));
  }
  const moves = [];
  if (state.toPlace[side] > 0) {
    for (let i = 0; i < 24; i++) if (points[i] === null) moves.push({ type: 'place', to: i });
    return moves;
  }
  const fly = canFly(state, side);
  for (let i = 0; i < 24; i++) {
    if (points[i] !== side) continue;
    const dests = fly ? points.map((v, j) => (v === null ? j : -1)).filter((j) => j >= 0) : ADJ[i].filter((j) => points[j] === null);
    for (const to of dests) moves.push({ type: 'move', from: i, to });
  }
  return moves;
}

// ---------------------------------------------------------------- apply move
export function applyMove(state, move) {
  const s = clone(state);
  const p = state.turn;
  const ev = { type: move.type, side: p, mill: false, from: move.from ?? null, to: move.to ?? null, removed: null };
  if (move.type === 'remove') {
    s.points[move.at] = null; s.onBoard[other(p)] -= 1;
    s.removePending = false; ev.removed = move.at;
    s.turn = other(p);
    resolveWin(s);
    s.event = ev; s.lastMill = null;
    return s;
  }
  if (move.type === 'place') { s.points[move.to] = p; s.toPlace[p] -= 1; s.onBoard[p] += 1; }
  else { s.points[move.from] = null; s.points[move.to] = p; }
  if (millAt(s.points, move.to, p)) {
    ev.mill = true; s.lastMill = MILLS_AT[move.to].find((m) => m.every((x) => s.points[x] === p));
    // if the opponent has any removable piece, stay to remove; else pass
    s.removePending = true;
    if (legalMoves(s, p).length === 0) { s.removePending = false; s.turn = other(p); }
  } else {
    s.turn = other(p);
  }
  s.event = ev;
  resolveWin(s);
  return s;
}

// The move object IS the action; applyMove is the pure applier. canonicalState is the subset
// hashed for replay verification (excludes `event`/`lastMill`, which are presentational).
export function canonicalState(state) {
  return {
    points: state.points.slice(),
    turn: state.turn,
    toPlace: state.toPlace.slice(),
    onBoard: state.onBoard.slice(),
    removePending: state.removePending,
    winner: state.winner,
  };
}

function resolveWin(s) {
  for (const p of [0, 1]) {
    if (s.toPlace[p] === 0 && s.onBoard[p] < 3) { s.winner = other(p); return; }
  }
  // side to move with no legal move (and nothing left to place) loses
  if (!s.removePending && s.toPlace[s.turn] === 0 && legalMoves(s, s.turn).length === 0) {
    s.winner = other(s.turn);
  }
}

// ---------------------------------------------------------------- evaluation + AI
// Positive favours player 0. Mills, material, mobility and "almost-mills".
export function evaluate(state, forP = 0) {
  if (state.winner !== null) return state.winner === forP ? 100000 : -100000;
  const s = (p) => {
    let mills = 0, twos = 0;
    for (const m of MILLS) {
      const vals = m.map((x) => state.points[x]);
      const mine = vals.filter((v) => v === p).length, empt = vals.filter((v) => v === null).length;
      if (mine === 3) mills++; else if (mine === 2 && empt === 1) twos++;
    }
    const mob = legalMoves({ ...state, turn: p, removePending: false }).length;
    return state.onBoard[p] * 8 + mills * 14 + twos * 4 + mob * 0.6;
  };
  const score = s(forP) - s(other(forP));
  return forP === 0 ? score : -score;
}

function order(state) {
  const mv = legalMoves(state);
  // try mill-forming / removals first for better pruning
  return mv.sort((a, b) => rank(state, b) - rank(state, a)).slice(0, state.toPlace[state.turn] > 0 ? 16 : 24);
}
function rank(state, m) {
  if (m.type === 'remove') return 5;
  const p = state.turn;
  const pts = state.points.slice();
  if (m.type === 'move') pts[m.from] = null;
  pts[m.to] = p;
  return millAt(pts, m.to, p) ? 4 : 0;
}

function search(state, depth, alpha, beta, root) {
  if (state.winner !== null || depth <= 0) return evaluate(state, root);
  const max = state.turn === root;
  const moves = order(state);
  if (!moves.length) return evaluate(state, root);
  if (max) {
    let best = -Infinity;
    for (const m of moves) { best = Math.max(best, search(applyMove(state, m), depth - 1, alpha, beta, root)); alpha = Math.max(alpha, best); if (alpha >= beta) break; }
    return best;
  }
  let best = Infinity;
  for (const m of moves) { best = Math.min(best, search(applyMove(state, m), depth - 1, alpha, beta, root)); beta = Math.min(beta, best); if (alpha >= beta) break; }
  return best;
}

// level: 1 gentle .. 3 sharp. Returns a legal move for the side to move.
export function bestMove(state, level = 2) {
  const moves = order(state);
  if (moves.length <= 1) return moves[0] || null;
  const depth = [0, 2, 3, 4][level] || 3;
  const root = state.turn;
  let best = moves[0], bestScore = -Infinity;
  for (const m of moves) {
    const sc = search(applyMove(state, m), depth - 1, -Infinity, Infinity, root);
    if (sc > bestScore) { bestScore = sc; best = m; }
  }
  return best;
}

// ---------------------------------------------------------------- world data
export function validateWorld(w) {
  const need = (c, m) => { if (!c) throw new Error(`world ${w && w.id}: ${m}`); };
  need(w && w.id && w.title, 'id + title required');
  need(w.kannada && w.kannada.length, 'kannada name required');
  const hex = /^#[0-9a-fA-F]{6}$/;
  for (const k of ['bg', 'board', 'node', 'p0', 'p1', 'accent', 'text']) need(hex.test((w.theme || {})[k] || ''), `theme.${k} hex`);
  need(w.sides && w.sides.p0 && w.sides.p1, 'sides.p0/p1 labels');
  need(typeof w.intent === 'string' && w.intent.length > 12, 'intent line');
  for (const k of ['mill', 'win', 'lose']) {
    const bank = (w.teachings || {})[k];
    need(Array.isArray(bank) && bank.length > 0, `teachings.${k} bank`);
    for (const t of bank) need(t && t.text && t.text.length > 8, `teachings.${k} substantial`);
  }
  return true;
}
