import { describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { flowCell, shapeFrame, shapePos, target3d } from '../src/render/surface-shape';
import { chartCell } from '../src/render/surface-params';

const m = config.manifold;
const P = () => [0, 0, 0];

describe('surface shape', () => {
  it('morph 0 is the flat chart', () => {
    const out = P(), cell = chartCell(16, 8);
    shapePos('torus', 3.5, 2.5, 16, 8, 0, out);
    expect(out[0]).toBeCloseTo((3.5 - 8) * cell);
    expect(out[1]).toBe(0);
    expect(out[2]).toBeCloseTo((2.5 - 4) * cell);
    const f = new Float64Array(9);
    shapeFrame('mobius', 5.5, 1.5, 24, 4, 0, f);
    expect(f[4]).toBeCloseTo(1); // chart normal is +Y
  });

  it('torus target lies on the torus with outward normals', () => {
    const f = new Float64Array(9);
    for (let gx = 0.5; gx < 16; gx += 1.7) for (let gy = 0.25; gy < 8; gy += 0.9) {
      shapeFrame('torus', gx, gy, 16, 8, 1, f);
      const rho = Math.hypot(f[0], f[2]);
      expect((rho - m.torusMajorR) ** 2 + f[1] ** 2).toBeCloseTo(m.torusMinorR ** 2, 4);
      const cx = (f[0] / rho) * m.torusMajorR, cz = (f[2] / rho) * m.torusMajorR;
      expect(f[3] * (f[0] - cx) + f[4] * f[1] + f[5] * (f[2] - cz)).toBeGreaterThan(0);
    }
  });

  it('Möbius and Klein glue x with a flip of y; torus wraps both ways', () => {
    const a = P(), b = P();
    for (const [surf, w, h] of [['mobius', 24, 4], ['klein', 8, 8]] as const) {
      for (const [gx, gy] of [[0.3, 0.7], [5.2, 2.9], [1, 3.5]]) {
        target3d(surf, gx + w, gy, w, h, a);
        target3d(surf, gx, h - gy, w, h, b);
        for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k], 3);
      }
    }
    target3d('torus', 2.2 + 16, 3.1 + 8, 16, 8, a);
    target3d('torus', 2.2, 3.1, 16, 8, b);
    for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k], 6);
  });

  it('Klein tiles face out of the tube near the body', () => {
    const f = new Float64Array(9), c = P();
    let out = 0, n = 0;
    for (let gx = 0.5; gx < 8; gx += 1) {
      // tube centre = mean of the ring at this gx
      c[0] = c[1] = c[2] = 0;
      const q = P();
      for (let gy = 0; gy < 8; gy += 0.5) { target3d('klein', gx, gy, 8, 8, q); c[0] += q[0] / 16; c[1] += q[1] / 16; c[2] += q[2] / 16; }
      for (let gy = 0.5; gy < 8; gy += 1) {
        shapeFrame('klein', gx, gy, 8, 8, 1, f);
        n++;
        if (f[3] * (f[0] - c[0]) + f[4] * (f[1] - c[1]) + f[5] * (f[2] - c[2]) > 0) out++;
      }
    }
    expect(out / n).toBeGreaterThan(0.9);
  });

  it('flow: one lap mirrors Möbius tiles, two laps bring them home', () => {
    const o = P();
    expect(flowCell('mobius', 3.5, 0.5, 24, 4, 1, 0, o)).toBe(1);
    expect(o[0]).toBeCloseTo(3.5);
    expect(o[1]).toBeCloseTo(3.5);
    expect(flowCell('mobius', 3.5, 0.5, 24, 4, 2, 0, o)).toBe(0);
    expect(o[1]).toBeCloseTo(0.5);
    expect(flowCell('torus', 15.5, 7.5, 16, 8, 1 / 16, 1 / 8, o)).toBe(0);
    expect(o[0]).toBeCloseTo(0.5);
    expect(o[1]).toBeCloseTo(0.5);
  });
});
