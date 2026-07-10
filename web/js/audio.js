// Audio for Aadu Huli: Web-Audio SFX, an optional looping music bed (per-world
// mp3 if present, else a soft procedural drone), and narration that prefers a
// pre-rendered Azure voice clip and falls back to the browser's speech engine.
let ctx = null, master = null, bed = null, bedGain = null, muted = false, unlocked = false;
let voiceMap = null, worldId = null;

function ac() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  return ctx;
}

export function unlock(id) {
  if (id) worldId = id;
  if (unlocked) return;
  unlocked = true;
  const c = ac(); if (c.state === 'suspended') c.resume();
  startBed();
}

export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.9; if (bedGain) bedGain.gain.value = m ? 0 : 0.28; }
export function isMuted() { return muted; }

// ---- short synthesized effects ------------------------------------------------
function blip(freq, dur, type = 'sine', gain = 0.25, slideTo = null) {
  if (muted) return;
  const c = ac(); const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g); g.connect(master); o.start(); o.stop(c.currentTime + dur + 0.02);
}
function noise(dur, gain = 0.3, lp = 1400) {
  if (muted) return;
  const c = ac(); const n = c.createBufferSource();
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  n.buffer = buf; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
  const g = c.createGain(); g.gain.value = gain;
  n.connect(f); f.connect(g); g.connect(master); n.start();
}

export function sfx(name) {
  if (!unlocked) return;
  switch (name) {
    case 'place': blip(320, 0.12, 'triangle', 0.22, 420); break;
    case 'step':  blip(240, 0.1, 'sine', 0.18, 300); break;
    case 'jump':  blip(180, 0.18, 'sawtooth', 0.18, 520); break;
    case 'capture': noise(0.28, 0.35, 2200); blip(140, 0.3, 'sawtooth', 0.2, 70); break;
    case 'win':   [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.24, 'triangle', 0.25), i * 120)); break;
    case 'lose':  [392, 330, 262].forEach((f, i) => setTimeout(() => blip(f, 0.3, 'sine', 0.22, f * 0.8), i * 150)); break;
  }
}

// ---- music bed ----------------------------------------------------------------
async function startBed() {
  if (bed || muted) return;
  const c = ac();
  bedGain = c.createGain(); bedGain.gain.value = 0.0; bedGain.connect(master);
  // try a generated per-world loop first
  if (worldId) {
    try {
      const res = await fetch(`assets/${worldId}/music.mp3`, { method: 'HEAD' });
      if (res.ok) {
        const el = new Audio(`assets/${worldId}/music.mp3`); el.loop = true; el.crossOrigin = 'anonymous';
        const src = c.createMediaElementSource(el); src.connect(bedGain);
        await el.play().catch(() => {});
        bed = el; bedGain.gain.linearRampToValueAtTime(0.32, c.currentTime + 2); return;
      }
    } catch { /* fall through to procedural */ }
  }
  // procedural low drone (two detuned oscillators + slow LFO)
  const o1 = c.createOscillator(), o2 = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain();
  o1.type = 'sine'; o2.type = 'sine'; o1.frequency.value = 82; o2.frequency.value = 82.6;
  lfo.frequency.value = 0.08; lg.gain.value = 6; lfo.connect(lg); lg.connect(o2.frequency);
  o1.connect(bedGain); o2.connect(bedGain); o1.start(); o2.start(); lfo.start();
  bed = { procedural: true };
  bedGain.gain.linearRampToValueAtTime(0.18, c.currentTime + 3);
}

// ---- narration ----------------------------------------------------------------
const voiceMaps = {};   // worldId -> { text: filename } (Azure DragonHD clips)
async function loadVoiceMap(wid) {
  if (!wid) return {};
  if (voiceMaps[wid]) return voiceMaps[wid];
  try { const r = await fetch(`assets/${wid}/voice/voice.json`); voiceMaps[wid] = r.ok ? await r.json() : {}; }
  catch { voiceMaps[wid] = {}; }
  return voiceMaps[wid];
}

let currentClip = null;
export async function narrate(text, world) {
  if (muted || !text) return;
  const wid = (world && world.id) || worldId;                 // always available via the world object
  const map = await loadVoiceMap(wid);
  const file = map[text];
  if (file) {
    try {
      if (currentClip) { currentClip.pause(); }
      const a = new Audio(`assets/${wid}/voice/${file}`); a.volume = 0.98; currentClip = a;
      await a.play(); return;                                  // Azure DragonHD (en-IN) clip
    } catch { /* clip missing/blocked -> Web-Speech fallback below */ }
  }
  if (!('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = (world && world.voice && world.voice.web) || 'en-IN';
    u.rate = 0.98; u.pitch = 1.0;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}
