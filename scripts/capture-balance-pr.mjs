/** Balance/visual PR captures @ 390×844 — requires `npm run build` + vite preview on 4173. */
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

async function waitReady(page) {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.game?.qa?.ready);
  await qa(page, 'seed', 'ux-demo');
  await qa(page, 'dismissTutorial');
  await qa(page, 'menu', false);
  await page.waitForTimeout(600);
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

await waitReady(page);
await page.evaluate(() => document.querySelector('.tutorial')?.classList.add('hidden'));
await page.screenshot({ path: join(ART, 'balance-board-hud-390.png') });

const cells = await qa(page, 'demoCells');
if (cells?.springAt >= 0) {
  await hideDock(page);
  await qa(page, 'inspectAt', cells.springAt);
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(ART, 'balance-inspect-dim-390.png') });
}

if (cells?.bridgeAt >= 0) {
  await hideDock(page);
  await qa(page, 'clearBoardFocus');
  await qa(page, 'previewAt', cells.bridgeAt, 'bridge');
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(ART, 'balance-bridge-gain-390.png') });
}

if (cells?.millAt >= 0) {
  await hideDock(page);
  await qa(page, 'previewAt', cells.millAt, 'mill');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(ART, 'balance-placement-preview-390.png') });
}

await qa(page, 'clearBoardFocus');
await page.evaluate(() => document.querySelector('.infocard')?.classList.remove('capture-hide'));
if (cells?.springAt >= 0) {
  await qa(page, 'inspectAt', cells.springAt);
  await page.waitForTimeout(500);
  await qa(page, 'clearBoardFocus');
}
if (cells?.bridgeAt >= 0) {
  await qa(page, 'previewAt', cells.bridgeAt, 'bridge');
  await page.waitForTimeout(900);
}
await qa(page, 'clearBoardFocus');
await page.waitForTimeout(400);

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
