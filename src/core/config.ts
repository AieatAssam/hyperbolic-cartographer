/** Every balance number lives here. Change numbers, not formulas (see README "Balance"). */
export const config = {
  tickRate: 10,
  tiles: {
    /** strain: each extra Mill on one Spring cuts that Spring's share by 1/(1+strain*(k-1)); a Bridge-touching Spring is channelled (full share). deepWells: each Deep Wells level multiplies strain by this. */
    spring: { cost: 10, out: 1.15, strain: 0.33, deepWells: 0.8 },
    /** maxSprings: a Mill counts only its strongest N Spring shares (matters only through Bridges). */
    mill: { cost: 85, out: 18, perSpring: 1, maxSprings: 8 },
    /** maxRelayed: only the strongest N Beacons reached through a Bridge count for one producer. */
    beacon: { cost: 1000, mult: 1.5, maxRelayed: 6 },
    bridge: { cost: 5200 },
    /** global: the first Vault's bonus; each further Vault adds `decay` times the one before (limit global/(1-decay)). */
    vault: { cost: 25000, offline: 0.1, global: 0.02, decay: 0.97 },
    lighthouse: { cost: 50000, mult: 1.25 },
    /** Each Spring adjacent to a Cistern multiplies its own output by mult (per Cistern). */
    cistern: { cost: 2500, mult: 3 },
    /** Output = out x number of distinct other tile types adjacent to it. */
    scriptorium: { cost: 8000, out: 15 },
  },
  costGrowth: 1.12,
  sellRefund: 0.5,
  square: { startRing: 1, maxRing: 5, surveyBase: 50, surveyGrowth: 6 },
  hyper: { startRing: 2, maxRing: 3, surveyBase: 2e5, surveyGrowth: 12 },
  drift: { minInk: 2.42e5, divisor: 2.5e5, exponent: 0.5 },
  projection: { minCharts: 25 },
  offline: { baseEff: 0.5, capHours: 8 },
  startInk: 22,
  /** Trade Wind: a timed chance to catch a burst of Ink plus a production surge (live play only). */
  wind: { minGap: 40, maxGap: 80, life: 14, burstSec: 30, minInk: 25, surgeSec: 20, surgeMult: 3 },
  /** One-time run rewards (first placement of each kind). */
  rewards: { firstMillInk: 35, firstBridgeInk: 120 },
  /** Named shape bonuses (graph adjacency; once per unique instance per run). */
  constellations: {
    inkstream: { name: 'Inkstream', bonusInk: 55, blurb: 'A line of three Springs.' },
    millwheel: { name: 'Millwheel', bonusInk: 80, blurb: 'A Mill ringed by Springs on three sides.' },
    twinmills: { name: 'Twin Mills', bonusInk: 150, blurb: 'A Bridge linking two Mills.' },
  },
  camera: {
    polarY: 13, polarZ: 9, margin: 12, phoneFill: 1.0, desktopFill: 1.0,
    /** Portrait playable board: polar from +Y (smaller = more overhead). ~32°. */
    portraitPolar: 0.55,
    /** Pixels between HUD and the top of the fitted footprint on portrait. */
    portraitTopPad: 18,
  },
  ui: { inspectFadeMs: 300, /** mill_wheel spin while the mill produces, rad/s */ wheelSpin: 1.6 },
  autoSpringInterval: 1, // seconds between auto-placed Springs
  /** Manifold preview (Layer 3): grid sizes, framing, skin. */
  manifold: {
    torusWidth: 16,
    torusHeight: 8,
    kleinWidth: 8,
    kleinHeight: 8,
    torusMajorR: 6.1,
    torusMinorR: 1.65,
    chartSpan: 8.8,
    chartFill: 0.82,
    boardFillTarget: 0.8,
    boardFillMin: 0.55,
    boardFillMax: 0.88,
    /** Klein camera: radians, ~30° azimuth from +Z in XZ. */
    kleinImmersionAzimuth: Math.PI / 6,
    /** Elevation above XZ plane (~12°). */
    kleinImmersionElev: (12 * Math.PI) / 180,
    /** Idle Y-spin half-range for Klein immersion (±30°). */
    kleinSpinSway: (30 * Math.PI) / 180,
    kleinBoardFillMin: 0.6,
    kleinBoardFillMax: 0.7,
    chartPolar: 0.07,
    frameMargin: 16,
    fitSpinSteps: 16,
    /** Spreads used only for fill measurement (best-spin), not for extent margin. */
    fillMeasureSpins: 4,
    manifoldLegLift: 0.1,
    idleSpin: 0.09,
    tileExtrude3d: 0.55,
    skinLift: 0.016,
    tileGap: 0.1,
    skinAlpha: 0.5,
    /** Klein immersion glass skin (torus keeps skinAlpha). */
    kleinSkinAlpha: 0.32,
    /** Klein tiles over the glass (placed + empty patches). */
    kleinTileAlpha: 0.95,
    /** Back-facing patch faces seen through the glass. */
    kleinBackfaceDim: 0.4,
    skinRimEmissive: 0.42,
    demoMillOut: 8,
    kleinImmersionScale: 2.8,
    kleinSkinU: 96,
    kleinSkinV: 48,
    torusImmersionPolar: 1.08,
    patchSubdiv: 6,
    torusSkinU: 160,
    torusSkinV: 48,
    kleinSkinDetail: 2,
    dragFlow: 0.0025,
    idleFlow: 0.012,
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
  { id: 'cheapSprings', name: 'Deep Wells', desc: 'Springs thin 20% less per extra Mill', max: 4, cost: (l) => 1 * 2 ** l },
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
  { id: 'bridgeReach', name: 'Long Bridges', desc: 'Bridge relay +1 extra hop past chain ends', max: 2, cost: (l) => 2 + 2 * l },
];

export const curvatureGain = (charts: number) => (charts < 1 ? 0 : Math.floor(Math.log2(charts)));
