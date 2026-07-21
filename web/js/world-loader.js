import { applyWorldProjector, validateWorldV2Data } from './world-format.js';

const WORLD_ID = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_JSON_BYTES = 524288;

async function readJson(response, label) {
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > MAX_JSON_BYTES) throw new RangeError(`${label} exceeds ${MAX_JSON_BYTES} bytes`);
  if (typeof response.text === 'function') {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
      throw new RangeError(`${label} exceeds ${MAX_JSON_BYTES} bytes`);
    }
    try { return JSON.parse(text); } catch { throw new SyntaxError(`${label} is malformed JSON`); }
  }
  return response.json();
}

async function request(url, { fetchImpl, label, allow404 = false }) {
  const response = await fetchImpl(url);
  if (allow404 && response.status === 404) return null;
  if (!response.ok) throw new Error(`${label} request failed: ${response.status}`);
  return readJson(response, label);
}

export async function loadWorld(id, {
  fetchImpl = globalThis.fetch,
  game,
  projector,
  v2BaseUrl = 'worlds-v2',
  legacyBaseUrl = 'worlds',
} = {}) {
  if (!WORLD_ID.test(id || '')) throw new TypeError('world id is invalid');
  if (typeof fetchImpl !== 'function') throw new TypeError('loadWorld requires fetch');
  const base = `${v2BaseUrl}/${id}`;
  const manifest = await request(`${base}/world.json`, {
    fetchImpl,
    label: `world ${id}`,
    allow404: true,
  });
  if (manifest) {
    validateWorldV2Data(manifest, { game, id });
    if (typeof projector !== 'function') throw new TypeError(`world ${id} requires a trusted projector callback`);
    const [en, kn] = await Promise.all([
      request(`${base}/catalogs/en.json`, { fetchImpl, label: `world ${id} English catalog` }),
      request(`${base}/catalogs/kn.json`, { fetchImpl, label: `world ${id} Kannada catalog` }),
    ]);
    return applyWorldProjector(manifest, { en, kn }, projector);
  }
  return request(`${legacyBaseUrl}/${id}.json`, {
    fetchImpl,
    label: `legacy world ${id}`,
  });
}
