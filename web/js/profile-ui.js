// profile-ui.js — a small, renderer-agnostic "your progress" panel over the per-install profile CRDT
// (profile.js): read-only stats (games, wins, puzzles, daily, streak) plus data portability
// (export / import-merge). No account, no server. Byte-identical across games (drift-guarded).
import { t } from './i18n.js';

// ---- pure logic (unit-tested) -------------------------------------------------------------------

export function computeStats(profile, date = new Date()) {
  const val = (n) => { try { return profile.value(n); } catch { return 0; } };
  const played = val('games.played');
  const won = val('games.won');
  const streak = (() => { try { return profile.streak(date); } catch { return { current: 0, best: 0 }; } })();
  return {
    played,
    won,
    winPct: played > 0 ? Math.round((100 * won) / played) : 0,
    puzzles: val('puzzles.solved'),
    daily: val('daily.solved'),
    streakCurrent: streak.current ?? 0,
    streakBest: streak.best ?? 0,
  };
}

// Merge an exported profile string into the live profile; returns { ok, error? }.
export function importProfile(profile, text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty' };
  try { profile.import(text.trim()); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

// ---- DOM panel ----------------------------------------------------------------------------------

export function initProfileUI({ id, accent = '#e8c24a', profile, storage } = {}) {
  injectStyles(accent);
  const els = buildDom();
  els.openBtn.addEventListener('click', open);
  els.close.addEventListener('click', () => els.panel.classList.remove('show'));
  els.panel.addEventListener('click', (e) => { if (e.target === els.panel) els.panel.classList.remove('show'); });
  els.exportBtn.addEventListener('click', doExport);
  els.importBtn.addEventListener('click', doImport);

  function render() {
    const s = computeStats(profile);
    els.stats.innerHTML = '';
    const rows = [
      ['Games played', s.played],
      ['Won', `${s.won} (${s.winPct}%)`],
      ['Puzzles solved', s.puzzles],
      ['Daily solved', s.daily],
      ['Current streak', s.streakCurrent],
      ['Best streak', s.streakBest],
    ];
    for (const [labelKey, value] of rows) {
      const row = document.createElement('div'); row.className = 'pf-row';
      row.innerHTML = `<span>${escapeHtml(t(labelKey))}</span><b>${escapeHtml(String(value))}</b>`;
      els.stats.appendChild(row);
    }
  }
  function open() { render(); els.io.value = ''; els.note.textContent = ''; els.panel.classList.add('show'); }

  async function doExport() {
    const text = profile.export();
    els.io.value = text;
    els.io.select?.();
    let copied = false;
    try { await navigator.clipboard?.writeText(text); copied = true; } catch { /* fall back to the textarea */ }
    els.note.textContent = t(copied ? 'Copied to clipboard' : 'Copy the text above to save your progress');
  }
  function doImport() {
    const r = importProfile(profile, els.io.value);
    if (r.ok) { render(); els.note.textContent = t('Progress merged'); els.io.value = ''; }
    else els.note.textContent = t('That does not look like a saved profile.');
  }

  return { open, render };
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function buildDom() {
  const openBtn = document.createElement('button');
  openBtn.id = 'pf-open'; openBtn.type = 'button'; openBtn.textContent = '\ud83d\udcca';
  openBtn.title = t('Profile'); openBtn.setAttribute('aria-label', t('Profile'));
  document.body.appendChild(openBtn);

  const panel = document.createElement('div'); panel.id = 'pf-panel'; panel.setAttribute('role', 'dialog');
  panel.innerHTML = `<div class="pf-sheet"><div class="pf-head"><h3>${t('Your progress')}</h3>`
    + `<button id="pf-close" aria-label="${t('Close')}">\u2715</button></div>`
    + `<div id="pf-stats"></div>`
    + `<div class="pf-io"><label>${t('Back up or move your progress')}</label>`
    + `<textarea id="pf-io" rows="3" spellcheck="false"></textarea>`
    + `<div class="pf-btns"><button id="pf-export">${t('Export')}</button><button id="pf-import">${t('Import')}</button></div>`
    + `<div id="pf-note"></div></div></div>`;
  document.body.appendChild(panel);

  const $ = (s) => panel.querySelector(s);
  return {
    openBtn, panel, close: $('#pf-close'), stats: $('#pf-stats'),
    io: $('#pf-io'), exportBtn: $('#pf-export'), importBtn: $('#pf-import'), note: $('#pf-note'),
  };
}

function injectStyles(accent) {
  if (document.getElementById('pf-styles')) return;
  const st = document.createElement('style'); st.id = 'pf-styles';
  st.textContent = `
  #pf-open{position:fixed;right:12px;top:calc(64px + env(safe-area-inset-top,0));z-index:120;width:44px;height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.5);color:#fff;font-size:1.15rem;cursor:pointer}
  #pf-panel{position:fixed;inset:0;z-index:212;display:none;align-items:center;justify-content:center;background:rgba(6,8,12,.62)}
  #pf-panel.show{display:flex}
  .pf-sheet{width:min(460px,92vw);max-height:86vh;overflow:auto;background:#141821;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:1rem 1.1rem}
  .pf-head{display:flex;align-items:center;gap:.6rem;margin-bottom:.6rem}
  .pf-head h3{margin:0;flex:1;color:#fff;font:600 1.1rem "Segoe UI",sans-serif}
  #pf-close{background:none;border:0;color:#9fb0c3;font-size:1.1rem;cursor:pointer}
  #pf-stats{display:grid;gap:.35rem;margin-bottom:.9rem}
  .pf-row{display:flex;justify-content:space-between;padding:.5rem .7rem;border-radius:10px;background:#1b2130;color:#eaf0f7;font:.9rem "Segoe UI",sans-serif}
  .pf-row b{color:${accent}}
  .pf-io label{display:block;color:#9fb0c3;font:.78rem "Segoe UI",sans-serif;margin-bottom:.3rem}
  #pf-io{width:100%;box-sizing:border-box;background:#0f131b;color:#cfd8e3;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:.5rem;font:.75rem Consolas,monospace;resize:vertical}
  .pf-btns{display:flex;gap:.5rem;margin-top:.5rem}
  .pf-btns button{flex:1;border:0;border-radius:10px;padding:.55rem;min-height:42px;font:600 .85rem "Segoe UI",sans-serif;cursor:pointer;background:#232c3f;color:#eaf0f7}
  #pf-export{background:${accent};color:#0c0f16}
  #pf-note{color:#9fb0c3;font:.78rem "Segoe UI",sans-serif;margin-top:.5rem;min-height:1em}`;
  document.head.appendChild(st);
}
