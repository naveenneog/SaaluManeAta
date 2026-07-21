const ID = /^[a-z][a-z0-9-]{0,63}$/;
const CONTENT_ID = /^[a-z][a-z0-9]*(?:\.[a-z0-9][a-z0-9_-]*){2,}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)(?!.*[?#\\])[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const TOP_FIELDS = new Set([
  'schema', 'id', 'game', 'titleKey', 'kannadaTitleKey', 'realistic',
  'rulesetCompatibility', 'render', 'audio', 'content', 'campaignIds',
  'assetManifest', 'cinematicManifest',
]);

const plain = value => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function requireValue(condition, message) {
  if (!condition) throw new TypeError(`world-v2 ${message}`);
}

function exactFields(value, fields, label) {
  requireValue(plain(value), `${label} must be an object`);
  for (const key of Object.keys(value)) requireValue(fields.includes(key), `${label} has unknown field ${key}`);
  for (const key of fields) requireValue(Object.hasOwn(value, key), `${label} is missing ${key}`);
}

function assertData(value, path = 'world-v2', depth = 0, nodes = { value: 0 }) {
  requireValue(depth <= 32, `${path} exceeds maximum depth`);
  nodes.value += 1;
  requireValue(nodes.value <= 10000, 'exceeds maximum node count');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    requireValue(Number.isFinite(value), `${path} contains a non-finite number`);
    return;
  }
  requireValue(typeof value === 'object', `${path} must contain data only`);
  if (Array.isArray(value)) {
    requireValue(value.length <= 4096, `${path} is too large`);
    value.forEach((item, index) => assertData(item, `${path}[${index}]`, depth + 1, nodes));
    return;
  }
  requireValue(plain(value), `${path} must contain plain objects only`);
  for (const [key, item] of Object.entries(value)) {
    requireValue(!['__proto__', 'prototype', 'constructor'].includes(key), `${path} contains unsafe key ${key}`);
    assertData(item, `${path}.${key}`, depth + 1, nodes);
  }
}

export function worldPaletteColor(render, role, fallback) {
  return render.palette.find(entry => entry.role === role)?.color || fallback;
}

export function worldCatalogText(catalog, id, label = id) {
  const value = catalog[id];
  requireValue(typeof value === 'string' && value.trim() && [...value].length <= 2000, `catalog missing ${label} (${id})`);
  return value;
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

export function validateWorldV2Data(value, { game, id } = {}) {
  assertData(value);
  requireValue(plain(value), 'must be an object');
  for (const key of Object.keys(value)) requireValue(TOP_FIELDS.has(key), `has unknown field ${key}`);
  for (const key of TOP_FIELDS) requireValue(Object.hasOwn(value, key), `is missing ${key}`);
  requireValue(value.schema === 2, 'schema must equal 2');
  requireValue(ID.test(value.id), 'id is invalid');
  requireValue(['ah', 'am', 'cb', 'sma'].includes(value.game), 'game is invalid');
  if (game) requireValue(value.game === game, `game ${value.game} does not match ${game}`);
  if (id) requireValue(value.id === id, `id ${value.id} does not match ${id}`);
  requireValue(CONTENT_ID.test(value.titleKey), 'titleKey is invalid');
  requireValue(CONTENT_ID.test(value.kannadaTitleKey), 'kannadaTitleKey is invalid');
  requireValue(typeof value.realistic === 'boolean', 'realistic must be boolean');
  requireValue(Array.isArray(value.rulesetCompatibility) && value.rulesetCompatibility.length > 0
    && value.rulesetCompatibility.length <= 16, 'rulesetCompatibility is invalid');
  for (const ref of value.rulesetCompatibility) {
    exactFields(ref, ['id', 'version'], 'rulesetCompatibility entry');
    requireValue(typeof ref.id === 'string' && Number.isSafeInteger(ref.version) && ref.version >= 1,
      'rulesetCompatibility entry is invalid');
  }

  const render = value.render;
  exactFields(render, [
    'boardTexture', 'environment', 'poster', 'pieceStyle', 'cameraMood', 'bloom',
    'accessibilityPalette', 'palette', 'materials', 'lighting', 'limits',
  ], 'render');
  for (const name of ['boardTexture', 'poster']) requireValue(SAFE_PATH.test(render[name] || ''), `render.${name} is unsafe`);
  requireValue(render.environment === null || SAFE_PATH.test(render.environment || ''), 'render.environment is unsafe');
  requireValue(Array.isArray(render.palette) && render.palette.length >= 6 && render.palette.length <= 14,
    'render.palette is invalid');
  for (const entry of render.palette) {
    exactFields(entry, ['role', 'color'], 'render.palette entry');
    requireValue(COLOR.test(entry.color || ''), 'render.palette color is invalid');
  }
  requireValue(Array.isArray(render.materials) && render.materials.length > 0 && render.materials.length <= 16,
    'render.materials is invalid');
  for (const material of render.materials) {
    exactFields(material, [
      'role', 'baseColor', 'roughness', 'metalness', 'emissive',
      'emissiveIntensity', 'environmentIntensity',
    ], 'render.material');
  }
  exactFields(render.lighting, ['ambient', 'key', 'rim', 'hero'], 'render.lighting');
  for (const name of ['ambient', 'key', 'rim']) {
    exactFields(render.lighting[name], ['color', 'intensity'], `render.lighting.${name}`);
  }
  exactFields(render.lighting.hero, ['color', 'intensity', 'angle', 'penumbra'], 'render.lighting.hero');
  exactFields(render.limits, ['desktopParticles', 'mobileParticles', 'maxPixelRatio', 'maxShadowMap'], 'render.limits');
  requireValue(SAFE_PATH.test(value.assetManifest), 'assetManifest is unsafe');
  requireValue(value.cinematicManifest === null || SAFE_PATH.test(value.cinematicManifest || ''), 'cinematicManifest is unsafe');

  exactFields(value.content, [
    'teachingIds', 'glossaryIds', 'provenanceId', 'aboutSummaryKey',
  ], 'content');
  requireValue(Array.isArray(value.content.teachingIds) && value.content.teachingIds.length > 0
    && value.content.teachingIds.length <= 64, 'content.teachingIds is invalid');
  value.content.teachingIds.forEach(key => requireValue(CONTENT_ID.test(key), `teaching id ${key} is invalid`));
  requireValue(Array.isArray(value.content.glossaryIds) && value.content.glossaryIds.length <= 128,
    'content.glossaryIds is invalid');
  requireValue(CONTENT_ID.test(value.content.provenanceId), 'content.provenanceId is invalid');
  requireValue(CONTENT_ID.test(value.content.aboutSummaryKey), 'content.aboutSummaryKey is invalid');
  requireValue(Array.isArray(value.campaignIds) && value.campaignIds.length <= 8, 'campaignIds is invalid');
  exactFields(value.audio, ['music', 'ambience'], 'audio');
  for (const name of ['music', 'ambience']) {
    const track = value.audio[name];
    if (track === null) continue;
    exactFields(track, [
      'path', 'mime', 'gain', 'loopStartMs', 'loopEndMs', 'fadeMs', 'duckUnderNarration',
    ], `audio.${name}`);
    requireValue(SAFE_PATH.test(track.path || ''), `audio.${name}.path is unsafe`);
  }
  return true;
}

export function applyWorldProjector(manifest, { en, kn = {} } = {}, projector) {
  validateWorldV2Data(manifest);
  requireValue(typeof projector === 'function', 'requires a trusted projector callback');
  exactFields({ en, kn }, ['en', 'kn'], 'catalogs');
  for (const [language, catalog] of Object.entries({ en, kn })) {
    assertData(catalog, `catalogs.${language}`);
    requireValue(plain(catalog), `catalogs.${language} must be an object`);
    requireValue(Object.keys(catalog).length <= 4096, `catalogs.${language} is too large`);
    for (const [contentId, text] of Object.entries(catalog)) {
      requireValue(CONTENT_ID.test(contentId), `catalogs.${language} has invalid content id ${contentId}`);
      requireValue(typeof text === 'string' && text.trim() && [...text].length <= 2000,
        `catalogs.${language} has invalid text for ${contentId}`);
    }
  }

  const input = deepFreeze({
    manifest: cloneData(manifest),
    catalogs: { en: cloneData(en), kn: cloneData(kn) },
  });
  const projected = projector(input);
  assertData(projected, 'projected world');
  requireValue(plain(projected), 'projected world must be an object');
  requireValue(projected.schema === 2, 'projected world schema must equal 2');
  requireValue(projected.game === manifest.game, `projected world game ${projected.game} does not match ${manifest.game}`);
  requireValue(projected.id === manifest.id, `projected world id ${projected.id} does not match ${manifest.id}`);
  requireValue(!Object.hasOwn(projected, 'rules'), 'projected world must not contain rules');
  requireValue(
    JSON.stringify(projected.rulesetCompatibility) === JSON.stringify(manifest.rulesetCompatibility),
    'projected world rulesetCompatibility does not match its manifest',
  );
  return cloneData(projected);
}
