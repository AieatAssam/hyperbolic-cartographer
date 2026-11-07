import { describe, expect, it } from 'vitest';
import { squareGraph } from '../src/core/geometry/square';
import { hyperGraph, identity } from '../src/core/geometry/hyperbolic';
import { kleinGraph, torusGraph } from '../src/core/geometry/quotient';
import { createEmbedding, frameAt, EMBED_STRIDE, EDGE_PATH_K, legPoint, legPointPath } from '../src/render/fx-graph';
import { embedDisk, embedKlein, embedPlane, embedTorus } from '../src/render/embed-providers';

describe('C0 embed providers pin plane/disk frames', () => {
  it('plane: pitch 1 and +Y normals at unit scale', () => {
    const g = squareGraph(3);
    const e = createEmbedding(g.ring.length);
    embedPlane(g, e);
    expect(e.pitch).toBe(1);
    for (let i = 0; i < g.ring.length; i++) {
      const f = frameAt(e, i);
      expect(f.s).toBe(1);
      expect(f.n[1]).toBeCloseTo(1, 6);
      expect(f.p[0]).toBeCloseTo(g.xy[i][0], 6);
      expect(f.p[2]).toBeCloseTo(g.xy[i][1], 6);
    }
  });

  it('disk: finite pitch and rim scale below 1', () => {
    const g = hyperGraph(3);
    const e = createEmbedding(g.ring.length);
    embedDisk(g, e, { view: identity() });
    expect(e.pitch).toBeGreaterThan(0);
    const rim = g.ring.findIndex((r) => r === g.ring.reduce((m, x) => Math.max(m, x), 0));
    expect(frameAt(e, rim).s).toBeLessThan(1);
  });
});

describe('C1 edge LUT and chirality texel', () => {
  it('stores EDGE_PATH_K samples per edge', () => {
    const g = squareGraph(2);
    const e = createEmbedding(g.ring.length);
    embedPlane(g, e);
    expect(e.edgePath).toBeDefined();
    expect(e.edgePathRows).toBeGreaterThan(0);
    expect(e.edgePath!.length).toBe(e.edgePathRows! * EDGE_PATH_K * 3);
  });

  it('legPointPath matches legPoint on plane within tolerance', () => {
    const g = squareGraph(2);
    const e = createEmbedding(g.ring.length);
    embedPlane(g, e);
    const [a, b] = [0, 1];
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      const p0 = legPoint(e, a, b, u);
      const p1 = legPointPath(e, g, a, b, u);
      expect(Math.hypot(p0[0] - p1[0], p0[1] - p1[1], p0[2] - p1[2])).toBeLessThan(0.5);
    }
  });

  it('EMBED_STRIDE packs tangent and chi', () => {
    const e = createEmbedding(1);
    embedPlane(squareGraph(1), e);
    expect(e.data.length).toBe(EMBED_STRIDE);
    expect(e.data[11]).toBe(1);
  });
});

describe('torus and Klein providers', () => {
  it('torus 3D frames are finite', () => {
    const g = torusGraph(4, 4);
    const e = createEmbedding(g.ring.length);
    embedTorus(g, e, { chart: false });
    e.data.forEach((v, i) => i % EMBED_STRIDE !== 3 && expect(Number.isFinite(v)).toBe(true));
  });

  it('Klein chart has seam metadata and portals', () => {
    const g = kleinGraph(4, 4);
    const e = createEmbedding(g.ring.length);
    embedKlein(g, e);
    expect(e.seam).toBeDefined();
    expect(e.portals!.length).toBeGreaterThan(0);
    expect(e.chart2d!.length).toBe(g.ring.length * 2);
  });
});
