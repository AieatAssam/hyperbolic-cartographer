import * as THREE from 'three';
import Decimal from 'break_eternity.js';
import { config } from './core/config';
import { initialState, graphOf, type GameState } from './core/state';
import { adjacency, buyChartUpg, buyCurvUpg, isActive, maxRing, mods, place, prod, previewDelta, sell, sellValue, survey, tileCost, togglePin } from './core/economy';
import { canDrift, canProject, drift, project } from './core/prestige';
import { applyOffline, simulate } from './core/tick';
import { exportString, importSave, makeSave, toJson } from './core/save';
import { TILE_INFO, TILE_TYPES } from './core/tiles';
import { createScene } from './render/scene';
import { Board, DISK_R } from './render/board';
import { cellCorners, circlePts, fitDistance, freeRect, shouldReframe, type Rect, type Role } from './render/framing';
import type { SquareBoard } from './core/geometry/square';
import { CartographyFX, type FxQuality } from './render/fx';
import { TRANSITION_S, transitionPhase } from './render/transition';
import { TILE_IDENTITIES } from './art/palette';
import { createUI, type Tool } from './ui/ui';
import { fmt } from './ui/format';
import { placeBlocked } from './ui/help';
import { TapController, type PointerKind } from './ui/input';
import { TUTORIAL_KEY } from './ui/tutorial';

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
const { scene, camera, controls, renderFrame, getQuality } = createScene(canvas);
const fx = new CartographyFX(getQuality().level as FxQuality);
scene.add(fx.group);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let inkTarget: [number, number] = [0, 0.92]; // HUD Ink counter centre in NDC, cached in layoutView
let board: Board;
let prevTiles: GameState['tiles'] = [], prevRing = s.ring; // FX diff: covers manual and automated changes once
/** Prestige transition, driven by frame dt (no timers). The economy reset runs once, at the midpoint. */
type Trans = { kind: 'drift' | 'projection'; t: number; swapped: boolean };
let trans: Trans | null = null;
const MAX_FX_EVENTS = 6; // per frame, so autoBuy bursts cannot flood the pool
const tap = new TapController(); // tap/drag/pinch classification; holds the touch-previewed cell

// ---- UI-aware framing: centre the board in the screen area not covered by HUD/panels/dock ----
const POLAR = Math.atan2(11, 13); // default camera tilt from vertical
const MARGIN = 12; // px kept clear around the board inside the free rect
let free: Rect = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
let fitD = 0; // distance that fits the current footprint into `free` (0 = not yet framed)
let layoutDirty = true;
/** Board footprint on the ground: hyper = whole disk incl. slab/rim; square = active cells + next ring. */
function footprint(): [number, number][] {
  if (s.geometry === 'hyper') return circlePts(DISK_R + 0.6);
  const g = graphOf(s) as SquareBoard;
  return cellCorners(g.xy.filter((_, i) => g.ring[i] <= s.ring + 1));
}
const solveFit = () => fitDistance({ pts: footprint(), W: innerWidth, H: innerHeight, free, fov: camera.fov, polar: POLAR, margin: MARGIN });
/** Reads overlay rects (only when dirty) and shifts the projection via setViewOffset so the target sits at the
 *  free rect's centre. Raycasts stay exact: setFromCamera uses the offset projection and NDC spans the canvas.
 *  If already framed, rescales the current orbit distance by the new/old fit ratio (keeps the user's angle). */
function layoutView() {
  layoutDirty = false;
  const W = innerWidth, H = innerHeight;
  const overlays = [...document.querySelectorAll<HTMLElement>('#ui .hud, #ui .panel, #ui .dock')].map((el) => ({
    role: (el.classList.contains('hud') ? 'hud' : el.classList.contains('dock') ? 'dock' : 'panel') as Role,
    rect: el.getBoundingClientRect(),
  }));
  free = freeRect(overlays, W, H);
  const ink = document.querySelector<HTMLElement>('[data-fx-target="ink"]')?.getBoundingClientRect();
  if (ink && ink.width > 0) inkTarget = [((ink.left + ink.width / 2) / W) * 2 - 1, 1 - ((ink.top + ink.height / 2) / H) * 2];
  camera.setViewOffset(W, H, W / 2 - (free.left + free.right) / 2, H / 2 - (free.top + free.bottom) / 2, W, H);
  camera.updateProjectionMatrix();
  const d = solveFit();
  if (fitD > 0) setDistance(camera.position.distanceTo(controls.target) * (d / fitD));
  fitD = d;
  controls.maxDistance = Math.max(40, d * 1.5);
}
const setDistance = (d: number) => {
  const off = camera.position.clone().sub(controls.target);
  camera.position.copy(controls.target).add(off.setLength(d));
};
addEventListener('resize', () => (layoutDirty = true));
// panel toggles (display:none) and dock growth show up as size changes; no per-frame DOM reads
const ro = new ResizeObserver(() => (layoutDirty = true));
const observeUI = () => document.querySelectorAll('#ui .hud, #ui .panel, #ui .dock').forEach((el) => ro.observe(el));
new MutationObserver(() => ((layoutDirty = true), observeUI())).observe(document.getElementById('ui')!, { childList: true });

/** Full refit: default tilt, target at origin, distance solved from the footprint (initial UI, geometry, recenter). */
const frameCamera = () => {
  if (layoutDirty) layoutView();
  controls.target.set(0, 0, 0);
  fitD = solveFit();
  controls.maxDistance = Math.max(40, fitD * 1.5);
  camera.position.set(0, Math.cos(POLAR) * fitD, Math.sin(POLAR) * fitD);
};
function syncBoard() {
  if (board?.geometry === s.geometry) return;
  if (board) {
    scene.remove(board.group);
    board.dispose();
  }
  board = new Board(s.geometry, scene.environment);
  tap.clearSelection(); // cell indices belong to the old graph
  fx.clear(); // stale particles/endpoints belong to the old graph
  prevTiles = s.tiles.slice();
  scene.add(board.group);
  controls.enablePan = s.geometry === 'square';
  frameCamera();
}
syncBoard();

// ---- actions ----
let speed = 1;
const tool: { current: Tool } = { current: 'spring' };
/** Applies the current tool to cell i; toasts the reason and returns false when it can't. */
function applyTool(i: number): boolean {
  if (trans) return false; // board actions are locked while a prestige transition plays
  const tl = tool.current;
  const why = placeBlocked(s, i, tl);
  if (why) return ui.toast(why), false;
  if (tl === 'sell') return sell(s, i);
  if (tl === 'pin') return togglePin(s, i);
  return place(s, i, tl);
}
const ui = createUI(document.getElementById('ui')!, {
  state: () => s,
  tool,
  dev,
  selected: () => tap.selected,
  cellInfo: (i) => cellHtml(i),
  tutorial: { load: () => store.get(TUTORIAL_KEY), save: (v) => store.set(TUTORIAL_KEY, v) },
  act: {
    confirmPlace: () => {
      const c = tap.selected;
      if (c >= 0 && applyTool(c)) tap.clearSelection();
    },
    cancelPlace: () => tap.clearSelection(),
    // economy mutations are locked while a prestige transition plays, same as board taps
    survey: () => void (trans || survey(s)),
    drift: () => startTransition('drift'),
    project: () => startTransition('projection'),
    buyChart: (id) => void (trans || buyChartUpg(s, id)),
    buyCurv: (id) => void (trans || buyCurvUpg(s, id)),
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
      tap.clearSelection();
      persist();
      syncBoard();
      (prevTiles = s.tiles.slice()), (prevRing = s.ring); // a loaded save is not a burst of placements
    },
    hardReset: () => {
      store.set(BACKUP, exportString(makeSave(s, Date.now())));
      s = initialState();
      tap.clearSelection();
      persist();
      syncBoard();
      (prevTiles = s.tiles.slice()), (prevRing = s.ring);
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
fx.onInkArrive = (w) => ui.bumpInk(w);
if (offline) ui.showOffline(offline);

function startTransition(kind: Trans['kind']) {
  if (trans || !(kind === 'drift' ? canDrift(s) : canProject(s))) return;
  persist();
  trans = { kind, t: 0, swapped: false };
  tap.clearSelection();
  document.body.classList.add('transitioning');
  ui.setTransition(kind === 'drift' ? 'Drifting: the ink washes the old map away…' : 'Projecting: the square map folds into the hyperbolic disk…');
  fx.prestige(kind);
}
/** Advances the transition; returns true while board input/actions must stay blocked. */
function stepTransition(dt: number) {
  if (!trans) return false;
  trans.t += dt;
  const total = reduced.matches ? TRANSITION_S * 0.5 : TRANSITION_S;
  const { phase, k } = transitionPhase(trans.t, total);
  if (phase !== 'out' && !trans.swapped) {
    trans.swapped = true;
    const g = trans.kind === 'drift' ? drift(s) : project(s); // the only economy reset
    persist();
    syncBoard(); // projection: new disk board (fx.clear inside); drift: same board
    if (trans.kind === 'drift') fx.clear(), (prevTiles = s.tiles.slice());
    prevRing = s.ring;
    fx.prestige(trans.kind); // fresh burst over the reveal, after any clear
    ui.toast(trans.kind === 'drift' ? `Drifted for ${fmt(g)} Charts` : `Projected! +${fmt(g)} Curvature. The map is now hyperbolic.`);
  }
  const warp = trans.kind === 'projection' && !reduced.matches;
  if (phase === 'out') board.setFade(1 - k, warp ? k : 0);
  else if (phase === 'in') board.setFade(k, warp ? 1 - k : 0);
  else {
    board.setFade(1);
    trans = null;
    document.body.classList.remove('transitioning');
    ui.setTransition(null);
    layoutDirty = true;
  }
  return true;
}
/** One-shot FX from state diffs (manual taps and automation alike, so nothing fires twice). */
function diffFx() {
  let n = 0;
  if (s.ring > prevRing && s.geometry === board.geometry) fx.survey(s.geometry === 'hyper' ? DISK_R : 2 + s.ring), n++;
  prevRing = s.ring;
  const now = fx.now;
  for (let i = 0; i < s.tiles.length; i++) {
    const a = prevTiles[i], b = s.tiles[i];
    if (a === b) continue;
    if (n < MAX_FX_EVENTS) {
      if (b) fx.placement(i, TILE_IDENTITIES[b].emissive), board.markPlaced(i, now);
      else fx.sell(i);
      n++;
    } else if (b) board.markPlaced(i, now); // squash is free; particles are capped
  }
  prevTiles = s.tiles.slice();
}
observeUI();
layoutDirty = true;
frameCamera(); // re-fit now that the UI exists

// ---- input ----
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const worldAt = (x: number, y: number) => {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(plane, new THREE.Vector3());
};
let hover = -1; // mouse hover only; touch uses tap.selected
let panFrom: THREE.Vector3 | null = null; // hyperbolic one-pointer pan anchor

/** Cell description for the hover tooltip (mouse) and the preview card (touch). */
function cellHtml(i: number): string {
  const t = s.tiles[i], tl = tool.current;
  if (!isActive(s, i)) return `<b>Unsurveyed</b><br><span class="muted">Survey ring ${graphOf(s).ring[i]} to open this cell.</span>`;
  const why = placeBlocked(s, i, tl);
  const whyHtml = why ? `<br><span class="neg">${why}</span>` : '';
  const delta = (d: number) => `<span class="${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '+' : '−'}${fmt(Math.abs(d), s.notation)} Ink/s</span>`;
  const nb = graphOf(s).neighbours[i].length;
  if (!t) {
    if (tl === 'sell' || tl === 'pin') return `<span class="muted">Empty cell · ${nb} neighbours</span>${whyHtml}`;
    const cost = tileCost(s, tl);
    return `<b>Place ${TILE_INFO[tl].name}</b> · ${fmt(cost, s.notation)} Ink · ${nb} neighbours<br>${delta(previewDelta(s, i, tl))}${whyHtml}`;
  }
  const out = prod(s).perTile[i];
  let html = `<b>${TILE_INFO[t].name}</b>${s.pinned.includes(i) ? ' · 📌 pinned' : ''}<br><span class="muted">${out ? `${fmt(out, s.notation)} Ink/s` : TILE_INFO[t].desc}</span>`;
  if (tl === 'sell') html += `<br>Sell for ${fmt(sellValue(s, t), s.notation)} · ${delta(previewDelta(s, i, null))}`;
  else if (tl === 'pin') html += `<br>${s.pinned.includes(i) ? 'Unpin' : 'Pin'}: pinned tiles are kept through Drift`;
  else return `${html}<br><span class="muted">Occupied: pick Sell (S) to remove it</span>`;
  return html + whyHtml;
}

const pickAt = (x: number, y: number) => {
  const w = worldAt(x, y);
  return w ? board.pick(w.x, w.z, s) : -1;
};
const kindOf = (e: PointerEvent): PointerKind => (e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse');
const endPointer = () => {
  if (tap.active === 0) panFrom = null;
};
// Mouse: click applies at once (hover already previewed). Touch/pen: first tap previews, a second tap on the
// same cell (or the Place button) confirms. Drags, pinches and cancelled pointers never place.
canvas.addEventListener('pointerdown', (e) => {
  tap.down(e.pointerId, e.clientX, e.clientY, kindOf(e), e.button);
  panFrom = tap.active === 1 ? worldAt(e.clientX, e.clientY) : null;
});
addEventListener('pointerup', (e) => {
  if (e.target !== canvas) { // released over overlay UI: never place underneath panels
    tap.cancel(e.pointerId);
    endPointer();
    return;
  }
  const touch = e.pointerType !== 'mouse';
  const a = tap.up(e.pointerId, pickAt(e.clientX, e.clientY));
  endPointer();
  if (a.kind === 'apply' && !applyTool(a.cell) && touch) tap.selected = a.cell; // keep the preview so the reason stays visible
  if (a.kind !== 'none') ui.update();
});
addEventListener('pointercancel', (e) => {
  tap.cancel(e.pointerId);
  endPointer();
  hover = -1;
  ui.tooltip(0, 0, null);
});
canvas.addEventListener('pointermove', (e) => {
  if (tap.move(e.pointerId, e.clientX, e.clientY) && s.geometry === 'hyper' && panFrom) {
    const w = worldAt(e.clientX, e.clientY);
    if (w) board.pan(w.x - panFrom.x, w.z - panFrom.z, maxRing(s)), (panFrom = w);
  }
  if (e.pointerType !== 'mouse') return;
  hover = tap.active && tap.dragging ? -1 : pickAt(e.clientX, e.clientY);
  ui.tooltip(e.clientX, e.clientY, hover >= 0 ? cellHtml(hover) : null);
});
canvas.addEventListener('pointerleave', () => ((hover = -1), ui.tooltip(0, 0, null)));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- persistence ----
setInterval(persist, 10_000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && persist());
addEventListener('pagehide', persist);

// ---- loop: fixed 10 Hz simulation, rAF rendering ----
const STEP = 1 / config.tickRate;
let acc = 0, last = performance.now(), uiAcc = 0, linkKey = '', links: [number, number][] = [], lastRing = s.ring;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const locked = stepTransition(dt);
  acc = locked ? 0 : acc + dt * speed; // economy pauses for the ~1.5 s transition
  let steps = 0;
  while (acc >= STEP && steps++ < 1000) simulate(s, STEP), (acc -= STEP);
  if (steps >= 1000) acc = 0;

  if (s.ring !== lastRing) (lastRing = s.ring), (layoutDirty = true);
  if (shouldReframe(layoutDirty, tap.selected)) layoutView(); // a previewed touch cell holds the board still
  if (board.geometry !== s.geometry) return renderFrame(dt); // mid-Projection swap
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
  const focus = hover >= 0 ? hover : tap.selected;
  const hoverAdj = focus >= 0 ? (s.tiles[focus] ? adjacency(g, s.tiles, focus, mods(s).reach) : g.neighbours[focus]) : [];
  board.update(s, p.perTile, focus, hoverAdj);
  if (!locked) diffFx();
  fx.update(dt, { tops: board.tops, links, tiles: s.tiles, perTile: p.perTile, neighbours: g.neighbours, quality: getQuality().level as FxQuality, inkTargetNdc: inkTarget });
  board.tick(fx.now, reduced.matches);
  controls.update();
  renderFrame(dt);
  if ((uiAcc += dt) > 0.1) (uiAcc = 0), ui.update();
}
requestAnimationFrame(frame);

if (dev) Object.assign(window, { game: {
  get s() { return s; }, Decimal, TILE_TYPES, renderQuality: getQuality,
  // QA hooks for deterministic effect screenshots (dev flag only; FX only, never economy)
  fxStats: () => fx.stats(),
  triggerFx: (kind: string, i = 0) => {
    if (kind === 'place') fx.placement(i, TILE_IDENTITIES[s.tiles[i] ?? 'spring'].emissive), board.markPlaced(i, fx.now);
    else if (kind === 'sell') fx.sell(i);
    else if (kind === 'survey') fx.survey(s.geometry === 'hyper' ? DISK_R : 2 + s.ring);
    else if (kind === 'aura') fx.beaconAura(i);
    else if (kind === 'drift' || kind === 'projection') fx.prestige(kind);
  },
} });
