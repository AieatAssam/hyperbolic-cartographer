/**
 * Named tile-shape patterns on the tile graph (square or hyperbolic). Pure core.
 */
import { config } from './config';
import { graphOf, type GameState } from './state';
import type { TileGraph } from './geometry/graph';
import type { TileType } from './tiles';

export type ConstellationId = 'inkstream' | 'millwheel' | 'twinmills';

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

/** Patterns newly completed by placing tile t at i (graph-only). */
export function eventsAfterPlace(s: GameState, before: (TileType | null)[], i: number, _t: TileType): ConstellationEvent[] {
  const g = graphOf(s);
  const after = s.tiles;
  const prev = detectMatches(g, before);
  const prevKeys = new Set(prev.map(matchKey));
  const next = detectMatches(g, after);
  const claimed = new Set(s.constellationKeys);
  const events: ConstellationEvent[] = [];
  for (const m of next) {
    const k = matchKey(m);
    if (prevKeys.has(k) || claimed.has(k)) continue;
    if (!m.cells.includes(i)) continue;
    const def = DEF()[m.id];
    events.push({ id: m.id, name: def.name, bonusInk: def.bonusInk, cells: m.cells, edges: m.edges });
  }
  return events;
}

export function applyConstellationRewards(s: GameState, events: ConstellationEvent[]): void {
  for (const e of events) {
    s.ink = s.ink.add(e.bonusInk);
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
