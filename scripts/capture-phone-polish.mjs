/** Phone polish captures + layout assertions. POLISH_TAG=before|after npm run build && node scripts/capture-phone-polish.mjs */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART = '/opt/cursor/artifacts';
const TAG = process.env.POLISH_TAG ?? 'after';
const BASE = '/hyperbolic-cartographer/';

mkdirSync(ART, { recursive: true });

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function qa(page, hook, ...args) {
  return page.evaluate(async ([h, a]) => {
    const f = window.game?.qa?.[h];
    return f ? await f(...a) : null;
  }, [hook, args]);
}

async function assertBoard(page, label) {
  const r = await qa(page, 'playableFramingCheck', 8);
  if (!r?.ok) {
    console.error(`${label} board framing failed:`, r?.failures ?? r);
    process.exitCode = 1;
  }
}

async function assertTorus(page, label) {
  const r = await qa(page, 'torusScreenBounds');
  if (!r?.ok) {
    console.error(`${label} torus too small:`, r);
    process.exitCode = 1;
  }
  console.log(`${label} torus: hBand=${r.heightInBand?.toFixed(3)} wView=${r.widthInView?.toFixed(3)}`);
}

const shots = [
  {
    file: `polish-${TAG}-constellation-both-390x844.png`,
    vp: { width: 390, height: 844 },
    async setup(page) {
      await qa(page, 'quality', 1);
      await qa(page, 'seed', 'midgame');
      await qa(page, 'dismissTutorial');
      await qa(page, 'constellationCapture');
    },
  },
  {
    file: `polish-${TAG}-board-midgame-360x640.png`,
    vp: { width: 360, height: 640 },
    board: 'midgame',
  },
  {
    file: `polish-${TAG}-board-midgame-390x844.png`,
    vp: { width: 390, height: 844 },
    board: 'midgame',
  },
  {
    file: `polish-${TAG}-board-midgame-430x932.png`,
    vp: { width: 430, height: 932 },
    board: 'midgame',
  },
  {
    file: `polish-${TAG}-board-early-360x640.png`,
    vp: { width: 360, height: 640 },
    board: 'fresh',
  },
  {
    file: `polish-${TAG}-board-early-390x844.png`,
    vp: { width: 390, height: 844 },
    board: 'fresh',
  },
  {
    file: `polish-${TAG}-board-early-430x932.png`,
    vp: { width: 430, height: 932 },
    board: 'fresh',
  },
  {
    file: `polish-${TAG}-palette-360x640.png`,
    vp: { width: 360, height: 640 },
    board: 'fresh',
    clip: 'palette',
  },
  {
    file: `polish-${TAG}-torus-844x390.png`,
    vp: { width: 844, height: 390 },
    isMobile: true,
    torus: true,
  },
  {
    file: `polish-${TAG}-torus-932x430.png`,
    vp: { width: 932, height: 430 },
    isMobile: true,
    torus: true,
  },
];

async function setupBoard(page, seed) {
  await qa(page, 'quality', 1);
  await qa(page, 'seed', seed);
  await qa(page, 'dismissTutorial');
  await qa(page, 'manifold', 'off');
}

async function main() {
  const port = await freePort();
  const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [viteBin, 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}${BASE}?dev&qa`;
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  for (const s of shots) {
    const ctx = await browser.newContext({
      viewport: s.vp,
      deviceScaleFactor: 1,
      isMobile: !!s.isMobile,
      hasTouch: !!s.isMobile,
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.game?.qa?.ready);
    if (s.torus) {
      await setupBoard(page, 'midgame');
      await qa(page, 'manifold', 'torus');
      await page.waitForFunction(() => window.game?.qa?.manifoldStats?.()?.surface === 'torus');
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await assertTorus(page, s.file);
    } else if (s.setup) {
      await s.setup(page);
    } else if (s.board) {
      await setupBoard(page, s.board);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await assertBoard(page, s.file);
    }
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const opts = { path: join(ART, s.file) };
    if (s.clip === 'palette') {
      const box = await page.locator('.palette').boundingBox();
      if (box) opts.clip = box;
    }
    await page.screenshot(opts);
    console.log('wrote', join(ART, s.file));
    await ctx.close();
  }
  await browser.close();
  child.kill('SIGTERM');
  if (process.exitCode) process.exit(process.exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
