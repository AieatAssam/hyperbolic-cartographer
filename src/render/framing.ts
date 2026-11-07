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
}

/** Phone portrait viewport (not landscape phones). */
export const phonePortrait = (W: number, H: number): boolean => W < 520 && H > W;

/** Smallest camera distance at which every footprint point lands inside the free rect (minus margin), assuming
 *  the projection is view-offset so the target sits at the free rect's centre. Camera at d·(0, cosφ, sinφ):
 *  a ground point (x, z) has depth d − z·sinφ, screen x = x / depth, screen y = −z·cosφ / depth (tan units). */
export function fitDistance(p: FitParams): number {
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
  if (portrait && p.portraitWidthFirst) return Math.max(d, dW);
  if (portrait && dW > dH * 1.01) return d;
  if (portrait && dH > dW * 1.08) return Math.max(dW, dH * 0.94);
  return d;
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
