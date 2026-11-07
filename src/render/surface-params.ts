/** Shared parametric surface math for manifold preview (embed + skin). */
import { config } from '../core/config';

export const TORUS_R = () => config.manifold.torusMajorR;
export const TORUS_r = () => config.manifold.torusMinorR;
export const KLEIN_SCALE = () => config.manifold.kleinImmersionScale;

export type Tuple3 = [number, number, number];

export function torusUv(x: number, y: number, w: number, h: number): [number, number] {
  return [(x / w) * Math.PI * 2, (y / h) * Math.PI * 2];
}

export function torusPos(x: number, y: number, w: number, h: number, R = TORUS_R(), r = TORUS_r()): Tuple3 {
  const [u, v] = torusUv(x, y, w, h);
  const cx = (R + r * Math.cos(v)) * Math.cos(u);
  const cz = (R + r * Math.cos(v)) * Math.sin(u);
  const cy = r * Math.sin(v);
  return [cx, cy, cz];
}

export function torusNormal(x: number, y: number, w: number, h: number): Tuple3 {
  const [u, v] = torusUv(x, y, w, h);
  const nx = Math.cos(v) * Math.cos(u);
  const ny = Math.sin(v);
  const nz = Math.cos(v) * Math.sin(u);
  const L = Math.hypot(nx, ny, nz);
  return [nx / L, ny / L, nz / L];
}

export function torusTangent(n: Tuple3): Tuple3 {
  const ref: Tuple3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const tx = ref[1] * n[2] - ref[2] * n[1];
  const ty = ref[2] * n[0] - ref[0] * n[2];
  const tz = ref[0] * n[1] - ref[1] * n[0];
  const L = Math.hypot(tx, ty, tz);
  return L > 1e-9 ? [tx / L, ty / L, tz / L] : [1, 0, 0];
}

export function kleinImmersionPos(u: number, v: number, scale = KLEIN_SCALE()): Tuple3 {
  const px = scale * (Math.cos(u / 2) * Math.sin(v) - Math.sin(u / 2) * Math.sin(2 * v));
  const py = scale * Math.sin(u / 2) * Math.cos(v) * 2;
  const pz = scale * (Math.sin(u / 2) * Math.sin(v) + Math.cos(u / 2) * Math.sin(2 * v));
  return [px, py, pz];
}

export function kleinImmersionFrame(u: number, v: number, scale = KLEIN_SCALE()) {
  const eps = 1e-3;
  const p = kleinImmersionPos(u, v, scale);
  const pu = kleinImmersionPos(u + eps, v, scale);
  const pv = kleinImmersionPos(u, v + eps, scale);
  const tu: Tuple3 = [pu[0] - p[0], pu[1] - p[1], pu[2] - p[2]];
  const tv: Tuple3 = [pv[0] - p[0], pv[1] - p[1], pv[2] - p[2]];
  const nx = tu[1] * tv[2] - tu[2] * tv[1];
  const ny = tu[2] * tv[0] - tu[0] * tv[2];
  const nz = tu[0] * tv[1] - tu[1] * tv[0];
  const nL = Math.hypot(nx, ny, nz);
  const n: Tuple3 = nL > 1e-9 ? [nx / nL, ny / nL, nz / nL] : [0, 1, 0];
  const t = torusTangent(n);
  return { p, n, t };
}

/** Chart cell size so the fundamental domain fills `fill` of `span` world units. */
export function chartCell(w: number, h: number, span = config.manifold.chartSpan, fill = config.manifold.chartFill) {
  return (span * fill) / Math.max(w, h);
}

export function chartOffset(w: number, h: number, cell: number): Tuple3 {
  return [-(w - 1) * cell * 0.5, 0, -(h - 1) * cell * 0.5];
}
