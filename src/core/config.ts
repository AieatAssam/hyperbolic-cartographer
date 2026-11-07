/** Every balance number lives here. Change numbers, not formulas (see README "Balance"). */
export const config = {
  tickRate: 10,
  tiles: {
    spring: { cost: 10, out: 1 },
    mill: { cost: 100, out: 9, perSpring: 1 },
    beacon: { cost: 1000, mult: 1.5 },
    bridge: { cost: 5000 },
    vault: { cost: 25000, offline: 0.1, global: 0.02 },
  },
  costGrowth: 1.15,
  sellRefund: 0.5,
  square: { startRing: 1, maxRing: 5, surveyBase: 50, surveyGrowth: 6 },
  hyper: { startRing: 2, maxRing: 3, surveyBase: 2e5, surveyGrowth: 12 },
  drift: { minInk: 1e6, divisor: 2.5e5, exponent: 0.5 },
  projection: { minCharts: 25 },
  offline: { baseEff: 0.5, capHours: 8 },
  startInk: 10,
  autoSpringInterval: 1, // seconds between auto-placed Springs
  /** Manifold preview (Layer 3): grid sizes, framing, skin. */
  manifold: {
    torusWidth: 16,
    torusHeight: 8,
    kleinWidth: 8,
    kleinHeight: 8,
    torusMajorR: 5.5,
    torusMinorR: 1.55,
    chartSpan: 8.8,
    chartFill: 0.82,
    boardFill3d: 0.65,
    kleinImmersionFill: 0.68,
    chartPolar: 0.07,
    frameMargin: 16,
    fitSpinSteps: 16,
    idleSpin: 0.09,
    tileExtrude3d: 0.55,
    skinLift: 0.016,
    tileGap: 0.1,
    skinAlpha: 0.38,
    demoMillOut: 8,
    kleinImmersionScale: 1.2,
    kleinSkinU: 96,
    kleinSkinV: 48,
    kleinImmersionPolar: 0.88,
  },
};

export type ChartUpgradeId =
  | 'global' | 'cheapSprings' | 'pins' | 'startRings' | 'beacon' | 'autoSurvey' | 'autoSprings' | 'offlineCap';
export type CurvUpgradeId = 'keepUpgrades' | 'bridgeReach' | 'beaconDegree' | 'extraRing' | 'driftGain';

export interface UpgradeDef<Id> {
  id: Id;
  name: string;
  desc: string;
  max: number;
  cost: (lvl: number) => number;
}

/** Chart upgrades, bought with Charts. Order matters for "keep N upgrades". */
export const chartUpgrades: UpgradeDef<ChartUpgradeId>[] = [
  { id: 'global', name: 'Better Instruments', desc: 'x2 all Ink output', max: 6, cost: (l) => 1 * 3 ** l },
  { id: 'cheapSprings', name: 'Spring Charts', desc: 'Springs cost x0.6', max: 4, cost: (l) => 1 * 2 ** l },
  { id: 'beacon', name: 'Lens Grinding', desc: 'Beacons +0.25x', max: 4, cost: (l) => 2 * 3 ** l },
  { id: 'startRings', name: 'Prior Surveys', desc: 'Start each run +1 ring', max: 3, cost: (l) => 3 * 4 ** l },
  { id: 'pins', name: 'Brass Pins', desc: '+1 pin', max: 4, cost: (l) => 2 * 3 ** l },
  { id: 'autoSurvey', name: 'Survey Crew', desc: 'Auto-Survey when affordable', max: 1, cost: () => 5 },
  { id: 'autoSprings', name: 'Well Diggers', desc: 'Auto-place Springs into empty cells', max: 1, cost: () => 8 },
  { id: 'offlineCap', name: 'Ship’s Log', desc: '+4h offline cap', max: 4, cost: (l) => 2 * 2 ** l },
];

export const curvUpgrades: UpgradeDef<CurvUpgradeId>[] = [
  { id: 'extraRing', name: 'Deeper Horizon', desc: '+1 hyperbolic ring (to radius 4)', max: 1, cost: () => 3 },
  { id: 'beaconDegree', name: 'Negative Curvature', desc: 'Beacons +0.05x per neighbour of the cell', max: 3, cost: (l) => 1 * 2 ** l },
  { id: 'driftGain', name: 'Tailwind', desc: 'x1.5 Charts on Drift', max: 4, cost: (l) => 1 * 2 ** l },
  { id: 'keepUpgrades', name: 'Bound Atlas', desc: 'Keep the first N Chart upgrades on Projection', max: 4, cost: (l) => 1 * 2 ** l },
  { id: 'bridgeReach', name: 'Long Bridges', desc: 'Bridges reach +1 hop', max: 2, cost: (l) => 2 + 2 * l },
];

export const curvatureGain = (charts: number) => (charts < 1 ? 0 : Math.floor(Math.log2(charts)));
