/**
 * Greedy "active player" policy shared by the pacing test, sim-economy and the playtest bot.
 * Pure core: no DOM. Each candidate placement is scored by its production delta per ink.
 */
import { chartUpgrades, config, curvUpgrades } from './config';
import { graphOf, initialState, type GameState } from './state';
import { buyChartUpg, buyCurvUpg, isActive, maxRing, place, previewDelta, prod, sell, survey, surveyCost, tileCost } from './economy';
import { canProject, chartsOnDrift, drift, project } from './prestige';
import { fastForward } from './tick';
import { TILE_TYPES, type TileType } from './tiles';

export interface GreedyBuy {
  i: number;
  t: TileType;
  cost: number;
}

/** Everything previewDelta depends on besides the candidate itself. */
function boardSignature(s: GameState): string {
  return [s.geometry, s.drifts, s.projections, s.tiles.join(), JSON.stringify(s.chartUpg), JSON.stringify(s.curvUpg)].join('|');
}

// previewDelta is a pure function of the board, so scans between two board changes reuse it.
let memo: { sig: string; deltas: Map<string, number> } | null = null;

function deltaFor(s: GameState, sig: string, i: number, t: TileType): number {
  if (memo?.sig !== sig) memo = { sig, deltas: new Map() };
  const key = `${i}:${t}`;
  let d = memo.deltas.get(key);
  if (d === undefined) {
    d = previewDelta(s, i, t);
    memo.deltas.set(key, d);
  }
  return d;
}

/**
 * Best Δrate/cost placement reachable within a minute of income, or null.
 * Cells are the outer loop so one board's relay map is shared by all tile types at that cell;
 * ties resolve to the earliest (type, cell) pair, matching a type-major scan.
 */
export function bestGreedyBuy(s: GameState): GreedyBuy | null {
  let best: (GreedyBuy & { score: number; ti: number }) | null = null;
  const budget = s.ink.toNumber() + prod(s).total * 60;
  const cells = graphOf(s).ring.map((_, i) => i).filter((i) => isActive(s, i));
  const sig = boardSignature(s);
  const costs = TILE_TYPES.map((t) => tileCost(s, t).toNumber());
  for (const i of cells) {
    for (let ti = 0; ti < TILE_TYPES.length; ti++) {
      const t = TILE_TYPES[ti];
      const cost = costs[ti];
      if (cost > budget || s.tiles[i] === t) continue;
      const score = deltaFor(s, sig, i, t) / (cost * (s.tiles[i] ? 1.5 : 1)); // replacing wastes the old tile
      if (score <= 0) continue;
      const beats = !best || score > best.score || (score === best.score && (ti < best.ti || (ti === best.ti && i < best.i)));
      if (beats) best = { i, t, cost, score, ti };
    }
  }
  return best && { i: best.i, t: best.t, cost: best.cost };
}

/** Milestone times in minutes, filled in by playGreedy when first reached. */
export type GreedyLog = Record<string, number>;

/**
 * Headless greedy player: buys the best placement, Surveys when cheaper than the next buy or the
 * board is full, spends on upgrades, and Drifts/Projects at the same rule the pacing test uses.
 * Advances one simulated second at a time through fastForward. `onSecond` runs after each second.
 */
export function playGreedy(
  limitMin: number,
  onSecond?: (s: GameState, sec: number, log: GreedyLog) => void,
): { log: GreedyLog; s: GameState } {
  const s = initialState();
  const log: GreedyLog = {};
  let target = bestGreedyBuy(s), bestChartRate = 0;
  for (let sec = 0; sec < limitMin * 60; sec++) {
    fastForward(s, 1);
    const sc = surveyCost(s).toNumber();
    const canSurvey = s.ring < maxRing(s);
    if (canSurvey && (!target || sc < target.cost * 3) && survey(s)) target = bestGreedyBuy(s);
    if (sec % 10 === 0) target = bestGreedyBuy(s);
    if (sec % 2 === 0 && target && s.ink.gte(target.cost)) {
      if (s.tiles[target.i]) sell(s, target.i);
      place(s, target.i, target.t);
      target = bestGreedyBuy(s);
    }
    for (const u of [...chartUpgrades].sort((a, b) => a.cost(s.chartUpg[a.id]) - b.cost(s.chartUpg[b.id]))) buyChartUpg(s, u.id);
    for (const u of curvUpgrades) buyCurvUpg(s, u.id);
    const gain = chartsOnDrift(s).toNumber();
    const raw = s.runInk.div(config.drift.divisor).pow(config.drift.exponent).toNumber(); // unfloored, for peak-finding
    const rate = raw / s.runTime;
    if (gain >= 1) {
      log.firstDriftReady ??= sec / 60;
      if (rate < bestChartRate * 0.95 && gain >= 1) {
        if (s.drifts === 0) log.firstDrift = sec / 60;
        drift(s);
        bestChartRate = 0;
        target = bestGreedyBuy(s);
      } else bestChartRate = Math.max(bestChartRate, rate);
    }
    if (canProject(s) && s.projections === 0) {
      log.projection = sec / 60;
      log.curvature = project(s).toNumber();
      for (const u of curvUpgrades) buyCurvUpg(s, u.id);
      target = bestGreedyBuy(s);
    }
    if (s.projections > 0 && s.ring === maxRing(s) && !target && !log.hyperFull) log.hyperFull = sec / 60;
    onSecond?.(s, sec, log);
  }
  return { log, s };
}
