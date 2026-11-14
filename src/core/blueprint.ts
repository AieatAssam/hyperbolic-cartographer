import type { GameState } from './state';
import type { TileType } from './tiles';
import { isActive, place, tileCost } from './economy';
import { has } from './milestones';

/** Saves the current layout as this geometry's blueprint. Returns tiles saved; an empty board saves nothing. */
export function saveBlueprint(s: GameState): number {
  const n = s.tiles.filter((t) => t !== null).length;
  if (n === 0) return 0;
  s.blueprints[s.geometry] = s.tiles.slice();
  return n;
}

export function clearBlueprint(s: GameState): void {
  s.blueprints[s.geometry] = null;
}

export function blueprintProgress(s: GameState): { total: number; placed: number } {
  const bp = s.blueprints[s.geometry];
  if (!bp) return { total: 0, placed: 0 };
  let total = 0, placed = 0;
  bp.forEach((t, i) => {
    if (t === null) return;
    total++;
    if (s.tiles[i] === t) placed++;
  });
  return { total, placed };
}

/** Places at most one blueprint tile: the cheapest affordable type, lowest index on ties. Never replaces tiles. */
export function blueprintStep(s: GameState): number | null {
  const bp = s.blueprints[s.geometry];
  if (!bp) return null;
  let pick = -1;
  let pickType: TileType | null = null;
  let pickCost = null as ReturnType<typeof tileCost> | null;
  const costs = new Map<TileType, ReturnType<typeof tileCost>>();
  for (let i = 0; i < bp.length; i++) {
    const t = bp[i];
    if (t === null || s.tiles[i] || !isActive(s, i)) continue;
    let cost = costs.get(t); // tileCost counts the board, so price each type once
    if (!cost) costs.set(t, (cost = tileCost(s, t)));
    if (pickCost === null || cost.lt(pickCost)) {
      pick = i;
      pickType = t;
      pickCost = cost;
    }
  }
  if (pickType === null || pickCost === null || s.ink.lt(pickCost)) return null;
  return place(s, pick, pickType) ? pick : null;
}

/** True when a live blueprint wants cell i for a non-Spring tile, so auto-Springs should leave it alone. */
export function blueprintReserves(s: GameState, i: number): boolean {
  if (!s.autoBuild || !has(s, 'blueprint')) return false;
  const bp = s.blueprints[s.geometry];
  return !!bp && bp[i] !== null && bp[i] !== 'spring';
}
