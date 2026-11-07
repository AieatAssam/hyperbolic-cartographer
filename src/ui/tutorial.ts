import Decimal from 'break_eternity.js';
import { config } from '../core/config';
import { type GameState } from '../core/state';
import { hasBoostedMill, owned, prod, tileCost } from '../core/economy';
import type { TileType } from '../core/tiles';
import { fmt, fmtTime } from './format';

export const TUTORIAL_KEY = 'hc-tutorial'; // localStorage key (caller does storage)

export interface TutorialState {
  step: number;
  dismissed: boolean;
  done: boolean;
}

export interface TutStep {
  id: 'ink' | 'spring' | 'save' | 'boost' | 'preview';
  title: string;
  body: (s: GameState) => string; // live text, may include numbers
  complete: (s: GameState) => boolean; // goal satisfied
  manual: boolean; // true = shows a Next button (still auto-advances once complete() is true)
  tool?: TileType; // tool to highlight, if any
}

const pct = (x: number) => Math.round(x * 100);
const money = (d: Decimal | number, s: GameState) => fmt(Decimal.isFinite(d) ? d : 0, s.notation);
const rate = (s: GameState) => {
  const r = prod(s).total;
  return Number.isFinite(r) ? r : 0;
};

export const STEPS: TutStep[] = [
  {
    id: 'ink',
    title: 'Ink buys tiles',
    body: (s) =>
      `Ink (shown top-left) is your money. Every tile costs Ink, and each copy costs ${pct(config.costGrowth - 1)}% more. ` +
      `You have ${money(s.ink, s)} Ink now.`,
    complete: (s) => owned(s, 'spring') >= 1,
    manual: true,
  },
  {
    id: 'spring',
    title: 'Place your first Spring',
    body: () =>
      `Spring makes ${config.tiles.spring.out} Ink/s. ` +
      'Pick Spring (key 1) at the bottom. Tap or click a lit cell to preview it, then tap or click again (or press Place) to buy.',
    complete: (s) => owned(s, 'spring') >= 1,
    manual: false,
    tool: 'spring',
  },
  {
    id: 'save',
    title: 'Save up for a Mill',
    body: (s) => {
      const cost = tileCost(s, 'mill');
      const head = `Mill costs ${money(cost, s)} Ink. You have ${money(s.ink, s)}.`;
      if (s.ink.gte(cost)) return `${head} You can afford it now. Put it on a cell touching a Spring.`;
      const r = rate(s);
      if (r <= 0) return `${head} Place more Springs first, then save up.`;
      const wait = cost.sub(s.ink).toNumber() / r;
      return `${head} At ${money(r, s)} Ink/s that's about ${fmtTime(Number.isFinite(wait) ? wait : 0)}. ` +
        'Extra Springs speed this up. Plan to put the Mill on a cell touching a Spring.';
    },
    complete: (s) => owned(s, 'mill') >= 1,
    manual: false,
    tool: 'mill',
  },
  {
    id: 'boost',
    title: 'Adjacency boost',
    body: () =>
      `Mill makes ${config.tiles.mill.out} Ink/s, +${pct(config.tiles.mill.perSpring)}% for each Spring sharing an edge. ` +
      'Only edge neighbours count (up to 4 on the square grid). Get a Mill touching a Spring.',
    complete: (s) => hasBoostedMill(s),
    manual: false,
    tool: 'mill',
  },
  {
    id: 'preview',
    title: 'Read the preview before buying',
    body: () =>
      'Tap or click an empty cell to open its card. It shows the cost and the exact Ink/s change (green +) before you buy. ' +
      'Pick the cell with the biggest +. Next goals live in the top bar; the Guide button reopens this tutorial.',
    complete: () => false,
    manual: true,
  },
];

export function freshTutorial(): TutorialState {
  return { step: 0, dismissed: false, done: false };
}

/** Save already progressed past the tutorial: skip it. Otherwise start at step 0. */
export function initialTutorial(s: GameState): TutorialState {
  if (s.drifts > 0 || s.projections > 0 || hasBoostedMill(s))
    return { step: STEPS.length, dismissed: false, done: true };
  return freshTutorial();
}

/** Tolerant parse: anything invalid falls back to initialTutorial(s). */
export function parseTutorial(raw: string | null, s: GameState): TutorialState {
  if (raw === null) return initialTutorial(s);
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return initialTutorial(s);
  }
  if (typeof v !== 'object' || v === null) return initialTutorial(s);
  const o = v as Record<string, unknown>;
  if (typeof o.step !== 'number' || !Number.isFinite(o.step)) return initialTutorial(s);
  const step = Math.min(STEPS.length, Math.max(0, Math.floor(o.step)));
  return {
    step,
    dismissed: o.dismissed === true,
    done: o.done === true || step >= STEPS.length,
  };
}

export function serializeTutorial(t: TutorialState): string {
  return JSON.stringify({ step: t.step, dismissed: t.dismissed, done: t.done });
}

/**
 * Auto-advance past steps whose goal is met (manual steps too: placing a Spring before pressing Next
 * must not strand the player on "Ink buys tiles"). Returns the same object when nothing changed.
 */
export function syncTutorial(t: TutorialState, s: GameState): TutorialState {
  if (t.done) return t;
  let step = t.step;
  while (step < STEPS.length && STEPS[step].complete(s)) step++;
  const done = step >= STEPS.length;
  if (step === t.step && done === t.done) return t;
  return { ...t, step, done };
}

export function nextStep(t: TutorialState): TutorialState {
  const step = Math.min(STEPS.length, t.step + 1);
  return { ...t, step, done: step >= STEPS.length };
}

export function prevStep(t: TutorialState): TutorialState {
  return { ...t, step: Math.max(0, t.step - 1), done: false };
}

export function dismissTutorial(t: TutorialState): TutorialState {
  return { ...t, dismissed: true };
}

/** Reopen the panel. A finished tutorial restarts from step 0. */
export function reopenTutorial(t: TutorialState): TutorialState {
  if (t.done) return { step: 0, dismissed: false, done: false };
  return { ...t, dismissed: false };
}

export function restartTutorial(): TutorialState {
  return freshTutorial();
}

export { hasBoostedMill };

export function currentStep(t: TutorialState): TutStep | null {
  if (t.done) return null;
  return STEPS[t.step] ?? null;
}
