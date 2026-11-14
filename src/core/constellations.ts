/**
 * Named tile-shape patterns on the tile graph (square or hyperbolic). Pure core.
 */
import { config } from './config';
import { prod } from './economy';
import { graphOf, type GameState } from './state';
import type { TileGraph } from './geometry/graph';
import type { TileType } from './tiles';

export type ConstellationId = 'inkstream' | 'millwheel' | 'twinmills' | 'watergarden' | 'crown' | 'library' | 'longspan' | 'harbour';

export interface ConstellationMatch {
  id: ConstellationId;
  cells: number[];
  edges: [number, number][];
}

export interface ConstellationEvent {
  id: ConstellationId;
  name: string;
  bonusInk: number;
  cells: number[];
  edges: [number, number][];
}

const DEF = () => config.constellations;

export function matchKey(m: Pick<ConstellationMatch, 'id' | 'cells'>): string {
  return `${m.id}:${[...m.cells].sort((a, b) => a - b).join(',')}`;
}

function edge(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

function pushUnique(out: ConstellationMatch[], seen: Set<string>, m: ConstellationMatch) {
  const k = matchKey(m);
  if (seen.has(k)) return;
  seen.add(k);
  out.push(m);
}

function isProducer(t: TileType | null): boolean {
  return t === 'spring' || t === 'mill' || t === 'scriptorium';
}

/** All complete patterns on the board right now. */
export function detectMatches(g: TileGraph, tiles: (TileType | null)[]): ConstellationMatch[] {
  const out: ConstellationMatch[] = [];
  const seen = new Set<string>();
  const n = g.ring.length;

  for (let j = 0; j < n; j++) {
    if (tiles[j] !== 'spring') continue;
    for (const a of g.neighbours[j]) {
      if (tiles[a] !== 'spring') continue;
      for (const c of g.neighbours[j]) {
        if (c === a || tiles[c] !== 'spring') continue;
        if (g.neighbours[a].includes(c)) continue;
        pushUnique(out, seen, {
          id: 'inkstream',
          cells: [a, j, c],
          edges: [edge(a, j), edge(j, c)],
        });
      }
    }
  }

  for (let m = 0; m < n; m++) {
    if (tiles[m] !== 'mill') continue;
    const springs = g.neighbours[m].filter((i) => tiles[i] === 'spring');
    if (springs.length < 3) continue;
    pushUnique(out, seen, {
      id: 'millwheel',
      cells: [m, ...springs],
      edges: springs.map((s) => edge(m, s)),
    });
  }

  for (let b = 0; b < n; b++) {
    if (tiles[b] !== 'bridge') continue;
    const mills = g.neighbours[b].filter((i) => tiles[i] === 'mill');
    if (mills.length < 2) continue;
    pushUnique(out, seen, {
      id: 'twinmills',
      cells: [b, ...mills],
      edges: mills.map((m) => edge(b, m)),
    });
  }

  for (let j = 0; j < n; j++) {
    if (tiles[j] !== 'bridge') continue;
    for (const a of g.neighbours[j]) {
      if (tiles[a] !== 'bridge') continue;
      for (const c of g.neighbours[j]) {
        if (c === a || tiles[c] !== 'bridge') continue;
        if (g.neighbours[a].includes(c)) continue;
        pushUnique(out, seen, {
          id: 'longspan',
          cells: [a, j, c],
          edges: [edge(a, j), edge(j, c)],
        });
      }
    }
  }

  for (let b = 0; b < n; b++) {
    const t = tiles[b];
    if (t === 'cistern') {
      const springs = g.neighbours[b].filter((i) => tiles[i] === 'spring');
      if (springs.length >= 3) {
        pushUnique(out, seen, { id: 'watergarden', cells: [b, ...springs], edges: springs.map((s) => edge(b, s)) });
      }
    } else if (t === 'beacon') {
      const producers = g.neighbours[b].filter((i) => isProducer(tiles[i]));
      if (producers.length >= 4) {
        pushUnique(out, seen, { id: 'crown', cells: [b, ...producers], edges: producers.map((p) => edge(b, p)) });
      }
    } else if (t === 'scriptorium') {
      // Lowest-index neighbour of each distinct kind (other Scriptoria do not count).
      const firstOf = new Map<TileType, number>();
      for (const i of g.neighbours[b]) {
        const k = tiles[i];
        if (!k || k === 'scriptorium') continue;
        const cur = firstOf.get(k);
        if (cur === undefined || i < cur) firstOf.set(k, i);
      }
      if (firstOf.size >= 4) {
        const picks = [...firstOf.values()];
        pushUnique(out, seen, { id: 'library', cells: [b, ...picks], edges: picks.map((p) => edge(b, p)) });
      }
    } else if (t === 'lighthouse') {
      const bridges = g.neighbours[b].filter((i) => tiles[i] === 'bridge');
      const vaults = g.neighbours[b].filter((i) => tiles[i] === 'vault');
      if (bridges.length && vaults.length) {
        const br = Math.min(...bridges);
        const vt = Math.min(...vaults);
        pushUnique(out, seen, { id: 'harbour', cells: [b, br, vt], edges: [edge(b, br), edge(b, vt)] });
      }
    }
  }

  return out;
}

export function countOccupiedComponents(g: TileGraph, tiles: (TileType | null)[]): number {
  const seen = new Set<number>();
  let comps = 0;
  const stack: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (!tiles[i] || seen.has(i)) continue;
    comps++;
    stack.push(i);
    while (stack.length) {
      const u = stack.pop()!;
      if (seen.has(u)) continue;
      seen.add(u);
      for (const v of g.neighbours[u]) if (tiles[v] && !seen.has(v)) stack.push(v);
    }
  }
  return comps;
}

export interface PlacementFx {
  constellations: ConstellationEvent[];
  networkEdges: [number, number][] | null;
  constellationHint: ConstellationMatch | null;
}

/**
 * Ink paid for completing pattern `id` now: the fixed bonusInk, or 20 s of production
 * split across repeats (1/(1+k), k = patterns of this id already claimed this run).
 * `earlier` counts same-id patterns completed earlier in the same placement batch.
 */
export function constellationReward(s: GameState, id: ConstellationId, earlier = 0): number {
  const prefix = `${id}:`;
  const k = s.constellationKeys.filter((key) => key.startsWith(prefix)).length + earlier;
  return Math.max(DEF()[id].bonusInk, (prod(s).total * config.constellationScale.sec) / (1 + k));
}

/** Patterns newly completed by placing tile t at i (graph-only). */
export function eventsAfterPlace(s: GameState, before: (TileType | null)[], i: number, _t: TileType): ConstellationEvent[] {
  const g = graphOf(s);
  const after = s.tiles;
  const prev = detectMatches(g, before);
  const prevKeys = new Set(prev.map(matchKey));
  const next = detectMatches(g, after);
  const claimed = new Set(s.constellationKeys);
  const events: ConstellationEvent[] = [];
  const batch: Partial<Record<ConstellationId, number>> = {};
  for (const m of next) {
    const k = matchKey(m);
    if (prevKeys.has(k) || claimed.has(k)) continue;
    if (!m.cells.includes(i)) continue;
    const def = DEF()[m.id];
    const earlier = batch[m.id] ?? 0;
    batch[m.id] = earlier + 1;
    events.push({ id: m.id, name: def.name, bonusInk: constellationReward(s, m.id, earlier), cells: m.cells, edges: m.edges });
  }
  return events;
}

export function applyConstellationRewards(s: GameState, events: ConstellationEvent[]): void {
  for (const e of events) {
    s.ink = s.ink.add(e.bonusInk);
    s.runInk = s.runInk.add(e.bonusInk);
    s.lifetimeInk = s.lifetimeInk.add(e.bonusInk);
    s.stats.constellations += 1;
    s.constellationKeys.push(matchKey({ id: e.id, cells: e.cells }));
    s.constellationLog.push({ id: e.id, bonusInk: e.bonusInk, at: s.totalTime });
  }
}

export function networkLinkEdges(
  g: TileGraph,
  before: (TileType | null)[],
  after: (TileType | null)[],
  placed: number,
): [number, number][] | null {
  if (!after[placed]) return null;
  const b = countOccupiedComponents(g, before);
  const a = countOccupiedComponents(g, after);
  if (a >= b || b < 2) return null;
  const edges = g.neighbours[placed].filter((n) => after[n]).map((n) => edge(placed, n));
  return edges.length ? edges : null;
}

/** Ghost hint when previewing a placement that would complete a new pattern. */
export function hintIfPlace(s: GameState, i: number, t: TileType): ConstellationMatch | null {
  if (s.tiles[i]) return null;
  const g = graphOf(s);
  const tiles = s.tiles.slice();
  tiles[i] = t;
  const before = detectMatches(g, s.tiles);
  const beforeKeys = new Set(before.map(matchKey));
  const claimed = new Set(s.constellationKeys);
  for (const m of detectMatches(g, tiles)) {
    const k = matchKey(m);
    if (!m.cells.includes(i) || beforeKeys.has(k) || claimed.has(k)) continue;
    return m;
  }
  return null;
}
