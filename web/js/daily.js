// daily.js — the deterministic DAILY CHALLENGE selector. Given a game id, a content version and a
// local calendar date, it picks one puzzle from a pool with a seeded draw — no server, no network. The
// clock is "harmless": a wrong device clock only shows a different day's puzzle, it never crashes and
// never desyncs (selection depends solely on the date STRING, so the same civil date yields the same
// puzzle in every time zone). Streak/seen bookkeeping lives in profile.js. Byte-identical (drift-guarded).
import { createRngSuite } from './rng.js';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

// The daily key as a civil date YYYY-MM-DD. A YYYY-MM-DD string is preserved VERBATIM (so a given
// civil date maps to the same puzzle in every time zone); a Date uses the device's own calendar day.
export function dailyKey(date = new Date()) {
  if (typeof date === 'string') {
    const m = ISO_DATE.exec(date.trim());
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    date = new Date(date);
  }
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new TypeError('dailyKey requires a Date or a YYYY-MM-DD string');
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

// Deterministic index into a pool of `count` items for (gameId, version, date). Same inputs → same index.
export function dailyIndex(gameId, version, count, date = new Date()) {
  if (!Number.isSafeInteger(count) || count <= 0) return 0;
  const seed = `${gameId}|${version}|${dailyKey(date)}`;
  const rng = createRngSuite({ seed, streams: ['daily'] });
  return rng.stream('daily').int(count);
}

// Pick today's challenge from a pool (array of puzzle specs or ids). Returns a descriptor or null.
export function dailyChallenge(gameId, version, pool, date = new Date()) {
  const list = Array.isArray(pool) ? pool : [];
  if (!list.length) return null;
  const key = dailyKey(date);
  const index = dailyIndex(gameId, version, list.length, date);
  const item = list[index];
  const id = item && typeof item === 'object' ? item.id : item;
  return { key, gameId, version, index, id, puzzle: item };
}

// A short, stable "days since epoch" ordinal for the same civil date `dailyKey` yields — handy for
// streak math in profile.js. Derived from the key so the two never disagree across time zones.
export function dailyOrdinal(date = new Date()) {
  const [y, m, d] = dailyKey(date).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
