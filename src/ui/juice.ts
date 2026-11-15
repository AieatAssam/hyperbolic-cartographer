/**
 * Juice: cosmetic DOM feedback layered over the board (gain numbers, build streak, milestone banners,
 * goal completion, affordability shimmer). Reads state and never writes it. Every effect is short,
 * pooled or removed by timer, pointer-transparent, and reduced to a fade under prefers-reduced-motion.
 */
import { config } from '../core/config';
import { owned, hasBoostedMill } from '../core/economy';
import { canDrift } from '../core/prestige';
import type { GameState } from '../core/state';
import { icon, type IconName } from './icons';
import { fmt } from './format';

// ---- Pure helpers (unit-tested in tests/juice.test.ts) ----

export const STREAK_WINDOW_MS = 4000;
export const STREAK_MIN = 3;
/** Ink/s must rise by this fraction (or start from zero) for the HUD rate to flash. */
export const RATE_FLASH_RISE = 0.1;

/** Placements inside the streak window ending at `now`. */
export function streakCount(stamps: readonly number[], now: number, windowMs = STREAK_WINDOW_MS): number {
  let n = 0;
  for (const t of stamps) if (now - t <= windowMs && t <= now) n++;
  return n;
}

export function rateFlashed(prev: number, next: number): boolean {
  if (!(next > 0)) return false;
  return prev <= 0 ? true : next > prev * (1 + RATE_FLASH_RISE);
}

export type MilestoneId = 'linked' | 'survey' | 'beacon' | 'drift';

/** The facts milestones are detected from; a flip from false to true is the moment. */
export interface MilestoneFacts {
  linked: boolean; // a Mill touches a Spring
  survey: boolean; // square board has been surveyed past its start ring
  beacon: boolean; // at least one Beacon placed
  drift: boolean; // Drift is available (or already taken)
}

export function milestoneFacts(s: GameState): MilestoneFacts {
  return {
    linked: hasBoostedMill(s),
    survey: s.geometry === 'square' && s.ring > config.square.startRing,
    beacon: owned(s, 'beacon') > 0,
    drift: s.drifts > 0 || canDrift(s),
  };
}

/** Milestones that just became true. Empty on the first call (`prev` null): an old save shows nothing. */
export function milestoneEvents(prev: MilestoneFacts | null, next: MilestoneFacts): MilestoneId[] {
  if (!prev) return [];
  const out: MilestoneId[] = [];
  (['linked', 'survey', 'beacon', 'drift'] as const).forEach((id) => {
    if (!prev[id] && next[id]) out.push(id);
  });
  return out;
}

export const MILESTONE_COPY: Record<MilestoneId, { title: string; body: string; icon: IconName }> = {
  linked: { title: 'First Mill linked', body: 'Mills turn nearby Springs into much more Ink.', icon: 'mill' },
  survey: { title: 'First Survey', body: 'Surveys add rings of cells, so there is more map to fill.', icon: 'star' },
  beacon: { title: 'First Beacon', body: 'Beacons multiply the tiles next to them.', icon: 'beacon' },
  drift: { title: 'Drift is open', body: 'Drift ends this run and turns its Ink into Charts that last.', icon: 'charts' },
};

// ---- DOM layer (created lazily; nothing runs at import) ----

const MAX_LIVE = 12;
const FLOAT_MS = 1300;
const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reduced = () => !!reduce?.matches;

let layer: HTMLElement | null = null;
const getLayer = (): HTMLElement => {
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'juice-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
  }
  return layer;
};

/** Where taps happened last, so gain numbers float from the finger or cursor. */
let lastPoint = { x: 0, y: 0 };
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => (lastPoint = { x: e.clientX, y: e.clientY }), { capture: true, passive: true });
}

/** Elements the caller asked us to read positions from; set once by the UI. */
const anchors: { ink?: HTMLElement; palette?: HTMLElement; topbar?: HTMLElement } = {};
export function setJuiceAnchors(a: typeof anchors): void {
  Object.assign(anchors, a);
}

const free: HTMLElement[] = [];
const live: { el: HTMLElement; timer: number }[] = [];

function retire(entry: { el: HTMLElement; timer: number }): void {
  clearTimeout(entry.timer);
  entry.el.remove();
  const i = live.indexOf(entry);
  if (i >= 0) live.splice(i, 1);
  if (free.length < MAX_LIVE) free.push(entry.el);
}

function take(cls: string): HTMLElement {
  const el = free.pop() ?? document.createElement('div');
  el.className = cls;
  el.style.cssText = '';
  return el;
}

/**
 * Floating number from (x, y). `toInk` flies it to the Ink counter instead. At most MAX_LIVE are alive:
 * the oldest is retired early. Elements come from a small free list and are removed by timer.
 */
export function floatText(text: string, x: number, y: number, opts: { toInk?: boolean; tone?: 'gain' | 'lump' } = {}): void {
  if (typeof document === 'undefined') return;
  while (live.length >= MAX_LIVE) retire(live[0]);
  const el = take(`juice-float ${opts.tone ?? 'gain'}`);
  el.textContent = text;
  const W = innerWidth, H = innerHeight;
  const cx = Math.min(W - 40, Math.max(40, x));
  const cy = Math.min(H - 40, Math.max(40, y));
  el.style.left = `${cx}px`;
  el.style.top = `${cy}px`;
  if (opts.toInk && anchors.ink) {
    const r = anchors.ink.getBoundingClientRect();
    el.style.setProperty('--dx', `${r.left + r.width / 2 - cx}px`);
    el.style.setProperty('--dy', `${r.top + r.height / 2 - cy}px`);
    el.classList.add('to-ink');
  }
  getLayer().append(el);
  // restart the CSS animation even when the element is recycled
  void el.offsetWidth;
  el.classList.add('on');
  const entry = { el, timer: 0 };
  entry.timer = window.setTimeout(() => retire(entry), reduced() ? 900 : FLOAT_MS);
  live.push(entry);
}

/** Gain number from the last tap or cursor position, "+12.4/s" style. */
export function floatGain(delta: number, s: Pick<GameState, 'notation'>): void {
  if (!(delta > 0)) return;
  floatText(`+${fmt(delta, s.notation)}/s`, lastPoint.x, lastPoint.y - 18);
}

/** Lump payout: a number that flies to the Ink counter, and the counter pulses when it lands. */
export function floatLump(text: string): void {
  const r = anchors.ink?.getBoundingClientRect();
  floatText(text, lastPoint.x || (r ? r.left : 0), lastPoint.y || (r ? r.top : 0), { toInk: true, tone: 'lump' });
  if (!anchors.ink || reduced()) return;
  const b = anchors.ink;
  setTimeout(() => {
    b.classList.remove('ink-lump');
    void b.offsetWidth;
    b.classList.add('ink-lump');
  }, FLOAT_MS - 250);
  setTimeout(() => b.classList.remove('ink-lump'), FLOAT_MS + 400);
}

// ---- Build streak ----

const stamps: number[] = [];
let streakEl: HTMLElement | null = null;
let streakTimer = 0;

/** Records one successful placement; shows the chip from the third placement inside the window. */
export function notePlacement(now = performance.now()): void {
  stamps.push(now);
  while (stamps.length && now - stamps[0] > STREAK_WINDOW_MS) stamps.shift();
  const n = streakCount(stamps, now);
  if (n < STREAK_MIN || typeof document === 'undefined') return;
  if (!streakEl) {
    streakEl = document.createElement('div');
    streakEl.className = 'juice-streak';
    streakEl.setAttribute('aria-hidden', 'true');
    getLayer().append(streakEl);
  }
  const p = anchors.palette?.getBoundingClientRect();
  if (p) {
    streakEl.style.left = `${Math.round(p.right - 12)}px`;
    streakEl.style.top = `${Math.round(p.top - 6)}px`;
  }
  streakEl.textContent = `x${n} build streak`;
  streakEl.style.setProperty('--grow', String(Math.min(1.3, 1 + (n - STREAK_MIN) * 0.06)));
  streakEl.classList.remove('on');
  void streakEl.offsetWidth;
  streakEl.classList.add('on');
  clearTimeout(streakTimer);
  streakTimer = window.setTimeout(() => streakEl?.classList.remove('on'), 1800);
  if (stamps.length > 40) stamps.splice(0, stamps.length - 40);
}

// ---- Goal completion ----

/** Check mark draws at the goal line, the bar sparks, and the goal row re-enters (CSS: .goal-in). */
export function goalCompleted(goalEl: HTMLElement, barEl: HTMLElement): void {
  if (typeof document === 'undefined') return;
  goalEl.classList.remove('goal-in');
  void goalEl.offsetWidth;
  goalEl.classList.add('goal-in');
  if (reduced()) return;
  const g = goalEl.getBoundingClientRect();
  const b = barEl.getBoundingClientRect();
  const check = take('juice-check');
  check.style.left = `${Math.round(g.left - 4)}px`;
  check.style.top = `${Math.round(g.top + g.height / 2 - 12)}px`;
  check.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  getLayer().append(check);
  void check.offsetWidth;
  check.classList.add('on');
  window.setTimeout(() => check.remove(), 900);
  // Sparks are short-lived one-offs (not pooled): each removes itself on a timer.
  const sparkX = Math.round(b.right);
  const sparkY = Math.round(b.top + b.height / 2);
  for (let k = 0; k < 6; k++) {
    const sp = document.createElement('div');
    sp.className = 'juice-spark';
    const a = (k / 6) * Math.PI * 2;
    sp.style.left = `${sparkX}px`;
    sp.style.top = `${sparkY}px`;
    sp.style.setProperty('--sx', `${Math.round(Math.cos(a) * 26)}px`);
    sp.style.setProperty('--sy', `${Math.round(Math.sin(a) * 18 - 8)}px`);
    getLayer().append(sp);
    void sp.offsetWidth;
    sp.classList.add('on');
    window.setTimeout(() => sp.remove(), 700);
  }
}

// ---- Affordability shimmer (one time per control per session) ----

const shimmered = new Set<string>();
/** Gives `el` one gentle gold shimmer the first time `key` becomes affordable. */
export function shimmerOnce(key: string, el: HTMLElement | null, newlyAffordable: boolean): void {
  if (!el || !newlyAffordable || shimmered.has(key)) return;
  shimmered.add(key);
  if (reduced()) return;
  el.classList.remove('shimmer');
  void el.offsetWidth;
  el.classList.add('shimmer');
  el.addEventListener('animationend', () => el.classList.remove('shimmer'), { once: true });
}

// ---- Milestone banners ----

const seenMilestones = new Set<MilestoneId>();
const milestoneQueue: MilestoneId[] = [];
let milestoneEl: HTMLElement | null = null;
let milestoneBusyUntil = 0; // performance.now() when the banner has fully left

function showMilestone(id: MilestoneId, now: number): void {
  if (typeof document === 'undefined') return;
  const c = MILESTONE_COPY[id];
  if (!milestoneEl) {
    milestoneEl = document.createElement('div');
    milestoneEl.className = 'juice-milestone';
    milestoneEl.setAttribute('role', 'status');
    getLayer().append(milestoneEl);
  }
  const top = anchors.topbar ? Math.round(anchors.topbar.getBoundingClientRect().bottom + 10) : 164;
  milestoneEl.style.top = `${top}px`;
  milestoneEl.dataset.id = id;
  const text = Object.assign(document.createElement('span'), { className: 'juice-milestone-text' });
  text.append(Object.assign(document.createElement('strong'), { textContent: c.title }), document.createTextNode(` ${c.body}`));
  milestoneEl.replaceChildren(icon(c.icon, 18), text);
  milestoneEl.classList.remove('on');
  void milestoneEl.offsetWidth;
  milestoneEl.classList.add('on');
  milestoneBusyUntil = now + 4900;
  window.setTimeout(() => milestoneEl?.classList.remove('on'), 4200);
}

/**
 * Queues milestones that just happened and shows them one at a time. Called every UI update; a banner
 * starts only while `canShow` (the tutorial card is hidden), so it never stacks on the card.
 */
export function announceMilestones(events: MilestoneId[], canShow: boolean, now = performance.now()): void {
  for (const id of events) if (!seenMilestones.has(id)) { seenMilestones.add(id); milestoneQueue.push(id); }
  if (canShow && milestoneQueue.length && now >= milestoneBusyUntil) showMilestone(milestoneQueue.shift()!, now);
}
