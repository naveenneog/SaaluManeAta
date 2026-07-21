// replay-narration.js — safe content-ID narration for replay transitions.
// Per-game describers return finite descriptors; locale is applied only after the decision.
// Keep this module byte-identical across games (drift-guarded after review).
import { isContentId } from './content-id.js';

const PARAM = /^[a-z][a-z0-9_]{0,31}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

function safeParam(value, path) {
  if (typeof value === 'string') {
    if (value.length > 96) throw new RangeError(`${path} is too long`);
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  throw new TypeError(`${path} must be a bounded string, number, or boolean`);
}

export function validateNarrationDescriptor(value) {
  if (!isPlainObject(value)) throw new TypeError('replay narration must be an object');
  for (const key of Object.keys(value)) {
    if (!['key', 'params', 'focus'].includes(key)) throw new TypeError(`unknown replay narration field: ${key}`);
  }
  if (!isContentId(value.key)) throw new TypeError('replay narration key must be a content id');
  const params = value.params ?? {};
  if (!isPlainObject(params) || Object.keys(params).length > 16) {
    throw new TypeError('replay narration params must be a bounded object');
  }
  const cleanParams = {};
  for (const [key, item] of Object.entries(params)) {
    if (!PARAM.test(key) || UNSAFE_KEYS.has(key)) throw new TypeError(`invalid replay narration param: ${key}`);
    cleanParams[key] = safeParam(item, `replay narration param ${key}`);
  }
  let focus = null;
  if (value.focus !== undefined && value.focus !== null) {
    if (!Array.isArray(value.focus) || value.focus.length > 16
      || value.focus.some((item) => !Number.isSafeInteger(item) && typeof item !== 'string')) {
      throw new TypeError('replay narration focus must be a bounded id array');
    }
    focus = value.focus.map((item) => {
      if (typeof item === 'string' && item.length > 96) throw new RangeError('replay narration focus id is too long');
      return item;
    });
  }
  return Object.freeze({ key: value.key, params: Object.freeze(cleanParams), focus: focus && Object.freeze(focus) });
}

export function formatReplayText(template, params = {}) {
  const text = String(template ?? '');
  return text.replace(/\{([a-z][a-z0-9_]{0,31})\}/g, (match, key) => (
    Object.hasOwn(params, key) ? String(params[key]) : match
  ));
}

export function createReplayNarrator({
  describe,
  translate = (key) => key,
  narrate = null,
} = {}) {
  if (typeof describe !== 'function') throw new TypeError('createReplayNarrator requires describe(context)');
  if (typeof translate !== 'function') throw new TypeError('replay translate must be a function');

  function present(context, { speak = false } = {}) {
    try {
      const raw = describe(context);
      if (raw == null) return null;
      const descriptor = validateNarrationDescriptor(raw);
      const text = formatReplayText(translate(descriptor.key), descriptor.params);
      if (text.length > 512) return null;
      if (speak && typeof narrate === 'function') {
        try {
          const pending = narrate(text, descriptor);
          pending?.catch?.(() => {});
        } catch { /* narration is optional */ }
      }
      return Object.freeze({ ...descriptor, text });
    } catch {
      return null;
    }
  }

  return Object.freeze({ present });
}
