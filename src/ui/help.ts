import { config } from '../core/config';
import { GRAPHS, graphOf, type GameState } from '../core/state';
import { isActive, maxPins, maxRing, surveyCost, tileCost } from '../core/economy';
import { canDrift, canProject } from '../core/prestige';
import type { TileType } from '../core/tiles';
import { fmt } from './format';

/*
 * Help copy and disabled-reason helpers for the UI.
 * Pure: no DOM, no Three. All numbers come from config so the copy stays correct when balance changes.
 */

export type Tool = TileType | 'sell' | 'pin';
export type Tab = 'map' | 'constellations' | 'drift' | 'charts' | 'proj' | 'miles' | 'save' | 'guide';
type Dec = GameState['ink'];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const T = config.tiles;

export const TOOL_HELP: Record<Tool, string> = {
  spring: `Produces ${fmt(T.spring.out)} Ink/s. Tap or click an empty cell to place it.`,
  mill: `Produces ${fmt(T.mill.out)} Ink/s, plus ${pct(T.mill.perSpring)} for each adjacent Spring. Put Mills next to Springs.`,
  beacon: `Multiplies the output of adjacent tiles by x${T.beacon.mult}. Beacons stack with each other.`,
  bridge: 'A chain of Bridges connects every tile touching the chain as if they were neighbours. Long Bridges extends relay one hop further.',
  vault: `Adds ${pct(T.vault.offline)} offline efficiency and ${pct(T.vault.global)} global Ink output for each Vault.`,
  lighthouse: `Multiplies the output of producers exactly 2 steps away by x${T.lighthouse.mult}. Stacks with other Lighthouses; Bridges do not extend its reach.`,
  sell: `Tap or click a tile to remove it for a ${pct(config.sellRefund)} refund.`,
  pin: 'Tap or click a tile to pin it. Pinned tiles survive Drift. Slots are limited; Brass Pins adds more.',
};

/** One-line effect copy for the phone info card (cost/meta sit on their own lines). */
export const TOOL_EFFECT: Record<Tool, string> = {
  spring: `Produces ${fmt(T.spring.out)} Ink/s.`,
  mill: `Produces ${fmt(T.mill.out)} Ink/s; +${pct(T.mill.perSpring)} per adjacent Spring.`,
  beacon: `Adjacent tiles output ×${T.beacon.mult} (stacks).`,
  bridge: 'Touching a bridge chain links all tiles on that chain.',
  vault: `+${pct(T.vault.offline)} offline efficiency; +${pct(T.vault.global)} global Ink each.`,
  lighthouse: `Producers 2 steps away x${T.lighthouse.mult}.`,
  sell: `${pct(config.sellRefund)} refund on removed tiles.`,
  pin: 'Pinned tiles survive Drift; slots are limited.',
};

export const TAB_HELP: Record<Tab, string> = {
  map: 'Your board. Pick a tool from the palette (keys 1-5, S, P), then tap or click a cell. Survey adds rings of cells to build on.',
  constellations: 'Named tile patterns on the board. Complete one to earn Ink and see gold lines. Each unique shape counts once per run.',
  drift: 'Drift ends the current run and turns its Ink into Charts. Charts buy permanent upgrades. Only pinned tiles survive.',
  charts: 'Charts buy permanent upgrades. Each upgrade has levels, and the button shows the cost of the next one.',
  proj: 'Projection is the next step after Drift. It spends this cycle\'s Charts on Curvature, moves you to the hyperbolic board, and resets the run.',
  miles: 'Milestones unlock as you Drift and Project. Each one changes how the game plays, so check here when a new feature appears.',
  save: 'Sound and music volume, the number format, and your save: export, import or wipe it. Save strings include a checksum, so edits are rejected.',
  guide: 'A short guide to tiles, Survey, Drift and Projection. Open it any time from the Guide button.',
};

export const BUTTON_HELP: Record<
  'menu' | 'guide' | 'survey' | 'recenter' | 'drift' | 'project' | 'buyChart' | 'buyCurv' | 'autoDrift' |
  'copy' | 'download' | 'import' | 'notation' | 'reset' | 'place' | 'cancel' |
  'tutNext' | 'tutBack' | 'tutHide' | 'tutRestart' | 'check' | 'overwrite' | 'confirmReset' | 'close' | 'sound',
  string
> = {
  menu: 'Open or close the side panel with the Drift, Charts, Projection and Settings tabs.',
  guide: 'Open the guide. It explains tiles, Survey, Drift and Projection.',
  survey: 'Add the next ring of cells to the board. Costs Ink, and each ring costs more.',
  recenter: 'Reset the camera to the start view, centred on the board.',
  drift: 'End this run and turn its Ink into Charts. Pinned tiles stay; the rest of the board is cleared.',
  project: 'Spend this cycle\'s Charts on Curvature, move to the hyperbolic board, and reset the run.',
  buyChart: 'Spend Charts to raise this upgrade by one level.',
  buyCurv: 'Spend Curvature to raise this upgrade by one level.',
  autoDrift: 'Drift automatically once run Charts reach the number you set.',
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
