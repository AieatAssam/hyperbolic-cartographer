import * as THREE from 'three';
import Decimal from 'break_eternity.js';
import { config } from './core/config';
import { initialState, graphOf, GRAPHS, SURFACE_GRAPHS, type GameState, type SurfacePreview } from './core/state';
import { adjacency, buyChartUpg, buyCurvUpg, isActive, maxRing, mods, place, prod, previewDelta, sell, sellValue, survey, tileCost, togglePin } from './core/economy';
import {
  applyConstellationRewards,
  detectMatches,
  eventsAfterPlace,
  hintIfPlace,
  networkLinkEdges,
} from './core/constellations';
import { playChime } from './ui/chime';
import { placementImpactState, tileInfluenceState } from './core/placement-impact';
import type { TileGraph } from './core/geometry/graph';
import type { SquareBoard } from './core/geometry/square';
import { canDrift, canProject, drift, project } from './core/prestige';
import { applyOffline, simulate } from './core/tick';
import { exportString, importSave, makeSave, toJson } from './core/save';
import { TILE_INFO, TILE_TYPES, type TileType } from './core/tiles';
import { createScene, type QualityLevel } from './render/scene';
import { Board } from './render/board';
import { SurfaceBoard } from './render/surface-board';
import {
  cellCorners, fitDistance, freeRect, phonePortrait, shouldReframe, type Rect, type Role,
} from './render/framing';
import {
  fitManifoldProjected, checkManifoldProjectFit, kleinImmersionTargetY, manifoldFitPolar,
  measureTorusLandscapeBox, resetManifoldFitFov,
} from './render/manifold-camera-fit';
import { kleinCameraOffset } from './render/surface-params';
import { CartographyFX, type FxContext, type FxQuality } from './render/fx';
import { analyseCanvasPixels } from './render/canvas-check';
import type { BoardHighlight } from './render/board-highlight';
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
const { renderer, scene, camera, controls, composer, renderFrame, getQuality, setQuality } = createScene(canvas, { preserveDrawingBuffer: qa });
const fx = new CartographyFX(getQuality().level as FxQuality);
scene.add(fx.group);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let inkTarget: [number, number] = [0, 0.92]; // HUD Ink counter centre in NDC, cached in layoutView
type GameBoard = Board | SurfaceBoard;
const surfaceParam = new URLSearchParams(location.search).get('surface');
let manifoldPreview: SurfacePreview =
  surfaceParam === 'torus' || surfaceParam === 'klein' ? surfaceParam : 'off';
/** Local tile placement state for the Manifold preview (not saved, no Ink economy). */
let manifoldTiles: (TileType | null)[] | null = null;
let board: GameBoard;
const isSurfaceBoard = (b: GameBoard): b is SurfaceBoard => 'surface' in b;
const activeGraph = (): TileGraph =>
  manifoldPreview !== 'off' ? SURFACE_GRAPHS[manifoldPreview] : graphOf(s);
const renderState = (): GameState =>
  manifoldTiles ? { ...s, tiles: manifoldTiles, ring: 99 } : s;
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
const POLAR = Math.atan2(config.camera.polarY, config.camera.polarZ);
const MARGIN = config.camera.margin;
const boardFill = () => config.camera.phoneFill;
let free: Rect = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
let fitD = 0; // distance that fits the current footprint into `free` (0 = not yet framed)
let layoutDirty = true;
/** Playable cells plus ~one cell margin; decorative table / rim may extend past the screen. */
/** Half-tile (0.45) + half-cell margin on the square grid. */
const PLAYABLE_FRAME_MARGIN = 1.02;

function footprint(): [number, number][] {
  if (manifoldPreview !== 'off' && board && isSurfaceBoard(board)) return board.bounds();
  const g = graphOf(s);
  if (s.geometry === 'square') {
    const sq = g as SquareBoard;
    const h = PLAYABLE_FRAME_MARGIN + Math.max(0, s.ring - 1) * 0.1;
    return cellCorners(sq.xy.filter((_, i) => isActive(s, i)), h);
  }
  const pts: [number, number][] = [];
  for (let i = 0; i < g.ring.length; i++) {
    if (!isActive(s, i)) continue;
    const { c, corner } = board.cellWorld(i);
    const [cx, cz] = c;
    const dx = corner[0] - cx, dz = corner[1] - cz;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    const px = -uz, pz = ux;
    const pad = 0.45 * PLAYABLE_FRAME_MARGIN;
    const r = len + pad;
    pts.push(
      [cx + ux * r, cz + uz * r],
      [cx - ux * r, cz - uz * r],
      [cx + px * r, cz + pz * r],
      [cx - px * r, cz - pz * r],
    );
  }
  return pts;
}
const solveFit = () => {
  if (manifoldPreview !== 'off' && board && isSurfaceBoard(board) && !board.isChartFlat()) {
    const polar = board.surface === 'torus' ? config.manifold.torusImmersionPolar : 0;
    return fitManifoldProjected(board, camera, controls.target, free, innerWidth, innerHeight, polar, manifoldAz);
  }
  const W = innerWidth, H = innerHeight;
  const portrait = manifoldPreview === 'off' && phonePortrait(W, H);
  const margin = manifoldPreview !== 'off' ? config.manifold.frameMargin : (portrait ? MARGIN + 3 : MARGIN);
  const portraitWidthFirst = portrait;
  return fitDistance({
    pts: footprint(), W, H, free, fov: camera.fov, polar: POLAR, margin, portraitWidthFirst,
  });
};
/** Reads overlay rects (only when dirty) and shifts the projection via setViewOffset so the target sits at the
 *  free rect's centre. Raycasts stay exact: setFromCamera uses the offset projection and NDC spans the canvas.
 *  If already framed, rescales the current orbit distance by the new/old fit ratio (keeps the user's angle). */
function layoutView() {
  layoutDirty = false;
  const W = innerWidth, H = innerHeight;
  const overlays = [...document.querySelectorAll<HTMLElement>('#ui .hud, #ui .panel, #ui .dock, #ui .manifold-bar')].map((el) => ({
    role: (el.classList.contains('hud') ? 'hud'
      : (el.classList.contains('dock') || el.classList.contains('manifold-bar')) ? 'dock' : 'panel') as Role,
    rect: el.getBoundingClientRect(),
  }));
  free = freeRect(overlays, W, H);
  const ink = document.querySelector<HTMLElement>('[data-fx-target="ink"]')?.getBoundingClientRect();
  if (ink && ink.width > 0) inkTarget = [((ink.left + ink.width / 2) / W) * 2 - 1, 1 - ((ink.top + ink.height / 2) / H) * 2];
  camera.setViewOffset(W, H, W / 2 - (free.left + free.right) / 2, H / 2 - (free.top + free.bottom) / 2, W, H);
  camera.updateProjectionMatrix();
  const manifold3d = manifoldPreview !== 'off' && board && isSurfaceBoard(board) && !board.isChartFlat();
  const d = solveFit();
  if (fitD > 0 && !manifold3d) setDistance(camera.position.distanceTo(controls.target) * (d / fitD));
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
const observeUI = () => document.querySelectorAll('#ui .hud, #ui .panel, #ui .dock, #ui .manifold-bar').forEach((el) => ro.observe(el));
new MutationObserver(() => ((layoutDirty = true), observeUI())).observe(document.getElementById('ui')!, { childList: true });

let manifoldAz = Math.PI * 0.32;
let manifoldSpinOn = false;
let kleinSpinPhase = 0;
/** Full refit: default tilt, target at origin, distance solved from the footprint (initial UI, geometry, recenter). */
const frameCamera = () => frameBoardCamera(POLAR, 0, boardFill());
const frameBoardCamera = (polar = POLAR, azimuth = 0, fill = 1) => {
  const chart = isSurfaceBoard(board) && board.isChartFlat();
  const klein3d = isSurfaceBoard(board) && board.surface === 'klein' && !board.isChartFlat();
  const tY = chart ? 0 : isSurfaceBoard(board) && board.surface === 'torus' ? 0.1 : klein3d ? kleinImmersionTargetY() : 0;
  controls.target.set(0, tY, 0);
  if (layoutDirty) layoutView();
  const margin = manifoldPreview !== 'off' ? config.manifold.frameMargin : MARGIN;
  const surf = isSurfaceBoard(board) ? board : null;
  const useProjected = manifoldPreview !== 'off' && surf && !surf.isChartFlat();
  let fitPolar = polar;
  if (useProjected && surf) {
    fitD = fitManifoldProjected(surf, camera, controls.target, free, innerWidth, innerHeight, polar, azimuth);
    fitPolar = manifoldFitPolar(surf.surface, surf.isChartFlat(), polar, innerWidth, innerHeight);
  } else {
    const W = innerWidth, H = innerHeight;
    const portraitWidthFirst = manifoldPreview === 'off' && phonePortrait(W, H);
    fitD = fitDistance({
      pts: footprint(), W, H, free, fov: camera.fov, polar, margin, portraitWidthFirst,
    }) / Math.max(1, Math.min(1.08, fill));
  }
  controls.maxDistance = Math.max(40, fitD * 1.5);
  if (klein3d) {
    const [ox, oy, oz] = kleinCameraOffset(fitD);
    camera.position.set(controls.target.x + ox, controls.target.y + oy, controls.target.z + oz);
  } else {
    const cp = Math.cos(useProjected ? fitPolar : polar);
    camera.position.set(
      controls.target.x + Math.sin(azimuth) * cp * fitD,
      controls.target.y + cp * fitD,
      controls.target.z + Math.cos(azimuth) * cp * fitD,
    );
  }
  camera.lookAt(controls.target);
  const W = innerWidth, H = innerHeight;
  camera.setViewOffset(W, H, W / 2 - (free.left + free.right) / 2, H / 2 - (free.top + free.bottom) / 2, W, H);
  camera.updateProjectionMatrix();
};
const applyManifoldCamera = () => {
  if (!isSurfaceBoard(board)) return frameCamera();
  if (board.isChartFlat()) return frameBoardCamera(config.manifold.chartPolar, 0, config.manifold.chartFill);
  const polar = board.surface === 'torus' ? config.manifold.torusImmersionPolar : 0;
  frameBoardCamera(polar, manifoldAz, 1);
};
function seedManifoldDemo(which: 'torus' | 'klein') {
  const g = SURFACE_GRAPHS[which];
  manifoldTiles = g.ring.map(() => null);
  if (which === 'torus') {
    const loop = g.cycleBasis[0];
    for (let k = 0; k < loop.length - 1; k++) manifoldTiles[loop[k]] = k % 2 === 0 ? 'spring' : 'mill';
  } else {
    for (let i = 0; i < g.ring.length; i++) {
      const [x] = g.xy[i];
      if (x === 0) manifoldTiles[i] = 'spring';
      if (x === g.width - 1) manifoldTiles[i] = 'mill';
    }
    const origin = g.xy.findIndex(([x, y]) => x === 0 && y === 0);
    if (origin >= 0) {
      manifoldTiles[origin] = 'spring';
      const across = g.neighbours[origin].find((j) => g.xy[j][0] === g.width - 1);
      if (across !== undefined) manifoldTiles[across] = 'mill';
    }
  }
}
/** Keeps ?surface= in sync without a document navigation (layout QA clicks must not wait on load). */
function replaceSurfaceQuery(which: SurfacePreview) {
  const params = new URLSearchParams(location.search);
  if (which === 'off') params.delete('surface');
  else params.set('surface', which);
  const q = params.toString();
  const next = `${location.pathname}${q ? `?${q}` : ''}${location.hash}`;
  const cur = `${location.pathname}${location.search}${location.hash}`;
  if (next !== cur) history.replaceState(history.state, '', next);
}
function scheduleKleinImmersionReadyMark() {
  if (!qa) return;
  renderFrame(0);
  requestAnimationFrame(() => {
    renderFrame(0);
    const on = isSurfaceBoard(board) && board.surface === 'klein' && board.immersion3d;
    document.documentElement.dataset.qaKleinImmersionReady = on ? '1' : '0';
  });
}
function enterManifoldPreview(which: 'torus' | 'klein') {
  manifoldPreview = which;
  seedManifoldDemo(which);
  syncBoard(true);
  controls.enableRotate = true;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  ui.setManifoldPreview(true, which);
  manifoldSpinOn = true;
  kleinSpinPhase = 0;
  manifoldAz = which === 'klein' ? config.manifold.kleinImmersionAzimuth : Math.PI * 0.32;
  if (which === 'klein' && isSurfaceBoard(board)) board.group.rotation.y = 0;
  layoutDirty = true;
  applyManifoldCamera();
  if (isSurfaceBoard(board)) board.update(renderState(), [], -1, []);
  replaceSurfaceQuery(which);
  if (which === 'klein') scheduleKleinImmersionReadyMark();
}
function exitManifoldPreview() {
  manifoldPreview = 'off';
  manifoldTiles = null;
  manifoldSpinOn = false;
  syncBoard(true);
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.enablePan = s.geometry === 'square';
  ui.setManifoldPreview(false);
  layoutDirty = true;
  frameCamera();
  replaceSurfaceQuery('off');
  resetManifoldFitFov(camera);
  if (qa) delete document.documentElement.dataset.qaKleinImmersionReady;
}
/** `full` (imports, resets) kills every FX instance; the transition swap passes false and calls fx.clearAnchored itself. */
function syncBoard(full = true) {
  if (full) (fx.clear(), fx.setAnchorFade(1));
  const wantSurface = manifoldPreview !== 'off';
  if (!wantSurface && board && !isSurfaceBoard(board) && board.geometry === s.geometry) return;
  if (wantSurface && board && isSurfaceBoard(board) && board.surface === manifoldPreview) return;
  if (board) {
    scene.remove(board.group);
    board.dispose();
  }
  if (wantSurface) {
    board = new SurfaceBoard(manifoldPreview as 'torus' | 'klein', SURFACE_GRAPHS[manifoldPreview as 'torus' | 'klein'], scene.environment);
  } else {
    board = new Board(s.geometry, scene.environment);
  }
  tap.clearSelection();
  prevTiles = (manifoldTiles ?? s.tiles).slice();
  scene.add(board.group);
  controls.enablePan = !wantSurface && s.geometry === 'square';
  if (!wantSurface) frameCamera();
}
syncBoard();

// ---- actions ----
let speed = 1;
const tool: { current: Tool } = { current: 'spring' };
/** Applies the current tool to cell i; toasts the reason and returns false when it can't. */
function applyTool(i: number): boolean {
  if (trans) return false;
  const tl = tool.current;
  if (manifoldTiles) {
    if (tl === 'sell') manifoldTiles[i] = null;
    else if (tl !== 'pin') manifoldTiles[i] = tl;
    return true;
  }
  const why = placeBlocked(s, i, tl);
  if (why) return ui.toast(why), false;
  const delta = tl === 'sell' || tl === 'pin' ? 0 : previewDelta(s, i, tl);
  if (tl === 'sell') return sell(s, i);
  if (tl === 'pin') return togglePin(s, i);
  const before = s.tiles.slice();
  if (!place(s, i, tl)) return false;
  const g = graphOf(s);
  const links = networkLinkEdges(g, before, s.tiles, i);
  if (links?.length) {
    fx.networkLink(links);
    playChime('link');
    if (delta >= 4) ui.toast(`Network linked! +${fmt(delta, s.notation)} Ink/s`);
  } else if (delta >= 4) ui.toast(delta >= 25 ? `Network linked! +${fmt(delta, s.notation)} Ink/s` : `+${fmt(delta, s.notation)} Ink/s`);
  const events = eventsAfterPlace(s, before, i, tl);
  if (events.length) {
    applyConstellationRewards(s, events);
    for (const e of events) {
      ui.toast(`★ ${e.name} — +${fmt(e.bonusInk, s.notation)} Ink & pattern bonus`);
      constellationBurstEdges = e.edges;
      constellationPermanent = mergeEdges(constellationPermanent, e.edges);
      constellationPulseUntil = performance.now() / 1000 + 1.5;
      fx.celebrateConstellation(e.cells);
      playChime('constellation');
    }
  }
  return true;
}
const ui = createUI(document.getElementById('ui')!, {
  state: () => s,
  tool,
  dev,
  selected: () => tap.selected,
  boardFocus: () => {
    if (inspectCell >= 0) return inspectCell;
    if (tap.selected >= 0) return tap.selected;
    if (qaHover >= 0) return qaHover;
    return hover;
  },
  inspectCell: () => inspectCell,
  cellInfo: (i) => cellHtml(i),
  cellScreenPos: (i) => {
    if (i < 0 || isSurfaceBoard(board)) return null;
    const { c } = board.cellWorld(i);
    const v = new THREE.Vector3(c[0], 0.6, c[1]).project(camera);
    const W = innerWidth;
    const H = innerHeight;
    if (v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
  },
  bridgePreviewDelta: () => {
    const i = tap.selected >= 0 ? tap.selected : qaHover >= 0 ? qaHover : hover >= 0 ? hover : -1;
    if (i < 0 || tool.current !== 'bridge' || s.tiles[i]) return null;
    const d = previewDelta(s, i, 'bridge');
    return d > 0 ? d : null;
  },
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
      if (!trans && tap.selected >= 0 && s.geometry === 'hyper' && !isSurfaceBoard(board)) board.centreOn(tap.selected);
    },
    enterManifoldPreview,
    exitManifoldPreview,
    toggleSurfaceChart: () => {
      if (!isSurfaceBoard(board)) return;
      board.chartMode = !board.chartMode;
      board.invalidate();
      layoutDirty = true;
      applyManifoldCamera();
    },
    toggleSeamView: () => {
      if (isSurfaceBoard(board)) (board.seamView = !board.seamView, board.invalidate());
    },
    toggleKleinImmersion: () => {
      if (!isSurfaceBoard(board) || board.surface !== 'klein') return;
      board.immersion3d = !board.immersion3d;
      board.invalidate();
      manifoldSpinOn = board.immersion3d;
      layoutDirty = true;
      applyManifoldCamera();
      ui.update();
      scheduleKleinImmersionReadyMark();
    },
    switchManifold: (which: 'torus' | 'klein') => enterManifoldPreview(which),
    manifoldPreview: () => manifoldPreview,
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
  ui.setTransition(
    kind === 'drift' ? 'Drifting: the ink washes the old map away…' : 'Projecting: the square map folds into the hyperbolic disk…',
    kind === 'drift' ? 'Drift' : 'Project',
    kind === 'drift' ? 'drift' : 'project',
  );
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
    tops: board.tops, tiles: manifoldTiles ?? s.tiles, perTile, quality: getQuality().level as FxQuality, inkTargetNdc: inkTarget,
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
  const rs = renderState();
  const geomOk = !isSurfaceBoard(board) && s.geometry === board.geometry;
  if (s.ring > prevRing && geomOk) revealRings(prevRing, s.ring), n++;
  prevRing = s.ring;
  const now = fx.now;
  for (let i = 0; i < rs.tiles.length; i++) {
    const a = prevTiles[i], b = rs.tiles[i];
    if (a === b) continue;
    if (n < MAX_FX_EVENTS) {
      if (b) fx.placement(i, TILE_IDENTITIES[b].emissive), board.markPlaced(i, now);
      else fx.sell(i, emissiveOf(a)); // the sold type's colour, read from the previous tiles
      n++;
    } else if (b) board.markPlaced(i, now); // squash is free; particles are capped
  }
  prevTiles = rs.tiles.slice();
}
observeUI();
layoutDirty = true;
frameCamera();
if (manifoldPreview !== 'off') enterManifoldPreview(manifoldPreview);

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
let qaHover = -1; // layout/capture hook; cleared on pointer move
let panFrom: THREE.Vector3 | null = null; // hyperbolic one-pointer pan anchor
const PLACE_TOOLS = new Set<TileType>(['spring', 'mill', 'beacon', 'bridge', 'vault']);
const isPlaceTool = (t: Tool): t is TileType => PLACE_TOOLS.has(t as TileType);
let inspectCell = -1;
let inspectBlend = 0;
let inspectTarget = 0;
let bridgePulse = 0;
let constellationPulseUntil = 0;
let constellationBurstEdges: [number, number][] = [];
let constellationPermanent: [number, number][] = [];
let lastDriftCount = 0;
const edgeKey = ([a, b]: [number, number]) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const mergeEdges = (base: [number, number][], add: [number, number][]) => {
  const seen = new Set(base.map(edgeKey));
  const out = base.slice();
  for (const e of add) {
    const k = edgeKey(e);
    if (!seen.has(k)) (seen.add(k), out.push(e));
  }
  return out;
};

function bridgeArcEnds(g: TileGraph, tiles: (TileType | null)[], i: number): [number, number] | null {
  const nb = g.neighbours[i];
  if (nb.length < 2) return null;
  const occ = nb.filter((n) => tiles[n]);
  if (occ.length >= 2) return [occ[0], occ[1]];
  return [nb[0], nb[1]];
}

function tryInspect(cell: number): boolean {
  if (cell < 0 || !s.tiles[cell]) return false;
  if (tool.current === 'sell' || tool.current === 'pin') return false;
  if (inspectCell === cell) {
    inspectCell = -1;
    inspectTarget = 0;
  } else {
    inspectCell = cell;
    inspectTarget = 1;
    tap.clearSelection();
    hover = -1;
  }
  return true;
}

/** Cell description for the hover tooltip (mouse) and the preview card (touch). */
function cellHtml(i: number): string {
  const t = s.tiles[i], tl = tool.current;
  const lead = (s: string) => `<div class="info-lead"><b>${s}</b></div>`;
  const meta = (s: string) => `<div class="info-meta">${s}</div>`;
  const effect = (s: string) => `<div class="info-effect">${s}</div>`;
  const note = (s: string) => `<div class="info-note muted">${s}</div>`;
  if (!isActive(s, i)) {
    return `${lead('Unsurveyed')}${note(`Survey ring ${graphOf(s).ring[i]} to open this cell.`)}`;
  }
  const why = placeBlocked(s, i, tl);
  const whyHtml = why ? `<div class="info-note neg">${why}</div>` : '';
  const delta = (d: number) => `<span class="${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '+' : '−'}${fmt(Math.abs(d), s.notation)} Ink/s</span>`;
  const nb = graphOf(s).neighbours[i].length;
  if (!t) {
    if (tl === 'sell' || tl === 'pin') return `${meta(`Empty cell · ${nb} neighbours`)}${whyHtml}`;
    const cost = tileCost(s, tl);
    const dInk = previewDelta(s, i, tl);
    let fx = delta(dInk);
    if (tl === 'bridge') {
      const d = previewDelta(s, i, 'bridge');
      if (d > 0) fx += `<br><span class="pos">+${fmt(d, s.notation)} Ink/s via new links</span>`;
    }
    const hint = hintIfPlace(s, i, tl);
    const hintHtml = hint ? `<div class="info-note pos">★ Completes ${config.constellations[hint.id].name}</div>` : '';
    return `${lead(`Place ${TILE_INFO[tl].name}`)}${meta(`${fmt(cost, s.notation)} Ink · ${nb} neighbours`)}${effect(fx)}${hintHtml}${whyHtml}`;
  }
  const out = prod(s).perTile[i];
  const title = `${TILE_INFO[t].name}${s.pinned.includes(i) ? ' · pinned' : ''}`;
  let html = `${lead(title)}${effect(out ? `${fmt(out, s.notation)} Ink/s` : TILE_INFO[t].desc)}`;
  if (tl === 'sell') {
    html += `${meta(`Sell for ${fmt(sellValue(s, t), s.notation)} Ink`)}${effect(delta(previewDelta(s, i, null)))}`;
  } else if (tl === 'pin') {
    html += note(s.pinned.includes(i) ? 'Unpin: Drift may remove this tile.' : 'Pin: kept through Drift.');
  } else {
    html += note('Tap again to inspect · Sell (S) to remove');
  }
  return html + whyHtml;
}

const pickAt = (x: number, y: number) => {
  const w = worldAt(x, y);
  return w ? board.pick(w.x, w.z, renderState()) : -1;
};
const kindOf = (e: PointerEvent): PointerKind => (e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse');
const endPointer = () => {
  if (tap.active === 0) panFrom = null;
};
// Mouse: click applies at once (hover already previewed). Touch/pen: first tap previews, a second tap on the
// same cell (or the Place button) confirms. Drags, pinches and cancelled pointers never place.
canvas.addEventListener('pointerdown', (e) => {
  if (manifoldPreview !== 'off') manifoldSpinOn = false;
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
  if (a.kind === 'deselect') {
    inspectCell = -1;
    inspectTarget = 0;
  }
  if ((a.kind === 'apply' || a.kind === 'select') && tryInspect(a.cell)) {
    ui.update();
    return;
  }
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
  qaHover = -1;
  if (tap.move(e.pointerId, e.clientX, e.clientY) && s.geometry === 'hyper' && panFrom && !isSurfaceBoard(board)) {
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

  if (s.drifts !== lastDriftCount) {
    lastDriftCount = s.drifts;
    constellationPermanent = [];
    constellationBurstEdges = [];
    constellationPulseUntil = 0;
  }
  if (s.ring !== lastRing) (lastRing = s.ring), (layoutDirty = true);
  if (shouldReframe(layoutDirty, tap.selected)) layoutView(); // a previewed touch cell holds the board still
  if (!isSurfaceBoard(board) && board.geometry !== s.geometry) return renderFrame(dt);
  const rs = renderState();
  const p = prod(s), g = activeGraph(), reach = mods(s).reach;
  const tiles = rs.tiles;
  const rKey = `${manifoldPreview}|${s.geometry}|${rs.ring}|${reach}|${tiles.join()}`;
  if (rKey !== routeKey) (routeKey = rKey), (routes = productionRoutes(g, tiles, reach));
  const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fadeStep = reduceMotion ? 1 : Math.min(1, dt * 1000 / config.ui.inspectFadeMs);
  inspectBlend += (inspectTarget - inspectBlend) * fadeStep;
  if (inspectTarget === 0 && inspectBlend < 0.02) inspectBlend = 0;
  bridgePulse = (bridgePulse + dt * 0.65) % 1;

  const focus = inspectCell >= 0 ? inspectCell : qaHover >= 0 ? qaHover : hover >= 0 ? hover : tap.selected;
  let hoverAdj: number[] = [];
  const hl: BoardHighlight = {};
  if (inspectCell >= 0 && inspectBlend > 0) {
    hl.lit = tileInfluenceState(s, inspectCell);
    hl.dim = inspectBlend;
  } else if (focus >= 0 && !tiles[focus] && isPlaceTool(tool.current)) {
    const imp = placementImpactState(s, focus, tool.current);
    hoverAdj = imp.direct;
    hl.direct = imp.direct;
    hl.bridge = imp.viaBridge;
    hl.pulse = bridgePulse;
    if (tool.current === 'bridge') {
      const arc = bridgeArcEnds(g, tiles, focus);
      if (arc) hl.arc = arc;
    }
    const hint = hintIfPlace(s, focus, tool.current);
    if (hint) hl.constellationGhost = hint.edges;
  } else if (focus >= 0) {
    hoverAdj = tiles[focus] ? adjacency(g, tiles, focus, reach) : g.neighbours[focus];
  }
  const nowSec = now / 1000;
  if (constellationPermanent.length) hl.constellationPermanent = constellationPermanent;
  if (constellationPulseUntil > nowSec && constellationBurstEdges.length) {
    const pulse = Math.min(1, Math.max(0, (constellationPulseUntil - nowSec) / 1.5));
    hl.constellationPulse = pulse;
    hl.constellation = constellationBurstEdges;
  }
  const perTile = manifoldTiles
    ? tiles.map((t) => (t === 'mill' ? config.manifold.demoMillOut : t === 'spring' ? 1 : 0))
    : p.perTile;
  board.update(rs, perTile, focus, hoverAdj, hl);
  if (!isSurfaceBoard(board)) board.overlayConstellations(hl);
  // prepare binds the new board's embedding before any spawn; update then advances time once
  const ctx = fxContext(perTile, routes);
  fx.prepare(ctx);
  flushDeferred();
  if (!locked) diffFx();
  fx.update(dt, ctx);
  board.tick(fx.now, reduced.matches);
  if (manifoldSpinOn && isSurfaceBoard(board) && !board.isChartFlat()) {
    if (board.surface === 'klein' && board.immersion3d) {
      kleinSpinPhase += dt * config.manifold.idleSpin;
      board.group.rotation.y = Math.sin(kleinSpinPhase) * config.manifold.kleinSpinSway;
    } else {
      board.group.rotation.y += dt * config.manifold.idleSpin;
    }
  }
  controls.update();
  renderFrame(dt);
  if (tool.current === 'bridge' || constellationPulseUntil > now / 1000) ui.syncBridgeGain();
  if ((uiAcc += dt) > 0.1) (uiAcc = 0), ui.update();
}
requestAnimationFrame(frame);

// ---- QA fixtures (?dev&qa only): deterministic states, no randomness ----
type QaSeed =
  | 'fresh'
  | 'midgame'
  | 'drift-ready'
  | 'projection-ready'
  | 'hyper'
  | 'ux-demo'
  | 'constellation-demo'
  | 'network-demo'
  | 'bridge-gain';
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
  } else if (name === 'bridge-gain') {
    g.ring = 3;
    Object.assign(g, { ink: d(8e4), runInk: d(5e5), totalTime: 400, runTime: 400 });
    g.tiles[0] = 'mill';
    g.tiles[1] = 'spring';
    g.tiles[4] = 'mill';
    g.tiles[5] = 'spring';
    const graph = graphOf(g);
    for (let i = 0; i < g.tiles.length; i++) {
      if (!isActive(g, i) || g.tiles[i]) continue;
      const occ = graph.neighbours[i].filter((n) => g.tiles[n]);
      if (occ.length >= 2 && previewDelta(g, i, 'bridge') > 0) break;
    }
  } else if (name === 'network-demo') {
    g.ring = 2;
    Object.assign(g, { ink: d(500), runInk: d(100), totalTime: 60, runTime: 60 });
    g.tiles[0] = 'spring';
    g.tiles[7] = 'spring';
  } else if (name === 'constellation-demo') {
    g.ring = 2;
    Object.assign(g, { ink: d(800), runInk: d(1e4), lifetimeInk: d(1e4), runTime: 120, totalTime: 120 });
    const graph = graphOf(g);
    g.tiles[0] = 'spring';
    g.tiles[1] = 'spring';
    const third = graph.neighbours[0].find((n) => graph.neighbours[1].includes(n) && n !== 0 && n !== 1);
    if (third !== undefined) g.tiles[third] = null;
  } else if (name === 'ux-demo') {
    g.ring = 3;
    Object.assign(g, {
      ink: d(4e4), runInk: d(2.5e6), lifetimeInk: d(5e6), runTime: 1200, totalTime: 3600, drifts: 0, projections: 0,
    });
    sprinkle(g, 4);
    const graph = graphOf(g);
    for (let i = 0; i < g.tiles.length; i++) {
      if (!isActive(g, i) || g.tiles[i]) continue;
      const occ = graph.neighbours[i].filter((n) => g.tiles[n]);
      if (occ.length >= 2) {
        g.tiles[i] = 'bridge';
        break;
      }
    }
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
        setTutorial(
          name === 'fresh'
            ? freshTutorial()
            : { ...dismissTutorial(freshTutorial()), done: true },
        );
        ui.update();
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
      /** Hyper board only: centre the previewed cell without using the dock button (layout QA). */
      centreSelected: (): boolean => {
        if (trans || tap.selected < 0 || s.geometry !== 'hyper' || isSurfaceBoard(board)) return false;
        board.centreOn(tap.selected);
        ui.update();
        renderFrame(0);
        return true;
      },
      setTool: (name: TileType | 'sell' | 'pin') => {
        tool.current = name;
        tap.clearSelection();
        inspectCell = -1;
        inspectTarget = 0;
        ui.update();
      },
      manifold: (which: 'torus' | 'klein' | 'off') => {
        if (which === 'off') exitManifoldPreview();
        else enterManifoldPreview(which);
        ui.update();
      },
      /** Idempotent: Klein preview + immersion mesh on; sets qaKleinImmersionReady after a painted frame. */
      enterKleinImmersion: async () => {
        if (manifoldPreview !== 'klein') enterManifoldPreview('klein');
        if (!isSurfaceBoard(board) || board.surface !== 'klein') return { ok: false, reason: 'not-klein' };
        if (!board.immersion3d) {
          board.immersion3d = true;
          board.invalidate();
          manifoldSpinOn = true;
          layoutDirty = true;
          applyManifoldCamera();
          ui.update();
        }
        renderFrame(0);
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        renderFrame(0);
        if (qa) document.documentElement.dataset.qaKleinImmersionReady = '1';
        return { ok: board.immersion3d, immersion3d: board.immersion3d };
      },
      manifoldProjectFit: () => {
        if (!isSurfaceBoard(board) || board.isChartFlat()) return { ok: false, failures: ['not-3d'], fill: 0 };
        ui.update();
        layoutDirty = true;
        applyManifoldCamera();
        renderFrame(0);
        const polar = board.surface === 'torus' ? config.manifold.torusImmersionPolar : 0;
        const fitPolar = manifoldFitPolar(board.surface, board.isChartFlat(), polar, innerWidth, innerHeight);
        return checkManifoldProjectFit(board, camera, free, innerWidth, innerHeight, {
          target: controls.target,
          polar: fitPolar,
          azimuth: manifoldAz,
          distance: fitD,
        });
      },
      torusScreenBounds: () => {
        if (!isSurfaceBoard(board) || board.surface !== 'torus' || board.isChartFlat()) {
          return { ok: false, reason: 'not-torus-3d' };
        }
        layoutDirty = true;
        layoutView();
        renderFrame(0);
        return measureTorusLandscapeBox(board, camera, free, innerWidth, innerHeight);
      },
      playableFramingCheck: (marginPx = 8) => {
        if (isSurfaceBoard(board)) return { ok: false, reason: 'manifold-preview' };
        layoutDirty = true;
        layoutView();
        renderFrame(0);
        const W = innerWidth, H = innerHeight;
        const dock = document.querySelector<HTMLElement>('.dock')?.getBoundingClientRect();
        const panelTop = dock && dock.height > 0 ? dock.top : H;
        const g = graphOf(s);
        const v = new THREE.Vector3();
        const failures: string[] = [];
        let minX = Infinity, maxX = -Infinity;
        const project = (x: number, z: number) => {
          v.set(x, 0, z).project(camera);
          return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H] as const;
        };
        const cornersFor = (i: number) => {
          if (s.geometry === 'square') {
            const sq = g as SquareBoard;
            const [x, y] = sq.xy[i];
            const h = 0.48;
            return [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]] as [number, number][];
          }
          const { c, corner } = board.cellWorld(i);
          const [cx, cz] = c;
          const dx = corner[0] - cx, dz = corner[1] - cz;
          const len = Math.hypot(dx, dz) || 1;
          const ux = dx / len, uz = dz / len;
          const px = -uz, pz = ux;
          const h = len;
          return [
            [cx + ux * h, cz + uz * h], [cx - ux * h, cz - uz * h],
            [cx + px * h, cz + pz * h], [cx - px * h, cz - pz * h],
          ];
        };
        for (let i = 0; i < g.ring.length; i++) {
          if (!isActive(s, i)) continue;
          for (const [x, z] of cornersFor(i)) {
            const [px, py] = project(x, z);
            if (px < marginPx) failures.push(`cell ${i} clipped left (${px.toFixed(1)}px)`);
            if (px > W - marginPx) failures.push(`cell ${i} clipped right (${px.toFixed(1)}px)`);
            if (py < marginPx) failures.push(`cell ${i} clipped top (${py.toFixed(1)}px)`);
            if (py > panelTop - marginPx) failures.push(`cell ${i} below dock band (${py.toFixed(1)}px)`);
            minX = Math.min(minX, px);
            maxX = Math.max(maxX, px);
          }
        }
        const widthFill = Number.isFinite(minX) ? (maxX - minX) / W : 0;
        return { ok: failures.length === 0, failures: failures.slice(0, 6), widthFill };
      },
      manifoldStats: () => {
        if (!isSurfaceBoard(board)) return null;
        let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity, cnt = 0;
        for (const v of board.tops) {
          minx = Math.min(minx, v.x); maxx = Math.max(maxx, v.x);
          miny = Math.min(miny, v.y); maxy = Math.max(maxy, v.y);
          cnt++;
        }
        return {
          surface: board.surface, chartMode: board.chartMode, immersion3d: board.immersion3d, seamView: board.seamView,
          minx, maxx, miny, maxy, cnt,
        };
      },
      bridgeGainCell: () => {
        for (let i = 0; i < s.tiles.length; i++) {
          if (!isActive(s, i) || s.tiles[i]) continue;
          if (previewDelta(s, i, 'bridge') > 0) return i;
        }
        return -1;
      },
      networkLinkCell: () => {
        const g = graphOf(s);
        for (let i = 0; i < s.tiles.length; i++) {
          if (!isActive(s, i) || s.tiles[i]) continue;
          const before = s.tiles.slice();
          const after = before.slice();
          after[i] = 'spring';
          if (networkLinkEdges(g, before, after, i)?.length) return i;
        }
        return -1;
      },
      inkstreamHintCell: () => {
        for (let i = 0; i < s.tiles.length; i++) {
          if (!isActive(s, i) || s.tiles[i]) continue;
          if (hintIfPlace(s, i, 'spring')) return i;
        }
        return -1;
      },
      /** Completed + in-progress constellation overlays for captures/QA. */
      constellationCapture: () => {
        const g = graphOf(s);
        for (let j = 0; j < g.ring.length; j++) {
          if (!isActive(s, j)) continue;
          for (const a of g.neighbours[j]) {
            if (!isActive(s, a)) continue;
            for (const c of g.neighbours[j]) {
              if (c === a || !isActive(s, c)) continue;
              if (g.neighbours[a].includes(c)) continue;
              s.tiles[a] = 'spring';
              s.tiles[j] = 'spring';
              s.tiles[c] = 'spring';
              break;
            }
          }
        }
        let matches = detectMatches(g, s.tiles);
        constellationPermanent = matches[0]?.edges ?? [];
        let hintCell = -1;
        for (let m = 0; m < g.ring.length; m++) {
          if (!isActive(s, m) || s.tiles[m] !== 'mill') continue;
          const adj = g.neighbours[m].filter((i) => isActive(s, i) && !s.tiles[i]);
          if (adj.length < 1) continue;
          const springs = g.neighbours[m].filter((i) => s.tiles[i] === 'spring');
          if (springs.length >= 2) {
            constellationBurstEdges = springs.slice(0, 2).map((s0) => (s0 < m ? [s0, m] : [m, s0]));
            hintCell = adj[0]!;
            break;
          }
        }
        if (!constellationBurstEdges.length && matches.length > 1) {
          constellationBurstEdges = matches[1].edges;
        }
        constellationPulseUntil = performance.now() / 1000 + 120;
        if (hintCell >= 0) {
          tool.current = 'spring';
          tap.selected = hintCell;
          qaHover = hintCell;
        } else {
          for (let i = 0; i < s.tiles.length; i++) {
            if (!isActive(s, i) || s.tiles[i]) continue;
            if (hintIfPlace(s, i, 'spring')) {
              tool.current = 'spring';
              tap.selected = i;
              qaHover = i;
              hintCell = i;
              break;
            }
          }
        }
        matches = detectMatches(g, s.tiles);
        ui.update();
        renderFrame(0);
        return { permanent: constellationPermanent.length, pulse: constellationBurstEdges.length, hintCell, matches: matches.length };
      },
      placeAt: (i: number, tl: Tool) => {
        if (tl === 'sell' || tl === 'pin') return false;
        if (!isActive(s, i) || s.tiles[i]) return false;
        tool.current = tl as TileType;
        tap.selected = i;
        inspectCell = -1;
        qaHover = -1;
        const ok = applyTool(i);
        tap.clearSelection();
        ui.update();
        renderFrame(0);
        return ok;
      },
      demoCells: () => {
        const g = graphOf(s);
        const reach = mods(s).reach;
        let millAt = -1, millScore = 0;
        let bridgeAt = -1;
        let springAt = -1;
        let springLit = Infinity;
        for (let i = 0; i < s.tiles.length; i++) {
          const t = s.tiles[i];
          if (t === 'spring') {
            const lit = tileInfluenceState(s, i).length;
            if (lit < springLit) {
              springLit = lit;
              springAt = i;
            }
          }
          if (!isActive(s, i) || t) continue;
          const springs = adjacency(g, s.tiles, i, reach).filter((n) => s.tiles[n] === 'spring').length;
          if (springs > millScore) {
            millScore = springs;
            millAt = i;
          }
          const occ = g.neighbours[i].filter((n) => s.tiles[n]).length;
          if (occ >= 2 && bridgeAt < 0) bridgeAt = i;
        }
        return { millAt, bridgeAt, springAt };
      },
      previewAt: (i: number, tl: Tool) => {
        if (tl === 'sell' || tl === 'pin') return false;
        if (!isActive(s, i) || s.tiles[i]) return false;
        qaHover = i;
        tool.current = tl as TileType;
        inspectCell = -1;
        inspectTarget = 0;
        inspectBlend = 0;
        tap.clearSelection();
        ui.update();
        renderFrame(0);
        return true;
      },
      inspectAt: async (i: number) => {
        if (i < 0 || !s.tiles[i]) return false;
        qaHover = -1;
        hover = -1;
        inspectCell = i;
        inspectTarget = 1;
        inspectBlend = 1;
        tap.clearSelection();
        ui.update();
        renderFrame(0);
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        renderFrame(0);
        return true;
      },
      clearBoardFocus: () => {
        qaHover = -1;
        hover = -1;
        inspectCell = -1;
        inspectTarget = 0;
        inspectBlend = 0;
        tap.clearSelection();
        ui.update();
        return true;
      },
      canvasSample: () => {
        renderFrame(0);
        const c = canvas;
        const w = c.width, h = c.height;
        const gl = c.getContext('webgl2') || c.getContext('webgl');
        if (!gl || !(w > 0 && h > 0)) return { ok: false, mean: 0, chroma: 0, nonBackdrop: 0, reason: 'no-gl' };
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const flipped = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) {
          const src = (h - 1 - y) * w * 4;
          flipped.set(buf.subarray(src, src + w * 4), y * w * 4);
        }
        const s = analyseCanvasPixels(flipped, w, h);
        return { ...s, reason: s.ok ? 'ok' : 'blank' };
      },
    };
    Object.assign(game, { qa: qaApi });
    requestAnimationFrame(() => (qaApi.ready = true)); // first frame has run and the UI exists
  }
  Object.assign(window, { game });
}
