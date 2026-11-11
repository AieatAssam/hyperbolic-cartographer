/** Wikipedia “bottle shape” Klein immersion (u ∈ [0, π], v ∈ [0, 2π]). */
import { config } from '../core/config';

export type Tuple3 = [number, number, number];

export const KLEIN_U_MAX = Math.PI;
export const KLEIN_V_MAX = Math.PI * 2;

/**
 * Continuous grid coords (cell centres at x+0.5, y+0.5) → immersion (u,v), no clamp.
 * The +π/2 phase on v makes the glide Y → h−Y match (π,v) ≡ (0,π−v) exactly.
 */
export function kleinParam(gx: number, gy: number, w: number, h: number): [number, number] {
  const k = Math.floor(gx / w); // lift along x: each odd sheet is glide-reflected
  if (k & 1) gy = h - gy;
  const tab = arcTable(), f = (gx / w - k) * ARC_N, i = Math.min(ARC_N - 1, Math.floor(f));
  return [tab[i] + (tab[i + 1] - tab[i]) * (f - i), (gy / h) * KLEIN_V_MAX + Math.PI / 2];
}

/** u at equal arc-length steps along the tube centreline, so columns are evenly long instead of bunching in the neck. */
const ARC_N = 256;
let arcU: Float64Array | null = null;
function arcTable(): Float64Array {
  if (arcU) return arcU;
  const N = 2048, len = new Float64Array(N + 1);
  const centre = (u: number) => {
    const c = [0, 0, 0];
    for (let k = 0; k < 4; k++) kleinBottleRaw(u, (k * Math.PI) / 2).forEach((x, j) => (c[j] += x / 4));
    return c;
  };
  let prev = centre(0);
  for (let i = 1; i <= N; i++) {
    const p = centre((i / N) * KLEIN_U_MAX);
    len[i] = len[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    prev = p;
  }
  arcU = new Float64Array(ARC_N + 1);
  for (let k = 0, j = 0; k <= ARC_N; k++) {
    const target = (k / ARC_N) * len[N];
    while (j < N - 1 && len[j + 1] < target) j++;
    arcU[k] = ((j + (target - len[j]) / (len[j + 1] - len[j] || 1)) / N) * KLEIN_U_MAX;
  }
  return arcU;
}

export function kleinGridToUv(gx: number, gy: number, w: number, h: number): [number, number] {
  return kleinParam(gx, gy, w, h);
}

export function kleinMeshUv(ui: number, uSteps: number, vi: number, vSteps: number): [number, number] {
  const u = (ui / uSteps) * KLEIN_U_MAX;
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

/** Formula frame → world: X=x, Y=y, Z=z (view the loop along +Z). */
function toWorld(raw: Tuple3, scale: number): Tuple3 {
  return [raw[0] * scale, raw[1] * scale, raw[2] * scale];
}

let center: Tuple3 = [0, 0, 0];
let cacheScale = NaN;

function refreshCenter(scale: number) {
  if (scale === cacheScale) return;
  const lo: Tuple3 = [Infinity, Infinity, Infinity];
  const hi: Tuple3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i <= 48; i++) {
    for (let j = 0; j <= 48; j++) {
      const u = (i / 48) * KLEIN_U_MAX;
      const v = (j / 48) * KLEIN_V_MAX;
      const q = toWorld(kleinBottleRaw(u, v), scale);
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
  const q = toWorld(kleinBottleRaw(u, v), scale);
  return [q[0] - center[0], q[1] - center[1], q[2] - center[2]];
}

export function kleinImmersionFrame(u: number, v: number, scale = config.manifold.kleinImmersionScale) {
  const epsU = 1e-4;
  const epsV = 1e-4;
  const u1 = Math.min(KLEIN_U_MAX - epsU, u + epsU);
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

/** Self-intersection locus (neck through wall): u ≈ π/2 circle in v. */
export const KLEIN_SELF_INTERSECT_U = Math.PI / 2;

export function kleinBottleAabb(scale = config.manifold.kleinImmersionScale): { lo: Tuple3; hi: Tuple3 } {
  refreshCenter(scale);
  const lo: Tuple3 = [Infinity, Infinity, Infinity];
  const hi: Tuple3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i <= 48; i++) {
    for (let j = 0; j <= 48; j++) {
      const u = (i / 48) * KLEIN_U_MAX;
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

/** Camera on +Z with azimuth / elevation (radians); distance d from target. */
export function kleinCameraOffset(d: number): Tuple3 {
  const az = config.manifold.kleinImmersionAzimuth;
  const elev = config.manifold.kleinImmersionElev;
  const ce = Math.cos(elev), se = Math.sin(elev);
  const ca = Math.cos(az), sa = Math.sin(az);
  return [d * sa * ce, d * se, d * ca * ce];
}
