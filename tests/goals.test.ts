import { describe, expect, it } from 'vitest';
import Decimal from 'break_eternity.js';
import { config } from '../src/core/config';
import { graphOf, initialState, type GameState } from '../src/core/state';
import { place } from '../src/core/economy';
import type { TileType } from '../src/core/tiles';
import { explainNow, immediateGoal, longGoal } from '../src/ui/goals';
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
