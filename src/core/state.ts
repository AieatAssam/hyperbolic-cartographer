import Decimal from 'break_eternity.js';
import { chartUpgrades, config, curvUpgrades, type ChartUpgradeId, type CurvUpgradeId } from './config';
import type { TileType } from './tiles';
import type { ConstellationId } from './constellations';
import { squareGraph } from './geometry/square';
import { hyperGraph } from './geometry/hyperbolic';
import type { TileGraph } from './geometry/graph';
import { torusGraph, kleinGraph } from './geometry/quotient';

export type Geometry = 'square' | 'hyper';
export type SurfacePreview = 'off' | 'torus' | 'klein';

export interface GameState {
  ink: Decimal;
  runInk: Decimal;
  lifetimeInk: Decimal;
  geometry: Geometry;
  /** surveyed radius; node i is active when graph.ring[i] <= ring */
  ring: number;
  /** tile per graph node (graphs are generated once at max size, so indices are stable) */
  tiles: (TileType | null)[];
  pinned: number[];
  charts: Decimal;
  /** Charts earned this Projection cycle (drives Projection unlock + Curvature gain) */
  cycleCharts: Decimal;
  curvature: Decimal;
  chartUpg: Record<ChartUpgradeId, number>;
  curvUpg: Record<CurvUpgradeId, number>;
  drifts: number;
  projections: number;
  autoDrift: { on: boolean; at: number };
  runTime: number;
  totalTime: number;
  autoSpringTimer: number;
  notation: 'suffix' | 'sci';
  /** Unique pattern keys claimed this run (cleared on Drift). */
  constellationKeys: string[];
  /** Log of completed patterns (persists across Drift). */
  constellationLog: { id: ConstellationId; bonusInk: number; at: number }[];
  /** seconds of Trade Wind surge left (live play only) */
  surge: number;
  windsCaught: number;
}

// Generated once at max size (hyper radius 4 = 232 tiles).
export const GRAPHS: Record<Geometry, TileGraph> = {
  square: squareGraph(config.square.maxRing),
  hyper: hyperGraph(config.hyper.maxRing + 1),
};

/** Manifold preview quotient graphs (sizes from config.manifold). */
export const SURFACE_GRAPHS = {
  torus: torusGraph(config.manifold.torusWidth, config.manifold.torusHeight),
  klein: kleinGraph(config.manifold.kleinWidth, config.manifold.kleinHeight),
} as const;

export const graphOf = (s: GameState) => GRAPHS[s.geometry];

export const zeroUpgrades = <Id extends string>(defs: { id: Id }[]) =>
  Object.fromEntries(defs.map((d) => [d.id, 0])) as Record<Id, number>;

export function initialState(): GameState {
  return {
    ink: new Decimal(config.startInk),
    runInk: new Decimal(0),
    lifetimeInk: new Decimal(0),
    geometry: 'square',
    ring: config.square.startRing,
    tiles: GRAPHS.square.ring.map(() => null),
    pinned: [],
    charts: new Decimal(0),
    cycleCharts: new Decimal(0),
    curvature: new Decimal(0),
    chartUpg: zeroUpgrades(chartUpgrades),
    curvUpg: zeroUpgrades(curvUpgrades),
    drifts: 0,
    projections: 0,
    autoDrift: { on: false, at: 10 },
    runTime: 0,
    totalTime: 0,
    autoSpringTimer: 0,
    notation: 'suffix',
    constellationKeys: [],
    constellationLog: [],
    surge: 0,
    windsCaught: 0,
  };
}
