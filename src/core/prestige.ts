import Decimal from 'break_eternity.js';
import { chartUpgrades, config, curvatureGain } from './config';
import { GRAPHS, SURFACES, SURFACE_GRAPHS, isSurface, zeroUpgrades, type GameState, type Geometry, type Surface } from './state';
import { has } from './milestones';
import { maxRing, stageConfig } from './economy';
import { noteDrift } from './achievements';

export function chartsOnDrift(s: GameState): Decimal {
  if (s.runInk.lt(config.drift.minInk)) return new Decimal(0);
  const mult = 1.5 ** s.curvUpg.driftGain * (has(s, 'doubleCharts') ? 2 : 1);
  return s.runInk.div(config.drift.divisor).pow(config.drift.exponent).mul(mult).floor();
}

export const canDrift = (s: GameState) => chartsOnDrift(s).gte(1);

function startRing(s: GameState) {
  const base = stageConfig(s.geometry).startRing;
  return Math.min(maxRing(s), base + s.chartUpg.startRings + (has(s, 'keepSurvey') ? 1 : 0));
}

function resetRun(s: GameState) {
  s.ink = new Decimal(has(s, 'headStart') ? 100 : config.startInk);
  s.runInk = new Decimal(0);
  s.runTime = 0;
}

export function drift(s: GameState): Decimal {
  const gain = chartsOnDrift(s);
  if (gain.lt(1)) return gain;
  const runTimeBefore = s.runTime;
  s.charts = s.charts.add(gain);
  s.cycleCharts = s.cycleCharts.add(gain);
  s.drifts++;
  noteDrift(s, runTimeBefore);
  resetRun(s);
  s.constellationKeys = [];
  s.tiles = s.tiles.map((t, i) => (s.pinned.includes(i) ? t : null));
  // Pinned tiles beyond the start area keep their ring surveyed.
  const g = GRAPHS[s.geometry];
  s.ring = Math.max(startRing(s), ...s.pinned.map((i) => g.ring[i]));
  return gain;
}

export const curvatureOnProjection = (s: GameState) => new Decimal(curvatureGain(s.cycleCharts.toNumber()));
export const canProject = (s: GameState) => s.cycleCharts.gte(config.projection.minCharts);

/** The next closed surface to unlock, or null when all are. */
export const nextFold = (s: GameState): Surface | null => SURFACES[s.folds] ?? null;
export const foldCost = (s: GameState) => { const f = nextFold(s); return f ? config.surfaces[f].foldCost : Infinity; };
/** Folding needs the hyperbolic map first (one Projection), then Curvature. */
export const canFold = (s: GameState) => s.projections > 0 && s.curvature.gte(foldCost(s));

/** Spend Curvature to unlock the next closed surface as a Projection target. Permanent. */
export function fold(s: GameState): Surface | null {
  const f = nextFold(s);
  if (!f || !canFold(s)) return null;
  s.curvature = s.curvature.sub(config.surfaces[f].foldCost);
  s.folds++;
  return f;
}

/** Geometries a Projection may land on: the hyperbolic map and every unlocked surface. */
export const projectionTargets = (s: GameState): Geometry[] => ['hyper', ...SURFACES.slice(0, s.folds)];

/**
 * Closed loops on a surface stage: each graph cycle (cycleBasis) whose every cell is surveyed and holds a tile.
 * Returns the loops' cells (without the repeated closing cell). Empty on the flat and hyperbolic boards.
 */
export function closedLoops(s: GameState): number[][] {
  if (!isSurface(s.geometry)) return [];
  const g = GRAPHS[s.geometry];
  return SURFACE_GRAPHS[s.geometry].cycleBasis
    .map((c) => c.slice(0, -1))
    .filter((c) => c.every((i) => s.tiles[i] && g.ring[i] <= s.ring));
}

/**
 * One entry per cycleBasis loop of the current surface: its cells (without the closing repeat), how many hold a tile,
 * and whether it is closed. Empty off-surface. Pure helper for the UI.
 */
export function loopStatus(s: GameState): { cells: number[]; filled: number; closed: boolean }[] {
  if (!isSurface(s.geometry)) return [];
  return SURFACE_GRAPHS[s.geometry].cycleBasis.map((c) => {
    const cells = c.slice(0, -1);
    const filled = cells.filter((i) => s.tiles[i]).length;
    return { cells, filled, closed: filled === cells.length };
  });
}

export function project(s: GameState, target?: Geometry): Decimal {
  if (!canProject(s)) return new Decimal(0);
  const targets = projectionTargets(s);
  const to = target && targets.includes(target) ? target : targets[targets.length - 1];
  const gain = curvatureOnProjection(s);
  s.curvature = s.curvature.add(gain);
  s.projections++;
  s.charts = new Decimal(0);
  s.cycleCharts = new Decimal(0);
  const kept = s.curvUpg.keepUpgrades;
  const up = zeroUpgrades(chartUpgrades);
  chartUpgrades.slice(0, kept).forEach((u) => (up[u.id] = s.chartUpg[u.id]));
  s.chartUpg = up;
  // Node indices differ between geometries: pinned tiles are re-seated in ring order from the centre.
  const pinnedTypes = has(s, 'pinsAcross') ? s.pinned.map((i) => s.tiles[i]!) : [];
  // Seat pins from the middle of the new map outward (lowest Survey ring first).
  const g = GRAPHS[to];
  const seats = g.ring.map((_, i) => i).sort((a, b) => g.ring[a] - g.ring[b] || a - b).slice(0, pinnedTypes.length);
  s.geometry = to;
  s.tiles = g.ring.map(() => null);
  seats.forEach((i, k) => (s.tiles[i] = pinnedTypes[k]));
  s.pinned = seats;
  resetRun(s);
  s.ring = startRing(s);
  return gain;
}
