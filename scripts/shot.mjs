/**
 * One screenshot of a running dev server, for eyeballing visual changes.
 *   npx vite --port 5181 --strictPort &      (dev server; needed for window.game)
 *   node scripts/shot.mjs 5181 out.png [fresh|mid|hyper|menu] [WxH]
 * States: fresh = empty board; mid = square board part-built; hyper = hyperbolic board part-built;
 * menu = mid with the side panel open.
 */
import { chromium } from 'playwright';

const [port = '5173', out = 'shot.png', state = 'mid', size = '1280x800'] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: width < 700 ? 2 : 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/hyperbolic-cartographer/?dev&qa`, { waitUntil: 'load' });
await page.waitForFunction(() => window.game?.snapshot);
await page.evaluate((state) => {
  const g = window.game;
  const KINDS = ['spring', 'mill', 'spring', 'beacon', 'spring', 'mill', 'cistern', 'scriptorium', 'bridge', 'spring', null, 'mill', 'vault', null, 'lighthouse'];
  const build = (n) => g.cells().filter((c) => c.active).slice(0, n).forEach((c, k) => KINDS[k % KINDS.length] && g.place(c.i, KINDS[k % KINDS.length]));
  if (state !== 'fresh') {
    g.s.ink = new g.Decimal(1e6);
    g.survey();
    if (state === 'hyper') {
      g.s.cycleCharts = new g.Decimal(100);
      g.project();
    } else build(18);
  }
  if (state !== 'menu') document.querySelector('.panel-close')?.click();
  [...document.querySelectorAll('button')].find((b) => b.textContent === 'Hide')?.click();
}, state);
if (state === 'hyper') {
  await page.waitForTimeout(3500); // projection transition
  await page.evaluate(() => {
    const g = window.game;
    g.s.ink = new g.Decimal(1e9);
    const K = ['spring', 'mill', 'spring', 'beacon', 'cistern', 'scriptorium', 'bridge', null, 'vault', 'lighthouse'];
    g.cells().filter((c) => c.active).slice(0, 40).forEach((c, k) => K[k % K.length] && g.place(c.i, K[k % K.length]));
  });
}
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
await browser.close();
if (errors.length) console.error('PAGE ERRORS:\n' + errors.join('\n'));
console.log(`wrote ${out} (${state}, ${size})`);
