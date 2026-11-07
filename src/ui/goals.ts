import Decimal from 'break_eternity.js';
import { config } from '../core/config';
import { canDrift, canProject, chartsOnDrift } from '../core/prestige';
import { adjacency, isActive, maxRing, mods, owned, prod, surveyCost, tileCost } from '../core/economy';
import { graphOf, type GameState } from '../core/state';
import { fmt, fmtTime } from './format';
import { hasBoostedMill } from './tutorial';

/** Semantic glyph for the compact HUD chip; the UI maps each one to a small symbol shown when the chip is too narrow for `short`. */
export const GOAL_ICONS = ['spring', 'mill', 'survey', 'boost', 'drift', 'project'] as const;
export type GoalIcon = (typeof GOAL_ICONS)[number];

export interface Goal {
  text: string;
  short: string; // compact HUD chip label, at most 7 characters: a fixed name built alongside text, never cut from it
  icon: GoalIcon; // explicit per branch, never parsed from text
  progress: number; // 0..1, clamped and finite
  eta: string; // '' or 'ready' or '~2m 10s'
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const money = (d: Decimal, s: GameState) => (Decimal.isNaN(d) ? '0' : fmt(d, s.notation));
const rate = (s: GameState) => {
  const r = prod(s).total;
  return Number.isFinite(r) ? r : 0;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ratio = (ink: Decimal, cost: Decimal) => (ink.gte(cost) ? 1 : clamp01(ink.div(cost).toNumber()));

/** 'ready' if affordable, a time estimate if income is positive, otherwise ''. */
function etaFor(s: GameState, cost: Decimal): string {
  if (s.ink.gte(cost)) return 'ready';
  const r = rate(s);
  if (r <= 0) return '';
  const secs = cost.sub(s.ink).toNumber() / r;
  return Number.isFinite(secs) ? `~${fmtTime(secs)}` : '';
}

/** Next unlock label and its progress (0..1). Moved verbatim from ui.ts nextGoal. */
export function longGoal(s: GameState): [string, number] {
  const dMin = Math.log10(config.drift.minInk);
  if (s.drifts === 0) return [`Drift at ${fmt(config.drift.minInk)} Ink this run`, s.runInk.add(1).log10().toNumber() / dMin];
  if (s.projections === 0 && !canProject(s))
    return [`Projection at ${config.projection.minCharts} Charts`, s.cycleCharts.toNumber() / config.projection.minCharts];
  if (s.projections === 0) return ['Projection ready!', 1];
  if (s.ring < maxRing(s)) return [`Survey ring ${s.ring + 1}`, s.ink.div(surveyCost(s)).toNumber()];
  let active = 0, filled = 0;
  s.tiles.forEach((t, i) => {
    if (isActive(s, i)) {
      active++;
      if (t) filled++;
    }
  });
  return ['Horizon reached: fill every cell', active ? filled / active : 0];
}

/** The single next concrete action, rules in priority order. */
export function immediateGoal(s: GameState): Goal {
  const hasTiles = s.tiles.some((t) => t !== null);
  const emptyActive = s.tiles.reduce((n, t, i) => n + (!t && isActive(s, i) ? 1 : 0), 0);
  const surveyable = s.ring < maxRing(s);

  if (s.projections === 0 && canProject(s))
    return { text: 'Projection is ready: open the Projection tab', short: 'Project', icon: 'project', progress: 1, eta: 'ready' };
  if (s.drifts === 0 && canDrift(s))
    return {
      text: `Drift is ready for ${fmt(chartsOnDrift(s), s.notation)} Charts: open the Drift tab`,
      short: 'Drift',
      icon: 'drift',
      progress: 1,
      eta: 'ready',
    };

  if (owned(s, 'spring') === 0 && !hasTiles) {
    const cost = tileCost(s, 'spring');
    return {
      text: `Place a Spring (${money(cost, s)} Ink)`,
      short: 'Spring',
      icon: 'spring',
      progress: ratio(s.ink, cost),
      eta: etaFor(s, cost),
    };
  }

  if (emptyActive === 0 && surveyable) {
    const cost = surveyCost(s);
    return {
      text: `Survey ring ${s.ring + 1} for more cells`,
      short: 'Survey',
      icon: 'survey',
      progress: ratio(s.ink, cost),
      eta: etaFor(s, cost),
    };
  }

  if (owned(s, 'mill') === 0) {
    const cost = tileCost(s, 'mill');
    return {
      text: `Save ${money(cost, s)} Ink for a Mill, next to a Spring`,
      short: 'Mill',
      icon: 'mill',
      progress: ratio(s.ink, cost),
      eta: etaFor(s, cost),
    };
  }

  if (!hasBoostedMill(s)) {
    const cost = tileCost(s, 'spring');
    return {
      text: 'Place a Spring touching your Mill',
      short: 'Boost',
      icon: 'boost',
      progress: ratio(s.ink, cost),
      eta: etaFor(s, cost),
    };
  }

  // Cheapest of: next Spring, next Mill, Survey (only while ring is open and few empty cells remain).
  const options: { name: string; short: string; icon: GoalIcon; cost: Decimal }[] = [
    { name: 'Spring', short: 'Spring', icon: 'spring', cost: tileCost(s, 'spring') },
    { name: 'Mill', short: 'Mill', icon: 'mill', cost: tileCost(s, 'mill') },
  ];
  if (surveyable && emptyActive < 3)
    options.push({ name: `Survey ring ${s.ring + 1}`, short: 'Survey', icon: 'survey', cost: surveyCost(s) });
  const best = options.reduce((a, b) => (b.cost.lt(a.cost) ? b : a));
  return {
    text: `Save for ${best.name} (${money(best.cost, s)} Ink)`,
    short: best.short,
    icon: best.icon,
    progress: ratio(s.ink, best.cost),
    eta: etaFor(s, best.cost),
  };
}

const MAX_EXPLAIN = 140;

/** Live one-line "what is happening" summary, at most 140 characters. */
export function explainNow(s: GameState): string {
  if (s.tiles.every((t) => t === null)) return 'Nothing is producing yet. Ink only grows from tiles.';

  const g = graphOf(s);
  const reach = mods(s).reach;
  const boosted = s.tiles.filter(
    (t, i) => t === 'mill' && adjacency(g, s.tiles, i, reach).some((n) => s.tiles[n] === 'spring'),
  ).length;
  const count = (t: string) => s.tiles.filter((x) => x === t).length;

  let text = `${plural(owned(s, 'spring'), 'Spring')} and ${plural(owned(s, 'mill'), 'Mill')} make ${fmt(rate(s), s.notation)} Ink/s`;
  if (boosted > 0) text += `; ${boosted === 1 ? '1 Mill' : `${boosted} Mills`} boosted by adjacent Springs`;
  const extras = [
    count('beacon') > 0 && plural(count('beacon'), 'Beacon'),
    count('bridge') > 0 && plural(count('bridge'), 'Bridge'),
    count('vault') > 0 && plural(count('vault'), 'Vault'),
  ].filter(Boolean);
  if (extras.length) text += `; also ${extras.join(', ')}`;
  text += '.';
  if (s.drifts === 0) text += ` Run Ink ${money(s.runInk, s)} of ${fmt(config.drift.minInk, s.notation)} for Drift.`;

  if (text.length > MAX_EXPLAIN) {
    const cut = text.slice(0, MAX_EXPLAIN - 3);
    const at = cut.lastIndexOf(' ');
    text = `${at > 0 ? cut.slice(0, at) : cut}...`;
  }
  return text;
}
