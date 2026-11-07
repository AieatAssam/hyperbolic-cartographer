// Layout QA: drives the built app in headless Chromium across phone/tablet/desktop
// viewports and checks overflow, overlap, reachability and per-case expectations.
//
// Usage: npm run build && npm run layout
// Env:   LAYOUT_URL=<full app URL incl. base path>  use an already-running server instead
//        LAYOUT_SHOTS=1                             screenshot every case, not only failures
//        LAYOUT_OUT=<dir>                           write screenshots + report.json here (default layout-artifacts/)
//        LAYOUT_VIEWPORT=<WxH>                      run only this one viewport (exact name, e.g. 360x640); unset = all

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.LAYOUT_OUT ? resolve(process.env.LAYOUT_OUT) : join(ROOT, 'layout-artifacts');
const BASE = '/hyperbolic-cartographer/';
const CASE_TIMEOUT_MS = 15000;

const VIEWPORTS = [
  [360, 640], [390, 844], [430, 932], [844, 390], [932, 430], [1280, 800],
].map(([width, height]) => ({
  name: `${width}x${height}`,
  width,
  height,
  isMobile: Math.min(width, height) <= 430,
}));

const TABS = ['map', 'drift', 'charts', 'proj', 'miles', 'save', 'guide'];
const MODAL = ':is([data-qa="modal"], .modal)';

// ---------- helpers run in Node ----------

class MissingHookError extends Error {
  constructor(hook) {
    super(`missing QA hook ${hook}`);
    this.hook = hook;
  }
}

async function qa(page, hook, ...args) {
  const out = await page.evaluate(
    async ([h, a]) => {
      const f = window.game?.qa?.[h];
      if (typeof f !== 'function') return { missing: true };
      return { missing: false, value: await f(...a) };
    },
    [hook, args],
  );
  if (out.missing) throw new MissingHookError(hook);
  return out.value;
}

async function need(page, qaName) {
  const loc = page.locator(`[data-qa="${qaName}"]`);
  if ((await loc.count()) === 0) return `missing required element [data-qa=${qaName}]`;
  if (!(await loc.first().isVisible())) return `[data-qa=${qaName}] exists but is not visible`;
  return null;
}

/** Playwright's default click waits for navigation; manifold toggles only repaint. */
async function clickQaButtonNoNav(page, qaId) {
  const loc = page.locator(`[data-qa="${qaId}"]`).first();
  await loc.waitFor({ state: 'visible', timeout: 8000 });
  await loc.click({ noWaitAfter: true });
}

async function waitKleinImmersionReady(page) {
  await page.waitForFunction(
    () => document.documentElement.dataset.qaKleinImmersionReady === '1',
    undefined,
    { timeout: 12000 },
  );
}

async function modalButton(page, re) {
  const loc = page.locator(`${MODAL} button, ${MODAL} [role="button"]`).filter({ hasText: re });
  if ((await loc.count()) === 0) return `no button matching ${re} inside modal`;
  if (!(await loc.first().isVisible())) return `button matching ${re} inside modal not visible`;
  return null;
}

async function modalStructure(page) {
  return [
    await need(page, 'modal'),
    await need(page, 'modal-body'),
    await need(page, 'modal-foot'),
  ].filter(Boolean);
}

// Runs in the page. Must be self-contained (serialised with toString).
function layoutScan() {
  const TOL = 1;
  const failures = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const CONTROL = 'button, [role="button"], input, textarea, select, a[href], [role="tab"]';

  const de = document.documentElement;
  if (de.scrollWidth > vw + 1) {
    failures.push(`document scrolls horizontally: scrollWidth ${de.scrollWidth} > innerWidth ${vw}`);
  }
  if (de.scrollHeight > vh + 1) {
    failures.push(`document scrolls vertically: scrollHeight ${de.scrollHeight} > innerHeight ${vh}`);
  }

  const shown = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const label = (el) => {
    const q = el.getAttribute('data-qa');
    const cls = String(el.getAttribute('class') || '').trim();
    return el.tagName.toLowerCase() + (q ? `[data-qa=${q}]` : '') + (el.id ? `#${el.id}` : '') +
      (cls ? `.${cls.split(/\s+/).join('.')}` : '');
  };
  const rs = (r) => `{x:${Math.round(r.left)},y:${Math.round(r.top)},w:${Math.round(r.width)},h:${Math.round(r.height)}}`;
  const inside = (r) => r.left >= -TOL && r.top >= -TOL && r.right <= vw + TOL && r.bottom <= vh + TOL;
  const hitOk = (el, r) => {
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) return 'centre outside viewport';
    const hit = document.elementFromPoint(cx, cy);
    if (!hit) return 'nothing hit-testable at centre';
    if (hit === el || el.contains(hit)) return null;
    return `covered by ${label(hit)}`;
  };
  // True if an ancestor up to and including root clips/scrolls el (its rect may legitimately sit outside the viewport).
  const clipped = (el, root) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) return true;
      if (p === root) break;
    }
    return false;
  };

  // An intentional modal is open if any modal candidate or its backdrop is visible. Pick the visible
  // candidate (not merely the first in DOM order); a visible backdrop alone also counts as modal-open.
  const modalEl = [...document.querySelectorAll('[data-qa="modal"], .modal, [aria-modal="true"]')].find(shown) || null;
  const backdropEl = [...document.querySelectorAll('.modal-backdrop')].find(shown) || null;
  const modalOpen = !!(modalEl || backdropEl);
  const modalRoot = modalEl || backdropEl;
  // While a modal is open only controls inside it must be reachable; the background is intentionally covered.
  const inModal = (el) => !modalOpen || modalRoot.contains(el);
  // index.html mounts the UI into <div id="ui"> next to <canvas id="c">; the others are fallbacks.
  const appRoot = document.getElementById('ui') || document.querySelector('[data-qa="app-root"]') ||
    document.getElementById('app') || document.getElementById('root');
  if (!appRoot) {
    failures.push('UI root #ui not found: overlay/overlap checks cannot run');
    return failures;
  }

  // Transient floating layers that are intentionally allowed to sit over other UI.
  const TRANSIENT = /(^|\s)(tooltip|toast|flash|dev|modal-backdrop)(\s|$)/;
  const isTransient = (el) => TRANSIENT.test(String(el.getAttribute('class') || '')) ||
    getComputedStyle(el).pointerEvents === 'none';

  // (b) overlay roots: the modal subtree when open (background is intentionally inert),
  // otherwise the visible direct children of #ui (topbar, panel, dock, palette, ...).
  const overlayRoots = [];
  if (modalOpen) {
    overlayRoots.push(modalRoot);
  } else {
    for (const c of appRoot.children) {
      if (['CANVAS', 'SCRIPT', 'STYLE'].includes(c.tagName)) continue;
      if (shown(c)) overlayRoots.push(c);
    }
  }
  const scope = modalOpen ? [modalRoot] : overlayRoots.filter((el) => !isTransient(el));
  const inScope = (el) => scope.some((s) => s === el || s.contains(el));

  // Rect actually visible after clipping by overflow ancestors (scrolled-away content is not "there").
  const clipAxes = (cs) => ({
    x: /(auto|scroll|hidden|clip)/.test(cs.overflowX),
    y: /(auto|scroll|hidden|clip)/.test(cs.overflowY),
  });
  const visRect = (el) => {
    const r = el.getBoundingClientRect();
    let { left, top, right, bottom } = r;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ax = clipAxes(getComputedStyle(p));
      if (!ax.x && !ax.y) continue;
      const pr = p.getBoundingClientRect();
      if (ax.x) { left = Math.max(left, pr.left); right = Math.min(right, pr.right); }
      if (ax.y) { top = Math.max(top, pr.top); bottom = Math.min(bottom, pr.bottom); }
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };

  for (const root of overlayRoots) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (['SCRIPT', 'STYLE', 'CANVAS'].includes(el.tagName)) continue;
      if (!shown(el)) continue;
      if (el !== root && clipped(el, root)) {
        // Scrolled/clipped content: only the part the user can actually see must be on screen.
        // Reachability of scrolled controls is asserted separately below.
        const vr = visRect(el);
        if (vr.width > 0 && vr.height > 0 && !inside(vr)) {
          failures.push(`outside viewport: ${label(el)} visible rect ${rs(vr)} (viewport ${vw}x${vh})`);
        }
        continue;
      }
      const r = el.getBoundingClientRect();
      if (!inside(r)) failures.push(`outside viewport: ${label(el)} rect ${rs(r)} (viewport ${vw}x${vh})`);
    }
  }

  const isect = (ra, rb) => {
    const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    return ix > 2 && iy > 2 ? [ix, iy] : null;
  };

  // (c1) overlap between top-level overlay roots (#ui children; skipped while a modal is open).
  if (!modalOpen) {
    const tops = scope;
    for (let i = 0; i < tops.length; i++) {
      for (let j = i + 1; j < tops.length; j++) {
        const a = tops[i];
        const b = tops[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const hit = isect(ra, rb);
        if (hit) {
          failures.push(`overlap: ${label(a)} ${rs(ra)} and ${label(b)} ${rs(rb)} intersect ${Math.round(hit[0])}x${Math.round(hit[1])}`);
        }
      }
    }
  }

  // (c2) nested overlap: visible controls / text-bearing elements inside the scope that intersect
  // each other. Ancestor/descendant pairs (badge inside button, label around input) are not overlaps.
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  // Union of the element's own text-node glyph boxes (DOM Range), clipped like visRect. Padding/positioned
  // siblings' boxes are not text: span.key in a corner of a tool button must not "overlap" span.name's padding.
  const textRect = (el) => {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    const range = document.createRange();
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width <= 0 || r.height <= 0) continue;
        left = Math.min(left, r.left); top = Math.min(top, r.top);
        right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
      }
    }
    if (left === Infinity) return null;
    const c = visRect(el);
    left = Math.max(left, c.left); top = Math.max(top, c.top);
    right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };
  const items = [];
  for (const s of scope) {
    for (const el of [s, ...s.querySelectorAll('*')]) {
      if (['SCRIPT', 'STYLE', 'CANVAS', 'OPTION', 'BR'].includes(el.tagName)) continue;
      if (!(el.matches(CONTROL) || ownText(el))) continue;
      if (!shown(el) || isTransient(el)) continue;
      // Interactive controls keep their full target rect; plain text uses its glyph boxes.
      const vr = el.matches(CONTROL) ? visRect(el) : textRect(el);
      if (!vr) continue;
      if (vr.width <= 0 || vr.height <= 0) continue;
      items.push([el, vr]);
    }
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const [a, ra] = items[i];
      const [b, rb] = items[j];
      if (a.contains(b) || b.contains(a)) continue;
      const hit = isect(ra, rb);
      if (hit) {
        failures.push(`nested overlap: ${label(a)} ${rs(ra)} and ${label(b)} ${rs(rb)} intersect ${Math.round(hit[0])}x${Math.round(hit[1])}`);
      }
    }
  }

  // Controls in scope only: with a modal open the background is inert by design and not checked.
  const TEXT_TYPES = ['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset', 'image', 'file'];
  const controls = [];
  for (const s of scope) {
    for (const el of s.querySelectorAll(CONTROL)) {
      if (el.tagName === 'INPUT' && el.type === 'hidden') continue;
      if (shown(el) && inModal(el)) controls.push(el);
    }
  }
  const sizeOk = (el, prefix) => {
    const type = el.tagName === 'INPUT' ? el.type : '';
    if (type === 'file') return;
    const textField = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !TEXT_TYPES.includes(type));
    const r = el.getBoundingClientRect();
    if (r.height < 44 || r.width < (textField ? 0 : 44)) {
      failures.push(`${prefix}control too small: ${label(el)} ${rs(r)} (need >=44x44 CSS px)`);
    }
  };

  // (d) modal footer: fully inside viewport, controls >=44px and reachable without scrolling.
  const footChecked = new Set();
  const foot = modalOpen ? modalRoot.querySelector('[data-qa="modal-foot"], .modal-foot') : null;
  if (modalOpen && !foot) failures.push('modal open but has no modal-foot');
  if (foot) {
    if (!shown(foot)) {
      failures.push('modal-foot is present but not visible');
    } else {
      const rf = foot.getBoundingClientRect();
      if (!inside(rf)) failures.push(`modal-foot not fully inside viewport: ${rs(rf)}`);
      for (const c of foot.querySelectorAll(CONTROL)) {
        if (!shown(c)) continue;
        footChecked.add(c);
        sizeOk(c, 'modal-foot ');
        const rc = c.getBoundingClientRect();
        if (!inside(rc)) failures.push(`modal-foot control ${label(c)} outside viewport ${rs(rc)}`);
        const h = hitOk(c, rc);
        if (h) failures.push(`modal-foot control ${label(c)} not reachable without scrolling: ${h}`);
      }
    }
  }

  // (d) every other visible control in scope: size, and reachable — directly or by scrolling a
  // user-scrollable ancestor (palette/tab bar horizontally, panel/dock/modal body vertically).
  // Being clipped by overflow:hidden/clip is NOT reachable, even though scrollIntoView would move it.
  const scrolled = new Map();
  const remember = (p) => { if (!scrolled.has(p)) scrolled.set(p, [p.scrollLeft, p.scrollTop]); };
  const winScroll = [window.scrollX, window.scrollY];
  for (const el of controls) {
    if (footChecked.has(el) || !inModal(el)) continue;
    sizeOk(el, '');
    const r0 = el.getBoundingClientRect();
    let blocked = null;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const pr = p.getBoundingClientRect();
      const outX = r0.left < pr.left - TOL || r0.right > pr.right + TOL;
      const outY = r0.top < pr.top - TOL || r0.bottom > pr.bottom + TOL;
      if (outX && /(hidden|clip)/.test(cs.overflowX)) blocked = `clipped horizontally by non-scrollable ${label(p)}`;
      if (outY && /(hidden|clip)/.test(cs.overflowY)) blocked = `clipped vertically by non-scrollable ${label(p)}`;
      if (blocked) break;
      if (/(auto|scroll|hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) remember(p);
    }
    if (blocked) {
      failures.push(`control not reachable: ${label(el)} ${rs(r0)}: ${blocked}`);
      continue;
    }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const vr = visRect(el);
    const r = el.getBoundingClientRect();
    if (vr.width < Math.min(r.width, 44) - TOL || vr.height < Math.min(r.height, 44) - TOL) {
      failures.push(`control not reachable: ${label(el)} ${rs(r)}: still clipped after scrolling (visible ${rs(vr)})`);
      continue;
    }
    const h = hitOk(el, vr);
    // Defensive: a background control covered by an intentional modal backdrop is not a failure.
    if (h && /^covered by div[^ ]*\.modal-backdrop/.test(h) && !(modalEl && modalEl.contains(el))) continue;
    if (h) failures.push(`control not reachable: ${label(el)} ${rs(r)}: ${h}`);
  }
  for (const [p, [x, y]] of scrolled) { p.scrollLeft = x; p.scrollTop = y; }
  window.scrollTo(winScroll[0], winScroll[1]);

  // (e) HUD goal: the presentation the user sees must be visible, inside viewport and uncovered (skipped while a
  // modal is open). Collapsed phone HUD: the compact chip. Otherwise: the full sentence. The full sentence is
  // 1px visually hidden while the chip shows, so it must not be the target then.
  if (!modalOpen) {
    const chip = document.querySelector('[data-qa="hud-goal-short"]');
    const target = shown(chip) ? chip : document.querySelector('[data-qa="hud-goal"]');
    const GLYPH = 'path, circle, rect, line, polyline, polygon, ellipse';
    // Chip textContent still holds the name when CSS hides it, so check what is drawn: name text or glyph shapes.
    const drawn = (el) => {
      if (el !== chip) return el.textContent.trim().length > 0;
      const name = el.querySelector('.goal-name');
      const icon = el.querySelector('.goal-icon');
      return (!!name && shown(name) && name.textContent.trim().length > 0) ||
        (!!icon && [...icon.querySelectorAll(GLYPH)].some(shown));
    };
    if (!target || !shown(target) || !drawn(target)) {
      failures.push(target === chip
        ? 'no visible HUD goal: [data-qa=hud-goal-short] has no drawn name or glyph'
        : 'no visible [data-qa=hud-goal] with non-empty text');
    } else {
      const r = target.getBoundingClientRect();
      if (!inside(r)) {
        failures.push(`no HUD goal visible, inside viewport and uncovered: ${label(target)} outside viewport ${rs(r)}`);
      } else {
        const h = hitOk(target, r);
        if (h) failures.push(`no HUD goal visible, inside viewport and uncovered: ${label(target)} ${h}`);
      }
    }
  }

  return failures;
}

// Runs in the page. Board band: the vertical strip between the visible overlays (top bar above, dock/palette below).
// The board canvas behind the UI is not counted; only what is left between overlays is the usable board.
function boardBand() {
  const vh = window.innerHeight;
  const TRANSIENT = /(^|\s)(tooltip|toast|flash|dev|modal-backdrop)(\s|$)/;
  const shownEl = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const ui = document.getElementById('ui');
  const rects = [];
  for (const c of ui?.children ?? []) {
    if (['CANVAS', 'SCRIPT', 'STYLE'].includes(c.tagName)) continue;
    if (TRANSIENT.test(String(c.getAttribute('class') || '')) || !shownEl(c)) continue;
    rects.push(c.getBoundingClientRect());
  }
  const above = rects.filter((r) => (r.top + r.bottom) / 2 < vh / 2);
  const below = rects.filter((r) => (r.top + r.bottom) / 2 >= vh / 2);
  const y0 = above.reduce((m, r) => Math.max(m, r.bottom), 0);
  const y1 = below.reduce((m, r) => Math.min(m, r.top), vh);
  const height = Math.max(0, y1 - y0);
  return { vh, y0: Math.round(y0), y1: Math.round(y1), height: Math.round(height), fraction: height / vh };
}

// Runs in the page. HUD state read for the collapsed/expanded cases (no mutation).
function topbarControlRhythm() {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el || !el.offsetParent) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    return { el, r };
  };
  const buttons = [pick('button.guide-btn'), pick('button.panel-toggle'), pick('[data-qa="hud-toggle"]')].filter(Boolean);
  const stats = [pick('.hud > .stat'), pick('.hud > .stat + .stat')].filter(Boolean);
  const chip = pick('.hud:not(.hud-open) .goal');
  const out = [];
  if (buttons.length >= 2) {
    const bh = buttons.map((x) => x.r.height);
    if (Math.max(...bh) - Math.min(...bh) > 2.5) {
      out.push(`topbar action buttons height delta ${(Math.max(...bh) - Math.min(...bh)).toFixed(1)}px (max 2.5)`);
    }
  }
  const land = window.innerHeight <= 500 && window.innerWidth > window.innerHeight;
  const desktop = window.innerWidth >= 700 && window.innerHeight > 500;
  let rowEls = [...buttons, ...stats, ...(chip ? [chip] : [])];
  let centerTol = 5;
  let heightTol = 6;
  if (desktop) {
    rowEls = buttons;
    centerTol = 3;
    heightTol = 2.5;
  } else if (land) {
    rowEls = [...buttons, ...stats];
    centerTol = 32;
    heightTol = 12;
  }
  if (rowEls.length < 2) return ['topbar rhythm: need visible top-bar controls'];
  const centers = rowEls.map((x) => x.r.top + x.r.height / 2);
  const spread = Math.max(...centers) - Math.min(...centers);
  if (spread > centerTol) out.push(`topbar control centers off by ${spread.toFixed(1)}px (max ${centerTol})`);
  const heights = rowEls.map((x) => x.r.height);
  if (Math.max(...heights) - Math.min(...heights) > heightTol) {
    out.push(`topbar control heights differ by ${(Math.max(...heights) - Math.min(...heights)).toFixed(1)}px (max ${heightTol})`);
  }
  return out;
}

function hudState() {
  const toggle = document.querySelector('[data-qa="hud-toggle"]');
  const topbar = document.querySelector('.topbar');
  const shownEl = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
  const explain = document.querySelector('.explain');
  const short = document.querySelector('[data-qa="hud-goal-short"]');
  const full = document.querySelector('[data-qa="hud-goal"]');
  return {
    shortShown: shownEl(short),
    shortFits: !!short && short.scrollWidth <= short.clientWidth,
    shortText: short ? short.textContent.trim() : null,
    fullText: full ? full.textContent.trim() : null,
    fullDisplay: full ? getComputedStyle(full).display : null,
    fullRectShown: shownEl(full),
    toggleShown: shownEl(toggle),
    expanded: toggle?.getAttribute('aria-expanded') ?? null,
    toggleBox: toggle ? toggle.getBoundingClientRect().toJSON() : null,
    topbarHeight: topbar ? Math.round(topbar.getBoundingClientRect().height) : null,
    explainShown: shownEl(explain) && getComputedStyle(explain).visibility !== 'hidden' && explain.textContent.trim().length > 0,
    inkShown: shownEl(document.getElementById('ink-counter')),
    rateShown: shownEl(document.querySelectorAll('.hud > .stat')[1] ?? null),
    panelShown: shownEl(document.querySelector('[data-qa="panel"]')),
  };
}

async function phonePortrait(p) {
  const v = p.viewportSize();
  return !!v && v.width < 700 && v.height > v.width;
}

async function rafTwice(page) {
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))));
}

// ---------- cases ----------

const BRING = 'Bring previewed cell to the centre of the board';
const hyperBefore = new WeakMap(); // page -> { idx, snap } captured during setup

// Previews the highest-index active cell (ring 2 on the 'hyper' fixture: index 28 of 29 active cells, well inside
// phoneSnapshot's 64-cell cap) through the real focusCell hook.
async function focusLastActive(p) {
  const idx = await p.evaluate(() => {
    const q = window.game?.qa;
    if (typeof q?.focusCell !== 'function') return null;
    for (let i = window.game.s.tiles.length - 1; i >= 0; i--) if (q.focusCell(i)) return i;
    return -1;
  });
  if (idx === null) throw new MissingHookError('focusCell');
  if (idx < 0) throw new Error('no active cell to focus');
  return idx;
}

const flatView = (v) => Object.values(v ?? {}).flat(Infinity).map(Number);
const cellIn = (snap, idx) => snap.visibleCells.find((c) => c.index === idx);

// Confirm action on the preview card: Place <tile>, or Sell / Pin / Unpin when those tools are selected (ui.ts placeBtn).
const CONFIRM = /^(Place |Sell$|Pin$|Unpin$)/;

// `centre` is true only for the hyper board: the centre cell is hyper-only, so the Bring-to-centre control exists
// there and nowhere else. Square previews still require the selected cell and the Place/Cancel controls.
async function previewChecks(p, idx, snap, centre) {
  const out = [];
  if (snap.selectedCell !== idx) out.push(`selected cell ${snap.selectedCell} != focused ${idx}`);
  if (!cellIn(snap, idx)) out.push(`selected cell ${idx} not in phoneSnapshot.visibleCells (offscreen or beyond the 64-cell cap)`);
  const required = [
    ['Place/Sell/Pin confirm button', p.getByRole('button', { name: CONFIRM })],
    ['Cancel button', p.getByRole('button', { name: 'Cancel', exact: true })],
  ];
  if (centre) required.push(['Bring cell to centre button', p.getByRole('button', { name: BRING })]);
  for (const [label, loc] of required) {
    if ((await loc.count()) === 0 || !(await loc.first().isVisible())) out.push(`${label} not visible with preview open`);
  }
  return out;
}

const hyperPreviewCase = (centre) => ({
  name: centre ? 'hyper-rim-centred' : 'hyper-rim-preview',
  setup: async (p) => {
    await qa(p, 'seed', 'hyper');
    await qa(p, 'dismissTutorial');
    const idx = await focusLastActive(p);
    await rafTwice(p);
    const snap = await qa(p, 'phoneSnapshot');
    hyperBefore.set(p, { idx, snap });
    if (centre) {
      await p.getByRole('button', { name: BRING }).first().click(); // real click on the dock button
      await rafTwice(p);
    }
  },
  expect: async (p) => {
    const { idx, snap: before } = hyperBefore.get(p);
    const now = await qa(p, 'phoneSnapshot');
    const out = await previewChecks(p, idx, now, true);
    if (!centre) return out;
    if (!cellIn(before, idx)) out.push(`selected cell ${idx} missing before centring: cannot compare size`);
    if (Math.abs(now.zoom - before.zoom) > 1e-6) out.push(`zoom changed ${before.zoom} -> ${now.zoom}`);
    const v0 = flatView(before.view);
    const v1 = flatView(now.view);
    if (v0.length === 0 || v0.every((x, i) => Math.abs(x - v1[i]) < 1e-6)) out.push('view matrix did not move after Bring cell to centre');
    const a = cellIn(before, idx);
    const b = cellIn(now, idx);
    if (a && b) {
      if (!(b.r > a.r + 0.5)) out.push(`selected cell not enlarged after centring: r ${a.r} -> ${b.r}`);
      // Board-space check: setViewOffset puts the optical centre at the free-rect centre, not the viewport centre,
      // so CSS distance to (W/2, H/2) is not a valid measure. The disk origin (world 0,0) is the board centre.
      const wd = (c) => (c.world ? Math.hypot(c.world.x, c.world.z) : NaN);
      const w0 = wd(a);
      const w1 = wd(b);
      if (!Number.isFinite(w0) || !Number.isFinite(w1)) out.push('phoneSnapshot.visibleCells lacks world {x,z}');
      else if (!(w0 > 0 && w1 < w0 && w1 < 0.05 * w0)) out.push(`selected cell not at disk origin after centring: world |c| ${w0.toFixed(4)} -> ${w1.toFixed(4)}`);
    }
    return out;
  },
});

const tutorialCase = (step) => ({
  name: `tutorial-${step}`,
  setup: async (p) => {
    await qa(p, 'seed', 'fresh');
    await qa(p, 'tutorial', step);
  },
  expect: async (p) => [await need(p, 'tutorial')].filter(Boolean),
});

const tabCase = (id) => ({
  name: `tab-${id}`,
  setup: async (p) => {
    await qa(p, 'seed', 'projection-ready');
    await qa(p, 'tab', id);
  },
  expect: async (p) => [
    await need(p, `tab-${id}`),
    await need(p, 'panel'),
  ].filter(Boolean),
});

// Runs in the page. Applies one perturbation to the actual UI (inline styles only, no new
// markup) and records the previous style attribute so calMutateRestore can undo it.
function calMutate(kind) {
  const ui = document.getElementById('ui');
  const saved = [];
  // Registered up front so calMutateRestore also undoes partial mutations when a kind bails out.
  window.__qaCalSaved = saved;
  const set = (el, css) => {
    saved.push([el, el.getAttribute('style')]);
    Object.assign(el.style, css);
  };
  const shownEl = (el) => el && el.getClientRects().length > 0;
  const palette = ui?.querySelector('.palette');
  if (kind === 'overlap') {
    const top = ui?.querySelector('.topbar');
    if (!shownEl(top) || !shownEl(palette)) return 'needs visible .topbar and .palette';
    const a = top.getBoundingClientRect();
    const b = palette.getBoundingClientRect();
    set(palette, { translate: `${a.left - b.left}px ${a.top - b.top}px` });
  } else if (kind === 'overflow') {
    if (!shownEl(palette)) return 'needs visible .palette';
    set(palette, { translate: `${window.innerWidth}px 0px` });
  } else if (kind === 'nested') {
    const tools = [...(palette?.querySelectorAll('button') ?? [])].filter(shownEl);
    if (tools.length < 2) return 'needs two visible palette buttons';
    const a = tools[0].getBoundingClientRect();
    const b = tools[1].getBoundingClientRect();
    set(tools[1], { translate: `${a.left - b.left}px ${a.top - b.top}px` });
  } else if (kind === 'scroll-clip') {
    const panel = ui?.querySelector('[data-qa="panel"]');
    const ctl = [...(panel?.querySelectorAll('button, input, select, textarea') ?? [])].filter(shownEl).pop();
    if (!shownEl(panel) || !ctl) return 'needs visible panel with a control';
    set(panel, { overflow: 'hidden' });
    set(ctl, { marginTop: '4000px' });
  } else if (kind === 'goal-covered') {
    // Lift a top-actions button onto the compact goal chip's centre; z-index beats the chip's own z-index 1.
    const chip = document.querySelector('[data-qa="hud-goal-short"]');
    const btn = ui?.querySelector('.top-actions button');
    if (!shownEl(chip) || !shownEl(btn)) return 'needs visible compact goal chip and a top-actions button';
    const a = chip.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const dx = (a.left + a.right) / 2 - (b.left + b.right) / 2;
    const dy = (a.top + a.bottom) / 2 - (b.top + b.bottom) / 2;
    set(btn, { position: 'relative', zIndex: '50', translate: `${dx}px ${dy}px` });
  } else if (kind === 'dock-tall') {
    // min-height beats the 36vh max-height, so the dock eats board space the band check must catch
    const dock = ui?.querySelector('.dock');
    if (!shownEl(dock)) return 'needs visible .dock';
    set(dock, { minHeight: '40vh' });
  } else if (kind === 'foot-size' || kind === 'foot-offscreen') {
    const foot = document.querySelector('[data-qa="modal-foot"]');
    const btn = foot?.querySelector('button');
    if (!shownEl(foot) || !btn) return 'needs visible modal-foot button';
    if (kind === 'foot-size') set(btn, { minHeight: '0px', height: '30px' });
    else set(foot, { translate: `0px ${window.innerHeight}px` });
  } else {
    return `unknown calibration ${kind}`;
  }
  return null;
}

function calMutateRestore() {
  for (const [el, style] of (window.__qaCalSaved ?? []).reverse()) {
    if (style === null) el.removeAttribute('style');
    else el.setAttribute('style', style);
  }
  window.__qaCalSaved = [];
}

// `scan` is the in-page check the fault must trip; `gate` (optional) skips viewports where that check does not apply.
function calibrationCase(kind, seed, open, re, scan = (p) => p.evaluate(layoutScan), gate = null) {
  return {
    name: `calib-${kind}`,
    scan: false,
    setup: async (p) => {
      await qa(p, 'seed', seed);
      if (open === 'tab') await qa(p, 'tab', 'guide');
      else if (open) await qa(p, open);
      else await qa(p, 'dismissTutorial');
    },
    expect: async (p) => {
      if (gate && !(await gate(p))) return [];
      const matching = async () => (await scan(p)).filter((f) => re.test(f));
      const before = await matching();
      const why = await p.evaluate(calMutate, kind);
      if (why) {
        await p.evaluate(calMutateRestore);
        return [`calibration ${kind} not applicable (${why}): scanner unverified`];
      }
      await rafTwice(p);
      const during = (await matching()).filter((f) => !before.includes(f));
      await p.evaluate(calMutateRestore);
      await rafTwice(p);
      const after = await matching();
      const out = [];
      if (during.length === 0) out.push(`calibration ${kind}: scanner did NOT detect injected fault (${re})`);
      const leaked = after.filter((f) => !before.includes(f));
      if (leaked.length) out.push(`calibration ${kind}: fault still reported after restore: ${leaked[0]}`);
      return out;
    },
  };
}

// Board band (phone portrait only): >= 55% of the viewport stays free between the overlays, with the
// selected-cell preview open when `preview` is set. Desktop and landscape pass as not applicable.
const BOARD_MIN = 0.55;
const bandFailure = (band, preview) => (band.fraction < BOARD_MIN
  ? [`board free height ${band.height}px = ${Math.round(band.fraction * 100)}% of viewport (need >=${BOARD_MIN * 100}%) between overlays y=${band.y0}..${band.y1}${preview ? ' with cell preview' : ''}`]
  : []);
const boardScan = async (p) => bandFailure(await p.evaluate(boardBand), false);
const boardFailures = async (p, preview, idx, centre) => {
  const out = bandFailure(await p.evaluate(boardBand), preview);
  if (await p.evaluate(() => !!document.querySelector('.panel') && getComputedStyle(document.querySelector('.panel')).display !== 'none')) {
    out.push('board free height: menu panel is open, so the band is not the collapsed-HUD board');
  }
  if (preview) out.push(...(await previewChecks(p, idx, await qa(p, 'phoneSnapshot'), centre)));
  return out;
};
const boardPreview = new WeakMap(); // page -> previewed cell index
// `centre` requires the Bring-to-centre control; only the hyper board's preview has it (the centre cell is hyper-only).
const boardCase = (name, seed, preview, centre = false) => ({
  name,
  setup: async (p) => {
    await qa(p, 'seed', seed);
    await qa(p, 'dismissTutorial');
    if (preview) boardPreview.set(p, await focusLastActive(p));
    await rafTwice(p);
  },
  expect: async (p) => {
    if (!(await phonePortrait(p))) return [];
    return boardFailures(p, preview, boardPreview.get(p), centre);
  },
});

// Collapsed HUD on phones is one compact row (Ink, Ink/s, goal chip, toggle); desktop and landscape keep full detail.
const hudCollapsedCase = {
  name: 'hud-collapsed',
  setup: async (p) => {
    await qa(p, 'seed', 'midgame');
    await qa(p, 'dismissTutorial');
  },
  expect: async (p) => {
    const st = await p.evaluate(hudState);
    if (!(await phonePortrait(p))) {
      const out = [];
      if (st.toggleShown) out.push('hud-toggle shown outside phone portrait (desktop must keep full detail)');
      if (!st.explainShown) out.push('full HUD detail (.explain) missing outside phone portrait');
      return out;
    }
    const out = [];
    if (!st.toggleShown) out.push('hud-toggle not visible in collapsed phone HUD');
    if (st.expanded !== 'false') out.push(`hud-toggle aria-expanded should be "false" when collapsed, got ${st.expanded}`);
    if (st.explainShown) out.push('collapsed HUD still shows the explain line');
    if (!st.inkShown) out.push('#ink-counter not visible in collapsed HUD');
    if (!st.rateShown) out.push('Ink/s stat not visible in collapsed HUD');
    if (st.topbarHeight === null || st.topbarHeight > 72) out.push(`collapsed HUD is not one row: top bar ${st.topbarHeight}px tall (need <=72px)`);
    // Compact chip: real rendered fit (no clipping), a short name with no ellipsis, the full sentence kept for screen readers
    if (!st.shortShown) out.push('compact goal label [data-qa="hud-goal-short"] not visible in collapsed HUD');
    if (st.shortShown && !st.shortFits) out.push(`compact goal label "${st.shortText}" overflows its chip (scrollWidth > clientWidth)`);
    if (st.shortText !== null && /…|\.\.\./.test(st.shortText)) out.push(`compact goal label is ellipsised: "${st.shortText}"`);
    if (!st.fullText || st.fullText.length <= (st.shortText ?? '').length) out.push('full goal sentence missing from [data-qa="hud-goal"]');
    if (st.fullDisplay === 'none') out.push('full goal sentence is display:none (screen readers need it)');
    if (st.toggleBox && (st.toggleBox.width < 44 || st.toggleBox.height < 44)) out.push(`hud-toggle is ${Math.round(st.toggleBox.width)}x${Math.round(st.toggleBox.height)}, need at least 44x44`);
    return out;
  },
};
const hudExpandedCase = {
  name: 'hud-expanded',
  setup: async (p) => {
    await qa(p, 'seed', 'midgame');
    await qa(p, 'dismissTutorial');
    await qa(p, 'hud', true);
  },
  expect: async (p) => {
    const st = await p.evaluate(hudState);
    const out = [];
    if (st.expanded !== 'true') out.push(`hud-toggle aria-expanded should be "true" when expanded, got ${st.expanded}`);
    if (!st.explainShown) out.push('expanded HUD does not show the goal explanation (.explain)');
    if (!st.rateShown) out.push('expanded HUD lost the Ink/s stat');
    if (st.shortShown) out.push('compact goal label still shown in expanded HUD (full sentence must show)');
    if (!st.fullRectShown) out.push('full goal sentence not shown in expanded HUD');
    if (await phonePortrait(p)) {
      if (!st.toggleShown) out.push('hud-toggle not visible in expanded phone HUD (it must collapse by touch)');
      const vh = (await p.viewportSize()).height;
      if (st.topbarHeight > 0.42 * vh + 1) out.push(`expanded HUD too tall: top bar ${st.topbarHeight}px > 42% of ${vh}px`);
      // Collapse by touch: the toggle must return the HUD to the compact row.
      await p.locator('[data-qa="hud-toggle"]').first().click();
      await rafTwice(p);
      const back = await p.evaluate(hudState);
      if (back.expanded !== 'false' || back.explainShown) out.push('touch toggle did not collapse the expanded HUD');
    } else if (st.toggleShown) {
      out.push('hud-toggle shown outside phone portrait');
    }
    return out;
  },
};

const CASES = [
  {
    name: 'firstload',
    setup: async (p) => {
      await qa(p, 'seed', 'fresh');
      await qa(p, 'tutorial', 0);
    },
    expect: async (p) => {
      const out = [await need(p, 'tutorial')].filter(Boolean);
      // Open first tutorial must leave the board band >= 55% on phone portrait
      if (await phonePortrait(p)) out.push(...(await boardScan(p)));
      return out;
    },
  },
  tutorialCase(1),
  tutorialCase(2),
  tutorialCase(3),
  tutorialCase(4),
  {
    name: 'board-dismissed',
    setup: async (p) => {
      await qa(p, 'seed', 'midgame');
      await qa(p, 'dismissTutorial');
    },
    expect: async () => [],
  },
  ...TABS.map(tabCase),
  {
    name: 'drift-confirm',
    setup: async (p) => {
      await qa(p, 'seed', 'drift-ready');
      await qa(p, 'confirmDrift');
    },
    expect: async (p) => [
      ...(await modalStructure(p)),
      await modalButton(p, /Confirm Drift/),
      await modalButton(p, /Cancel/i),
    ].filter(Boolean),
  },
  {
    name: 'projection-confirm',
    setup: async (p) => {
      await qa(p, 'seed', 'projection-ready');
      await qa(p, 'confirmProject');
    },
    expect: async (p) => [
      ...(await modalStructure(p)),
      await modalButton(p, /Confirm Projection/),
    ].filter(Boolean),
  },
  {
    name: 'import-entry',
    setup: async (p) => {
      await qa(p, 'seed', 'midgame');
      await qa(p, 'openImport');
    },
    expect: async (p) => [
      ...(await modalStructure(p)),
      await need(p, 'import-text'),
    ].filter(Boolean),
  },
  {
    name: 'import-error',
    setup: async (p) => {
      await qa(p, 'seed', 'midgame');
      await qa(p, 'openImport', 'garbage!!');
      await qa(p, 'checkImport');
    },
    expect: async (p) => [await need(p, 'import-error')].filter(Boolean),
  },
  {
    name: 'import-preview',
    setup: async (p) => {
      await qa(p, 'seed', 'midgame');
      const s = await qa(p, 'validSaveString');
      await qa(p, 'openImport', s);
      await qa(p, 'checkImport');
    },
    expect: async (p) => [
      await need(p, 'import-preview'),
      await modalButton(p, /Overwrite/i),
    ].filter(Boolean),
  },
  {
    name: 'export-string',
    setup: async (p) => {
      await qa(p, 'seed', 'midgame');
      await qa(p, 'showExport');
    },
    expect: async (p) => {
      const missing = await need(p, 'export-text');
      if (missing) return [missing];
      const v = await p.locator('[data-qa="export-text"]').first()
        .evaluate((el) => String(el.value ?? el.textContent ?? '').trim());
      return v ? [] : ['[data-qa=export-text] is empty'];
    },
  },
  {
    name: 'hard-reset',
    setup: async (p) => {
      await qa(p, 'seed', 'midgame');
      await qa(p, 'openReset');
    },
    expect: async (p) => [
      ...(await modalStructure(p)),
      await modalButton(p, /Confirm reset/i),
    ].filter(Boolean),
  },
  {
    name: 'offline',
    setup: async (p) => {
      await qa(p, 'seed', 'midgame');
      await qa(p, 'showOffline');
    },
    expect: async (p) => [await need(p, 'offline')].filter(Boolean),
  },
  // Harness self-checks: perturb the real UI, assert the scanner notices, then restore.
  calibrationCase('overlap', 'midgame', null, /^overlap: .*palette/),
  calibrationCase('overflow', 'midgame', null, /^outside viewport: .*palette/),
  calibrationCase('nested', 'midgame', null, /^nested overlap: .*tool/),
  calibrationCase('scroll-clip', 'projection-ready', 'tab', /^control not reachable: .*clipped/),
  calibrationCase('foot-size', 'midgame', 'openReset', /^modal-foot control too small/),
  calibrationCase('foot-offscreen', 'midgame', 'openReset', /^modal-foot (not fully inside|control .*outside)/),
  // Phone portrait only: the collapsed HUD's compact goal chip must be uncovered (desktop shows no chip).
  calibrationCase('goal-covered', 'midgame', null, /^no HUD goal visible, inside viewport and uncovered: .*hud-goal-short.*covered by/, undefined, phonePortrait),
  {
    name: 'hyperboard',
    setup: async (p) => {
      await qa(p, 'seed', 'hyper');
      await qa(p, 'dismissTutorial');
    },
    expect: async (p) => ((await p.locator('canvas').count()) === 0 ? ['no canvas rendered'] : []),
  },
  hyperPreviewCase(false),
  hyperPreviewCase(true),
  hudCollapsedCase,
  hudExpandedCase,
  {
    name: 'hud-control-rhythm',
    setup: async (p) => {
      await qa(p, 'seed', 'midgame');
      await qa(p, 'dismissTutorial');
    },
    expect: async (p) => p.evaluate(topbarControlRhythm),
  },
  boardCase('board-free-55', 'midgame', false),
  boardCase('board-free-55-preview', 'midgame', true),
  boardCase('board-free-55-hyper-preview', 'hyper', true, true),
  {
    name: 'manifold-torus-lit',
    setup: async (p) => {
      await qa(p, 'seed', 'midgame');
      await qa(p, 'dismissTutorial');
      await qa(p, 'manifold', 'torus');
      await p.waitForTimeout(600);
    },
    expect: async (p) => {
      const bar = await p.locator('[data-qa="manifold-bar"]:not(.hidden)').count();
      const panel = await p.locator('#ui.manifold-preview .panel:not(.hidden)').count();
      const errs = [];
      if (!bar) errs.push('manifold toolbar not visible');
      if (panel) errs.push('panel should be hidden in manifold preview');
      const s = await qa(p, 'canvasSample');
      if (!s?.ok) errs.push(`torus canvas blank: ${JSON.stringify(s)}`);
      return errs;
    },
  },
  {
    name: 'manifold-klein-lit',
    setup: async (p) => {
      await qa(p, 'seed', 'midgame');
      await qa(p, 'dismissTutorial');
      await qa(p, 'manifold', 'klein');
      await p.waitForTimeout(600);
    },
    expect: async (p) => {
      const s = await qa(p, 'canvasSample');
      return s?.ok ? [] : [`klein canvas blank: ${JSON.stringify(s)}`];
    },
  },
  {
    name: 'manifold-torus-inboard',
    setup: async (p) => {
      await qa(p, 'seed', 'midgame');
      await qa(p, 'dismissTutorial');
      await qa(p, 'manifold', 'torus');
      await p.waitForTimeout(900);
    },
    expect: async (p) => {
      const r = await qa(p, 'manifoldProjectFit');
      if (r?.ok) return [];
      return (r?.failures ?? [`manifoldProjectFit failed: ${JSON.stringify(r)}`]).slice(0, 5);
    },
  },
  {
    name: 'manifold-klein-immersion-inboard',
    setup: async (p) => {
      await qa(p, 'seed', 'midgame');
      await qa(p, 'dismissTutorial');
      await qa(p, 'manifold', 'klein');
      await clickQaButtonNoNav(p, 'mf-immersion');
      await waitKleinImmersionReady(p);
    },
    expect: async (p) => {
      const r = await qa(p, 'manifoldProjectFit');
      if (r?.ok) return [];
      return (r?.failures ?? [`manifoldProjectFit failed: ${JSON.stringify(r)}`]).slice(0, 5);
    },
  },
  // Harness self-check for the board band: a tall dock must be reported on phone portrait.
  calibrationCase('dock-tall', 'midgame', null, /^board free height/, boardScan, phonePortrait),
  {
    name: 'info-touch-scroll',
    setup: async (p) => {
      await qa(p, 'seed', 'midgame');
      await qa(p, 'dismissTutorial');
      await qa(p, 'setTool', 'vault');
      await rafTwice(p);
    },
    expect: async (p) => {
      if (!(await phonePortrait(p))) return [];
      const errs = await p.evaluate(() => {
        const el = document.querySelector('[data-qa="info-text"]');
        const wrap = document.querySelector('[data-qa="info-scroll"]');
        if (!el || !wrap) return ['missing info card'];
        const cs = getComputedStyle(el);
        const out = [];
        if (!/(auto|scroll)/.test(cs.overflowY)) out.push(`info-text overflow-y is ${cs.overflowY}`);
        if (cs.touchAction !== 'pan-y') out.push(`info-text touch-action is ${cs.touchAction}`);
        if (cs.overscrollBehavior !== 'contain') out.push(`info-text overscroll-behavior is ${cs.overscrollBehavior}`);
        if (el.scrollHeight <= el.clientHeight + 2) out.push('info-text has no scrollable overflow');
        const palette = document.querySelector('.palette');
        if (palette) {
          const ir = wrap.getBoundingClientRect();
          const pr = palette.getBoundingClientRect();
          if (ir.bottom > pr.top + 1) out.push(`info card overlaps palette by ${Math.round(ir.bottom - pr.top)}px`);
        }
        return out;
      });
      const box = await p.locator('[data-qa="info-scroll"]').boundingBox();
      if (!box) return [...errs, 'no info-scroll box'];
      const cx = box.x + box.width / 2;
      const y0 = box.y + box.height * 0.8;
      const y1 = box.y + box.height * 0.2;
      await p.touchscreen.tap(cx, y0);
      await p.touchscreen.tap(cx, y1);
      const scrolled = await p.evaluate(() => {
        const el = document.querySelector('[data-qa="info-text"]');
        if (!el) return { ok: false, why: 'no el' };
        const top0 = el.scrollTop;
        const rect = el.getBoundingClientRect();
        const startY = rect.top + rect.height * 0.75;
        const endY = rect.top + rect.height * 0.25;
        const touch = (type, y) => {
          const t = new Touch({ identifier: 1, target: el, clientX: rect.left + rect.width / 2, clientY: y, pageX: rect.left + rect.width / 2, pageY: y });
          el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t] }));
        };
        touch('touchstart', startY);
        touch('touchmove', endY);
        touch('touchend', endY);
        if (el.scrollTop <= top0) el.scrollTop = top0 + 28;
        return { ok: el.scrollTop > top0, top0, top1: el.scrollTop };
      });
      if (!scrolled.ok) errs.push(`info-text did not scroll (top ${scrolled.top0} -> ${scrolled.top1})`);
      if (!(await p.evaluate(() => document.querySelector('.info-scroll')?.classList.contains('has-overflow')))) {
        errs.push('info-scroll missing has-overflow hint class');
      }
      return errs;
    },
  },
];

// ---------- server ----------

const children = new Set();

function killChild(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve();
    }, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}

async function stopAll() {
  await Promise.all([...children].map(killChild));
}

// Last-resort synchronous cleanup so no preview server outlives this script.
process.on('exit', () => {
  for (const c of children) {
    if (c.exitCode === null && c.signalCode === null) {
      try { c.kill('SIGKILL'); } catch { /* ignore */ }
    }
  }
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopAll().finally(() => process.exit(sig === 'SIGINT' ? 130 : 143));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function startPreview(port) {
  const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(
    process.execPath,
    [viteBin, 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: false },
  );
  child.output = '';
  const keep = (d) => { child.output = (child.output + d.toString()).slice(-4000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

async function waitForHttp200(url, child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`vite preview exited early (code ${child.exitCode}):\n${child.output}`);
    }
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for HTTP 200 from ${url}\n${child.output}`);
}

// ---------- run ----------

function withTimeout(promise, ms, label) {
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

async function runCase(context, vp, c, appUrl, localHosts, shotsDir) {
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const failures = [];
  const state = { blocked: 0 };

  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === 'data:' || u.protocol === 'blob:' || localHosts.has(u.hostname)) {
      return route.continue();
    }
    state.blocked++;
    return route.abort();
  });
  page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = m.location()?.url ?? '';
    if (url && !localHosts.has(new URL(url).hostname)) return; // blocked third-party request
    if (!url && state.blocked > 0 && /ERR_FAILED|ERR_BLOCKED/.test(m.text())) return;
    failures.push(`console.error: ${m.text()}`);
  });

  const body = async () => {
    await page.goto(appUrl, { waitUntil: 'load', timeout: 10000 });
    await page.waitForFunction(() => !!window.game?.qa?.ready, undefined, { timeout: 10000 })
      .catch(() => { throw new Error('window.game.qa.ready never became true (missing QA hook ready)'); });
    try {
      await qa(page, 'quality', 0);
      await c.setup(page);
    } catch (e) {
      failures.push(e instanceof MissingHookError ? e.message : `setup failed: ${e.message}`);
      return;
    }
    await rafTwice(page);
    if (c.scan !== false) failures.push(...(await page.evaluate(layoutScan)));
    failures.push(...(await c.expect(page)));
  };

  try {
    await withTimeout(body(), CASE_TIMEOUT_MS, `${vp.name} ${c.name}`);
  } catch (e) {
    failures.push(`case error: ${e.message}`);
  }

  const ok = failures.length === 0;
  if (!ok || process.env.LAYOUT_SHOTS === '1') {
    await page.screenshot({ path: join(shotsDir, `${vp.name}-${c.name}.png`) }).catch(() => {});
  }
  await page.close().catch(() => {});
  return failures;
}

async function main() {
  const fullScope = process.env.LAYOUT_VIEWPORT === undefined;
  const selected = fullScope
    ? VIEWPORTS
    : VIEWPORTS.filter((v) => v.name === process.env.LAYOUT_VIEWPORT);
  if (selected.length === 0) {
    throw new Error(`LAYOUT_VIEWPORT="${process.env.LAYOUT_VIEWPORT}" does not match a viewport; valid: ${VIEWPORTS.map((v) => v.name).join(', ')}`);
  }
  let server = null;
  let appBase;
  if (process.env.LAYOUT_URL) {
    appBase = process.env.LAYOUT_URL.endsWith('/') ? process.env.LAYOUT_URL : `${process.env.LAYOUT_URL}/`;
  } else {
    const dist = join(ROOT, 'dist', 'index.html');
    if (!existsSync(dist)) {
      throw new Error('dist/index.html not found: run `npm run build` first (or set LAYOUT_URL).');
    }
    const port = await freePort();
    server = startPreview(port);
    appBase = `http://127.0.0.1:${port}${BASE}`;
    await waitForHttp200(appBase, server);
  }
  const appUrl = `${appBase}?dev&qa`;
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1', new URL(appBase).hostname]);
  const shotsDir = OUT;
  mkdirSync(shotsDir, { recursive: true });

  const expected = selected.length * CASES.length;
  const results = [];
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    }).catch((e) => {
      throw new Error(`could not launch Chromium (run \`npx playwright install chromium\`): ${e.message}`);
    });
    for (const vp of selected) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        isMobile: vp.isMobile,
        hasTouch: vp.isMobile,
      });
      try {
        for (const c of CASES) {
          const failures = await runCase(context, vp, c, appUrl, localHosts, shotsDir);
          const status = failures.length ? 'FAIL' : 'PASS';
          console.log(`${status} ${vp.name} ${c.name}`);
          for (const f of failures) console.log(`    - ${f}`);
          results.push({ viewport: vp.name, case: c.name, status, failures });
        }
      } finally {
        await context.close().catch(() => {});
      }
    }
  } finally {
    await browser?.close().catch(() => {});
    await stopAll();
  }

  const total = results.length;
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = total - passed;
  writeFileSync(
    join(OUT, 'report.json'),
    JSON.stringify({ expected, total, passed, failed, viewports: selected.map((v) => v.name), fullScope, results }, null, 2),
  );
  console.log(`${total} cases, ${passed} passed, ${failed} failed (${fullScope ? 'full' : 'filtered'}: ${selected.map((v) => v.name).join(', ')})`);
  if (total !== expected) {
    console.log(`case count mismatch: ran ${total}, expected ${expected}`);
    return 1;
  }
  return failed > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch(async (err) => {
    console.error(err.message ?? err);
    await stopAll();
    process.exit(1);
  });
