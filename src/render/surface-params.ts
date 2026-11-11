/** Shared parametric surface math for manifold preview (embed + skin + tiles). */
import { config } from '../core/config';
import {
  kleinBottleAabb as kleinBottleAabbImpl,
  kleinImmersionFrame as kleinImmersionFrameImpl,
  kleinImmersionPos as kleinImmersionPosImpl,
  kleinParam,
} from './klein-bottle';

export const TORUS_R = () => config.manifold.torusMajorR;
export const TORUS_r = () => config.manifold.torusMinorR;
export const KLEIN_SCALE = () => config.manifold.kleinImmersionScale;
export const SKIN_LIFT = () => config.manifold.skinLift;
export const TILE_GAP = () => config.manifold.tileGap;

export type Tuple3 = [number, number, number];
export type Surface3d = 'torus' | 'klein';

/**
 * Flow in turns. Torus: u += 2π·flow.u, v += 2π·flow.v.
 * Klein: only the glide along x is a symmetry. flow.u is a turn of the orientation double cover (2w cells): tiles
 * slide along the tube, through the neck and back, returning mirrored after half a turn. flow.v is ignored (it would tear).
 */
export interface Flow { u: number; v: number }
export const NO_FLOW: Flow = { u: 0, v: 0 };

export { kleinParam };

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

function sub3(a: Tuple3, b: Tuple3): Tuple3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dist3(a: Tuple3, b: Tuple3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Cell centre in grid coords → torus (u,v) with half-open [0,w)×[0,h). */
export function gridToUv(gx: number, gy: number, w: number, h: number): [number, number] {
  return [(gx / w) * Math.PI * 2, (gy / h) * Math.PI * 2];
}

/** Continuous grid coords → parameter (u,v) for the given surface. */
export function surfaceParam(surface: Surface3d, gx: number, gy: number, w: number, h: number, flow: Flow = NO_FLOW): [number, number] {
  if (surface === 'torus') {
    return [Math.PI * 2 * (gx / w + flow.u), Math.PI * 2 * (gy / h + flow.v)];
  }
  return kleinParam(gx + flow.u * 2 * w, gy, w, h);
}

/** Bare skin point (not lifted) for continuous grid coords. */
export function surfacePos(surface: Surface3d, gx: number, gy: number, w: number, h: number, flow: Flow = NO_FLOW): Tuple3 {
  const [u, v] = surfaceParam(surface, gx, gy, w, h, flow);
  return surface === 'torus' ? torusPosFromUv(u, v) : kleinImmersionPosImpl(u, v);
}

const FRAME_EPS = 1e-3;

/**
 * Lifted frame on the surface at continuous grid coords. Tangents by central differences (per cell),
 * normal = unit cross product oriented outward on the torus (tv × tu) and as the immersion frame on Klein (tu × tv).
 */
export function surfaceFrame(
  surface: Surface3d, gx: number, gy: number, w: number, h: number,
  flow: Flow = NO_FLOW, lift = SKIN_LIFT(),
) {
  const [u, v] = surfaceParam(surface, gx, gy, w, h, flow);
  const skin = surfacePos(surface, gx, gy, w, h, flow);
  const e = FRAME_EPS;
  const tu = sub3(surfacePos(surface, gx + e, gy, w, h, flow), surfacePos(surface, gx - e, gy, w, h, flow));
  const tv = sub3(surfacePos(surface, gx, gy + e, w, h, flow), surfacePos(surface, gx, gy - e, w, h, flow));
  const su: Tuple3 = [tu[0] / (2 * e), tu[1] / (2 * e), tu[2] / (2 * e)];
  const sv: Tuple3 = [tv[0] / (2 * e), tv[1] / (2 * e), tv[2] / (2 * e)];
  const n = norm3(surface === 'torus' ? cross(sv, su) : cross(su, sv));
  const t = norm3(su);
  return { p: addScaled(skin, n, lift), n, t, u, v, skin };
}

export function torusFrameAtGrid(gx: number, gy: number, w: number, h: number, lift = SKIN_LIFT()) {
  const { p, n, t, u, v } = surfaceFrame('torus', gx, gy, w, h, NO_FLOW, lift);
  return { p, n, t, u, v };
}

export { kleinCameraOffset, kleinGridToUv } from './klein-bottle';
export const kleinImmersionPos = kleinImmersionPosImpl;
export const kleinImmersionFrame = kleinImmersionFrameImpl;
export const kleinBottleAabb = kleinBottleAabbImpl;

export function torusFitAabb(R = TORUS_R(), r = TORUS_r()): { lo: Tuple3; hi: Tuple3 } {
  return { lo: [-R - r, -r, -R - r], hi: [R + r, r, R + r] };
}

export function kleinFrameAtGrid(gx: number, gy: number, w: number, h: number, lift = SKIN_LIFT()) {
  const { p, n, t, u, v } = surfaceFrame('klein', gx, gy, w, h, NO_FLOW, lift);
  return { p, n, t, u, v };
}

export function torusPos(x: number, y: number, w: number, h: number, R = TORUS_R(), r = TORUS_r()): Tuple3 {
  const [u, v] = gridToUv(x + 0.5, y + 0.5, w, h);
  return torusPosFromUv(u, v, R, r);
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

/** Four lifted corner points of tile (x,y) inset by gap, plus the lifted centre frame. */
export function surfacePatchCorners(
  surface: Surface3d, x: number, y: number, w: number, h: number,
  gap = TILE_GAP(), lift = SKIN_LIFT(), flow: Flow = NO_FLOW,
) {
  const half = 0.5 * (1 - gap);
  const cx = x + 0.5, cy = y + 0.5;
  const corners: Tuple3[] = [
    [-half, -half], [half, -half], [half, half], [-half, half],
  ].map(([dx, dy]) => surfaceFrame(surface, cx + dx, cy + dy, w, h, flow, lift).p);
  const frame = surfaceFrame(surface, cx, cy, w, h, flow, lift);
  return { p: frame.p, n: frame.n, t: frame.t, u: frame.u, v: frame.v, corners };
}

export function torusPatchCorners(x: number, y: number, w: number, h: number, gap = TILE_GAP(), lift = SKIN_LIFT()) {
  return surfacePatchCorners('torus', x, y, w, h, gap, lift);
}

export function kleinPatchCorners(x: number, y: number, w: number, h: number, gap = TILE_GAP(), lift = SKIN_LIFT()) {
  return surfacePatchCorners('klein', x, y, w, h, gap, lift);
}

/** Distance from embedded tile centre to the lifted skin point (≈ 0 when embedded by the same frame). */
export function torusTileSkinGap(x: number, y: number, w: number, h: number, embedded: Tuple3, lift = SKIN_LIFT()) {
  return dist3(embedded, surfaceFrame('torus', x + 0.5, y + 0.5, w, h, NO_FLOW, lift).p);
}

export function kleinTileSkinGap(x: number, y: number, w: number, h: number, embedded: Tuple3, lift = SKIN_LIFT()) {
  return dist3(embedded, surfaceFrame('klein', x + 0.5, y + 0.5, w, h, NO_FLOW, lift).p);
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
  const { lo, hi } = kleinBottleAabb(scale);
  const mx = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  return mx * 0.58;
}
