/** Shared parametric surface math for manifold preview (embed + skin + tiles). */
import { config } from '../core/config';

export const TORUS_R = () => config.manifold.torusMajorR;
export const TORUS_r = () => config.manifold.torusMinorR;
export const KLEIN_SCALE = () => config.manifold.kleinImmersionScale;
export const SKIN_LIFT = () => config.manifold.skinLift;
export const TILE_GAP = () => config.manifold.tileGap;

export type Tuple3 = [number, number, number];

export function torusPosFromUv(u: number, v: number, R = TORUS_R(), r = TORUS_r()): Tuple3 {
  const cx = (R + r * Math.cos(v)) * Math.cos(u);
  const cz = (R + r * Math.cos(v)) * Math.sin(u);
  const cy = r * Math.sin(v);
  return [cx, cy, cz];
}

export function torusNormalFromUv(u: number, v: number): Tuple3 {
  const nx = Math.cos(v) * Math.cos(u);
  const ny = Math.sin(v);
  const nz = Math.cos(v) * Math.sin(u);
  const L = Math.hypot(nx, ny, nz);
  return [nx / L, ny / L, nz / L];
}

export function torusDerivatives(u: number, v: number, R = TORUS_R(), r = TORUS_r()) {
  const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
  const tu: Tuple3 = [-(R + r * cv) * su, 0, (R + r * cv) * cu];
  const tv: Tuple3 = [-r * sv * cu, r * cv, -r * sv * su];
  return { tu, tv };
}

function cross(a: Tuple3, b: Tuple3): Tuple3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm3(a: Tuple3): Tuple3 {
  const L = Math.hypot(a[0], a[1], a[2]);
  return L > 1e-12 ? [a[0] / L, a[1] / L, a[2] / L] : [0, 1, 0];
}

function addScaled(p: Tuple3, n: Tuple3, s: number): Tuple3 {
  return [p[0] + n[0] * s, p[1] + n[1] * s, p[2] + n[2] * s];
}

function dist3(a: Tuple3, b: Tuple3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Cell centre in grid coords → (u,v) with half-open [0,w)×[0,h). */
export function gridToUv(gx: number, gy: number, w: number, h: number): [number, number] {
  return [(gx / w) * Math.PI * 2, (gy / h) * Math.PI * 2];
}

export function torusFrameAtGrid(gx: number, gy: number, w: number, h: number, lift = SKIN_LIFT()) {
  const [u, v] = gridToUv(gx, gy, w, h);
  const p0 = torusPosFromUv(u, v);
  const { tu, tv } = torusDerivatives(u, v);
  const n = norm3(cross(tu, tv));
  const t = norm3(tu);
  const p = addScaled(p0, n, lift);
  return { p, n, t, u, v };
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
  const n = norm3(cross(tu, tv));
  const t = norm3(tu);
  return { p, n, t };
}

export function kleinFrameAtGrid(gx: number, gy: number, w: number, h: number, lift = SKIN_LIFT()) {
  const [u, v] = gridToUv(gx, gy, w, h);
  const { p: p0, n, t } = kleinImmersionFrame(u, v);
  const p = addScaled(p0, n, lift);
  return { p, n, t, u, v };
}

export function torusPos(x: number, y: number, w: number, h: number, R = TORUS_R(), r = TORUS_r()): Tuple3 {
  return torusPosFromUv(gridToUv(x + 0.5, y + 0.5, w, h)[0], gridToUv(x + 0.5, y + 0.5, w, h)[1], R, r);
}

export function torusNormal(x: number, y: number, w: number, h: number): Tuple3 {
  const [u, v] = gridToUv(x + 0.5, y + 0.5, w, h);
  return torusNormalFromUv(u, v);
}

export function torusTangent(n: Tuple3): Tuple3 {
  const ref: Tuple3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const tx = ref[1] * n[2] - ref[2] * n[1];
  const ty = ref[2] * n[0] - ref[0] * n[2];
  const tz = ref[0] * n[1] - ref[1] * n[0];
  return norm3([tx, ty, tz]);
}

/** Four corner points on the torus patch (grid cell x,y), lifted to the skin. */
export function torusPatchCorners(x: number, y: number, w: number, h: number, gap = TILE_GAP(), lift = SKIN_LIFT()) {
  const half = 0.5 * (1 - gap);
  const cx = x + 0.5, cy = y + 0.5;
  const corners: Tuple3[] = [];
  for (const [dx, dy] of [[-half, -half], [half, -half], [half, half], [-half, half]] as const) {
    const [u, v] = gridToUv(cx + dx, cy + dy, w, h);
    const p0 = torusPosFromUv(u, v);
    const n = torusNormalFromUv(u, v);
    corners.push(addScaled(p0, n, lift));
  }
  const frame = torusFrameAtGrid(cx, cy, w, h, lift);
  return { ...frame, corners };
}

export function kleinPatchCorners(x: number, y: number, w: number, h: number, gap = TILE_GAP(), lift = SKIN_LIFT()) {
  const half = 0.5 * (1 - gap);
  const cx = x + 0.5, cy = y + 0.5;
  const corners: Tuple3[] = [];
  for (const [dx, dy] of [[-half, -half], [half, -half], [half, half], [-half, half]] as const) {
    const [u, v] = gridToUv(cx + dx, cy + dy, w, h);
    const p0 = kleinImmersionPos(u, v);
    const n = kleinImmersionFrame(u, v).n;
    corners.push(addScaled(p0, n, lift));
  }
  const frame = kleinFrameAtGrid(cx, cy, w, h, lift);
  return { ...frame, corners };
}

/** Distance from embedded tile centre to bare skin along normal (should ≈ lift). */
export function torusTileSkinGap(x: number, y: number, w: number, h: number, embedded: Tuple3, lift = SKIN_LIFT()) {
  const [u, v] = gridToUv(x + 0.5, y + 0.5, w, h);
  const skin = torusPosFromUv(u, v);
  const n = torusNormalFromUv(u, v);
  const onLift = addScaled(skin, n, lift);
  return Math.abs(dist3(embedded, onLift));
}

export function kleinTileSkinGap(x: number, y: number, w: number, h: number, embedded: Tuple3, lift = SKIN_LIFT()) {
  const [u, v] = gridToUv(x + 0.5, y + 0.5, w, h);
  const skin = kleinImmersionPos(u, v);
  const n = kleinImmersionFrame(u, v).n;
  const onLift = addScaled(skin, n, lift);
  return Math.abs(dist3(embedded, onLift));
}

export function chartCell(w: number, h: number, span = config.manifold.chartSpan, fill = config.manifold.chartFill) {
  return (span * fill) / Math.max(w, h);
}

/** Centre of chart cell (x,y) in world xz. */
export function chartCellCenter(x: number, y: number, w: number, h: number, cell: number): Tuple3 {
  return [(x - (w - 1) * 0.5) * cell, 0, (y - (h - 1) * 0.5) * cell];
}

/** @deprecated use chartCellCenter */
export function chartOffset(w: number, h: number, cell: number): Tuple3 {
  return [-w * cell * 0.5, 0, -h * cell * 0.5];
}

export function torusBoundingRadius(R = TORUS_R(), r = TORUS_r()) {
  return Math.hypot(R + r, r) + r * 0.35;
}

export function kleinBoundingRadius(scale = KLEIN_SCALE()) {
  return scale * 2.65;
}
