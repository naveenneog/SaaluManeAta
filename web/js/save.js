// save.js — v2: action-log-canonical autosave / resume + "take back my move" undo.
// Shared, byte-identical across the four games (drift-guarded).
//
// The canonical record is the ACTION LOG (see action-log.js); live state is derived by replaying it
// through the game's engine adapter, and snapshots are cache. Undo = truncate the log back to the
// player's own last decision point + re-derive. A pre-v2 (`v:1`) snapshot save is migrated into a
// single-checkpoint log so an in-progress game is never bricked.
//
//   initSave({ id, adapter, isMyTurn }) -> {
//     begin(log), record(entry), persist(), clear(), hasSaved(),
//     resume() -> { state, log } | null, canUndo(), undo() -> state | null
//   }
// adapter = the action-log adapter { setup, apply, hash, restore? } (same one used for derive()).
// isMyTurn(state) -> true at a human decision point (so undo rewinds past the AI's reply).
import { createLog, append, truncate, derive, checkpoint, deserialize, ACTION_LOG_SCHEMA } from './action-log.js';

const KEY_V2 = (id) => `tbg.${id}.save.v2`;
const KEY_V1 = (id) => `tbg.${id}.save.v1`;
const KEY_V1_BACKUP = (id) => `tbg.${id}.save.v1.backup`;

export function initSave({ id, adapter, isMyTurn = () => true }) {
  let log = null;

  function begin(newLog) { log = newLog; return log; }

  // record() — call AFTER a move settles. entry = { side, action, rngUses?, stateHash? }.
  function record(entry) {
    if (!log) return;
    append(log, entry);
    persist();
  }

  function persist() {
    if (!log) return;
    try { localStorage.setItem(KEY_V2(id), JSON.stringify({ v: 2, at: Date.now(), log })); }
    catch { /* storage full/blocked — persistence is best-effort */ }
  }

  function clear() {
    log = null;
    try { localStorage.removeItem(KEY_V2(id)); localStorage.removeItem(KEY_V1(id)); } catch { /* ignore */ }
  }

  function readV2() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY_V2(id)) || 'null');
      return d && d.log && d.log.schema === ACTION_LOG_SCHEMA ? d.log : null;
    } catch { return null; }
  }
  function readV1() { try { return JSON.parse(localStorage.getItem(KEY_V1(id)) || 'null'); } catch { return null; } }

  const unfinished = (state) => { const w = state ? state.winner : 1; return w === null || w === undefined; };

  // hasSaved() — an unfinished game (v2 log or legacy v1 snapshot) is stored.
  function hasSaved() {
    const v2 = readV2();
    if (v2) { try { return unfinished(derive(v2, adapter).state); } catch { return false; } }
    const v1 = readV1();
    return !!(v1 && v1.state && unfinished(v1.state));
  }

  // Migrate a legacy v1 snapshot into a checkpoint-only log (position preserved, fresh seed) and
  // back up the original. `seedFor` supplies a deterministic seed for the migrated match.
  function migrateV1(v1, seed) {
    const migrated = createLog({ game: id, rng: { algorithm: 'migrated', seed } });
    checkpoint(migrated, { afterAction: 0, state: v1.state, rngState: null, stateHash: null });
    try { localStorage.setItem(KEY_V1_BACKUP(id), JSON.stringify(v1)); } catch { /* ignore */ }
    return migrated;
  }

  // resume() — load the last saved game (v2 log, else migrate a v1 snapshot) and derive its state.
  // Returns { state, log } so the caller can adopt the log, or null if nothing/failed (never throws).
  function resume(seed = 'migrated') {
    try {
      const v2 = readV2();
      if (v2) { const { state } = derive(v2, adapter); log = v2; return { state, log }; }
      const v1 = readV1();
      if (v1 && v1.state) {
        log = migrateV1(v1, seed);
        const { state } = derive(log, adapter);
        persist();
        return { state, log };
      }
    } catch { /* corrupt/incompatible save → fall through to a fresh game */ }
    return null;
  }

  // canUndo() — is there an earlier human decision point to rewind to?
  function canUndo() {
    if (!log || !log.actions.length) return false;
    for (let len = log.actions.length - 1; len >= 0; len -= 1) {
      try { if (isMyTurn(derive(log, adapter, len).state)) return true; } catch { return false; }
    }
    return false;
  }

  // undo() — rewind to just before the player's own last move (past the AI's reply) and re-derive.
  // Returns the restored state, or null. Only safe when idle (caller cancels in-flight AI/animation).
  function undo() {
    if (!log) return null;
    let target = -1;
    for (let len = log.actions.length - 1; len >= 0; len -= 1) {
      let s; try { s = derive(log, adapter, len).state; } catch { return null; }
      if (isMyTurn(s)) { target = len; break; }
    }
    if (target < 0) return null;
    truncate(log, target);
    persist();
    try { return derive(log, adapter).state; } catch { return null; }
  }

  return { begin, record, persist, clear, hasSaved, resume, canUndo, undo, get log() { return log; } };
}
