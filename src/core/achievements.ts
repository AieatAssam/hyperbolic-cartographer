import { config } from './config';
import { closedLoopCount } from './economy';
import { GRAPHS, graphOf, type GameState } from './state';
import { TILE_TYPES } from './tiles';

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  req: (s: GameState) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'firstSpring', name: 'First Drop', desc: 'Place a tile.', req: (s) => s.stats.tilesPlaced >= 1 },
  { id: 'hundredTiles', name: 'Steady Hand', desc: 'Place 100 tiles in total.', req: (s) => s.stats.tilesPlaced >= 100 },
  { id: 'thousandTiles', name: 'Master Draughtsman', desc: 'Place 1,000 tiles in total.', req: (s) => s.stats.tilesPlaced >= 1000 },
  { id: 'ink1k', name: 'Inkwell', desc: 'Earn 1,000 Ink in total.', req: (s) => s.lifetimeInk.gte(1e3) },
  { id: 'ink1m', name: 'Ink Barrel', desc: 'Earn 1 million Ink in total.', req: (s) => s.lifetimeInk.gte(1e6) },
  { id: 'ink1b', name: 'Ink Reservoir', desc: 'Earn 1 billion Ink in total.', req: (s) => s.lifetimeInk.gte(1e9) },
  { id: 'ink1t', name: 'Ink Ocean', desc: 'Earn 1 trillion Ink in total.', req: (s) => s.lifetimeInk.gte(1e12) },
  { id: 'rate100', name: 'Trickle', desc: 'Reach 100 Ink/s.', req: (s) => s.stats.bestInkPerSec >= 100 },
  { id: 'rate10k', name: 'Torrent', desc: 'Reach 10,000 Ink/s.', req: (s) => s.stats.bestInkPerSec >= 1e4 },
  { id: 'rate1m', name: 'Deluge', desc: 'Reach 1 million Ink/s.', req: (s) => s.stats.bestInkPerSec >= 1e6 },
  {
    id: 'fullSquare',
    name: 'Edge of the Paper',
    desc: 'Survey every ring of the flat board.',
    req: (s) => s.geometry === 'square' && s.ring >= config.square.maxRing,
  },
  {
    id: 'everyKind',
    name: 'Cabinet of Curiosities',
    desc: 'Have all 8 kinds of tile on the board at once.',
    req: (s) => TILE_TYPES.every((t) => s.tiles.includes(t)),
  },
  { id: 'drift1', name: 'Cast Off', desc: 'Drift once.', req: (s) => s.drifts >= 1 },
  { id: 'drift10', name: 'Seasoned Navigator', desc: 'Drift 10 times.', req: (s) => s.drifts >= 10 },
  { id: 'drift50', name: 'Old Salt', desc: 'Drift 50 times.', req: (s) => s.drifts >= 50 },
  // Earned by noteDrift(), which sees the run time before the Drift resets it.
  { id: 'quickDrift', name: 'Fair Winds', desc: 'Drift within 5 minutes of starting a run.', req: () => false },
  { id: 'project1', name: 'Off the Edge', desc: 'Project onto the hyperbolic plane.', req: (s) => s.projections >= 1 },
  { id: 'project3', name: 'Thrice Folded', desc: 'Project 3 times.', req: (s) => s.projections >= 3 },
  {
    id: 'horizon',
    name: 'The Far Shore',
    desc: 'Survey every ring of the hyperbolic board with Deeper Horizon.',
    req: (s) => s.geometry === 'hyper' && s.ring >= config.hyper.maxRing + 1,
  },
  { id: 'wind1', name: 'Weather Eye', desc: 'Catch a Trade Wind.', req: (s) => s.windsCaught >= 1 },
  { id: 'wind25', name: 'Windcatcher', desc: 'Catch 25 winds.', req: (s) => s.windsCaught >= 25 },
  { id: 'star1', name: 'Stargazer', desc: 'Complete a constellation.', req: (s) => s.stats.constellations >= 1 },
  { id: 'star25', name: 'Astronomer', desc: 'Complete 25 constellations.', req: (s) => s.stats.constellations >= 25 },
  { id: 'pins3', name: 'Well Anchored', desc: 'Have 3 tiles pinned at once.', req: (s) => s.pinned.length >= 3 },
  { id: 'fold1', name: 'Hinged Paper', desc: 'Fold the chart onto a closed surface.', req: (s) => s.folds >= 1 },
  { id: 'mobius', name: 'One-Sided', desc: 'Project onto the Möbius strip.', req: (s) => s.geometry === 'mobius' },
  { id: 'torus', name: 'Round Trip', desc: 'Project onto the torus.', req: (s) => s.geometry === 'torus' },
  { id: 'klein', name: 'Inside Out', desc: 'Project onto the Klein bottle.', req: (s) => s.geometry === 'klein' },
  {
    id: 'loop1',
    name: 'Closed Circuit',
    desc: 'Close a loop of tiles around a closed surface.',
    req: (s) => closedLoopCount(graphOf(s), s.tiles) >= 1,
  },
  {
    id: 'torusBoth',
    name: 'Both Ways Round',
    desc: 'Close both loops of the torus at once.',
    req: (s) => s.geometry === 'torus' && closedLoopCount(GRAPHS.torus, s.tiles) >= 2,
  },
];

/** Adds newly met achievements to s.achievements and returns them. */
export function checkAchievements(s: GameState): Achievement[] {
  const fresh: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (s.achievements.includes(a.id) || !a.req(s)) continue;
    s.achievements.push(a.id);
    fresh.push(a);
  }
  return fresh;
}

/** Called by drift() with the run time from before the reset: earns quickDrift within 5 minutes of run start. */
export function noteDrift(s: GameState, runTimeBeforeDrift: number): Achievement[] {
  if (runTimeBeforeDrift > 300 || s.achievements.includes('quickDrift')) return [];
  s.achievements.push('quickDrift');
  return [ACHIEVEMENTS.find((a) => a.id === 'quickDrift')!];
}

export const achievementBonus = (s: GameState) => 1 + config.achievements.inkPerEach * s.achievements.length;
