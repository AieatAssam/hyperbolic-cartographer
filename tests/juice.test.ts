import { describe, expect, it } from 'vitest';
import { STREAK_MIN, milestoneEvents, rateFlashed, streakCount, type MilestoneFacts } from '../src/ui/juice';

const none: MilestoneFacts = { linked: false, survey: false, beacon: false, drift: false };

describe('juice helpers', () => {
  it('counts placements inside the 4 s streak window only', () => {
    const now = 10_000;
    expect(streakCount([1_000, 7_000, 8_000, 9_500], now)).toBe(3);
    expect(streakCount([], now)).toBe(0);
    expect(STREAK_MIN).toBe(3);
  });

  it('flashes the rate on a real rise (>10%) or from zero, not on noise', () => {
    expect(rateFlashed(0, 1.1)).toBe(true);
    expect(rateFlashed(1, 1.05)).toBe(false);
    expect(rateFlashed(1, 1.2)).toBe(true);
    expect(rateFlashed(1, 0)).toBe(false);
    expect(rateFlashed(Number.NaN, 5)).toBe(false);
  });

  it('reports each milestone once, on the false-to-true edge', () => {
    expect(milestoneEvents(null, { ...none, linked: true })).toEqual([]);
    expect(milestoneEvents(none, { ...none, linked: true, drift: true })).toEqual(['linked', 'drift']);
    expect(milestoneEvents({ ...none, linked: true }, { ...none, linked: true })).toEqual([]);
  });
});
