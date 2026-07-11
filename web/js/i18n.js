// i18n.js — lightweight localization for the narrated content. The game passes English source
// strings; t() returns the current language's translation, loaded per world from
// assets/<worldId>/i18n/<lang>.json (produced by tooling/gen_i18n.py). Narration plays the
// matching per-language clip (see audio.js). Language lives in the shared settings
// (localStorage tbg.<gameId>.settings.v1 .lang). Identical copy per game.
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
let map = {}; // English source -> translated string (current world + language)

export function getLang() { return lang; }
export function setLang(l) { if (LANGUAGES[l]) lang = l; }

// Read the saved language for this game from the settings blob (before settings.js loads).
export function savedLang(gameId) {
  try {
    const s = JSON.parse(localStorage.getItem(`tbg.${gameId}.settings.v1`) || '{}');
    return LANGUAGES[s.lang] ? s.lang : 'en';
  } catch { return 'en'; }
}

// Load the translation map for a world in the current language. English is identity.
export async function loadWorldI18n(worldId) {
  if (lang === 'en') { map = {}; return; }
  try {
    const r = await fetch(`assets/${worldId}/i18n/${lang}.json`);
    map = r.ok ? await r.json() : {};
  } catch { map = {}; }
}

// Translate an English source string to the current language, or return it unchanged.
export function t(s) { return (s != null && map[s]) || s; }
