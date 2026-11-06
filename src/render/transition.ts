// Pure transition and squash timing. No DOM, no Three imports.

export const TRANSITION_S = 1.5;
export const SQUASH_S = 0.6;

export function squash(t: number): number {
  if (!(t >= 0) || t >= SQUASH_S) return 1;
  return 1 + 0.25 * Math.exp(-8 * t) * Math.cos(18 * t);
}

export type Phase = 'out' | 'in' | 'done';

export function transitionPhase(elapsed: number, total = TRANSITION_S): { phase: Phase; k: number } {
  const h = total / 2;
  if (!(elapsed >= 0)) return { phase: 'out', k: 0 };
  if (elapsed < h) return { phase: 'out', k: elapsed / h };
  if (elapsed < total) return { phase: 'in', k: (elapsed - h) / h };
  return { phase: 'done', k: 1 };
}
