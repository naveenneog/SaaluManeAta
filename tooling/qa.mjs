import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./_qa/', import.meta.url));
const BASE = process.env.BASE || 'http://localhost:5179';
const errors = [];
const watch = (page, tag) => { page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`); }); page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`)); };

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  watch(page, 'desktop');
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}landing.png`, fullPage: true });
  await page.goto(`${BASE}/setup.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.card.sel', { timeout: 5000 });
  await page.screenshot({ path: `${OUT}lobby.png` });
  await page.goto(`${BASE}/play.html?world=saalu`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__sma && window.__sma.state, null, { timeout: 25000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}board-initial.png` });
  const result = await page.evaluate(async () => window.__sma.autoplay(70));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}board-end.png` });

  const p2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  watch(p2, 'world2');
  await p2.goto(`${BASE}/play.html?world=navagraha`, { waitUntil: 'networkidle' });
  await p2.waitForFunction(() => window.__sma && window.__sma.state, null, { timeout: 25000 });
  await p2.evaluate(async () => window.__sma.autoplay(30));
  await p2.waitForTimeout(400);
  await p2.screenshot({ path: `${OUT}board-mid.png` });
  await p2.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  watch(phone, 'phone');
  await phone.goto(`${BASE}/play.html?world=angadi`, { waitUntil: 'networkidle' });
  await phone.waitForFunction(() => window.__sma && window.__sma.state, null, { timeout: 25000 });
  await phone.waitForTimeout(1000);
  await phone.screenshot({ path: `${OUT}board-phone.png` });

  await browser.close();
  console.log('autoplay result:', JSON.stringify(result));
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console/page errors');
  if (errors.length) process.exit(2);
}
main().catch((e) => { console.error(e); process.exit(1); });
