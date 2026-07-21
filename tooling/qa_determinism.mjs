// qa_determinism.mjs — runtime verification of the α2 live wiring for Saalu Mane Ata.
// Saalu has a deterministic alpha-beta AI (no RNG), so every game is identical + replayable.
// Checks: two runs => identical action-log; resume continues; undo truncates; zero errors.
// Run from SaaluManeAta: node tooling/qa_determinism.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5179';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] });
const allErrors = [];

async function run(ctx, throws, { mode = 'hotseat' } = {}) {
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') allErrors.push(m.text()); });
  page.on('pageerror', (e) => allErrors.push('pageerror ' + e.message));
  await page.goto(`${BASE}/play.html?world=parampare&mode=${mode}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sma && window.__sma.state && window.__sma.log, null, { timeout: 25000 });
  if (throws) await page.evaluate((n) => window.__sma.autoplay(n), throws);
  const res = await page.evaluate(() => ({ hashes: window.__sma.log.actions.map((a) => a.stateHash), actions: window.__sma.log.actions.length, winner: window.__sma.state.winner }));
  await page.close();
  return res;
}

const eq = (a, b) => a.length === b.length && a.every((h, i) => h === b[i]);
const freshCtx = () => browser.newContext();

const cA = await freshCtx(); const A = await run(cA, 20); await cA.close();
const cB = await freshCtx(); const B = await run(cB, 20); await cB.close();
// resume — same context: play + persist, then reload with 0 throws => resumes the saved log
const cR = await freshCtx();
const D = await run(cR, 12);
const E = await run(cR, 0);
await cR.close();
// undo — play, click Undo, confirm the action-log shrinks
const cU = await freshCtx();
const pu = await cU.newPage();
pu.on('console', (m) => { if (m.type() === 'error') allErrors.push(m.text()); });
pu.on('pageerror', (e) => allErrors.push('pageerror ' + e.message));
await pu.goto(`${BASE}/play.html?world=parampare&mode=hotseat`, { waitUntil: 'networkidle' });
await pu.waitForFunction(() => window.__sma && window.__sma.state && window.__sma.log, null, { timeout: 25000 });
await pu.evaluate((n) => window.__sma.autoplay(n), 10);
const undoRes = await pu.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40 && window.__sma.busy; i += 1) await wait(150);
  const before = window.__sma.log.actions.length;
  const btn = document.querySelector('#undoBtn');
  const enabled = btn && !btn.disabled;
  if (enabled) { btn.click(); await wait(600); }
  return { before, enabled, after: window.__sma.log.actions.length };
});
await cU.close();

const detOk = eq(A.hashes, B.hashes) && A.actions > 8;
const resumeOk = E.actions === D.actions && eq(E.hashes, D.hashes) && D.actions > 0;
const undoOk = undoRes.enabled && undoRes.after < undoRes.before;

console.log(`determinism (identical game each run): ${detOk ? 'PASS' : 'FAIL'}  (A=${A.actions} B=${B.actions})`);
console.log(`resume      (reload continues game):   ${resumeOk ? 'PASS' : 'FAIL'}  (saved=${D.actions} resumed=${E.actions})`);
console.log(`undo        (Undo truncates the log):  ${undoOk ? 'PASS' : 'FAIL'}  (before=${undoRes.before} after=${undoRes.after})`);
console.log(`errors: ${allErrors.length ? 'FAIL\n  ' + [...new Set(allErrors)].join('\n  ') : 'none'}`);

await browser.close();
const ok = detOk && resumeOk && undoOk && allErrors.length === 0;
console.log(ok ? '\nPASS: Saalu α2 live wiring verified' : '\nFAIL: see above');
process.exit(ok ? 0 : 2);
