// auto-demo.js — a skippable, SILENT first-run "watch it play" intro: replays a short curated
// `.tbg-replay` through the game's engine adapter once per game/version, then hands off to normal
// play. Byte-identical across games (drift-guarded). Wraps the shared replay-player.
//
//   await maybeAutoDemo({ id, adapter, applyState, freshState, audio, reducedMotion, replayUrl,
//                         accent, stepMs }) -> boolean   (true if the demo ran)
//
// Guards (per Sol): runs only when unseen; skips (and marks seen) under reduced motion or if the
// replay is missing; temporarily mutes narration/music and restores the prior mute state; never
// touches the live match's RNG/log; on skip OR completion it exits, restores audio, removes the
// Skip control, marks seen, and calls freshState() to start a clean match.
import { initReplayPlayer } from './replay-player.js';
import { t } from './i18n.js';

export async function maybeAutoDemo({
  id, adapter, applyState, freshState, audio,
  reducedMotion = false,
  replayUrl = 'assets/demo/first-run.tbg-replay.json',
  accent = '#e8c24a', stepMs = 1100, capMs = 22000,
} = {}) {
  const key = `tbg.${id}.demo.v1`;
  const markSeen = () => { try { localStorage.setItem(key, '1'); } catch { /* */ } };
  let seen = true; try { seen = !!localStorage.getItem(key); } catch { /* */ }
  if (seen) return false;
  if (reducedMotion) { markSeen(); return false; }

  let replay = null;
  try { const r = await fetch(replayUrl); replay = r.ok ? await r.json() : null; } catch { replay = null; }
  if (!replay || !Array.isArray(replay.actions) || replay.actions.length === 0) { markSeen(); return false; }

  const priorMuted = audio?.isMuted?.() ?? false;
  audio?.setMuted?.(true);
  const overlay = buildOverlay(accent);
  let player = null;

  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(); };
    overlay.onSkip(finish);
    player = initReplayPlayer({ adapter, onState: (s) => applyState?.(s), onComplete: finish, stepMs });
    player.load(replay);
    player.play({ stepMs });
    setTimeout(finish, capMs); // safety cap
  });

  player?.exit();
  audio?.setMuted?.(priorMuted);
  overlay.remove();
  markSeen();
  freshState?.();
  return true;
}

function buildOverlay(accent) {
  const el = document.createElement('div');
  el.id = 'tbg-demo-overlay';
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;z-index:200;left:0;right:0;top:0;display:flex;justify-content:space-between;'
    + 'align-items:center;padding:.6rem 1rem;pointer-events:none;margin-top:env(safe-area-inset-top,0)';
  const badge = document.createElement('span');
  badge.textContent = '\u25B6 ' + t('Demo');
  badge.style.cssText = 'font:600 .8rem "Segoe UI",sans-serif;color:#fff;background:rgba(0,0,0,.5);'
    + 'border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:.3rem .7rem';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.textContent = t('Skip') + ' \u203A';
  btn.setAttribute('aria-label', t('Skip the demo'));
  btn.style.cssText = 'pointer-events:auto;font:600 .85rem "Segoe UI",sans-serif;color:#10141c;'
    + `background:${accent};border:0;border-radius:11px;padding:.5rem .9rem;min-height:40px;cursor:pointer`;
  el.append(badge, btn);
  document.body.appendChild(el);
  return { onSkip: (cb) => btn.addEventListener('click', cb, { once: true }), remove: () => el.remove() };
}
