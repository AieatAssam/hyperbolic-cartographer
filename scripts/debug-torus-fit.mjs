/** One-case manifold fit probe (CI parity: build + preview + SwiftShader). */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
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

async function qa(page, hook, ...args) {
  return page.evaluate(async ([h, a]) => {
    const f = window.game?.qa?.[h];
    if (!f) throw new Error(`missing ${h}`);
    return f(...a);
  }, [hook, args]);
}

async function main() {
  const dist = join(ROOT, 'dist', 'index.html');
  if (!existsSync(dist)) {
    console.error('run npm run build first');
    process.exit(1);
  }
  const port = await freePort();
  const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [viteBin, 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}${BASE}?dev&qa`;
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.game?.qa?.ready);
  await qa(page, 'quality', 0);
  await qa(page, 'seed', 'midgame');
  await qa(page, 'dismissTutorial');
  await qa(page, 'manifold', 'torus');
  await page.waitForFunction(() => window.game?.qa?.manifoldStats?.()?.surface === 'torus');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const r = await qa(page, 'manifoldProjectFit');
  const dims = await page.evaluate(() => ({
    innerWidth,
    innerHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
  }));
  console.log(JSON.stringify({ dims, ...r }, null, 2));
  await browser.close();
  child.kill('SIGTERM');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
