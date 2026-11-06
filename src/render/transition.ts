// Pure transition, placement-curve and prestige timing. No DOM, no Three imports.

import { PLACE } from '../art/palette';

export const TRANSITION_S = 1.5;
/** Placement curve length. Exactly 1 from here on. Kept as a name for board.ts. */
export const SQUASH_S = PLACE.life;

/** GLSL float literal: always has a decimal point. */
const glslF = (x: number) => {
  const s = String(x);
  return /[.e]/.test(s) ? s : `${s}.0`;
};

/**
 * Placement scale at t seconds after placement, Y only:
 * - [0, dip]: ease-in compression from 1 to 1 − squash (anticipation).
 * - after dip: damped rebound 1 − squash · e^(−decay·τ) · cos(omega·τ), with τ = t − dip. Peak about 1.098, and
 *   within 0.01 of 1 by 0.45 s.
 * - t < 0, NaN, or t ≥ PLACE.life: exactly 1.
 */
export function placeScale(t: number): number {
  if (!(t >= 0) || t >= PLACE.life) return 1;
  if (t < PLACE.dip) {
    const s = t / PLACE.dip;
    return 1 - PLACE.squash * s * s;
  }
  const tau = t - PLACE.dip;
  return 1 - PLACE.squash * Math.exp(-PLACE.decay * tau) * Math.cos(PLACE.omega * tau);
}

/**
 * GLSL source for placeScale, built from PLACE so the shader and the TS curve cannot drift. Insert it once, in the
 * common section of the vertex shader. Callers still gate on t < PLACE.life, as the TS function does.
 */
export function placeGlsl(): string {
  return `float placeScale(float t) {
  if (t < 0.0 || t >= ${glslF(PLACE.life)}) return 1.0;
  if (t < ${glslF(PLACE.dip)}) {
    float s = t / ${glslF(PLACE.dip)};
    return 1.0 - ${glslF(PLACE.squash)} * s * s;
  }
  float tau = t - ${glslF(PLACE.dip)};
  return 1.0 - ${glslF(PLACE.squash)} * exp(-${glslF(PLACE.decay)} * tau) * cos(${glslF(PLACE.omega)} * tau);
}`;
}

export type Phase = 'out' | 'in' | 'done';

export function transitionPhase(elapsed: number, total = TRANSITION_S): { phase: Phase; k: number } {
  const h = total / 2;
  if (!(elapsed >= 0)) return { phase: 'out', k: 0 };
  if (elapsed < h) return { phase: 'out', k: elapsed / h };
  if (elapsed < total) return { phase: 'in', k: (elapsed - h) / h };
  return { phase: 'done', k: 1 };
}

export type PrestigeKind = 'drift' | 'projection';

/**
 * One overlay window of a prestige transition, in absolute seconds from the transition start.
 * - effect: 'wash' (Drift ink front), 'vortex' (Projection spiral), 'reveal' (survey-style ring wave over the board).
 * - alpha: maximum overlay opacity. countScale: multiplier on overlay particle counts (0.3 under reduced motion).
 * - spin: false under reduced motion, so the vortex does not rotate.
 */
export interface PrestigeWindow {
  effect: 'wash' | 'vortex' | 'reveal';
  phase: 'out' | 'in';
  start: number;
  end: number;
  alpha: number;
  countScale: number;
  spin: boolean;
}

/**
 * Spawn windows for a prestige transition of `total` seconds, split at the swap (half).
 * Invariants (tests check them):
 * - outgoing windows start at ≥ 0 and end at ≤ half, so nothing is still alive when the old board is cleared;
 * - incoming windows start at ≥ half and end at ≤ total + 0.25 s;
 * - Drift: outgoing wash alpha ≤ 0.45; incoming wash alpha ≤ 0.3 plus a board reveal wave;
 * - Projection: outgoing vortex collapses to radius 0 at half; incoming vortex reverses outward plus a reveal wave.
 * A non-finite or non-positive total falls back to TRANSITION_S.
 */
export function prestigeTimeline(kind: PrestigeKind, total = TRANSITION_S, reduced = false): PrestigeWindow[] {
  const T = Number.isFinite(total) && total > 0 ? total : TRANSITION_S;
  const half = T / 2;
  const countScale = reduced ? 0.3 : 1;
  const win = (w: Omit<PrestigeWindow, 'countScale' | 'spin'> & { spin?: boolean }): PrestigeWindow => ({
    ...w, countScale, spin: !!w.spin && !reduced,
  });
  if (kind === 'drift') {
    return [
      win({ effect: 'wash', phase: 'out', start: 0, end: half, alpha: 0.45 }),
      win({ effect: 'wash', phase: 'in', start: half, end: T + 0.25, alpha: 0.3 }),
      win({ effect: 'reveal', phase: 'in', start: half, end: T, alpha: 1 }),
    ];
  }
  return [
    win({ effect: 'vortex', phase: 'out', start: 0, end: half, alpha: 1, spin: true }),
    win({ effect: 'vortex', phase: 'in', start: half, end: T + 0.25, alpha: 1, spin: true }),
    win({ effect: 'reveal', phase: 'in', start: half, end: T, alpha: 1 }),
  ];
}
