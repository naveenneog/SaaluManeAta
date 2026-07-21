// Mobile-first controls for explicit AI-vs-AI spectating. The generated match is displayed
// by replay-ui; this layer only starts, pauses/steps, changes speed, exports, and skips.
// Keep this module byte-identical across games after cross-review.

const STYLE_ID = 'tbg-spectate-styles';
const SPEEDS = Object.freeze([
  Object.freeze({ label: 'Slow', stepMs: 1400 }),
  Object.freeze({ label: 'Normal', stepMs: 900 }),
  Object.freeze({ label: 'Fast', stepMs: 450 }),
]);

function injectStyles(accent) {
  if (document.getElementById(STYLE_ID)) return;
  const safeAccent = /^#[0-9a-f]{6}$/i.test(accent ?? '') ? accent : '#e8c24a';
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #sp-open{position:fixed;right:12px;bottom:calc(60px + env(safe-area-inset-bottom,0));z-index:120;
      min-height:44px;padding:0 .85rem;border-radius:12px;border:1px solid color-mix(in srgb,${safeAccent} 70%,transparent);
      background:rgba(0,0,0,.72);color:#fff;font:600 .82rem "Segoe UI",sans-serif;cursor:pointer}
    #sp-controls{position:fixed;top:calc(10px + env(safe-area-inset-top,0));left:50%;transform:translateX(-50%);
      z-index:216;display:none;align-items:center;gap:.45rem;width:min(94vw,680px);box-sizing:border-box;padding:.55rem .65rem;
      border:1px solid rgba(255,255,255,.18);border-radius:14px;background:rgba(15,18,24,.96);color:#eef2f7;
      box-shadow:0 10px 28px rgba(0,0,0,.35);font:600 .82rem "Segoe UI",sans-serif}
    #sp-controls.show{display:flex}#sp-status{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #sp-controls button,#sp-controls select{min-height:38px;border-radius:9px;border:1px solid rgba(255,255,255,.18);
      background:#242b38;color:#eef2f7;padding:0 .65rem;font:inherit;cursor:pointer}
    #sp-controls button.primary{background:${safeAccent};color:#17120a;border-color:transparent}
    #sp-controls button:disabled,#sp-controls select:disabled{opacity:.48;cursor:default}
    @media(max-width:560px){#sp-label{display:none}#sp-controls{gap:.3rem;padding:.45rem}#sp-controls button,#sp-controls select{padding:0 .48rem}}
    @media(prefers-reduced-motion:reduce){#sp-controls,#sp-open{transition:none!important;animation:none!important}}`;
  document.head.appendChild(style);
}

function buildDom(translate) {
  const open = document.createElement('button');
  open.id = 'sp-open';
  open.type = 'button';
  open.textContent = `▶ ${translate('Watch two AIs play')}`;

  const controls = document.createElement('div');
  controls.id = 'sp-controls';
  controls.setAttribute('role', 'region');
  controls.setAttribute('aria-label', translate('AI versus AI spectate controls'));

  const label = document.createElement('span');
  label.id = 'sp-label';
  label.textContent = translate('AI vs AI');
  const status = document.createElement('span');
  status.id = 'sp-status';
  status.setAttribute('aria-live', 'polite');
  const speed = document.createElement('select');
  speed.id = 'sp-speed';
  speed.setAttribute('aria-label', translate('Speed'));
  for (const choice of SPEEDS) {
    const option = document.createElement('option');
    option.value = String(choice.stepMs);
    option.textContent = translate(choice.label);
    if (choice.stepMs === 900) option.selected = true;
    speed.appendChild(option);
  }
  const pause = document.createElement('button');
  pause.id = 'sp-pause';
  pause.type = 'button';
  const exportButton = document.createElement('button');
  exportButton.id = 'sp-export';
  exportButton.type = 'button';
  exportButton.textContent = translate('Export');
  const skip = document.createElement('button');
  skip.id = 'sp-skip';
  skip.type = 'button';
  skip.textContent = translate('Skip');
  skip.classList.add('primary');
  controls.append(label, status, speed, pause, exportButton, skip);
  document.body.append(open, controls);
  return { open, controls, status, speed, pause, exportButton, skip };
}

export function initSpectateUI({
  spectate,
  translate = (key) => key,
  accent = '#e8c24a',
  reducedMotion = false,
  saveData = false,
} = {}) {
  if (typeof document === 'undefined') throw new Error('initSpectateUI requires a document');
  if (!spectate || typeof spectate.start !== 'function' || typeof spectate.pause !== 'function'
    || typeof spectate.skip !== 'function' || typeof spectate.exportReplay !== 'function') {
    throw new TypeError('initSpectateUI requires a spectate controller');
  }
  if (typeof translate !== 'function') throw new TypeError('spectate translate must be a function');
  injectStyles(accent);
  const elements = buildDom(translate);
  const stepOnly = reducedMotion || saveData || spectate.autoplay === false;
  let pending = false;

  function updatePause() {
    elements.pause.textContent = translate(stepOnly ? 'Step' : (spectate.playing ? 'Pause' : 'Resume'));
    elements.speed.disabled = stepOnly;
  }

  async function start(seed) {
    if (pending) return null;
    pending = true;
    elements.open.disabled = true;
    elements.status.textContent = translate('Preparing match…');
    elements.controls.classList.add('show');
    try {
      spectate.setSpeed?.(Number(elements.speed.value));
      const generated = await spectate.start(seed);
      if (!generated) return null;
      elements.status.textContent = translate('Spectate ready');
      updatePause();
      return generated;
    } catch {
      elements.status.textContent = translate('Spectate unavailable');
      return null;
    } finally {
      pending = false;
      elements.open.disabled = false;
    }
  }

  function pauseOrStep() {
    if (stepOnly) {
      spectate.step?.();
    } else if (spectate.playing) {
      spectate.pause();
    } else {
      spectate.play?.();
    }
    updatePause();
  }

  function skip() {
    spectate.skip();
    elements.controls.classList.remove('show');
    elements.status.textContent = '';
    updatePause();
  }

  elements.open.addEventListener('click', () => start());
  elements.pause.addEventListener('click', pauseOrStep);
  elements.skip.addEventListener('click', skip);
  elements.exportButton.addEventListener('click', () => spectate.exportReplay());
  elements.speed.addEventListener('change', () => {
    try { spectate.setSpeed?.(Number(elements.speed.value)); } catch { /* retain previous valid speed */ }
    updatePause();
  });
  updatePause();

  return Object.freeze({
    start,
    pause: () => { spectate.pause(); updatePause(); },
    skip,
    open: () => elements.controls.classList.add('show'),
    close: skip,
    destroy: () => {
      spectate.skip();
      elements.open.remove();
      elements.controls.remove();
    },
    get active() { return spectate.active === true; },
  });
}
