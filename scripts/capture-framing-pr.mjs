/** Portrait framing before/after captures. POLISH_TAG=before|after. Requires `npm run build`. */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART = '/opt/cursor/artifacts';
mkdirSync(ART, { recursive: true });
const TAG = process.env.POLISH_TAG === 'before' ? 'before' : 'after';
const BASE = '/hyperbolic-cartographer/';

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

async function raf(page, n = 2) {
  await page.evaluate((k) => new Promise((r) => {
    const step = (i) => (i <= 0 ? r() : requestAnimationFrame(() => step(i - 1)));
    step(k);
  }), n);
}

async function setup(page, seed) {
  await qa(page, 'quality', 1);
  await qa(page, 'seed', seed);
  await qa(page, 'dismissTutorial');
  await qa(page, 'menu', false);
  await page.evaluate(() => document.querySelector('.tutorial')?.classList.add('hidden'));
  await raf(page, 3);
  await page.waitForTimeout(200);
}

function shotName(kind, w, h) {
  return `framing-${TAG}-${kind}-${w}x${h}.png`;
}

async function logBoard(page, label) {
  const r = await qa(page, 'playableFramingCheck', 8);
  if (!r) {
    console.log(`${label} playableFramingCheck=null`);
    return r;
  }
  const bits = [
    r.ok ? 'ok' : 'FAIL',
    `wFill=${r.widthFill?.toFixed?.(3) ?? r.widthFill}`,
    r.heightFill != null ? `hFill=${Number(r.heightFill).toFixed(3)}` : null,
    r.skyGap != null ? `sky=${Number(r.skyGap).toFixed(1)}` : null,
  ].filter(Boolean);
  console.log(`${label} board ${bits.join(' ')}`);
  if (!r.ok) console.log('  failures', r.failures);
  return r;
}

const metrics = [];

async function capture(browser, url, w, h, kind, seed, extra) {
  const isMobile = Math.min(w, h) <= 430;
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    isMobile,
    hasTouch: isMobile,
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.game?.qa?.ready);
  await setup(page, seed);
  if (extra) await extra(page);
  await raf(page, 2);
  const file = shotName(kind, w, h);
  const path = join(ART, file);
  const board = kind === 'torus' ? null : await logBoard(page, file);
  if (kind === 'torus') {
    const t = await qa(page, 'torusScreenBounds');
    console.log(`${file} torus`, t?.ok, t?.heightInBand, t?.widthInView);
  }
  await page.screenshot({ path });
  console.log('wrote', path);
  metrics.push({ file, kind, w, h, board });
  await ctx.close();
}

async function main() {
  const port = await freePort();
  const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [viteBin, 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT, stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}${BASE}?dev&qa`;
  await new Promise((r) => setTimeout(r, 900));
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  for (const { w, h } of VIEWS) {
    await capture(browser, url, w, h, 'fresh', 'fresh');
    await capture(browser, url, w, h, 'midgame', 'midgame');
  }

  // Starter board with coloured arches (links-demo is ring 1).
  for (const { w, h } of VIEWS.filter((v) => v.h > v.w || (v.w === 1280))) {
    await capture(browser, url, w, h, 'links', 'links-demo');
  }

  const phone = { w: 390, h: 844 };
  await capture(browser, url, phone.w, phone.h, 'inspect', 'links-demo', async (page) => {
    const cells = await qa(page, 'linksDemoTiles');
    if (!(cells?.mill >= 0)) throw new Error('linksDemoTiles missing mill');
    await qa(page, 'inspectAt', cells.mill);
    await page.waitForFunction(() => (document.querySelector('.info-lead b')?.textContent ?? '').includes('Mill'));
    await page.waitForTimeout(400);
  });
  await capture(browser, url, phone.w, phone.h, 'inspect-closed', 'links-demo', async (page) => {
    await qa(page, 'clearBoardFocus');
    await raf(page, 2);
  });
  await capture(browser, url, phone.w, phone.h, 'panel', 'midgame', async (page) => {
    await qa(page, 'menu', true);
    await qa(page, 'tab', 'map');
    await page.waitForTimeout(250);
  });
  await capture(browser, url, phone.w, phone.h, 'settings', 'midgame', async (page) => {
    await qa(page, 'tab', 'save');
    await page.waitForTimeout(300);
  });
  await capture(browser, url, phone.w, phone.h, 'hyper', 'hyper');
  const lateSeed = await (async () => {
    const probe = await browser.newPage();
    await probe.goto(url, { waitUntil: 'load' });
    await probe.waitForFunction(() => window.game?.qa?.ready);
    const names = ['late', 'ux-demo'];
    let chosen = 'ux-demo';
    for (const n of names) {
      try {
        await qa(probe, 'seed', n);
        chosen = n;
        if (n === 'late') break;
      } catch { /* seed may not exist on before builds */ }
    }
    await probe.close();
    return chosen;
  })();
  await capture(browser, url, phone.w, phone.h, 'late', lateSeed);
  await capture(browser, url, 360, 640, 'late', lateSeed);
  await capture(browser, url, 430, 932, 'late', lateSeed);

  await capture(browser, url, 844, 390, 'torus', 'midgame', async (page) => {
    await qa(page, 'manifold', 'torus');
    await page.waitForFunction(() => window.game?.qa?.manifoldStats?.()?.surface === 'torus');
    await raf(page, 3);
  });
  await capture(browser, url, 1280, 800, 'torus', 'midgame', async (page) => {
    await qa(page, 'manifold', 'torus');
    await page.waitForFunction(() => window.game?.qa?.manifoldStats?.()?.surface === 'torus');
    await raf(page, 3);
  });

  const stab = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await stab.goto(url, { waitUntil: 'load' });
  await stab.waitForFunction(() => window.game?.qa?.ready);
  await setup(stab, 'links-demo');
  const idle = await qa(stab, 'cameraStabilitySample', 90);
  writeFileSync(join(ART, `framing-${TAG}-stability-idle.json`), JSON.stringify(idle, null, 2));
  const cells0 = await qa(stab, 'linksDemoTiles');
  if (cells0?.mill >= 0) await qa(stab, 'inspectAt', cells0.mill);
  await qa(stab, 'clearBoardFocus');
  const tapped = await qa(stab, 'cameraStabilitySample', 60);
  writeFileSync(join(ART, `framing-${TAG}-stability-taps.json`), JSON.stringify(tapped, null, 2));
  console.log('stability', idle, tapped);
  await stab.close();

  writeFileSync(join(ART, `framing-${TAG}-metrics.json`), JSON.stringify(metrics, null, 2));
  await browser.close();
  child.kill('SIGTERM');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
