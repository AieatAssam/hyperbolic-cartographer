/** Projected bounds fit for torus / Klein 3D manifold preview (uses Three.js project). */
import * as THREE from 'three';
import type { Rect } from './framing';
import type { SurfaceBoard } from './surface-board';
import { kleinImmersionPos, KLEIN_SCALE, torusPosFromUv } from './surface-params';
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
  for (let i = 0; i <= 24; i++) {
    for (let j = 0; j <= 12; j++) {
      const u = (i / 24) * Math.PI * 2;
      const v = (j / 12) * Math.PI * 2;
      pts.push(torusPosFromUv(u, v));
    }
  }
  return pts;
}

function kleinFitSamples(): [number, number, number][] {
  const scale = KLEIN_SCALE();
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    for (let j = 0; j <= 20; j++) {
      const u = (i / 40) * Math.PI * 2;
      const v = (j / 20) * Math.PI * 2;
      pts.push(kleinImmersionPos(u, v, scale));
    }
  }
  return pts;
}

export function manifoldFitSamples(board: SurfaceBoard): [number, number, number][] {
  if (board.isChartFlat()) return [];
  return board.surface === 'torus' ? torusFitSamples() : kleinFitSamples();
}

export function manifoldFitCorners(board: SurfaceBoard): [number, number, number][] {
  if (board.isChartFlat()) return [];
  const samples = manifoldFitSamples(board);
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of samples) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  }
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

function extentsInsideAllSpins(
  samples: [number, number, number][],
  board: SurfaceBoard,
  camera: THREE.PerspectiveCamera,
  W: number,
  H: number,
  boardRect: BoardScreenRect,
): boolean {
  const steps = config.manifold.fitSpinSteps;
  const spin0 = board.group.rotation.y;
  const slack = 1;
  for (let s = 0; s < steps; s++) {
    const ang = (s / steps) * Math.PI * 2 + spin0;
    const ext = projectExtent(samples, camera, W, H, ang);
    if (ext.minX < boardRect.left - slack || ext.maxX > boardRect.right + slack
      || ext.minY < boardRect.top - slack || ext.maxY > boardRect.bottom + slack) return false;
  }
  return true;
}

function worstSpinFill(
  samples: [number, number, number][],
  _corners: [number, number, number][],
  board: SurfaceBoard,
  camera: THREE.PerspectiveCamera,
  W: number,
  H: number,
  boardRect: BoardScreenRect,
): { fill: number; inside: boolean; extent: ProjectedExtent } {
  const spin0 = board.group.rotation.y;
  let bestFill = 0;
  let bestExt = { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  const fillSteps = config.manifold.fillMeasureSpins;
  for (let s = 0; s < fillSteps; s++) {
    const ang = (s / fillSteps) * Math.PI * 2 + spin0;
    const ext = projectExtent(samples, camera, W, H, ang);
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
) {
  const cp = Math.cos(polar), sa = Math.sin(azimuth), ca = Math.cos(azimuth);
  camera.position.set(target.x + sa * cp * d, target.y + cp * d, target.z + ca * cp * d);
  camera.lookAt(target);
  const viewOffX = W / 2 - (free.left + free.right) / 2;
  const viewOffY = H / 2 - (free.top + free.bottom) / 2;
  camera.setViewOffset(W, H, viewOffX, viewOffY, W, H);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
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
  const corners = manifoldFitCorners(board);
  if (!samples.length) return 12;
  const boardRect = boardRectInset(free);
  const fillMin = config.manifold.boardFillMin;
  const fillMax = config.manifold.boardFillMax;
  const savedRotY = board.group.rotation.y;

  let lo = 1.5, hi = 45;
  for (let iter = 0; iter < 36; iter++) {
    const d = (lo + hi) / 2;
    setOrbitCamera(camera, target, d, polar, azimuth, free, W, H);
    const inExt = extentsInsideAllSpins(samples, board, camera, W, H, boardRect);
    const w = worstSpinFill(samples, corners, board, camera, W, H, boardRect);
    if (!inExt) lo = d;
    else if (w.fill < fillMin) hi = d;
    else if (w.fill > fillMax) lo = d;
    else hi = d;
  }
  let d = hi;
  setOrbitCamera(camera, target, d, polar, azimuth, free, W, H);
  let w = worstSpinFill(samples, corners, board, camera, W, H, boardRect);
  while (w.fill > fillMax && d < 80) {
    d *= 1.02;
    setOrbitCamera(camera, target, d, polar, azimuth, free, W, H);
    w = worstSpinFill(samples, corners, board, camera, W, H, boardRect);
    if (!extentsInsideAllSpins(samples, board, camera, W, H, boardRect)) {
      d /= 1.02;
      setOrbitCamera(camera, target, d, polar, azimuth, free, W, H);
      break;
    }
  }

  board.group.rotation.y = savedRotY;
  return d;
}

export interface ProjectFitReport {
  ok: boolean;
  failures: string[];
  rect: BoardScreenRect;
  fill: number;
}

export function checkManifoldProjectFit(
  board: SurfaceBoard,
  camera: THREE.PerspectiveCamera,
  free: Rect,
  W: number,
  H: number,
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
  const { fill } = worstSpinFill(samples, corners, board, camera, W, H, rect);
  if (!extentsInsideAllSpins(samples, board, camera, W, H, rect)) {
    failures.push('sample projected extent outside board at some spin');
  }
  if (fill < config.manifold.boardFillMin) {
    failures.push(`projected fill ${fill.toFixed(3)} < min ${config.manifold.boardFillMin}`);
  }
  return { ok: failures.length === 0, failures, rect, fill };
}
