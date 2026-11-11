import { describe, it, expect } from 'vitest';
import { initialQuality, effectiveDpr, stepGovernor, GOVERNOR } from '../src/render/scene';
import type { GovernorState, QualityLevel } from '../src/render/scene';
import { BLOOM, TILE_IDENTITIES } from '../src/art/palette';

const isHex = (n: number) => Number.isInteger(n) && n >= 0 && n <= 0xffffff;

describe('initialQuality', () => {
  it('starts coarse-pointer devices at medium', () => {
    expect(initialQuality({ dpr: 2, coarsePointer: true, minSide: 390 })).toBe(1);
  });

  it('starts desktop wide screens at high', () => {
    expect(initialQuality({ dpr: 1, coarsePointer: false, minSide: 1080 })).toBe(2);
  });
});

describe('effectiveDpr', () => {
  it('caps medium quality at 1.5', () => {
    expect(effectiveDpr(1, 3)).toBe(1.5);
  });

  it('caps low quality at 1 and never goes below 1', () => {
    expect(effectiveDpr(0, 3)).toBe(1);
    expect(effectiveDpr(0, 0.5)).toBe(1);
  });
});

describe('stepGovernor', () => {
  const start = (level: QualityLevel): GovernorState => ({
    level,
    emaMs: 1000 / 60,
    slowFor: 0,
    cooldown: GOVERNOR.cooldownS,
  });

  it('steps down under sustained slow frames, never below 0, never up', () => {
    let g = start(2);
    const levels: number[] = [g.level];
    for (let i = 0; i < 300; i++) {
      g = stepGovernor(g, 1 / 20);
      levels.push(g.level);
    }
    expect(g.level).toBeLessThan(2);
    expect(g.level).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeLessThanOrEqual(levels[i - 1]);
    }
  });

  it('never changes level at a steady 60 fps from level 1', () => {
    let g = start(1);
    for (let i = 0; i < 600; i++) {
      g = stepGovernor(g, 1 / 60);
      expect(g.level).toBe(1);
    }
  });

  it('ignores dt=1 (tab switch / hitch) and returns the same object', () => {
    const g = start(2);
    expect(stepGovernor(g, 1)).toBe(g);
  });
});

describe('palette', () => {
  it('TILE_IDENTITIES has exactly 8 keys, all hex colours in range', () => {
    const entries = Object.entries(TILE_IDENTITIES);
    expect(entries).toHaveLength(8);
    for (const [, token] of entries) {
      expect(isHex(token.base)).toBe(true);
      expect(isHex(token.emissive)).toBe(true);
      expect(isHex(token.accent)).toBe(true);
    }
  });

  it('BLOOM.threshold is between 0.5 and 1.5', () => {
    expect(BLOOM.threshold).toBeGreaterThanOrEqual(0.5);
    expect(BLOOM.threshold).toBeLessThanOrEqual(1.5);
  });
});
