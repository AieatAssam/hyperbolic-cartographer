/** Before/after captures for phone polish PR. Usage: POLISH_TAG=before|after npm run build && node scripts/capture-phone-polish.mjs */
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

const shots = [
  {
    file: `polish-${TAG}-constellation-390x844.png`,
    vp: { width: 390, height: 844 },
    async setup(page) {
      await qa(page, 'quality', 1);
      await qa(page, 'seed', 'midgame');
      await qa(page, 'dismissTutorial');
      await qa(page, 'manifold', 'off');
      await qa(page, 'constellationCapture');
    },
  },
  {
    file: `polish-${TAG}-board-midgame-390x844.png`,
    vp: { width: 390, height: 844 },
    async setup(page) {
      await qa(page, 'quality', 1);
      await qa(page, 'seed', 'midgame');
      await qa(page, 'dismissTutorial');
    },
  },
  {
    file: `polish-${TAG}-board-early-390x844.png`,
    vp: { width: 390, height: 844 },
    async setup(page) {
      await qa(page, 'quality', 1);
      await qa(page, 'seed', 'fresh');
      await qa(page, 'dismissTutorial');
    },
  },
  {
    file: `polish-${TAG}-board-early-360x640.png`,
    vp: { width: 360, height: 640 },
    async setup(page) {
      await qa(page, 'quality', 1);
      await qa(page, 'seed', 'fresh');
      await qa(page, 'dismissTutorial');
    },
  },
  {
    file: `polish-${TAG}-palette-360x640.png`,
    vp: { width: 360, height: 640 },
    async setup(page) {
      await qa(page, 'quality', 1);
      await qa(page, 'seed', 'fresh');
      await qa(page, 'dismissTutorial');
    },
    clip: true,
  },
  {
    file: `polish-${TAG}-torus-844x390.png`,
    vp: { width: 844, height: 390 },
    isMobile: true,
    async setup(page) {
      await qa(page, 'quality', 1);
      await qa(page, 'seed', 'midgame');
      await qa(page, 'dismissTutorial');
      await qa(page, 'manifold', 'torus');
      await page.waitForFunction(() => window.game?.qa?.manifoldStats?.()?.surface === 'torus');
      await qa(page, 'manifoldProjectFit');
    },
  },
  {
    file: `polish-${TAG}-torus-932x430.png`,
    vp: { width: 932, height: 430 },
    isMobile: true,
    async setup(page) {
      await qa(page, 'quality', 1);
      await qa(page, 'seed', 'midgame');
      await qa(page, 'dismissTutorial');
      await qa(page, 'manifold', 'torus');
      await page.waitForFunction(() => window.game?.qa?.manifoldStats?.()?.surface === 'torus');
      await qa(page, 'manifoldProjectFit');
    },
  },
];

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
    await s.setup(page);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const opts = { path: join(ART, s.file) };
    if (s.clip) {
      const box = await page.locator('.palette').boundingBox();
      if (box) opts.clip = box;
    }
    await page.screenshot(opts);
    console.log('wrote', join(ART, s.file));
    await ctx.close();
  }
  await browser.close();
  child.kill('SIGTERM');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
