// Safe, renderer-agnostic share cards. Runtime text and canonical board diagrams only:
// no profile identity, seeds, replay data, remote assets, trademarks, or baked-in localized text.
// Keep this module byte-identical across games after cross-review.
import { assertContentId } from './content-id.js';

export const SHARE_CARD_KINDS = Object.freeze(['result', 'achievement', 'puzzle']);
export const SHARE_CARD_SIZES = Object.freeze({
  landscape: Object.freeze({ width: 1200, height: 630 }),
  square: Object.freeze({ width: 1080, height: 1080 }),
});
export const SHARE_PARAM_KEYS = Object.freeze({
  result: Object.freeze([
    'outcome', 'side', 'moves', 'turns', 'score', 'opponentScore',
    'captures', 'seeds', 'piecesHome',
  ]),
  achievement: Object.freeze(['achievementId', 'tier']),
  puzzle: Object.freeze(['puzzleId', 'difficulty', 'moves', 'par', 'daily']),
});

const GAMES = Object.freeze({
  ah: 'Aadu Huli',
  am: 'Alaguli Mane',
  cb: 'Chowka Bara',
  sma: 'Saalu Mane Ata',
});
const KIND_SET = new Set(SHARE_CARD_KINDS);
const SIZE_SET = new Set(Object.keys(SHARE_CARD_SIZES));
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const WORLD = /^[a-z][a-z0-9-]{0,63}$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const TIERS = new Set(['bronze', 'silver', 'gold']);
const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const OUTCOMES = new Set(['win', 'loss', 'draw']);
const SIDES = new Set([0, 1, 'G', 'T', 'draw']);
const PUZZLE_ID = /^[a-z][a-z0-9.-]{0,95}$/;
const PRIVATE_KEY = /(?:install.?id|player.?name|profile|device|email|secret|token|seed|rng|replay|action.?log)/i;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const PNG = 'image/png';
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

function assertPublicData(value, path = 'state') {
  const stack = [{ value, path, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop();
    if (++nodes > 4096) throw new RangeError(`${path} is too complex`);
    if (item.depth > 16) throw new RangeError(`${item.path} is too deep`);
    const current = item.value;
    if (current === null || typeof current === 'boolean') continue;
    if (typeof current === 'string') {
      if (current.length > 256) throw new RangeError(`${item.path} is too long`);
      continue;
    }
    if (typeof current === 'number') {
      if (!Number.isSafeInteger(current)) throw new TypeError(`${item.path} must be a safe integer`);
      continue;
    }
    if (Array.isArray(current)) {
      if (current.length > 4096) throw new RangeError(`${item.path} has too many items`);
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current[index], path: `${item.path}[${index}]`, depth: item.depth + 1 });
      }
      continue;
    }
    if (!isPlainObject(current)) throw new TypeError(`${item.path} must contain plain data`);
    const keys = Object.keys(current);
    if (keys.length > 128) throw new RangeError(`${item.path} has too many keys`);
    for (const key of keys) {
      if (FORBIDDEN_KEYS.has(key) || PRIVATE_KEY.test(key)) {
        throw new TypeError(`${item.path}.${key} is not allowed on a share card`);
      }
      stack.push({ value: current[key], path: `${item.path}.${key}`, depth: item.depth + 1 });
    }
  }
}

function validateParams(kind, params) {
  if (!isPlainObject(params)) throw new TypeError('share card params must be a plain object');
  const allowed = new Set(SHARE_PARAM_KEYS[kind]);
  for (const [key, value] of Object.entries(params)) {
    if (!allowed.has(key) || FORBIDDEN_KEYS.has(key)) throw new TypeError(`share card param ${key} is not allowed for ${kind}`);
    if (['moves', 'turns', 'score', 'opponentScore', 'captures', 'seeds', 'piecesHome', 'par'].includes(key)) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 1000000) {
        throw new TypeError(`share card param ${key} must be a bounded non-negative integer`);
      }
    } else if (key === 'outcome' && !OUTCOMES.has(value)) {
      throw new TypeError('share card outcome is invalid');
    } else if (key === 'side' && !SIDES.has(value)) {
      throw new TypeError('share card side is invalid');
    } else if (key === 'tier' && !TIERS.has(value)) {
      throw new TypeError('share card tier is invalid');
    } else if (key === 'difficulty' && !DIFFICULTIES.has(value)) {
      throw new TypeError('share card difficulty is invalid');
    } else if (key === 'daily' && typeof value !== 'boolean') {
      throw new TypeError('share card daily flag must be boolean');
    } else if (key === 'achievementId' && !ID.test(value)) {
      throw new TypeError(`share card param ${key} is invalid`);
    } else if (key === 'puzzleId' && !PUZZLE_ID.test(value)) {
      throw new TypeError(`share card param ${key} is invalid`);
    }
  }
}

function validateFrameUrl(frameUrl) {
  if (frameUrl == null) return null;
  if (typeof frameUrl !== 'string' || frameUrl.length > 256) throw new TypeError('share frame URL is invalid');
  const base = globalThis.location?.href ?? 'https://tbg.invalid/play.html';
  const url = new URL(frameUrl, base);
  const origin = new URL(base).origin;
  if (url.origin !== origin || url.username || url.password || url.search || url.hash
    || !/(?:^|\/)assets\/share\/[a-z0-9._/-]+\.(?:png|webp)$/i.test(url.pathname)) {
    throw new TypeError('share frames must be reviewed same-origin assets under assets/share');
  }
  return url.href;
}

export function validateShareCardInput({
  kind,
  game,
  world,
  locale,
  titleKey,
  bodyKey,
  params = {},
  state = null,
  drawBoard,
  translate,
  frameUrl = null,
  size = 'landscape',
} = {}) {
  if (!KIND_SET.has(kind)) throw new TypeError('share card kind is invalid');
  if (!Object.hasOwn(GAMES, game)) throw new TypeError('share card game is invalid');
  if (!WORLD.test(world)) throw new TypeError('share card world is invalid');
  if (!LOCALE.test(locale)) throw new TypeError('share card locale is invalid');
  assertContentId(titleKey, 'share card titleKey');
  assertContentId(bodyKey, 'share card bodyKey');
  validateParams(kind, params);
  if (state !== null) assertPublicData(state);
  if (typeof drawBoard !== 'function') throw new TypeError('share card drawBoard must be a function');
  if (typeof translate !== 'function') throw new TypeError('share card translate must be a function');
  if (!SIZE_SET.has(size)) throw new TypeError('share card size is invalid');
  return Object.freeze({ frameUrl: validateFrameUrl(frameUrl) });
}

function formatText(value, params) {
  let text = String(value ?? '');
  for (const [key, raw] of Object.entries(params)) {
    const replacement = String(raw);
    text = text.replaceAll(`{${key}}`, replacement).replaceAll(`%${key}%`, replacement);
  }
  return text.slice(0, 600);
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = candidate;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.length && lines.join(' ').length < words.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.…]+$/, '')}…`;
  }
  lines.forEach((value, index) => ctx.fillText(value, x, y + index * lineHeight));
  return lines.length;
}

function drawProceduralFrame(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = '#d7ad52';
  ctx.lineWidth = Math.max(5, width / 180);
  roundedRect(ctx, 28, 28, width - 56, height - 56, 28);
  ctx.stroke();
  ctx.lineWidth = Math.max(2, width / 500);
  roundedRect(ctx, 48, 48, width - 96, height - 96, 20);
  ctx.stroke();
  for (const [x, y, sx, sy] of [
    [62, 62, 1, 1], [width - 62, 62, -1, 1],
    [62, height - 62, 1, -1], [width - 62, height - 62, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x, y + 28 * sy);
    ctx.quadraticCurveTo(x, y, x + 28 * sx, y);
    ctx.quadraticCurveTo(x + 12 * sx, y + 12 * sy, x, y + 28 * sy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBoardFallback(ctx, box) {
  ctx.save();
  ctx.strokeStyle = '#d7ad52';
  ctx.fillStyle = '#d7ad52';
  ctx.lineWidth = 5;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const radius = Math.min(box.width, box.height) * 0.3;
  for (let i = 0; i < 4; i += 1) {
    const angle = (Math.PI / 2) * i;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.stroke();
  }
  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI * 2 * i) / 8;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

async function loadFrame(url) {
  if (!url || typeof globalThis.Image !== 'function') return null;
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 2500);
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.src = url;
  });
}

function dataUrlBlob(canvas) {
  const dataUrl = canvas.toDataURL(PNG);
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error('canvas PNG export failed');
  const binary = globalThis.atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: PNG });
}

async function canvasBlob(canvas) {
  let blob = null;
  if (typeof canvas.toBlob === 'function') {
    blob = await new Promise((resolve, reject) => {
      try { canvas.toBlob(resolve, PNG); } catch (error) { reject(error); }
    });
  }
  if (!blob) blob = dataUrlBlob(canvas);
  if (!(blob instanceof Blob) || blob.type !== PNG || blob.size <= 0 || blob.size > MAX_FILE_BYTES) {
    throw new Error('share card PNG export was invalid');
  }
  return blob;
}

function makeFile(blob, name) {
  if (typeof globalThis.File === 'function') return new File([blob], name, { type: PNG, lastModified: 0 });
  blob.name = name;
  blob.lastModified = 0;
  return blob;
}

async function compose(input, frame) {
  const dimensions = SHARE_CARD_SIZES[input.size];
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('share card requires a 2D canvas context');
  const { width, height } = dimensions;
  const square = input.size === 'square';
  const padding = square ? 92 : 82;
  const boardBox = square
    ? { x: padding, y: 420, width: width - padding * 2, height: height - 540 }
    : { x: 690, y: 120, width: 410, height: 390 };
  const textWidth = square ? width - padding * 2 : 540;
  const title = formatText(input.translate(input.titleKey), input.params);
  const body = formatText(input.translate(input.bodyKey), input.params);

  ctx.fillStyle = '#18130f';
  ctx.fillRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#3a1715');
  gradient.addColorStop(1, '#15110e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  drawProceduralFrame(ctx, width, height);

  ctx.fillStyle = '#d7ad52';
  ctx.font = `700 ${square ? 30 : 26}px "Segoe UI", sans-serif`;
  ctx.fillText(GAMES[input.game], padding, square ? 116 : 108);
  ctx.fillStyle = '#c8bca9';
  ctx.font = `600 ${square ? 22 : 18}px "Segoe UI", sans-serif`;
  ctx.fillText(input.world.replaceAll('-', ' ').toUpperCase(), padding, square ? 152 : 140);
  ctx.fillStyle = '#fff7e6';
  ctx.font = `700 ${square ? 62 : 54}px "Segoe UI", sans-serif`;
  wrapText(ctx, title, padding, square ? 238 : 228, textWidth, square ? 72 : 64, 3);
  ctx.fillStyle = '#e1d5c0';
  ctx.font = `400 ${square ? 32 : 28}px "Segoe UI", sans-serif`;
  wrapText(ctx, body, padding, square ? 330 : 392, textWidth, square ? 44 : 40, square ? 2 : 3);

  ctx.save();
  ctx.fillStyle = '#100d0bcc';
  roundedRect(ctx, boardBox.x, boardBox.y, boardBox.width, boardBox.height, 28);
  ctx.fill();
  ctx.strokeStyle = '#7d6335';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
  try {
    await input.drawBoard(ctx, Object.freeze({
      state: input.state,
      x: boardBox.x,
      y: boardBox.y,
      width: boardBox.width,
      height: boardBox.height,
      locale: input.locale,
      kind: input.kind,
    }));
  } catch {
    drawBoardFallback(ctx, boardBox);
  }

  ctx.fillStyle = '#aa9a83';
  ctx.font = `500 ${square ? 21 : 18}px "Segoe UI", sans-serif`;
  ctx.fillText('Traditional Board Games · Karnataka', padding, height - (square ? 72 : 68));
  if (frame) ctx.drawImage(frame, 0, 0, width, height);
  return canvas;
}

export async function renderShareCard(input = {}) {
  const checked = validateShareCardInput(input);
  const normalized = { ...input, params: input.params ?? {}, size: input.size ?? 'landscape' };
  const frame = await loadFrame(checked.frameUrl);
  let canvas = await compose(normalized, frame);
  let blob;
  try {
    blob = await canvasBlob(canvas);
  } catch (error) {
    if (!frame) throw error;
    canvas = await compose(normalized, null);
    blob = await canvasBlob(canvas);
  }
  const file = makeFile(blob, `tbg-${normalized.game}-${normalized.kind}.png`);
  return Object.freeze({ canvas, blob, file });
}

function safeShareUrl(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 4096) throw new TypeError('share URL is invalid');
  const base = globalThis.location?.href ?? 'https://tbg.invalid/play.html';
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== new URL(base).origin
    || url.username || url.password) throw new TypeError('share URL must be same-origin HTTP(S)');
  return url.href;
}

function cancelled(error) {
  return error?.name === 'AbortError';
}

export async function shareCard({
  file,
  title,
  text,
  url = null,
  downloadName = file?.name,
} = {}) {
  if (!(file instanceof Blob) || file.type !== PNG || file.size <= 0 || file.size > MAX_FILE_BYTES) {
    throw new TypeError('shareCard requires a bounded PNG file');
  }
  if (typeof title !== 'string' || !title.trim() || title.length > 256) throw new TypeError('share title is invalid');
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new TypeError('share text is invalid');
  if (typeof downloadName !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}\.png$/i.test(downloadName)) {
    throw new TypeError('share download name is invalid');
  }
  const href = safeShareUrl(url);
  const nav = globalThis.navigator;
  if (typeof nav?.share === 'function') {
    let canShareFiles = false;
    try { canShareFiles = nav.canShare?.({ files: [file] }) === true; } catch { canShareFiles = false; }
    if (canShareFiles) {
      try {
        await nav.share({ files: [file], title, text, ...(href ? { url: href } : {}) });
        return Object.freeze({ method: 'file-share' });
      } catch (error) {
        if (cancelled(error)) return Object.freeze({ method: 'cancel' });
      }
    }
    try {
      await nav.share({ title, text, ...(href ? { url: href } : {}) });
      return Object.freeze({ method: 'url-share' });
    } catch (error) {
      if (cancelled(error)) return Object.freeze({ method: 'cancel' });
    }
  }
  const payload = href ? `${text}\n${href}` : text;
  if (typeof nav?.clipboard?.writeText === 'function') {
    try {
      await nav.clipboard.writeText(payload);
      return Object.freeze({ method: 'clipboard' });
    } catch { /* fall through to a local PNG download */ }
  }
  if (typeof document === 'undefined' || typeof globalThis.URL?.createObjectURL !== 'function') {
    throw new Error('share card could not be shared or downloaded');
  }
  const objectUrl = globalThis.URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = downloadName;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => globalThis.URL.revokeObjectURL(objectUrl), 0);
  return Object.freeze({ method: 'download' });
}
