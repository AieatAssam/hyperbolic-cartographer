import Decimal from 'break_eternity.js';
import { chartUpgrades, config, curvUpgrades, type ChartUpgradeId, type CurvUpgradeId } from './config';
import type { TileType } from './tiles';
import type { ConstellationId } from './constellations';
import { squareGraph } from './geometry/square';
import { hyperGraph } from './geometry/hyperbolic';
import type { TileGraph } from './geometry/graph';
import { torusGraph, kleinGraph, mobiusGraph, stageGraph } from './geometry/quotient';

/** Stage order: flat, hyperbolic, then the closed surfaces (unlocked one at a time; see GameState.folds). */
export const GEOMETRIES = ['square', 'hyper', 'mobius', 'torus', 'klein'] as const;
export type Geometry = (typeof GEOMETRIES)[number];
export const SURFACES = ['mobius', 'torus', 'klein'] as const;
export type Surface = (typeof SURFACES)[number];
export const isSurface = (g: Geometry): g is Surface => (SURFACES as readonly string[]).includes(g);
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
  /** Closed surfaces unlocked so far, in SURFACES order (0..3). Permanent. */
  folds: number;
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
  /** Multiplier of the running surge (set by the kind of wind caught). */
  surgeMult: number;
  /** Saved layout per geometry (tile per node index), or null. Survives Drift and Projection. */
  blueprints: Record<Geometry, (TileType | null)[] | null>;
  /** Rebuild the current geometry's blueprint automatically as Ink allows (live play only). */
  autoBuild: boolean;
  /** Ids of earned achievements (permanent). */
  achievements: string[];
  /** Lifetime counters for the Atlas stats card and achievements. */
  stats: { tilesPlaced: number; bestInkPerSec: number; constellations: number };
}

/** Manifold quotient graphs (sizes from config.manifold); `ring` here is distance from the chart edge. */
export const SURFACE_GRAPHS = {
  mobius: mobiusGraph(config.manifold.mobiusWidth, config.manifold.mobiusHeight),
  torus: torusGraph(config.manifold.torusWidth, config.manifold.torusHeight),
  klein: kleinGraph(config.manifold.kleinWidth, config.manifold.kleinHeight),
} as const;

// Generated once at max size (hyper radius 4 = 232 tiles). Surface stages share SURFACE_GRAPHS' cells with a Survey ring order.
export const GRAPHS: Record<Geometry, TileGraph> = {
  square: squareGraph(config.square.maxRing),
  hyper: hyperGraph(config.hyper.maxRing + 1),
  mobius: stageGraph(SURFACE_GRAPHS.mobius, config.surfaces.mobius.maxRing),
  torus: stageGraph(SURFACE_GRAPHS.torus, config.surfaces.torus.maxRing),
  klein: stageGraph(SURFACE_GRAPHS.klein, config.surfaces.klein.maxRing),
};

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
    folds: 0,
    autoDrift: { on: false, at: 10 },
    runTime: 0,
    totalTime: 0,
    autoSpringTimer: 0,
    notation: 'suffix',
    constellationKeys: [],
    constellationLog: [],
    surge: 0,
    windsCaught: 0,
    surgeMult: config.wind.surgeMult,
    blueprints: { square: null, hyper: null, mobius: null, torus: null, klein: null },
    autoBuild: true,
    achievements: [],
    stats: { tilesPlaced: 0, bestInkPerSec: 0, constellations: 0 },
  };
}
