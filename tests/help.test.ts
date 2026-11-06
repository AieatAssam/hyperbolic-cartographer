import { describe, expect, it } from 'vitest';
import Decimal from 'break_eternity.js';
import { config } from '../src/core/config';
import { graphOf, initialState } from '../src/core/state';
import { TILE_TYPES } from '../src/core/tiles';
import {
  BUTTON_HELP,
  TAB_HELP,
  TOOL_HELP,
  placeBlocked,
  projectBlocked,
  projectionCompare,
  surveyBlocked,
  driftBlocked,
  upgradeBlocked,
  DRIFT_RESETS,
  DRIFT_KEEPS,
  PROJECTION_RESETS,
  PROJECTION_KEEPS,
  type Tab,
  type Tool,
} from '../src/ui/help';

const TOOLS: Tool[] = [...TILE_TYPES, 'sell', 'pin'];
const TABS: Tab[] = ['map', 'drift', 'charts', 'proj', 'miles', 'save', 'guide'];

/** First active cell with no tile, plus its index. */
const emptyActive = (s: ReturnType<typeof initialState>) => {
  const g = graphOf(s);
  const i = g.ring.findIndex((r, idx) => r <= s.ring && !s.tiles[idx]);
  return i;
};
/** First cell beyond the currently surveyed radius. */
const unsurveyed = (s: ReturnType<typeof initialState>) => graphOf(s).ring.findIndex((r) => r > s.ring);

describe('help copy', () => {
  it('every tool, tab and button has real text', () => {
    for (const t of TOOLS) expect(TOOL_HELP[t].length).toBeGreaterThanOrEqual(20);
    for (const t of TABS) expect(TAB_HELP[t].length).toBeGreaterThanOrEqual(20);
    for (const [k, v] of Object.entries(BUTTON_HELP)) {
      expect(v.length, k).toBeGreaterThanOrEqual(20);
    }
  });

  it('tool copy uses config numbers', () => {
    expect(TOOL_HELP.mill).toContain('100%');
    expect(TOOL_HELP.beacon).toContain(`x${config.tiles.beacon.mult}`);
    expect(TOOL_HELP.sell).toContain('50%');
  });

  it('drift and projection lists are non-empty and disjoint in intent', () => {
    for (const list of [DRIFT_RESETS, DRIFT_KEEPS, PROJECTION_RESETS, PROJECTION_KEEPS]) {
      expect(list.length).toBeGreaterThan(0);
      for (const item of list) expect(item.length).toBeGreaterThan(0);
    }
  });
});

describe('projectionCompare', () => {
  it('square has 4 neighbours, hyperbolic has 7, and hyper Mill max is higher', () => {
    const c = projectionCompare();
    expect(c.square.neighbours).toBe(4);
    expect(c.hyper.neighbours).toBe(7);
    expect(c.hyper.millMax).toBeGreaterThan(c.square.millMax);
    expect(c.square.millMax).toBe(config.tiles.mill.out * (1 + config.tiles.mill.perSpring * 4));
  });

  it('gives 3-5 plain lines', () => {
    const { lines } = projectionCompare();
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines.join(' ')).toMatch(/Charts/);
  });
});

describe('disabled reasons', () => {
  it('survey is allowed with plenty of Ink and blocked with none', () => {
    const rich = initialState();
    rich.ink = new Decimal('1e12');
    expect(surveyBlocked(rich)).toBeNull();
    const broke = initialState();
    broke.ink = new Decimal(0);
    expect(surveyBlocked(broke)).toMatch(/Need .* more Ink/);
  });

  it('survey says so at max ring', () => {
    const s = initialState();
    s.ink = new Decimal('1e30');
    s.ring = config.square.maxRing;
    expect(surveyBlocked(s)).toMatch(/surveyed/);
  });

  it('drift and projection are blocked on a fresh state', () => {
    const s = initialState();
    expect(driftBlocked(s)).not.toBeNull();
    expect(projectBlocked(s)).not.toBeNull();
    expect(projectBlocked(s)).toMatch(/Charts/);
  });

  it('drift is allowed once run Ink reaches the threshold', () => {
    const s = initialState();
    s.runInk = new Decimal(config.drift.minInk);
    expect(driftBlocked(s)).toBeNull();
  });

  it('upgrade shows Maxed, or how much is missing', () => {
    expect(upgradeBlocked(3, 3, new Decimal(10), new Decimal(1e9), 'Charts', 'suffix')).toBe('Maxed');
    expect(upgradeBlocked(0, 3, new Decimal(10), new Decimal(4), 'Charts', 'suffix')).toBe('Need 6 more Charts');
    expect(upgradeBlocked(0, 3, new Decimal(10), new Decimal(10), 'Charts', 'suffix')).toBeNull();
  });

  it('place: unsurveyed cell', () => {
    const s = initialState();
    s.ink = new Decimal('1e12');
    const i = unsurveyed(s);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(placeBlocked(s, i, 'spring')).toBe(`Survey ring ${graphOf(s).ring[i]} first`);
  });

  it('place: occupied cell', () => {
    const s = initialState();
    s.ink = new Decimal('1e12');
    const i = emptyActive(s);
    s.tiles[i] = 'spring';
    expect(placeBlocked(s, i, 'mill')).toBe('Occupied: use Sell first');
  });

  it('place: not enough Ink', () => {
    const s = initialState();
    s.ink = new Decimal(10);
    const i = emptyActive(s);
    // Mill costs 100, so 90 more Ink are needed.
    expect(placeBlocked(s, i, 'mill')).toBe('Need 90 more Ink');
  });

  it('place: ok case', () => {
    const s = initialState();
    s.ink = new Decimal(10);
    const i = emptyActive(s);
    expect(placeBlocked(s, i, 'spring')).toBeNull();
  });

  it('sell: empty cell', () => {
    const s = initialState();
    const i = emptyActive(s);
    expect(placeBlocked(s, i, 'sell')).toBe('Nothing to sell here');
  });

  it('sell: a tile is allowed', () => {
    const s = initialState();
    const i = emptyActive(s);
    s.tiles[i] = 'spring';
    expect(placeBlocked(s, i, 'sell')).toBeNull();
  });

  it('pin: empty cell', () => {
    const s = initialState();
    const i = emptyActive(s);
    expect(placeBlocked(s, i, 'pin')).toBe('Only tiles can be pinned');
  });

  it('pin: no slots left', () => {
    const s = initialState();
    const a = emptyActive(s);
    s.tiles[a] = 'spring';
    const b = emptyActive(s);
    s.tiles[b] = 'spring';
    s.pinned = [a];
    expect(placeBlocked(s, b, 'pin')).toBe('No pin slots left (Brass Pins adds more)');
    // Unpinning an already pinned tile is always allowed.
    expect(placeBlocked(s, a, 'pin')).toBeNull();
  });
});
