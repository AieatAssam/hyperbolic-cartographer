import { describe, expect, it } from 'vitest';
import { SQUASH_S, TRANSITION_S, squash, transitionPhase } from '../src/render/transition';

describe('squash', () => {
  it('starts at 1.25 at t=0', () => {
    expect(squash(0)).toBeCloseTo(1.25, 10);
  });

  it('returns 1 at and beyond SQUASH_S', () => {
    expect(squash(SQUASH_S)).toBe(1);
    expect(squash(SQUASH_S + 0.5)).toBe(1);
  });

  it('returns 1 for NaN and negative input', () => {
    expect(squash(NaN)).toBe(1);
    expect(squash(-0.1)).toBe(1);
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
