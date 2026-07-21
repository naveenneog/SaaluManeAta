// recap-ui.js — mobile-first cards for at most three deterministic turning points.
// Dynamic recap text is assigned with textContent; imported/log data never becomes HTML.
// Keep this module byte-identical across games (drift-guarded after cross-review).
import { formatReplayText } from './replay-narration.js';

export function initRecapUI({
  accent = '#e8c24a',
  translate = (key) => key,
  narrate = null,
  onSeek = null,
} = {}) {
  if (typeof document === 'undefined') throw new Error('initRecapUI requires a document');
  if (typeof translate !== 'function') throw new TypeError('initRecapUI translate must be a function');
  injectStyles(accent);
  const els = buildDom();
  let current = null;

  els.title.textContent = translate('How the game turned');
  els.close.setAttribute('aria-label', translate('Close'));
  els.openBtn.title = translate('View recap');
  els.openBtn.setAttribute('aria-label', translate('View recap'));
  els.close.addEventListener('click', close);
  els.openBtn.addEventListener('click', () => show());
  els.panel.addEventListener('click', (event) => { if (event.target === els.panel) close(); });

  function momentText(moment) {
    return formatReplayText(translate(moment.sentenceKey), moment.params);
  }

  function narrateMoment(moment) {
    if (typeof narrate !== 'function') return;
    try {
      const pending = narrate(momentText(moment), moment);
      pending?.catch?.(() => {});
    } catch { /* recap narration is optional */ }
  }

  function render() {
    els.list.replaceChildren();
    const moments = current?.moments ?? [];
    if (!moments.length) {
      const empty = document.createElement('p');
      empty.className = 'rc-empty';
      empty.textContent = translate('No key moments were found.');
      els.list.appendChild(empty);
      return;
    }
    moments.forEach((moment, order) => {
      const card = document.createElement('article');
      card.className = 'rc-card';
      card.dataset.index = String(moment.index);

      const number = document.createElement('div');
      number.className = 'rc-number';
      number.textContent = String(order + 1);

      const body = document.createElement('div');
      body.className = 'rc-body';
      const label = document.createElement('div');
      label.className = 'rc-label';
      label.textContent = `${translate('Move')} ${moment.index + 1}`;
      const text = document.createElement('p');
      text.textContent = momentText(moment);
      body.append(label, text);

      const actions = document.createElement('div');
      actions.className = 'rc-actions';
      const listen = document.createElement('button');
      listen.type = 'button';
      listen.textContent = '🔊';
      listen.setAttribute('aria-label', translate('Listen'));
      listen.addEventListener('click', () => narrateMoment(moment));
      const seek = document.createElement('button');
      seek.type = 'button';
      seek.textContent = translate('View move');
      seek.addEventListener('click', () => {
        try { onSeek?.(moment.index + 1, moment); } catch { /* replay viewer is optional */ }
      });
      actions.append(listen, seek);
      card.append(number, body, actions);
      els.list.appendChild(card);
    });
  }

  function setRecap(recap) {
    if (!recap || !Array.isArray(recap.moments) || recap.moments.length > 3) {
      throw new TypeError('recap UI requires a recap with at most three moments');
    }
    current = recap;
    els.openBtn.hidden = false;
    render();
    return api;
  }

  function show(recap = null) {
    if (recap) setRecap(recap);
    if (!current) return false;
    render();
    els.panel.classList.add('show');
    return true;
  }

  function close() { els.panel.classList.remove('show'); }

  const api = Object.freeze({
    setRecap,
    show,
    close,
    narrateMoment,
    get active() { return els.panel.classList.contains('show'); },
    get recap() { return current; },
  });
  return api;
}

function buildDom() {
  const openBtn = document.createElement('button');
  openBtn.id = 'rc-open';
  openBtn.type = 'button';
  openBtn.textContent = '✦';
  openBtn.hidden = true;
  document.body.appendChild(openBtn);

  const panel = document.createElement('div');
  panel.id = 'rc-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.innerHTML = `
    <section class="rc-sheet">
      <header class="rc-head">
        <h3 id="rc-title"></h3>
        <button id="rc-close" type="button">✕</button>
      </header>
      <div id="rc-list"></div>
    </section>`;
  document.body.appendChild(panel);
  return {
    openBtn,
    panel,
    title: panel.querySelector('#rc-title'),
    close: panel.querySelector('#rc-close'),
    list: panel.querySelector('#rc-list'),
  };
}

function injectStyles(accent) {
  if (document.getElementById('rc-styles')) return;
  const safeAccent = /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#e8c24a';
  const style = document.createElement('style');
  style.id = 'rc-styles';
  style.textContent = `
    #rc-open{position:fixed;left:64px;bottom:calc(12px + env(safe-area-inset-bottom,0));z-index:120;width:44px;height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.5);color:${safeAccent};font-size:1.25rem;cursor:pointer}
    #rc-panel{position:fixed;inset:0;z-index:216;display:none;align-items:flex-end;justify-content:center;background:rgba(6,8,12,.64)}
    #rc-panel.show{display:flex}
    .rc-sheet{width:min(680px,100vw);box-sizing:border-box;max-height:88vh;overflow:auto;background:#141821;border:1px solid rgba(255,255,255,.14);border-radius:16px 16px 0 0;padding:.9rem 1rem calc(.9rem + env(safe-area-inset-bottom,0));color:#eaf0f7;font-family:"Segoe UI",sans-serif}
    .rc-head{display:flex;align-items:center;gap:.5rem;margin-bottom:.7rem}
    .rc-head h3{margin:0;flex:1;font-size:1.08rem}
    #rc-close{border:0;background:none;color:#9fb0c3;font-size:1.1rem;cursor:pointer}
    #rc-list{display:grid;gap:.55rem}
    .rc-card{display:grid;grid-template-columns:32px 1fr auto;gap:.6rem;align-items:center;padding:.7rem;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:#1b2130}
    .rc-number{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:${safeAccent};color:#0c0f16;font-weight:700}
    .rc-label{color:${safeAccent};font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
    .rc-body p{margin:.18rem 0 0;color:#dce5ef;font-size:.88rem;line-height:1.35}
    .rc-actions{display:flex;flex-direction:column;gap:.35rem}
    .rc-actions button{min-height:36px;border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:.35rem .55rem;background:#232c3f;color:#eaf0f7;font:600 .76rem "Segoe UI",sans-serif;cursor:pointer}
    .rc-empty{color:#9fb0c3;text-align:center;padding:1rem}
    @media (max-width:520px){.rc-card{grid-template-columns:30px 1fr}.rc-actions{grid-column:2;flex-direction:row}.rc-actions button:last-child{flex:1}}
    @media (min-width:760px){#rc-panel{align-items:center}.rc-sheet{border-radius:16px;margin:1rem}}
    @media (prefers-reduced-motion:reduce){#rc-panel *{transition:none!important;animation:none!important}}`;
  document.head.appendChild(style);
}
