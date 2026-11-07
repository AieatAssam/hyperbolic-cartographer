/** Capture manifold preview screenshots for PR artifacts. */
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

async function qa(page, hook, ...args) {
  return page.evaluate(async ([h, a]) => {
    const f = window.game?.qa?.[h];
    return f ? await f(...a) : null;
  }, [hook, args]);
}

async function raf(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function clickMf(page, qaId) {
  await page.locator(`[data-qa="${qaId}"]`).click();
}

async function snap(page, url, which, steps, fileBase) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.game?.qa?.ready);
  await qa(page, 'seed', 'midgame');
  await qa(page, 'dismissTutorial');
  await qa(page, 'manifold', which);
  for (const step of steps) await step(page);
  await page.waitForTimeout(1200);
  await raf(page);
  const sample = await qa(page, 'canvasSample');
  if (!sample?.ok) console.warn(fileBase, 'canvas check failed', sample);
  await page.screenshot({ path: join(ART, `${fileBase}.png`) });
}

const url = process.env.CAPTURE_URL ?? `http://127.0.0.1:${PORT}${BASE}?dev&qa`;
let server;
if (!process.env.CAPTURE_URL) {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 3500));
}
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const shots = [
  ['torus', [], 'torus-3d-desktop', { width: 1280, height: 800 }],
  ['torus', [async (p) => clickMf(p, 'mf-chart')], 'torus-2d-chart-desktop', { width: 1280, height: 800 }],
  ['torus', [], 'torus-3d-phone', { width: 390, height: 844 }],
  ['torus', [async (p) => clickMf(p, 'mf-chart')], 'torus-2d-chart-phone', { width: 390, height: 844 }],
  ['klein', [], 'klein-square-desktop', { width: 1280, height: 800 }],
  ['klein', [], 'klein-square-phone', { width: 390, height: 844 }],
  ['klein', [async (p) => clickMf(p, 'mf-immersion')], 'klein-immersion-desktop', { width: 1280, height: 800 }],
  ['klein', [async (p) => clickMf(p, 'mf-immersion')], 'klein-immersion-phone', { width: 390, height: 844 }],
];

for (const [which, steps, name, vp] of shots) {
  const record = name.includes('desktop') && /torus-3d|klein-square|klein-immersion/.test(name);
  const ctx = await browser.newContext({
    viewport: vp,
    recordVideo: record ? { dir: ART, size: vp } : undefined,
  });
  const page = await ctx.newPage();
  await snap(page, url, which, steps, name);
  if (record) {
    const video = await page.video()?.path();
    await ctx.close();
    if (video) {
      const { rename } = await import('node:fs/promises');
      const clip = name.replace('-desktop', '');
      try { await rename(video, join(ART, `${clip}.webm`)); } catch { /* ignore */ }
    }
  } else await ctx.close();
}

await browser.close();
if (server) server.kill();
console.log('Wrote screenshots to', ART);
