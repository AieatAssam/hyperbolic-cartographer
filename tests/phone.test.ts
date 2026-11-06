import { describe, expect, it } from 'vitest';
import { GRAPHS } from '../src/core/state';
import { apply, boost, boostToOrigin, mul, rot, type HyperBoard, type Mat3, type Vec3 } from '../src/core/geometry/hyperbolic';

const HB = GRAPHS.hyper as HyperBoard; // {7,3} board with centres and corners (typed TileGraph in the registry)
const ETA = [1, 1, -1];
const mdot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] - a[2] * b[2];
/** Mᵀ J M with J = diag(1, 1, −1); should equal J for any Lorentz matrix. */
function lorentzCheck(m: Mat3): number[] {
  const out: number[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += m[k * 3 + i] * ETA[k] * m[k * 3 + j];
      out.push(s);
    }
  return out;
}

const ring4 = HB.ring.map((r, i) => (r === 4 ? i : -1)).filter((i) => i >= 0);
// A non-trivial current view (pan + rotation) so the centring is not tested against the identity only.
const VIEW = mul(boost(0.8, 0.6), mul(rot(0.9), boost(0.35, -1.2)));

describe('boostToOrigin', () => {
  it('ring-4 cells exist in the generated {7,3} graph', () => expect(ring4.length).toBe(147));

  it('maps every ring-4 centre to (0,0,1) within 1e-9', () => {
    for (const i of ring4) {
      const c = HB.centers[i];
      const o = apply(boostToOrigin(c), c);
      expect(Math.abs(o[0])).toBeLessThan(1e-9);
      expect(Math.abs(o[1])).toBeLessThan(1e-9);
      expect(Math.abs(o[2] - 1)).toBeLessThan(1e-9);
    }
  });

  it('preserves the Minkowski norm: <p,p> = -1 for transformed corners', () => {
    for (const i of ring4) {
      const B = boostToOrigin(HB.centers[i]);
      for (const v of HB.verts[i]) {
        const w = apply(B, v);
        expect(Math.abs(mdot(w, w) + 1)).toBeLessThan(1e-9);
      }
    }
  });

  it('satisfies Mᵀ J M = J', () => {
    const J = [1, 0, 0, 0, 1, 0, 0, 0, -1];
    for (const i of ring4) {
      const M = boostToOrigin(HB.centers[i]);
      lorentzCheck(M).forEach((v, k) => expect(Math.abs(v - J[k])).toBeLessThan(1e-9));
    }
  });

  it('centring a ring-4 cell in a panned view (view′ = B·view) puts that cell at the origin', () => {
    for (const i of ring4) {
      const shown = apply(VIEW, HB.centers[i]);
      const next = mul(boostToOrigin(shown), VIEW);
      const o = apply(next, HB.centers[i]);
      expect(Math.abs(o[0])).toBeLessThan(1e-9);
      expect(Math.abs(o[1])).toBeLessThan(1e-9);
      expect(Math.abs(o[2] - 1)).toBeLessThan(1e-9);
    }
  });

  it('centring preserves hyperbolic distances between cells (isometry of the view)', () => {
    const i = ring4[7], j = ring4[80];
    const B = boostToOrigin(apply(VIEW, HB.centers[i]));
    const a = apply(VIEW, HB.centers[i]), b = apply(VIEW, HB.centers[j]);
    const a2 = apply(mul(B, VIEW), HB.centers[i]), b2 = apply(mul(B, VIEW), HB.centers[j]);
    expect(Math.abs(Math.acosh(-mdot(a, b)) - Math.acosh(-mdot(a2, b2)))).toBeLessThan(1e-9);
  });

  it('is a no-op on the origin', () => {
    expect(apply(boostToOrigin([0, 0, 1]), [0, 0, 1])[2]).toBeCloseTo(1, 12);
  });
});
