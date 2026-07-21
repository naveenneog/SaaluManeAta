// Stable content identifiers with a one-release English-source compatibility bridge.
// Byte-identical across games (drift-guarded).

const CONTENT_ID = /^[a-z][a-z0-9]*(?:\.[a-z0-9][a-z0-9_-]*){2,}$/;
const englishToId = new Map();
const idToEnglish = new Map();

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export function isContentId(value) {
  return typeof value === 'string' && CONTENT_ID.test(value);
}

export function assertContentId(value, path = 'content id') {
  if (!isContentId(value)) {
    throw new TypeError(`${path} must be a lowercase dotted content id`);
  }
  return value;
}

// Register the generated one-release bridge: { "English source": "game.area.name" }.
// Re-registering the same pair is harmless; ambiguous aliases are rejected.
export function aliasEnglish(map) {
  const entries = map instanceof Map
    ? [...map.entries()]
    : (isPlainObject(map) ? Object.entries(map) : null);
  if (!entries) throw new TypeError('English aliases must be a plain object or Map');
  for (const [english, id] of entries) {
    if (typeof english !== 'string' || !english.trim() || isContentId(english)) {
      throw new TypeError('English alias keys must be non-empty source text');
    }
    assertContentId(id, `alias for ${JSON.stringify(english)}`);
    const previousId = englishToId.get(english);
    const previousEnglish = idToEnglish.get(id);
    if ((previousId && previousId !== id) || (previousEnglish && previousEnglish !== english)) {
      throw new RangeError(`Ambiguous content alias: ${english} -> ${id}`);
    }
    englishToId.set(english, id);
    idToEnglish.set(id, english);
  }
  return entries.length;
}

export function cid(idOrEnglish, { strict = false } = {}) {
  if (typeof idOrEnglish !== 'string' || !idOrEnglish.trim()) {
    throw new TypeError('content key must be a non-empty string');
  }
  if (isContentId(idOrEnglish)) return idOrEnglish;
  const id = englishToId.get(idOrEnglish);
  if (id) return id;
  if (strict) throw new RangeError(`Unregistered English content key: ${idOrEnglish}`);
  return idOrEnglish;
}

export function englishFor(id) {
  return isContentId(id) ? (idToEnglish.get(id) ?? null) : null;
}

// Translation order: stable id -> registered legacy alias -> English fallback.
export function resolveText(value, translate = (key) => key) {
  const key = cid(value);
  const translated = translate(key);
  if (translated != null && translated !== key) return translated;
  if (isContentId(key)) return englishFor(key) ?? key;
  return translated ?? value;
}

const DEFAULT_FIELD = (key) => /(?:^|_)(?:contentId|contentIds)$/.test(key)
  || /(?:Key|Keys)$/.test(key);

// Factory guard: recursively inspect content-bearing fields and refuse raw English.
// Other data strings (world ids, seeds, URLs, ruleset ids) are intentionally ignored.
export function assertNoEnglishKeys(value, {
  fields = DEFAULT_FIELD,
  path = 'content',
} = {}) {
  const matches = typeof fields === 'function'
    ? fields
    : (key) => new Set(fields).has(key);
  const seen = new Set();
  const visit = (node, at) => {
    if (node == null || typeof node !== 'object') return;
    if (seen.has(node)) throw new TypeError(`${at} must not contain cycles`);
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${at}[${index}]`));
    } else {
      if (!isPlainObject(node)) throw new TypeError(`${at} must contain plain data`);
      for (const [key, item] of Object.entries(node)) {
        const itemPath = `${at}.${key}`;
        if (matches(key)) {
          const ids = Array.isArray(item) ? item : [item];
          if (!ids.length) throw new TypeError(`${itemPath} must contain content ids`);
          ids.forEach((id, index) => assertContentId(id, Array.isArray(item) ? `${itemPath}[${index}]` : itemPath));
        } else {
          visit(item, itemPath);
        }
      }
    }
    seen.delete(node);
  };
  visit(value, path);
  return true;
}
