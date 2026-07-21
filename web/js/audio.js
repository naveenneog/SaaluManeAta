let ctx = null, master = null, bed = null, bedGain = null, bedBase = 0, legacyMuted = false, unlocked = false;
let worldId = null, currentClip = null, currentClipUrl = null, lang = 'en';
let narrationGen = 0;
// Idempotent narration cleanup: pause the current clip and reclaim its blob URL (if any). Safe to call on
// replacement, mute, ended/error, or a failed play() — every path routes through here so a blob URL is
// never leaked.
function stopCurrentClip() {
  if (currentClip) { try { currentClip.pause(); } catch { /* already stopped */ } }
  if (currentClipUrl) { try { URL.revokeObjectURL(currentClipUrl); } catch { /* already revoked */ } }
  currentClip = null;
  currentClipUrl = null;
}
export function setLang(l) { lang = l || 'en'; }
const levels = {
  music: { volume: 1, muted: false },
  sfx: { volume: 1, muted: false },
  narration: { volume: 1, muted: false },
};

const clamp = (n) => Math.max(0, Math.min(1, Number(n)));
const outputLevel = (name) => legacyMuted || levels[name].muted ? 0 : levels[name].volume;

function ac() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = legacyMuted ? 0 : 1; master.connect(ctx.destination);
  return ctx;
}

function updateLiveLevels() {
  if (master) master.gain.value = legacyMuted ? 0 : 1;
  if (bedGain && ctx) {
    bedGain.gain.cancelScheduledValues(ctx.currentTime);
    bedGain.gain.setTargetAtTime(bedBase * outputLevel('music'), ctx.currentTime, 0.08);
  }
  if (currentClip) currentClip.volume = outputLevel('narration');
  if (!outputLevel('narration')) {
    narrationGen += 1;                 // supersede any in-flight narration lookup so it can't play post-mute
    stopCurrentClip();
    try { window.speechSynthesis?.cancel(); } catch { /* unavailable */ }
  }
}

export function setLevels(settings = {}) {
  for (const name of ['music', 'sfx', 'narration']) {
    const value = settings[name];
    if (typeof value === 'number') {
      levels[name] = { volume: clamp(value), muted: false };
    } else if (value) {
      levels[name] = {
        volume: Number.isFinite(Number(value.volume)) ? clamp(value.volume) : levels[name].volume,
        muted: typeof value.muted === 'boolean' ? value.muted : levels[name].muted,
      };
    }
  }
  updateLiveLevels();
}

export function getLevels() {
  return JSON.parse(JSON.stringify(levels));
}

export function unlock(id) {
  if (id) worldId = id;
  if (unlocked) return;
  unlocked = true;
  const c = ac(); if (c.state === 'suspended') c.resume();
  startBed();
}

export function setMuted(m) {
  legacyMuted = !!m;
  updateLiveLevels();
}

export function isMuted() { return legacyMuted; }

function blip(freq, dur, type = 'sine', gain = 0.25, slideTo = null) {
  const volume = outputLevel('sfx'); if (!volume) return;
  const c = ac(); const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(gain * volume, c.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g); g.connect(master); o.start(); o.stop(c.currentTime + dur + 0.02);
}

function noise(dur, gain = 0.3, lp = 1400) {
  const volume = outputLevel('sfx'); if (!volume) return;
  const c = ac(); const n = c.createBufferSource();
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  n.buffer = buf; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
  const g = c.createGain(); g.gain.value = gain * volume;
  n.connect(f); f.connect(g); g.connect(master); n.start();
}

export function sfx(name) {
  if (!unlocked || !outputLevel('sfx')) return;
  switch (name) {
    case 'place': blip(320, 0.12, 'triangle', 0.22, 420); break;
    case 'step': blip(240, 0.1, 'sine', 0.18, 300); break;
    case 'jump': blip(180, 0.18, 'sawtooth', 0.18, 520); break;
    case 'capture': noise(0.28, 0.35, 2200); blip(140, 0.3, 'sawtooth', 0.2, 70); break;
    case 'win': [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.24, 'triangle', 0.25), i * 120)); break;
    case 'lose': [392, 330, 262].forEach((f, i) => setTimeout(() => blip(f, 0.3, 'sine', 0.22, f * 0.8), i * 150)); break;
  }
}

async function startBed() {
  if (bed) return;
  const c = ac();
  bedGain = c.createGain(); bedGain.gain.value = 0; bedGain.connect(master);
  if (worldId && worldId !== 'parampare') {
    try {
      const res = await fetch(`assets/${worldId}/music.mp3`, { method: 'HEAD' });
      if (res.ok) {
        const el = new Audio(`assets/${worldId}/music.mp3`); el.loop = true; el.crossOrigin = 'anonymous';
        const src = c.createMediaElementSource(el); src.connect(bedGain);
        await el.play().catch(() => {});
        bed = el; bedBase = 0.32;
        bedGain.gain.linearRampToValueAtTime(bedBase * outputLevel('music'), c.currentTime + 2);
        return;
      }
    } catch { /* use the procedural bed */ }
  }
  const o1 = c.createOscillator(), o2 = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain();
  o1.type = 'sine'; o2.type = 'sine'; o1.frequency.value = 82; o2.frequency.value = 82.6;
  lfo.frequency.value = 0.08; lg.gain.value = 6; lfo.connect(lg); lg.connect(o2.frequency);
  o1.connect(bedGain); o2.connect(bedGain); o1.start(); o2.start(); lfo.start();
  bed = { procedural: true }; bedBase = 0.18;
  bedGain.gain.linearRampToValueAtTime(bedBase * outputLevel('music'), c.currentTime + 3);
}

const voiceMaps = {};
// v1.8 α1: optional installed voice packs. When set, narrate() tries the active language's installed
// voice pack (served from CacheStorage via packs.getVoiceFile) BEFORE the bundled assets — this is what
// lets a lean default-core play optional-language narration it doesn't ship. Unset = bundled assets only.
let voiceSource = null;
export function setVoiceSource(fn) { voiceSource = typeof fn === 'function' ? fn : null; }
async function playResponse(resp, volume, gen) {
  const blob = await resp.blob();
  if (gen !== narrationGen) return;              // a newer narrate() superseded this lookup — drop it
  stopCurrentClip();
  const url = URL.createObjectURL(blob);
  const clip = new Audio(url); clip.volume = volume;
  currentClip = clip; currentClipUrl = url;
  const done = () => { if (currentClip === clip) stopCurrentClip(); else { try { URL.revokeObjectURL(url); } catch { /* already revoked */ } } };
  clip.addEventListener('ended', done, { once: true });
  clip.addEventListener('error', done, { once: true });
  try { await clip.play(); } catch { done(); }
}
const voiceBase = (wid) => (lang === 'en' ? `assets/${wid}/voice` : `assets/${wid}/voice/${lang}`);
async function loadVoiceMap(wid) {
  if (!wid) return {};
  const key = `${wid}/${lang}`;
  if (voiceMaps[key]) return voiceMaps[key];
  try { const r = await fetch(`${voiceBase(wid)}/voice.json`); voiceMaps[key] = r.ok ? await r.json() : {}; }
  catch { voiceMaps[key] = {}; }
  return voiceMaps[key];
}

// Game-level UI narration (tutorial / Learn steps): assets/ui/voice[/<lang>]/voice.json.
const uiVoiceMaps = {};
const uiVoiceBase = () => (lang === 'en' ? 'assets/ui/voice' : `assets/ui/voice/${lang}`);
async function loadUIVoiceMap() {
  if (uiVoiceMaps[lang]) return uiVoiceMaps[lang];
  try { const r = await fetch(`${uiVoiceBase()}/voice.json`); uiVoiceMaps[lang] = r.ok ? await r.json() : {}; }
  catch { uiVoiceMaps[lang] = {}; }
  return uiVoiceMaps[lang];
}

const SPEECH_LOCALE = { en: 'en-IN', kn: 'kn-IN', hi: 'hi-IN', ta: 'ta-IN', te: 'te-IN', ml: 'ml-IN', mr: 'mr-IN' };

export async function narrate(text, world) {
  const gen = ++narrationGen;                    // bump first: even a muted/empty call supersedes older lookups
  const volume = outputLevel('narration');
  if (!volume || !text) return;
  const wid = (world && world.id) || worldId;
  // 0) installed voice pack (default-core / on-demand): try the world scope then the ui scope.
  if (voiceSource) {
    for (const scope of [wid, 'ui']) {
      if (!scope) continue;
      try {
        const resp = await voiceSource(lang, text, scope);
        if (gen !== narrationGen) return;
        if (resp) { await playResponse(resp, volume, gen); return; }
      } catch { /* fall through to bundled assets */ }
    }
  }
  // 1) per-world teaching clip, then 2) game-level UI clip (tutorial / Learn).
  const map = await loadVoiceMap(wid);
  if (gen !== narrationGen) return;
  let file = map[text], base = voiceBase(wid);
  if (!file) { const um = await loadUIVoiceMap(); if (gen !== narrationGen) return; if (um[text]) { file = um[text]; base = uiVoiceBase(); } }
  if (file) {
    try {
      stopCurrentClip();
      const clip = new Audio(`${base}/${file}`); clip.volume = volume; currentClip = clip; currentClipUrl = null;
      await clip.play(); return;
    } catch { /* use Web Speech */ }
  }
  // 3) Web Speech fallback — use the current language's locale for correct pronunciation.
  if (!('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = SPEECH_LOCALE[lang] || (world && world.voice && world.voice.web) || 'en-IN';
    utterance.rate = 0.98; utterance.pitch = 1; utterance.volume = volume;
    speechSynthesis.speak(utterance);
  } catch { /* narration is optional */ }
}
