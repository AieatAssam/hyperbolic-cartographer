import * as THREE from 'three';
import Decimal from 'break_eternity.js';
import { config } from './core/config';
import { initialState, graphOf, type GameState } from './core/state';
import { adjacency, buyChartUpg, buyCurvUpg, isActive, maxRing, mods, place, prod, previewDelta, sell, sellValue, survey, tileCost, togglePin } from './core/economy';
import { drift, project } from './core/prestige';
import { applyOffline, simulate } from './core/tick';
import { exportString, importSave, makeSave, toJson } from './core/save';
import { TILE_INFO, TILE_TYPES } from './core/tiles';
import { createScene } from './render/scene';
import { Board } from './render/board';
import { Pulses } from './render/fx';
import { createUI, type Tool } from './ui/ui';
import { fmt } from './ui/format';

const KEY = 'hc-save', BACKUP = 'hc-save-backup';
const dev = import.meta.env.DEV || location.search.includes('dev');
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

// ---- state + load ----
let s: GameState = initialState();
let offline = null as ReturnType<typeof applyOffline> | null;
const saved = store.get(KEY);
if (saved) {
  const r = importSave(saved);
  if (r.ok) {
    s = r.state;
    offline = applyOffline(s, (Date.now() - r.save.savedAt) / 1000);
  } else console.warn('Save not loaded:', r.error);
}
const persist = () => store.set(KEY, exportString(makeSave(s, Date.now())));

// ---- render ----
const canvas = document.getElementById('c') as HTMLCanvasElement;
const { renderer, scene, camera, controls } = createScene(canvas);
const pulses = new Pulses();
scene.add(pulses.points);
let board: Board;
const frameCamera = () => {
  controls.target.set(0, 0, 0);
  const k = s.geometry === 'hyper' ? 1.4 : 1;
  camera.position.set(0, 13 * k, 11 * k);
};
function syncBoard() {
  if (board?.geometry === s.geometry) return;
  if (board) {
    scene.remove(board.group);
    board.dispose();
  }
  board = new Board(s.geometry);
  scene.add(board.group);
  controls.enablePan = s.geometry === 'square';
  frameCamera();
}
syncBoard();

// ---- actions ----
let speed = 1;
const tool: { current: Tool } = { current: 'spring' };
const ui = createUI(document.getElementById('ui')!, {
  state: () => s,
  tool,
  dev,
  act: {
    survey: () => void survey(s),
    drift: () => {
      persist();
      const g = drift(s);
      if (g.gte(1)) ui.flash(), ui.toast(`Drifted for ${fmt(g)} Charts`);
    },
    project: () => {
      persist();
      const g = project(s);
      ui.flash();
      setTimeout(syncBoard, 350); // swap boards under the flash
      ui.toast(`Projected! +${fmt(g)} Curvature. The map is now hyperbolic.`);
    },
    buyChart: (id) => void buyChartUpg(s, id),
    buyCurv: (id) => void buyCurvUpg(s, id),
    exportString: () => exportString(makeSave(s, Date.now())),
    exportFile: () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([toJson(makeSave(s, Date.now()))], { type: 'application/json' }));
      a.download = `cartographer-save-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    parseImport: importSave,
    applyImport: (n) => {
      store.set(BACKUP, exportString(makeSave(s, Date.now())));
      s = n;
      persist();
      syncBoard();
    },
    hardReset: () => {
      store.set(BACKUP, exportString(makeSave(s, Date.now())));
      s = initialState();
      persist();
      syncBoard();
    },
    setSpeed: (x) => (speed = x),
    grant: (kind, n) => {
      if (kind === 'ink') (s.ink = s.ink.add(n)), (s.runInk = s.runInk.add(n)), (s.lifetimeInk = s.lifetimeInk.add(n));
      if (kind === 'charts') (s.charts = s.charts.add(n)), (s.cycleCharts = s.cycleCharts.add(n));
      if (kind === 'curvature') s.curvature = s.curvature.add(n);
    },
    recenter: () => {
      board.recenter();
      frameCamera();
    },
  },
});
if (offline) ui.showOffline(offline);

// ---- input ----
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const worldAt = (x: number, y: number) => {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(plane, new THREE.Vector3());
};
let hover = -1;
let down: { x: number; y: number; w: THREE.Vector3 | null; moved: boolean; button: number } | null = null;

function tooltipHtml(i: number): string {
  const t = s.tiles[i], tl = tool.current;
  if (!isActive(s, i)) return `<b>Unsurveyed</b><br><span class="muted">Survey ring ${graphOf(s).ring[i]} to open this cell.</span>`;
  const delta = (d: number) => `<span class="${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '+' : '−'}${fmt(Math.abs(d), s.notation)} Ink/s</span>`;
  if (!t) {
    if (tl === 'sell' || tl === 'pin') return `<span class="muted">Empty cell · ${graphOf(s).neighbours[i].length} neighbours</span>`;
    const cost = tileCost(s, tl);
    return `<b>Place ${TILE_INFO[tl].name}</b> · ${fmt(cost, s.notation)} Ink<br>${delta(previewDelta(s, i, tl))}${s.ink.lt(cost) ? '<br><span class="neg">Not enough Ink</span>' : ''}`;
  }
  const out = prod(s).perTile[i];
  let html = `<b>${TILE_INFO[t].name}</b>${s.pinned.includes(i) ? ' · 📌 pinned' : ''}<br><span class="muted">${out ? `${fmt(out, s.notation)} Ink/s` : TILE_INFO[t].desc}</span>`;
  if (tl === 'sell') html += `<br>Sell for ${fmt(sellValue(s, t), s.notation)} · ${delta(previewDelta(s, i, null))}`;
  else if (tl === 'pin') html += `<br>Click to ${s.pinned.includes(i) ? 'unpin' : 'pin'} (kept through Drift)`;
  else html += `<br><span class="muted">Occupied — use Sell (S) first</span>`;
  return html;
}

canvas.addEventListener('pointerdown', (e) => {
  const w0 = worldAt(e.clientX, e.clientY);
  hover = w0 ? board.pick(w0.x, w0.z, s) : -1;
  down ={ x: e.clientX, y: e.clientY, w: worldAt(e.clientX, e.clientY), moved: false, button: e.button };
});
addEventListener('pointerup', () => {
  if (down && !down.moved && down.button === 0 && hover >= 0) {
    const tl = tool.current;
    if (tl === 'sell') sell(s, hover);
    else if (tl === 'pin') togglePin(s, hover) || ui.toast('No pins left (buy Brass Pins)');
    else if (!s.tiles[hover] && isActive(s, hover) && !place(s, hover, tl)) ui.toast('Not enough Ink');
  }
  down = null;
});
canvas.addEventListener('pointermove', (e) => {
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
  if (down?.moved && down.button === 0 && s.geometry === 'hyper' && down.w) {
    const w = worldAt(e.clientX, e.clientY);
    if (w) board.pan(w.x - down.w.x, w.z - down.w.z, maxRing(s)), (down.w = w);
  }
  const w = worldAt(e.clientX, e.clientY);
  hover = w && !down?.moved ? board.pick(w.x, w.z, s) : -1;
  ui.tooltip(e.clientX, e.clientY, hover >= 0 ? tooltipHtml(hover) : null);
});
canvas.addEventListener('pointerleave', () => ((hover = -1), ui.tooltip(0, 0, null)));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- persistence ----
setInterval(persist, 10_000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && persist());
addEventListener('pagehide', persist);

// ---- loop: fixed 10 Hz simulation, rAF rendering ----
const STEP = 1 / config.tickRate;
let acc = 0, last = performance.now(), uiAcc = 0, linkKey = '', links: [number, number][] = [];
function frame(now: number) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += dt * speed;
  let steps = 0;
  while (acc >= STEP && steps++ < 1000) simulate(s, STEP), (acc -= STEP);
  if (steps >= 1000) acc = 0;

  const p = prod(s), g = graphOf(s);
  const key = s.geometry + s.tiles.join();
  if (key !== linkKey) {
    linkKey = key;
    const reach = mods(s).reach;
    links = [];
    s.tiles.forEach((t, i) => {
      if (t !== 'mill' && t !== 'spring') return;
      for (const n of adjacency(g, s.tiles, i, reach))
        if ((t === 'mill' && s.tiles[n] === 'spring') || s.tiles[n] === 'beacon') links.push([n, i]);
    });
  }
  const hoverAdj = hover >= 0 ? (s.tiles[hover] ? adjacency(g, s.tiles, hover, mods(s).reach) : g.neighbours[hover]) : [];
  board.update(s, p.perTile, hover, hoverAdj);
  pulses.update(dt, board.tops, links, Math.min(40, 2 + links.length * 0.4));
  controls.update();
  renderer.render(scene, camera);
  if ((uiAcc += dt) > 0.1) (uiAcc = 0), ui.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (dev) Object.assign(window, { game: { get s() { return s; }, Decimal, TILE_TYPES } });
