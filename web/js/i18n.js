// i18n.js — lightweight localization for narrated content AND static UI. The game passes English
// source strings; t() returns the current language's translation. Per-world teachings load from
// assets/<worldId>/i18n/<lang>.json (tooling/gen_i18n.py); game-level UI (buttons, tutorial, HUD)
// loads from assets/ui/<lang>.json (tooling/gen_ui_i18n.py). localizeUI() translates static DOM
// tagged with [data-i18n]/[data-i18n-title]. Narration plays the matching per-language clip (see
// audio.js). Language lives in the shared settings (localStorage tbg.<gameId>.settings.v1 .lang).
// Identical copy per game.
import { aliasEnglish, cid, englishFor, isContentId } from './content-id.js';

export const LANGUAGES = {
  en: 'English',
  kn: 'ಕನ್ನಡ',
  hi: 'हिन्दी',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  ml: 'മലയാളം',
  mr: 'मराठी',
};

let lang = 'en';
let map = {};   // English source -> translated string (current world's teachings)
let uiMap = {}; // English source -> translated string (game-level UI: buttons, tutorial, HUD)
let catalogSource = null; // optional (language, role, opts) -> catalog|null: the active pack's CacheStorage catalog

async function fetchMap(url) {
  try {
    const response = await fetch(url);
    return response.ok ? await response.json() : {};
  } catch { return {}; }
}

function registerEnglishCatalog(catalog) {
  const aliases = {};
  for (const [id, english] of Object.entries(catalog)) {
    if (isContentId(id) && typeof english === 'string' && english) aliases[english] = id;
  }
  if (Object.keys(aliases).length) aliasEnglish(aliases);
}

async function loadCatalog(base, role, opts) {
  const englishPromise = fetchMap(`${base}/en.json`);
  // English is always core (bundled). For a translation, prefer the active installed language pack's
  // catalog (from CacheStorage via catalogSource) so default-core can serve text from the pack; fall back
  // to the bundled asset (all-languages keeps byte-identical behavior). Runs concurrently with the English
  // fetch to preserve the original parallelism.
  const translatedPromise = lang === 'en' ? null : (async () => {
    if (catalogSource) {
      try { const fromPack = await catalogSource(lang, role, opts); if (fromPack && typeof fromPack === 'object') return fromPack; }
      catch { /* fall back to the bundled asset */ }
    }
    return fetchMap(`${base}/${lang}.json`);
  })();
  const english = await englishPromise;
  registerEnglishCatalog(english);
  return lang === 'en' ? english : translatedPromise;
}

// Inject the language-pack catalog source: (language, role, opts) => Promise<catalog|null>. When it
// returns a catalog for the active language, loadCatalog serves text from the pack instead of assets/.
export function setCatalogSource(fn) { catalogSource = typeof fn === 'function' ? fn : null; }

export function getLang() { return lang; }
export function setLang(l) {
  if (!LANGUAGES[l]) return;
  lang = l;
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = l;
}

// Read the saved language for this game from the settings blob (before settings.js loads).
export function savedLang(gameId) {
  try {
    const s = JSON.parse(localStorage.getItem(`tbg.${gameId}.settings.v1`) || '{}');
    return LANGUAGES[s.lang] ? s.lang : 'en';
  } catch { return 'en'; }
}

// Load the translation map for a world in the current language. English is identity.
export async function loadWorldI18n(worldId) {
  map = await loadCatalog(`assets/${worldId}/i18n`, 'world', { world: worldId });
}

// Load the game-level UI translations (buttons, tutorial, HUD) for the current language.
// Keyed by English source, produced by tooling/gen_ui_i18n.py -> assets/ui/<lang>.json.
export async function loadUII18n(gameId) {
  uiMap = await loadCatalog('assets/ui', 'ui');
}

// Resolve stable IDs first, then the one-release English alias, then an English fallback.
export function t(value) {
  if (value == null) return value;
  const key = cid(value);
  return map[key] ?? uiMap[key]
    ?? map[value] ?? uiMap[value]
    ?? englishFor(key) ?? value;
}

// Localize static DOM. [data-i18n] elements are tagged bare in HTML (English lives in textContent); on
// the first non-English pass the trimmed English is captured into the attribute so the key survives
// translation, making localizeUI idempotent and re-callable for live switches (e.g. a language-pack
// fallback restoring English). When lang==='en' it restores English only for elements already captured,
// so a fresh English DOM stays a no-op. [data-i18n-title] captures the English title the same way.
export function localizeUI(root = document) {
  const restoring = lang === 'en';
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    let en = el.getAttribute('data-i18n');
    if (!en) {
      if (restoring) return;                    // fresh English DOM: nothing to translate or restore
      en = (el.textContent || '').trim();
      if (!en) return;
      el.setAttribute('data-i18n', en);         // capture the English key before overwriting
    }
    el.textContent = restoring ? en : (t(en) || en);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    let key = el.getAttribute('data-i18n-title');
    if (!key) {
      if (restoring) return;
      key = (el.getAttribute('title') || '').trim();
      if (!key) return;
      el.setAttribute('data-i18n-title', key);
    }
    el.title = restoring ? key : (t(key) || key);
  });
}
