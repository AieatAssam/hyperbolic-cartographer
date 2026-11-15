import { describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { CONSTELLATION_FIGURES } from '../src/ui/constellation-art';

describe('constellation figures', () => {
  const ids = Object.keys(config.constellations) as (keyof typeof config.constellations)[];

  it('has a figure for every constellation id', () => {
    for (const id of ids) expect(CONSTELLATION_FIGURES[id], id).toBeDefined();
    expect(Object.keys(CONSTELLATION_FIGURES).sort()).toEqual([...ids].sort());
  });

  it.each(ids)('%s: 5-9 stars, coordinates in 0..100, magnitudes 1-3', (id) => {
    const { stars } = CONSTELLATION_FIGURES[id];
    expect(stars.length).toBeGreaterThanOrEqual(5);
    expect(stars.length).toBeLessThanOrEqual(9);
    for (const s of stars) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(100);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(100);
      expect([1, 2, 3]).toContain(s.m);
    }
  });

  it.each(ids)('%s: lines reference valid, distinct stars', (id) => {
    const { stars, lines } = CONSTELLATION_FIGURES[id];
    expect(lines.length).toBeGreaterThan(0);
    for (const [a, b] of lines) {
      expect(Number.isInteger(a) && a >= 0 && a < stars.length).toBe(true);
      expect(Number.isInteger(b) && b >= 0 && b < stars.length).toBe(true);
      expect(a).not.toBe(b);
    }
  });

  it.each(ids)('%s: the figure is one connected piece', (id) => {
    const { stars, lines } = CONSTELLATION_FIGURES[id];
    const seen = new Set<number>([0]);
    const queue = [0];
    while (queue.length) {
      const v = queue.shift()!;
      for (const [a, b] of lines) {
        const next = a === v ? b : b === v ? a : -1;
        if (next >= 0 && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(stars.length);
  });

  it.each(ids)('%s: no two stars closer than 8 units', (id) => {
    const { stars } = CONSTELLATION_FIGURES[id];
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const d = Math.hypot(stars[i].x - stars[j].x, stars[i].y - stars[j].y);
        expect(d, `${id} ${i}-${j}`).toBeGreaterThanOrEqual(8);
      }
    }
  });
});
