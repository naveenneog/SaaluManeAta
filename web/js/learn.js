// learn.js — a calm, narrated "Learn to play" walkthrough that runs ON the real board:
// each step narrates one idea (DragonHD), optionally sets a teaching position, and highlights
// the key spot(s) with the shared coach overlay; the player taps Next to advance. A guided
// demo, not a strict tutor — robust and soothing. Identical copy per game (like tutorial.js).
// Card text + buttons are localized via i18n t(); narration passes the English source as the
// key (audio.js resolves the per-language clip). Bilingual `en` caption stays English.
//
//   initLearn({ id, title, accent, steps, hooks }) -> { start, exit, active }
//   steps: [{ text, en?, position?, highlight?, hint? }]
//     text      – narration + card text for the step
//     en        – short label (Kannada/English) shown above the text
//     position  – an engine state to load for the step (via hooks.applyState); optional
//     highlight – { destination?, danger?(| []), path?, ghosts? } forwarded to the coach overlay
//   hooks: { applyState(state), coach, clearCoach(), narrate(text), freshGame() }
//     While a lesson runs, document.body carries the `tbg-learning` class so the game can
//     ignore board input. Exit/Finish clears the coach and calls freshGame() for a fresh play.
import { t } from './i18n.js';
const STYLE_ID = 'tbg-learn-styles';

function injectStyles() {
  if (document.querySelector('#' + STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    #tbg-learn-btn{position:fixed;z-index:140;right:7rem;bottom:.6rem;min-height:44px;padding:0 .85rem;
      margin-bottom:env(safe-area-inset-bottom,0);display:flex;align-items:center;gap:.3rem;
      border:1px solid color-mix(in srgb,var(--tbg-learn-accent,#e8c24a) 66%,transparent);border-radius:22px;
      background:rgba(13,14,10,.88);color:#f4e7cf;font:inherit;font-weight:600;cursor:pointer;
      box-shadow:0 6px 18px rgba(0,0,0,.42);touch-action:manipulation}
    #tbg-learn-card{position:fixed;left:50%;bottom:5.2rem;transform:translateX(-50%) translateY(12px);
      width:min(92vw,560px);z-index:135;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;
      background:linear-gradient(180deg,rgba(27,28,22,.96),rgba(12,14,9,.985));color:#f4ead2;
      border:1px solid color-mix(in srgb,var(--tbg-learn-accent,#e8c24a) 45%,transparent);border-radius:16px;
      padding:.95rem 1.1rem;box-shadow:0 18px 48px rgba(0,0,0,.5);text-align:center}
    #tbg-learn-card.show{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto}
    #tbg-learn-card .step{color:#cdbb86;font:600 .7rem 'Segoe UI',sans-serif;letter-spacing:.14em;text-transform:uppercase}
    #tbg-learn-card .en{color:var(--tbg-learn-accent,#e8c24a);font:600 1.02rem 'Noto Serif',Georgia,serif;margin:.15rem 0 .3rem}
    #tbg-learn-card .m{font-size:1rem;line-height:1.5;margin:0 0 .85rem}
    #tbg-learn-card .row{display:flex;gap:.55rem;justify-content:center}
    #tbg-learn-card button{min-height:44px;padding:0 1.3rem;border-radius:11px;font:inherit;font-weight:600;cursor:pointer}
    #tbg-learn-next{color:#17210c;background:linear-gradient(180deg,#f2d777,#e8c24a);border:0}
    #tbg-learn-exit{color:#d8cfae;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18)}
    @media(max-width:520px){#tbg-learn-btn{right:6.3rem}#tbg-learn-card{bottom:4.7rem}}
  `;
  document.head.appendChild(s);
}

export function initLearn({ id, title = 'Learn', accent = '#e8c24a', steps = [], hooks = {} }) {
  injectStyles();
  document.documentElement.style.setProperty('--tbg-learn-accent', accent);

  const btn = document.createElement('button');
  btn.id = 'tbg-learn-btn';
  btn.type = 'button';
  btn.textContent = t('🎓 Learn');
  btn.title = t('Guided lesson — learn how to play');
  btn.setAttribute('aria-label', t('Learn how to play'));

  const card = document.createElement('div');
  card.id = 'tbg-learn-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-live', 'polite');
  card.innerHTML = `<div class="step"></div><div class="en"></div><p class="m"></p>
    <div class="row"><button id="tbg-learn-exit" type="button">Exit</button>
    <button id="tbg-learn-next" type="button">Next</button></div>`;
  document.body.append(btn, card);

  const stepEl = card.querySelector('.step');
  const enEl = card.querySelector('.en');
  const mEl = card.querySelector('.m');
  const nextBtn = card.querySelector('#tbg-learn-next');
  const exitBtn = card.querySelector('#tbg-learn-exit');
  exitBtn.textContent = t('Exit');

  let i = -1;
  let active = false;

  function render() {
    const s = steps[i];
    if (!s) return;
    stepEl.textContent = `${t(title)} · ${i + 1} / ${steps.length}`;
    enEl.textContent = s.en || '';
    enEl.style.display = s.en ? '' : 'none';
    mEl.textContent = t(s.text || '');
    nextBtn.textContent = t(i === steps.length - 1 ? 'Finish' : 'Next ›');
    hooks.clearCoach?.();
    if (s.position) hooks.applyState?.(s.position);
    const hl = s.highlight;
    if (hl) {
      if (typeof hl === 'function') hl({ coach: hooks.coach });
      else if (hooks.coach) {
        const c = hooks.coach;
        if (hl.path) c.path(hl.path);
        if (hl.ghosts) c.ghosts(hl.ghosts);
        if (hl.destination) c.destination(hl.destination);
        if (hl.danger) (Array.isArray(hl.danger) ? hl.danger : [hl.danger]).forEach((d) => c.danger(d));
      }
    }
    if (s.text) hooks.narrate?.(s.text);
  }

  function start() {
    if (!steps.length || active) return;
    active = true;
    hooks.setLearning?.(true);
    document.body.classList.add('tbg-learning');
    btn.textContent = t('✕ Exit lesson');
    i = 0;
    card.classList.add('show');
    render();
  }

  function next() {
    if (i < steps.length - 1) { i += 1; render(); } else exit();
  }

  function exit() {
    if (!active) return;
    active = false;
    hooks.setLearning?.(false);
    document.body.classList.remove('tbg-learning');
    btn.textContent = t('🎓 Learn');
    card.classList.remove('show');
    hooks.clearCoach?.();
    hooks.freshGame?.();
  }

  btn.addEventListener('click', () => (active ? exit() : start()));
  nextBtn.addEventListener('click', next);
  exitBtn.addEventListener('click', exit);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && active) exit(); });

  // The game calls this when a move settles; if it matches the current step's expectedMove
  // (a value compared by shape, or a predicate), the lesson auto-advances.
  function notifyMove(move) {
    if (!active) return;
    const exp = steps[i]?.expectedMove;
    if (exp == null) return;
    const match = typeof exp === 'function' ? exp(move) : JSON.stringify(exp) === JSON.stringify(move);
    if (match) setTimeout(next, 450);
  }

  return { start, exit, notifyMove, get active() { return active; } };
}
