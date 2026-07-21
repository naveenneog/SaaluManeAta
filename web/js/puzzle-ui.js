// puzzle-ui.js — the shared, renderer-agnostic chrome + controller for daily-puzzle play. A game3d
// renderer supplies an `iface` (for goal evaluation) and three `hooks` — enter(spec) loads the puzzle
// position into a suspended "puzzle mode", exit() returns to normal play, and (optionally) narrate(text).
// After each move the renderer calls `report(state)`; this module evaluates the goal, shows the solved
// banner, and records the result to the per-install profile. Byte-identical across games (drift-guarded).
//
// Progress recording (per Sol's counter contract): first solve of a puzzle bumps `puzzles.solved`;
// a daily solve additionally `markDaily()`s and bumps `daily.solved` ONLY when today's ordinal is new.
import { evaluateGoal } from './puzzle.js';
import { dailyChallenge } from './daily.js';
import { encode, decode } from './challenge-link.js';
import { t } from './i18n.js';

// ---- pure logic (unit-tested) -------------------------------------------------------------------

export function makeSolvedStore(id, storage = globalThis.localStorage) {
  const key = `tbg.${id}.puzzles.solved.v1`;
  const read = () => { try { return new Set(JSON.parse(storage?.getItem?.(key) || '[]')); } catch { return new Set(); } };
  let set = read();
  return {
    key,
    has: (pid) => set.has(pid),
    all: () => [...set],
    add: (pid) => {
      if (set.has(pid)) return false;
      set.add(pid);
      try { storage?.setItem?.(key, JSON.stringify([...set])); } catch { /* stays in memory */ }
      return true;
    },
  };
}

// Record a solve. Returns { firstTime, dailyCounted }. `profile` is the initProfile() instance (optional).
export function recordSolve({ spec, isDaily = false, profile = null, solvedStore }) {
  const firstTime = solvedStore.add(spec.id);
  if (firstTime) profile?.bump?.('puzzles.solved');
  let dailyCounted = false;
  if (isDaily && profile) {
    const before = profile.snapshot?.().daily?.ordinals?.length ?? 0;
    profile.markDaily?.();
    const after = profile.snapshot?.().daily?.ordinals?.length ?? before;
    if (after > before) { profile.bump?.('daily.solved'); dailyCounted = true; }
  }
  return { firstTime, dailyCounted };
}

export function isSolved(state, spec, iface) {
  return evaluateGoal(state, spec.goal, { hash: iface.hash, evaluators: iface.evaluators });
}

// ---- DOM controller -----------------------------------------------------------------------------

export function initPuzzleUI({ id, accent = '#e8c24a', profile = null, iface, index, hooks = {}, storage } = {}) {
  const solvedStore = makeSolvedStore(id, storage);
  const puzzles = index?.puzzles ?? [];
  const version = index?.version ?? '1.6.0';
  const byId = new Map(puzzles.map((p) => [p.id, p]));
  let active = null;   // { spec, isDaily, moves }
  let hintsUsed = 0;

  injectStyles(accent);
  const els = buildDom(accent);
  els.openBtn.addEventListener('click', openPicker);
  els.pickerClose.addEventListener('click', closePicker);
  els.picker.addEventListener('click', (e) => { if (e.target === els.picker) closePicker(); });
  els.hintBtn.addEventListener('click', showNextHint);
  els.exitBtn.addEventListener('click', () => exit());
  els.retryBtn.addEventListener('click', () => active && start(active.spec, active.isDaily));
  els.nextBtn.addEventListener('click', nextPuzzle);
  els.doneBtn.addEventListener('click', () => exit());
  els.shareBtn.addEventListener('click', () => active && shareChallenge(active.spec));

  // Share the current puzzle as a #c= challenge link (Web Share, else clipboard).
  async function shareChallenge(spec) {
    try {
      const hash = await encode({ game: id, puzzleId: spec.id });
      const url = location.origin + location.pathname + location.search + hash;
      if (navigator.share) { await navigator.share({ title: t('Puzzles'), text: t(spec.titleKey), url }); }
      else { await navigator.clipboard?.writeText(url); els.bannerText.textContent = t('Link copied'); }
    } catch { /* share cancelled or unavailable */ }
  }

  // If the page was opened with a #c= challenge link for THIS game, launch that puzzle. Returns bool.
  async function launchFromHash(hash = location.hash) {
    try {
      const ch = await decode(hash);
      if (ch && ch.game === id && ch.puzzleId && byId.has(ch.puzzleId)) { start(byId.get(ch.puzzleId), false); return true; }
    } catch { /* not a valid challenge */ }
    return false;
  }

  function difficultyLabel(d) { return t(d === 'easy' ? 'Easy' : d === 'medium' ? 'Medium' : 'Hard'); }

  function openPicker() {
    const daily = dailyChallenge(id, version, puzzles);
    els.dailyCard.innerHTML = '';
    if (daily) {
      const p = byId.get(daily.id) || daily.puzzle;
      const card = puzzleCard(p, true);
      els.dailyCard.appendChild(card);
    }
    els.grid.innerHTML = '';
    for (const p of puzzles) els.grid.appendChild(puzzleCard(p, false));
    const done = puzzles.filter((p) => solvedStore.has(p.id)).length;
    els.progress.textContent = `${done}/${puzzles.length} ${t('solved')}`;
    els.picker.classList.add('show');
  }
  function closePicker() { els.picker.classList.remove('show'); }

  function puzzleCard(p, daily) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'pz-card' + (daily ? ' pz-daily' : '');
    card.dataset.pid = p.id;
    const solved = solvedStore.has(p.id);
    card.innerHTML = `<span class="pz-diff pz-${p.difficulty}">${daily ? '\u2b50 ' + t('Daily challenge') : difficultyLabel(p.difficulty)}</span>`
      + `<span class="pz-title">${escapeHtml(t(p.titleKey))}</span>`
      + `<span class="pz-tick">${solved ? '\u2713' : ''}</span>`;
    card.addEventListener('click', () => start(p, daily));
    return card;
  }

  function start(spec, isDaily) {
    active = { spec, isDaily, moves: 0 };
    hintsUsed = 0;
    closePicker();
    els.banner.classList.remove('show');
    els.title.textContent = t(spec.titleKey);
    els.brief.textContent = t(spec.briefKey);
    els.moves.textContent = '';
    els.hintBox.textContent = '';
    els.hintBtn.style.display = (spec.hintKeys?.length) ? '' : 'none';
    els.hud.classList.add('show');
    els.openBtn.style.display = 'none';   // the puzzle-open button must not overlap #pz-exit while playing
    hooks.enter?.(spec);
    hooks.narrate?.(t(spec.briefKey));
  }

  // Called by the renderer after each committed move in puzzle mode.
  function report(state) {
    if (!active) return false;
    active.moves += 1;
    els.moves.textContent = `${active.moves} ${t('moves')}`;
    if (isSolved(state, active.spec, iface)) { onSolved(); return true; }
    return false;
  }

  // Called by the renderer when an attempt is spent without solving (the solver's turn ended).
  function fail() {
    if (!active) return;
    els.banner.className = 'pz-banner pz-fail show';
    els.bannerTitle.textContent = t('Not solved');
    els.bannerText.textContent = t('Try that one again.');
    els.retryBtn.style.display = '';
    els.nextBtn.style.display = 'none';
    els.shareBtn.style.display = 'none';
    els.doneBtn.style.display = '';
  }

  function onSolved() {
    const { spec, isDaily, moves } = active;
    const { firstTime, dailyCounted } = recordSolve({ spec, isDaily, profile, solvedStore });
    els.banner.className = 'pz-banner pz-win show';
    els.bannerTitle.textContent = t('Solved!');
    const par = spec.par ?? spec.solution?.length ?? moves;
    els.bannerText.textContent = `${moves} ${t('moves')} \u00b7 ${t('par')} ${par}` + (firstTime ? '' : ` \u00b7 ${t('already solved')}`);
    els.retryBtn.style.display = '';
    els.nextBtn.style.display = nextUnsolved(spec.id) ? '' : 'none';
    els.shareBtn.style.display = '';
    els.doneBtn.style.display = '';
    hooks.narrate?.(t('Solved!'));
    hooks.solved?.({ spec, isDaily, firstTime, dailyCounted, moves });
  }

  function nextUnsolved(afterId) {
    const order = puzzles.map((p) => p.id);
    const start = order.indexOf(afterId);
    for (let i = 1; i <= order.length; i += 1) {
      const p = puzzles[(start + i) % order.length];
      if (!solvedStore.has(p.id)) return p;
    }
    return null;
  }
  function nextPuzzle() { const p = active && nextUnsolved(active.spec.id); if (p) start(p, false); }

  function showNextHint() {
    if (!active) return;
    const hints = active.spec.hintKeys || [];
    if (hintsUsed >= hints.length) return;
    els.hintBox.textContent = t(hints[hintsUsed]);
    hintsUsed += 1;
    if (hintsUsed >= hints.length) els.hintBtn.style.display = 'none';
  }

  function exit() {
    active = null;
    els.hud.classList.remove('show');
    els.openBtn.style.display = '';
    els.banner.classList.remove('show');
    hooks.exit?.();
  }

  return { openPicker, report, fail, exit, shareChallenge, launchFromHash, isActive: () => !!active, current: () => active?.spec ?? null };
}

// ---- DOM/styles ---------------------------------------------------------------------------------

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function buildDom(accent) {
  const openBtn = document.createElement('button');
  openBtn.id = 'pz-open'; openBtn.type = 'button'; openBtn.textContent = '\ud83e\udde9';
  openBtn.title = t('Puzzles'); openBtn.setAttribute('aria-label', t('Puzzles'));
  document.body.appendChild(openBtn);

  const picker = document.createElement('div'); picker.id = 'pz-picker'; picker.setAttribute('role', 'dialog');
  picker.innerHTML = `<div class="pz-sheet"><div class="pz-head"><h3>${t('Puzzles')}</h3>`
    + `<span id="pz-progress"></span><button id="pz-picker-close" aria-label="${t('Close')}">\u2715</button></div>`
    + `<div id="pz-daily"></div><div id="pz-grid"></div></div>`;
  document.body.appendChild(picker);

  const hud = document.createElement('div'); hud.id = 'pz-hud';
  hud.innerHTML = `<div class="pz-hud-top"><div><div id="pz-title"></div><div id="pz-brief"></div></div>`
    + `<button id="pz-exit" aria-label="${t('Exit')}">\u2715</button></div>`
    + `<div class="pz-hud-bot"><button id="pz-hint">\ud83d\udca1 ${t('Hint')}</button><span id="pz-hintbox"></span><span id="pz-moves"></span></div>`;
  document.body.appendChild(hud);

  const banner = document.createElement('div'); banner.id = 'pz-banner'; banner.className = 'pz-banner';
  banner.innerHTML = `<div id="pz-banner-title"></div><div id="pz-banner-text"></div>`
    + `<div class="pz-banner-btns"><button id="pz-retry">${t('Try again')}</button>`
    + `<button id="pz-share">${t('Share')}</button>`
    + `<button id="pz-next">${t('Next puzzle')}</button><button id="pz-done">${t('Done')}</button></div>`;
  document.body.appendChild(banner);

  const $ = (s, r = document) => r.querySelector(s);
  return {
    openBtn, picker, pickerClose: $('#pz-picker-close', picker), progress: $('#pz-progress', picker),
    dailyCard: $('#pz-daily', picker), grid: $('#pz-grid', picker),
    hud, title: $('#pz-title', hud), brief: $('#pz-brief', hud), hintBtn: $('#pz-hint', hud),
    hintBox: $('#pz-hintbox', hud), moves: $('#pz-moves', hud), exitBtn: $('#pz-exit', hud),
    banner, bannerTitle: $('#pz-banner-title', banner), bannerText: $('#pz-banner-text', banner),
    retryBtn: $('#pz-retry', banner), shareBtn: $('#pz-share', banner), nextBtn: $('#pz-next', banner), doneBtn: $('#pz-done', banner),
  };
}

function injectStyles(accent) {
  if (document.getElementById('pz-styles')) return;
  const st = document.createElement('style'); st.id = 'pz-styles';
  st.textContent = `
  #pz-open{position:fixed;right:12px;top:calc(12px + env(safe-area-inset-top,0));z-index:120;width:44px;height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.5);color:#fff;font-size:1.2rem;cursor:pointer}
  #pz-picker,#pz-banner{position:fixed;inset:0;z-index:210;display:none;align-items:center;justify-content:center;background:rgba(6,8,12,.62)}
  #pz-picker.show,#pz-banner.show{display:flex}
  #pz-banner{flex-direction:column;text-align:center;gap:.4rem;pointer-events:none}
  .pz-sheet{width:min(560px,92vw);max-height:86vh;overflow:auto;background:#141821;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:1rem 1.1rem}
  .pz-head{display:flex;align-items:center;gap:.6rem;margin-bottom:.6rem}
  .pz-head h3{margin:0;flex:1;color:#fff;font:600 1.1rem "Segoe UI",sans-serif}
  #pz-progress{color:#9fb0c3;font:.8rem "Segoe UI",sans-serif}
  #pz-picker-close{background:none;border:0;color:#9fb0c3;font-size:1.1rem;cursor:pointer}
  #pz-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-top:.5rem}
  .pz-card{display:flex;flex-direction:column;gap:.25rem;text-align:left;padding:.6rem .7rem;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:#1b2130;color:#eaf0f7;cursor:pointer;position:relative}
  .pz-card.pz-daily{grid-column:1/-1;background:linear-gradient(135deg,#1b2130,#232c3f)}
  .pz-diff{font:600 .7rem "Segoe UI",sans-serif;color:#0c0f16;background:${accent};align-self:flex-start;padding:.1rem .5rem;border-radius:999px}
  .pz-diff.pz-easy{background:#7fd4a0}.pz-diff.pz-medium{background:#e8c24a}.pz-diff.pz-hard{background:#e88a6a}
  .pz-title{font:600 .95rem "Segoe UI",sans-serif}
  .pz-tick{position:absolute;right:.6rem;top:.5rem;color:#7fd4a0;font-weight:700}
  #pz-hud{position:fixed;left:0;right:0;top:0;z-index:118;display:none;flex-direction:column;gap:.4rem;padding:.6rem 1rem;padding-top:calc(.6rem + env(safe-area-inset-top,0));background:linear-gradient(#0b0e14cc,transparent)}
  #pz-hud.show{display:flex}
  .pz-hud-top{display:flex;gap:.6rem;align-items:flex-start}
  #pz-title{color:#fff;font:700 1rem "Segoe UI",sans-serif}#pz-brief{color:#cfd8e3;font:.82rem "Segoe UI",sans-serif;max-width:80vw}
  #pz-exit{margin-left:auto;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:10px;width:34px;height:34px;cursor:pointer}
  .pz-hud-bot{display:flex;align-items:center;gap:.6rem}
  #pz-hint{background:${accent};color:#0c0f16;border:0;border-radius:10px;padding:.35rem .7rem;font:600 .8rem "Segoe UI",sans-serif;cursor:pointer}
  #pz-hintbox{color:#eaf0f7;font:.8rem "Segoe UI",sans-serif}#pz-moves{margin-left:auto;color:#9fb0c3;font:.8rem "Segoe UI",sans-serif}
  #pz-banner-title{color:#fff;font:700 1.6rem "Segoe UI",sans-serif}#pz-banner-text{color:#cfd8e3;font:.95rem "Segoe UI",sans-serif}
  .pz-banner.pz-win #pz-banner-title{color:${accent}}.pz-banner.pz-fail #pz-banner-title{color:#e88a6a}
  .pz-banner-btns{display:flex;gap:.5rem;margin-top:.6rem;pointer-events:auto}
  .pz-banner-btns button{border:0;border-radius:11px;padding:.5rem .9rem;min-height:42px;font:600 .85rem "Segoe UI",sans-serif;cursor:pointer;background:#232c3f;color:#eaf0f7}
  #pz-next{background:${accent};color:#0c0f16}`;
  document.head.appendChild(st);
}
