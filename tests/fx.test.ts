import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  CadenceCounter,
  FX_BUDGETS,
  MOTE_ACCEL,
  SlotArrivals,
  SlotRing,
  Throttle,
  VIEWPORT_REF_PX,
  accumulate,
  budgetFor,
  loneSprings,
  motePoint,
  mulberry32,
  streamRate,
  validLinks,
  viewportScale,
  type V3,
} from '../src/render/fx-model';
import { FX, saturation } from '../src/art/palette';
import { CartographyFX } from '../src/render/fx';
import * as THREE from 'three';

describe('CartographyFX construction (no WebGL)', () => {
  const geoOf = (fx: CartographyFX) => (fx.group.children[0] as THREE.Mesh).geometry as THREE.InstancedBufferGeometry;

  it('initialises instanceCount to the quality-1 cap, not the Infinity default', () => {
    const fx = new CartographyFX(1);
    expect(geoOf(fx).instanceCount).toBe(FX_BUDGETS[1].capacity);
    expect(fx.stats().capacity).toBe(FX_BUDGETS[1].capacity);
    fx.dispose();
  });

  it('applies the cap for every quality level at construction and on later setQuality calls', () => {
    for (const q of [0, 1, 2] as const) {
      const fx = new CartographyFX(q);
      expect(geoOf(fx).instanceCount).toBe(FX_BUDGETS[q].capacity);
      fx.setQuality(((q + 1) % 3) as 0 | 1 | 2);
      expect(geoOf(fx).instanceCount).toBe(FX_BUDGETS[(q + 1) % 3].capacity);
      fx.dispose();
    }
  });

  it('keeps the whole effect layer in a single mesh (one draw call)', () => {
    const fx = new CartographyFX(1);
    expect(fx.group.children.length).toBe(1);
    expect(fx.stats().drawCalls).toBe(1);
    fx.dispose();
  });
});

describe('ring mode winding', () => {
  // Mirrors the Mode.Ring vertex mapping in fx.ts: quad (x, y) -> world (x, 0.03, -y) after scaling by r.
  // The GLSL itself is not executed here; this checks the winding the mapping produces.
  const faceNormal = (map: (x: number, y: number) => [number, number, number]) => {
    const quad = new THREE.PlaneGeometry(2, 2);
    const pos = quad.getAttribute('position');
    const idx = quad.index!.array;
    const v = (i: number) => new THREE.Vector3(...map(pos.getX(i), pos.getY(i)));
    const a = v(idx[0]), b = v(idx[1]), c = v(idx[2]);
    return new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  };

  it('the unnegated XY->XZ mapping faces -Y, which FrontSide culls from above', () => {
    expect(faceNormal((x, y) => [x, 0.03, y]).y).toBeLessThan(0);
  });

  it('the shipped mapping has a front face pointing +Y', () => {
    const n = faceNormal((x, y) => [x, 0.03, -y]);
    expect(n.y).toBeGreaterThan(0);
    expect(Math.abs(n.x) + Math.abs(n.z)).toBeCloseTo(0, 10);
  });
});

describe('accumulate', () => {
  const run = (steps: number[]) => {
    let carry = 0;
    let total = 0;
    for (const dt of steps) {
      const [n, c] = accumulate(carry, 13.7, dt);
      total += n;
      carry = c;
      expect(carry).toBeGreaterThanOrEqual(0);
      expect(carry).toBeLessThan(1);
    }
    return total;
  };

  it('is dt-invariant: one step, 100 steps and 7 uneven steps agree within 1', () => {
    const one = run([1]);
    const hundred = run(Array.from({ length: 100 }, () => 0.01));
    const uneven = run([0.1, 0.05, 0.2, 0.15, 0.25, 0.1, 0.15]);
    expect(Math.abs(one - hundred)).toBeLessThanOrEqual(1);
    expect(Math.abs(one - uneven)).toBeLessThanOrEqual(1);
    expect(Math.abs(hundred - uneven)).toBeLessThanOrEqual(1);
    expect(one).toBe(13);
  });

  it('spawns nothing for non-finite or non-positive dt or rate', () => {
    expect(accumulate(0, NaN, 1)).toEqual([0, 0]);
    expect(accumulate(0, 5, NaN)).toEqual([0, 0]);
    expect(accumulate(0, 5, -1)).toEqual([0, 0]);
    expect(accumulate(0, -5, 1)).toEqual([0, 0]);
    expect(accumulate(0, 0, 1)).toEqual([0, 0]);
    expect(accumulate(0, Infinity, 1)).toEqual([0, 0]);
    expect(accumulate(0, 5, Infinity)).toEqual([0, 0]);
  });

  it('treats a bad carry as zero and keeps a valid fractional carry', () => {
    expect(accumulate(NaN, 0.5, 1)[0]).toBe(0);
    expect(accumulate(-3, 0.5, 1)).toEqual([0, 0.5]);
    expect(accumulate(0.5, 0, 1)).toEqual([0, 0.5]);
  });

  it('caps spawns at maxNow and drops the overflow', () => {
    expect(accumulate(0, 100, 1, 5)).toEqual([5, 0]);
    expect(accumulate(0, 100, 1, 0)).toEqual([0, 0]);
    expect(accumulate(0, 100, 1, -4)).toEqual([0, 0]);
  });
});

describe('SlotRing', () => {
  it('capacity 5 keeps 12 allocations in range and wraps to slot 0 at the 6th', () => {
    const ring = new SlotRing(5);
    const slots = Array.from({ length: 12 }, () => ring.alloc());
    for (const s of slots) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(5);
    }
    expect(slots[5]).toBe(0);
    expect(slots).toEqual([0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1]);
  });

  it('reset restarts the sequence at slot 0', () => {
    const ring = new SlotRing(5);
    ring.alloc();
    ring.alloc();
    ring.alloc();
    ring.reset();
    expect(ring.alloc()).toBe(0);
    expect(ring.alloc()).toBe(1);
  });

  it('throws for capacity 0 or negative', () => {
    expect(() => new SlotRing(0)).toThrow();
    expect(() => new SlotRing(-2)).toThrow();
  });
});

describe('motePoint', () => {
  it('is finite for t in [-1, 2] and exact at the endpoints', () => {
    for (let t = -1; t <= 2; t += 0.1) {
      const [x, y] = motePoint([0, 0], [1, 1], 0.2, t);
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
    const [x0, y0] = motePoint([0, 0], [1, 1], 0.2, 0);
    expect(x0).toBe(0);
    expect(y0).toBe(0);
    const [x1, y1] = motePoint([0, 0], [1, 1], 0.2, 1);
    expect(x1).toBeCloseTo(1, 10);
    expect(y1).toBeCloseTo(1, 10);
  });
});

describe('loneSprings', () => {
  it('returns springs that are not part of any link', () => {
    const tiles = ['spring', 'mill', 'spring', 'spring', null];
    expect(loneSprings(tiles, [[0, 1]])).toEqual([2, 3]);
  });

  it('excludes mills and springs that are linked', () => {
    expect(loneSprings(['mill', 'spring'], [])).toEqual([1]);
    expect(loneSprings(['spring', 'spring'], [[0, 1]])).toEqual([]);
    expect(loneSprings(['mill', 'beacon', undefined], [])).toEqual([]);
  });
});

describe('validLinks', () => {
  const tops: (V3 | undefined)[] = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 1, z: 1 },
    undefined,
    { x: NaN, y: 0, z: 0 },
  ];

  it('keeps only valid links between finite tops', () => {
    const links: [number, number][] = [
      [0, 0], // self
      [0, 1], // valid
      [0, 5], // out of range
      [-1, 0], // negative index
      [0, 2], // missing top
      [0, 3], // NaN top
      [0.5, 1], // non-integer
      [NaN, 1], // NaN index
    ];
    expect(validLinks(links, tops)).toEqual([[0, 1]]);
  });
});

describe('FX_BUDGETS and budgetFor', () => {
  it('numeric fields are non-decreasing across quality, except auraEvery which is non-increasing', () => {
    const keys = Object.keys(FX_BUDGETS[0]) as (keyof (typeof FX_BUDGETS)[0])[];
    for (const key of keys) {
      for (let q = 0; q < FX_BUDGETS.length - 1; q++) {
        const lo = FX_BUDGETS[q][key] as number;
        const hi = FX_BUDGETS[q + 1][key] as number;
        if (key === 'auraEvery') expect(hi).toBeLessThanOrEqual(lo);
        else expect(hi).toBeGreaterThanOrEqual(lo);
      }
    }
  });

  it('budgetFor clamps out-of-range and NaN quality', () => {
    expect(budgetFor(-1)).toBe(FX_BUDGETS[0]);
    expect(budgetFor(5)).toBe(FX_BUDGETS[2]);
    expect(budgetFor(NaN)).toBe(FX_BUDGETS[0]);
    expect(budgetFor(1.7)).toBe(FX_BUDGETS[1]);
  });
});

describe('streamRate', () => {
  it('zero or negative items gives zero', () => {
    expect(streamRate(0, 5, 100)).toBe(0);
    expect(streamRate(-3, 5, 100)).toBe(0);
  });

  it('scales with items and caps at the cap', () => {
    expect(streamRate(2, 5, 100)).toBe(10);
    expect(streamRate(10, 5, 20)).toBe(20);
  });
});

describe('SlotArrivals (one pending arrival per slot)', () => {
  it('due disarms and reports only the slots whose time has come, in slot order', () => {
    const a = new SlotArrivals(8);
    a.arm(5, 2);
    a.arm(1, 1);
    a.arm(3, 9);
    const out: number[] = [];
    expect(a.due(2, out)).toBe(2);
    expect(out).toEqual([1, 5]);
    expect(a.size).toBe(1);
    expect(a.due(10)).toBe(1);
    expect(a.size).toBe(0);
  });

  it('cancel removes a pending arrival, so an overwritten mote cannot arrive', () => {
    const a = new SlotArrivals(4);
    a.arm(2, 1);
    a.cancel(2);
    expect(a.size).toBe(0);
    expect(a.due(5)).toBe(0);
    a.cancel(2); // cancelling an unarmed slot is a no-op
    expect(a.size).toBe(0);
  });

  it('re-arming a slot replaces its time and never counts twice', () => {
    const a = new SlotArrivals(4);
    a.arm(0, 1);
    a.arm(0, 3);
    expect(a.size).toBe(1);
    expect(a.due(2)).toBe(0);
    expect(a.due(3)).toBe(1);
  });

  it('rejects out-of-range slots and non-finite times without growing', () => {
    const a = new SlotArrivals(2);
    expect(a.arm(2, 0)).toBe(false);
    expect(a.arm(-1, 0)).toBe(false);
    expect(a.arm(0.5, 0)).toBe(false);
    expect(a.arm(0, NaN)).toBe(false);
    expect(a.size).toBe(0);
    expect(a.arm(1, 0)).toBe(true);
    expect(a.size).toBe(1);
  });

  it('clear empties every slot', () => {
    const a = new SlotArrivals(3);
    a.arm(0, 1);
    a.arm(2, 1);
    a.clear();
    expect(a.size).toBe(0);
    expect(a.due(10)).toBe(0);
  });
});

describe('FX palette tokens', () => {
  it('ink, production, beacon and bridge are saturated', () => {
    expect(saturation(FX.ink)).toBeGreaterThan(0.3);
    expect(saturation(FX.production)).toBeGreaterThan(0.3);
    expect(saturation(FX.beacon)).toBeGreaterThan(0.3);
    expect(saturation(FX.bridge)).toBeGreaterThan(0.3);
  });
});

describe('ambient rates at the 10 ticks/s sim step', () => {
  const TICK = 0.1;
  const tops3 = (n: number) => Array.from({ length: n }, (_, i) => new THREE.Vector3(i * 0.5, 0, 0));
  const ctxFor = (tiles: string[], links: [number, number][], quality: 0 | 1 | 2) => ({
    tops: tops3(tiles.length),
    links,
    tiles,
    quality,
  });

  it('a lone Spring emits at least one mote within the first 1.0 s at every quality', () => {
    for (const q of [0, 1, 2] as const) {
      const fx = new CartographyFX(q);
      const mote = vi.spyOn(fx as any, 'mote');
      const ctx = ctxFor(['spring'], [], q);
      for (let s = 0; s < 10; s++) fx.update(TICK, ctx);
      expect(mote.mock.calls.length, `quality ${q}`).toBeGreaterThanOrEqual(1);
      fx.dispose();
    }
  });

  it('a Spring to Mill link emits at least one pulse within the first 1.0 s at every quality', () => {
    for (const q of [0, 1, 2] as const) {
      const fx = new CartographyFX(q);
      const pulse = vi.spyOn(fx as any, 'pulse');
      const ctx = ctxFor(['spring', 'mill'], [[0, 1]], q);
      for (let s = 0; s < 10; s++) fx.update(TICK, ctx);
      expect(pulse.mock.calls.length, `quality ${q}`).toBeGreaterThanOrEqual(1);
      fx.dispose();
    }
  });

  it('a Spring to Mill link at quality 0 emits at least 1.5 pulses per second over 2 s', () => {
    const fx = new CartographyFX(0);
    const pulse = vi.spyOn(fx as any, 'pulse');
    const ctx = ctxFor(['spring', 'mill'], [[0, 1]], 0);
    for (let s = 0; s < 20; s++) fx.update(TICK, ctx);
    expect(pulse.mock.calls.length).toBeGreaterThanOrEqual(3);
    fx.dispose();
  });
});

describe('new budget fields (reveal, auraLinks, pops)', () => {
  it('are positive integers at every quality, and bounded by the capacity', () => {
    for (const b of FX_BUDGETS) {
      for (const key of ['reveal', 'auraLinks', 'pops'] as const) {
        expect(Number.isInteger(b[key]) && b[key] > 0, key).toBe(true);
        expect(b[key], key).toBeLessThanOrEqual(b.capacity);
      }
    }
  });

  it('match the tier values in fx-model.ts', () => {
    expect(FX_BUDGETS.map((b) => b.reveal)).toEqual([64, 128, 256]);
    expect(FX_BUDGETS.map((b) => b.auraLinks)).toEqual([12, 24, 48]);
    expect(FX_BUDGETS.map((b) => b.pops)).toEqual([4, 8, 16]);
  });
});

describe('viewport scaling of budgets', () => {
  it('viewportScale is 1 with no or invalid viewport, and 1 at or above the reference area', () => {
    expect(viewportScale()).toBe(1);
    expect(viewportScale(NaN)).toBe(1);
    expect(viewportScale(0)).toBe(1);
    expect(viewportScale(-5)).toBe(1);
    expect(viewportScale(VIEWPORT_REF_PX)).toBe(1);
    expect(viewportScale(VIEWPORT_REF_PX * 4)).toBe(1);
  });

  it('viewportScale is sqrt of the area ratio, floored at 0.55', () => {
    expect(viewportScale(VIEWPORT_REF_PX / 4)).toBe(0.55); // sqrt(0.25) = 0.5 is clamped up to the floor
    expect(viewportScale(VIEWPORT_REF_PX * 0.6)).toBeCloseTo(Math.sqrt(0.6), 10);
  });

  it('no viewport returns the shared FX_BUDGETS object (identity kept)', () => {
    for (const q of [0, 1, 2]) expect(budgetFor(q)).toBe(FX_BUDGETS[q]);
    expect(budgetFor(1, VIEWPORT_REF_PX)).toBe(FX_BUDGETS[1]);
  });

  it('a small viewport scales only the stream rates, overlay and reveal, down to the 0.55 floor', () => {
    const base = FX_BUDGETS[2];
    const b = budgetFor(2, 100);
    expect(b).not.toBe(base);
    expect(b.pulseRate).toBeCloseTo(base.pulseRate * 0.55, 10);
    expect(b.moteRate).toBeCloseTo(base.moteRate * 0.55, 10);
    expect(b.overlay).toBe(Math.floor(base.overlay * 0.55));
    expect(b.reveal).toBe(Math.floor(base.reveal * 0.55));
    // capacity, spawn limit, aura cadence and link/pop caps are never scaled
    expect(b.capacity).toBe(base.capacity);
    expect(b.maxSpawnPerFrame).toBe(base.maxSpawnPerFrame);
    expect(b.auraEvery).toBe(base.auraEvery);
    expect(b.auraLinks).toBe(base.auraLinks);
    expect(b.pops).toBe(base.pops);
  });

  it('never gives a count below 1 and never increases a budget', () => {
    for (const q of [0, 1, 2]) {
      const base = FX_BUDGETS[q];
      const b = budgetFor(q, 1);
      expect(b.overlay).toBeGreaterThanOrEqual(1);
      expect(b.reveal).toBeGreaterThanOrEqual(1);
      for (const key of Object.keys(base) as (keyof typeof base)[]) {
        expect(b[key] as number, key).toBeLessThanOrEqual(base[key] as number);
      }
    }
  });
});

describe('seeded PRNG (mulberry32)', () => {
  it('same seed gives the same sequence, and different seeds diverge', () => {
    const a = mulberry32(12345), b = mulberry32(12345), c = mulberry32(12346);
    const seqA = Array.from({ length: 100 }, () => a());
    const seqB = Array.from({ length: 100 }, () => b());
    const seqC = Array.from({ length: 100 }, () => c());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it('every value is in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 10_000; i++) {
      const v = r();
      expect(v >= 0 && v < 1).toBe(true);
    }
  });

  it('a non-finite seed maps to seed 0', () => {
    const z = mulberry32(0), n = mulberry32(NaN), inf = mulberry32(Infinity);
    for (let i = 0; i < 20; i++) {
      const v = z();
      expect(n()).toBe(v);
      expect(inf()).toBe(v);
    }
  });

  it('spreads evenly: each decile of 10 000 draws is within 800..1200', () => {
    const r = mulberry32(2026);
    const bins = new Array(10).fill(0);
    for (let i = 0; i < 10_000; i++) bins[Math.floor(r() * 10)]++;
    for (const n of bins) expect(n).toBeGreaterThanOrEqual(800);
    for (const n of bins) expect(n).toBeLessThanOrEqual(1200);
  });
});

describe('CadenceCounter (deterministic per-key cadence)', () => {
  it('fires on every n-th hit for a key, then restarts', () => {
    const c = new CadenceCounter(2);
    expect([c.hit(5), c.hit(5), c.hit(5), c.hit(5)]).toEqual([false, true, false, true]);
  });

  it('keeps keys independent', () => {
    const c = new CadenceCounter(2);
    expect(c.hit(1)).toBe(false);
    expect(c.hit(2)).toBe(false);
    expect(c.hit(1)).toBe(true);
    expect(c.hit(2)).toBe(true);
  });

  it('every = 1 fires on each hit, and reset clears the counts', () => {
    const always = new CadenceCounter(1);
    expect([always.hit(0), always.hit(0)]).toEqual([true, true]);
    const c = new CadenceCounter(3);
    c.hit(4);
    c.hit(4);
    c.reset();
    expect(c.hit(4)).toBe(false);
  });

  it('rejects an every below 1 or non-numeric', () => {
    expect(() => new CadenceCounter(0)).toThrow();
    expect(() => new CadenceCounter(NaN)).toThrow();
  });
});

describe('Throttle (minimum gap between accepted events)', () => {
  it('accepts the first event, rejects events inside the gap, and accepts at the gap boundary', () => {
    const t = new Throttle(0.14);
    expect(t.take(0)).toBe(true);
    expect(t.take(0.1)).toBe(false);
    expect(t.take(0.14)).toBe(true);
  });

  it('rejects non-finite time, and treats a clock that moves backwards as a fresh start', () => {
    const t = new Throttle(0.14);
    expect(t.take(NaN)).toBe(false);
    expect(t.take(10)).toBe(true);
    expect(t.take(5)).toBe(true);
    expect(t.take(5.05)).toBe(false);
  });

  it('reset allows the next event immediately', () => {
    const t = new Throttle(1);
    t.take(3);
    t.reset();
    expect(t.take(3.1)).toBe(true);
  });
});

describe('motePoint mirrors the GPU mote flight', () => {
  const rise = FX.riseFrac;

  it('uses the shared exponent and matches the closed form along a straight flight', () => {
    expect(MOTE_ACCEL).toBeGreaterThan(1);
    for (const t of [rise, rise + 0.1, 0.6, 0.95]) {
      const u = (t - rise) / (1 - rise);
      const [x, y] = motePoint([0, 0], [1, 2], 0, t);
      expect(x).toBeCloseTo(Math.pow(u, MOTE_ACCEL), 12);
      expect(y).toBeCloseTo(2 * Math.pow(u, MOTE_ACCEL), 12);
    }
  });

  it('holds at the start until the rise ends, and lands exactly on the target', () => {
    expect(motePoint([0.3, -0.2], [1, 1], 0.2, 0)).toEqual([0.3, -0.2]);
    expect(motePoint([0.3, -0.2], [1, 1], 0.2, rise / 2)).toEqual([0.3, -0.2]);
    const [x, y] = motePoint([0.3, -0.2], [1, 1], 0.2, 1);
    expect(x).toBeCloseTo(1, 10);
    expect(y).toBeCloseTo(1, 10);
  });

  it('accelerates: the mid-flight fraction is well below linear', () => {
    const mid = rise + (1 - rise) / 2;
    const [x] = motePoint([0, 0], [1, 0], 0, mid);
    expect(x).toBeLessThan(0.5);
    expect(x).toBeCloseTo(Math.pow(0.5, MOTE_ACCEL), 12);
  });

  it('bows perpendicular to the flight, peaking mid-flight', () => {
    const [, y] = motePoint([0, 0], [1, 0], 0.2, rise + (1 - rise) / 2);
    expect(Math.abs(y)).toBeGreaterThan(0.1);
    expect(Math.abs(motePoint([0, 0], [1, 0], 0.2, 1)[1])).toBeLessThan(1e-9);
  });
});

describe('loneSprings with kinds and feed-only links', () => {
  it('counts Mills as lone producers when asked, and never Vaults or Bridges', () => {
    const tiles = ['mill', 'vault', 'bridge', 'spring', 'mill'];
    expect(loneSprings(tiles, [], ['spring', 'mill'])).toEqual([0, 3, 4]);
    expect(loneSprings(tiles, [[3, 4]], ['spring', 'mill'])).toEqual([0]);
  });
});

describe('fx-model module purity', () => {
  it('imports neither Three nor the DOM', () => {
    const src = readFileSync(new URL('../src/render/fx-model.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from ['"]three['"]/);
    expect(src).not.toMatch(/\bdocument\./);
    expect(src).not.toMatch(/\bwindow\./);
  });
});
