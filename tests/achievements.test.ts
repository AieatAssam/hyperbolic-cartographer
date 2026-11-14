import { describe, expect, it } from 'vitest';
import Decimal from 'break_eternity.js';
import { ACHIEVEMENTS, achievementBonus, checkAchievements, noteDrift } from '../src/core/achievements';
import { initialState } from '../src/core/state';
import { isActive, place, prod } from '../src/core/economy';
import { simulate } from '../src/core/tick';

describe('achievements', () => {
  it('has 24 unique ids', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(ids).toHaveLength(24);
    expect(new Set(ids).size).toBe(24);
  });

  it('a fresh state earns none', () => {
    const s = initialState();
    expect(checkAchievements(s)).toEqual([]);
    expect(s.achievements).toEqual([]);
  });

  it('placing a tile then simulating 1 s earns firstSpring', () => {
    const s = initialState();
    s.ink = new Decimal(1e6);
    const idx = s.tiles.findIndex((_, i) => isActive(s, i));
    expect(place(s, idx, 'spring')).toBe(true);
    expect(s.stats.tilesPlaced).toBe(1);
    simulate(s, 1);
    expect(s.achievements).toContain('firstSpring');
  });

  it('the bonus multiplies production by 1.01 per achievement', () => {
    const s = initialState();
    s.tiles[0] = 'spring';
    s.ring = Math.max(s.ring, 1);
    const before = prod(s).total;
    s.achievements.push('firstSpring');
    expect(achievementBonus(s)).toBeCloseTo(1.01);
    const after = prod(s).total;
    expect(after / before).toBeCloseTo(1.01);
  });

  it('checkAchievements never duplicates ids', () => {
    const s = initialState();
    s.stats.tilesPlaced = 1000;
    checkAchievements(s);
    const first = s.achievements.length;
    expect(first).toBeGreaterThan(0);
    expect(checkAchievements(s)).toEqual([]);
    expect(s.achievements.length).toBe(first);
    expect(new Set(s.achievements).size).toBe(first);
  });

  it('noteDrift earns quickDrift only when the run was 300 s or less', () => {
    const late = initialState();
    expect(noteDrift(late, 301)).toEqual([]);
    expect(late.achievements).not.toContain('quickDrift');

    const early = initialState();
    expect(noteDrift(early, 300).map((a) => a.id)).toEqual(['quickDrift']);
    expect(early.achievements).toContain('quickDrift');
    expect(noteDrift(early, 10)).toEqual([]);
    expect(early.achievements.filter((id) => id === 'quickDrift')).toHaveLength(1);
  });
});
