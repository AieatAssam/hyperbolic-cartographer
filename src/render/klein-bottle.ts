/** Wikipedia “bottle shape” Klein immersion (u ∈ [0, π), v ∈ [0, 2π)). */
import { config } from '../core/config';

export type Tuple3 = [number, number, number];

/** Tile chart covers half the u period; full skin uses u ∈ [0, 2π) per Wikipedia bottle. */
export const KLEIN_GRID_U_MAX = Math.PI;
export const KLEIN_SKIN_U_MAX = Math.PI * 2;
export const KLEIN_V_MAX = Math.PI * 2;

export function kleinGridToUv(gx: number, gy: number, w: number, h: number): [number, number] {
  const u = Math.min(KLEIN_GRID_U_MAX - 1e-6, (gx / w) * KLEIN_GRID_U_MAX);
  const v = (gy / h) * KLEIN_V_MAX;
  return [u, v];
}

export function kleinMeshUv(ui: number, uSteps: number, vi: number, vSteps: number): [number, number] {
  const u = (ui / uSteps) * KLEIN_SKIN_U_MAX;
  const v = (vi / vSteps) * KLEIN_V_MAX;
  return [u, v];
}

/** Unposed Wikipedia bottle; coordinates are O(1). */
export function kleinBottleRaw(u: number, v: number): Tuple3 {
  const cu = Math.cos(u), su = Math.sin(u);
  const cv = Math.cos(v), sv = Math.sin(v);
  const c2u = cu * cu;
  const c4u = c2u * c2u;
  const c6u = c4u * c2u;
  const innerX = 3 * cv - 30 * su + 90 * c4u * su - 60 * c6u * su + 5 * cu * cv * su;
  const x = (-2 / 15) * cu * innerX;
  const innerY = 3 * cv - 3 * c2u * cv - 48 * c4u * cv + 48 * c6u * cv - 60 * su
    + 5 * cu * cv * su - 5 * c2u * cu * cv * su - 80 * c4u * cu * cv * su + 80 * c6u * cu * cv * su;
  const y = (-1 / 15) * su * innerY;
  const z = (2 / 15) * (3 + 5 * cu * su) * sv;
  return [x, y, z];
}

function rotX(p: Tuple3, a: number): Tuple3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
}

function rotZ(p: Tuple3, a: number): Tuple3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
}

function posePoint(p: Tuple3, scale: number): Tuple3 {
  let q: Tuple3 = [p[0] * scale, p[1] * scale, p[2] * scale];
  q = rotX(q, config.manifold.kleinPoseRotX);
  q = rotZ(q, config.manifold.kleinPoseRotZ);
  return q;
}

let center: Tuple3 = [0, 0, 0];
let cacheScale = NaN;

function refreshCenter(scale: number) {
  if (scale === cacheScale) return;
  const lo: Tuple3 = [Infinity, Infinity, Infinity];
  const hi: Tuple3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i <= 48; i++) {
    for (let j = 0; j <= 48; j++) {
      const u = (i / 48) * KLEIN_SKIN_U_MAX;
      const v = (j / 48) * KLEIN_V_MAX;
      const q = posePoint(kleinBottleRaw(u, v), scale);
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], q[k]);
        hi[k] = Math.max(hi[k], q[k]);
      }
    }
  }
  center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  cacheScale = scale;
}

export function kleinImmersionPos(u: number, v: number, scale = config.manifold.kleinImmersionScale): Tuple3 {
  refreshCenter(scale);
  const q = posePoint(kleinBottleRaw(u, v), scale);
  return [q[0] - center[0], q[1] - center[1], q[2] - center[2]];
}

export function kleinImmersionFrame(u: number, v: number, scale = config.manifold.kleinImmersionScale) {
  const epsU = 1e-4;
  const epsV = 1e-4;
  const u1 = Math.min(KLEIN_SKIN_U_MAX - epsU, u + epsU);
  const v1 = v + epsV >= KLEIN_V_MAX ? v - epsV : v + epsV;
  const p = kleinImmersionPos(u, v, scale);
  const pu = kleinImmersionPos(u1, v, scale);
  const pv = kleinImmersionPos(u, v1, scale);
  const tu: Tuple3 = [pu[0] - p[0], pu[1] - p[1], pu[2] - p[2]];
  const tv: Tuple3 = [pv[0] - p[0], pv[1] - p[1], pv[2] - p[2]];
  const nx = tu[1] * tv[2] - tu[2] * tv[1];
  const ny = tu[2] * tv[0] - tu[0] * tv[2];
  const nz = tu[0] * tv[1] - tu[1] * tv[0];
  const L = Math.hypot(nx, ny, nz);
  const n: Tuple3 = L > 1e-12 ? [nx / L, ny / L, nz / L] : [0, 1, 0];
  const tL = Math.hypot(tu[0], tu[1], tu[2]);
  const t: Tuple3 = tL > 1e-12 ? [tu[0] / tL, tu[1] / tL, tu[2] / tL] : [1, 0, 0];
  return { p, n, t };
}

/** Self-intersection locus (neck through wall): u = π circle in v. */
export const KLEIN_SELF_INTERSECT_U = Math.PI;

export function kleinBottleAabb(scale = config.manifold.kleinImmersionScale): { lo: Tuple3; hi: Tuple3 } {
  refreshCenter(scale);
  const lo: Tuple3 = [Infinity, Infinity, Infinity];
  const hi: Tuple3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i <= 48; i++) {
    for (let j = 0; j <= 48; j++) {
      const u = (i / 48) * KLEIN_SKIN_U_MAX;
      const v = (j / 48) * KLEIN_V_MAX;
      const p = kleinImmersionPos(u, v, scale);
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[k]);
        hi[k] = Math.max(hi[k], p[k]);
      }
    }
  }
  return { lo, hi };
}
