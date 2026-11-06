import { describe, expect, it } from 'vitest';
import { ringCounts } from '../src/core/geometry/graph';
import { squareGraph } from '../src/core/geometry/square';
import { apply, boost, dist, hyperGraph, inverse, mul, orthonormalize, rot } from '../src/core/geometry/hyperbolic';

const symmetric = (n: number[][]) => n.every((ns, i) => ns.every((j) => n[j].includes(i)));

describe('square', () => {
  const g = squareGraph(3);
  it('ring counts', () => expect(ringCounts(g)).toEqual([1, 8, 16, 24]));
  it('symmetric, 4 neighbours inside', () => {
    expect(symmetric(g.neighbours)).toBe(true);
    g.ring.forEach((r, i) => r < 3 && expect(g.neighbours[i]).toHaveLength(4));
  });
});

describe('{7,3}', () => {
  const g = hyperGraph(4);
  it('ring counts 1,7,21,56,147', () => expect(ringCounts(g)).toEqual([1, 7, 21, 56, 147]));
  it('interior tiles have 7 neighbours', () => g.ring.forEach((r, i) => r < 4 && expect(g.neighbours[i]).toHaveLength(7)));
  it('neighbours symmetric', () => expect(symmetric(g.neighbours)).toBe(true));
  it('adjacent tiles share exactly 2 vertices', () => {
    for (const j of g.neighbours[5]) {
      const shared = g.verts[5].filter((v) => g.verts[j].some((w) => dist(v, w) < 1e-6));
      expect(shared).toHaveLength(2);
    }
  });
  it('boost then inverse returns to origin', () => {
    const m = mul(boost(2.3, 0.7), mul(rot(1.1), boost(0.9, -2)));
    const back = apply(mul(inverse(m), m), [0, 0, 1]);
    expect(dist(back, [0, 0, 1])).toBeLessThan(1e-6);
    expect(dist(apply(orthonormalize(m), [0, 0, 1]), apply(m, [0, 0, 1]))).toBeLessThan(1e-6);
  });
});
