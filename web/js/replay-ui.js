// replay-ui.js — renderer-agnostic, mobile-first chrome around replay-player.js.
// Imported replays remain read-only: this module has no profile, save, or achievement dependency.
// Keep this module byte-identical across games (drift-guarded after review).
import { derive } from './action-log.js';
import { exportReplay, importReplay, verifyReplay } from './replay-format.js';
import { createReplayNarrator } from './replay-narration.js';
import { initReplayPlayer } from './replay-player.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.trunc(Number(value) || 0)));

export function clampReplayIndex(value, total) {
  return clamp(value, 0, Math.max(0, Math.trunc(Number(total) || 0)));
}

export function initReplayUI({
  id,
  adapter,
  validation,
  renderState,
  restoreLive = null,
  describeTransition = () => null,
  narrate = null,
  translate = (key) => key,
  reducedMotion = false,
  accent = '#e8c24a',
  stepMs = 900,
} = {}) {
  if (typeof document === 'undefined') throw new Error('initReplayUI requires a document');
  if (typeof id !== 'string' || !id) throw new TypeError('initReplayUI requires a game id');
  if (!adapter || typeof adapter.setup !== 'function' || typeof adapter.apply !== 'function') {
    throw new TypeError('initReplayUI requires an action-log adapter');
  }
  if (!validation || validation.game !== id) throw new TypeError('initReplayUI requires replay validation options');
  if (typeof renderState !== 'function') throw new TypeError('initReplayUI requires renderState');
  if (typeof translate !== 'function') throw new TypeError('initReplayUI translate must be a function');

  injectStyles(accent);
  const els = buildDom();
  els.title.textContent = translate('Replay');
  els.importBtn.textContent = translate('Import');
  els.exportBtn.textContent = translate('Export');
  els.close.setAttribute('aria-label', translate('Close'));
  els.restart.setAttribute('aria-label', translate('Restart'));
  els.previous.setAttribute('aria-label', translate('Previous move'));
  els.play.setAttribute('aria-label', translate('Play'));
  els.next.setAttribute('aria-label', translate('Next move'));
  els.openBtn.title = translate('Replay');
  els.openBtn.setAttribute('aria-label', translate('Replay'));
  const narrator = createReplayNarrator({ describe: describeTransition, translate, narrate });
  let envelope = null;
  let active = false;
  let speakNext = false;
  let animateNext = false;

  const player = initReplayPlayer({
    adapter,
    stepMs,
    onState: (state, index) => {
      els.range.max = String(player.total);
      els.range.value = String(index);
      els.position.textContent = `${translate('Move')} ${index} ${translate('of')} ${player.total}`;
      els.play.textContent = player.playing ? '❚❚' : '▶';
      els.play.setAttribute('aria-label', translate(player.playing ? 'Pause' : 'Play'));
      renderState(state, {
        index,
        total: player.total,
        source: 'replay',
        animate: !reducedMotion && animateNext,
      });
      animateNext = false;
      if (!envelope || index === 0) {
        els.narration.textContent = translate('Replay ready');
      } else {
        const before = derive(envelope.log, adapter, index - 1).state;
        const described = narrator.present({
          before,
          after: state,
          entry: envelope.log.actions[index - 1],
          index: index - 1,
          actionNumber: index,
          total: player.total,
          log: envelope.log,
        }, { speak: speakNext || player.playing });
        els.narration.textContent = described?.text ?? translate('Move complete');
      }
      speakNext = false;
      updateDisabled();
    },
    onComplete: () => {
      els.play.textContent = '▶';
      els.play.setAttribute('aria-label', translate('Play'));
      updateDisabled();
    },
  });

  function updateDisabled() {
    const loaded = !!envelope;
    els.play.disabled = !loaded || player.total === 0;
    els.previous.disabled = !loaded || player.index <= 0;
    els.next.disabled = !loaded || player.index >= player.total;
    els.restart.disabled = !loaded || player.index <= 0;
    els.exportBtn.disabled = !loaded;
    els.range.disabled = !loaded;
  }

  function setMessage(key) {
    els.narration.textContent = translate(key);
  }

  function load(value) {
    const checked = verifyReplay(value, adapter, validation);
    if (!checked.ok) {
      setMessage('That replay could not be opened.');
      return false;
    }
    envelope = checked.envelope;
    active = true;
    els.panel.classList.add('show');
    document.body.classList.add('replay-viewing');
    player.load(envelope.log);
    updateDisabled();
    return true;
  }

  function open(value = null) {
    active = true;
    els.panel.classList.add('show');
    document.body.classList.add('replay-viewing');
    if (value) return load(value);
    setMessage(envelope ? 'Replay ready' : 'Import a replay to begin');
    updateDisabled();
    return true;
  }

  function close() {
    player.pause();
    active = false;
    els.panel.classList.remove('show');
    document.body.classList.remove('replay-viewing');
    try { restoreLive?.(); } catch { /* renderer owns live-state recovery */ }
  }

  async function importFile(file) {
    setMessage('Opening replay…');
    const imported = await importReplay(file, { adapter, ...validation });
    if (!imported) {
      setMessage('That replay could not be opened.');
      return false;
    }
    return load(imported);
  }

  async function exportCurrent() {
    if (!envelope) return null;
    try {
      const exported = await exportReplay(envelope.log, {
        adapter,
        ...validation,
        filename: `${id}.tbg-replay.json`,
      });
      const url = URL.createObjectURL(exported.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = exported.filename;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      return exported;
    } catch {
      setMessage('That replay could not be exported.');
      return null;
    }
  }

  function play() {
    if (!envelope) return;
    if (player.playing) {
      player.pause();
      els.play.textContent = '▶';
      els.play.setAttribute('aria-label', translate('Play'));
      return;
    }
    if (player.index >= player.total) player.restart();
    animateNext = !reducedMotion;
    player.play({ stepMs: Number(els.speed.value) || stepMs });
    els.play.textContent = '❚❚';
    els.play.setAttribute('aria-label', translate('Pause'));
  }

  function step(delta = 1) {
    if (!envelope) return false;
    player.pause();
    speakNext = true;
    animateNext = !reducedMotion;
    if (delta < 0) {
      player.seek(clampReplayIndex(player.index - 1, player.total));
      return true;
    }
    return player.step();
  }

  function seek(index) {
    if (!envelope) return;
    player.pause();
    speakNext = false;
    animateNext = false;
    player.seek(clampReplayIndex(index, player.total));
  }

  function restart() {
    if (!envelope) return;
    player.pause();
    speakNext = false;
    animateNext = false;
    player.restart();
  }

  els.openBtn.addEventListener('click', () => open());
  els.close.addEventListener('click', close);
  els.panel.addEventListener('click', (event) => { if (event.target === els.panel) close(); });
  els.importBtn.addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', async () => {
    const [file] = els.file.files ?? [];
    if (file) await importFile(file);
    els.file.value = '';
  });
  els.exportBtn.addEventListener('click', exportCurrent);
  els.play.addEventListener('click', play);
  els.previous.addEventListener('click', () => step(-1));
  els.next.addEventListener('click', () => step(1));
  els.restart.addEventListener('click', restart);
  els.range.addEventListener('input', () => seek(els.range.value));

  updateDisabled();
  return Object.freeze({
    open,
    close,
    load,
    importFile,
    exportCurrent,
    play,
    pause: () => player.pause(),
    step,
    seek,
    restart,
    get active() { return active; },
    get envelope() { return envelope; },
    get index() { return player.index; },
    get total() { return player.total; },
    get playing() { return player.playing; },
  });
}

function buildDom() {
  const openBtn = document.createElement('button');
  openBtn.id = 'rp-open';
  openBtn.type = 'button';
  openBtn.textContent = '⏮';
  document.body.appendChild(openBtn);

  const panel = document.createElement('div');
  panel.id = 'rp-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.innerHTML = `
    <div class="rp-sheet">
      <div class="rp-head">
        <h3 id="rp-title"></h3>
        <button id="rp-import" type="button"></button>
        <button id="rp-export" type="button"></button>
        <button id="rp-close" type="button">✕</button>
      </div>
      <div id="rp-narration" aria-live="polite"></div>
      <input id="rp-range" type="range" min="0" max="0" value="0">
      <div class="rp-transport">
        <button id="rp-restart" type="button">↺</button>
        <button id="rp-previous" type="button">◀</button>
        <button id="rp-play" type="button">▶</button>
        <button id="rp-next" type="button">▶</button>
        <span id="rp-position"></span>
        <select id="rp-speed">
          <option value="1400">0.6×</option>
          <option value="900" selected>1×</option>
          <option value="450">2×</option>
        </select>
      </div>
      <input id="rp-file" type="file" accept=".tbg-replay.json,application/json" hidden>
    </div>`;
  document.body.appendChild(panel);

  const $ = (selector) => panel.querySelector(selector);
  const els = {
    openBtn,
    panel,
    title: $('#rp-title'),
    importBtn: $('#rp-import'),
    exportBtn: $('#rp-export'),
    close: $('#rp-close'),
    narration: $('#rp-narration'),
    range: $('#rp-range'),
    restart: $('#rp-restart'),
    previous: $('#rp-previous'),
    play: $('#rp-play'),
    next: $('#rp-next'),
    position: $('#rp-position'),
    speed: $('#rp-speed'),
    file: $('#rp-file'),
  };
  return els;
}

function injectStyles(accent) {
  if (document.getElementById('rp-styles')) return;
  const safeAccent = /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#e8c24a';
  const style = document.createElement('style');
  style.id = 'rp-styles';
  style.textContent = `
    #rp-open{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom,0));z-index:120;width:44px;height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.5);color:#fff;font-size:1.05rem;cursor:pointer}
    #rp-panel{position:fixed;inset:0;z-index:214;display:none;align-items:flex-end;justify-content:center;background:rgba(6,8,12,.62)}
    #rp-panel.show{display:flex}
    .rp-sheet{width:min(720px,100vw);box-sizing:border-box;background:#141821;border:1px solid rgba(255,255,255,.14);border-radius:16px 16px 0 0;padding:.85rem 1rem calc(.85rem + env(safe-area-inset-bottom,0));color:#eaf0f7;font-family:"Segoe UI",sans-serif}
    .rp-head{display:flex;align-items:center;gap:.45rem}
    .rp-head h3{margin:0;flex:1;font-size:1.05rem}
    .rp-head button,.rp-transport button,.rp-transport select{border:1px solid rgba(255,255,255,.14);border-radius:10px;min-height:40px;padding:.45rem .65rem;background:#232c3f;color:#eaf0f7;font:600 .82rem "Segoe UI",sans-serif;cursor:pointer}
    .rp-head button:disabled,.rp-transport button:disabled{opacity:.4;cursor:default}
    #rp-play{background:${safeAccent};color:#0c0f16;min-width:46px}
    #rp-narration{min-height:2.5em;margin:.7rem 0 .35rem;color:#cfd8e3;font-size:.88rem;line-height:1.35}
    #rp-range{width:100%;accent-color:${safeAccent};min-height:32px}
    .rp-transport{display:flex;align-items:center;gap:.4rem}
    #rp-position{flex:1;text-align:center;color:#9fb0c3;font-size:.78rem}
    #rp-speed{min-width:68px}
    @media (min-width:760px){#rp-panel{align-items:center}.rp-sheet{border-radius:16px;margin:1rem}}
    @media (prefers-reduced-motion:reduce){#rp-panel *{scroll-behavior:auto!important;transition:none!important;animation:none!important}}`;
  document.head.appendChild(style);
}
