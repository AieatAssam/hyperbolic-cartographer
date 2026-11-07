// Pure numeric model for render/fx.ts: budgets, spawn accumulation, slot ring, path maths, arrivals.
// No DOM and no Three imports, so it runs under Vitest in Node.

import { FX } from '../art/palette';

export interface FxBudget {
  /** Total GPU instances (particles + rings + arcs). Fixed at construction. */
  capacity: number;
  /** Production pulses: per-link rate, total cap per second. */
  pulsePerLink: number; pulseRate: number;
  /** Ink motes from lone Springs: per-spring rate, total cap per second. */
  motePerSpring: number; moteRate: number;
  /** Spawns allowed per update across all streams (guards dt spikes after a tab switch). */
  maxSpawnPerFrame: number;
  /** One-shot counts. */
  burst: number; puff: number; ringParticles: number; arcsPerBridge: number; overlay: number;
  /** Seconds between Beacon aura rings (non-increasing with quality). */
  auraEvery: number;
  /** Survey reveal cells per wave (fx-graph surveyWave). */
  reveal: number;
  /** Max boost-route edges per aura tick (fx-graph capRoutes). */
  auraLinks: number;
  /** Max concurrent screen-space Pop instances (counter arrival pops). */
  pops: number;
}

/** Explicit counts by quality 0/1/2 (low/medium/high, matching scene.ts QualityLevel). */
export const FX_BUDGETS: readonly FxBudget[] = [
  { capacity: 320, pulsePerLink: 1.1, pulseRate: 9, motePerSpring: 0.7, moteRate: 2.5, maxSpawnPerFrame: 6, burst: 4, puff: 4, ringParticles: 8, arcsPerBridge: 1, overlay: 28, auraEvery: 3.0, reveal: 40, auraLinks: 6, pops: 2 },
  { capacity: 896, pulsePerLink: 1.4, pulseRate: 16, motePerSpring: 0.95, moteRate: 4, maxSpawnPerFrame: 10, burst: 8, puff: 7, ringParticles: 16, arcsPerBridge: 2, overlay: 72, auraEvery: 2.4, reveal: 84, auraLinks: 14, pops: 4 },
  { capacity: 1792, pulsePerLink: 1.7, pulseRate: 28, motePerSpring: 1.2, moteRate: 7, maxSpawnPerFrame: 20, burst: 12, puff: 10, ringParticles: 28, arcsPerBridge: 3, overlay: 140, auraEvery: 1.85, reveal: 160, auraLinks: 28, pops: 8 },
];

/** Viewport reference for budget scaling: 1024 × 1000 px. Smaller viewports get fewer stream and one-shot items. */
export const VIEWPORT_REF_PX = 1_024_000;

/**
 * Scale factor for budgets from the viewport area: clamp(sqrt(px / VIEWPORT_REF_PX), 0.55, 1). Missing or
 * non-positive input gives 1. Capacity is never scaled, so pool behaviour stays the same.
 */
export function viewportScale(viewportPx?: number): number {
  if (viewportPx === undefined || !Number.isFinite(viewportPx) || !(viewportPx > 0)) return 1;
  return Math.min(1, Math.max(0.55, Math.sqrt(viewportPx / VIEWPORT_REF_PX)));
}

/**
 * Budget for a quality level. Without a viewport this returns the shared FX_BUDGETS object (identity preserved).
 * With one, stream rates, overlay and reveal are scaled down on small screens. Returns a new object only then.
 */
export function budgetFor(q: number, viewportPx?: number): FxBudget {
  const base = FX_BUDGETS[Number.isFinite(q) ? Math.max(0, Math.min(2, Math.floor(q))) : 0];
  const k = viewportScale(viewportPx);
  if (k === 1) return base;
  return {
    ...base,
    pulseRate: base.pulseRate * k,
    moteRate: base.moteRate * k,
    overlay: Math.max(1, Math.floor(base.overlay * k)),
    reveal: Math.max(1, Math.floor(base.reveal * k)),
  };
}

/** Seeded mulberry32 PRNG: returns a function giving floats in [0, 1). Same seed, same sequence. Non-finite seeds map to 0. */
export function mulberry32(seed: number): () => number {
  let a = Number.isFinite(seed) ? seed >>> 0 : 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic cadence per key: hit(k) is true on every `every`-th call for key k (then the count restarts).
 * Used for ink motes per producer: one mote per two route arrivals, with no randomness.
 */
export class CadenceCounter {
  private counts = new Map<number, number>();
  constructor(readonly every: number) {
    if (!(every >= 1)) throw new Error('CadenceCounter every must be >= 1');
  }
  hit(key: number): boolean {
    const c = (this.counts.get(key) ?? 0) + 1;
    if (c >= this.every) {
      this.counts.delete(key);
      return true;
    }
    this.counts.set(key, c);
    return false;
  }
  reset() {
    this.counts.clear();
  }
}

/**
 * Minimum gap between accepted events (e.g. Pop at most once per 140 ms). A clock that moves backwards is
 * treated as a fresh start, so the throttle cannot lock up.
 */
export class Throttle {
  private last = -Infinity;
  constructor(readonly gap: number) {}
  take(now: number): boolean {
    if (!Number.isFinite(now)) return false;
    if (now >= this.last && now - this.last < this.gap) return false;
    this.last = now;
    return true;
  }
  reset() {
    this.last = -Infinity;
  }
}

/** Continuous stream rate: per-item rate, capped. Zero items gives zero. */
export const streamRate = (items: number, per: number, cap: number) => (items > 0 ? Math.min(cap, per * items) : 0);

/**
 * Frame-independent spawn accumulator: carries the fractional spawn between frames, so many small
 * steps and one big step of the same total dt spawn the same count (up to maxNow).
 * Returns [spawns now, new carry]. Non-positive or non-finite inputs spawn nothing.
 */
export function accumulate(carry: number, rate: number, dt: number, maxNow = Infinity): [number, number] {
  const c = Number.isFinite(carry) && carry > 0 ? carry : 0;
  if (!(rate > 0) || !(dt > 0) || !Number.isFinite(rate * dt)) return [0, c % 1];
  const total = c + rate * dt;
  const n = Math.floor(total + 1e-9); // epsilon: 10 x 0.1 s sums to 0.99999... and must still fire at 1/s
  return [Math.min(n, Math.max(0, Math.floor(maxNow))), Math.max(0, total - n)]; // overflow beyond maxNow is dropped
}

/** Fixed-size ring allocator: alloc() always returns a slot in [0, capacity), overwriting the oldest. */
export class SlotRing {
  private cursor = 0;
  constructor(readonly capacity: number) {
    if (!(capacity > 0)) throw new Error('SlotRing capacity must be > 0');
  }
  alloc(): number {
    const s = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    return s;
  }
  reset() {
    this.cursor = 0;
  }
}

export type V3 = { x: number; y: number; z: number };
export const finite3 = (v: V3 | undefined | null): v is V3 =>
  !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

const clamp01 = (t: number) => (t > 0 ? (t < 1 ? t : 1) : 0);

/** Ink mote flight exponent: k = u^MOTE_ACCEL, so the mote accelerates into the counter. Interpolated into the GLSL. */
export const MOTE_ACCEL = 2.2;

/**
 * CPU mirror of the GPU Mote path, in NDC. Before `rise` (fraction of life) the mote is still at `start` (the GPU
 * rises it along the normal there). After that, u runs 0..1 over the flight, eased by u^MOTE_ACCEL, with the same
 * sideways bow sin(πu)·bow. Matches fx.ts: st + dv·k + perp(dv)·sin(πu)·bow.
 */
export function motePoint(
  start: [number, number], target: [number, number], bow: number, t: number, rise: number = FX.riseFrac,
): [number, number] {
  const u = clamp01((t - rise) / (1 - rise)), k = Math.pow(u, MOTE_ACCEL);
  const dx = target[0] - start[0], dy = target[1] - start[1];
  const b = Math.sin(Math.PI * u) * bow;
  return [start[0] + dx * k - dy * b, start[1] + dy * k + dx * b];
}

/**
 * Producers that touch no feed route: they emit ink motes on their own stream. `kinds` selects which tile types
 * count (default Springs). Boost endpoints are not in `links`, so a Spring that only a Beacon touches still emits.
 */
export function loneSprings(
  tiles: readonly (string | null | undefined)[], links: readonly (readonly [number, number])[], kinds: readonly string[] = ['spring'],
): number[] {
  const linked = new Set<number>();
  for (const [a, b] of links) linked.add(a), linked.add(b);
  const out: number[] = [];
  tiles.forEach((t, i) => {
    if (t && kinds.includes(t) && !linked.has(i)) out.push(i);
  });
  return out;
}

/** Links whose endpoints are distinct integer indices with finite tops. */
export function validLinks(links: readonly (readonly [number, number])[], tops: readonly (V3 | undefined)[]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of links) {
    if (a === b || !Number.isInteger(a) || !Number.isInteger(b)) continue;
    if (finite3(tops[a]) && finite3(tops[b])) out.push([a, b]);
  }
  return out;
}

/**
 * Pending ink arrivals, at most one per instance slot. A mote arms its own slot at its arrival time. Any later write
 * to that slot cancels it (cancel), so an overwritten mote cannot arrive later. Bounded by capacity by construction:
 * there is no queue to grow, and due() disarms every slot it returns.
 */
export class SlotArrivals {
  private at: Float64Array;
  private armed: Uint8Array;
  private n = 0;
  constructor(readonly capacity: number) {
    if (!(capacity > 0)) throw new Error('SlotArrivals capacity must be > 0');
    this.at = new Float64Array(capacity);
    this.armed = new Uint8Array(capacity);
  }
  private valid(slot: number) {
    return Number.isInteger(slot) && slot >= 0 && slot < this.capacity;
  }
  /** Arms slot for an arrival at `time`. Re-arming replaces the old time. Returns false for a bad slot or time. */
  arm(slot: number, time: number): boolean {
    if (!this.valid(slot) || !Number.isFinite(time)) return false;
    if (!this.armed[slot]) (this.armed[slot] = 1), this.n++;
    this.at[slot] = time;
    return true;
  }
  /** Disarms slot, if armed. Called on every write to the slot. */
  cancel(slot: number) {
    if (this.valid(slot) && this.armed[slot]) (this.armed[slot] = 0), this.n--;
  }
  /** Disarms every slot whose arrival time is <= now and returns how many. Optionally appends them to `out`, in slot order. */
  due(now: number, out?: number[]): number {
    if (this.n === 0) return 0;
    let k = 0;
    for (let i = 0; i < this.capacity && this.n > 0; i++) {
      if (this.armed[i] && this.at[i] <= now) {
        this.armed[i] = 0;
        this.n--;
        out?.push(i);
        k++;
      }
    }
    return k;
  }
  get size() {
    return this.n;
  }
  clear() {
    this.armed.fill(0);
    this.n = 0;
  }
}
