import { describe, expect, it } from 'vitest';
import Decimal from 'break_eternity.js';
import { place, surveyCost } from '../src/core/economy';
import { pickImmediateGoal } from '../src/core/goal-policy';
import { initialState } from '../src/core/state';
import { fmt } from '../src/ui/format';

describe('pickImmediateGoal', () => {
  it('prefers affordable survey over saving for a tile', () => {
    const s = initialState();
    place(s, 0, 'spring');
    place(s, 1, 'mill');
    s.drifts = 1;
    s.projections = 1;
    const cost = surveyCost(s);
    s.ink = cost;
    const g = pickImmediateGoal(s, { fmt });
    expect(g.tier).toBe('unlockProgress');
    expect(g.text).toMatch(/Survey ring/);
    expect(g.eta).toBe('ready');
  });

  it('surfaces affordable chart upgrades before tile savings', () => {
    const s = initialState();
    place(s, 0, 'spring');
    s.charts = new Decimal(5);
    s.drifts = 1;
    s.projections = 1;
    const g = pickImmediateGoal(s, { fmt });
    expect(g.tier).toBe('affordableUpgrade');
    expect(g.text).toMatch(/Buy .*Charts/);
  });

  it('tracks drift progress when not yet ready', () => {
    const s = initialState();
    place(s, 0, 'spring');
    s.runInk = new Decimal(1e4);
    const g = pickImmediateGoal(s, { fmt });
    expect(g.tier).toBe('unlockProgress');
    expect(g.short).toBe('Drift');
    expect(g.progress).toBeGreaterThan(0);
    expect(g.progress).toBeLessThan(1);
  });
});
