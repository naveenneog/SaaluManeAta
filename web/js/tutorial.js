// Reusable "How to play" tutorial + help button. Framework-free: injects its own
// styles and DOM. Each game calls initTutorial({ key, title, accent, steps }).
// steps: [{ icon, title, text }]. Auto-opens once per player (localStorage key),
// and is reachable any time via a floating "?" button. Rendered text is localized
// through i18n t() (English source is the key). Identical copy per game.
import { t } from './i18n.js';
let injected = false;
function injectStyles(accent) {
  if (injected) return; injected = true;
  const css = `
  #tut-scrim{position:fixed;inset:0;z-index:120;background:rgba(6,8,12,.72);backdrop-filter:blur(4px);
    display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .3s;padding:1rem;}
  #tut-scrim.show{opacity:1;pointer-events:auto;}
  #tut-card{width:min(94vw,460px);background:linear-gradient(180deg,rgba(30,34,44,.98),rgba(18,20,28,.98));
    border:1px solid var(--tut-accent,#8bd);border-radius:20px;padding:1.4rem 1.3rem 1.1rem;box-shadow:0 30px 80px rgba(0,0,0,.6);
    color:#eef2f7;font-family:'Segoe UI','Noto Serif',Georgia,serif;transform:translateY(14px);transition:transform .3s;}
  #tut-scrim.show #tut-card{transform:translateY(0);}
  #tut-card .tut-icon{font-size:2.6rem;text-align:center;line-height:1;margin:.2rem 0 .6rem;filter:drop-shadow(0 0 14px var(--tut-accent,#8bd));}
  #tut-card h3{margin:.1rem 0 .5rem;text-align:center;font-size:1.3rem;color:var(--tut-accent,#8bd);letter-spacing:.02em;}
  #tut-card p{margin:0 auto;font-size:1.02rem;line-height:1.6;color:#dbe3ec;max-width:38ch;text-align:center;}
  #tut-dots{display:flex;gap:.4rem;justify-content:center;margin:1rem 0 .9rem;}
  #tut-dots i{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.22);transition:background .2s,transform .2s;}
  #tut-dots i.on{background:var(--tut-accent,#8bd);transform:scale(1.3);}
  #tut-nav{display:flex;gap:.6rem;align-items:center;justify-content:space-between;}
  #tut-nav button{font:inherit;font-size:1rem;border-radius:12px;padding:.6rem 1.1rem;min-height:46px;cursor:pointer;border:1px solid rgba(255,255,255,.18);
    background:rgba(255,255,255,.06);color:#eef2f7;}
  #tut-next{background:linear-gradient(180deg,color-mix(in srgb,var(--tut-accent,#8bd) 88%,#fff),var(--tut-accent,#8bd));
    color:#10141c;border:0;font-weight:600;flex:1;}
  #tut-skip{color:#9aa6b4;background:transparent;border:0;min-height:40px;}
  #tut-help{position:fixed;z-index:80;right:.6rem;bottom:.6rem;width:44px;height:44px;border-radius:50%;
    margin-bottom:env(safe-area-inset-bottom,0);font:inherit;font-size:1.3rem;cursor:pointer;color:#10141c;border:0;
    background:linear-gradient(180deg,color-mix(in srgb,var(--tut-accent,#8bd) 88%,#fff),var(--tut-accent,#8bd));
    box-shadow:0 6px 18px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;}
  @media(max-width:520px){#tut-card p{font-size:.98rem;}}
  `;
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
}

export function initTutorial({ key, title, accent = '#8bd', steps = [], helpButton = true, autoOpen = true }) {
  injectStyles();
  document.documentElement.style.setProperty('--tut-accent', accent);
  const scrim = document.createElement('div'); scrim.id = 'tut-scrim';
  scrim.innerHTML = `<div id="tut-card" role="dialog" aria-modal="true" aria-label="How to play">
    <div class="tut-icon"></div><h3></h3><p></p>
    <div id="tut-dots"></div>
    <div id="tut-nav"><button id="tut-skip">Skip</button><button id="tut-back" style="display:none">Back</button><button id="tut-next">Next</button></div>
  </div>`;
  document.body.appendChild(scrim);
  const els = { icon: scrim.querySelector('.tut-icon'), h: scrim.querySelector('h3'), p: scrim.querySelector('p'),
    dots: scrim.querySelector('#tut-dots'), skip: scrim.querySelector('#tut-skip'), back: scrim.querySelector('#tut-back'), next: scrim.querySelector('#tut-next') };
  els.dots.innerHTML = steps.map(() => '<i></i>').join('');
  els.skip.textContent = t('Skip'); els.back.textContent = t('Back');
  let i = 0;
  function render() {
    const s = steps[i];
    els.icon.textContent = s.icon || '📜'; els.h.textContent = t(s.title || title); els.p.textContent = t(s.text);
    [...els.dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    els.back.style.display = i > 0 ? '' : 'none';
    els.next.textContent = t(i === steps.length - 1 ? 'Got it' : 'Next');
  }
  function open() { i = 0; render(); scrim.classList.add('show'); }
  function close() { scrim.classList.remove('show'); try { localStorage.setItem(key, '1'); } catch { /* */ } }
  els.next.onclick = () => { if (i < steps.length - 1) { i++; render(); } else close(); };
  els.back.onclick = () => { if (i > 0) { i--; render(); } };
  els.skip.onclick = close;
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  addEventListener('keydown', (e) => { if (!scrim.classList.contains('show')) return; if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight' || e.key === 'Enter') els.next.click(); else if (e.key === 'ArrowLeft') els.back.click(); });

  if (helpButton) {
    const btn = document.createElement('button'); btn.id = 'tut-help'; btn.textContent = '?'; btn.title = t('How to play');
    btn.setAttribute('aria-label', t('How to play')); btn.onclick = open; document.body.appendChild(btn);
  }
  let seen = false; try { seen = !!localStorage.getItem(key); } catch { /* */ }
  if (!seen && autoOpen) {
    const openWhenReady = () => document.body.classList.contains('cinematic-opening')
      ? setTimeout(openWhenReady, 250)
      : open();
    setTimeout(openWhenReady, 700);
  }
  return { open, close };
}
