// language-store-ui.js — shared, renderer-agnostic storage UI for optional lazy language packs.
// Lists each language's text/voice pack state with install/remove/repair/activate actions, shows total
// storage use, and owns the install-confirmation -> install -> activate flow (`requestLanguage`). Voice
// is row-button-only and never auto-installed. All pack-derived data is rendered with textContent (never
// innerHTML), using the agreed element IDs + data attributes. Byte-identical shared module (drift-guarded).

const STYLE_ID = 'lang-store-styles';
const KB = 1024;
const MB = 1024 * 1024;
const LANG_NAMES = Object.freeze({
  kn: 'ಕನ್ನಡ', en: 'English', hi: 'हिन्दी', ta: 'தமிழ்', te: 'తెలుగు', ml: 'മലയാളം', mr: 'मराठी',
});
const fmtBytes = (n) => (n >= MB ? `${(n / MB).toFixed(1)} MB` : n >= KB ? `${Math.round(n / KB)} KB` : `${Math.max(0, n | 0)} B`);

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

function injectStyles(accent) {
  if (document.getElementById(STYLE_ID)) return;
  const safe = /^#[0-9a-f]{6}$/i.test(accent ?? '') ? accent : '#e8c24a';
  const style = el('style', { id: STYLE_ID });
  style.textContent = `
    #lang-store-open{position:fixed;left:12px;top:calc(58px + env(safe-area-inset-top,0));z-index:120;min-height:44px;
      padding:0 .7rem;border-radius:12px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.5);color:#fff;
      font:600 .82rem "Segoe UI",sans-serif;cursor:pointer}
    #lang-store{position:fixed;inset:0;z-index:214;display:none;align-items:center;justify-content:center;background:rgba(6,8,12,.62);padding:1rem}
    #lang-store.show{display:flex}
    .lang-store-card{width:min(96vw,520px);max-height:86vh;overflow:auto;background:#141922;color:#eef2f7;border-radius:16px;
      border:1px solid rgba(255,255,255,.14);box-shadow:0 18px 48px rgba(0,0,0,.5);padding:1rem;box-sizing:border-box}
    .lang-store-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.4rem}
    .lang-store-head strong{font:700 1.05rem "Segoe UI",sans-serif}
    #lang-store-close{background:none;border:0;color:#9fb0c3;font-size:1.2rem;cursor:pointer;min-height:40px;min-width:40px}
    #lang-store-usage{color:#9fb0c3;font:.82rem "Segoe UI",sans-serif;margin-bottom:.5rem}
    #lang-store-status{color:${safe};font:.85rem "Segoe UI",sans-serif;min-height:1.2rem;margin:.4rem 0}
    .lang-store-row{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;padding:.6rem 0;border-top:1px solid rgba(255,255,255,.08)}
    .lang-store-lang{font:600 1rem "Segoe UI",sans-serif;flex:1 1 40%;min-width:6rem}
    .lang-store-cols{display:flex;flex-wrap:wrap;gap:.5rem;flex:1 1 55%}
    .lang-store-col{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}
    .lang-store-comp{color:#9fb0c3;font:.72rem "Segoe UI",sans-serif;text-transform:uppercase;letter-spacing:.03em}
    .lang-store-chip{font:.75rem "Segoe UI",sans-serif;padding:.15rem .45rem;border-radius:8px;background:#242b38;color:#cfd8e3}
    .lang-store-chip.st-installed,.lang-store-chip.st-core,.lang-store-chip.st-compatibility{background:#1d3a26;color:#9fe6b4}
    .lang-store-chip.st-corrupt{background:#3a2320;color:#f0a58c}
    .lang-store-btn,#lang-store-repair{font:600 .78rem "Segoe UI",sans-serif;color:#17120a;background:${safe};border:0;
      border-radius:9px;padding:.35rem .6rem;cursor:pointer;min-height:34px}
    .lang-store-btn[data-pack-action="remove"]{background:#242b38;color:#eef2f7;border:1px solid rgba(255,255,255,.18)}
    #lang-store-repair{margin-top:.7rem;background:#242b38;color:#eef2f7;border:1px solid rgba(255,255,255,.18)}
    .lang-store-btn:disabled,#lang-store-repair:disabled{opacity:.5;cursor:default}
    @media(prefers-reduced-motion:reduce){#lang-store,#lang-store-open{transition:none!important;animation:none!important}}`;
  document.head.appendChild(style);
}

export function initLanguageStoreUI({
  packs,
  root = document.body,
  languages = null,
  translate = (key) => key,
  getSelectedLanguage = () => null,
  fallbackLanguage = 'en',
  onActivated = () => {},
  dataSaver = false,
  accent = '#e8c24a',
} = {}) {
  if (typeof document === 'undefined') throw new Error('initLanguageStoreUI requires a document');
  if (!packs || typeof packs.list !== 'function' || typeof packs.install !== 'function') {
    throw new TypeError('initLanguageStoreUI requires a language-pack service');
  }
  const t = typeof translate === 'function' ? translate : (key) => key;
  const nameOf = (code) => (languages && languages[code]) || LANG_NAMES[code] || code;
  injectStyles(accent);

  const openBtn = el('button', { id: 'lang-store-open', type: 'button' }, `\u{1F310} ${t('Languages')}`);
  const panel = el('div', { id: 'lang-store', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Language storage') });
  const card = el('div', { class: 'lang-store-card' });
  const head = el('div', { class: 'lang-store-head' });
  const closeBtn = el('button', { id: 'lang-store-close', type: 'button', 'aria-label': t('Close') }, '\u2715');
  head.append(el('strong', {}, t('Language storage')), closeBtn);
  const usage = el('div', { id: 'lang-store-usage' });
  const list = el('div', { id: 'lang-store-list' });
  const status = el('div', { id: 'lang-store-status', role: 'status', 'aria-live': 'polite' });
  const repairBtn = el('button', { id: 'lang-store-repair', type: 'button' }, t('Repair all'));
  card.append(head, usage, list, status, repairBtn);
  panel.append(card);
  root.append(openBtn, panel);

  let busy = false;
  const setStatus = (text) => { status.textContent = text || ''; };
  const stateLabel = (s) => ({
    core: t('In core'), compatibility: t('Bundled'), installed: t('Installed'),
    available: t('Available'), corrupt: t('Needs repair'), unavailable: t('Unavailable'),
  }[s.state] || s.state);

  async function renderUsage() {
    try { const e = await packs.estimate(); usage.textContent = `${t('Storage used')}: ${fmtBytes(e.installedBytes || 0)}`; }
    catch { usage.textContent = ''; }
  }

  function actionsFor(language, component, s, textReady) {
    const out = [];
    // Fix (Sol): voice needs text present first — never offer voice Install/Update until the text
    // component is core/compatibility/installed (it would deterministically fail `text-required`).
    const canInstall = component === 'text' || textReady;
    if (s.state === 'available') { if (canInstall) out.push(['install', t('Install'), s.packBytes]); }
    else if (s.state === 'installed') { out.push(['remove', t('Remove')]); if (s.updateAvailable && canInstall) out.push(['install', t('Update'), s.packBytes]); }
    else if (s.state === 'corrupt') { out.push(['repair', t('Repair')]); out.push(['remove', t('Remove')]); }
    return out.map(([action, label, size]) => el('button', {
      type: 'button', class: 'lang-store-btn', 'data-pack-action': action, 'data-component': component, 'data-language': language,
    }, size ? `${label} \u00b7 ${fmtBytes(size)}` : label));
  }

  async function refresh() {
    await renderUsage();
    let rows;
    try { rows = await packs.list(); } catch { list.textContent = t('Language storage unavailable'); return; }
    list.textContent = '';
    for (const row of rows) {
      const langRow = el('div', { class: 'lang-store-row' });
      langRow.append(el('div', { class: 'lang-store-lang' }, nameOf(row.language)));
      const cols = el('div', { class: 'lang-store-cols' });
      const textReady = ['core', 'compatibility', 'installed'].includes(row.text?.state);
      for (const component of ['text', 'voice']) {
        const s = row[component];
        if (!s) continue;
        const col = el('div', { class: 'lang-store-col' });
        col.append(el('span', { class: 'lang-store-comp' }, component === 'text' ? t('Text') : t('Voice')));
        col.append(el('span', { class: `lang-store-chip st-${s.state}` }, stateLabel(s)));
        for (const btn of actionsFor(row.language, component, s, textReady)) col.append(btn);
        cols.append(col);
      }
      langRow.append(cols);
      list.append(langRow);
    }
  }

  async function run(fn, workingKey) {
    if (busy) return;
    busy = true; setStatus(t(workingKey)); repairBtn.disabled = true;
    list.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try { await fn(); setStatus(''); }
    catch (error) { setStatus(`${t('Something went wrong')}: ${String(error?.code || error?.message || error).slice(0, 80)}`); }
    finally { busy = false; repairBtn.disabled = false; await refresh(); }
  }

  async function doInstall(language, component, { activate = false } = {}) {
    const s = await packs.status(language, component);
    if (s.state === 'available' || (s.state === 'installed' && s.updateAvailable)) {
      const size = fmtBytes(s.packBytes || 0);
      const prompt = dataSaver ? t('Data saver is on. Download %s?') : t('Download %s?');
      if (!globalThis.confirm?.(prompt.replace('%s', size))) return;
    }
    await run(async () => {
      await packs.install(language, { component });
      // Fix (Sol): only activate (switch locale) when the flow explicitly asks — a row Install must
      // never change the active language; only requestLanguage() activates.
      if (activate && component === 'text') { const active = await packs.activate(language); await onActivated?.(language, active); }
    }, 'Installing\u2026');
  }

  // Fix (Sol): removing/repairing the *selected* text pack drops it internally — notify the renderer so
  // it falls back to English while preserving the user's language preference.
  async function notifyFallbackIfSelected() {
    const selected = getSelectedLanguage?.();
    if (!selected) return;
    let s;
    try { s = await packs.status(selected, 'text'); } catch { return; }
    if (!['core', 'compatibility', 'installed'].includes(s.state)) {
      const snapshot = await packs.activate(fallbackLanguage);
      await onActivated?.(fallbackLanguage, snapshot, { reason: 'fallback', preservePreference: true });
    }
  }

  // requestLanguage: own the confirmation -> install -> activate flow for a chosen language's text pack.
  async function requestLanguage(language) {
    open();
    const s = await packs.status(language, 'text');
    if (['core', 'compatibility', 'installed'].includes(s.state)) {
      const active = await packs.activate(language); await onActivated?.(language, active); return active;
    }
    await doInstall(language, 'text', { activate: true });
    return null;
  }

  list.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-pack-action]');
    if (!btn || busy) return;
    const { packAction, component, language } = btn.dataset;
    if (packAction === 'install') doInstall(language, component);
    else if (packAction === 'remove') run(async () => { await packs.remove(language, { component }); if (component === 'text') await notifyFallbackIfSelected(); }, 'Removing\u2026');
    else if (packAction === 'repair') run(async () => { await packs.repair(); await notifyFallbackIfSelected(); }, 'Repairing\u2026');
  });
  repairBtn.addEventListener('click', () => run(async () => { await packs.repair(); await notifyFallbackIfSelected(); }, 'Repairing\u2026'));
  closeBtn.addEventListener('click', () => close());
  panel.addEventListener('click', (event) => { if (event.target === panel) close(); });
  openBtn.addEventListener('click', () => open());

  function open() { panel.classList.add('show'); refresh(); }
  function close() { panel.classList.remove('show'); }
  function destroy() { openBtn.remove(); panel.remove(); }

  return Object.freeze({ open, close, refresh, requestLanguage, destroy });
}
