/**
 * Reward moments: a pointer-events:none layer over the game. One celebration plays at a time from a small queue;
 * extra arrivals beyond the cap are summarised as "+N more" on the one on screen. Everything is removed when done.
 * Motion is CSS (celebrate block in style.css); reduced motion gets a plain 1.5 s fade. Nothing here touches the
 * document until a celebrate* function is called.
 */
import type { ConstellationId } from '../core/constellations';
import { constellationFigure } from './constellation-art';

const MAX_PENDING = 3;
const GAP_MS = 250;

type Build = (wrap: HTMLElement, reduced: boolean) => number;

let layer: HTMLElement | null = null;
const pending: Build[] = [];
let busy = false;
let dropped = 0;
let moreEl: HTMLElement | null = null;
let timer = 0;
let current: HTMLElement | null = null;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function getLayer(): HTMLElement {
  if (!layer) {
    layer = make('div', 'cel-layer');
    layer.setAttribute('aria-live', 'polite');
    document.body.append(layer);
  }
  return layer;
}

function enqueue(build: Build): void {
  if (busy) {
    if (pending.length >= MAX_PENDING) {
      dropped++;
      if (moreEl) {
        moreEl.textContent = `+${dropped} more`;
        moreEl.hidden = false;
      }
      return;
    }
    pending.push(build);
    return;
  }
  start(build);
}

function start(build: Build): void {
  busy = true;
  const wrap = make('div', 'cel');
  const more = make('div', 'cel-more');
  more.hidden = true;
  const ms = build(wrap, reducedMotion());
  wrap.append(more);
  moreEl = more;
  getLayer().append(wrap);
  current = wrap;
  timer = window.setTimeout(finish, ms);
}

function finish(): void {
  current?.remove();
  current = null;
  moreEl = null;
  dropped = 0;
  const next = pending.shift();
  if (!next) {
    busy = false;
    return;
  }
  timer = window.setTimeout(() => start(next), GAP_MS);
}

/** Removes whatever is showing and empties the queue (QA and page teardown). */
export function cancelCelebrations(): void {
  clearTimeout(timer);
  pending.length = 0;
  current?.remove();
  current = null;
  moreEl = null;
  dropped = 0;
  busy = false;
}

/** Where the stage flies to: the Menu button (Stars tab lives in the menu). Falls back to the top-right corner. */
function flyTarget(): { x: number; y: number } {
  const r = document.querySelector('.panel-toggle')?.getBoundingClientRect();
  if (r && r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  return { x: innerWidth - 32, y: 28 };
}

/** Figure edge in CSS px: fits both the phone portrait and the short landscape phone. */
const figSize = () => Math.round(Math.max(96, Math.min(innerWidth * 0.62, innerHeight * (innerWidth > 700 ? 0.38 : 0.28), 340)));

/** Sky dims under the stage; it fades back out over the whole run. */
function veil(wrap: HTMLElement, ms: number): void {
  const v = make('div', 'cel-veil');
  v.animate([{ opacity: 0 }, { opacity: 1, offset: 0.14 }, { opacity: 1, offset: 0.82 }, { opacity: 0 }], {
    duration: ms,
    fill: 'forwards',
  });
  wrap.append(v);
}

// ---- Constellation ----

export interface ConstellationCelebration { id: ConstellationId; name: string; bonusText: string }

const SPARKS: [number, number][] = [[6, 14], [92, 10], [96, 58], [4, 66], [84, 92], [22, 6]];

export function celebrateConstellation({ id, name, bonusText }: ConstellationCelebration): void {
  enqueue((wrap, reduced) => {
    if (reduced) {
      const stage = make('div', 'cel-stage cel-still');
      const fig = constellationFigure(id, figSize());
      stage.append(fig, make('div', 'cel-kicker', 'Constellation formed'), make('div', 'cel-name', name), make('div', 'cel-bonus', bonusText));
      wrap.append(stage);
      return 1500;
    }
    const total = 4200;
    veil(wrap, total);
    const stage = make('div', 'cel-stage cel-constellation');
    const size = figSize();
    const fw = make('div', 'cel-fig-wrap');
    fw.style.setProperty('--fig', `${size}px`);
    fw.append(make('div', 'cel-glow'));
    fw.append(constellationFigure(id, size, { animate: true }));
    SPARKS.forEach(([x, y], i) => {
      const s = make('span', 'cel-spark');
      s.style.left = `${x}%`;
      s.style.top = `${y}%`;
      s.style.setProperty('--d', `${1.0 + i * 0.18}s`);
      fw.append(s);
    });
    stage.append(fw, make('div', 'cel-kicker', 'Constellation formed'), make('div', 'cel-name', name), make('div', 'cel-bonus', bonusText));
    wrap.append(stage);
    const t = flyTarget();
    const dx = t.x - innerWidth / 2;
    const dy = t.y - innerHeight * 0.46;
    stage.animate(
      [
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.14)`, opacity: 0 },
      ],
      { delay: 3500, duration: 700, easing: 'cubic-bezier(.55,0,.8,.4)', fill: 'forwards' },
    );
    return total;
  });
}

// ---- Drift and Projection (banners) ----

/** Compass-rose flourish: an eight-point star with a ring, drawn in brass. */
function roseSvg(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-50 -50 100 100');
  svg.setAttribute('class', 'cel-rose');
  svg.setAttribute('aria-hidden', 'true');
  const ring = document.createElementNS(NS, 'circle');
  ring.setAttribute('r', '44');
  ring.setAttribute('class', 'cel-rose-ring');
  const star = document.createElementNS(NS, 'path');
  star.setAttribute('d', 'M0-46L9-9 46 0 9 9 0 46-9 9-46 0-9-9Z');
  star.setAttribute('class', 'cel-rose-star');
  const inner = document.createElementNS(NS, 'path');
  inner.setAttribute('d', 'M0-18L5-5 18 0 5 5 0 18-5 5-18 0-5-5Z');
  inner.setAttribute('class', 'cel-rose-inner');
  svg.append(ring, star, inner);
  return svg;
}

/** Count a number up in place. Stops when the element leaves the DOM. */
function countUp(el: HTMLElement, to: number, ms: number): void {
  const t0 = performance.now();
  const step = (now: number) => {
    if (!el.isConnected) return;
    const k = Math.min(1, (now - t0) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(to * eased).toLocaleString('en-US');
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function celebrateDrift({ charts }: { charts: number }): void {
  enqueue((wrap, reduced) => {
    const stage = make('div', reduced ? 'cel-stage cel-still' : 'cel-stage cel-banner');
    const count = make('div', 'cel-bonus', reduced ? Math.round(charts).toLocaleString('en-US') : '0');
    if (!reduced) {
      stage.append(roseSvg());
    }
    stage.append(make('div', 'cel-kicker', 'Drifted'), make('div', 'cel-name', 'The old map washes away'), count, make('div', 'cel-sub', 'Charts'));
    wrap.append(stage);
    if (!reduced) countUp(count, Math.round(charts), 1400);
    return reduced ? 1500 : 2600;
  });
}

export interface ProjectionCelebration { curvature: string; name: string }

export function celebrateProjection({ curvature, name }: ProjectionCelebration): void {
  enqueue((wrap, reduced) => {
    const stage = make('div', reduced ? 'cel-stage cel-still' : 'cel-stage cel-banner');
    if (!reduced) {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '-50 -50 100 100');
      svg.setAttribute('class', 'cel-disk');
      svg.setAttribute('aria-hidden', 'true');
      for (const r of [44, 30, 16]) {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('r', String(r));
        c.setAttribute('class', 'cel-disk-ring');
        c.style.setProperty('--i', String(r === 44 ? 0 : r === 30 ? 1 : 2));
        svg.append(c);
      }
      const arc = document.createElementNS(NS, 'path');
      arc.setAttribute('d', 'M-40 26C-18 -6 18 -6 40 26');
      arc.setAttribute('pathLength', '1');
      arc.setAttribute('class', 'cel-disk-arc');
      svg.append(arc);
      stage.append(svg);
    }
    stage.append(make('div', 'cel-kicker', 'Projected'), make('div', 'cel-name', name), make('div', 'cel-bonus', `+${curvature} Curvature`));
    wrap.append(stage);
    return reduced ? 1500 : 2600;
  });
}

// ---- Achievement medal and generic big banner ----

export function celebrateAchievement({ name, bonusText }: { name: string; bonusText?: string }): void {
  enqueue((wrap, reduced) => {
    const NS = 'http://www.w3.org/2000/svg';
    const medal = make('div', reduced ? 'cel-medal cel-still' : 'cel-medal');
    const disc = document.createElementNS(NS, 'svg');
    disc.setAttribute('viewBox', '0 0 40 40');
    disc.setAttribute('class', 'cel-medal-disc');
    disc.setAttribute('aria-hidden', 'true');
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('cx', '20');
    ring.setAttribute('cy', '20');
    ring.setAttribute('r', '18');
    const star = document.createElementNS(NS, 'path');
    star.setAttribute('d', 'M20 7l3.6 7.4 8.1 1.2-5.9 5.7 1.4 8.1L20 25.6l-7.2 3.8 1.4-8.1-5.9-5.7 8.1-1.2Z');
    disc.append(ring, star);
    const text = make('div', 'cel-medal-text');
    text.append(make('div', 'cel-kicker', 'Achievement'), make('div', 'cel-medal-name', name));
    if (bonusText) text.append(make('div', 'cel-sub', bonusText));
    medal.append(disc, text);
    wrap.append(medal);
    return reduced ? 1500 : 2400;
  });
}

/** Generic reward banner for other callers (e.g. "Loop closed"). */
export function celebrateBig({ title, subtitle }: { title: string; subtitle?: string }): void {
  enqueue((wrap, reduced) => {
    const stage = make('div', reduced ? 'cel-stage cel-still' : 'cel-stage cel-banner');
    stage.append(make('div', 'cel-name', title));
    if (subtitle) stage.append(make('div', 'cel-bonus', subtitle));
    wrap.append(stage);
    return reduced ? 1500 : 2600;
  });
}
