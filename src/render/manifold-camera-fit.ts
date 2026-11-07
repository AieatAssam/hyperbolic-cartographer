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

export interface BoardScreenRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** Usable board = free rect inset by margin only (no fill shrink). */
export function boardRectInset(free: Rect, margin = config.manifold.frameMargin): BoardScreenRect {
  const m = Math.max(16, margin);
  const left = free.left + m, right = free.right - m;
  const top = free.top + m, bottom = free.bottom - m;
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
): number {
  if (board.width < 1 || board.height < 1) return 0;
  return Math.min(extent.width / board.width, extent.height / board.height);
}

/** Every dense sample, at every idle-spin step, must lie inside the board rect (margin already in boardRect). */
function allSamplesInsideAllSpins(
  samples: [number, number, number][],
  board: SurfaceBoard,
  camera: THREE.PerspectiveCamera,
  W: number,
  H: number,
  boardRect: BoardScreenRect,
): boolean {
  const steps = config.manifold.fitSpinSteps;
  const tmp = new THREE.Vector3();
  for (const ang of idleSpinAngles(board, steps, false)) {
    for (const sv of samples) {
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
): { fill: number; inside: boolean; extent: ProjectedExtent } {
  let bestFill = 0;
  let bestExt = { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  const fillSteps = config.manifold.fillMeasureSpins;
  const kleinSway = board.surface === 'klein' && !board.isChartFlat();
  for (const ang of idleSpinAngles(board, fillSteps, !kleinSway)) {
    const ext = mergeExtents(
      projectExtent(samples, camera, W, H, ang),
      projectExtent(corners, camera, W, H, ang),
    );
    const f = projectedFillRatio(ext, boardRect);
    if (f > bestFill) { bestFill = f; bestExt = ext; }
  }
  const inside = extentsInsideAllSpins(samples, board, camera, W, H, boardRect);
  return { fill: bestFill, inside, extent: bestExt };
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
  for (let i = 0; i < 32 && measure() > fillMax && allSamplesInsideAllSpins(samples, board, camera, W, H, boardRect); i++) {
    d *= 1.012;
    setOrbitCamera(camera, target, d, polar, azimuth, free, W, H, board);
  }
  for (let i = 0; i < 32 && measure() < fillMin; i++) {
    const trial = d * 0.985;
    setOrbitCamera(camera, target, trial, polar, azimuth, free, W, H, board);
    if (!allSamplesInsideAllSpins(samples, board, camera, W, H, boardRect)) break;
    d = trial;
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
  const boardRect = boardRectInset(free);
  const savedRotY = board.group.rotation.y;

  let lo = 1.5, hi = 80;
  for (let iter = 0; iter < 40; iter++) {
    const d = (lo + hi) / 2;
    setOrbitCamera(camera, target, d, polar, azimuth, free, W, H, board);
    if (allSamplesInsideAllSpins(samples, board, camera, W, H, boardRect)) hi = d;
    else lo = d;
  }
  let d = hi;
  setOrbitCamera(camera, target, d, polar, azimuth, free, W, H, board);
  for (let guard = 0; guard < 48 && !allSamplesInsideAllSpins(samples, board, camera, W, H, boardRect); guard++) {
    d *= 1.008;
    setOrbitCamera(camera, target, d, polar, azimuth, free, W, H, board);
  }
  if (board.surface === 'klein' && !board.isChartFlat()) {
    d = tuneKleinFillDistance(board, samples, camera, target, free, W, H, polar, azimuth, boardRect, d);
  } else if (board.surface === 'torus' && !board.isChartFlat()) {
    d = tuneManifoldFillDistance(
      board, samples, camera, target, free, W, H, polar, azimuth, boardRect, d,
      config.manifold.boardFillMin, config.manifold.boardFillMax,
    );
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
  const rect = boardRectInset(free);
  const failures: string[] = [];
  if (!samples.length) return { ok: false, failures: ['not-3d'], rect, fill: 0 };
  const viewOffX = W / 2 - (free.left + free.right) / 2;
  const viewOffY = H / 2 - (free.top + free.bottom) / 2;
  camera.setViewOffset(W, H, viewOffX, viewOffY, W, H);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const inside = extentsInsideAllSpins(samples, board, camera, W, H, rect);
  const { fill } = worstSpinFill(samples, corners, board, camera, W, H, rect);
  if (!inside) {
    failures.push('sample projected extent outside board at some spin');
  }
  const fillMin = board.surface === 'klein' && !board.isChartFlat()
    ? config.manifold.kleinBoardFillMin : config.manifold.boardFillMin;
  const fillMax = board.surface === 'klein' && !board.isChartFlat()
    ? config.manifold.kleinBoardFillMax : config.manifold.boardFillMax;
  const targetY = board.surface === 'torus' ? 0.1 : !board.isChartFlat() ? kleinImmersionTargetY() : 0;
  const cameraDistance = camera.position.distanceTo(new THREE.Vector3(0, targetY, 0));
  let canZoomIn = false;
  if (fill < fillMin && inside && orbit) {
    canZoomIn = orbitCanZoomInWhileInside(samples, board, camera, orbit, free, W, H, rect);
    if (canZoomIn) {
      failures.push(`projected fill ${fill.toFixed(3)} < min ${fillMin}`);
    }
  } else if (fill > fillMax && inside && board.surface === 'klein' && !board.isChartFlat()) {
    failures.push(`projected fill ${fill.toFixed(3)} > max ${fillMax}`);
  }
  return { ok: failures.length === 0, failures, rect, fill, cameraDistance, canZoomIn };
}
