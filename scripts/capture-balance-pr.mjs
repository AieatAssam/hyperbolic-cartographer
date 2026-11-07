/** Balance pass 2 captures @ 390×844 — `npm run build` + preview on 4173. */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART = '/opt/cursor/artifacts';
mkdirSync(ART, { recursive: true });
const BASE = '/hyperbolic-cartographer/';
const PORT = 4173;
const URL = process.env.CAPTURE_URL ?? `http://127.0.0.1:${PORT}${BASE}?dev&qa`;

async function qa(page, hook, ...args) {
  return page.evaluate(async ([h, a]) => {
    const f = window.game?.qa?.[h];
    return f ? await f(...a) : null;
  }, [hook, args]);
}

async function waitReady(page, seed = 'ux-demo') {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.game?.qa?.ready);
  await qa(page, 'seed', seed);
  await qa(page, 'dismissTutorial');
  await qa(page, 'menu', false);
  await page.waitForTimeout(700);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function hideDock(page) {
  await page.evaluate(() => {
    document.querySelector('.tutorial')?.classList.add('hidden');
    document.querySelector('.infocard')?.classList.add('capture-hide');
  });
}

const VP = { width: 390, height: 844 };

let server;
if (!process.env.CAPTURE_URL) {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 3500));
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: VP, recordVideo: { dir: ART, size: VP } });
const page = await ctx.newPage();

await waitReady(page, 'ux-demo');
await page.evaluate(() => document.querySelector('.tutorial')?.classList.add('hidden'));
await page.screenshot({ path: join(ART, 'balance-board-hud-390.png') });

const cells = await qa(page, 'demoCells');
if (cells?.springAt >= 0) {
  await hideDock(page);
  await qa(page, 'inspectAt', cells.springAt);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(ART, 'balance-inspect-dim-390.png') });
  await qa(page, 'clearBoardFocus');
}

await waitReady(page, 'bridge-gain');
await hideDock(page);
const bridgeCell = await qa(page, 'bridgeGainCell');
if (bridgeCell >= 0) {
  await qa(page, 'previewAt', bridgeCell, 'bridge');
  await page.waitForFunction(() => {
    const el = document.querySelector('.board-gain-label');
    return el && !el.classList.contains('hidden') && /Ink\/s/.test(el.textContent ?? '');
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(ART, 'balance-bridge-gain-390.png') });
  await qa(page, 'clearBoardFocus');
}

let hintCell = -1;
await waitReady(page, 'constellation-demo');
await hideDock(page);
hintCell = await qa(page, 'inkstreamHintCell');
if (hintCell >= 0) {
  await qa(page, 'previewAt', hintCell, 'spring');
  await page.waitForTimeout(750);
  await page.screenshot({ path: join(ART, 'balance-constellation-ghost-390.png') });
  await qa(page, 'placeAt', hintCell, 'spring');
  await page.waitForTimeout(1300);
  await page.screenshot({ path: join(ART, 'balance-constellation-complete-390.png') });
}

await waitReady(page, 'network-demo');
await hideDock(page);
const linkAt = await qa(page, 'networkLinkCell');
if (linkAt >= 0) {
  await qa(page, 'previewAt', linkAt, 'spring');
  await page.waitForTimeout(400);
  await qa(page, 'placeAt', linkAt, 'spring');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(ART, 'balance-network-pulse-390.png') });
}

await qa(page, 'clearBoardFocus');
await page.evaluate(() => document.querySelector('.infocard')?.classList.remove('capture-hide'));
if (hintCell >= 0) {
  await waitReady(page, 'constellation-demo');
  const again = await qa(page, 'inkstreamHintCell');
  if (again >= 0) {
    await qa(page, 'previewAt', again, 'spring');
    await page.waitForTimeout(500);
    await qa(page, 'placeAt', again, 'spring');
    await page.waitForTimeout(1800);
  }
}

const video = await page.video()?.path();
await ctx.close();
await browser.close();
if (server) server.kill();
if (video) {
  const { rename } = await import('node:fs/promises');
  try {
    await rename(video, join(ART, 'balance-phone-gameplay.mp4'));
  } catch {
    console.warn('Video path', video);
  }
}
console.log('Wrote balance captures to', ART);
