import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLACE } from '../src/art/palette';
import {
  SQUASH_S,
  TRANSITION_S,
  placeGlsl,
  placeScale,
  prestigeTimeline,
  transitionPhase,
} from '../src/render/transition';

describe('placeScale', () => {
  it('starts at exactly 1, not the old 1.25 overshoot', () => {
    expect(placeScale(0)).toBe(1);
    expect(placeScale(0)).toBeLessThan(1.25);
  });

  it('compresses (anticipation) to 1 − squash at the impact instant', () => {
    expect(placeScale(PLACE.dip)).toBeCloseTo(1 - PLACE.squash, 9);
  });

  it('compresses monotonically from 1 down to the impact instant', () => {
    let prev = placeScale(0);
    for (let t = 0.005; t <= PLACE.dip + 1e-9; t += 0.005) {
      const v = placeScale(t);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
  });

  it('is continuous across the impact instant', () => {
    expect(Math.abs(placeScale(PLACE.dip - 1e-6) - placeScale(PLACE.dip + 1e-6))).toBeLessThan(1e-4);
  });

  it('rebounds to a peak of at most 1.10 near 0.13 s', () => {
    let peak = 0, at = 0;
    for (let t = PLACE.dip; t < SQUASH_S; t += 0.0005) {
      const v = placeScale(t);
      if (v > peak) (peak = v), (at = t);
    }
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThanOrEqual(1.1);
    expect(at).toBeGreaterThan(0.11);
    expect(at).toBeLessThan(0.15);
  });

  it('is within 0.01 of 1 by 0.45 s', () => {
    for (let t = 0.45; t < SQUASH_S; t += 0.005) expect(Math.abs(placeScale(t) - 1)).toBeLessThan(0.01);
  });

  it('never leaves the band 1 ± squash, so the anticipation and rebound stay bounded', () => {
    for (let t = 0; t <= SQUASH_S; t += 0.0005) {
      const v = placeScale(t);
      expect(v).toBeGreaterThanOrEqual(1 - PLACE.squash - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + PLACE.squash + 1e-9);
    }
  });

  it('is exactly 1 at and after SQUASH_S, and NaN or negative input is 1', () => {
    expect(SQUASH_S).toBe(PLACE.life);
    expect(placeScale(SQUASH_S)).toBe(1);
    expect(placeScale(SQUASH_S + 1)).toBe(1);
    expect(placeScale(NaN)).toBe(1);
    expect(placeScale(-0.1)).toBe(1);
  });

  it('stays finite over its whole domain', () => {
    for (let t = -0.5; t <= 1; t += 0.001) expect(Number.isFinite(placeScale(t))).toBe(true);
  });
});

describe('placeGlsl', () => {
  it('defines placeScale and embeds every PLACE constant as a GLSL float literal', () => {
    const src = placeGlsl();
    expect(src).toMatch(/float placeScale\(float t\)/);
    for (const v of [PLACE.dip, PLACE.squash, PLACE.decay, PLACE.omega, PLACE.life]) {
      const lit = Number.isInteger(v) ? `${v}.0` : String(v);
      expect(src.includes(lit), `literal ${lit}`).toBe(true);
    }
  });

  it('has no unsuffixed integer literals (GLSL needs a float)', () => {
    expect(placeGlsl()).not.toMatch(/[(*\-+/ ]\d+[^.\d]/);
  });
});

describe('transitionPhase', () => {
  it('is out with k=0 at t=0', () => {
    expect(transitionPhase(0)).toEqual({ phase: 'out', k: 0 });
  });

  it('is in with k=0 at the midpoint', () => {
    const r = transitionPhase(TRANSITION_S / 2);
    expect(r.phase).toBe('in');
    expect(r.k).toBeCloseTo(0, 10);
  });

  it('is out with k=0.5 at a quarter of the way', () => {
    expect(transitionPhase(0.375)).toEqual({ phase: 'out', k: 0.5 });
  });

  it('is done with k=1 at the total duration', () => {
    expect(transitionPhase(TRANSITION_S)).toEqual({ phase: 'done', k: 1 });
  });

  it('treats negative elapsed as out with k=0', () => {
    expect(transitionPhase(-1)).toEqual({ phase: 'out', k: 0 });
  });
});

describe('prestigeTimeline', () => {
  const kinds = ['drift', 'projection'] as const;
  const totals = [TRANSITION_S, 0.4, 3, 6];

  for (const kind of kinds) {
    for (const total of totals) {
      it(`${kind} over ${total}s: outgoing ends by the swap, incoming ends by total + 0.25 s`, () => {
        const half = total / 2;
        for (const reduced of [false, true]) {
          for (const w of prestigeTimeline(kind, total, reduced)) {
            expect(Number.isFinite(w.start) && Number.isFinite(w.end)).toBe(true);
            expect(w.end).toBeGreaterThan(w.start);
            if (w.phase === 'out') {
              expect(w.start).toBeGreaterThanOrEqual(0);
              expect(w.end).toBeLessThanOrEqual(half + 1e-12);
            } else {
              expect(w.start).toBeGreaterThanOrEqual(half - 1e-12);
              expect(w.end).toBeLessThanOrEqual(total + 0.25 + 1e-12);
            }
          }
        }
      });
    }
  }

  it('caps the Drift outgoing wash alpha at 0.45 and the incoming wash at 0.3', () => {
    const tl = prestigeTimeline('drift');
    expect(tl.find((w) => w.effect === 'wash' && w.phase === 'out')!.alpha).toBeLessThanOrEqual(0.45);
    expect(tl.find((w) => w.effect === 'wash' && w.phase === 'in')!.alpha).toBeLessThanOrEqual(0.3);
  });

  it('collapses the Projection vortex exactly at the swap', () => {
    const out = prestigeTimeline('projection').find((w) => w.effect === 'vortex' && w.phase === 'out')!;
    expect(out.end).toBe(TRANSITION_S / 2);
  });

  it('gives every Drift and Projection a reveal wave on the incoming side', () => {
    for (const kind of kinds) {
      const reveal = prestigeTimeline(kind).find((w) => w.effect === 'reveal');
      expect(reveal?.phase).toBe('in');
    }
  });

  it('under reduced motion scales overlay counts by 0.3 and stops the vortex spin', () => {
    for (const w of prestigeTimeline('projection', TRANSITION_S, true)) {
      expect(w.countScale).toBe(0.3);
      expect(w.spin).toBe(false);
    }
    expect(prestigeTimeline('projection').some((w) => w.spin)).toBe(true);
  });

  it('reveal waves run from the swap to the end of the transition, for both kinds', () => {
    for (const kind of kinds) {
      const reveal = prestigeTimeline(kind).find((w) => w.effect === 'reveal')!;
      expect(reveal.start).toBe(TRANSITION_S / 2);
      expect(reveal.end).toBe(TRANSITION_S);
    }
  });

  it('keeps the same windows under reduced motion, only with fewer counts and no spin', () => {
    for (const kind of kinds) {
      const full = prestigeTimeline(kind);
      const reduced = prestigeTimeline(kind, TRANSITION_S, true);
      expect(reduced.map(({ effect, phase, start, end, alpha }) => ({ effect, phase, start, end, alpha })))
        .toEqual(full.map(({ effect, phase, start, end, alpha }) => ({ effect, phase, start, end, alpha })));
    }
  });

  it('falls back to the default total for a non-finite or non-positive total', () => {
    expect(prestigeTimeline('drift', NaN)).toEqual(prestigeTimeline('drift', TRANSITION_S));
    expect(prestigeTimeline('drift', -2)).toEqual(prestigeTimeline('drift', TRANSITION_S));
  });
});

describe('transition module purity', () => {
  it('imports neither Three nor the DOM', () => {
    const src = readFileSync(new URL('../src/render/transition.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from ['"]three['"]/);
    expect(src).not.toMatch(/\bdocument\./);
    expect(src).not.toMatch(/\bwindow\./);
  });
});
