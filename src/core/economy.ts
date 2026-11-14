import Decimal from 'break_eternity.js';
import { chartUpgrades, config, curvUpgrades, type ChartUpgradeId, type CurvUpgradeId } from './config';
import { GRAPHS, graphOf, type GameState } from './state';
import type { TileType } from './tiles';
import type { TileGraph } from './geometry/graph';
import { has } from './milestones';
import { bridgeComponents, bridgeTouchSet, bridgeTouchSetExtended } from './bridge-relay';
import type { WindKind } from './wind';

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
    global: 2 ** s.chartUpg.global * (1 + config.achievements.inkPerEach * s.achievements.length),
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
export type Relay = (i: number) => readonly number[];
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
  const mates: (number[] | undefined)[] = [];
  return (i) => {
    let m = mates[i];
    if (!m) {
      m = [];
      for (const j of one(i)) if (one(j).has(i)) m.push(j);
      mates[i] = m;
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

/** Global bonus from n Vaults: the first gives vault.global, each further one `decay` times the one before. */
export function vaultBonus(n: number): number {
  const { global, decay } = config.tiles.vault;
  return decay === 1 ? global * n : (global * (1 - decay ** n)) / (1 - decay);
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

/** Descending comparator, hoisted so the hot loop allocates no closure. */
const desc = (a: number, b: number) => b - a;

/** One Beacon's brightness as seen from the tile it lights (its own degree adds a little). */
const litBy = (m: Mods, g: TileGraph, n: number) => m.beacon + m.beaconPerDegree * g.neighbours[n].length;

/** Pure production calc. Geometry-agnostic: only sees the graph. */
export function production(
  g: TileGraph,
  tiles: (TileType | null)[],
  m: Mods,
  // Relay map for this board; looked up once per board (its cache key is a join of the whole board).
  relay: Relay | null = tiles.includes('bridge') ? relayAdjacency(g, tiles, m.reach) : null,
): Production {
  const T = config.tiles;
  const n = tiles.length;
  let vaults = 0;
  for (let i = 0; i < n; i++) if (tiles[i] === 'vault') vaults++;
  const global = m.global * (1 + vaultBonus(vaults));
  const perTile: number[] = new Array(n).fill(0);
  // Strain pass: how many Mills each Spring feeds. A Spring touching a Bridge is channelled (full share).
  const feeds: number[] = new Array(n).fill(0);
  const share: number[] = new Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    if (tiles[i] !== 'spring') continue;
    const nb = g.neighbours[i];
    let k = 0;
    for (const x of relay ? relay(i) : nb) if (tiles[x] === 'mill') k++;
    feeds[i] = k;
    let channelled = false;
    for (const x of nb) if (tiles[x] === 'bridge') channelled = true;
    share[i] = channelled ? 1 : springShare(k, m.strain);
  }
  let total = 0;
  for (let i = 0; i < n; i++) {
    const t = tiles[i];
    if (t !== 'spring' && t !== 'mill' && t !== 'scriptorium') continue;
    const nb = g.neighbours[i];
    const adj = relay ? relay(i) : nb;
    let out = 0;
    if (t === 'spring') {
      out = T.spring.out;
      for (const x of nb) if (tiles[x] === 'cistern') out *= T.cistern.mult;
    } else if (t === 'mill') {
      // A Mill draws on at most maxSprings Springs (its strongest shares), so a Bridge hub cannot funnel a whole board into one Mill.
      const shares: number[] = [];
      // A Cistern-fed Spring also feeds its Mills more (millFlow per adjacent Cistern).
      for (const x of adj) {
        if (tiles[x] !== 'spring') continue;
        let f = share[x];
        for (const y of g.neighbours[x]) if (tiles[y] === 'cistern') f *= T.cistern.millFlow;
        shares.push(f);
      }
      if (shares.length > T.mill.maxSprings) shares.sort(desc).length = T.mill.maxSprings;
      let flow = 0;
      for (const x of shares) flow += x;
      out = T.mill.out * (1 + T.mill.perSpring * flow);
    } else {
      const kinds = new Set<TileType>();
      for (const x of nb) if (tiles[x] && tiles[x] !== 'scriptorium') kinds.add(tiles[x]!);
      out = T.scriptorium.out * kinds.size;
    }
    // Beacons: true neighbours multiply. Beacons reached only through a Bridge are fainter and add instead
    // (Springs and Mills only), so a Bridge hub cannot stack them exponentially.
    for (const x of nb) if (tiles[x] === 'beacon') out *= litBy(m, g, x);
    if (relay && t !== 'scriptorium') {
      const far: number[] = [];
      for (const x of adj) if (tiles[x] === 'beacon' && !nb.includes(x)) far.push(litBy(m, g, x) - 1);
      if (far.length > T.beacon.maxRelayed) far.sort(desc).length = T.beacon.maxRelayed;
      let sum = 0;
      for (const x of far) sum += x;
      out *= 1 + sum;
    }
    for (const x of ring2(g, i)) if (tiles[x] === 'lighthouse') out *= T.lighthouse.mult;
    perTile[i] = out * global;
    total += perTile[i];
  }
  return { perTile, total, share, feeds };
}

/** Same keys and values, so a record compare equals the old JSON compare. */
const sameRecord = (a: Record<string, number>, b: Record<string, number>) =>
  Object.keys(a).every((k) => a[k] === b[k]);

interface ProdCache {
  geometry: GameState['geometry'];
  drifts: number;
  projections: number;
  achievements: number;
  chartUpg: GameState['chartUpg'];
  curvUpg: GameState['curvUpg'];
  tiles: (TileType | null)[];
  p: Production;
}
let cache: ProdCache | null = null;
/** Cached production for the current state (recomputed only when board or upgrades change). */
export function prod(s: GameState): Production {
  const c = cache;
  const same =
    c !== null &&
    c.geometry === s.geometry &&
    c.drifts === s.drifts &&
    c.projections === s.projections &&
    c.achievements === s.achievements.length &&
    c.tiles.length === s.tiles.length &&
    c.tiles.every((t, i) => t === s.tiles[i]) &&
    sameRecord(c.chartUpg, s.chartUpg) &&
    sameRecord(c.curvUpg, s.curvUpg);
  if (same) return c.p;
  cache = {
    geometry: s.geometry,
    drifts: s.drifts,
    projections: s.projections,
    achievements: s.achievements.length,
    chartUpg: { ...s.chartUpg },
    curvUpg: { ...s.curvUpg },
    tiles: s.tiles.slice(),
    p: production(graphOf(s), s.tiles, mods(s)),
  };
  return cache.p;
}

/** Occupancy pattern the bridge relay depends on: a bridge, another tile, or empty. */
const cellState = (t: TileType | null) => (t === 'bridge' ? 'b' : t ? 'o' : '.');

/** One board's setup for many previewDelta calls: its graph, mods, production total and bridge relay. */
export interface DeltaScan {
  g: TileGraph;
  m: Mods;
  /** The scanned board; never modified. */
  tiles: (TileType | null)[];
  /** Working copy: one cell is set for each candidate and restored after. */
  scratch: (TileType | null)[];
  base: number;
  relay: Relay | null;
  /** Relays of single-cell changes, keyed by cell and new pattern (all types with that pattern share one). */
  changed: Map<number, Relay | null>;
}

export function deltaScan(s: GameState): DeltaScan {
  const g = graphOf(s);
  const m = mods(s);
  const tiles = s.tiles.slice();
  return {
    g,
    m,
    tiles,
    scratch: tiles.slice(),
    base: prod(s).total,
    relay: tiles.includes('bridge') ? relayAdjacency(g, tiles, m.reach) : null,
    changed: new Map(),
  };
}

/** Change in total Ink/s if cell i became `type`, relative to the scanned board. */
export function scanDelta(sc: DeltaScan, i: number, type: TileType | null): number {
  const tiles = sc.scratch;
  const old = tiles[i];
  tiles[i] = type;
  // The relay depends only on bridge positions and on occupied cells next to a bridge. So a change keeps the base
  // relay when the cell's pattern is unchanged, or when neither side is a bridge and no bridge touches the cell.
  const st = cellState(type);
  let relay: Relay | null;
  const bridgeFree = st !== 'b' && cellState(sc.tiles[i]) !== 'b' && !sc.g.neighbours[i].some((n) => sc.tiles[n] === 'bridge');
  if (cellState(sc.tiles[i]) === st || bridgeFree) relay = sc.relay;
  else {
    const key = i * 3 + 'bo.'.indexOf(st);
    if (!sc.changed.has(key)) sc.changed.set(key, tiles.includes('bridge') ? relayAdjacency(sc.g, tiles, sc.m.reach) : null);
    relay = sc.changed.get(key)!;
  }
  const total = production(sc.g, tiles, sc.m, relay).total;
  tiles[i] = old;
  return total - sc.base;
}

export function previewDelta(s: GameState, i: number, type: TileType | null): number {
  return scanDelta(deltaScan(s), i, type);
}

export const owned = (s: GameState, t: TileType) => s.tiles.filter((x) => x === t).length;

export const surgeMult = (s: GameState) => (s.surge > 0 ? s.surgeMult : 1);
/** Live Ink/s including the Trade Wind surge. */
export const inkPerSec = (s: GameState) => prod(s).total * surgeMult(s);

/** Catch a Trade Wind of the given kind: an instant burst of Ink plus a timed surge if the kind has one. Returns the Ink gained. */
export function catchWind(s: GameState, kind: WindKind = 'trade'): Decimal {
  const k = config.wind.kinds[kind];
  const gain = Decimal.max(prod(s).total * k.burstSec, config.wind.minInk);
  s.ink = s.ink.add(gain);
  s.runInk = s.runInk.add(gain);
  s.lifetimeInk = s.lifetimeInk.add(gain);
  if (k.surgeSec > 0) {
    s.surge = k.surgeSec;
    s.surgeMult = k.surgeMult;
  }
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
  s.stats.tilesPlaced++;
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
