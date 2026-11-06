// Pure numeric model for render/fx.ts: budgets, spawn accumulation, slot ring, path maths, arrivals.
// No DOM and no Three imports, so it runs under Vitest in Node.

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
}

/** Explicit counts by quality 0/1/2 (low/medium/high, matching scene.ts QualityLevel). */
export const FX_BUDGETS: readonly FxBudget[] = [
  { capacity: 384, pulsePerLink: 1.5, pulseRate: 14, motePerSpring: 1, moteRate: 4, maxSpawnPerFrame: 12, burst: 10, puff: 8, ringParticles: 16, arcsPerBridge: 1, overlay: 48, auraEvery: 2.4 },
  { capacity: 1024, pulsePerLink: 2, pulseRate: 28, motePerSpring: 1.5, moteRate: 8, maxSpawnPerFrame: 24, burst: 18, puff: 14, ringParticles: 32, arcsPerBridge: 2, overlay: 120, auraEvery: 1.8 },
  { capacity: 2048, pulsePerLink: 2.5, pulseRate: 48, motePerSpring: 2, moteRate: 14, maxSpawnPerFrame: 40, burst: 28, puff: 22, ringParticles: 48, arcsPerBridge: 3, overlay: 220, auraEvery: 1.4 },
];

export const budgetFor = (q: number): FxBudget => FX_BUDGETS[Number.isFinite(q) ? Math.max(0, Math.min(2, Math.floor(q))) : 0];

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
/** Mirrors GLSL smoothstep(0,1,t). */
export const ease = (t: number) => { const k = clamp01(t); return k * k * (3 - 2 * k); };

/** CPU mirror of the shader arc path: lerp a to b with a sin lift. t is clamped to 0..1. */
export function arcPoint(a: V3, b: V3, lift: number, t: number): V3 {
  const k = clamp01(t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k + Math.sin(k * Math.PI) * lift, z: a.z + (b.z - a.z) * k };
}

/** CPU mirror of the ink mote path in NDC: projected start to target, eased, with a sideways bow. */
export function motePoint(start: [number, number], target: [number, number], bow: number, t: number): [number, number] {
  const k = ease(t), dx = target[0] - start[0], dy = target[1] - start[1];
  const b = Math.sin(clamp01(t) * Math.PI) * bow;
  return [start[0] + dx * k - dy * b, start[1] + dy * k + dx * b];
}

/** Springs that touch no production link: they emit ink motes on their own. */
export function loneSprings(tiles: readonly (string | null | undefined)[], links: readonly (readonly [number, number])[]): number[] {
  const linked = new Set<number>();
  for (const [a, b] of links) linked.add(a), linked.add(b);
  const out: number[] = [];
  tiles.forEach((t, i) => {
    if (t === 'spring' && !linked.has(i)) out.push(i);
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

/** Fixed-capacity queue of pending ink arrival times. Overflow merges its weight into the last entry. */
export class ArrivalQueue {
  private t: Float64Array;
  private w: Float64Array;
  private n = 0;
  constructor(readonly capacity = 256) {
    this.t = new Float64Array(capacity);
    this.w = new Float64Array(capacity);
  }
  push(time: number, weight = 1) {
    if (!Number.isFinite(time) || !Number.isFinite(weight)) return;
    if (this.n < this.capacity) (this.t[this.n] = time), (this.w[this.n++] = weight);
    else this.w[this.n - 1] += weight;
  }
  /** Removes arrivals with time <= now; returns their summed weight. */
  pop(now: number): number {
    let sum = 0, k = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.t[i] <= now) sum += this.w[i];
      else (this.t[k] = this.t[i]), (this.w[k++] = this.w[i]);
    }
    this.n = k;
    return sum;
  }
  get size() {
    return this.n;
  }
  clear() {
    this.n = 0;
  }
}
