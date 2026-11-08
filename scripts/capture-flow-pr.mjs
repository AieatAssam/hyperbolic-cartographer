/** Flow links + UI spacing captures. POLISH_TAG=before|after. Tag=after: seed links-demo, inspect mill. */
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

async function qa(page, hook, ...args) {
  return page.evaluate(async ([h, a]) => {
    const f = window.game?.qa?.[h];
    return f ? await f(...a) : null;
  }, [hook, args]);
}

async function waitReady(page) {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.game?.qa?.ready);
  if (TAG === 'after') {
    await qa(page, 'seed', 'links-demo');
  } else {
    await qa(page, 'seed', 'ux-demo');
  }
  await qa(page, 'dismissTutorial');
  await qa(page, 'menu', false);
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
  await page.evaluate(() => document.querySelector('.tutorial')?.classList.add('hidden'));
  const name = `flow-${TAG}-ui-${w}x${h}.png`;
  await page.screenshot({ path: join(ART, name) });
  console.log('wrote', join(ART, name));
  await page.close();
}

const flowPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
await waitReady(flowPage);
if (TAG === 'after') {
  await flowPage.evaluate(() => {
    const mills = [...document.querySelectorAll('.palette button.tool')].find((b) => b.textContent?.includes('Mill'));
    mills?.click();
  });
  await flowPage.waitForTimeout(200);
  const cell = await qa(flowPage, 'linksDemoTiles');
  const millAt = cell?.mill >= 0 ? cell.mill : 0;
  await qa(flowPage, 'inspectAt', millAt);
  await flowPage.waitForTimeout(900);
}
await flowPage.evaluate(() => document.querySelector('.tutorial')?.classList.add('hidden'));
await flowPage.screenshot({ path: join(ART, `flow-${TAG}-board-links-390x844.png`) });
console.log('wrote', join(ART, `flow-${TAG}-board-links-390x844.png`));

const stab = await browser.newPage({ viewport: { width: 390, height: 844 } });
await waitReady(stab);
const idle = await qa(stab, 'cameraStabilitySample', 90);
writeFileSync(join(ART, `flow-${TAG}-stability-idle.json`), JSON.stringify(idle, null, 2));
await qa(stab, 'inspectAt', 0);
await qa(stab, 'clearBoardFocus');
const tapped = await qa(stab, 'cameraStabilitySample', 60);
writeFileSync(join(ART, `flow-${TAG}-stability-taps.json`), JSON.stringify(tapped, null, 2));
console.log('stability', idle?.ok, tapped?.ok);

if (TAG === 'after') {
  const clip = await browser.newContext({
    viewport: { width: 390, height: 844 },
    recordVideo: { dir: ART, size: { width: 390, height: 844 } },
  });
  const vPage = await clip.newPage();
  await waitReady(vPage);
  const cells = await qa(vPage, 'linksDemoTiles');
  if (cells?.mill >= 0) {
    await qa(vPage, 'inspectAt', cells.mill);
    await vPage.waitForTimeout(6000);
  }
  const vpath = await vPage.video()?.path();
  await clip.close();
  if (vpath) {
    const { rename } = await import('node:fs/promises');
    try {
      await rename(vpath, join(ART, 'flow-after-links-clip-390x844.webm'));
      console.log('wrote clip');
    } catch { /* */ }
  }
}

await flowPage.close();
await stab.close();
await browser.close();
if (server) server.kill();
