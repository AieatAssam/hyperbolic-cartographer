/** Projected screen-space fit for 3D manifold boards (pure math, testable). */
import type { Rect } from './framing';

export type V3 = [number, number, number];

export function boxCorners(lo: V3, hi: V3): V3[] {
  const [x0, y0, z0] = lo, [x1, y1, z1] = hi;
  return [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
}

export function rotY(p: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const L = len(a); return L > 1e-12 ? [a[0] / L, a[1] / L, a[2] / L] : [0, 0, -1]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Pixel coords; matches PerspectiveCamera + setViewOffset in main.ts (target at origin before offset). */
export function projectOrbit(
  p: V3, target: V3, dist: number, polar: number, azimuth: number,
  fovDeg: number, W: number, H: number, viewOffX: number, viewOffY: number,
): [number, number] | null {
  const cp = Math.cos(polar);
  const sa = Math.sin(azimuth), ca = Math.cos(azimuth);
  const eye: V3 = [target[0] + sa * cp * dist, target[1] + cp * dist, target[2] + ca * cp * dist];
  const forward = norm(sub(target, eye));
  const worldUp: V3 = [0, 1, 0];
  let right = cross(forward, worldUp);
  if (len(right) < 1e-6) right = [1, 0, 0];
  else right = norm(right);
  const up = norm(cross(right, forward));
  const rel = sub(p, eye);
  const xc = dot(rel, right);
  const yc = dot(rel, up);
  const zc = -dot(rel, forward);
  if (zc <= 1e-4) return null;
  const th = Math.tan((fovDeg * Math.PI) / 360);
  const ndcX = xc / (zc * th * (W / H));
  const ndcY = yc / (zc * th);
  const px = (ndcX * 0.5 + 0.5) * W + viewOffX;
  const py = (-ndcY * 0.5 + 0.5) * H + viewOffY;
  return [px, py];
}

export interface ProjectFitParams {
  corners: V3[];
  spinSteps: number;
  target: V3;
  polar: number;
  azimuth: number;
  W: number;
  H: number;
  free: Rect;
  fovDeg: number;
  margin: number;
  fill: number;
}

/** Smallest orbit distance so all corners stay inside the board rect at every spin sample. */
export function minOrbitDistance(p: ProjectFitParams): number {
  const margin = Math.max(16, p.margin);
  const cx = (p.free.left + p.free.right) / 2;
  const cy = (p.free.top + p.free.bottom) / 2;
  const hw = Math.max(8, ((p.free.right - p.free.left) / 2 - margin) * p.fill);
  const hh = Math.max(8, ((p.free.bottom - p.free.top) / 2 - margin) * p.fill);
  const rect = { left: cx - hw, right: cx + hw, top: cy - hh, bottom: cy + hh };
  const viewOffX = p.W / 2 - cx;
  const viewOffY = p.H / 2 - cy;
  let lo = 0.5, hi = 180;
  for (let iter = 0; iter < 28; iter++) {
    const d = (lo + hi) / 2;
    let ok = true;
    for (let s = 0; s < p.spinSteps; s++) {
      const ang = (s / p.spinSteps) * Math.PI * 2;
      for (const c of p.corners) {
        const rc = rotY(c, ang);
        const pr = projectOrbit(rc, p.target, d, p.polar, p.azimuth, p.fovDeg, p.W, p.H, viewOffX, viewOffY);
        if (!pr) { ok = false; break; }
        const [px, py] = pr;
        if (px < rect.left || px > rect.right || py < rect.top || py > rect.bottom) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (ok) hi = d;
    else lo = d;
  }
  return hi * 1.02;
}
