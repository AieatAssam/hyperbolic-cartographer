import { config } from '../core/config';
import { GRAPHS, graphOf, isSurface, type GameState } from '../core/state';
import { closedLoopCount, isActive, maxPins, maxRing, springShare, surgeMult, surveyCost, tileCost, vaultBonus } from '../core/economy';
import { canDrift, canProject } from '../core/prestige';
import type { TileType } from '../core/tiles';
import { fmt } from './format';

/*
 * Help copy and disabled-reason helpers for the UI.
 * Pure: no DOM, no Three. All numbers come from config so the copy stays correct when balance changes.
 */

export type Tool = TileType | 'sell' | 'pin';
export type Tab = 'map' | 'constellations' | 'drift' | 'charts' | 'proj' | 'miles' | 'atlas' | 'save' | 'guide';
type Dec = GameState['ink'];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const T = config.tiles;

export const TOOL_HELP: Record<Tool, string> = {
  spring: `Produces ${fmt(T.spring.out)} Ink/s, split among the Mills it feeds: each extra Mill cuts every share (${[1, 2, 3, 4].map((k) => pct(springShare(k))).join(', ')}...). A Bridge touching it gives full flow. Tap or click an empty cell to place it.`,
  mill: `Produces ${fmt(T.mill.out)} Ink/s, plus ${pct(T.mill.perSpring)} for each adjacent Spring's share. A Spring feeding several Mills splits its output, so put Mills next to Springs that feed few others, or link the Spring with a Bridge. A Mill draws on at most ${T.mill.maxSprings} Springs.`,
  beacon: `Multiplies the output of adjacent tiles by x${T.beacon.mult}. A Beacon reached only through a Bridge adds its bonus instead of multiplying (Springs and Mills only, strongest ${T.beacon.maxRelayed} count).`,
  bridge: 'A chain of Bridges connects every tile touching the chain as if they were neighbours. A Spring touching a Bridge gives full flow to every Mill. Long Bridges extends relay one hop further.',
  vault: `Adds ${pct(T.vault.offline)} offline efficiency and ${pct(T.vault.global)} global Ink output; each further Vault adds ${pct(1 - T.vault.decay)} less than the one before (limit +${pct(T.vault.global / (1 - T.vault.decay))}).`,
  lighthouse: `Multiplies the output of producers exactly 2 steps away by x${T.lighthouse.mult}. Stacks with other Lighthouses; Bridges do not extend its reach.`,
  cistern: `Each Spring next to a Cistern makes x${T.cistern.mult} Ink. Cisterns stack with each other.`,
  scriptorium: `Makes ${fmt(T.scriptorium.out)} Ink/s for each different kind of tile next to it (up to 5). Beacons and Lighthouses boost it.`,
  sell: `Tap or click a tile to remove it for a ${pct(config.sellRefund)} refund.`,
  pin: 'Tap or click a tile to pin it. Pinned tiles survive Drift. Slots are limited; Brass Pins adds more.',
};

/** One-line effect copy for the phone info card (cost/meta sit on their own lines). */
export const TOOL_EFFECT: Record<Tool, string> = {
  spring: `Produces ${fmt(T.spring.out)} Ink/s.`,
  mill: `Produces ${fmt(T.mill.out)} Ink/s; +${pct(T.mill.perSpring)} per adjacent Spring's share (strain-reduced when a Spring feeds several Mills).`,
  beacon: `Adjacent tiles output ×${T.beacon.mult} (stacks). Beacons reached only through a Bridge add instead.`,
  bridge: 'Touching a bridge chain links all tiles on that chain.',
  vault: `+${pct(T.vault.offline)} offline efficiency; +${pct(T.vault.global)} global Ink, shrinking ${pct(1 - T.vault.decay)} per extra Vault.`,
  lighthouse: `Producers 2 steps away x${T.lighthouse.mult}.`,
  cistern: `Springs next to it x${T.cistern.mult} Ink.`,
  scriptorium: `${fmt(T.scriptorium.out)} Ink/s per kind of tile next to it.`,
  sell: `${pct(config.sellRefund)} refund on removed tiles.`,
  pin: 'Pinned tiles survive Drift; slots are limited.',
};

export const TAB_HELP: Record<Tab, string> = {
  map: 'Your board. Pick a tool from the palette (keys 1-8, S, P), then tap or click a cell. Survey adds rings of cells to build on.',
  constellations: 'Named tile patterns on the board. Complete one to earn Ink and see gold lines. Each unique shape counts once per run.',
  drift: 'Drift ends the current run and turns its Ink into Charts. Charts buy permanent upgrades. Only pinned tiles survive.',
  charts: 'Charts buy permanent upgrades. Each upgrade has levels, and the button shows the cost of the next one.',
  proj: 'Projection is the next step after Drift. It spends this cycle\'s Charts on Curvature, moves the map to the hyperbolic disk (or a surface you have folded, if you pick one), and resets the run.',
  miles: 'Milestones unlock as you Drift and Project. Each one changes how the game plays, so check here when a new feature appears.',
  atlas: 'Achievements and lifetime numbers. Each achievement adds +1% Ink.',
  save: 'Sound and music volume, the number format, and your save: export, import or wipe it. Save strings include a checksum, so edits are rejected.',
  guide: 'A guide to tiles, bonuses, Survey, Drift, Projection and the closed surfaces. Open it any time from the Guide button.',
};

export const BUTTON_HELP: Record<
  'menu' | 'guide' | 'survey' | 'recenter' | 'drift' | 'project' | 'buyChart' | 'buyCurv' | 'autoDrift' | 'blueprintSave' | 'blueprintClear' | 'blueprintAuto' |
  'copy' | 'download' | 'import' | 'notation' | 'reset' | 'place' | 'cancel' |
  'tutNext' | 'tutBack' | 'tutHide' | 'tutRestart' | 'check' | 'overwrite' | 'confirmReset' | 'close' | 'sound',
  string
> = {
  menu: 'Open or close the side panel with the Drift, Charts, Projection and Settings tabs.',
  guide: 'Open the guide. It explains tiles, bonuses, Survey, Drift, Projection and the closed surfaces.',
  survey: 'Add the next ring of cells to the board. Costs Ink, and each ring costs more.',
  recenter: 'Reset the camera to the start view, centred on the board.',
  drift: 'End this run and turn its Ink into Charts. Pinned tiles stay; the rest of the board is cleared.',
  project: 'Spend this cycle\'s Charts on Curvature, move to the hyperbolic board or a surface you have folded, and reset the run.',
  buyChart: 'Spend Charts to raise this upgrade by one level.',
  buyCurv: 'Spend Curvature to raise this upgrade by one level.',
  autoDrift: 'Drift automatically once run Charts reach the number you set.',
  blueprintSave: 'Save the current layout as this board\'s blueprint. Replaces any blueprint already saved here.',
  blueprintClear: 'Forget this board\'s blueprint. Tiles already placed stay where they are.',
  blueprintAuto: 'Rebuild the blueprint automatically as Ink allows, after each Drift.',
  copy: 'Copy the save string to the clipboard. Paste it into Import later to restore progress.',
  download: 'Download your save as a .json file to keep as a backup.',
  import: 'Load a save string or .json file. You see a preview before anything is overwritten.',
  notation: 'Choose how large numbers are shown: suffixes like 1.23M, or scientific like 1.23e6.',
  reset: 'Wipe all progress, including Charts, Curvature and milestones. This cannot be undone.',
  place: 'Place the selected tile on the cell you tapped or clicked.',
  cancel: 'Close this window without changing anything.',
  tutNext: 'Go to the next tutorial step.',
  tutBack: 'Go back to the previous tutorial step.',
  tutHide: 'Hide the tutorial for now. You can bring it back later.',
  tutRestart: 'Start the tutorial again from the first step.',
  check: 'Check the pasted save string. Shows a preview; nothing is changed yet.',
  overwrite: 'Replace your current save with the checked one. Your previous save is kept as a backup.',
  confirmReset: 'Confirm the hard reset. It only works after you type RESET.',
  close: 'Close this window and go back to the game.',
  sound: 'Mute or restore all music and sound effects. Volume sliders are in Menu > Settings.',
};

const W = config.wind.kinds;
const SURF = config.surfaces;
/** Every source of extra Ink or Curvature that is not a tile, for the Guide. Numbers come from config. */
export const BONUS_HELP: [string, string][] = [
  ['Constellations', `Build a named pattern (see the Stars tab) for a lump of Ink: its listed amount or ${config.constellationScale.sec} s of your Ink/s, whichever is larger. Repeating the same pattern in one run pays less each time.`],
  ['Trade Winds', `Every ${config.wind.minGap}-${config.wind.maxGap} s a wind chip appears in the top bar for ${config.wind.life} s. Tap it. ${W.trade.name}: ${W.trade.burstSec} s of Ink/s at once, then all output x${W.trade.surgeMult} for ${W.trade.surgeSec} s. ${W.gale.name}: ${W.gale.burstSec} s of Ink/s, then x${W.gale.surgeMult} for ${W.gale.surgeSec} s. ${W.monsoon.name} (rare): ${W.monsoon.burstSec} s of Ink/s at once. Winds only come while the game is open.`],
  ['Achievements', `Each one adds +${pct(config.achievements.inkPerEach)} Ink for good. The Atlas tab lists them.`],
  ['Chart and Curvature upgrades', 'Permanent. Charts come from Drift, Curvature from Projection; each upgrade row says what one more level does.'],
  ['Milestones', 'Unlock new features (pins, blueprints, auto-Drift and more) as you Drift and Project. The Milestones tab says what each one does and what unlocks it.'],
  ['Offline', `While the game is closed you earn ${pct(config.offline.baseEff)} of your Ink/s for up to ${config.offline.capHours} hours. Vaults raise that share.`],
  ['Surface multiplier', `Every closed surface multiplies all Ink: ${SURF.mobius.name} x${SURF.mobius.inkMult}, ${SURF.torus.name} x${SURF.torus.inkMult}, ${SURF.klein.name} x${SURF.klein.inkMult}.`],
  ['Closed loops', `On a surface, put a tile on every cell of a path that runs all the way round and meets itself. While it stays closed, all Ink is multiplied (${SURF.mobius.name} x${SURF.mobius.loopMult}, ${SURF.torus.name} x${SURF.torus.loopMult} per loop, ${SURF.klein.name} x${SURF.klein.loopMult} per loop). It also adds Curvature to your next Projection (+${SURF.mobius.loopCurvature}, +${SURF.torus.loopCurvature} per loop, +${SURF.klein.loopCurvature} per loop), even if a Drift clears the tiles afterwards.`],
];

/** What each top-bar number means, for the Guide and the top-bar tooltips. */
export const STAT_HELP: Record<'ink' | 'rate' | 'charts' | 'curvature' | 'chartsOnDrift', [string, string]> = {
  ink: ['Ink', 'What tiles make and what tiles and Survey cost. A Drift resets it.'],
  rate: ['Ink/s', 'Ink your board makes each second, after every multiplier. Menu > Map lists the multipliers.'],
  charts: ['Charts', 'Earned by Drifting. Spend them in the Charts tab on permanent upgrades; a Projection resets them.'],
  curvature: ['Curvature', 'Earned by Projecting (more Charts this cycle and closed loops give more). Buys Curvature upgrades and Folds, and is never reset.'],
  chartsOnDrift: ['Charts on Drift', 'Charts you would get if you Drifted now, and how fast that number is growing.'],
};

/**
 * Multipliers that apply to all Ink right now, with the reason for each (those at x1 are left out).
 * Their product is the whole-board multiplier that production() applies.
 */
export function multiplierLines(s: GameState): { name: string; mult: number; why: string }[] {
  const vaults = s.tiles.filter((t) => t === 'vault').length;
  const loops = isSurface(s.geometry) ? closedLoopCount(GRAPHS[s.geometry], s.tiles) : 0;
  const surf = isSurface(s.geometry) ? config.surfaces[s.geometry] : null;
  return [
    { name: 'Better Instruments', mult: 2 ** s.chartUpg.global, why: `Chart upgrade, level ${s.chartUpg.global}` },
    { name: 'Achievements', mult: 1 + config.achievements.inkPerEach * s.achievements.length, why: `${s.achievements.length} earned, +${pct(config.achievements.inkPerEach)} each` },
    { name: 'Vaults', mult: 1 + vaultBonus(vaults), why: `${vaults} on the board` },
    { name: surf?.name ?? '', mult: surf?.inkMult ?? 1, why: 'this surface' },
    { name: 'Closed loops', mult: (surf?.loopMult ?? 1) ** loops, why: `${loops} closed, x${surf?.loopMult} each` },
    { name: 'Wind surge', mult: surgeMult(s), why: `${Math.ceil(s.surge)} s left` },
  ].filter((l) => l.mult > 1);
}

/** How the closed-surface stages work, for the Guide. */
export const SURFACE_HELP: string[] = [
  `After your first Projection, the Projection tab offers a Fold: spend Curvature once to unlock the next surface (${SURF.mobius.name} ${SURF.mobius.foldCost}, ${SURF.torus.name} ${SURF.torus.foldCost}, ${SURF.klein.name} ${SURF.klein.foldCost}). Then pick it as the target of your next Projection.`,
  'Survey grows a charted patch from the middle until the whole surface is open. Glass cells are not surveyed yet.',
  'Drag to slide the tiles round the surface, so cells on the far side or inside come to you. Pinch or scroll to zoom; arrow keys slide too. Centre turns the selected cell to face you.',
  '2D chart lays the whole surface out flat. Edges with matching arrows are glued together; gold arrows pointing opposite ways mean the edge is glued with a flip.',
];

export const SURVEY_EXPLAIN =
  `Survey adds one ring of cells to the board, so you have more places to build. Each ring costs more Ink than the last; the cost grows ${config.square.surveyGrowth}x per ring on the square board.`;

export const DRIFT_RESETS: string[] = [
  'Ink and run Ink (back to the starting amount)',
  'Tiles, except pinned ones',
  'Surveyed rings (back to your starting rings)',
  'Run time',
];

export const DRIFT_KEEPS: string[] = [
  'Charts',
  'Chart upgrades',
  'Curvature and Curvature upgrades',
  'Milestones',
  'Pinned tiles',
];

export const DRIFT_EXPLAIN =
  `Drift unlocks when this run reaches ${fmt(config.drift.minInk)} Ink. ` +
  `You get Charts equal to run Ink divided by ${fmt(config.drift.divisor)}, raised to the power ${config.drift.exponent}, rounded down. ` +
  'Drift when the gain is worth it: Charts are permanent, and a fresh run starts with the boosts you already own.';

export interface ProjectionCompare {
  square: { neighbours: number; millMax: number };
  hyper: { neighbours: number; millMax: number };
  lines: string[];
}

/** Best-case Mill output: its own base plus the per-Spring bonus for every neighbour being a Spring. */
const millMax = (neighbours: number) => T.mill.out * (1 + T.mill.perSpring * neighbours);

export function projectionCompare(): ProjectionCompare {
  const sq = GRAPHS.square.neighbours[0].length;
  const hy = GRAPHS.hyper.neighbours[0].length;
  const sqMax = millMax(sq);
  const hyMax = millMax(hy);
  return {
    square: { neighbours: sq, millMax: sqMax },
    hyper: { neighbours: hy, millMax: hyMax },
    lines: [
      `On the square board each cell touches ${sq} neighbours, so a Mill can make up to ${fmt(sqMax)} Ink/s.`,
      `On the hyperbolic {7,3} board each cell touches ${hy} neighbours, so the same Mill can make up to ${fmt(hyMax)} Ink/s.`,
      'Hyperbolic rings grow much faster, so there is far more room to build and adjacency matters more.',
      `Projection resets the run, including tiles and Charts. It needs ${config.projection.minCharts} Charts earned in this cycle.`,
      'Your Ink/s may be lower right after projecting, because the board starts nearly empty.',
    ],
  };
}

export const PROJECTION_RESETS: string[] = [
  'Ink and run Ink',
  'Charts and Charts this cycle',
  'Chart upgrades, except the first ones kept by Bound Atlas',
  'Tiles, unless Pinned tiles survive Projection',
  'Pins, unless Pinned tiles survive Projection',
  'Surveyed rings',
];

export const PROJECTION_KEEPS: string[] = [
  'Curvature and Curvature upgrades',
  'Milestones',
  'Drift and Projection counts',
  'Chart upgrades kept by Bound Atlas',
];

/** Short reason why an action is unavailable, or null when it is allowed. */
export function surveyBlocked(s: GameState): string | null {
  if (s.ring >= maxRing(s)) return 'Every ring is surveyed';
  const cost = surveyCost(s);
  if (s.ink.gte(cost)) return null;
  return `Need ${fmt(cost.sub(s.ink), s.notation)} more Ink`;
}

export function driftBlocked(s: GameState): string | null {
  if (canDrift(s)) return null;
  if (s.runInk.lt(config.drift.minInk))
    return `Run Ink ${fmt(s.runInk, s.notation)} of ${fmt(config.drift.minInk, s.notation)}`;
  return 'Nothing to gain from Drift yet';
}

export function projectBlocked(s: GameState): string | null {
  if (canProject(s)) return null;
  const need = config.projection.minCharts - s.cycleCharts.toNumber();
  return `Need ${fmt(need, s.notation)} more Charts this cycle (${config.projection.minCharts} needed)`;
}

export function upgradeBlocked(
  level: number,
  max: number,
  cost: Dec,
  bank: Dec,
  unit: string,
  notation: GameState['notation'],
): string | null {
  if (level >= max) return 'Maxed';
  if (bank.gte(cost)) return null;
  return `Need ${fmt(cost.sub(bank), notation)} more ${unit}`;
}

export function placeBlocked(s: GameState, i: number, tool: Tool): string | null {
  const unsurveyed = () => `Survey ring ${graphOf(s).ring[i]} first`;
  if (!isActive(s, i)) {
    if (tool === 'sell') return unsurveyed();
    if (tool === 'pin') return 'Only tiles can be pinned';
    return unsurveyed();
  }
  if (tool === 'sell') return s.tiles[i] ? null : 'Nothing to sell here';
  if (tool === 'pin') {
    if (!s.tiles[i]) return 'Only tiles can be pinned';
    if (s.pinned.includes(i)) return null;
    if (s.pinned.length >= maxPins(s)) return 'No pin slots left (Brass Pins adds more)';
    return null;
  }
  if (s.tiles[i]) return 'Occupied: use Sell first';
  const cost = tileCost(s, tool);
  if (s.ink.gte(cost)) return null;
  return `Need ${fmt(cost.sub(s.ink), s.notation)} more Ink`;
}
