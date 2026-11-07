/** Projected bounds fit for torus / Klein 3D manifold preview (uses Three.js project). */
import * as THREE from 'three';
import type { Rect } from './framing';
import type { SurfaceBoard } from './surface-board';
import { boxCorners } from './projected-fit';
import { kleinBottleAabb, torusFitAabb } from './surface-params';
import { config } from '../core/config';

export function manifoldAabbCorners(board: SurfaceBoard): [number, number, number][] {
  if (board.isChartFlat()) return [];
  if (board.surface === 'torus') {
    const { lo, hi } = torusFitAabb();
    return boxCorners(lo, hi);
  }
  const { lo, hi } = kleinBottleAabb();
  return boxCorners(lo, hi);
}

export interface BoardScreenRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Target footprint inside the free rect (margin ≥16px, fill fraction of inner band). */
export function boardScreenRect(free: Rect, fill: number, margin = config.manifold.frameMargin): BoardScreenRect {
  const m = Math.max(16, margin);
  const cx = (free.left + free.right) / 2;
  const cy = (free.top + free.bottom) / 2;
  const hw = Math.max(8, ((free.right - free.left) / 2 - m) * fill);
  const hh = Math.max(8, ((free.bottom - free.top) / 2 - m) * fill);
  return { left: cx - hw, right: cx + hw, top: cy - hh, bottom: cy + hh };
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
  fill: number,
): number {
  const corners = manifoldAabbCorners(board);
  if (!corners.length) return 8;
  const rect = boardScreenRect(free, fill);
  const viewOffX = W / 2 - (free.left + free.right) / 2;
  const viewOffY = H / 2 - (free.top + free.bottom) / 2;
  const spinSteps = config.manifold.fitSpinSteps;
  const cornerVecs = corners.map((c) => new THREE.Vector3(...c));
  const tmp = new THREE.Vector3();
  const savedRotY = board.group.rotation.y;
  let lo = 0.8, hi = 160;
  const cp = Math.cos(polar), sa = Math.sin(azimuth), ca = Math.cos(azimuth);
  for (let iter = 0; iter < 30; iter++) {
    const d = (lo + hi) / 2;
    camera.position.set(target.x + sa * cp * d, target.y + cp * d, target.z + ca * cp * d);
    camera.lookAt(target);
    camera.setViewOffset(W, H, viewOffX, viewOffY, W, H);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    let ok = true;
    const spin0 = board.group.rotation.y;
    for (let s = 0; s < spinSteps; s++) {
      const ang = (s / spinSteps) * Math.PI * 2 + spin0;
      const cA = Math.cos(ang), sA = Math.sin(ang);
      for (const cv of cornerVecs) {
        const x = cv.x * cA + cv.z * sA;
        const z = -cv.x * sA + cv.z * cA;
        tmp.set(x + board.group.position.x, cv.y + board.group.position.y, z + board.group.position.z);
        tmp.project(camera);
        const px = (tmp.x * 0.5 + 0.5) * W;
        const py = (-tmp.y * 0.5 + 0.5) * H;
        const slack = 1.5;
        if (px < rect.left - slack || px > rect.right + slack || py < rect.top - slack || py > rect.bottom + slack) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (ok) hi = d;
    else lo = d;
  }
  board.group.rotation.y = savedRotY;
  return hi * 1.05;
}

export interface ProjectFitReport {
  ok: boolean;
  failures: string[];
  rect: BoardScreenRect;
}

/** Assert AABB corners project inside boardScreenRect at each idle-spin sample (current camera). */
export function checkManifoldProjectFit(
  board: SurfaceBoard,
  camera: THREE.PerspectiveCamera,
  free: Rect,
  W: number,
  H: number,
  fill: number,
): ProjectFitReport {
  const corners = manifoldAabbCorners(board);
  const rect = boardScreenRect(free, fill);
  const failures: string[] = [];
  if (!corners.length) return { ok: false, failures: ['not-3d'], rect };
  const viewOffX = W / 2 - (free.left + free.right) / 2;
  const viewOffY = H / 2 - (free.top + free.bottom) / 2;
  camera.setViewOffset(W, H, viewOffX, viewOffY, W, H);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const spinSteps = config.manifold.fitSpinSteps;
  const cornerVecs = corners.map((c) => new THREE.Vector3(...c));
  const tmp = new THREE.Vector3();
  for (let s = 0; s < spinSteps; s++) {
    const ang = (s / spinSteps) * Math.PI * 2 + board.group.rotation.y;
    const cA = Math.cos(ang), sA = Math.sin(ang);
    for (let i = 0; i < cornerVecs.length; i++) {
      const cv = cornerVecs[i];
      const x = cv.x * cA + cv.z * sA;
      const z = -cv.x * sA + cv.z * cA;
      tmp.set(x, cv.y, z);
      tmp.project(camera);
      const px = (tmp.x * 0.5 + 0.5) * W;
      const py = (-tmp.y * 0.5 + 0.5) * H;
      const slack = 1.5;
      if (px < rect.left - slack || px > rect.right + slack || py < rect.top - slack || py > rect.bottom + slack) {
        failures.push(
          `spin ${s}/${spinSteps} corner ${i}: (${px.toFixed(1)},${py.toFixed(1)}) outside `
          + `[${rect.left.toFixed(0)},${rect.top.toFixed(0)}–${rect.right.toFixed(0)},${rect.bottom.toFixed(0)}]`,
        );
      }
    }
  }
  return { ok: failures.length === 0, failures, rect };
}
