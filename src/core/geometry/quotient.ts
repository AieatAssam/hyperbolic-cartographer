/**
 * Quotient-surface graph generators (C2). Pure, Node-testable; no DOM or Three.
 * Torus: opposite edges of a W×H grid identified without flip.
 * Klein bottle: one pair glued normally, the other with a flip (non-orientable).
 */
import type { TileGraph } from './graph';

export interface SurfaceGraph extends TileGraph {
  width: number;
  height: number;
  /** Lattice coordinates per node (column, row) in 0..width-1 × 0..height-1. */
  xy: [number, number][];
  /** Undirected edge crosses a drawn seam (fundamental polygon cut). */
  seamEdge(a: number, b: number): boolean;
  /** Crossing this undirected edge negates chirality (Klein flip seam only). */
  flipEdge(a: number, b: number): boolean;
  /** Non-contractible cycles: 2g loops for orientable genus g; Klein uses GDD exception (1 orientable + 1 flipping). */
  cycleBasis: number[][];
}

const wrap = (v: number, n: number) => ((v % n) + n) % n;

function idx(w: number, x: number, y: number) {
  return y * w + x;
}

/** Build neighbours on a torus-identified grid (both pairs glide, no flip). */
export function torusGraph(width: number, height: number): SurfaceGraph {
  const n = width * height;
  const xy: [number, number][] = Array.from({ length: n }, (_, i) => [i % width, Math.floor(i / width)]);
  const ring = xy.map(([x, y]) => Math.min(Math.min(x, width - 1 - x), Math.min(y, height - 1 - y)));
  const neighbours: number[][] = xy.map(([x, y]) => {
    const ns: number[] = [];
    const left = idx(width, wrap(x - 1, width), y);
    const right = idx(width, wrap(x + 1, width), y);
    const up = idx(width, x, wrap(y - 1, height));
    const down = idx(width, x, wrap(y + 1, height));
    ns.push(left, right, up, down);
    ns.sort((a, b) => a - b);
    return ns;
  });
  const seamEdge = (a: number, b: number) => {
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    return (ax === 0 && bx === width - 1) || (ax === width - 1 && bx === 0)
      || (ay === 0 && by === height - 1) || (ay === height - 1 && by === 0);
  };
  const flipEdge = () => false;
  /** Horizontal and vertical ring generators through (0,0), each closed. */
  const horiz = Array.from({ length: width }, (_, x) => idx(width, x, 0));
  horiz.push(horiz[0]);
  const vert = Array.from({ length: height }, (_, y) => idx(width, 0, y));
  vert.push(vert[0]);
  const cycleBasis = [horiz, vert];
  return { ring, neighbours, width, height, xy, seamEdge, flipEdge, cycleBasis };
}

/**
 * Klein bottle fundamental square: horizontal edges glued normally; vertical with flip
 * (row y on left meets row height-1-y on right).
 */
export function kleinGraph(width: number, height: number): SurfaceGraph {
  const n = width * height;
  const xy: [number, number][] = Array.from({ length: n }, (_, i) => [i % width, Math.floor(i / width)]);
  const ring = xy.map(([x, y]) => Math.min(Math.min(x, width - 1 - x), Math.min(y, height - 1 - y)));
  const neighAt = (x: number, y: number): number => idx(width, x, y);
  const neighbours: number[][] = xy.map(([x, y]) => {
    const ns: number[] = [];
    const leftX = x === 0 ? width - 1 : x - 1;
    const leftY = x === 0 ? height - 1 - y : y;
    const rightX = x === width - 1 ? 0 : x + 1;
    const rightY = x === width - 1 ? height - 1 - y : y;
    const upY = y === 0 ? height - 1 : y - 1;
    const downY = y === height - 1 ? 0 : y + 1;
    ns.push(neighAt(leftX, leftY), neighAt(rightX, rightY), neighAt(x, upY), neighAt(x, downY));
    return [...new Set(ns)].filter((j) => j !== neighAt(x, y)).sort((a, b) => a - b);
  });
  const seamEdge = (a: number, b: number) => {
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    if ((ax === 0 && bx === width - 1) || (ax === width - 1 && bx === 0)) return true;
    return (ay === 0 && by === height - 1) || (ay === height - 1 && by === 0);
  };
  const flipEdge = (a: number, b: number) => {
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    return (ax === 0 && bx === width - 1) || (ax === width - 1 && bx === 0)
      || (ay !== by && ((ax === 0 && bx === width - 1) || (ax === width - 1 && bx === 0)));
  };
  // Orientable loop: row 0 then row height-1 (crossing the flip seam twice), closed.
  const orient = [...Array.from({ length: width }, (_, x) => idx(width, x, 0)), ...Array.from({ length: width }, (_, x) => idx(width, x, height - 1))];
  orient.push(orient[0]);
  // Flipping loop: row 0 across the flip seam once, then straight down the wrap back to (0,0).
  const flip = [...Array.from({ length: width }, (_, x) => idx(width, x, 0)), idx(width, 0, height - 1)];
  flip.push(flip[0]);
  const cycleBasis = [orient, flip];
  return { ring, neighbours, width, height, xy, seamEdge, flipEdge, cycleBasis };
}

/**
 * Möbius strip: a W×H band whose short ends are glued with a flip (row y meets row height-1-y). The long edges are
 * a real boundary (one edge, in fact), so edge cells have three neighbours. Its one loop runs the centre line twice.
 */
export function mobiusGraph(width: number, height: number): SurfaceGraph {
  const n = width * height;
  const xy: [number, number][] = Array.from({ length: n }, (_, i) => [i % width, Math.floor(i / width)]);
  const ring = xy.map(([x, y]) => Math.min(Math.min(x, width - 1 - x), Math.min(y, height - 1 - y)));
  const neighbours: number[][] = xy.map(([x, y]) => {
    const ns = [
      x === 0 ? idx(width, width - 1, height - 1 - y) : idx(width, x - 1, y),
      x === width - 1 ? idx(width, 0, height - 1 - y) : idx(width, x + 1, y),
    ];
    if (y > 0) ns.push(idx(width, x, y - 1));
    if (y < height - 1) ns.push(idx(width, x, y + 1));
    return [...new Set(ns)].filter((j) => j !== idx(width, x, y)).sort((a, b) => a - b);
  });
  const seamEdge = (a: number, b: number) => {
    const ax = xy[a][0], bx = xy[b][0];
    return (ax === 0 && bx === width - 1) || (ax === width - 1 && bx === 0);
  };
  // One lap along row r comes back on row height-1-r; the second lap closes the loop.
  const r = Math.floor((height - 1) / 2);
  const loop = [
    ...Array.from({ length: width }, (_, x) => idx(width, x, r)),
    ...(height - 1 - r !== r ? Array.from({ length: width }, (_, x) => idx(width, x, height - 1 - r)) : []),
  ];
  loop.push(loop[0]);
  return { ring, neighbours, width, height, xy, seamEdge, flipEdge: seamEdge, cycleBasis: [loop] };
}

/**
 * The same surface as a playable stage: `ring` becomes a Survey order that grows as a patch from the middle of the
 * chart until it closes on itself (0..rings). Neighbours and everything else are shared with `g`.
 */
export function stageGraph(g: SurfaceGraph, rings: number): SurfaceGraph {
  const n = g.ring.length;
  const cx = (g.width - 1) / 2, cy = (g.height - 1) / 2;
  const off = (i: number) => Math.max(Math.abs(g.xy[i][0] - cx) / (g.width / 2), Math.abs(g.xy[i][1] - cy) / (g.height / 2));
  let centre = 0;
  for (let i = 1; i < n; i++) if (off(i) < off(centre)) centre = i;
  // Graph distance from the middle cell, so the Survey patch grows over the surface by adjacency.
  const dist = new Array<number>(n).fill(-1);
  dist[centre] = 0;
  const queue = [centre];
  for (let h = 0; h < queue.length; h++) {
    const u = queue[h];
    for (const v of g.neighbours[u]) if (dist[v] < 0) { dist[v] = dist[u] + 1; queue.push(v); }
  }
  // Equal shares of cells per ring (every ring non-empty), nearest to the middle first.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => dist[a] - dist[b] || a - b);
  const ring = new Array<number>(n);
  order.forEach((i, rank) => (ring[i] = Math.floor((rank * (rings + 1)) / n)));
  return { ...g, ring };
}

/** Euler characteristic V − E + F for a cell complex where F = V (each node is one tile face). */
export function eulerCharacteristic(g: TileGraph): number {
  const V = g.ring.length;
  const E = g.neighbours.reduce((s, ns, i) => s + ns.filter((j) => j > i).length, 0);
  return V - E + V;
}

/** Count undirected edges. */
export function edgeCount(g: TileGraph): number {
  return g.neighbours.reduce((s, ns, i) => s + ns.filter((j) => j > i).length, 0);
}
