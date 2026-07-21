import test from 'node:test';
import assert from 'node:assert/strict';
import { smaBoardModel, drawShareBoard } from '../web/js/share-board.js';
import { newGame, MILLS } from '../web/js/logic.js';

// A canvas-free 2D context that records every drawing op and style assignment.
class MockCtx {
  constructor() { this.ops = []; this._fill = '#000'; this._stroke = '#000'; this.lineWidth = 1; this.lineCap = ''; }
  set fillStyle(v) { this.ops.push(['fillStyle', v]); this._fill = v; }
  get fillStyle() { return this._fill; }
  set strokeStyle(v) { this.ops.push(['strokeStyle', v]); this._stroke = v; }
  get strokeStyle() { return this._stroke; }
  save() { this.ops.push(['save']); }
  restore() { this.ops.push(['restore']); }
  fillRect(...a) { this.ops.push(['fillRect', ...a]); }
  beginPath() { this.ops.push(['beginPath']); }
  arc(...a) { this.ops.push(['arc', ...a]); }
  fill() { this.ops.push(['fill']); }
  stroke() { this.ops.push(['stroke']); }
  moveTo(...a) { this.ops.push(['moveTo', ...a]); }
  lineTo(...a) { this.ops.push(['lineTo', ...a]); }
}
const mkBox = (state) => ({ state, x: 0, y: 0, width: 600, height: 600 });
const styles = (ctx) => ctx.ops.filter((o) => o[0] === 'fillStyle' || o[0] === 'strokeStyle').map((o) => o[1]);

test('smaBoardModel: 24 points, 32 segments (16 mill-lines × 2), fresh board is empty', () => {
  const m = smaBoardModel(newGame());
  assert.equal(m.points.length, 24);
  assert.equal(m.edges.length, 32);
  assert.equal(m.edges.length, MILLS.length * 2);        // every 3-point line contributes two segments
  assert.ok(m.points.every((p) => p.player === null));
  for (const [a, b] of m.edges) assert.ok(a < b && a >= 0 && b < 24);   // canonical, in range
});

test('smaBoardModel: occupancy reflects state.points and rejects non 0/1 values', () => {
  const s = newGame();
  s.points[0] = 0; s.points[1] = 0; s.points[2] = 0; s.points[23] = 1; s.points[5] = 7; // 7 is invalid
  const m = smaBoardModel(s);
  assert.equal(m.points[0].player, 0);
  assert.equal(m.points[23].player, 1);
  assert.equal(m.points[5].player, null);                // invalid occupant ignored
  assert.equal(m.points.filter((p) => p.player != null).length, 4);
});

test('drawShareBoard: draws every edge as a segment and only valid colour strings', () => {
  const ctx = new MockCtx();
  drawShareBoard(ctx, mkBox(newGame()), { world: {} });
  assert.equal(ctx.ops.filter((o) => o[0] === 'moveTo').length, 32);   // one per edge
  assert.equal(ctx.ops.filter((o) => o[0] === 'lineTo').length, 32);
  assert.equal(ctx.ops.filter((o) => o[0] === 'arc').length, 24);      // one node per point
  for (const c of styles(ctx)) {
    assert.equal(typeof c, 'string');
    assert.ok(c.length > 0 && !/undefined|NaN/.test(c), `invalid colour: ${c}`);
  }
  assert.equal(ctx.ops.filter((o) => o[0] === 'save').length, ctx.ops.filter((o) => o[0] === 'restore').length);
});

test('drawShareBoard: occupied points are filled+stroked, empty points only filled', () => {
  const s = newGame();
  s.points[0] = 0; s.points[23] = 1;
  const ctx = new MockCtx();
  drawShareBoard(ctx, mkBox(s), { world: {} });
  // 24 point-arcs each get a fill; the 2 occupied ones additionally get a stroke (edges already stroked once as a batch)
  const arcFills = ctx.ops.filter((o) => o[0] === 'arc').length;
  assert.equal(arcFills, 24);
});

test('drawShareBoard: output is deterministic for identical state (byte-equal op log)', () => {
  const s = newGame(); s.points[0] = 0; s.points[10] = 1; s.points[19] = 0;
  const a = new MockCtx(); drawShareBoard(a, mkBox(s), { world: {} });
  const b = new MockCtx(); drawShareBoard(b, mkBox(s), { world: {} });
  assert.deepEqual(a.ops, b.ops);
});
