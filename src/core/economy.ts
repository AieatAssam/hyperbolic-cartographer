import Decimal from 'break_eternity.js';
import { chartUpgrades, config, curvUpgrades, type ChartUpgradeId, type CurvUpgradeId } from './config';
import { GRAPHS, graphOf, type GameState } from './state';
import type { TileType } from './tiles';
import type { TileGraph } from './geometry/graph';
import { has } from './milestones';

export interface Mods {
  global: number;
  beacon: number;
  beaconPerDegree: number;
  reach: number;
}

export function mods(s: GameState): Mods {
  return {
    global: 2 ** s.chartUpg.global,
    beacon: config.tiles.beacon.mult + 0.25 * s.chartUpg.beacon + (has(s, 'brightBeacons') ? 0.25 : 0),
    beaconPerDegree: 0.05 * s.curvUpg.beaconDegree,
    reach: 1 + s.curvUpg.bridgeReach,
  };
}

/** Effective adjacency: direct neighbours plus anything reachable through up to `reach` consecutive Bridges. */
export function adjacency(g: TileGraph, tiles: (TileType | null)[], i: number, reach: number): number[] {
  const out = new Set(g.neighbours[i]);
  let frontier = g.neighbours[i].filter((n) => tiles[n] === 'bridge');
  for (let hop = 0; hop < reach && frontier.length; hop++) {
    const next: number[] = [];
    for (const b of frontier)
      for (const n of g.neighbours[b])
        if (n !== i && !out.has(n)) {
          out.add(n);
          if (tiles[n] === 'bridge') next.push(n);
        }
    frontier = next;
  }
  out.delete(i);
  return [...out];
}

export interface Production {
  perTile: number[];
  total: number;
}

/** Pure production calc. Geometry-agnostic: only sees the graph. */
export function production(g: TileGraph, tiles: (TileType | null)[], m: Mods): Production {
  const T = config.tiles;
  const vaults = tiles.filter((t) => t === 'vault').length;
  const global = m.global * (1 + T.vault.global * vaults);
  const perTile = tiles.map(() => 0);
  let total = 0;
  tiles.forEach((t, i) => {
    if (t !== 'spring' && t !== 'mill') return;
    const adj = adjacency(g, tiles, i, m.reach);
    let out = t === 'spring' ? T.spring.out : T.mill.out * (1 + T.mill.perSpring * adj.filter((n) => tiles[n] === 'spring').length);
    for (const n of adj) if (tiles[n] === 'beacon') out *= m.beacon + m.beaconPerDegree * g.neighbours[n].length;
    perTile[i] = out * global;
    total += perTile[i];
  });
  return { perTile, total };
}

let cache: { key: string; p: Production } | null = null;
/** Cached production for the current state (recomputed only when board or upgrades change). */
export function prod(s: GameState): Production {
  const key = s.geometry + s.tiles.join() + JSON.stringify(s.chartUpg) + JSON.stringify(s.curvUpg) + s.drifts + s.projections;
  if (cache?.key !== key) cache = { key, p: production(graphOf(s), s.tiles, mods(s)) };
  return cache.p;
}

export function previewDelta(s: GameState, i: number, type: TileType | null): number {
  const tiles = s.tiles.slice();
  tiles[i] = type;
  return production(graphOf(s), tiles, mods(s)).total - prod(s).total;
}

export const owned = (s: GameState, t: TileType) => s.tiles.filter((x) => x === t).length;

/** True when some Mill touches a Spring (bridges included via adjacency). */
export function hasBoostedMill(s: GameState): boolean {
  const g = graphOf(s);
  const reach = mods(s).reach;
  return s.tiles.some(
    (t, i) => t === 'mill' && adjacency(g, s.tiles, i, reach).some((n) => s.tiles[n] === 'spring'),
  );
}

export function tileCost(s: GameState, t: TileType, n = owned(s, t)): Decimal {
  const disc = t === 'spring' ? 0.6 ** s.chartUpg.cheapSprings : 1;
  return new Decimal(config.tiles[t].cost * disc).mul(Decimal.pow(config.costGrowth, n));
}

export const isActive = (s: GameState, i: number) => graphOf(s).ring[i] <= s.ring;

export function place(s: GameState, i: number, t: TileType): boolean {
  const cost = tileCost(s, t);
  if (!isActive(s, i) || s.tiles[i] || s.ink.lt(cost)) return false;
  s.ink = s.ink.sub(cost);
  s.tiles[i] = t;
  return true;
}

export const sellValue = (s: GameState, t: TileType) => tileCost(s, t, owned(s, t) - 1).mul(config.sellRefund);

export function sell(s: GameState, i: number): boolean {
  const t = s.tiles[i];
  if (!t) return false;
  s.ink = s.ink.add(sellValue(s, t));
  s.tiles[i] = null;
  s.pinned = s.pinned.filter((p) => p !== i);
  return true;
}

export const maxPins = (s: GameState) => 1 + s.chartUpg.pins;

export function togglePin(s: GameState, i: number): boolean {
  if (s.pinned.includes(i)) s.pinned = s.pinned.filter((p) => p !== i);
  else if (s.tiles[i] && s.pinned.length < maxPins(s)) s.pinned.push(i);
  else return false;
  return true;
}

export const maxRing = (s: GameState) =>
  s.geometry === 'square' ? config.square.maxRing : config.hyper.maxRing + s.curvUpg.extraRing;

export function surveyCost(s: GameState): Decimal {
  const c = s.geometry === 'square' ? config.square : config.hyper;
  return new Decimal(c.surveyBase).mul(Decimal.pow(c.surveyGrowth, s.ring + 1));
}

export function survey(s: GameState): boolean {
  const cost = surveyCost(s);
  if (s.ring >= maxRing(s) || s.ink.lt(cost)) return false;
  s.ink = s.ink.sub(cost);
  s.ring++;
  return true;
}

export const cellsInRing = (s: GameState, r: number) => GRAPHS[s.geometry].ring.filter((x) => x === r).length;

export function buyChartUpg(s: GameState, id: ChartUpgradeId): boolean {
  const d = chartUpgrades.find((u) => u.id === id)!;
  const lvl = s.chartUpg[id];
  if (lvl >= d.max || s.charts.lt(d.cost(lvl))) return false;
  s.charts = s.charts.sub(d.cost(lvl));
  s.chartUpg[id]++;
  return true;
}

export function buyCurvUpg(s: GameState, id: CurvUpgradeId): boolean {
  const d = curvUpgrades.find((u) => u.id === id)!;
  const lvl = s.curvUpg[id];
  if (lvl >= d.max || s.curvature.lt(d.cost(lvl))) return false;
  s.curvature = s.curvature.sub(d.cost(lvl));
  s.curvUpg[id]++;
  return true;
}

export const offlineEff = (s: GameState) =>
  Math.min(1, config.offline.baseEff + config.tiles.vault.offline * owned(s, 'vault'));
export const offlineCapSec = (s: GameState) => (config.offline.capHours + 4 * s.chartUpg.offlineCap) * 3600;
