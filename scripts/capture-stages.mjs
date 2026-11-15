/**
 * Screenshots of the surface stages (Möbius strip, torus, Klein bottle) for review. Needs a dev server:
 *   npx vite --port 5184 --strictPort &
 *   node scripts/capture-stages.mjs 5184 out-dir
 * Writes <surface>-<3d|2d>-<WxH>.png, mobius-one-lap, fold-midway, loop-race, fold-card and project-targets.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [port = '5184', out = 'stage-shots'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const SIZES = [[1280, 800], [390, 844]];

async function open(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w < 700 ? 2 : 1 });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/hyperbolic-cartographer/?dev&qa`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.game?.qa?.ready);
  return page;
}
const qa = (page, hook, ...args) => page.evaluate(([h, a]) => window.game.qa[h](...a), [hook, args]);
const seed = async (page, name) => {
  await qa(page, 'seed', name);
  await qa(page, 'dismissTutorial');
  await page.evaluate(() => document.querySelector('.panel-close')?.click());
  await page.waitForTimeout(400);
};
const shot = async (page, name) => {
  await page.screenshot({ path: join(out, name) });
  console.log('wrote', join(out, name));
};

for (const [w, h] of SIZES) {
  const page = await open(w, h);
  for (const surf of ['mobius', 'torus', 'klein']) {
    await seed(page, `surface-${surf}`);
    await qa(page, 'setChart', false);
    await page.waitForTimeout(500);
    await shot(page, `${surf}-3d-${w}x${h}.png`);
    await qa(page, 'setChart', true);
    await page.waitForTimeout(500);
    await shot(page, `${surf}-2d-${w}x${h}.png`);
  }
  await page.close();
}

const page = await open(1280, 800);
// Möbius after one lap: every tile mirrored, standing on the other face.
await seed(page, 'surface-mobius');
await qa(page, 'setChart', false);
await qa(page, 'flowBy', 1);
await page.waitForTimeout(400);
await shot(page, 'mobius-one-lap-1280x800.png');
await qa(page, 'setChart', true);
await page.waitForTimeout(400);
await shot(page, 'mobius-one-lap-2d-1280x800.png');
// Fold frozen mid-way (the frame loop keeps easing it, so the shot is taken at once).
await seed(page, 'surface-torus');
await qa(page, 'setChart', true);
await qa(page, 'setChart', false, true, 0.5);
await shot(page, 'fold-midway-1280x800.png');
await page.waitForTimeout(3200);
// Loop race: the gold band runs round the first loop of the cycle basis.
await qa(page, 'raceLoop', 0);
await page.waitForTimeout(2000); // the surface turns the loop into view, then the band runs
await shot(page, 'loop-race-1280x800.png');
// Projection tab: Fold card, then the target picker in the confirmation.
await seed(page, 'surface-klein');
await page.evaluate(() => {
  const g = window.game;
  g.s.curvature = new g.Decimal(100);
  g.s.cycleCharts = new g.Decimal(30);
  g.s.folds = 2;
});
await page.evaluate(() => document.querySelector('.menu-toggle, [aria-label="Menu"]')?.click());
await page.evaluate(() => [...document.querySelectorAll('[role="tab"], .tab')].find((b) => /Projection/.test(b.textContent))?.click());
await page.waitForTimeout(400);
await shot(page, 'projection-tab-1280x800.png');
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Project for/.test(b.textContent))?.click());
await page.waitForTimeout(300);
await shot(page, 'project-targets-1280x800.png');
await browser.close();
if (errors.length) console.error('PAGE ERRORS:\n' + errors.join('\n'));
