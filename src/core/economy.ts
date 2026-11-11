import Decimal from 'break_eternity.js';
import { chartUpgrades, config, curvUpgrades, type ChartUpgradeId, type CurvUpgradeId } from './config';
import { GRAPHS, graphOf, type GameState } from './state';
import type { TileType } from './tiles';
import type { TileGraph } from './geometry/graph';
import { has } from './milestones';
import { bridgeComponents, bridgeTouchSet, bridgeTouchSetExtended } from './bridge-relay';

export interface Mods {
  global: number;
  beacon: number;
  beaconPerDegree: number;
  reach: number;
  /** Effective Spring strain (Deep Wells lowers it). */
  strain: number;
}

export function mods(s: GameState): Mods {
  return {
    global: 2 ** s.chartUpg.global,
    beacon: config.tiles.beacon.mult + 0.25 * s.chartUpg.beacon + (has(s, 'brightBeacons') ? 0.25 : 0),
    beaconPerDegree: 0.05 * s.curvUpg.beaconDegree,
    reach: 1 + s.curvUpg.bridgeReach,
    strain: config.tiles.spring.strain * config.tiles.spring.deepWells ** s.chartUpg.cheapSprings,
  };
}

/**
 * Effective adjacency: graph neighbours, plus every tile on the same bridge-relay footprint.
 * A contiguous bridge chain acts as one connector — anything touching any bridge in the chain
 * is adjacent to everything else touching that chain. `reach` adds extra bridge-only BFS hops
 * beyond that (Long Bridges upgrade).
 */
const RELAY_CACHE_MAX = 64;
/** Relay links for one board, computed per node on first use (production only reads spring/mill nodes). */
type Relay = (i: number) => Set<number>;
const relayCache = new WeakMap<TileGraph, Map<string, Relay>>();

function relayFor(g: TileGraph, tiles: (TileType | null)[], reach: number): Relay {
  const hops = Math.max(0, Math.floor(reach) - 1);
  const footprints = bridgeComponents(g, tiles).map((comp) => {
    const touch = hops > 0 ? bridgeTouchSetExtended(g, tiles, comp, hops) : bridgeTouchSet(g, tiles, comp);
    // Node i is linked to the footprint when i is in it or touches it: i in touch ∪ N(touch) (graph is symmetric).
    const linked = new Set(touch);
    for (const t of touch) for (const n of g.neighbours[t]) linked.add(n);
    return { touch: [...touch], linked };
  });
  // Which footprints each node is linked to, so a node only visits its own footprints.
  const linkedBy: { touch: number[] }[][] = g.neighbours.map(() => []);
  for (const f of footprints) for (const i of f.linked) linkedBy[i].push(f);
  const oneWay = new Map<number, Set<number>>();
  const one = (i: number): Set<number> => {
    let seen = oneWay.get(i);
    if (!seen) {
      seen = new Set(g.neighbours[i]);
      for (const f of linkedBy[i]) for (const t of f.touch) if (t !== i) seen.add(t);
      seen.delete(i);
      oneWay.set(i, seen);
    }
    return seen;
  };
  const mates = new Map<number, Set<number>>();
  return (i) => {
    let m = mates.get(i);
    if (!m) {
      m = new Set<number>();
      for (const j of one(i)) if (one(j).has(i)) m.add(j);
      mates.set(i, m);
    }
    return m;
  };
}

/** Cached symmetric relay adjacency. */
function relayAdjacency(g: TileGraph, tiles: (TileType | null)[], reach: number): Relay {
  // The relay only depends on bridge positions and which cells are occupied, not on tile types.
  const key = `${reach}|${tiles.map((t) => (t === 'bridge' ? 'b' : t ? 'o' : '.')).join('')}`;
  let byKey = relayCache.get(g);
  if (byKey?.has(key)) return byKey.get(key)!;
  const relay = relayFor(g, tiles, reach);
  if (!byKey) {
    byKey = new Map();
    relayCache.set(g, byKey);
  }
  byKey.set(key, relay);
  // Every previewDelta candidate is a new board key; keep only the most recent entries.
  if (byKey.size > RELAY_CACHE_MAX) byKey.delete(byKey.keys().next().value!);
  return relay;
}

export function adjacency(g: TileGraph, tiles: (TileType | null)[], i: number, reach: number): number[] {
  // Without bridges the relay adds nothing, so skip building it (hot in previewDelta).
  if (!tiles.includes('bridge')) return [...g.neighbours[i]];
  return [...relayAdjacency(g, tiles, reach)(i)];
}

export interface Production {
  perTile: number[];
  total: number;
  /** Per tile: a Spring's share of its flow to each Mill it feeds (1 for everything else). */
  share: number[];
  /** Per tile: for a Spring, how many Mills it feeds (0 for everything else). */
  feeds: number[];
}

/** Share of a Spring's flow that each of k Mills gets: 1/(1+strain*(k-1)). Symmetric, so order never matters. */
export function springShare(k: number, strain = config.tiles.spring.strain): number {
  return k <= 1 ? 1 : 1 / (1 + strain * (k - 1));
}

/** Nodes at graph distance exactly 2 (Lighthouse range). Bridges do not extend it. */
const ring2Cache = new WeakMap<TileGraph, number[][]>();
export function ring2(g: TileGraph, i: number): number[] {
  let all = ring2Cache.get(g);
  if (!all) {
    all = g.neighbours.map((ns, a) => {
      const out = new Set<number>();
      for (const n of ns) for (const m of g.neighbours[n]) if (m !== a && !ns.includes(m)) out.add(m);
      return [...out];
    });
    ring2Cache.set(g, all);
  }
  return all[i];
}

/** Pure production calc. Geometry-agnostic: only sees the graph. */
export function production(g: TileGraph, tiles: (TileType | null)[], m: Mods): Production {
  const T = config.tiles;
  const vaults = tiles.filter((t) => t === 'vault').length;
  const global = m.global * (1 + T.vault.global * vaults);
  const perTile = tiles.map(() => 0);
  // Relay map looked up once per board (its cache key is a join of the whole board).
  const relay = tiles.includes('bridge') ? relayAdjacency(g, tiles, m.reach) : null;
  const adjOf = (i: number): Iterable<number> => (relay ? relay(i) : g.neighbours[i]);
  // Strain pass: how many Mills each Spring feeds. A Spring touching a Bridge is channelled (full share).
  const feeds = tiles.map(() => 0);
  const share = tiles.map(() => 1);
  tiles.forEach((t, i) => {
    if (t !== 'spring') return;
    let k = 0;
    for (const n of adjOf(i)) if (tiles[n] === 'mill') k++;
    feeds[i] = k;
    const channelled = g.neighbours[i].some((n) => tiles[n] === 'bridge');
    share[i] = channelled ? 1 : springShare(k, m.strain);
  });
  let total = 0;
  tiles.forEach((t, i) => {
    if (t !== 'spring' && t !== 'mill' && t !== 'scriptorium') return;
    const adj = adjOf(i);
    let out = 0;
    if (t === 'spring') {
      out = T.spring.out;
      for (const n of g.neighbours[i]) if (tiles[n] === 'cistern') out *= T.cistern.mult;
    } else if (t === 'mill') {
      let flow = 0;
      for (const n of adj) if (tiles[n] === 'spring') flow += share[n];
      out = T.mill.out * (1 + T.mill.perSpring * flow);
    } else {
      const kinds = new Set<TileType>();
      for (const n of g.neighbours[i]) if (tiles[n] && tiles[n] !== 'scriptorium') kinds.add(tiles[n]!);
      out = T.scriptorium.out * kinds.size;
    }
    // Beacons: true neighbours multiply. Beacons reached only through a Bridge are fainter and add instead
    // (Springs and Mills only), so a Bridge hub cannot stack them exponentially.
    const lit = (n: number) => m.beacon + m.beaconPerDegree * g.neighbours[n].length;
    for (const n of g.neighbours[i]) if (tiles[n] === 'beacon') out *= lit(n);
    if (relay && t !== 'scriptorium') {
      let far = 0;
      for (const n of adj) if (tiles[n] === 'beacon' && !g.neighbours[i].includes(n)) far += lit(n) - 1;
      out *= 1 + far;
    }
    for (const n of ring2(g, i)) if (tiles[n] === 'lighthouse') out *= T.lighthouse.mult;
    perTile[i] = out * global;
    total += perTile[i];
  });
  return { perTile, total, share, feeds };
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

export const surgeMult = (s: GameState) => (s.surge > 0 ? config.wind.surgeMult : 1);
/** Live Ink/s including the Trade Wind surge. */
export const inkPerSec = (s: GameState) => prod(s).total * surgeMult(s);

/** Catch a Trade Wind: an instant burst of Ink plus a timed production surge. Returns the Ink gained. */
export function catchWind(s: GameState): Decimal {
  const gain = Decimal.max(prod(s).total * config.wind.burstSec, config.wind.minInk);
  s.ink = s.ink.add(gain);
  s.runInk = s.runInk.add(gain);
  s.lifetimeInk = s.lifetimeInk.add(gain);
  s.surge = config.wind.surgeSec;
  s.windsCaught++;
  return gain;
}

/** True when some Mill touches a Spring (bridges included via adjacency). */
export function hasBoostedMill(s: GameState): boolean {
  const g = graphOf(s);
  const reach = mods(s).reach;
  return s.tiles.some(
    (t, i) => t === 'mill' && adjacency(g, s.tiles, i, reach).some((n) => s.tiles[n] === 'spring'),
  );
}

export function tileCost(s: GameState, t: TileType, n = owned(s, t)): Decimal {
  return new Decimal(config.tiles[t].cost).mul(Decimal.pow(config.costGrowth, n));
}

export const isActive = (s: GameState, i: number) => graphOf(s).ring[i] <= s.ring;

export function place(s: GameState, i: number, t: TileType): boolean {
  const cost = tileCost(s, t);
  if (!isActive(s, i) || s.tiles[i] || s.ink.lt(cost)) return false;
  const first = owned(s, t) === 0;
  s.ink = s.ink.sub(cost);
  s.tiles[i] = t;
  if (first && t === 'mill' && config.rewards?.firstMillInk)
    s.ink = s.ink.add(config.rewards.firstMillInk);
  if (first && t === 'bridge' && config.rewards?.firstBridgeInk)
    s.ink = s.ink.add(config.rewards.firstBridgeInk);
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
