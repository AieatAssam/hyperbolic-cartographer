/** Pure framing helpers (no DOM, no Three): classify UI overlays and fit a ground footprint to the free screen rect. */

export type Role = 'hud' | 'panel' | 'dock';
export interface Rect { left: number; top: number; right: number; bottom: number }
export type Side = 'top' | 'bottom' | 'left' | 'right' | 'ignore';

/** Which screen edge an overlay eats into, by role and position (never by "touches x≈0", which misreads a
 *  half-width bottom dock as a left sidebar). HUD and dock are horizontal bands unless clearly tall and thin. */
export function classifyOverlay(role: Role, q: Rect, W: number, H: number): Side {
  const w = q.right - q.left, h = q.bottom - q.top;
  if (w < 1 || h < 1) return 'ignore';
  const cx = (q.left + q.right) / 2, cy = (q.top + q.bottom) / 2;
  const tall = h > 0.5 * H && w < 0.6 * W;
  if (tall) return cx < W / 2 ? 'left' : 'right';
  if (role === 'hud') return cy < H / 2 ? 'top' : 'bottom';
  if (role === 'dock') return cy > H / 2 ? 'bottom' : 'top';
  // short panel: a floating card if it touches neither horizontal edge band
  if (q.top < 0.15 * H) return 'top';
  if (q.bottom > 0.85 * H) return 'bottom';
  return 'ignore';
}

/** Free rect left after the overlays; skips any overlay that would squash it below 40% x 30% (phone sheets). */
export function freeRect(overlays: { role: Role; rect: Rect }[], W: number, H: number): Rect {
  let r: Rect = { left: 0, top: 0, right: W, bottom: H };
  for (const { role, rect: q } of overlays) {
    const side = classifyOverlay(role, q, W, H);
    if (side === 'ignore') continue;
    const n = { ...r };
    if (side === 'top') n.top = Math.max(r.top, q.bottom);
    if (side === 'bottom') n.bottom = Math.min(r.bottom, q.top);
    if (side === 'left') n.left = Math.max(r.left, q.right);
    if (side === 'right') n.right = Math.min(r.right, q.left);
    if (n.right - n.left < 0.4 * W || n.bottom - n.top < 0.3 * H) continue;
    r = n;
  }
  return r;
}

export interface FitParams {
  /** Ground-plane footprint points (x, z) relative to the camera target. */
  pts: [number, number][];
  W: number; H: number;
  free: Rect;
  /** Vertical FOV in degrees. */
  fov: number;
  /** Camera polar angle from +y (0 = top-down), camera sits at +z. */
  polar: number;
  /** Pixel margin kept inside the free rect on every side. */
  margin: number;
  /** Flat / hyperbolic portrait board only: keep full horizontal margin (no height-biased zoom-in). */
  portraitWidthFirst?: boolean;
  /** Portrait playable board: pin the footprint under the HUD so leftover height sits above the dock. */
  align?: 'center' | 'top';
  /** Extra pixels below free.top when align is 'top'. */
  topPad?: number;
  /** World-Y of tile tops / arch peaks included in the projected fit (HUD clearance). */
  clearanceY?: number;
}

export interface FitResult {
  d: number;
  viewOffX: number;
  viewOffY: number;
}

/** Phone portrait viewport (not landscape phones). */
export const phonePortrait = (W: number, H: number): boolean => W < 520 && H > W;

/** Phone landscape (short height). */
export const phoneLandscape = (W: number, H: number): boolean => W > H && H < 520;

/** Orbit offset: polar from +Y, azimuth around Y, camera at +Z when azimuth is 0. */
export function sphericalOffset(polar: number, azimuth: number, d: number): [number, number, number] {
  const cp = Math.cos(polar), sp = Math.sin(polar);
  return [Math.sin(azimuth) * sp * d, cp * d, Math.cos(azimuth) * sp * d];
}

/** Screen-space projection matching PerspectiveCamera + lookAt(origin) + setViewOffset (view size = full film). */
export function projectGround(
  x: number, y: number, z: number,
  d: number, polar: number, fovDeg: number,
  W: number, H: number, viewOffX: number, viewOffY: number,
): [number, number] | null {
  const sp = Math.sin(polar), cp = Math.cos(polar);
  const depth = d - z * sp - y * cp;
  if (depth <= 1e-4) return null;
  const t = Math.tan((fovDeg * Math.PI) / 360);
  const sx = x / depth;
  const sy = (y * sp - z * cp) / depth;
  const ndcX = sx / (t * (W / H));
  const ndcY = sy / t;
  const px = (ndcX * 0.5 + 0.5) * W - viewOffX;
  const py = (-ndcY * 0.5 + 0.5) * H - viewOffY;
  return [px, py];
}

function centreOffset(free: Rect, W: number, H: number): { viewOffX: number; viewOffY: number } {
  return {
    viewOffX: W / 2 - (free.left + free.right) / 2,
    viewOffY: H / 2 - (free.top + free.bottom) / 2,
  };
}

function pointsForFit(pts: [number, number][], clearanceY = 0): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const [x, z] of pts) {
    out.push([x, 0, z]);
    if (clearanceY > 0) out.push([x, clearanceY, z]);
  }
  return out;
}

function topAlignOffset(
  pts3: [number, number, number][],
  d: number, polar: number, fov: number,
  W: number, H: number, free: Rect, topPad: number,
): { viewOffX: number; viewOffY: number } {
  const viewOffX = W / 2 - (free.left + free.right) / 2;
  let minPy = Infinity;
  for (const [x, y, z] of pts3) {
    const pr = projectGround(x, y, z, d, polar, fov, W, H, 0, 0);
    if (!pr) continue;
    minPy = Math.min(minPy, pr[1]);
  }
  if (!Number.isFinite(minPy)) return centreOffset(free, W, H);
  return { viewOffX, viewOffY: minPy - (free.top + topPad) };
}

function allInside(
  pts3: [number, number, number][],
  d: number, polar: number, fov: number,
  W: number, H: number, free: Rect, margin: number,
  viewOffX: number, viewOffY: number,
): boolean {
  const x0 = free.left + margin, x1 = free.right - margin;
  const y0 = free.top + margin, y1 = free.bottom - margin;
  for (const [x, y, z] of pts3) {
    const pr = projectGround(x, y, z, d, polar, fov, W, H, viewOffX, viewOffY);
    if (!pr) return false;
    const [px, py] = pr;
    if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  }
  return true;
}

/** Closed-form distance: target at the free-rect centre, camera at d·(0, cosφ, sinφ). */
function fitDistanceCentered(p: FitParams): number {
  const margin = Math.max(12, p.margin);
  const t = Math.tan((p.fov * Math.PI) / 360);
  const a = t * (p.W / p.H) * Math.max(1, (p.free.right - p.free.left) / 2 - margin) / (p.W / 2);
  const b = t * Math.max(1, (p.free.bottom - p.free.top) / 2 - margin) / (p.H / 2);
  const sp = Math.sin(p.polar), cp = Math.cos(p.polar);
  let dW = 0;
  let dH = 0;
  for (const [x, z] of p.pts) {
    dW = Math.max(dW, Math.abs(x) / a + z * sp);
    dH = Math.max(dH, (Math.abs(z) * cp) / b + z * sp);
  }
  const d = Math.max(dW, dH);
  const portrait = phonePortrait(p.W, p.H);
  if (portrait && p.portraitWidthFirst) return Math.max(d, dW, dH);
  if (portrait && dW > dH * 1.01) return d;
  if (portrait && dH > dW * 1.08) return Math.max(dW, dH * 0.94);
  return d;
}

/** Projected fit: binary-search the smallest orbit distance whose footprint (plus optional tile-top clearance)
 *  stays in the free rect after the view offset. Width still limits a square board in a tall phone band;
 *  top-align spends leftover height above the dock instead of as a sky gap, and a more overhead polar
 *  raises projected height so the same width-limited distance fills more of the HUD-to-dock band. */
function fitDistanceProjected(p: FitParams): FitResult {
  const margin = Math.max(8, p.margin);
  const topPad = Math.max(margin, p.topPad ?? margin);
  const pts3 = pointsForFit(p.pts, p.clearanceY ?? 0);
  const { W, H, free, fov, polar } = p;
  let lo = 1.5, hi = 80;
  for (let i = 0; i < 40; i++) {
    const d = (lo + hi) / 2;
    const off = topAlignOffset(pts3, d, polar, fov, W, H, free, topPad);
    if (allInside(pts3, d, polar, fov, W, H, free, margin, off.viewOffX, off.viewOffY)) hi = d;
    else lo = d;
  }
  let d = hi;
  let off = topAlignOffset(pts3, d, polar, fov, W, H, free, topPad);
  for (let g = 0; g < 24 && !allInside(pts3, d, polar, fov, W, H, free, margin, off.viewOffX, off.viewOffY); g++) {
    d *= 1.008;
    off = topAlignOffset(pts3, d, polar, fov, W, H, free, topPad);
  }
  return { d, viewOffX: off.viewOffX, viewOffY: off.viewOffY };
}

export function fitBoard(p: FitParams): FitResult {
  if (p.align === 'top') return fitDistanceProjected(p);
  const centred = centreOffset(p.free, p.W, p.H);
  return { d: fitDistanceCentered(p), viewOffX: centred.viewOffX, viewOffY: centred.viewOffY };
}

/** Smallest camera distance at which every footprint point lands inside the free rect (minus margin), assuming
 *  the projection is view-offset so the target sits at the free rect's centre. Camera at d·(0, cosφ, sinφ):
 *  a ground point (x, z) has depth d − z·sinφ, screen x = x / depth, screen y = −z·cosφ / depth (tan units). */
export function fitDistance(p: FitParams): number {
  return fitBoard(p).d;
}

/** Disk outline sampled as footprint points. */
export const circlePts = (r: number, n = 64): [number, number][] =>
  Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)] as [number, number]);

/** Corners of unit square cells (half-size h) centred at xy. */
export const cellCorners = (xy: [number, number][], h = 0.5): [number, number][] =>
  xy.flatMap(([x, y]) => [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]] as [number, number][]);

/** Whether a pending layout change may reframe the camera now. While a touch cell is previewed (selected >= 0)
 *  the dock grows, which would shift the board under the finger before the confirming tap, so defer until clear. */
export const shouldReframe = (layoutDirty: boolean, selected: number): boolean => layoutDirty && selected < 0;
