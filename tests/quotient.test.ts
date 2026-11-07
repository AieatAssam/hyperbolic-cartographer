import { describe, expect, it } from 'vitest';
import { eulerCharacteristic, edgeCount, kleinGraph, torusGraph } from '../src/core/geometry/quotient';

const symmetric = (n: number[][]) => n.every((ns, i) => ns.every((j) => n[j].includes(i)));

describe('torus quotient graph', () => {
  const g = torusGraph(6, 6);
  it('has symmetric 4-regular neighbours', () => {
    expect(symmetric(g.neighbours)).toBe(true);
    g.neighbours.forEach((ns) => expect(ns).toHaveLength(4));
  });
  it('Euler characteristic V - E + F = 0 (genus 1)', () => {
    expect(eulerCharacteristic(g)).toBe(0);
    expect(g.ring.length - edgeCount(g) + g.ring.length).toBe(0);
  });
  it('cycle basis has 2 closed loops', () => {
    expect(g.cycleBasis).toHaveLength(2);
    expect(g.cycleBasis[0][0]).toBe(g.cycleBasis[0][g.cycleBasis[0].length - 1]);
    expect(g.cycleBasis[1][0]).toBe(g.cycleBasis[1][g.cycleBasis[1].length - 1]);
  });
  it('no flip edges', () => {
    g.neighbours.forEach((ns, a) => ns.forEach((b) => expect(g.flipEdge(a, b)).toBe(false)));
  });
  it('seam edges exist on boundary wraps', () => {
    const seams = g.neighbours.flatMap((ns, a) => ns.filter((b) => b > a && g.seamEdge(a, b)));
    expect(seams.length).toBeGreaterThan(0);
  });
});

describe('Klein quotient graph', () => {
  const g = kleinGraph(6, 6);
  it('has symmetric neighbours', () => expect(symmetric(g.neighbours)).toBe(true));
  it('Euler characteristic 0', () => expect(eulerCharacteristic(g)).toBe(0));
  it('cycle basis: 1 orientable + 1 flipping route', () => {
    expect(g.cycleBasis).toHaveLength(2);
  });
  it('flip bit on vertical seam only', () => {
    let flips = 0, horiz = 0;
    g.neighbours.forEach((ns, a) => ns.forEach((b) => {
      if (b <= a) return;
      if (g.flipEdge(a, b)) flips++;
      else if (g.seamEdge(a, b)) horiz++;
    }));
    expect(flips).toBeGreaterThan(0);
    expect(horiz).toBeGreaterThan(0);
  });
});
