import { WORLDS, worldById, saveGame, loadGame } from './config.js';
import { setLang, savedLang, loadUII18n, localizeUI, t as tr } from './i18n.js';
const $ = (s) => document.querySelector(s);
const uiLang = savedLang('sma');
setLang(uiLang);
document.documentElement.lang = uiLang;
await loadUII18n('sma');
const prev = loadGame();
const params = new URLSearchParams(location.search);
let sel = { world: params.get('world') || prev.world || 'parampare', mode: prev.mode || 'ai', side: prev.side ?? 0, level: prev.level || 2 };

$('#worlds').innerHTML = WORLDS.map((w) => `
  <button class="card" data-id="${w.id}" style="--a:${w.accent};--t:${w.p0};--g:${w.p1};--bg:${w.bg}" aria-pressed="false">
    <span class="kn">${w.kannada}</span><span class="tt">${w.title}</span><span class="tag" data-i18n="${w.tag}">${tr(w.tag)}</span>
    <span class="era ${w.era}" data-i18n="${w.era}">${tr(w.era)}</span></button>`).join('');
localizeUI();
document.title = tr('Saalu Mane Ata — choose your world');

function paint() {
  document.querySelectorAll('.card').forEach((c) => { const on = c.dataset.id === sel.world; c.classList.toggle('sel', on); c.setAttribute('aria-pressed', on); });
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === sel.mode));
  document.querySelectorAll('[data-side]').forEach((b) => b.classList.toggle('on', +b.dataset.side === sel.side));
  document.querySelectorAll('[data-level]').forEach((b) => b.classList.toggle('on', +b.dataset.level === sel.level));
  $('#sideRow').style.display = sel.mode === 'ai' ? '' : 'none';
  document.body.style.setProperty('--accent', worldById(sel.world).accent);
}
$('#worlds').addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) { sel.world = c.dataset.id; paint(); } });
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { sel.mode = b.dataset.mode; paint(); }));
document.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => { sel.side = +b.dataset.side; paint(); }));
document.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => { sel.level = +b.dataset.level; paint(); }));
$('#begin').addEventListener('click', () => { saveGame(sel); location.href = `play.html?world=${sel.world}`; });
paint();
