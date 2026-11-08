/** HUD + palette chip captures (build + vite preview on 4173). POLISH_TAG=before|after prefixes filenames. */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
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
  await qa(page, 'seed', 'fresh');
  await qa(page, 'dismissTutorial');
  await qa(page, 'menu', false);
  await page.waitForTimeout(500);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function prepHud(page) {
  await page.evaluate(() => {
    document.querySelector('.tutorial')?.classList.add('hidden');
    document.querySelector('.infocard')?.classList.add('capture-hide');
    const pal = document.querySelector('.palette');
    if (pal) {
      pal.classList.remove('scrolled');
      pal.scrollLeft = 0;
    }
  });
}

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

for (const { w, h } of VIEWS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await waitReady(page);
  await prepHud(page);
  const name = `palette-${TAG}-hud-${w}x${h}.png`;
  await page.screenshot({ path: join(ART, name) });
  console.log('wrote', join(ART, name));
  await page.close();
}

const chipPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
await waitReady(chipPage);
await prepHud(chipPage);
const box = await chipPage.evaluate(() => {
  const pal = document.querySelector('.palette');
  if (!pal) return null;
  const r = pal.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height + 4, 72) };
});
if (box) {
  const chipName = `palette-${TAG}-chips-390x844.png`;
  await chipPage.screenshot({ path: join(ART, chipName), clip: box });
  console.log('wrote', join(ART, chipName));
}
const colors = await chipPage.evaluate(() => {
  const dots = [...document.querySelectorAll('.palette button.tool .palette-dot')];
  return dots.map((el) => getComputedStyle(el).backgroundColor);
});
console.log(`${TAG} chip dot colors:`, colors);
await chipPage.close();

await browser.close();
if (server) server.kill();
