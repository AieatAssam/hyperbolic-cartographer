import Decimal from 'break_eternity.js';
import { chartUpgrades, config, curvUpgrades, type ChartUpgradeId, type CurvUpgradeId } from './config';
import { canDrift, canProject, chartsOnDrift } from './prestige';
import { adjacency, hasBoostedMill, isActive, maxRing, mods, owned, prod, surveyCost, tileCost } from './economy';
import { graphOf, type GameState } from './state';
import type { TileType } from './tiles';

/** Tunable priority and copy for immediate-goal selection (balance lives here, not in formulas). */
export const goalPolicy = {
  /** Weight ordering: lower runs first when multiple goals qualify at the same tier. */
  tiers: ['prestigeReady', 'affordableUpgrade', 'unlockProgress', 'highValuePlace', 'saveTile'] as const,
  driftProgressMin: 0.12,
  surveyWhenEmptySlotsLt: 999,
  surveyBeatsSaveWhenAffordable: true,
} as const;

export type GoalTier = (typeof goalPolicy.tiers)[number];

export interface GoalPick {
  tier: GoalTier;
  text: string;
  short: string;
  icon: 'spring' | 'mill' | 'survey' | 'boost' | 'drift' | 'project' | 'chart' | 'curv';
  progress: number;
  eta: string;
  tabHint?: 'drift' | 'proj' | 'charts' | 'map';
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const rate = (s: GameState) => {
  const r = prod(s).total;
  return Number.isFinite(r) ? r : 0;
};
const ratio = (ink: Decimal, cost: Decimal) => (ink.gte(cost) ? 1 : clamp01(ink.div(cost).toNumber()));

function etaFor(s: GameState, cost: Decimal): string {
  if (s.ink.gte(cost)) return 'ready';
  const r = rate(s);
  if (r <= 0) return '';
  const secs = cost.sub(s.ink).toNumber() / r;
  return Number.isFinite(secs) ? `~${fmtTime(secs)}` : '';
}

function fmtTime(secs: number): string {
  if (secs < 60) return `${Math.ceil(secs)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.ceil(secs % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

function money(d: Decimal, s: GameState, fmt: GoalFmt['fmt']) {
  return Decimal.isNaN(d) ? '0' : fmt(d, s.notation);
}

export interface GoalFmt {
  fmt: (d: Decimal | number, notation?: 'sci' | 'suffix') => string;
}

function affordableChartUpg(s: GameState): ChartUpgradeId | null {
  for (const u of chartUpgrades) {
    const lvl = s.chartUpg[u.id];
    if (lvl >= u.max) continue;
    const cost = new Decimal(u.cost(lvl));
    if (s.charts.gte(cost)) return u.id;
  }
  return null;
}

function affordableCurvUpg(s: GameState): CurvUpgradeId | null {
  for (const u of curvUpgrades) {
    const lvl = s.curvUpg[u.id];
    if (lvl >= u.max) continue;
    const cost = new Decimal(u.cost(lvl));
    if (s.curvature.gte(cost)) return u.id;
  }
  return null;
}

/** Best empty cell to place a Mill touching the most Springs (graph adjacency, current reach). */
function bestMillAnchor(s: GameState): number | null {
  const g = graphOf(s);
  const reach = mods(s).reach;
  let best: { i: number; springs: number } | null = null;
  for (let i = 0; i < s.tiles.length; i++) {
    if (s.tiles[i] || !isActive(s, i)) continue;
    const springs = adjacency(g, s.tiles, i, reach).filter((n) => s.tiles[n] === 'spring').length;
    if (springs <= 0) continue;
    if (!best || springs > best.springs) best = { i, springs };
  }
  return best?.i ?? null;
}

function driftProgress(s: GameState): number {
  if (s.drifts > 0 || s.runInk.gte(config.drift.minInk)) return 1;
  const dMin = Math.log10(config.drift.minInk);
  return clamp01(s.runInk.add(1).log10().toNumber() / dMin);
}

/**
 * Picks the most meaningful next action. Pure: no DOM. Returns null only when state is degenerate.
 * `immediateGoal` in ui/goals maps this to legacy Goal icons where needed.
 */
export function pickImmediateGoal(s: GameState, { fmt }: GoalFmt): GoalPick {
  const hasTiles = s.tiles.some((t) => t !== null);
  const emptyActive = s.tiles.reduce((n, t, i) => n + (!t && isActive(s, i) ? 1 : 0), 0);
  const surveyable = s.ring < maxRing(s);

  if (s.projections === 0 && canProject(s)) {
    return {
      tier: 'prestigeReady',
      text: 'Projection is ready: open the Projection tab',
      short: 'Project',
      icon: 'project',
      progress: 1,
      eta: 'ready',
      tabHint: 'proj',
    };
  }
  if (s.drifts === 0 && canDrift(s)) {
    return {
      tier: 'prestigeReady',
      text: `Drift is ready for ${fmt(chartsOnDrift(s), s.notation)} Charts: open the Drift tab`,
      short: 'Drift',
      icon: 'drift',
      progress: 1,
      eta: 'ready',
      tabHint: 'drift',
    };
  }

  const chartId = affordableChartUpg(s);
  if (chartId) {
    const d = chartUpgrades.find((u) => u.id === chartId)!;
    return {
      tier: 'affordableUpgrade',
      text: `Buy ${d.name} in the Charts menu`,
      short: 'Charts',
      icon: 'chart',
      progress: 1,
      eta: 'ready',
      tabHint: 'charts',
    };
  }
  const curvId = affordableCurvUpg(s);
  if (curvId) {
    const d = curvUpgrades.find((u) => u.id === curvId)!;
    return {
      tier: 'affordableUpgrade',
      text: `Buy ${d.name} with Curvature`,
      short: 'Curv',
      icon: 'curv',
      progress: 1,
      eta: 'ready',
      tabHint: 'charts',
    };
  }

  if (s.drifts === 0 && driftProgress(s) >= goalPolicy.driftProgressMin && !canDrift(s)) {
    return {
      tier: 'unlockProgress',
      text: `Grow run Ink toward Drift (${fmt(s.runInk, s.notation)} / ${fmt(config.drift.minInk, s.notation)})`,
      short: 'Drift',
      icon: 'drift',
      progress: driftProgress(s),
      eta: '',
      tabHint: 'drift',
    };
  }

  if (surveyable && goalPolicy.surveyBeatsSaveWhenAffordable) {
    const cost = surveyCost(s);
    if (s.ink.gte(cost)) {
      return {
        tier: 'unlockProgress',
        text: `Survey ring ${s.ring + 1} to unlock more map`,
        short: 'Survey',
        icon: 'survey',
        progress: 1,
        eta: 'ready',
        tabHint: 'map',
      };
    }
  }

  if (owned(s, 'spring') === 0 && !hasTiles) {
    const cost = tileCost(s, 'spring');
    return {
      tier: 'saveTile',
      text: `Place a Spring (${money(cost, s, fmt)} Ink)`,
      short: 'Spring',
      icon: 'spring',
      progress: ratio(s.ink, cost),
      eta: etaFor(s, cost),
    };
  }

  if (emptyActive === 0 && surveyable) {
    const cost = surveyCost(s);
    return {
      tier: 'unlockProgress',
      text: `Survey ring ${s.ring + 1} for more cells`,
      short: 'Survey',
      icon: 'survey',
      progress: ratio(s.ink, cost),
      eta: etaFor(s, cost),
      tabHint: 'map',
    };
  }

  const millCost = tileCost(s, 'mill');
  if (owned(s, 'mill') === 0 && s.ink.gte(millCost)) {
    return {
      tier: 'highValuePlace',
      text: `Place a Mill next to a Spring (${money(millCost, s, fmt)} Ink)`,
      short: 'Mill',
      icon: 'mill',
      progress: 1,
      eta: 'ready',
    };
  }
  if (owned(s, 'mill') === 0) {
    return {
      tier: 'saveTile',
      text: `Save ${money(millCost, s, fmt)} Ink for a Mill, next to a Spring`,
      short: 'Mill',
      icon: 'mill',
      progress: ratio(s.ink, millCost),
      eta: etaFor(s, millCost),
    };
  }

  if (!hasBoostedMill(s)) {
    const cost = tileCost(s, 'spring');
    const anchor = bestMillAnchor(s);
    if (anchor !== null && s.ink.gte(cost)) {
      return {
        tier: 'highValuePlace',
        text: 'Place a Spring touching your Mill',
        short: 'Boost',
        icon: 'boost',
        progress: 1,
        eta: 'ready',
      };
    }
    return {
      tier: 'highValuePlace',
      text: 'Place a Spring touching your Mill',
      short: 'Boost',
      icon: 'boost',
      progress: ratio(s.ink, cost),
      eta: etaFor(s, cost),
    };
  }

  const options: { name: string; short: string; icon: GoalPick['icon']; cost: Decimal; type: TileType }[] = [
    { name: 'Spring', short: 'Spring', icon: 'spring', cost: tileCost(s, 'spring'), type: 'spring' },
    { name: 'Mill', short: 'Mill', icon: 'mill', cost: tileCost(s, 'mill'), type: 'mill' },
  ];
  if (surveyable && emptyActive < 3) {
    options.push({
      name: `Survey ring ${s.ring + 1}`,
      short: 'Survey',
      icon: 'survey',
      cost: surveyCost(s),
      type: 'spring',
    });
  }
  const best = options.reduce((a, b) => (b.cost.lt(a.cost) ? b : a));
  const highMill = bestMillAnchor(s);
  if (highMill !== null && s.ink.gte(tileCost(s, 'mill'))) {
    return {
      tier: 'highValuePlace',
      text: `Place a Mill beside Springs (${money(tileCost(s, 'mill'), s, fmt)} Ink)`,
      short: 'Mill',
      icon: 'mill',
      progress: 1,
      eta: 'ready',
    };
  }
  return {
    tier: 'saveTile',
    text: `Save for ${best.name} (${money(best.cost, s, fmt)} Ink)`,
    short: best.short,
    icon: best.icon === 'survey' ? 'survey' : best.icon,
    progress: ratio(s.ink, best.cost),
    eta: etaFor(s, best.cost),
  };
}
