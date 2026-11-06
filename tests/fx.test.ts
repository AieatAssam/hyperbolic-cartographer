import { describe, expect, it, vi } from 'vitest';
import {
  ArrivalQueue,
  FX_BUDGETS,
  SlotRing,
  accumulate,
  arcPoint,
  budgetFor,
  loneSprings,
  motePoint,
  streamRate,
  validLinks,
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

describe('arcPoint and motePoint', () => {
  const a: V3 = { x: 0, y: 0, z: 0 };
  const b: V3 = { x: 1, y: 2, z: 3 };

  it('arcPoint is finite for t in [-1, 2]', () => {
    for (let t = -1; t <= 2; t += 0.1) {
      const p = arcPoint(a, b, 0.5, t);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
    }
  });

  it('arcPoint hits the endpoints at t=0 and t=1', () => {
    expect(arcPoint(a, b, 0.5, 0)).toEqual(a);
    const end = arcPoint(a, b, 0.5, 1);
    expect(end.x).toBe(b.x);
    expect(end.z).toBe(b.z);
    expect(end.y).toBeCloseTo(b.y, 10);
  });

  it('arcPoint lift peaks at t=0.5', () => {
    // lift above the straight a->b baseline
    const y = (t: number) => arcPoint(a, b, 0.5, t).y - (a.y + (b.y - a.y) * t);
    expect(y(0.5)).toBeGreaterThan(y(0.25));
    expect(y(0.5)).toBeGreaterThan(y(0.75));
    expect(y(0.5)).toBeCloseTo(0.5, 10);
  });

  it('motePoint is finite for t in [-1, 2] and exact at the endpoints', () => {
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

describe('ArrivalQueue', () => {
  it('pop sums weights with time <= now regardless of push order', () => {
    const forward = new ArrivalQueue();
    forward.push(3, 1);
    forward.push(1, 2);
    forward.push(2, 4);
    const reverse = new ArrivalQueue();
    reverse.push(2, 4);
    reverse.push(1, 2);
    reverse.push(3, 1);
    expect(forward.pop(2)).toBe(6);
    expect(reverse.pop(2)).toBe(6);
    expect(forward.size).toBe(1);
    expect(forward.pop(10)).toBe(1);
    expect(forward.size).toBe(0);
  });

  it('defaults weight to 1 and ignores non-finite input', () => {
    const q = new ArrivalQueue();
    q.push(NaN);
    q.push(1, NaN);
    expect(q.size).toBe(0);
    q.push(1);
    expect(q.pop(1)).toBe(1);
  });

  it('overflow merges its weight into the last entry', () => {
    const q = new ArrivalQueue(2);
    q.push(1, 1);
    q.push(2, 1);
    q.push(3, 5);
    expect(q.size).toBe(2);
    expect(q.pop(2)).toBe(7);
    expect(q.size).toBe(0);
  });

  it('clear empties the queue', () => {
    const q = new ArrivalQueue();
    q.push(1, 3);
    q.clear();
    expect(q.size).toBe(0);
    expect(q.pop(10)).toBe(0);
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
