import { describe, expect, it } from 'vitest';
import Decimal from 'break_eternity.js';
import { config } from '../src/core/config';
import { graphOf, initialState, type GameState } from '../src/core/state';
import { place } from '../src/core/economy';
import type { TileType } from '../src/core/tiles';
import { explainNow, GOAL_ICONS, immediateGoal, longGoal } from '../src/ui/goals';
import { fmt } from '../src/ui/format';

const fill = (s: GameState, types: TileType[]) => {
  const g = graphOf(s);
  let k = 0;
  s.tiles = s.tiles.map((_, i) => (g.ring[i] <= s.ring ? types[k++ % types.length] : null));
};

describe('immediateGoal', () => {
  it('fresh state asks for a Spring', () => {
    const g = immediateGoal(initialState());
    expect(g.text).toContain('Spring');
    expect(g.progress).toBeGreaterThanOrEqual(0);
    expect(g.progress).toBeLessThanOrEqual(1);
    expect(g.eta).toBe('ready');
  });

  it('after placing a spring the next goal is a Mill', () => {
    const s = initialState();
    place(s, 0, 'spring');
    const g = immediateGoal(s);
    expect(g.text).toContain('Mill');
    expect(Number.isFinite(g.progress)).toBe(true);
  });

  it('reports Drift as ready when a run has enough Ink', () => {
    const s = initialState();
    s.tiles[0] = 'spring';
    s.runInk = new Decimal(1e7);
    const g = immediateGoal(s);
    expect(g.text).toMatch(/^Drift is ready for \d.* Charts: open the Drift tab$/);
    expect(g.progress).toBe(1);
    expect(g.eta).toBe('ready');
  });

  it('reports Projection as ready when charts are enough', () => {
    const s = initialState();
    s.tiles[0] = 'spring';
    s.drifts = 1;
    s.cycleCharts = new Decimal(config.projection.minCharts);
    expect(immediateGoal(s).text).toBe('Projection is ready: open the Projection tab');
  });

  it('progress and eta stay finite for huge and empty states', () => {
    const s = initialState();
    s.ink = new Decimal('1e400');
    s.tiles[0] = 'mill';
    const g = immediateGoal(s);
    expect(Number.isFinite(g.progress)).toBe(true);
    expect(g.progress).toBeLessThanOrEqual(1);
    expect(g.eta).not.toMatch(/NaN|Infinity/);
  });
});

describe('immediateGoal short label', () => {
  // Names must fit the 42px chip without ellipsis: at most 7 characters, never cut
  const shortOk = (g: { short: string; icon: string }) => {
    expect(g.short.length).toBeGreaterThan(0);
    expect(g.short.length).toBeLessThanOrEqual(7);
    expect(g.short).not.toMatch(/…|\.\.\.|\s/);
    expect(GOAL_ICONS).toContain(g.icon);
  };

  it('fresh state: compact Spring, full sentence unchanged', () => {
    const g = immediateGoal(initialState());
    shortOk(g);
    expect(g.short).toBe('Spring');
    expect(g.icon).toBe('spring');
    expect(g.text).toContain('Place a Spring');
  });

  it('Mill branch after the first Spring', () => {
    const s = initialState();
    place(s, 0, 'spring');
    const g = immediateGoal(s);
    shortOk(g);
    expect(g.short).toBe('Mill');
    expect(g.icon).toBe('mill');
  });

  it('Drift and Projection readiness', () => {
    const drift = initialState();
    drift.tiles[0] = 'spring';
    drift.runInk = new Decimal(1e7);
    expect(immediateGoal(drift).short).toBe('Drift');
    expect(immediateGoal(drift).icon).toBe('drift');

    const proj = initialState();
    proj.tiles[0] = 'spring';
    proj.drifts = 1;
    proj.cycleCharts = new Decimal(config.projection.minCharts);
    const g = immediateGoal(proj);
    shortOk(g);
    expect(g.short).toBe('Project');
    expect(g.icon).toBe('project');
  });

  it('Survey branch carries the ring number', () => {
    const s = initialState();
    s.ring = 0;
    fill(s, ['spring', 'mill']);
    s.projections = 1;
    s.drifts = 1;
    const g = immediateGoal(s);
    expect(g.text).toBe(`Survey ring ${s.ring + 1} for more cells`);
    shortOk(g);
    expect(g.short).toBe('Survey');
    expect(g.icon).toBe('survey');
  });

  it('Boost Mill branch: a Mill exists but no Spring touches one', () => {
    const s = initialState();
    const g0 = graphOf(s);
    const far = g0.neighbours[0].concat(0);
    const k = s.tiles.findIndex((_, i) => !far.includes(i));
    s.tiles[0] = 'spring';
    s.tiles[k] = 'mill';
    s.drifts = 1;
    s.projections = 1;
    const g = immediateGoal(s);
    expect(g.text).toBe('Place a Spring touching your Mill');
    shortOk(g);
    expect(g.short).toBe('Boost');
    expect(g.icon).toBe('boost');
  });

  it('cheapest-option branch: a boosted Mill, so compare Spring and Mill', () => {
    const s = initialState();
    const adj = graphOf(s).neighbours[0][0];
    s.tiles[0] = 'spring';
    s.tiles[adj] = 'mill';
    s.drifts = 1;
    s.projections = 1;
    const g = immediateGoal(s);
    expect(g.text).toMatch(/^Save for (Spring|Mill) \(/);
    shortOk(g);
    expect(['Spring', 'Mill']).toContain(g.short);
    expect(g.icon).toBe(g.short.toLowerCase());
    expect(g.text).toContain(g.short);
  });
});

describe('immediateGoal short label across every branch', () => {
  it('each reachable state has a short name of 7 characters or fewer and a semantic icon', () => {
    const states: GameState[] = [initialState()];
    const placed = initialState();
    place(placed, 0, 'spring');
    states.push(placed);
    const drift = initialState();
    drift.tiles[0] = 'spring';
    drift.runInk = new Decimal(1e7);
    states.push(drift);
    const proj = initialState();
    proj.tiles[0] = 'spring';
    proj.drifts = 1;
    proj.cycleCharts = new Decimal(config.projection.minCharts);
    states.push(proj);
    const survey = initialState();
    fill(survey, ['spring', 'mill']);
    survey.projections = 1;
    survey.drifts = 1;
    states.push(survey);
    for (const s of states) {
      const g = immediateGoal(s);
      expect(g.short.length).toBeLessThanOrEqual(7);
      expect(GOAL_ICONS).toContain(g.icon);
    }
  });
});

describe('explainNow', () => {
  it('fresh state says nothing is producing', () => {
    expect(explainNow(initialState())).toBe('Nothing is producing yet. Ink only grows from tiles.');
  });

  it('mentions springs and mills once placed', () => {
    const s = initialState();
    place(s, 0, 'spring');
    const text = explainNow(s);
    expect(text).toContain('1 Spring');
    expect(text).toContain('0 Mills');
    expect(text).toContain('Ink/s');
  });

  it('stays within 140 characters across several states', () => {
    const states: GameState[] = [initialState()];
    const busy = initialState();
    busy.ring = 5;
    fill(busy, ['spring', 'mill', 'beacon', 'bridge', 'vault']);
    busy.runInk = new Decimal('9.99e300');
    states.push(busy);
    const drifted = initialState();
    drifted.drifts = 3;
    fill(drifted, ['mill', 'spring']);
    drifted.ring = 5;
    states.push(drifted);
    const huge = initialState();
    huge.ring = 5;
    huge.geometry = 'square';
    fill(huge, ['spring']);
    huge.tiles[0] = 'mill';
    states.push(huge);
    for (const s of states) {
      const text = explainNow(s);
      expect(text.length).toBeLessThanOrEqual(140);
      expect(text).not.toMatch(/NaN|Infinity/);
    }
  });

  it('shows the Drift progress only before the first Drift', () => {
    const s = initialState();
    place(s, 0, 'spring');
    expect(explainNow(s)).toContain(`for Drift.`);
    s.drifts = 1;
    expect(explainNow(s)).not.toContain('for Drift.');
  });
});

describe('longGoal', () => {
  it('fresh state matches the old nextGoal label and starts at zero', () => {
    const [text, progress] = longGoal(initialState());
    expect(text).toBe(`Drift at ${fmt(config.drift.minInk)} Ink this run`);
    expect(progress).toBe(0);
  });
});
