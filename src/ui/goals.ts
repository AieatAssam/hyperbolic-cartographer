import { config } from '../core/config';
import { canProject } from '../core/prestige';
import { adjacency, isActive, maxRing, mods, owned, prod, surveyCost } from '../core/economy';
import { pickImmediateGoal } from '../core/goal-policy';
import { graphOf, type GameState } from '../core/state';
import { fmt } from './format';

/** Semantic glyph for the compact HUD chip; the UI maps each one to a small symbol shown when the chip is too narrow for `short`. */
export const GOAL_ICONS = ['spring', 'mill', 'survey', 'boost', 'drift', 'project'] as const;
export type GoalIcon = (typeof GOAL_ICONS)[number];

export interface Goal {
  text: string;
  short: string; // compact HUD chip label, at most 7 characters: a fixed name built alongside text, never cut from it
  icon: GoalIcon; // explicit per branch, never parsed from text
  progress: number; // 0..1, clamped and finite
  eta: string; // '' or 'ready' or '~2m 10s'
}

const rate = (s: GameState) => {
  const r = prod(s).total;
  return Number.isFinite(r) ? r : 0;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pickIcon = (icon: string): GoalIcon => {
  if (icon === 'chart' || icon === 'curv') return 'survey';
  return GOAL_ICONS.includes(icon as GoalIcon) ? (icon as GoalIcon) : 'spring';
};

/** Next unlock label and its progress (0..1). Moved verbatim from ui.ts nextGoal. */
export function longGoal(s: GameState): [string, number] {
  const dMin = Math.log10(config.drift.minInk);
  if (s.drifts === 0) return [`Drift at ${fmt(config.drift.minInk)} Ink this run`, s.runInk.add(1).log10().toNumber() / dMin];
  if (s.projections === 0 && !canProject(s))
    return [`Projection at ${config.projection.minCharts} Charts`, s.cycleCharts.toNumber() / config.projection.minCharts];
  if (s.projections === 0) return ['Projection ready!', 1];
  if (s.ring < maxRing(s)) return [`Survey ring ${s.ring + 1}`, s.ink.div(surveyCost(s)).toNumber()];
  let active = 0, filled = 0;
  s.tiles.forEach((t, i) => {
    if (isActive(s, i)) {
      active++;
      if (t) filled++;
    }
  });
  return ['Horizon reached: fill every cell', active ? filled / active : 0];
}

/** The single next concrete action; rules live in `core/goal-policy.ts`. */
export function immediateGoal(s: GameState): Goal {
  const pick = pickImmediateGoal(s, { fmt });
  return {
    text: pick.text,
    short: pick.short,
    icon: pickIcon(pick.icon),
    progress: pick.progress,
    eta: pick.eta,
  };
}

const MAX_EXPLAIN = 140;

/** Live one-line "what is happening" summary, at most 140 characters. */
export function explainNow(s: GameState): string {
  if (s.tiles.every((t) => t === null)) return 'Nothing is producing yet. Ink only grows from tiles.';

  const g = graphOf(s);
  const reach = mods(s).reach;
  const boosted = s.tiles.filter(
    (t, i) => t === 'mill' && adjacency(g, s.tiles, i, reach).some((n) => s.tiles[n] === 'spring'),
  ).length;
  const count = (t: string) => s.tiles.filter((x) => x === t).length;

  let text = `${plural(owned(s, 'spring'), 'Spring')} and ${plural(owned(s, 'mill'), 'Mill')} make ${fmt(rate(s), s.notation)} Ink/s`;
  if (boosted > 0) text += `; ${boosted === 1 ? '1 Mill' : `${boosted} Mills`} boosted by adjacent Springs`;
  const extras = [
    count('beacon') > 0 && plural(count('beacon'), 'Beacon'),
    count('bridge') > 0 && plural(count('bridge'), 'Bridge'),
    count('vault') > 0 && plural(count('vault'), 'Vault'),
  ].filter(Boolean);
  if (extras.length) text += `; also ${extras.join(', ')}`;
  text += '.';
  if (s.drifts === 0) text += ` Run Ink ${fmt(s.runInk, s.notation)} of ${fmt(config.drift.minInk, s.notation)} for Drift.`;

  if (text.length > MAX_EXPLAIN) {
    const cut = text.slice(0, MAX_EXPLAIN - 3);
    const at = cut.lastIndexOf(' ');
    text = `${at > 0 ? cut.slice(0, at) : cut}...`;
  }
  return text;
}
