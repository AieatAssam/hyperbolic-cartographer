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
  /** Orientable loop (horizontal) and flipping loop (crosses vertical seam twice). */
  const horiz = Array.from({ length: width }, (_, x) => idx(width, x, 0));
  const vert: number[] = [idx(width, 0, 0)];
  for (let y = 0; y < height; y++) vert.push(idx(width, width - 1, y));
  for (let y = height - 1; y >= 0; y--) vert.push(idx(width, 0, y));
  const cycleBasis = [horiz, vert];
  return { ring, neighbours, width, height, xy, seamEdge, flipEdge, cycleBasis };
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
