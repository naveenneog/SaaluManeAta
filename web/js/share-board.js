// share-board.js — Saalu Mane Ata (Nine Men's Morris): a deterministic, compact board diagram for the
// v1.7 α4 share cards. Two layers:
//   • smaBoardModel(state)     — pure, canvas-free structural description (points + occupancy + edges).
//   • drawShareBoard(ctx,rect,opts) — draws that model onto a 2D context inside a rect {x,y,w,h}.
// Draws public game state only (no seed / profile / install id / name), per the share-card privacy rule.
import { POINTS, ADJ } from './logic.js';

// Unique undirected edges of the board graph (each ADJ pair once). Deterministic module constant.
const EDGES = (() => {
  const out = [];
  ADJ.forEach((nbrs, i) => nbrs.forEach((j) => { if (i < j) out.push([i, j]); }));
  return out;
})();

// Pure structural model of the board for `state`. No canvas, fully deterministic.
export function smaBoardModel(state) {
  const cells = Array.isArray(state?.points) ? state.points : [];
  const points = POINTS.map((p, i) => {
    const player = cells[i];
    return { i, x: p[0], y: p[1], ring: p[2], player: (player === 0 || player === 1) ? player : null };
  });
  return { points, edges: EDGES };
}

function colorFor(theme, player) {
  if (player === 0) return theme.p0 || '#9a6a34';
  if (player === 1) return theme.p1 || '#e8ddc4';
  return theme.node || '#9a7a3a';
}

// Draw the diagram. Matches the share-card `drawBoard(ctx, box)` convention, where
// box = { state, x, y, width, height, locale, kind }. `world` (theme colours) is bound at wiring
// time via a closure since the compositor does not pass it. Returns the model (handy for tests/QA).
export function drawShareBoard(ctx, box, { world = {} } = {}) {
  const { state, x = 0, y = 0, width = 0, height = 0 } = box || {};
  const model = smaBoardModel(state);
  const theme = world.theme || {};
  const s = Math.min(width, height);
  const pad = s * 0.1;                                  // margin so outer ring isn't flush to the edge
  const span = s - pad * 2;
  const ox = x + (width - s) / 2 + pad;
  const oy = y + (height - s) / 2 + pad;
  const px = (gx) => ox + (gx / 6) * span;              // grid 0..6 -> pixels
  const py = (gy) => oy + (1 - gy / 6) * span;          // flip so gy=6 is at the top

  ctx.save();
  ctx.fillStyle = theme.board || '#6a4a24';
  ctx.fillRect(x + (width - s) / 2, y + (height - s) / 2, s, s);

  // board lines (the three nested squares + the four connecting spokes) from the graph edges
  ctx.strokeStyle = theme.node || '#9a7a3a';
  ctx.lineWidth = Math.max(1.5, s * 0.008);
  ctx.lineCap = 'round';
  for (const [a, b] of model.edges) {
    const pa = model.points[a];
    const pb = model.points[b];
    ctx.beginPath();
    ctx.moveTo(px(pa.x), py(pa.y));
    ctx.lineTo(px(pb.x), py(pb.y));
    ctx.stroke();
  }

  // points: empty as a small hollow node, occupied as a filled seed in the owner's colour
  const rEmpty = s * 0.018;
  const rSeed = s * 0.038;
  for (const p of model.points) {
    const cx = px(p.x);
    const cy = py(p.y);
    if (p.player == null) {
      ctx.beginPath();
      ctx.fillStyle = theme.node || '#9a7a3a';
      ctx.arc(cx, cy, rEmpty, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.fillStyle = colorFor(theme, p.player);
      ctx.arc(cx, cy, rSeed, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1, s * 0.004);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.stroke();
    }
  }
  ctx.restore();
  return model;
}
