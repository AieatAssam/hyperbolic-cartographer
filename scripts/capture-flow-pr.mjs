/** Flow links captures. POLISH_TAG=before|after. After: seed links-demo, inspect each role, assert panel title. */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART = '/opt/cursor/artifacts';
mkdirSync(ART, { recursive: true });
const TAG = process.env.POLISH_TAG === 'before' ? 'before' : 'after';
const BASE = '/hyperbolic-cartographer/';
const PORT = 4173;
const URL = process.env.CAPTURE_URL ?? `http://127.0.0.1:${PORT}${BASE}?dev&qa`;

const VIEWS = [
  { w: 360, h: 640 },
  { w: 390, h: 844 },
  { w: 430, h: 932 },
  { w: 844, h: 390 },
  { w: 932, h: 430 },
  { w: 1280, h: 800 },
];

const ROLES = [
  { id: 'mill', title: 'Mill' },
  { id: 'spring', title: 'Spring' },
  { id: 'bridge', title: 'Bridge' },
  { id: 'beacon', title: 'Beacon' },
];

async function qa(page, hook, ...args) {
  return page.evaluate(async ([h, a]) => {
    const f = window.game?.qa?.[h];
    return f ? await f(...a) : null;
  }, [hook, args]);
}

async function waitReady(page) {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.game?.qa?.ready);
  if (TAG === 'after') await qa(page, 'seed', 'links-demo');
  else await qa(page, 'seed', 'ux-demo');
  await qa(page, 'dismissTutorial');
  await qa(page, 'menu', false);
  await page.evaluate(() => document.querySelector('.tutorial')?.classList.add('hidden'));
  await page.waitForTimeout(500);
}

async function inspectRole(page, role) {
  const cells = await qa(page, 'linksDemoTiles');
  const idx = cells?.[role.id];
  if (!(idx >= 0)) throw new Error(`linksDemoTiles missing ${role.id}: ${JSON.stringify(cells)}`);
  const ok = await qa(page, 'inspectAt', idx);
  if (!ok) throw new Error(`inspectAt(${idx}) failed for ${role.id}`);
  await page.waitForFunction((name) => {
    const t = document.querySelector('.info-lead b')?.textContent ?? '';
    return t.includes(name);
  }, role.title, { timeout: 8000 });
  const legend = await page.locator('.flow-legend').count();
  if (!legend) throw new Error(`no .flow-legend after inspecting ${role.id}`);
  await page.waitForTimeout(400);
}

let server;
if (!process.env.CAPTURE_URL) {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 3500));
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

for (const { w, h } of VIEWS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await waitReady(page);
  const name = `flow-${TAG}-ui-${w}x${h}.png`;
  await page.screenshot({ path: join(ART, name) });
  console.log('wrote', join(ART, name));
  await page.close();
}

if (TAG === 'after') {
  for (const { w, h } of VIEWS) {
    for (const role of ROLES) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await waitReady(page);
      await inspectRole(page, role);
      const name = `flow-after-board-${role.id}-${w}x${h}.png`;
      await page.screenshot({ path: join(ART, name) });
      console.log('wrote', join(ART, name));
      await page.close();
    }
  }
}

const stab = await browser.newPage({ viewport: { width: 390, height: 844 } });
await waitReady(stab);
const idle = await qa(stab, 'cameraStabilitySample', 90);
writeFileSync(join(ART, `flow-${TAG}-stability-idle.json`), JSON.stringify(idle, null, 2));
const cells0 = await qa(stab, 'linksDemoTiles');
if (cells0?.mill >= 0) await qa(stab, 'inspectAt', cells0.mill);
await qa(stab, 'clearBoardFocus');
const tapped = await qa(stab, 'cameraStabilitySample', 60);
writeFileSync(join(ART, `flow-${TAG}-stability-taps.json`), JSON.stringify(tapped, null, 2));
console.log('stability', idle?.ok, tapped?.ok);
await stab.close();

const clipPath = join(ART, 'flow-after-links-clip-390x844.webm');
if (TAG === 'after') {
  const framesPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await waitReady(framesPage);
  await inspectRole(framesPage, { id: 'mill', title: 'Mill' });
  for (const sec of [0, 1, 2]) {
    if (sec > 0) await framesPage.waitForTimeout(1000);
    const out = join(ART, `flow-after-links-frame-${sec}s-390x844.png`);
    await framesPage.screenshot({ path: out });
    console.log('wrote', out);
  }
  await framesPage.close();

  const clip = await browser.newContext({
    viewport: { width: 390, height: 844 },
    recordVideo: { dir: ART, size: { width: 390, height: 844 } },
  });
  const vPage = await clip.newPage();
  await waitReady(vPage);
  await inspectRole(vPage, { id: 'mill', title: 'Mill' });
  await vPage.waitForTimeout(3500);
  const vpath = await vPage.video()?.path();
  await clip.close();
  if (vpath) {
    const { rename } = await import('node:fs/promises');
    try {
      await rename(vpath, clipPath);
      console.log('wrote clip');
    } catch { /* */ }
  }
}

await browser.close();
if (server) server.kill();
