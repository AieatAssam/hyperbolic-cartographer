/**
 * Headless economy simulation for balance analysis. Pure core; no DOM.
 * Used by scripts/sim-economy.ts and unit tests.
 */
import Decimal from 'break_eternity.js';
import { chartUpgrades, config, curvUpgrades } from './config';
import { applyConstellationRewards, eventsAfterPlace } from './constellations';
import { buyChartUpg, buyCurvUpg, isActive, maxRing, owned, place, previewDelta, prod, sell, survey, surveyCost, tileCost } from './economy';
import { pickImmediateGoal } from './goal-policy';
import { bestGreedyBuy } from './greedy-bot';
import { graphOf, initialState, type GameState } from './state';
import { canProject, canDrift, chartsOnDrift, drift, project } from './prestige';
import { applyOffline, simulate } from './tick';
import { TILE_TYPES, type TileType } from './tiles';

const fmt = (d: Decimal | number, _notation?: string) =>
  (d instanceof Decimal ? d.toNumber() : Number(d)).toExponential(2);

export type PolicyId = 'greedy' | 'casual';

export interface MilestoneTimes {
  firstSpring?: number;
  firstMill?: number;
  firstBeacon?: number;
  firstBridge?: number;
  firstVault?: number;
  firstDriftReady?: number;
  firstDrift?: number;
  firstProjection?: number;
  ring2?: number;
  ring3?: number;
  ring4?: number;
  ring5?: number;
  hyperGeometry?: number;
}

export interface SimSample {
  tMin: number;
  inkPerSec: number;
  ink: number;
  ring: number;
  drifts: number;
}

export interface DeadZone {
  fromMin: number;
  toMin: number;
  durationSec: number;
}

export interface SimReport {
  policy: PolicyId;
  minutes: number;
  milestones: MilestoneTimes;
  samples: SimSample[];
  deadZones: DeadZone[];
  maxDeadZoneSec: number;
  maxDeadZoneSecFirst15: number;
  peakInkPerSec: number;
  tileCounts: Record<TileType, number>;
  offlineGain?: { ink: number; drifts: number; seconds: number; eff: number };
  final: { drifts: number; projections: number; ring: number; geometry: string; charts: number };
}

function noteMilestones(s: GameState, sec: number, m: MilestoneTimes, t: TileType | null) {
  const min = sec / 60;
  if (t === 'spring' && m.firstSpring === undefined) m.firstSpring = min;
  if (t === 'mill' && m.firstMill === undefined) m.firstMill = min;
  if (t === 'beacon' && m.firstBeacon === undefined) m.firstBeacon = min;
  if (t === 'bridge' && m.firstBridge === undefined) m.firstBridge = min;
  if (t === 'vault' && m.firstVault === undefined) m.firstVault = min;
  if (m.ring2 === undefined && s.ring >= 2) m.ring2 = min;
  if (m.ring3 === undefined && s.ring >= 3) m.ring3 = min;
  if (m.ring4 === undefined && s.ring >= 4) m.ring4 = min;
  if (m.ring5 === undefined && s.ring >= 5) m.ring5 = min;
  if (m.hyperGeometry === undefined && s.geometry === 'hyper') m.hyperGeometry = min;
}

function casualAction(s: GameState): { kind: 'place'; i: number; t: TileType } | { kind: 'survey' } | { kind: 'drift' } | { kind: 'project' } | null {
  const goal = pickImmediateGoal(s, { fmt });
  const g = graphOf(s);
  const empty = g.ring.map((_, i) => i).filter((i) => isActive(s, i) && !s.tiles[i]);
  if (canDrift(s) && (goal.tabHint === 'drift' || goal.tier === 'prestigeReady')) return { kind: 'drift' };
  if (canProject(s) && s.projections === 0) return { kind: 'project' };
  if (s.ring < maxRing(s) && s.ink.gte(surveyCost(s)) && (goal.icon === 'survey' || empty.length < 2)) return { kind: 'survey' };
  const tryTypes: TileType[] = ['spring', 'mill', 'bridge', 'beacon', 'vault'];
  for (const t of tryTypes) {
    const cost = tileCost(s, t);
    if (s.ink.lt(cost)) continue;
    let pick = empty[0];
    if (t === 'mill' || t === 'bridge') {
      let bestI = -1;
      let best = -1;
      for (const i of empty) {
        const d = previewDelta(s, i, t);
        if (d > best) (best = d), (bestI = i);
      }
      if (bestI >= 0 && best > 0) pick = bestI;
      else if (t === 'mill' && owned(s, 'spring') === 0) continue;
      else if (t === 'bridge' && best <= 0) continue;
    }
    if (pick === undefined) continue;
    return { kind: 'place', i: pick, t };
  }
  return null;
}

function canAffordAnything(s: GameState): boolean {
  if (s.ring < maxRing(s) && s.ink.gte(surveyCost(s))) return true;
  if (canDrift(s) || canProject(s)) return true;
  for (const t of TILE_TYPES) if (s.ink.gte(tileCost(s, t))) return true;
  for (const u of chartUpgrades) {
    const lvl = s.chartUpg[u.id];
    if (lvl < u.max && s.charts.gte(u.cost(lvl))) return true;
  }
  return false;
}

export function runSim(policy: PolicyId, limitMin: number, opts?: { offlineAtMin?: number }): SimReport {
  const s = initialState();
  const milestones: MilestoneTimes = {};
  const samples: SimSample[] = [];
  const deadZones: DeadZone[] = [];
  let zoneStart: number | null = null;
  let maxDead = 0;
  let peakRate = 0;
  let target = policy === 'greedy' ? bestGreedyBuy(s) : null;
  let bestChartRate = 0;
  let offlineGain: SimReport['offlineGain'];

  for (let sec = 0; sec < limitMin * 60; sec++) {
    for (let k = 0; k < 10; k++) simulate(s, 0.1);

    if (opts?.offlineAtMin !== undefined && Math.abs(sec - opts.offlineAtMin * 60) < 0.05) {
      const off = applyOffline(s, 3600 * 4);
      offlineGain = { ink: off.ink.toNumber(), drifts: off.drifts, seconds: off.seconds, eff: off.eff };
    }

    if (policy === 'greedy') {
      const sc = surveyCost(s).toNumber();
      const canSurvey = s.ring < maxRing(s);
      if (canSurvey && (!target || sc < target.cost * 3) && survey(s)) target = bestGreedyBuy(s);
      if (sec % 10 === 0) target = bestGreedyBuy(s);
      if (sec % 2 === 0 && target && s.ink.gte(target.cost)) {
        if (s.tiles[target.i]) sell(s, target.i);
        const before = s.tiles.slice();
        if (place(s, target.i, target.t)) {
          applyConstellationRewards(s, eventsAfterPlace(s, before, target.i, target.t));
          noteMilestones(s, sec, milestones, target.t);
        }
        target = bestGreedyBuy(s);
      }
    } else if (sec % 5 === 0) {
      if (canDrift(s)) {
        milestones.firstDriftReady ??= sec / 60;
        if (s.drifts === 0) milestones.firstDrift = sec / 60;
        drift(s);
      } else {
        const act = casualAction(s);
        if (act?.kind === 'survey' && survey(s)) { /* ring */ }
        else if (act?.kind === 'project') project(s);
        else if (act?.kind === 'place') {
          const before = s.tiles.slice();
          if (place(s, act.i, act.t)) {
            applyConstellationRewards(s, eventsAfterPlace(s, before, act.i, act.t));
            noteMilestones(s, sec, milestones, act.t);
          }
        }
      }
    }

    for (const u of [...chartUpgrades].sort((a, b) => a.cost(s.chartUpg[a.id]) - b.cost(s.chartUpg[b.id]))) buyChartUpg(s, u.id);
    for (const u of curvUpgrades) buyCurvUpg(s, u.id);

    const rate = prod(s).total;
    peakRate = Math.max(peakRate, rate);
    if (sec % 180 === 0) samples.push({ tMin: sec / 60, inkPerSec: rate, ink: s.ink.toNumber(), ring: s.ring, drifts: s.drifts });

    const gain = chartsOnDrift(s).toNumber();
    if (gain >= 1) {
      milestones.firstDriftReady ??= sec / 60;
      if (policy === 'greedy') {
        const raw = s.runInk.div(config.drift.divisor).pow(config.drift.exponent).toNumber();
        const chartRate = raw / Math.max(1, s.runTime);
        const readyMin = milestones.firstDriftReady ?? sec / 60;
        const stallMin = sec / 60 - readyMin;
        const stallDrift = canDrift(s) && stallMin >= 9 && s.drifts < 2;
        if (chartRate < bestChartRate * 0.95 || stallDrift) {
          if (s.drifts === 0) milestones.firstDrift = sec / 60;
          drift(s);
          bestChartRate = 0;
          target = bestGreedyBuy(s);
        } else bestChartRate = Math.max(bestChartRate, chartRate);
      }
    }
    if (canProject(s) && s.projections === 0 && policy === 'greedy') {
      milestones.firstProjection = sec / 60;
      project(s);
      target = bestGreedyBuy(s);
    }

    noteMilestones(s, sec, milestones, null);

    const afford = canAffordAnything(s);
    if (!afford) {
      if (zoneStart === null) zoneStart = sec;
    } else if (zoneStart !== null) {
      const dur = sec - zoneStart;
      if (dur > 30) deadZones.push({ fromMin: zoneStart / 60, toMin: sec / 60, durationSec: dur });
      maxDead = Math.max(maxDead, dur);
      zoneStart = null;
    }
  }
  if (zoneStart !== null) {
    const end = limitMin * 60;
    const dur = end - zoneStart;
    if (dur > 30) deadZones.push({ fromMin: zoneStart / 60, toMin: end / 60, durationSec: dur });
    maxDead = Math.max(maxDead, dur);
  }
  const maxDeadZoneSecFirst15 = deadZones
    .filter((z) => z.fromMin < 15)
    .reduce((m, z) => Math.max(m, z.durationSec), zoneStart !== null && zoneStart < 15 * 60 ? (limitMin * 60 - zoneStart) : 0);

  const tileCounts = Object.fromEntries(TILE_TYPES.map((t) => [t, owned(s, t)])) as Record<TileType, number>;
  return {
    policy,
    minutes: limitMin,
    milestones,
    samples,
    deadZones,
    maxDeadZoneSec: maxDead,
    maxDeadZoneSecFirst15,
    peakInkPerSec: peakRate,
    tileCounts,
    offlineGain,
    final: { drifts: s.drifts, projections: s.projections, ring: s.ring, geometry: s.geometry, charts: s.charts.toNumber() },
  };
}
