import * as THREE from 'three';
import Decimal from 'break_eternity.js';
import { config } from './core/config';
import { initialState, graphOf, GRAPHS, type GameState } from './core/state';
import { adjacency, buyChartUpg, buyCurvUpg, isActive, maxRing, mods, place, prod, previewDelta, sell, sellValue, survey, tileCost, togglePin } from './core/economy';
import { canDrift, canProject, drift, project } from './core/prestige';
import { applyOffline, simulate } from './core/tick';
import { exportString, importSave, makeSave, toJson } from './core/save';
import { TILE_INFO, TILE_TYPES, type TileType } from './core/tiles';
import { createScene, type QualityLevel } from './render/scene';
import { Board, DISK_R } from './render/board';
import { cellCorners, circlePts, fitDistance, freeRect, shouldReframe, type Rect, type Role } from './render/framing';
import type { SquareBoard } from './core/geometry/square';
import { CartographyFX, type FxContext, type FxQuality } from './render/fx';
import { productionRoutes, revealSpans, surveyWave, type Route } from './render/fx-graph';
import { budgetFor } from './render/fx-model';
import { TRANSITION_S, transitionPhase } from './render/transition';
import { TILE_IDENTITIES } from './art/palette';
import { createUI, type Tool } from './ui/ui';
import { fmt } from './ui/format';
import { placeBlocked } from './ui/help';
import { TapController, type PointerKind } from './ui/input';
import { TUTORIAL_KEY, dismissTutorial, freshTutorial, parseTutorial, serializeTutorial, type TutorialState } from './ui/tutorial';
const KEY = 'hc-save', BACKUP = 'hc-save-backup';
const dev = import.meta.env.DEV || location.search.includes('dev');
const qa = dev && new URLSearchParams(location.search).has('qa'); // QA: deterministic, no localStorage writes
const qaMem = new Map<string, string>(); // QA writes land here instead of localStorage
const store = {
  get: (k: string) => {
    if (qa && qaMem.has(k)) return qaMem.get(k)!;
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set: (k: string, v: string) => {
    if (qa) return void qaMem.set(k, v);
    try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
  },
};

// ---- state + load ----
let s: GameState = initialState();
let offline = null as ReturnType<typeof applyOffline> | null;
const saved = store.get(KEY);
if (saved) {
  const r = importSave(saved);
  if (r.ok) {
    s = r.state;
    if (!qa) offline = applyOffline(s, (Date.now() - r.save.savedAt) / 1000);
  } else console.warn('Save not loaded:', r.error);
}
const persist = () => store.set(KEY, exportString(makeSave(s, Date.now())));

// ---- render ----
const canvas = document.getElementById('c') as HTMLCanvasElement;
const { renderer, scene, camera, controls, composer, renderFrame, getQuality, setQuality } = createScene(canvas);
const fx = new CartographyFX(getQuality().level as FxQuality);
scene.add(fx.group);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let inkTarget: [number, number] = [0, 0.92]; // HUD Ink counter centre in NDC, cached in layoutView
let board: Board;
let prevTiles: GameState['tiles'] = [], prevRing = s.ring; // FX diff: covers manual and automated changes once
/** Prestige transition, driven by frame dt (no timers). The economy reset runs once, at the midpoint.
 *  total and reduced are captured at start, so a media-preference change mid-transition cannot desync the FX timeline. */
type Trans = { kind: 'drift' | 'projection'; t: number; swapped: boolean; total: number; reduced: boolean };
let trans: Trans | null = null;
/** Incoming board rise and survey wave, queued at the swap and run once the new board's embedding is bound. */
let pendingReveal: number | null = null;
/** QA only: the 'in' half of a triggered prestige, fired at its midpoint. */
let qaSwap: { kind: Trans['kind']; at: number; total: number; reduced: boolean } | null = null;
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
// A touch preview is dropped only on a real layout change: an orientation flip, a width change (> 1px) or orientationchange.
// Mobile URL-bar show/hide changes only innerHeight, so the selection survives it.
let lastW = innerWidth, lastLandscape = innerWidth > innerHeight;
const clearPreviewOnLayoutChange = (always: boolean) => {
  const landscape = innerWidth > innerHeight;
  const widthChanged = Math.abs(innerWidth - lastW) > 1;
  const flipped = landscape !== lastLandscape;
  lastW = innerWidth;
  lastLandscape = landscape;
  if (always || widthChanged || flipped) tap.clearSelection();
};
addEventListener('resize', () => ((layoutDirty = true), clearPreviewOnLayoutChange(false)));
addEventListener('orientationchange', () => ((layoutDirty = true), clearPreviewOnLayoutChange(true)));
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
/** `full` (imports, resets) kills every FX instance; the transition swap passes false and calls fx.clearAnchored itself. */
function syncBoard(full = true) {
  // Before the geometry check: a full swap on the same geometry (import or reset during a Drift fade) must still reset FX
  if (full) (fx.clear(), fx.setAnchorFade(1)); // stale particles/endpoints belong to the old graph; a new board is shown
  if (board?.geometry === s.geometry) return;
  if (board) {
    scene.remove(board.group);
    board.dispose();
  }
  board = new Board(s.geometry, scene.environment);
  tap.clearSelection(); // cell indices belong to the old graph
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
    applyImport,
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
    // keeps the preview and the camera zoom; only the disk view moves (no-op while a transition plays)
    centreSelected: () => {
      if (!trans && tap.selected >= 0 && s.geometry === 'hyper') board.centreOn(tap.selected);
    },
  },
});
fx.onInkArrive = (w) => ui.bumpInk(w);
if (offline) ui.showOffline(offline);

/** Swaps in a loaded state (import, QA fixture): the board rebuilds and the backup keeps the old save. */
function applyImport(n: GameState) {
  store.set(BACKUP, exportString(makeSave(s, Date.now())));
  s = n;
  tap.clearSelection();
  persist();
  syncBoard();
  (prevTiles = s.tiles.slice()), (prevRing = s.ring); // a loaded save is not a burst of placements
}

/** Transition length in seconds; reduced motion halves it. */
const transitionTotal = (rm: boolean) => (rm ? TRANSITION_S * 0.5 : TRANSITION_S);
function startTransition(kind: Trans['kind']) {
  if (trans || !(kind === 'drift' ? canDrift(s) : canProject(s))) return;
  persist();
  const total = transitionTotal(reduced.matches), rm = reduced.matches;
  trans = { kind, t: 0, swapped: false, total, reduced: rm };
  tap.clearSelection();
  document.body.classList.add('transitioning');
  ui.setTransition(kind === 'drift' ? 'Drifting: the ink washes the old map away…' : 'Projecting: the square map folds into the hyperbolic disk…');
  fx.prestige(kind, 'out', total, rm);
}
/** Advances the transition; returns true while board input/actions must stay blocked. */
function stepTransition(dt: number) {
  if (!trans) return false;
  trans.t += dt;
  const { total, reduced: rm } = trans;
  const { phase, k } = transitionPhase(trans.t, total);
  if (phase !== 'out' && !trans.swapped) {
    trans.swapped = true;
    const g = trans.kind === 'drift' ? drift(s) : project(s); // the only economy reset
    persist();
    syncBoard(false); // projection: new disk board; drift: same board
    fx.clearAnchored(); // old-graph instances and pending motes; screen wash and vortex keep running
    prevTiles = s.tiles.slice(), prevRing = s.ring; // reset tiles are not sells, and reset rings are not surveys
    pendingReveal = s.ring; // rise and wave are queued until board.update and fx.prepare bind the new embedding
    fx.prestige(trans.kind, 'in', total, rm); // screen-space only, so it needs no embedding
    ui.toast(trans.kind === 'drift' ? `Drifted for ${fmt(g)} Charts` : `Projected! +${fmt(g)} Curvature. The map is now hyperbolic.`);
  }
  const warp = trans.kind === 'projection' && !rm;
  // One fade value for the board and the anchored FX, so their opacity cannot disagree (fx: setAnchorFade)
  const fade = phase === 'out' ? 1 - k : phase === 'in' ? k : 1;
  if (phase === 'out') board.setFade(fade, warp ? k : 0);
  else if (phase === 'in') board.setFade(fade, warp ? 1 - k : 0);
  else {
    board.setFade(1);
    trans = null;
    document.body.classList.remove('transitioning');
    ui.setTransition(null);
    layoutDirty = true;
  }
  fx.setAnchorFade(fade);
  return true;
}
const emissiveOf = (t: TileType | null | undefined) => (t ? TILE_IDENTITIES[t].emissive : undefined);
const viewportPx = () => innerWidth * innerHeight;
/** Frame context for the FX. Built once per frame, so fx.prepare and fx.update see the same board, routes and budget. */
function fxContext(perTile: readonly number[], routes: readonly Route[]): FxContext {
  return {
    tops: board.tops, tiles: s.tiles, perTile, quality: getQuality().level as FxQuality, inkTargetNdc: inkTarget,
    embed: board.embed, routes, boardMatrix: board.group.matrixWorld, viewportPx: viewportPx(),
  };
}
/** Survey and board rise for rings prev < ring ≤ next. The FX wave is sampled to budget; the board rise covers every cell. */
function revealRings(prev: number, next: number) {
  const g = graphOf(s);
  fx.surveyReveal(surveyWave(g, prev, next, budgetFor(getQuality().level, viewportPx()).reveal));
  const spans = revealSpans(g, prev, next);
  board.markRevealed(spans.map((w) => w.i), fx.now, spans.map((w) => w.delay));
}
/** Work that needs the new board's bound embedding: the queued reveal after a swap, and the QA 'in' half of a prestige. */
function flushDeferred() {
  if (pendingReveal !== null) {
    const ring = pendingReveal;
    pendingReveal = null;
    revealRings(-1, ring);
  }
  if (qaSwap && fx.now >= qaSwap.at) {
    fx.prestige(qaSwap.kind, 'in', qaSwap.total, qaSwap.reduced);
    qaSwap = null;
  }
}

/** One-shot FX from state diffs (manual taps and automation alike, so nothing fires twice). */
function diffFx() {
  let n = 0;
  if (s.ring > prevRing && s.geometry === board.geometry) revealRings(prevRing, s.ring), n++;
  prevRing = s.ring;
  const now = fx.now;
  for (let i = 0; i < s.tiles.length; i++) {
    const a = prevTiles[i], b = s.tiles[i];
    if (a === b) continue;
    if (n < MAX_FX_EVENTS) {
      if (b) fx.placement(i, TILE_IDENTITIES[b].emissive), board.markPlaced(i, now);
      else fx.sell(i, emissiveOf(a)); // the sold type's colour, read from the previous tiles
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
let acc = 0, last = performance.now(), uiAcc = 0, routeKey = '', routes: Route[] = [], lastRing = s.ring;
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
  const p = prod(s), g = graphOf(s), reach = mods(s).reach;
  // real graph paths through bridges (economy-matched pairs), cached on everything that changes them
  const rKey = `${s.geometry}|${s.ring}|${reach}|${s.tiles.join()}`;
  if (rKey !== routeKey) (routeKey = rKey), (routes = productionRoutes(g, s.tiles, reach));
  const focus = hover >= 0 ? hover : tap.selected;
  const hoverAdj = focus >= 0 ? (s.tiles[focus] ? adjacency(g, s.tiles, focus, mods(s).reach) : g.neighbours[focus]) : [];
  board.update(s, p.perTile, focus, hoverAdj);
  // prepare binds the new board's embedding before any spawn; update then advances time once
  const ctx = fxContext(p.perTile, routes);
  fx.prepare(ctx);
  flushDeferred();
  if (!locked) diffFx();
  fx.update(dt, ctx);
  board.tick(fx.now, reduced.matches);
  controls.update();
  renderFrame(dt);
  if ((uiAcc += dt) > 0.1) (uiAcc = 0), ui.update();
}
requestAnimationFrame(frame);

// ---- QA fixtures (?dev&qa only): deterministic states, no randomness ----
type QaSeed = 'fresh' | 'midgame' | 'drift-ready' | 'projection-ready' | 'hyper';
/** Tiles on every `every`-th active cell, alternating Mill and Spring. */
function sprinkle(g: GameState, every: number) {
  g.tiles = g.tiles.map((_, i): TileType | null => (!isActive(g, i) || i % every ? null : (i / every) % 2 ? 'mill' : 'spring'));
}
function fixture(name: QaSeed): GameState {
  const g = initialState();
  const d = (n: number) => new Decimal(n);
  if (name === 'fresh') return g;
  if (name === 'hyper') {
    g.geometry = 'hyper';
    g.ring = config.hyper.startRing;
    g.tiles = GRAPHS.hyper.ring.map(() => null);
    sprinkle(g, 5);
    Object.assign(g, { ink: d(3e6), runInk: d(1e6), lifetimeInk: d(1e7), charts: d(40), curvature: d(5), drifts: 2, projections: 1, runTime: 600, totalTime: 7200 });
    return g;
  }
  if (name === 'drift-ready') {
    // chartsOnDrift = floor(sqrt(2e6 / 2.5e5)) = 2
    Object.assign(g, { ink: d(2e6), runInk: d(2e6), lifetimeInk: d(2e6), runTime: 600, totalTime: 600 });
    sprinkle(g, 4);
  } else if (name === 'projection-ready') {
    Object.assign(g, { ink: d(1e6), runInk: d(1e5), lifetimeInk: d(3e6), charts: d(30), cycleCharts: d(30), drifts: 1, runTime: 300, totalTime: 3600 });
    sprinkle(g, 4);
  } else {
    g.ring = 3;
    Object.assign(g, { ink: d(4e4), runInk: d(4e4), lifetimeInk: d(2e5), runTime: 900, totalTime: 3600 });
    sprinkle(g, 3);
  }
  return g;
}
const SAVE_FIXED_AT = 1700000000000;

/** Read-only snapshot for gesture assertions: CSS-px positions of the nearest visible active cell centres. */
function phoneSnapshot() {
  const W = innerWidth, H = innerHeight;
  const g = graphOf(s);
  const v = new THREE.Vector3();
  const px = (x: number, z: number): [number, number] => {
    v.set(x, 0, z).project(camera);
    return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
  };
  const cells: { index: number; x: number; y: number; r: number; d: number; world: { x: number; z: number } }[] = [];
  g.ring.forEach((_, i) => {
    if (!isActive(s, i)) return;
    const { c, corner } = board.cellWorld(i);
    const [x, y] = px(c[0], c[1]);
    if (x < 0 || y < 0 || x > W || y > H) return;
    const [cx, cy] = px(corner[0], corner[1]);
    cells.push({
      index: i, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10,
      r: Math.round(Math.hypot(cx - x, cy - y) * 10) / 10, d: Math.hypot(x - W / 2, y - H / 2),
      world: { x: c[0], z: c[1] },
    });
  });
  cells.sort((a, b) => a.d - b.d);
  return {
    view: board.viewMatrix(),
    zoom: camera.position.distanceTo(controls.target),
    selectedCell: tap.selected >= 0 ? tap.selected : null,
    occupiedCount: s.tiles.filter((t) => t !== null).length,
    visibleCells: cells.slice(0, 64).map(({ index, x, y, r, world }) => ({ index, x, y, r, world })),
  };
}

if (dev) {
  const game = {
    get s() { return s; }, Decimal, TILE_TYPES, renderQuality: getQuality,
    // QA hooks for deterministic effect screenshots (dev flag only; FX only, never economy)
    fxStats: () => fx.stats(),
    /** Seeds the FX PRNG: the same seed and dt sequence give the same frames. */
    seedFx: (n: number) => fx.seed(n),
    /** Fires one FX through the real paths. Returns false for an unknown kind, or when no bridge route exists. */
    triggerFx: (kind: string, i = 0): boolean => {
      if (kind === 'place') {
        fx.placement(i, TILE_IDENTITIES[s.tiles[i] ?? 'spring'].emissive);
        board.markPlaced(i, fx.now);
      } else if (kind === 'sell') fx.sell(i, emissiveOf(s.tiles[i]));
      else if (kind === 'survey') revealRings(s.ring - 1, s.ring);
      else if (kind === 'aura') fx.beaconAura(i);
      else if (kind === 'bridge') {
        // a real boost route with at least one bridge in it; beaconAura fires it with the relay glints
        const r = routes.find((x) => x.kind === 'boost' && x.nodes.length > 2);
        if (!r) return false;
        fx.beaconAura(r.nodes[0]);
      } else if (kind === 'drift' || kind === 'projection') {
        // out now; the in half is queued for the midpoint, so the timeline matches a real transition
        const total = transitionTotal(reduced.matches), rm = reduced.matches;
        fx.prestige(kind, 'out', total, rm);
        qaSwap = { kind, at: fx.now + total / 2, total, reduced: rm };
      } else return false;
      return true;
    },
  };
  if (qa) {
    const setTutorial = (t: TutorialState) => (store.set(TUTORIAL_KEY, serializeTutorial(t)), ui.qa.reloadTutorial());
    const qaApi = {
      ...ui.qa,
      ready: false,
      /** Replaces the save through the import path (board rebuilds). Tutorial is hidden except for 'fresh'. */
      seed: (name: QaSeed) => {
        applyImport(fixture(name));
        setTutorial(name === 'fresh' ? freshTutorial() : dismissTutorial(freshTutorial()));
      },
      tutorial: (step: number) => setTutorial({ step, dismissed: false, done: false }),
      dismissTutorial: () => setTutorial(dismissTutorial(parseTutorial(store.get(TUTORIAL_KEY), s))),
      validSaveString: () => exportString(makeSave(fixture('midgame'), SAVE_FIXED_AT)),
      showOffline: () => ui.showOffline({ seconds: 3600, ink: new Decimal(12345), drifts: 1, eff: 0.5 }),
      quality: (n: number) => setQuality(n as QualityLevel),
      /** Read-only: view matrix, camera zoom (orbit distance), previewed cell, occupied count, visible cells. */
      phoneSnapshot,
      /**
       * Real GPU draw calls: composer.render with the FX group hidden, then shown, counted by renderer.info. Visibility,
       * autoReset and the info counters are restored in finally. fxDraws is the FX share (1 when FX is in the frame).
       */
      fxDrawProbe: () => {
        const info = renderer.info, autoReset = info.autoReset, visible = fx.group.visible;
        const saved = { ...info.render };
        const draws = (show: boolean) => {
          fx.group.visible = show;
          info.reset();
          composer.render(0);
          return info.render.calls;
        };
        info.autoReset = false;
        try {
          const without = draws(false), withFx = draws(true);
          return { without, withFx, fxDraws: withFx - without };
        } finally {
          fx.group.visible = visible;
          info.autoReset = autoReset;
          Object.assign(info.render, saved);
        }
      },
      /** Read-only: cached free rect, the board's embedding revision and the revision FX last uploaded (pan-attachment checks). */
      frameStats: () => ({ free: { ...free }, embedRev: board.embed.rev, fxEmbedRev: fx.stats().embedRev }),
      /** Fixture: previews an active cell the way a first touch tap does (no purchase). False if not active. */
      focusCell: (i: number): boolean => {
        if (!Number.isInteger(i) || i < 0 || i >= graphOf(s).ring.length || !isActive(s, i)) return false;
        tap.selected = i;
        ui.update();
        return true;
      },
    };
    Object.assign(game, { qa: qaApi });
    requestAnimationFrame(() => (qaApi.ready = true)); // first frame has run and the UI exists
  }
  Object.assign(window, { game });
}
