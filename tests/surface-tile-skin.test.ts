import { describe, expect, it } from 'vitest';
import { torusGraph, kleinGraph } from '../src/core/geometry/quotient';
import { createEmbedding, frameAt } from '../src/render/fx-graph';
import { embedKleinImmersion, embedTorus } from '../src/render/embed-providers';
import { kleinTileSkinGap, torusTileSkinGap } from '../src/render/surface-params';

describe('manifold tile–skin alignment', () => {
  it('torus 3D: each tile centre sits on the skin within epsilon', () => {
    const g = torusGraph(16, 8);
    const e = createEmbedding(g.ring.length);
    embedTorus(g, e, { chart: false });
    const eps = 0.04;
    for (let i = 0; i < g.ring.length; i++) {
      const [x, y] = g.xy[i];
      const p = frameAt(e, i).p;
      expect(torusTileSkinGap(x, y, g.width, g.height, p)).toBeLessThan(eps);
    }
  });

  it('Klein immersion: each tile centre sits on the skin within epsilon', () => {
    const g = kleinGraph(8, 8);
    const e = createEmbedding(g.ring.length);
    embedKleinImmersion(g, e);
    const eps = 0.06;
    for (let i = 0; i < g.ring.length; i++) {
      const [x, y] = g.xy[i];
      const p = frameAt(e, i).p;
      expect(kleinTileSkinGap(x, y, g.width, g.height, p)).toBeLessThan(eps);
    }
  });
});
