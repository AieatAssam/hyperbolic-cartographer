import { expect, it } from 'vitest';
import { chartUpgrades, config, curvUpgrades } from '../src/core/config';
import { graphOf, initialState, type GameState } from '../src/core/state';
import { buyChartUpg, buyCurvUpg, isActive, maxRing, place, previewDelta, prod, sell, survey, surveyCost, tileCost } from '../src/core/economy';
import { canProject, chartsOnDrift, drift, project } from '../src/core/prestige';
import { simulate } from '../src/core/tick';
import { TILE_TYPES, type TileType } from '../src/core/tiles';

/** Greedy "active player": best Δrate/cost placement, Survey when it's cheaper or the board is full. */
function bestBuy(s: GameState): { i: number; t: TileType; cost: number } | null {
  let best: { i: number; t: TileType; cost: number; score: number } | null = null;
  const budget = s.ink.toNumber() + prod(s).total * 60; // only plan purchases reachable within a minute
  const cells = graphOf(s).ring.map((_, i) => i).filter((i) => isActive(s, i));
  for (const t of TILE_TYPES) {
    const cost = tileCost(s, t).toNumber();
    if (cost > budget) continue;
    for (const i of cells) {
      if (s.tiles[i] === t) continue;
      const score = previewDelta(s, i, t) / (cost * (s.tiles[i] ? 1.5 : 1)); // replacing wastes the old tile
      if (score > 0 && (!best || score > best.score)) best = { i, t, cost, score };
    }
  }
  return best;
}

function play(limitMin: number) {
  const s = initialState();
  const log: Record<string, number> = {};
  let target = bestBuy(s), bestChartRate = 0;
  for (let sec = 0; sec < limitMin * 60; sec++) {
    for (let k = 0; k < 10; k++) simulate(s, 0.1);
    const sc = surveyCost(s).toNumber();
    const canSurvey = s.ring < maxRing(s);
    if (canSurvey && (!target || sc < target.cost * 3) && survey(s)) target = bestBuy(s);
    if (sec % 10 === 0) target = bestBuy(s);
    if (sec % 2 === 0 && target && s.ink.gte(target.cost)) {
      if (s.tiles[target.i]) sell(s, target.i);
      place(s, target.i, target.t);
      target = bestBuy(s);
    }
    for (const u of [...chartUpgrades].sort((a, b) => a.cost(s.chartUpg[a.id]) - b.cost(s.chartUpg[b.id]))) buyChartUpg(s, u.id);
    for (const u of curvUpgrades) buyCurvUpg(s, u.id);
    if (process.env.DBG && sec % 60 === 0) console.log(sec / 60, s.ring, s.ink.toNumber().toFixed(0), s.tiles.filter(Boolean).join(""), s.drifts);
    const gain = chartsOnDrift(s).toNumber();
    const raw = s.runInk.div(config.drift.divisor).pow(config.drift.exponent).toNumber(); // unfloored, for peak-finding
    const rate = raw / s.runTime;
    if (gain >= 1) {
      log.firstDriftReady ??= sec / 60;
      if (rate < bestChartRate * 0.95 && gain >= 1) {
        if (s.drifts === 0) log.firstDrift = sec / 60;
        drift(s);
        bestChartRate = 0;
        target = bestBuy(s);
      } else bestChartRate = Math.max(bestChartRate, rate);
    }
    if (canProject(s) && s.projections === 0) {
      log.projection = sec / 60;
      log.curvature = project(s).toNumber();
      for (const u of curvUpgrades) buyCurvUpg(s, u.id);
      target = bestBuy(s);
    }
    if (s.projections > 0 && s.ring === maxRing(s) && !target && !log.hyperFull) log.hyperFull = sec / 60;
  }
  return { log, s };
}

it.runIf(process.env.PACING)('pacing: Drift < 15 min, Projection < 90 min', () => {
  const { log, s } = play(120);
  console.log(JSON.stringify({ ...log, drifts: s.drifts, ring: s.ring, geometry: s.geometry }));
  expect(log.firstDrift).toBeLessThan(15);
  expect(log.projection).toBeLessThan(90);
}, 900_000);
