// save.js — versioned auto-save / resume + a "take back my move" undo, shared across the
// four games (identical copy in each web/js/, like tutorial.js / grand.js). Game state is
// the pure engine's plain object, so it JSON round-trips. The game supplies:
//   serialize()      -> a snapshot of the current game state
//   restore(state)   -> rebuild the board from a snapshot and resume that turn
//   isMyTurn(state)  -> true when it's a human decision point (so Undo rewinds past the
//                       AI's reply, back to the player's own last move)
// Undo is only safe when the game is idle — the caller disables the button while busy and
// cancels any in-flight AI/animation before calling undo().
const KEY = (id) => `tbg.${id}.save.v1`;
const CAP = 400; // in-memory pre-move snapshots kept for undo

export function initSave({ id, serialize, restore, isMyTurn = () => true }) {
  const stack = []; // pre-move snapshots (JSON strings)
  const snap = () => { try { return JSON.stringify(serialize()); } catch { return null; } };

  // record() — call right BEFORE applying a move (human or AI).
  function record() { const s = snap(); if (s) { stack.push(s); if (stack.length > CAP) stack.shift(); } }

  // persist() — call AFTER a move settles, to auto-save for resume.
  function persist() {
    try { localStorage.setItem(KEY(id), JSON.stringify({ v: 1, at: Date.now(), stack: stack.slice(-80), state: serialize() })); } catch { /* storage full/blocked */ }
  }

  function clear() { stack.length = 0; try { localStorage.removeItem(KEY(id)); } catch { /* ignore */ } }

  function read() { try { return JSON.parse(localStorage.getItem(KEY(id)) || 'null'); } catch { return null; } }

  // hasSaved() — an unfinished game is stored (winner still null/undefined).
  function hasSaved() { const d = read(); const w = d && d.state ? d.state.winner : 1; return !!(d && d.state && (w === null || w === undefined)); }

  // resume() — restore the last auto-saved game and its undo history.
  function resume() {
    const d = read(); if (!d || !d.state) return false;
    stack.length = 0; if (Array.isArray(d.stack)) stack.push(...d.stack);
    try { restore(d.state); return true; } catch { return false; }
  }

  function canUndo() { return stack.some((s) => { try { return isMyTurn(JSON.parse(s)); } catch { return false; } }); }

  // undo() — rewind to the state just before the player's own last move (popping past the
  // AI's reply). Returns true if it restored something.
  function undo() {
    let target = null;
    while (stack.length) { const s = JSON.parse(stack.pop()); target = s; if (isMyTurn(s)) break; }
    if (!target) return false;
    try { restore(target); persist(); return true; } catch { return false; }
  }

  return { record, persist, clear, hasSaved, resume, canUndo, undo };
}
