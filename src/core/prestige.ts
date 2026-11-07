import Decimal from 'break_eternity.js';
import { chartUpgrades, config, curvatureGain } from './config';
import { GRAPHS, zeroUpgrades, type GameState } from './state';
import { has } from './milestones';
import { maxRing } from './economy';

export function chartsOnDrift(s: GameState): Decimal {
  if (s.runInk.lt(config.drift.minInk)) return new Decimal(0);
  const mult = 1.5 ** s.curvUpg.driftGain * (has(s, 'doubleCharts') ? 2 : 1);
  return s.runInk.div(config.drift.divisor).pow(config.drift.exponent).mul(mult).floor();
}

export const canDrift = (s: GameState) => chartsOnDrift(s).gte(1);

function startRing(s: GameState) {
  const base = s.geometry === 'square' ? config.square.startRing : config.hyper.startRing;
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
  s.charts = s.charts.add(gain);
  s.cycleCharts = s.cycleCharts.add(gain);
  s.drifts++;
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

export function project(s: GameState): Decimal {
  if (!canProject(s)) return new Decimal(0);
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
  s.geometry = 'hyper';
  s.tiles = GRAPHS.hyper.ring.map((_, i) => pinnedTypes[i] ?? null);
  s.pinned = pinnedTypes.map((_, i) => i);
  resetRun(s);
  s.ring = startRing(s);
  return gain;
}
