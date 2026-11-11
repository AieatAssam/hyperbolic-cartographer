import { describe, expect, it } from 'vitest';
import { kleinGraph, torusGraph } from '../src/core/geometry/quotient';
import { createEmbedding, frameAt } from '../src/render/fx-graph';
import { embedKleinImmersion, embedTorus } from '../src/render/embed-providers';
import { kleinImmersionPos } from '../src/render/klein-bottle';
import { kleinParam } from '../src/render/klein-bottle';
import { NO_FLOW, surfaceFrame, surfacePos, torusNormalFromUv, type Tuple3 } from '../src/render/surface-params';

const dist = (a: Tuple3, b: Tuple3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

describe('Klein glide seam', () => {
  it('glued points coincide: F(pi, v) = F(0, pi - v) and seam neighbours match within 1e-2', () => {
    const w = 8, h = 8;
    const g = kleinGraph(w, h);
    // Glide gluing (π, v) ≡ (0, π − v) on the immersion itself.
    for (const v of [0.3, 1.7, 4.0]) {
      const a = kleinImmersionPos(Math.PI, v), b = kleinImmersionPos(0, Math.PI - v);
      expect(dist(a, b)).toBeLessThan(1e-9);
    }
    // Every x-seam flip edge: b in a's lifted chart equals b's own embedded point.
    let flips = 0;
    g.neighbours.forEach((ns, a) => ns.forEach((b) => {
      if (b <= a || !g.flipEdge(a, b)) return;
      flips++;
      const [xa, ya] = g.xy[a], [xb, yb] = g.xy[b];
      // b's lift into a's chart: one period across the seam, row carried by the glide.
      const lifted = kleinParam(xa === 0 ? -0.5 : w + 0.5, ya + 0.5, w, h);
      const own = kleinParam(xb + 0.5, yb + 0.5, w, h);
      const pl = kleinImmersionPos(lifted[0], lifted[1]);
      const po = kleinImmersionPos(own[0], own[1]);
      expect(dist(pl, po)).toBeLessThan(1e-2);
    }));
    expect(flips).toBeGreaterThan(0);
  });

  it('flip edges only cross the x seam (|dx| = w - 1)', () => {
    const g = kleinGraph(8, 8);
    g.neighbours.forEach((ns, a) => ns.forEach((b) => {
      if (!g.flipEdge(a, b)) return;
      expect(Math.abs(g.xy[a][0] - g.xy[b][0])).toBe(7);
    }));
  });

  it('Klein flow glides: a full turn is the identity, half a turn mirrors rows, v is ignored', () => {
    const at = (gx: number, gy: number, u = 0, v = 0) => surfaceFrame('klein', gx, gy, 8, 8, { u, v }).skin;
    expect(dist(at(3.5, 2.5), at(3.5, 2.5, 1))).toBeLessThan(1e-9);
    expect(dist(at(3.5, 2.5, 0.5), at(3.5, 8 - 2.5))).toBeLessThan(1e-9);
    expect(dist(at(3.5, 2.5, 0.2, 0.61), at(3.5, 2.5, 0.2))).toBeLessThan(1e-12);
    expect(dist(at(3.5, 2.5, 0.2), at(3.5, 2.5))).toBeGreaterThan(0.1);
    for (const u of [0.1, 0.33, 0.49999, 0.77]) // continuous across the glide seam while flowing
      expect(dist(at(8 - 1e-4, 2.5, u), at(8 + 1e-4, 2.5, u))).toBeLessThan(1e-2);
  });
});

describe('graph neighbour distances', () => {
  const ratioOk = (pts: Tuple3[], edges: [number, number][]) => {
    const ds = edges.map(([a, b]) => dist(pts[a], pts[b]));
    const m = median(ds);
    return Math.max(...ds) / m;
  };

  // ponytail: measured 3.7x on kleinGraph(8,8). The bottle's u-curves are much longer than its v-curves, so the
  // uniform (u,v) lattice is anisotropic in 3D. Arc-length reparametrisation of u is the upgrade path.
  it('kleinGraph(8,8): embedded neighbours within 4x median (measured 3.7x; anisotropic metric)', () => {
    const g = kleinGraph(8, 8);
    const e = createEmbedding(g.ring.length);
    embedKleinImmersion(g, e);
    const pts = g.ring.map((_, i) => frameAt(e, i).p as Tuple3);
    const edges: [number, number][] = [];
    g.neighbours.forEach((ns, a) => ns.forEach((b) => { if (b > a) edges.push([a, b]); }));
    expect(ratioOk(pts, edges)).toBeLessThan(4);
  });

  it('torusGraph(16,8): embedded neighbours within 2.2x median', () => {
    const g = torusGraph(16, 8);
    const e = createEmbedding(g.ring.length);
    embedTorus(g, e, { chart: false });
    const pts = g.ring.map((_, i) => frameAt(e, i).p as Tuple3);
    const edges: [number, number][] = [];
    g.neighbours.forEach((ns, a) => ns.forEach((b) => { if (b > a) edges.push([a, b]); }));
    expect(ratioOk(pts, edges)).toBeLessThan(2.2);
  });
});

describe('flow and frames', () => {
  it('torus flow is periodic in whole turns', () => {
    const a = surfacePos('torus', 2.3, 5.1, 16, 8, { u: 0.37, v: 0.61 });
    const b = surfacePos('torus', 2.3, 5.1, 16, 8, { u: 1.37, v: -0.39 });
    expect(dist(a, b)).toBeLessThan(1e-9);
    const c = surfacePos('torus', 2.3, 5.1, 16, 8, { u: 0.37, v: 0.61 });
    const d = surfacePos('torus', 2.3, 5.1, 16, 8, NO_FLOW);
    expect(dist(c, d)).toBeGreaterThan(1e-3);
  });

  it('surfaceFrame normals are unit length; torus normal points outward', () => {
    for (const surface of ['torus', 'klein'] as const) {
      for (let gx = 0.5; gx < 8; gx += 1.7) {
        for (let gy = 0.5; gy < 8; gy += 1.3) {
          const f = surfaceFrame(surface, gx, gy, 8, 8);
          expect(Math.hypot(...f.n)).toBeCloseTo(1, 9);
          if (surface === 'torus') {
            const out = torusNormalFromUv(f.u, f.v);
            expect(f.n[0] * out[0] + f.n[1] * out[1] + f.n[2] * out[2]).toBeGreaterThan(0.999);
          }
        }
      }
    }
  });

  it('benchmark: 128 tiles x 7x7 patch samples (pure math, logged only)', () => {
    const t0 = performance.now();
    const S = 6;
    let acc = 0;
    for (let tile = 0; tile < 128; tile++) {
      const x = tile % 16, y = Math.floor(tile / 16) % 8;
      for (let i = 0; i <= S; i++) for (let j = 0; j <= S; j++) {
        acc += surfaceFrame('torus', x + i / S, y + j / S, 16, 8).p[0];
      }
    }
    const ms = performance.now() - t0;
    console.log(`[bench] torus 128 tiles, ${(S + 1) * (S + 1)} samples/tile: ${ms.toFixed(1)} ms (checksum ${acc.toFixed(3)})`);
    expect(Number.isFinite(acc)).toBe(true);
  });
});
