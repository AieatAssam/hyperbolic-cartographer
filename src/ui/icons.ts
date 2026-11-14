/**
 * Tiny inline-SVG line icon set for the DOM interface. Pure data plus one builder: nothing touches `document`
 * until icon() is called, so this module imports fine in Node tests. 24x24 grid, stroke-only, currentColor.
 */

export type IconName =
  | 'spring' | 'mill' | 'beacon' | 'bridge' | 'vault' | 'lighthouse' | 'cistern' | 'scriptorium'
  | 'ink' | 'charts' | 'curvature'
  | 'star' | 'lock' | 'check' | 'pin' | 'wind';

type Attrs = Record<string, string | number>;
export type IconShape = readonly [tag: 'path' | 'circle' | 'rect' | 'ellipse', attrs: Attrs];

/** Path data per icon: 1-4 shapes each, drawn in a 24x24 box. */
export const ICON_SHAPES: Record<IconName, readonly IconShape[]> = {
  spring: [['path', { d: 'M12 3 6.5 10.5a6 6 0 1 0 11 0Z' }]],
  mill: [
    ['circle', { cx: 12, cy: 12, r: 8 }],
    ['path', { d: 'M12 4v16M5.1 8l13.8 8M5.1 16l13.8-8' }],
    ['circle', { cx: 12, cy: 12, r: 1.4 }],
  ],
  beacon: [['path', { d: 'M12 3c1 3.5 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-6 1-9.5Z' }]],
  bridge: [['path', { d: 'M3 19h18M5 19a7 7 0 0 1 14 0M9 19v-4.2M12 19v-7M15 19v-4.2' }]],
  vault: [
    ['rect', { x: 4.5, y: 10, width: 15, height: 10.5, rx: 2 }],
    ['path', { d: 'M8 10V7.5a4 4 0 0 1 8 0V10M12 14v2.5' }],
  ],
  lighthouse: [
    ['path', { d: 'M9.5 21 10.5 9.5h3L14.5 21M8 21h8' }],
    ['rect', { x: 10, y: 5.5, width: 4, height: 4 }],
    ['path', { d: 'M4.5 5.5l2 2M19.5 5.5l-2 2M2.5 11.5h2.5M19 11.5h2.5' }],
  ],
  cistern: [
    ['ellipse', { cx: 12, cy: 8.5, rx: 8, ry: 2.2 }],
    ['path', { d: 'M4 8.5l1.6 10.2A1.8 1.8 0 0 0 7.4 20h9.2a1.8 1.8 0 0 0 1.8-1.3L20 8.5' }],
  ],
  scriptorium: [['path', { d: 'M12 6.5C10 5 7 4.5 3.5 5.5v13c3.5-1 6.5-.5 8.5 1 2-1.5 5-2 8.5-1v-13c-3.5-1-6.5-.5-8.5 1ZM12 6.5v13.5' }]],
  ink: [
    ['path', { d: 'M10 3h4M10.5 3v4L7 11.5V19a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-7.5L13.5 7V3' }],
    ['path', { d: 'M9.5 15h2.5' }],
  ],
  charts: [['path', { d: 'M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2Z M9 4.5v13M15 6.5v13' }]],
  curvature: [['path', { d: 'M4 17C8 9 16 9 20 17M4 7c4 8 12 8 16 0' }]],
  star: [['path', { d: 'M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.6 1-5.8-4.2-4.1 5.8-.8Z' }]],
  lock: [
    ['rect', { x: 5, y: 10.5, width: 14, height: 10, rx: 2 }],
    ['path', { d: 'M8 10.5V7.5a4 4 0 0 1 8 0v3' }],
  ],
  check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
  pin: [
    ['path', { d: 'M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21Z' }],
    ['circle', { cx: 12, cy: 10.5, r: 2.2 }],
  ],
  wind: [['path', { d: 'M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h6' }]],
};

const NS = 'http://www.w3.org/2000/svg';

/** Builds an icon element from ICON_SHAPES. Decorative only (aria-hidden); size in CSS px. */
export function icon(name: IconName, size = 16): SVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const [tag, attrs] of ICON_SHAPES[name]) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    svg.append(e);
  }
  return svg;
}
