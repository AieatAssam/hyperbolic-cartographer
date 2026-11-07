/** Projected bounds fit for torus / Klein 3D manifold preview (uses Three.js project). */
import * as THREE from 'three';
import type { Rect } from './framing';
import type { SurfaceBoard } from './surface-board';
import { kleinBottleAabb, kleinImmersionPos, KLEIN_SCALE, torusPosFromUv, torusFitAabb } from './surface-params';
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
      const u = (i / 48) * Math.PI * 2;
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
  const spin0 = board.group.rotation.y;
  const tmp = new THREE.Vector3();
  for (let s = 0; s < steps; s++) {
    const ang = (s / steps) * Math.PI * 2 + spin0;
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
  const spin0 = board.group.rotation.y;
  let bestFill = 0;
  let bestExt = { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  const fillSteps = config.manifold.fillMeasureSpins;
  for (let s = 0; s < fillSteps; s++) {
    const ang = (s / fillSteps) * Math.PI * 2 + spin0;
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
  if (!samples.length) return 12;
  const boardRect = boardRectInset(free);
  const savedRotY = board.group.rotation.y;

  let lo = 1.5, hi = 80;
  for (let iter = 0; iter < 40; iter++) {
    const d = (lo + hi) / 2;
    setOrbitCamera(camera, target, d, polar, azimuth, free, W, H);
    if (allSamplesInsideAllSpins(samples, board, camera, W, H, boardRect)) hi = d;
    else lo = d;
  }
  let d = hi;
  setOrbitCamera(camera, target, d, polar, azimuth, free, W, H);
  for (let guard = 0; guard < 48 && !allSamplesInsideAllSpins(samples, board, camera, W, H, boardRect); guard++) {
    d *= 1.008;
    setOrbitCamera(camera, target, d, polar, azimuth, free, W, H);
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
  const inside = extentsInsideAllSpins(samples, board, camera, W, H, rect);
  const { fill } = worstSpinFill(samples, corners, board, camera, W, H, rect);
  if (!inside) {
    failures.push('sample projected extent outside board at some spin');
  }
  // In-bounds wins over fill: flag low fill only if zooming in slightly would still stay in-bounds.
  if (fill < config.manifold.boardFillMin && inside) {
    const viewDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const focus = camera.position.clone().add(viewDir.multiplyScalar(24));
    const offset = camera.position.clone().sub(focus);
    const savedPos = camera.position.clone();
    let canZoomIn = false;
    for (let k = 0; k < 8; k++) {
      camera.position.copy(focus).add(offset.multiplyScalar(0.985));
      offset.multiplyScalar(0.985);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      if (allSamplesInsideAllSpins(samples, board, camera, W, H, rect)) {
        canZoomIn = true;
        break;
      }
    }
    camera.position.copy(savedPos);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    if (canZoomIn) {
      failures.push(`projected fill ${fill.toFixed(3)} < min ${config.manifold.boardFillMin}`);
    }
  }
  return { ok: failures.length === 0, failures, rect, fill };
}
