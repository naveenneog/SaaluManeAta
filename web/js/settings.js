const QUALITIES = new Set(['high', 'balanced', 'low']);
const TEXT_SIZES = new Set(['normal', 'large']);
const LANGS = new Set(['en', 'kn', 'hi', 'ta', 'te', 'ml', 'mr']);
const LANG_NAMES = { en: 'English', kn: 'ಕನ್ನಡ Kannada', hi: 'हिन्दी Hindi', ta: 'தமிழ் Tamil', te: 'తెలుగు Telugu', ml: 'മലയാളം Malayalam', mr: 'मराठी Marathi' };
const clamp = (n) => Math.max(0, Math.min(1, Number(n)));
const copy = (value) => JSON.parse(JSON.stringify(value));

const DEFAULTS = Object.freeze({
  music: Object.freeze({ volume: 1, muted: false }),
  sfx: Object.freeze({ volume: 1, muted: false }),
  narration: Object.freeze({ volume: 1, muted: false }),
  reducedMotion: false,
  quality: 'high',
  textSize: 'normal',
  haptics: true,
  lang: 'en',
});

function channel(value, fallback) {
  if (typeof value === 'number') return { volume: clamp(value), muted: false };
  return {
    volume: Number.isFinite(Number(value?.volume)) ? clamp(value.volume) : fallback.volume,
    muted: typeof value?.muted === 'boolean' ? value.muted : fallback.muted,
  };
}

function normalize(value = {}) {
  return {
    music: channel(value.music, DEFAULTS.music),
    sfx: channel(value.sfx, DEFAULTS.sfx),
    narration: channel(value.narration, DEFAULTS.narration),
    reducedMotion: typeof value.reducedMotion === 'boolean' ? value.reducedMotion : DEFAULTS.reducedMotion,
    quality: QUALITIES.has(value.quality) ? value.quality : DEFAULTS.quality,
    textSize: TEXT_SIZES.has(value.textSize) ? value.textSize : DEFAULTS.textSize,
    haptics: typeof value.haptics === 'boolean' ? value.haptics : DEFAULTS.haptics,
    lang: LANGS.has(value.lang) ? value.lang : DEFAULTS.lang,
  };
}

function applyDocumentSettings(settings) {
  document.body.classList.toggle('tbg-reduced-motion', settings.reducedMotion);
  document.body.classList.toggle('tbg-text-large', settings.textSize === 'large');
  document.body.dataset.tbgQuality = settings.quality;
  document.documentElement.style.setProperty('--tbg-text-scale', settings.textSize === 'large' ? '1.125' : '1');
  document.documentElement.style.fontSize = 'calc(16px * var(--tbg-text-scale))';
}

function injectStyles() {
  if (document.querySelector('#tbg-settings-styles')) return;
  const style = document.createElement('style');
  style.id = 'tbg-settings-styles';
  style.textContent = `
    #tbg-settings-button{position:fixed;z-index:140;right:3.75rem;bottom:.6rem;width:44px;height:44px;
      margin-bottom:env(safe-area-inset-bottom,0);display:flex;align-items:center;justify-content:center;
      border:1px solid color-mix(in srgb,var(--tbg-settings-accent,#e8c24a) 68%,transparent);
      border-radius:50%;background:rgba(13,14,10,.88);color:#f4e7cf;font:inherit;font-size:1.15rem;
      box-shadow:0 6px 18px rgba(0,0,0,.42);cursor:pointer;touch-action:manipulation}
    #tbg-settings-button:focus-visible,#tbg-settings-panel button:focus-visible,#tbg-settings-panel input:focus-visible,
      #tbg-settings-panel select:focus-visible{outline:2px solid var(--tbg-settings-accent,#e8c24a);outline-offset:2px}
    #tbg-settings-shell{position:fixed;inset:0;z-index:150;pointer-events:none}
    #tbg-settings-scrim{position:absolute;inset:0;background:rgba(5,6,4,.62);opacity:0;transition:opacity .25s}
    #tbg-settings-panel{position:absolute;top:0;right:0;width:min(92vw,390px);height:100%;overflow:auto;
      padding:calc(1rem + env(safe-area-inset-top,0)) 1rem calc(1rem + env(safe-area-inset-bottom,0));
      color:#f4ead2;background:linear-gradient(180deg,rgba(27,28,22,.985),rgba(10,12,8,.99));
      border-left:1px solid color-mix(in srgb,var(--tbg-settings-accent,#e8c24a) 45%,transparent);
      box-shadow:-18px 0 55px rgba(0,0,0,.52);transform:translateX(104%);transition:transform .28s ease}
    #tbg-settings-shell.show{pointer-events:auto}
    #tbg-settings-shell.show #tbg-settings-scrim{opacity:1}
    #tbg-settings-shell.show #tbg-settings-panel{transform:translateX(0)}
    .tbg-settings-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1rem}
    .tbg-settings-head h2{margin:0;color:var(--tbg-settings-accent,#e8c24a);font:600 1.35rem 'Noto Serif',Georgia,serif}
    .tbg-settings-close{width:42px;height:42px;border:1px solid rgba(255,255,255,.2);border-radius:50%;
      color:#f4ead2;background:rgba(255,255,255,.06);font:inherit;font-size:1.35rem;cursor:pointer}
    .tbg-settings-group{margin:.8rem 0;padding:.85rem;border:1px solid rgba(232,194,74,.2);border-radius:12px;
      background:rgba(255,255,255,.035)}
    .tbg-settings-group legend{padding:0 .35rem;color:#d8c792;font:600 .78rem 'Segoe UI',sans-serif;
      letter-spacing:.11em;text-transform:uppercase}
    .tbg-audio-row{display:grid;grid-template-columns:5.4rem 1fr auto;gap:.55rem;align-items:center;margin:.7rem 0}
    .tbg-audio-row>label{font-size:.93rem}
    .tbg-range-wrap{display:grid;grid-template-columns:1fr 2.4rem;gap:.4rem;align-items:center}
    .tbg-range-wrap input{width:100%;accent-color:var(--tbg-settings-accent,#e8c24a)}
    .tbg-range-wrap output{text-align:right;color:#cbb98a;font-variant-numeric:tabular-nums;font-size:.8rem}
    .tbg-mute{display:flex;gap:.3rem;align-items:center;color:#c8c2af;font-size:.78rem}
    .tbg-mute input,.tbg-switch input{width:18px;height:18px;accent-color:var(--tbg-settings-accent,#e8c24a)}
    .tbg-setting-line{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin:.65rem 0}
    .tbg-setting-line label,.tbg-switch{font-size:.93rem}
    .tbg-setting-line select{min-height:40px;padding:.35rem .55rem;border:1px solid rgba(232,194,74,.3);
      border-radius:9px;background:#171a12;color:#f4ead2;font:inherit}
    .tbg-switch{display:flex;align-items:center;justify-content:space-between;gap:1rem;width:100%}
    .tbg-settings-note{margin:.45rem 0 0;color:#a9a58f;font-size:.75rem;line-height:1.45}
    #tbg-settings-reset{width:100%;min-height:44px;margin-top:.4rem;border:1px solid rgba(232,194,74,.3);
      border-radius:10px;background:rgba(255,255,255,.045);color:#d8cfae;font:inherit;cursor:pointer}
    .tbg-text-large #tbg-settings-panel{font-size:1rem}
    .tbg-reduced-motion #tbg-settings-panel,.tbg-reduced-motion #tbg-settings-scrim{transition:none}
    @media(max-width:520px){#tbg-settings-button{right:3.65rem}.tbg-audio-row{grid-template-columns:4.8rem 1fr}.tbg-mute{grid-column:2}}
  `;
  document.head.appendChild(style);
}

function audioRow(id, label) {
  return `<div class="tbg-audio-row">
    <label for="tbg-${id}-volume">${label}</label>
    <div class="tbg-range-wrap"><input id="tbg-${id}-volume" type="range" min="0" max="1" step=".05">
      <output id="tbg-${id}-value"></output></div>
    <label class="tbg-mute"><input id="tbg-${id}-muted" type="checkbox"> Mute</label>
  </div>`;
}

export function applySettings(settings, { bloomPass, grand, audio } = {}) {
  applyDocumentSettings(settings);
  audio?.setLevels?.(settings);
  if (bloomPass) {
    if (!Number.isFinite(bloomPass.userData?.tbgBaseStrength)) {
      bloomPass.userData = { ...(bloomPass.userData || {}), tbgBaseStrength: bloomPass.strength };
    }
    const factor = settings.quality === 'high' ? 1 : settings.quality === 'balanced' ? 0.68 : 0;
    bloomPass.enabled = settings.quality !== 'low';
    bloomPass.strength = bloomPass.userData.tbgBaseStrength * factor;
  }
  grand?.setVisualSettings?.({ quality: settings.quality, reducedMotion: settings.reducedMotion });
}

export function initSettings({ id, accent = '#e8c24a', onChange } = {}) {
  if (!id) throw new Error('Settings id is required');
  const key = `tbg.${id}.settings.v1`;
  let settings = copy(DEFAULTS);
  try { settings = normalize(JSON.parse(localStorage.getItem(key) || '{}')); } catch { settings = copy(DEFAULTS); }
  applyDocumentSettings(settings);
  injectStyles();
  document.documentElement.style.setProperty('--tbg-settings-accent', accent);

  const button = document.createElement('button');
  button.id = 'tbg-settings-button';
  button.type = 'button';
  button.textContent = '⚙';
  button.title = 'Settings and accessibility';
  button.setAttribute('aria-label', 'Settings and accessibility');
  button.setAttribute('aria-expanded', 'false');

  const shell = document.createElement('div');
  shell.id = 'tbg-settings-shell';
  shell.setAttribute('aria-hidden', 'true');
  shell.innerHTML = `<div id="tbg-settings-scrim"></div>
    <aside id="tbg-settings-panel" role="dialog" aria-modal="true" aria-labelledby="tbg-settings-title">
      <div class="tbg-settings-head"><h2 id="tbg-settings-title">Settings</h2>
        <button class="tbg-settings-close" type="button" aria-label="Close settings">×</button></div>
      <fieldset class="tbg-settings-group"><legend>Language</legend>
        <div class="tbg-setting-line"><label for="tbg-lang">Read-out &amp; text</label>
          <select id="tbg-lang">${Object.entries(LANG_NAMES).map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}</select></div>
        <p class="tbg-settings-note">Sets the narration voice and the on-screen teachings. Changing it reloads the game.</p>
      </fieldset>
      <fieldset class="tbg-settings-group"><legend>Sound</legend>
        ${audioRow('music', 'Music')}${audioRow('sfx', 'Effects')}${audioRow('narration', 'Narration')}
      </fieldset>
      <fieldset class="tbg-settings-group"><legend>Comfort</legend>
        <div class="tbg-setting-line"><label class="tbg-switch">Reduced motion
          <input id="tbg-reduced-motion" type="checkbox"></label></div>
        <div class="tbg-setting-line"><label for="tbg-quality">Visual quality</label>
          <select id="tbg-quality"><option value="high">High</option><option value="balanced">Balanced</option><option value="low">Low</option></select></div>
        <p class="tbg-settings-note">Low quality turns off bloom and floating dust for weaker phones.</p>
        <div class="tbg-setting-line"><label for="tbg-text-size">Text size</label>
          <select id="tbg-text-size"><option value="normal">Normal</option><option value="large">Large</option></select></div>
        <div class="tbg-setting-line"><label class="tbg-switch">Haptic feedback
          <input id="tbg-haptics" type="checkbox"></label></div>
      </fieldset>
      <button id="tbg-settings-reset" type="button">Restore defaults</button>
    </aside>`;

  document.body.append(button, shell);
  const panel = shell.querySelector('#tbg-settings-panel');
  const controls = {
    music: { volume: shell.querySelector('#tbg-music-volume'), muted: shell.querySelector('#tbg-music-muted'), output: shell.querySelector('#tbg-music-value') },
    sfx: { volume: shell.querySelector('#tbg-sfx-volume'), muted: shell.querySelector('#tbg-sfx-muted'), output: shell.querySelector('#tbg-sfx-value') },
    narration: { volume: shell.querySelector('#tbg-narration-volume'), muted: shell.querySelector('#tbg-narration-muted'), output: shell.querySelector('#tbg-narration-value') },
    reducedMotion: shell.querySelector('#tbg-reduced-motion'),
    quality: shell.querySelector('#tbg-quality'),
    textSize: shell.querySelector('#tbg-text-size'),
    haptics: shell.querySelector('#tbg-haptics'),
    lang: shell.querySelector('#tbg-lang'),
  };

  const render = () => {
    for (const name of ['music', 'sfx', 'narration']) {
      controls[name].volume.value = String(settings[name].volume);
      controls[name].muted.checked = settings[name].muted;
      controls[name].output.value = `${Math.round(settings[name].volume * 100)}%`;
    }
    controls.reducedMotion.checked = settings.reducedMotion;
    controls.quality.value = settings.quality;
    controls.textSize.value = settings.textSize;
    controls.haptics.checked = settings.haptics;
    controls.lang.value = settings.lang;
  };
  const notify = () => {
    applyDocumentSettings(settings);
    try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* persistence is optional */ }
    onChange?.(copy(settings));
  };
  const open = () => {
    shell.classList.add('show');
    shell.setAttribute('aria-hidden', 'false');
    button.setAttribute('aria-expanded', 'true');
    panel.querySelector('button, input, select')?.focus();
  };
  const close = () => {
    shell.classList.remove('show');
    shell.setAttribute('aria-hidden', 'true');
    button.setAttribute('aria-expanded', 'false');
    button.focus();
  };

  for (const name of ['music', 'sfx', 'narration']) {
    controls[name].volume.addEventListener('input', () => {
      settings[name].volume = clamp(controls[name].volume.value);
      controls[name].output.value = `${Math.round(settings[name].volume * 100)}%`;
      notify();
    });
    controls[name].muted.addEventListener('change', () => { settings[name].muted = controls[name].muted.checked; notify(); });
  }
  controls.reducedMotion.addEventListener('change', () => { settings.reducedMotion = controls.reducedMotion.checked; notify(); });
  controls.quality.addEventListener('change', () => { settings.quality = controls.quality.value; notify(); });
  controls.textSize.addEventListener('change', () => { settings.textSize = controls.textSize.value; notify(); });
  controls.haptics.addEventListener('change', () => { settings.haptics = controls.haptics.checked; notify(); });
  controls.lang.addEventListener('change', () => { settings.lang = controls.lang.value; try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* ignore */ } location.reload(); });
  shell.querySelector('#tbg-settings-reset').addEventListener('click', () => { settings = copy(DEFAULTS); render(); notify(); });
  button.addEventListener('click', open);
  shell.querySelector('.tbg-settings-close').addEventListener('click', close);
  shell.querySelector('#tbg-settings-scrim').addEventListener('click', close);
  addEventListener('keydown', (event) => { if (event.key === 'Escape' && shell.classList.contains('show')) close(); });

  render();
  onChange?.(copy(settings));
  return {
    get: () => copy(settings),
    open,
    close,
    haptic(kind = 'tap') {
      if (!settings.haptics || !navigator.vibrate) return false;
      const mobile = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
      if (!mobile) return false;
      const pattern = kind === 'win' ? [35, 45, 45, 45, 85] : kind === 'capture' ? [25, 35, 42] : 18;
      try { return navigator.vibrate(pattern); } catch { return false; }
    },
  };
}
