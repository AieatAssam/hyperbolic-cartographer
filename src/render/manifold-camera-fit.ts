/** Projected bounds fit for torus / Klein 3D manifold preview (uses Three.js project). */
import * as THREE from 'three';
import type { Rect } from './framing';
import type { SurfaceBoard } from './surface-board';
import {
  kleinBottleAabb, kleinCameraOffset, kleinImmersionPos, KLEIN_SCALE,
  torusFitAabb, torusPosFromUv,
} from './surface-params';
import { boxCorners } from './projected-fit';
import { config } from '../core/config';
import { phoneLandscape } from './framing';

export interface BoardScreenRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** Usable board = free rect inset by margin only (no fill shrink). */
export function boardRectInset(free: Rect, margin = config.manifold.frameMargin, W = 0, H = 0): BoardScreenRect {
  const m = Math.max(16, margin);
  const vInset = phoneLandscape(W, H) ? 8 : m;
  const left = free.left + m, right = free.right - m;
  const top = free.top + vInset, bottom = free.bottom - vInset;
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

function torusFitSamples(): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= 36; i++) {
    for (let j = 0; j <= 18; j++) {
      const u = (i / 36) * Math.PI * 2;
      const v = (j / 18) * Math.PI * 2;
      pts.push(torusPosFromUv(u, v));
    }
  }
  for (const c of manifoldFitCorners({ surface: 'torus', isChartFlat: () => false } as SurfaceBoard)) pts.push(c);
  return pts;
}

function kleinFitCornerPts(): [number, number, number][] {
  return manifoldFitCorners({ surface: 'klein', isChartFlat: () => false } as SurfaceBoard);
}

function kleinFitSamples(): [number, number, number][] {
  const scale = KLEIN_SCALE();
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    for (let j = 0; j <= 48; j++) {
      const u = (i / 48) * Math.PI;
      const v = (j / 48) * Math.PI * 2;
      pts.push(kleinImmersionPos(u, v, scale));
    }
  }
  for (const c of kleinFitCornerPts()) pts.push(c);
  return pts;
}

export function manifoldFitSamples(board: SurfaceBoard): [number, number, number][] {
  if (board.isChartFlat()) return [];
  return board.surface === 'torus' ? torusFitSamples() : kleinFitSamples();
}

export function manifoldFitCorners(board: SurfaceBoard): [number, number, number][] {
  if (board.isChartFlat()) return [];
  if (board.surface === 'torus') {
    const { lo, hi } = torusFitAabb();
    return boxCorners(lo, hi);
  }
  const { lo, hi } = kleinBottleAabb(KLEIN_SCALE());
  return boxCorners(lo, hi);
}

export function kleinImmersionTargetY(): number {
  let lo = Infinity, hi = -Infinity;
  for (const p of kleinFitSamples()) {
    lo = Math.min(lo, p[1]);
    hi = Math.max(hi, p[1]);
  }
  return (lo + hi) / 2;
}

export interface ProjectedExtent {
  minX: number; maxX: number; minY: number; maxY: number;
  width: number; height: number;
}

function rotateYp(x: number, y: number, z: number, ang: number): [number, number, number] {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [x * c + z * s, y, -x * s + z * c];
}

function idleSpinAngles(board: SurfaceBoard, steps: number, fullCycle: boolean): number[] {
  const spin0 = board.group.rotation.y;
  if (board.surface === 'klein' && !board.isChartFlat() && !fullCycle) {
    const sway = config.manifold.kleinSpinSway;
    if (steps <= 1) return [spin0];
    return Array.from({ length: steps }, (_, s) => spin0 + ((s / (steps - 1)) * 2 - 1) * sway);
  }
  return Array.from({ length: steps }, (_, s) => (s / steps) * Math.PI * 2 + spin0);
}

function projectExtent(
  samples: [number, number, number][],
  camera: THREE.PerspectiveCamera,
  W: number,
  H: number,
  spinRad: number,
): ProjectedExtent {
  const tmp = new THREE.Vector3();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of samples) {
    const [x, y, z] = rotateYp(s[0], s[1], s[2], spinRad);
    tmp.set(x, y, z);
    tmp.project(camera);
    const px = (tmp.x * 0.5 + 0.5) * W;
    const py = (-tmp.y * 0.5 + 0.5) * H;
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minY = Math.min(minY, py); maxY = Math.max(maxY, py);
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

/** min(width/boardW, height/boardH) over worst spin sample. */
export function projectedFillRatio(
  extent: ProjectedExtent,
  board: BoardScreenRect,
  landscapeTorus = false,
): number {
  if (board.width < 1 || board.height < 1) return 0;
  if (landscapeTorus) return 0;
  return Math.min(extent.width / board.width, extent.height / board.height);
}

export interface TorusLandscapeMetrics {
  bandHeight: number;
  extent: ProjectedExtent;
  heightInBand: number;
  widthInView: number;
  ok: boolean;
}

/** Screen bbox of the torus AABB (corners), same view as the live board. */
export function measureTorusLandscapeBox(
  board: SurfaceBoard,
  camera: THREE.PerspectiveCamera,
  free: Rect,
  W: number,
  H: number,
): TorusLandscapeMetrics {
  const corners = manifoldFitCorners(board);
  const fillSteps = config.manifold.fillMeasureSpins;
  const bandHeight = Math.max(1, free.bottom - free.top);
  let best = { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  let bestScore = 0;
  for (const ang of idleSpinAngles(board, fillSteps, true)) {
    const ext = projectExtent(corners, camera, W, H, ang);
    const score = Math.max(ext.height / bandHeight, ext.width / W);
    if (score > bestScore) {
      bestScore = score;
      best = ext;
    }
  }
  const heightInBand = best.height / bandHeight;
  const widthInView = best.width / W;
  return {
    bandHeight,
    extent: best,
    heightInBand,
    widthInView,
    ok: heightInBand >= 0.45 || widthInView >= 0.4,
  };
}

const MANIFOLD_BASE_FOV = 45;
const TORUS_LANDSCAPE_FOV = 40;

export function manifoldFitFov(
  surface: SurfaceBoard['surface'],
  isChart: boolean,
  W: number,
  H: number,
  baseFov = MANIFOLD_BASE_FOV,
): number {
  if (torusLandscapeFill(surface, isChart, W, H)) return TORUS_LANDSCAPE_FOV;
  return baseFov;
}

function applyFitFov(camera: THREE.PerspectiveCamera, board: SurfaceBoard, W: number, H: number) {
  camera.fov = manifoldFitFov(board.surface, board.isChartFlat(), W, H);
  camera.updateProjectionMatrix();
}

export function resetManifoldFitFov(camera: THREE.PerspectiveCamera, baseFov = MANIFOLD_BASE_FOV) {
  if (camera.fov !== baseFov) {
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
  }
}

function torusLandscapeFill(surface: SurfaceBoard['surface'], isChart: boolean, W: number, H: number): boolean {
  return surface === 'torus' && !isChart && phoneLandscape(W, H);
}

/** Polar angle for orbit fit; landscape torus uses a steeper view so the donut fits the short board band. */
export function manifoldFitPolar(
  surface: SurfaceBoard['surface'],
  isChart: boolean,
  polar: number,
  W: number,
  H: number,
): number {
  if (torusLandscapeFill(surface, isChart, W, H)) return Math.min(polar + 0.14, 1.22);
  return polar;
}

function fitInsidePoints(
  board: SurfaceBoard,
  W: number,
  H: number,
  samples: [number, number, number][],
): [number, number, number][] {
  return torusLandscapeFill(board.surface, board.isChartFlat(), W, H)
    ? manifoldFitCorners(board) : samples;
}

/** Fit samples, at every idle-spin step, must lie inside the board rect (margin already in boardRect). */
function allSamplesInsideAllSpins(
  samples: [number, number, number][],
  board: SurfaceBoard,
  camera: THREE.PerspectiveCamera,
  W: number,
  H: number,
  boardRect: BoardScreenRect,
): boolean {
  const checkPts = fitInsidePoints(board, W, H, samples);
  const steps = config.manifold.fitSpinSteps;
  const tmp = new THREE.Vector3();
  for (const ang of idleSpinAngles(board, steps, false)) {
    for (const sv of checkPts) {
      const [x, y, z] = rotateYp(sv[0], sv[1], sv[2], ang);
      tmp.set(x, y, z);
      tmp.project(camera);
      const px = (tmp.x * 0.5 + 0.5) * W;
      const py = (-tmp.y * 0.5 + 0.5) * H;
      if (px < boardRect.left || px > boardRect.right || py < boardRect.top || py > boardRect.bottom) return false;
    }
  }
  return true;
}

function extentsInsideAllSpins(
  samples: [number, number, number][],
  board: SurfaceBoard,
  camera: THREE.PerspectiveCamera,
  W: number,
  H: number,
  boardRect: BoardScreenRect,
): boolean {
  return allSamplesInsideAllSpins(samples, board, camera, W, H, boardRect);
}

function mergeExtents(a: ProjectedExtent, b: ProjectedExtent): ProjectedExtent {
  const minX = Math.min(a.minX, b.minX), maxX = Math.max(a.maxX, b.maxX);
  const minY = Math.min(a.minY, b.minY), maxY = Math.max(a.maxY, b.maxY);
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function worstSpinFill(
  samples: [number, number, number][],
  corners: [number, number, number][],
  board: SurfaceBoard,
  camera: THREE.PerspectiveCamera,
  W: number,
  H: number,
  boardRect: BoardScreenRect,
  free?: Rect,
): { fill: number; inside: boolean; extent: ProjectedExtent } {
  let bestFill = 0;
  let bestExt = { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  const fillSteps = config.manifold.fillMeasureSpins;
  const kleinSway = board.surface === 'klein' && !board.isChartFlat();
  const landTorus = torusLandscapeFill(board.surface, board.isChartFlat(), W, H);
  if (landTorus && free) {
    const m = measureTorusLandscapeBox(board, camera, free, W, H);
    const inside = extentsInsideAllSpins(samples, board, camera, W, H, boardRect);
    const score = Math.max(m.heightInBand, m.widthInView);
    return { fill: score, inside, extent: m.extent };
  }
  for (const ang of idleSpinAngles(board, fillSteps, !kleinSway)) {
    const ext = mergeExtents(
      projectExtent(samples, camera, W, H, ang),
      projectExtent(corners, camera, W, H, ang),
    );
    const f = projectedFillRatio(ext, boardRect, landTorus);
    if (f > bestFill) { bestFill = f; bestExt = ext; }
  }
  const inside = extentsInsideAllSpins(samples, board, camera, W, H, boardRect);
  return { fill: bestFill, inside, extent: bestExt };
}

function tuneTorusLandscapeVisual(
  board: SurfaceBoard,
  samples: [number, number, number][],
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  free: Rect,
  W: number,
  H: number,
  polar: number,
  azimuth: number,
  boardRect: BoardScreenRect,
  d0: number,
): number {
  const inside = () => allSamplesInsideAllSpins(samples, board, camera, W, H, boardRect);
  const ok = (d: number) => {
    setOrbitCamera(camera, target, d, polar, azimuth, free, W, H, board);
    return measureTorusLandscapeBox(board, camera, free, W, H).ok && inside();
  };
  let d = d0;
  setOrbitCamera(camera, target, d, polar, azimuth, free, W, H, board);
  for (let i = 0; i < 64 && !inside(); i++) {
    d *= 1.03;
    setOrbitCamera(camera, target, d, polar, azimuth, free, W, H, board);
  }
  for (let i = 0; i < 72; i++) {
    const trial = d * 0.972;
    if (ok(trial)) d = trial;
    else break;
  }
  for (let i = 0; i < 72; i++) {
    const m = measureTorusLandscapeBox(board, camera, free, W, H);
    if (m.ok) break;
    const trial = d * 0.972;
    setOrbitCamera(camera, target, trial, polar, azimuth, free, W, H, board);
    if (!inside()) break;
    d = trial;
  }
  setOrbitCamera(camera, target, d, polar, azimuth, free, W, H, board);
  return d;
}

function setOrbitCamera(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  d: number,
  polar: number,
  azimuth: number,
  free: Rect,
  W: number,
  H: number,
  board?: SurfaceBoard,
) {
  if (board && !board.isChartFlat()) applyFitFov(camera, board, W, H);
  if (board?.surface === 'klein' && !board.isChartFlat()) {
    const [ox, oy, oz] = kleinCameraOffset(d);
    camera.position.set(target.x + ox, target.y + oy, target.z + oz);
  } else {
    const cp = Math.cos(polar), sa = Math.sin(azimuth), ca = Math.cos(azimuth);
    camera.position.set(target.x + sa * cp * d, target.y + cp * d, target.z + ca * cp * d);
  }
  camera.lookAt(target);
  const viewOffX = W / 2 - (free.left + free.right) / 2;
  const viewOffY = H / 2 - (free.top + free.bottom) / 2;
  camera.setViewOffset(W, H, viewOffX, viewOffY, W, H);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
}

/** Pull camera in/out so projected fill sits in [fillMin, fillMax] while samples stay in the board rect. */
function tuneManifoldFillDistance(
  board: SurfaceBoard,
  samples: [number, number, number][],
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  free: Rect,
  W: number,
  H: number,
  polar: number,
  azimuth: number,
  boardRect: BoardScreenRect,
  d0: number,
  fillMin: number,
  fillMax: number,
): number {
  const corners = manifoldFitCorners(board);
  let d = d0;
  const measure = () => worstSpinFill(samples, corners, board, camera, W, H, boardRect).fill;
  const inside = () => allSamplesInsideAllSpins(samples, board, camera, W, H, boardRect);
  const zoomIn = phoneLandscape(W, H) ? 0.98 : 0.985;
  const zoomOut = phoneLandscape(W, H) ? 1.014 : 1.012;
  for (let i = 0; i < 80; i++) {
    setOrbitCamera(camera, target, d, polar, azimuth, free, W, H, board);
    const f = measure();
    const okIn = inside();
    if (okIn && f >= fillMin && f <= fillMax) break;
    if (!okIn || f > fillMax) {
      d *= zoomOut;
      continue;
    }
    if (f < fillMin) {
      const trial = d * zoomIn;
      setOrbitCamera(camera, target, trial, polar, azimuth, free, W, H, board);
      if (inside()) d = trial;
      else break;
    }
  }
  setOrbitCamera(camera, target, d, polar, azimuth, free, W, H, board);
  return d;
}

function tuneKleinFillDistance(
  board: SurfaceBoard,
  samples: [number, number, number][],
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  free: Rect,
  W: number,
  H: number,
  polar: number,
  azimuth: number,
  boardRect: BoardScreenRect,
  d0: number,
): number {
  return tuneManifoldFillDistance(
    board, samples, camera, target, free, W, H, polar, azimuth, boardRect, d0,
    config.manifold.kleinBoardFillMin, config.manifold.kleinBoardFillMax,
  );
}

export function fitManifoldProjected(
  board: SurfaceBoard,
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  free: Rect,
  W: number,
  H: number,
  polar: number,
  azimuth: number,
): number {
  const samples = manifoldFitSamples(board);
  if (!samples.length) return 12;
  const boardRect = boardRectInset(free, config.manifold.frameMargin, W, H);
  const savedRotY = board.group.rotation.y;
  const fitPolar = manifoldFitPolar(board.surface, board.isChartFlat(), polar, W, H);
  applyFitFov(camera, board, W, H);

  let lo = 1.5, hi = 80;
  for (let iter = 0; iter < 40; iter++) {
    const d = (lo + hi) / 2;
    setOrbitCamera(camera, target, d, fitPolar, azimuth, free, W, H, board);
    if (allSamplesInsideAllSpins(samples, board, camera, W, H, boardRect)) hi = d;
    else lo = d;
  }
  let d = hi;
  setOrbitCamera(camera, target, d, fitPolar, azimuth, free, W, H, board);
  for (let guard = 0; guard < 48 && !allSamplesInsideAllSpins(samples, board, camera, W, H, boardRect); guard++) {
    d *= 1.008;
    setOrbitCamera(camera, target, d, fitPolar, azimuth, free, W, H, board);
  }
  if (board.surface === 'klein' && !board.isChartFlat()) {
    d = tuneKleinFillDistance(board, samples, camera, target, free, W, H, fitPolar, azimuth, boardRect, d);
  } else if (board.surface === 'torus' && !board.isChartFlat()) {
    if (phoneLandscape(W, H)) {
      d = tuneTorusLandscapeVisual(
        board, samples, camera, target, free, W, H, fitPolar, azimuth, boardRect, d,
      );
    } else {
      d = tuneManifoldFillDistance(
        board, samples, camera, target, free, W, H, fitPolar, azimuth, boardRect, d,
        config.manifold.boardFillMin, config.manifold.boardFillMax,
      );
    }
  }

  board.group.rotation.y = savedRotY;
  return d;
}

export interface OrbitFitContext {
  target: THREE.Vector3;
  polar: number;
  azimuth: number;
  distance: number;
}

export interface ProjectFitReport {
  ok: boolean;
  failures: string[];
  rect: BoardScreenRect;
  fill: number;
  /** Orbit distance after fit (QA / layout diagnostics). */
  cameraDistance?: number;
  canZoomIn?: boolean;
  torusScreen?: TorusLandscapeMetrics;
}

/** True if an orbit zoom-in step keeps samples inside (same model as fit tuning, not a camera lerp hack). */
function orbitCanZoomInWhileInside(
  samples: [number, number, number][],
  board: SurfaceBoard,
  camera: THREE.PerspectiveCamera,
  ctx: OrbitFitContext,
  free: Rect,
  W: number,
  H: number,
  rect: BoardScreenRect,
): boolean {
  for (let k = 0; k < 12; k++) {
    const trial = ctx.distance * (0.985 ** (k + 1));
    setOrbitCamera(camera, ctx.target, trial, ctx.polar, ctx.azimuth, free, W, H, board);
    if (allSamplesInsideAllSpins(samples, board, camera, W, H, rect)) return true;
  }
  setOrbitCamera(camera, ctx.target, ctx.distance, ctx.polar, ctx.azimuth, free, W, H, board);
  return false;
}

export function checkManifoldProjectFit(
  board: SurfaceBoard,
  camera: THREE.PerspectiveCamera,
  free: Rect,
  W: number,
  H: number,
  orbit?: OrbitFitContext,
): ProjectFitReport {
  const samples = manifoldFitSamples(board);
  const corners = manifoldFitCorners(board);
  const rect = boardRectInset(free, config.manifold.frameMargin, W, H);
  const failures: string[] = [];
  if (!samples.length) return { ok: false, failures: ['not-3d'], rect, fill: 0 };
  const viewOffX = W / 2 - (free.left + free.right) / 2;
  const viewOffY = H / 2 - (free.top + free.bottom) / 2;
  camera.setViewOffset(W, H, viewOffX, viewOffY, W, H);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const inside = extentsInsideAllSpins(samples, board, camera, W, H, rect);
  const landTorus = torusLandscapeFill(board.surface, board.isChartFlat(), W, H);
  let fill = 0;
  let torusScreen: TorusLandscapeMetrics | undefined;
  if (landTorus) {
    torusScreen = measureTorusLandscapeBox(board, camera, free, W, H);
    fill = Math.max(torusScreen.heightInBand, torusScreen.widthInView);
    if (!inside) failures.push('sample projected extent outside board at some spin');
    if (!torusScreen.ok) {
      failures.push(
        `torus screen box small: height ${torusScreen.heightInBand.toFixed(3)} of band, `
        + `width ${torusScreen.widthInView.toFixed(3)} of view (need h≥0.45 or w≥0.40)`,
      );
    }
  } else {
    const w = worstSpinFill(samples, corners, board, camera, W, H, rect, free);
    fill = w.fill;
    if (!inside) failures.push('sample projected extent outside board at some spin');
    const fillMin = board.surface === 'klein' && !board.isChartFlat()
      ? config.manifold.kleinBoardFillMin : config.manifold.boardFillMin;
    const fillMax = board.surface === 'klein' && !board.isChartFlat()
      ? config.manifold.kleinBoardFillMax : config.manifold.boardFillMax;
    if (fill < fillMin && inside && orbit) {
      const canZoomIn = orbitCanZoomInWhileInside(samples, board, camera, orbit, free, W, H, rect);
      if (canZoomIn) failures.push(`projected fill ${fill.toFixed(3)} < min ${fillMin}`);
      return { ok: failures.length === 0, failures, rect, fill, canZoomIn, torusScreen };
    }
    if (fill > fillMax && inside) {
      failures.push(`projected fill ${fill.toFixed(3)} > max ${fillMax}`);
    }
  }
  const targetY = board.surface === 'torus' ? 0.1 : !board.isChartFlat() ? kleinImmersionTargetY() : 0;
  const cameraDistance = camera.position.distanceTo(new THREE.Vector3(0, targetY, 0));
  return { ok: failures.length === 0, failures, rect, fill, cameraDistance, canZoomIn: false, torusScreen };
}
