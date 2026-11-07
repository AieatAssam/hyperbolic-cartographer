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

async function snap(page, url, which, opts, fileBase) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.game?.qa?.ready);
  await qa(page, 'seed', 'midgame');
  await qa(page, 'dismissTutorial');
  await qa(page, 'manifold', which);
  await qa(page, 'tab', 'proj');
  for (const [label, fn] of opts) {
    if (label) await page.getByRole('button', { name: label }).first().click().catch(() => {});
    if (fn) await fn(page);
  }
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(ART, `${fileBase}.png`) });
}

const url = process.env.CAPTURE_URL ?? `http://127.0.0.1:${PORT}${BASE}?dev&qa`;
if (!process.env.CAPTURE_URL) {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 3500));
}
const browser = await chromium.launch();

const shots = [
  ['torus', [], 'torus-3d-desktop', { width: 1280, height: 800 }],
  ['torus', [], 'torus-3d-phone', { width: 390, height: 844 }],
  ['klein', [], 'klein-square-desktop', { width: 1280, height: 800 }],
  ['klein', [], 'klein-square-phone', { width: 390, height: 844 }],
  ['klein', [['3D immersion', null]], 'klein-immersion-desktop', { width: 1280, height: 800 }],
  ['klein', [['3D immersion', null]], 'klein-immersion-phone', { width: 390, height: 844 }],
];

for (const [which, opts, name, vp] of shots) {
  const ctx = await browser.newContext({ viewport: vp, recordVideo: name.includes('desktop') ? { dir: ART, size: vp } : undefined });
  const page = await ctx.newPage();
  await snap(page, url, which, opts, name);
  const video = await page.video()?.path();
  if (video && name.endsWith('-desktop') && ['torus-3d', 'klein-square', 'klein-immersion'].some((p) => name.startsWith(p))) {
    const { rename } = await import('node:fs/promises');
    await ctx.close();
    try { await rename(video, join(ART, `${name.replace('-desktop', '')}.webm`)); } catch { /* ignore */ }
  } else await ctx.close();
}

await browser.close();
console.log('Wrote screenshots to', ART);
