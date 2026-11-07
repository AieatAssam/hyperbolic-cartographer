/** PR UX captures: requires `npm run build` + vite preview on 4173. */
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

async function hideTutorialOnly(page) {
  await page.evaluate(() => {
    document.querySelector('.tutorial')?.classList.add('hidden');
    document.querySelector('.infocard')?.classList.remove('capture-hide');
  });
}

async function hideDockForBoard(page) {
  await hideTutorialOnly(page);
  await page.evaluate(() => document.querySelector('.infocard')?.classList.add('capture-hide'));
}

const VP_PHONE = { width: 390, height: 844 };

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

const ctx = await browser.newContext({ viewport: VP_PHONE, recordVideo: { dir: ART, size: VP_PHONE } });
const page = await ctx.newPage();

await waitReady(page);
await page.evaluate(() => document.querySelector('.tutorial')?.classList.add('hidden'));
await page.screenshot({ path: join(ART, 'ux-hud-phone-390.png') });
const p360 = await browser.newPage({ viewport: { width: 360, height: 640 } });
await waitReady(p360);
await p360.evaluate(() => document.querySelector('.tutorial')?.classList.add('hidden'));
await p360.screenshot({ path: join(ART, 'ux-hud-phone-360.png') });
await p360.close();

const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const desk = await desktopCtx.newPage();
await waitReady(desk);
await desk.screenshot({ path: join(ART, 'ux-hud-desktop-1280.png') });
await desktopCtx.close();

await page.screenshot({ path: join(ART, 'ux-goal-drift-390.png') });

await qa(page, 'menu', false);
await page.screenshot({ path: join(ART, 'ux-menu-dot-drift-390.png') });
await qa(page, 'menu', true);
await qa(page, 'tab', 'drift');
await page.waitForTimeout(350);
await page.screenshot({ path: join(ART, 'ux-menu-drift-tab-390.png') });
await qa(page, 'menu', false);

const cells = await qa(page, 'demoCells');
if (cells?.millAt >= 0) {
  await hideDockForBoard(page);
  await qa(page, 'previewAt', cells.millAt, 'mill');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(ART, 'ux-placement-preview-390.png') });
}

if (cells?.springAt >= 0) {
  await hideDockForBoard(page);
  await qa(page, 'inspectAt', cells.springAt);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(ART, 'ux-inspect-fade-390.png') });
}

if (cells?.bridgeAt >= 0) {
  await hideTutorialOnly(page);
  await qa(page, 'clearBoardFocus');
  await qa(page, 'previewAt', cells.bridgeAt, 'bridge');
  await page.waitForTimeout(550);
  await page.screenshot({ path: join(ART, 'ux-bridge-preview-390.png') });
}

await qa(page, 'clearBoardFocus');
await hideTutorialOnly(page);
await qa(page, 'setTool', 'vault');
await page.waitForTimeout(350);
await page.screenshot({ path: join(ART, 'ux-info-scroll-390.png') });

await hideTutorialOnly(page);
await page.evaluate(() => {
  const pal = document.querySelector('.palette');
  if (pal) {
    pal.classList.remove('scrolled');
    pal.scrollLeft = 0;
  }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(200);
await page.screenshot({ path: join(ART, 'ux-palette-scroll-390.png') });

await qa(page, 'clearBoardFocus');
if (cells?.springAt >= 0) {
  await qa(page, 'inspectAt', cells.springAt);
  await page.waitForTimeout(600);
  await qa(page, 'clearBoardFocus');
  await page.waitForTimeout(500);
}
if (cells?.bridgeAt >= 0) {
  await qa(page, 'previewAt', cells.bridgeAt, 'bridge');
  await page.waitForTimeout(800);
}

const video = await page.video()?.path();
await ctx.close();
await browser.close();
if (server) server.kill();
if (video) {
  const { rename } = await import('node:fs/promises');
  try {
    await rename(video, join(ART, 'ux-inspect-bridge-demo.mp4'));
  } catch {
    console.warn('Video path', video);
  }
}
console.log('Wrote UX captures to', ART);
