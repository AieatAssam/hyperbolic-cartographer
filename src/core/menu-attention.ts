import { chartUpgrades, curvUpgrades, type ChartUpgradeId, type CurvUpgradeId } from './config';
import { canDrift, canProject } from './prestige';
import type { GameState } from './state';
type MenuTab = 'map' | 'constellations' | 'drift' | 'charts' | 'proj' | 'miles' | 'save' | 'guide';

function affordableChart(s: GameState): ChartUpgradeId | null {
  for (const u of chartUpgrades) {
    const lvl = s.chartUpg[u.id];
    if (lvl >= u.max) continue;
    if (s.charts.gte(u.cost(lvl))) return u.id;
  }
  return null;
}

function affordableCurv(s: GameState): CurvUpgradeId | null {
  for (const u of curvUpgrades) {
    const lvl = s.curvUpg[u.id];
    if (lvl >= u.max) continue;
    if (s.curvature.gte(u.cost(lvl))) return u.id;
  }
  return null;
}

export interface MenuAttention {
  menu: boolean;
  pulse: boolean;
  tabs: Partial<Record<MenuTab, boolean>>;
  keys: string[];
}

/** Which menu tabs deserve a badge (affordable prestige or upgrades). */
export function menuAttention(s: GameState): MenuAttention {
  const tabs: Partial<Record<MenuTab, boolean>> = {};
  const keys: string[] = [];
  if (s.drifts === 0 && canDrift(s)) (tabs.drift = true), keys.push('drift-ready');
  if (s.projections === 0 && canProject(s)) (tabs.proj = true), keys.push('proj-ready');
  const ch = affordableChart(s);
  if (ch) (tabs.charts = true), keys.push(`chart-${ch}`);
  const cu = affordableCurv(s);
  if (cu) (tabs.charts = true), keys.push(`curv-${cu}`);
  return { menu: keys.length > 0, pulse: keys.length > 0, tabs, keys };
}

export function attentionCleared(seen: Set<string>, att: MenuAttention): boolean {
  return att.keys.every((k) => seen.has(k));
}
