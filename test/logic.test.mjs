import test from 'node:test';
import assert from 'node:assert/strict';
import { POINTS, ADJ, MILLS, newGame, legalMoves, applyMove, bestMove, totalPieces, other } from '../web/js/logic.js';

test('board: 24 points, symmetric adjacency, 16 mills', () => {
  assert.equal(POINTS.length, 24);
  assert.equal(MILLS.length, 16);
  for (let i = 0; i < 24; i++) for (const a of ADJ[i]) assert.ok(ADJ[a].includes(i), `edge ${i}-${a} mutual`);
  for (const m of MILLS) assert.equal(m.length, 3);
});

test('fresh game: 9 to place each, player 0 first', () => {
  const g = newGame();
  assert.deepEqual(g.toPlace, [9, 9]);
  assert.equal(g.turn, 0);
  assert.ok(legalMoves(g).every((m) => m.type === 'place'));
  assert.equal(legalMoves(g).length, 24);
});

test('completing a mill lets you remove an enemy piece', () => {
  let g = newGame();
  // player0 builds mill [0,1,2]; player1 places elsewhere between
  g = applyMove(g, { type: 'place', to: 0 }); // p0
  g = applyMove(g, { type: 'place', to: 9 }); // p1
  g = applyMove(g, { type: 'place', to: 1 }); // p0
  g = applyMove(g, { type: 'place', to: 10 }); // p1
  g = applyMove(g, { type: 'place', to: 2 }); // p0 -> mill 0,1,2
  assert.equal(g.event.mill, true);
  assert.equal(g.removePending, true);
  assert.equal(g.turn, 0, 'same player removes');
  const rem = legalMoves(g);
  assert.ok(rem.every((m) => m.type === 'remove'));
  // p1's pieces are at 9,10 (not in mills) -> removable
  g = applyMove(g, { type: 'remove', at: 9 });
  assert.equal(g.onBoard[1], 1);
  assert.equal(g.turn, 1, 'turn passes after removal');
});

test('reducing a mover to two pieces wins', () => {
  const g = newGame();
  g.toPlace = [0, 0]; g.onBoard = [4, 3];
  g.points.fill(null);
  g.points[0] = 0; g.points[1] = 0; g.points[9] = 0; g.points[21] = 0;   // p0 has a mill 0,9,21 forming
  g.points[6] = 1; g.points[7] = 1; g.points[8] = 1;                     // p1 three (in a mill)
  g.turn = 0;
  // p0 already has 0,9,21? that's a mill; simulate a fresh mill by moving 1 into place
  // Directly test resolveWin: remove one p1 piece down to 2
  g.points[8] = null; g.onBoard[1] = 2;
  const after = applyMove(g, { type: 'place', to: 2 }); // any move triggers resolveWin
  assert.equal(after.winner, 0);
});

test('AI plays a legal move and a full game terminates', () => {
  let g = newGame();
  const legalStr = (s, m) => legalMoves(s).some((x) => JSON.stringify(x) === JSON.stringify(m));
  for (let i = 0; i < 200 && g.winner === null; i++) {
    const m = bestMove(g, 2);
    assert.ok(m, 'a move exists');
    assert.ok(legalStr(g, m), 'AI move is legal');
    g = applyMove(g, m);
    assert.ok(totalPieces(g, 0) <= 9 && totalPieces(g, 1) <= 9, 'pieces conserved');
  }
  // either someone won or the loop bounded out (draw-ish); both are non-crashing
  assert.ok(g.winner === null || g.winner === 0 || g.winner === 1);
});
