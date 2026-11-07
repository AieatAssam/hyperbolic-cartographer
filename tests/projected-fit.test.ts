import { describe, expect, it } from 'vitest';
import { boxCorners, minOrbitDistance, rotY } from '../src/render/projected-fit';
import { kleinBottleAabb, torusFitAabb } from '../src/render/surface-params';

describe('projected manifold fit (pure)', () => {
  it('torus AABB corners stay inside board rect at sampled spins', () => {
    const { lo, hi } = torusFitAabb();
    const corners = boxCorners(lo, hi);
    const free = { left: 0, top: 48, right: 390, bottom: 700 };
    const d = minOrbitDistance({
      corners,
      spinSteps: 8,
      target: [0, 0.1, 0],
      polar: 1.08,
      azimuth: Math.PI * 0.32,
      W: 390,
      H: 844,
      free,
      fovDeg: 50,
      margin: 16,
      fill: 0.65,
    });
    expect(d).toBeGreaterThan(2);
    expect(d).toBeLessThan(200);
  });

  it('Klein bottle AABB is non-degenerate', () => {
    const { lo, hi } = kleinBottleAabb();
    expect(hi[0] - lo[0]).toBeGreaterThan(1);
    expect(hi[1] - lo[1]).toBeGreaterThan(2);
    const corners = boxCorners(lo, hi);
    const spun = corners.map((c) => rotY(c, 0.7));
    expect(spun[0][0]).not.toBeCloseTo(corners[0][0]);
  });

  it('Klein AABB corners fit phone free rect', () => {
    const { lo, hi } = kleinBottleAabb();
    const corners = boxCorners(lo, hi);
    const free = { left: 0, top: 48, right: 390, bottom: 700 };
    const d = minOrbitDistance({
      corners,
      spinSteps: 8,
      target: [0, 0, 0],
      polar: 0.88,
      azimuth: Math.PI * 0.32,
      W: 390,
      H: 844,
      free,
      fovDeg: 50,
      margin: 16,
      fill: 0.65,
    });
    expect(d).toBeGreaterThan(2);
    expect(d).toBeLessThan(200);
  });
});
