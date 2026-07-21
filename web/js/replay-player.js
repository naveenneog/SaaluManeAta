// replay-player.js — minimal deterministic replay of an action-log through the engine adapter.
// Steps through the recorded actions, re-deriving canonical state, and calls onState after each —
// the substrate for the first-run auto-demo, an AI-vs-AI spectate mode, and (wrapped) the v1.7
// scrubbable viewer. Dependency-light + byte-identical across games (drift-guarded).
//
//   initReplayPlayer({ adapter, onState, onComplete, stepMs }) -> {
//     load(log), play({stepMs?}), pause(), step(), seek(index), restart(), exit(),
//     get index, get total, get state, get playing
//   }
// adapter = the action-log adapter { setup(log)->{state,rng}, apply(state,entry,rng)->state, restore? }.
// onState(state, index) fires after load and each applied action; onComplete() fires at the end.
import { derive } from './action-log.js';

export function initReplayPlayer({ adapter, onState, onComplete, stepMs = 900 } = {}) {
  if (!adapter || typeof adapter.setup !== 'function' || typeof adapter.apply !== 'function') {
    throw new TypeError('initReplayPlayer requires an adapter with setup() and apply()');
  }
  let log = null;
  let i = 0;
  let state = null;
  let rng = null;
  let playing = false;
  let timer = null;

  function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }

  function load(l) {
    playing = false; clearTimer();
    log = l; i = 0;
    // derive at index 0 (honors an action-0 checkpoint — e.g. a scenario's initial `state`),
    // not a raw adapter.setup which would ignore it.
    const s = derive(log, adapter, 0);
    state = s.state; rng = s.rng;
    onState?.(state, i);
    return api;
  }

  function step() {
    if (!log || i >= log.actions.length) return false;
    state = adapter.apply(state, log.actions[i], rng);
    i += 1;
    onState?.(state, i);
    if (i >= log.actions.length) { playing = false; clearTimer(); onComplete?.(); }
    return true;
  }

  function play({ stepMs: ms } = {}) {
    if (!log || playing || i >= log.actions.length) return api;
    playing = true;
    const tick = () => { if (!playing) return; if (!step()) { playing = false; return; } timer = setTimeout(tick, ms ?? stepMs); };
    timer = setTimeout(tick, ms ?? stepMs);
    return api;
  }

  function pause() { playing = false; clearTimer(); return api; }

  // Jump to an absolute action index (re-derives via action-log.derive, using checkpoints if any).
  function seek(index) {
    if (!log) return api;
    const n = Math.max(0, Math.min(Math.trunc(index), log.actions.length));
    const r = derive(log, adapter, n);
    state = r.state; rng = r.rng; i = n;
    onState?.(state, i);
    return api;
  }

  function restart() { return load(log); }

  function exit() { playing = false; clearTimer(); log = null; state = null; rng = null; i = 0; }

  const api = {
    load, play, pause, step, seek, restart, exit,
    get index() { return i; },
    get total() { return log ? log.actions.length : 0; },
    get state() { return state; },
    get playing() { return playing; },
  };
  return api;
}
