/**
 * Hand-placed star figures for the eight constellations: a 0..100 box, a magnitude per star (1 faint, 3 bright)
 * and the lines joining them. Pure data plus one DOM builder: nothing touches `document` until
 * constellationFigure() is called, so this module imports fine in Node tests.
 */
import type { ConstellationId } from '../core/constellations';

export interface FigureStar { x: number; y: number; m: 1 | 2 | 3 }
export interface StarFigure { stars: FigureStar[]; lines: [number, number][] }

/** Each figure suggests its name: a stream, a wheel, twin towers, a lily garden, a crown, a book, a bridge, a harbour. */
export const CONSTELLATION_FIGURES: Record<ConstellationId, StarFigure> = {
  // A meandering stream of six springs falling across the sky.
  inkstream: {
    stars: [
      { x: 8, y: 70, m: 2 }, { x: 26, y: 54, m: 1 }, { x: 42, y: 64, m: 1 },
      { x: 58, y: 42, m: 2 }, { x: 74, y: 50, m: 1 }, { x: 92, y: 24, m: 3 },
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]],
  },
  // A hub with a rim of six: spokes to the rim and the rim itself closed into a wheel.
  millwheel: {
    stars: [
      { x: 50, y: 50, m: 3 },
      { x: 50, y: 20, m: 1 }, { x: 76, y: 35, m: 2 }, { x: 76, y: 65, m: 1 },
      { x: 50, y: 80, m: 2 }, { x: 24, y: 65, m: 1 }, { x: 24, y: 35, m: 2 },
    ],
    lines: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 1]],
  },
  // Two towers with a bridge arching between their tops and a deck below.
  twinmills: {
    stars: [
      { x: 18, y: 80, m: 1 }, { x: 18, y: 30, m: 2 }, { x: 82, y: 80, m: 1 }, { x: 82, y: 30, m: 2 },
      { x: 50, y: 42, m: 1 }, { x: 34, y: 62, m: 1 }, { x: 66, y: 62, m: 1 },
    ],
    lines: [[0, 1], [2, 3], [1, 4], [4, 3], [0, 5], [5, 6], [6, 2], [5, 4], [6, 4]],
  },
  // A bright cistern at the heart, petals opening around it and a stem reaching down.
  watergarden: {
    stars: [
      { x: 50, y: 46, m: 3 },
      { x: 32, y: 30, m: 1 }, { x: 68, y: 30, m: 1 }, { x: 22, y: 50, m: 2 }, { x: 78, y: 50, m: 2 },
      { x: 50, y: 22, m: 1 }, { x: 50, y: 88, m: 1 },
    ],
    lines: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 5], [5, 2], [3, 1], [4, 2], [0, 6]],
  },
  // Five crown points on a shallow arc, a gem hung beneath the middle, and a straight base.
  crown: {
    stars: [
      { x: 12, y: 66, m: 1 }, { x: 28, y: 36, m: 2 }, { x: 50, y: 22, m: 3 }, { x: 72, y: 36, m: 2 }, { x: 88, y: 66, m: 1 },
      { x: 50, y: 80, m: 2 },
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [0, 4], [1, 5], [3, 5], [0, 5], [4, 5]],
  },
  // An open book: a spine running top to bottom with two pages either side.
  library: {
    stars: [
      { x: 50, y: 26, m: 2 }, { x: 28, y: 18, m: 1 }, { x: 10, y: 30, m: 1 }, { x: 10, y: 68, m: 1 },
      { x: 50, y: 84, m: 2 }, { x: 72, y: 18, m: 1 }, { x: 90, y: 30, m: 1 }, { x: 90, y: 68, m: 1 },
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 4], [0, 4]],
  },
  // An arch of stars over a deck, with hangers dropping from the arch to the deck.
  longspan: {
    stars: [
      { x: 8, y: 60, m: 1 }, { x: 26, y: 38, m: 2 }, { x: 50, y: 28, m: 3 }, { x: 74, y: 38, m: 2 }, { x: 92, y: 60, m: 1 },
      { x: 26, y: 66, m: 1 }, { x: 74, y: 66, m: 1 },
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 4], [1, 5], [3, 6]],
  },
  // A lighthouse with its lamp and rays above, a quay of waves below.
  harbour: {
    stars: [
      { x: 50, y: 26, m: 3 }, { x: 42, y: 78, m: 1 }, { x: 58, y: 78, m: 1 },
      { x: 30, y: 14, m: 1 }, { x: 70, y: 14, m: 1 },
      { x: 12, y: 88, m: 2 }, { x: 88, y: 88, m: 2 },
    ],
    lines: [[0, 3], [0, 4], [0, 1], [0, 2], [1, 2], [1, 5], [2, 6], [5, 6]],
  },
};

const NS = 'http://www.w3.org/2000/svg';
const RADIUS: Record<1 | 2 | 3, number> = { 1: 1.5, 2: 2.1, 3: 2.9 };

export interface FigureOptions {
  /** Plays the CSS draw-in: stars pop, then lines draw from star to star (celebrate block in style.css). */
  animate?: boolean;
  /** Undiscovered look: faint figure with every star drawn as a "?". */
  dim?: boolean;
}

/** Builds the SVG for a constellation, `size` CSS px square. Returns a detached element; the caller places it. */
export function constellationFigure(id: ConstellationId, size: number, opts: FigureOptions = {}): SVGSVGElement {
  const fig = CONSTELLATION_FIGURES[id];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-4 -4 108 108');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `cf cf-${id}${opts.animate ? ' cf-animate' : ''}${opts.dim ? ' cf-dim' : ''}`);

  fig.lines.forEach(([a, b]) => {
    const A = fig.stars[a], B = fig.stars[b];
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', `M${A.x} ${A.y}L${B.x} ${B.y}`);
    p.setAttribute('pathLength', '1');
    p.setAttribute('class', 'cf-line');
    // Draw order: a line starts just after the later of its two stars has popped in (same clock as the stars' --i).
    p.style.setProperty('--k', String(Math.max(a, b) + 0.8));
    svg.append(p);
  });

  fig.stars.forEach((s, i) => {
    if (opts.dim) {
      const q = document.createElementNS(NS, 'text');
      q.setAttribute('x', String(s.x));
      q.setAttribute('y', String(s.y));
      q.setAttribute('text-anchor', 'middle');
      q.setAttribute('dominant-baseline', 'central');
      q.setAttribute('class', 'cf-q');
      q.style.setProperty('--i', String(i));
      q.textContent = '?';
      svg.append(q);
      return;
    }
    const halo = document.createElementNS(NS, 'circle');
    halo.setAttribute('cx', String(s.x));
    halo.setAttribute('cy', String(s.y));
    halo.setAttribute('r', String(RADIUS[s.m] * 2.6));
    halo.setAttribute('class', 'cf-halo');
    halo.style.setProperty('--i', String(i));
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', String(s.x));
    c.setAttribute('cy', String(s.y));
    c.setAttribute('r', String(RADIUS[s.m]));
    c.setAttribute('class', `cf-star m${s.m}`);
    c.style.setProperty('--i', String(i));
    svg.append(halo, c);
  });
  return svg;
}
