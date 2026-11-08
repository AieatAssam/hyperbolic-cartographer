import Decimal from 'break_eternity.js';
import type { GameState, SurfacePreview } from '../core/state';
import { TILE_INFO, TILE_TYPES, type TileType } from '../core/tiles';
import type { ImportResult } from '../core/save';
import type { OfflineReport } from '../core/tick';
import { autoSurveyOn } from '../core/tick';
import { config, chartUpgrades, curvUpgrades, type ChartUpgradeId, type CurvUpgradeId, type UpgradeDef } from '../core/config';
import { MILESTONES, has } from '../core/milestones';
import { canProject, chartsOnDrift, curvatureOnProjection } from '../core/prestige';
import { cellsInRing, isActive, maxPins, maxRing, prod, surveyCost, tileCost } from '../core/economy';
import { fmt, fmtTime } from './format';
import {
  BUTTON_HELP, DRIFT_EXPLAIN, DRIFT_KEEPS, DRIFT_RESETS, PROJECTION_KEEPS, PROJECTION_RESETS, SURVEY_EXPLAIN, TAB_HELP, TOOL_EFFECT, TOOL_HELP,
  driftBlocked, placeBlocked, projectBlocked, projectionCompare, surveyBlocked, upgradeBlocked,
  type Tab, type Tool,
} from './help';
import { attentionCleared, menuAttention } from '../core/menu-attention';
import type { ConstellationId } from '../core/constellations';
import { explainNow, immediateGoal, longGoal, type GoalIcon } from './goals';
import {
  STEPS, currentStep, dismissTutorial, nextStep, parseTutorial, prevStep, reopenTutorial, restartTutorial, serializeTutorial, syncTutorial,
  type TutorialState,
} from './tutorial';
import { UI, contrastRatio, hexString, tileChipColour } from '../art/palette';
import type { AudioApi } from '../audio';
import { creditsCard, soundCard, soundToggle } from '../audio/settings-ui';

export type { Tool } from './help';
export interface UICtx {
  state: () => GameState; // live mutable state object (may be replaced after import/reset, so always call it)
  tool: { current: Tool };
  selected(): number; // touch-previewed cell, -1 if none
  /** Focused board cell for labels (tap, hover, QA). */
  boardFocus?(): number;
  /** Inspected tile (tap-to-inspect), or -1. Hides tutorial dock card while set so the board stays clear. */
  inspectCell(): number;
  cellInfo(i: number): string; // HTML describing cell i for the current tool (cost, Ink/s delta, blocked reason)
  cellScreenPos?(i: number): { x: number; y: number } | null;
  bridgePreviewDelta?(): number | null;
  flowRateLabels?(): readonly { x: number; y: number; text: string }[];
  tutorial: { load(): string | null; save(v: string): void }; // stored apart from the game save
  act: {
    survey(): void; drift(): void; project(): void;
    buyChart(id: ChartUpgradeId): void; buyCurv(id: CurvUpgradeId): void;
    exportString(): string; // returns compressed save string
    exportFile(): void; // triggers the .json download
    parseImport(text: string): ImportResult;
    applyImport(s: GameState): void; // overwrite current save (caller keeps backup)
    hardReset(): void;
    setSpeed(x: number): void;
    grant(kind: 'ink' | 'charts' | 'curvature', amount: number): void;
    recenter(): void; // reset camera / hyperbolic view
    confirmPlace(): void; // apply the current tool to the selected cell
    cancelPlace(): void; // clear the selected cell
    centreSelected(): void; // move the selected cell to the disk centre (hyperbolic only; keeps selection and zoom)
    enterManifoldPreview?(which: 'torus' | 'klein'): void;
    exitManifoldPreview?(): void;
    toggleSurfaceChart?(): void;
    toggleSeamView?(): void;
    toggleKleinImmersion?(): void;
    switchManifold?(which: 'torus' | 'klein'): void;
    manifoldPreview?(): SurfacePreview;
  };
  dev: boolean;
  /** Sound settings, credits and the header mute button appear only when provided. */
  audio?: AudioApi;
}
export interface UI {
  update(): void; // called ~10x per second; cheap. Rebuilds panel body only on tab/state-key change.
  /** Repositions the floating bridge +Ink/s label (call every frame while previewing). */
  syncBridgeGain(): void;
  /** Repositions +Ink/s labels on inspect flow arcs. */
  syncFlowLabels(): void;
  tooltip(x: number, y: number, html: string | null): void; // null hides
  showOffline(r: OfflineReport): void;
  toast(msg: string): void;
  flash(): void;
  /** Visual-only pulse on the HUD Ink counter (GPU mote arrival). */
  bumpInk(weight: number): void;
  /** Plain-words goal override while a prestige transition plays; null restores the normal goal. `short` is its compact chip label, `icon` its glyph (default 'project'). */
  setTransition(text: string | null, short?: string, icon?: GoalIcon): void;
  /** Manifold preview: hide the panel and show the floating surface toolbar. */
  setManifoldPreview(on: boolean, surface?: SurfacePreview): void;
  /** Dev/QA hooks (main.ts exposes them only under ?dev&qa). Each one calls an existing internal. */
  qa: {
    tab(id: string): void; openImport(text?: string): void; checkImport(): void; showExport(): void; openReset(): void;
    confirmDrift(): void; confirmProject(): void; closeModal(): void; modalOpen(): boolean; reloadTutorial(): void;
    /** Phone HUD: with an argument, sets expanded (true) or collapsed (false); always returns the current state. */
    hud(open?: boolean): boolean;
    menu(open?: boolean): boolean;
  };
}

type Dec = GameState['ink'];
const TABS: [Tab, string][] = [
  ['map', 'Map'], ['constellations', 'Stars'], ['drift', 'Drift'], ['charts', 'Charts'], ['proj', 'Projection'], ['miles', 'Milestones'], ['save', 'Settings'], ['guide', 'Guide'],
];
const CONST_NAMES: Record<ConstellationId, string> = {
  inkstream: config.constellations.inkstream.name,
  millwheel: config.constellations.millwheel.name,
  twinmills: config.constellations.twinmills.name,
};
const TOOL_NAME: Record<Tool, string> = { ...Object.fromEntries(TILE_TYPES.map((t) => [t, TILE_INFO[t].name])), sell: 'Sell', pin: 'Pin' } as Record<Tool, string>;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const title = (t: string) => el('h3', '', t);
const txt = (t: string) => el('p', '', t);
const card = (...kids: (HTMLElement | string)[]) => {
  const c = el('div', 'card');
  c.append(...kids);
  return c;
};
const row = (...kids: HTMLElement[]) => {
  const r = el('div', 'row');
  r.append(...kids);
  return r;
};
const list = (cls: string, items: string[]) => {
  const u = el('ul', cls);
  u.append(...items.map((i) => el('li', '', i)));
  return u;
};
const btn = (label: string, cls: string, onclick: () => void) => {
  const b = el('button', cls, label);
  b.type = 'button';
  b.onclick = onclick;
  return b;
};
let descId = 0;
/** Gives a control help text: announced by screen readers and shown in the info card on keyboard focus / mouse hover. */
const help = <T extends HTMLElement>(e: T, name: string, text: string): T => {
  e.dataset.help = text;
  e.dataset.helpName = name;
  return e;
};
/**
 * A control with its help text visible underneath (touch has no hover) and a live "why it's disabled" line.
 * Both are linked via aria-describedby.
 */
const ctl = (b: HTMLElement, name: string, text: string) => {
  const box = el('div', 'ctl');
  const h = el('p', 'help', text);
  const why = el('p', 'why');
  why.hidden = true;
  h.id = `d${++descId}`;
  why.id = `d${++descId}`;
  help(b, name, text).setAttribute('aria-describedby', `${h.id} ${why.id}`);
  box.append(b, why, h);
  return { box, why: (reason: string | null) => ((why.hidden = !reason), (why.textContent = reason ?? '')) };
};
const clamp = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const hex = hexString;

/** 8×8 px tool chip: tile `base` fill; ring when base contrast on HUD glass is low. */
const paletteDot = (base: number) => {
  const dot = el('span', 'palette-dot');
  dot.style.background = hex(base);
  if (contrastRatio(base, UI.hudChipBg) < 2.8) dot.classList.add('palette-dot--ring');
  return dot;
};
const narrow = () => innerWidth < 700 || innerHeight <= 500;
/** Compact-chip glyphs (24x24 stroke icons), shown when the chip is too narrow for its short name. Semantic per branch, not parsed from text. */
const GOAL_ICON_SVG: Record<GoalIcon, string> = {
  spring: '<path d="M12 3 6.5 10.5a6 6 0 1 0 11 0Z"/>', // drop: a Spring
  mill: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>', // gear: a Mill
  survey: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>', // crosshair: Survey
  boost: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13Z"/>', // bolt: Boost Mill
  drift: '<path d="M4 12h15M13 6l6 6-6 6"/>', // arrow: Drift
  project: '<path d="M12 3 21 12 12 21 3 12Z"/>', // diamond: Project
};

export function createUI(root: HTMLElement, ctx: UICtx): UI {
  const get = () => ctx.state();
  let tab: Tab = 'map';
  let bodyKey = '';
  let live: (() => void)[] = [];
  /** Registers a closure that refreshes live text/disabled state each update(). Runs it once now. */
  const watch = (f: () => void) => {
    live.push(f);
    f();
  };

  // ---- Tutorial state (persisted separately from the save) ----
  let tut: TutorialState = parseTutorial(ctx.tutorial.load(), get());
  const setTut = (t: TutorialState) => {
    if (t === tut) return;
    tut = t;
    ctx.tutorial.save(serializeTutorial(t));
  };

  // ---- HUD ----
  const topbar = el('div', 'topbar');
  const hud = el('div', 'hud');
  const stat = (label: string) => {
    const box = el('div', 'stat');
    const v = el('span', 'value');
    const sub = el('span', 'muted');
    box.append(el('span', 'label', label), v, sub);
    hud.append(box);
    return { box, v, sub };
  };
  const sInk = stat('Ink');
  sInk.box.id = 'ink-counter';
  sInk.box.dataset.fxTarget = 'ink';
  const sRate = stat('Ink/s');
  const sCharts = stat('Charts');
  const sCurv = stat('Curvature');
  const sCod = stat('Charts on Drift');
  // Phone portrait collapses these to the compact row (CSS: .hud:not(.hud-open) .hud-detail).
  sCharts.box.classList.add('hud-detail');
  sCurv.box.classList.add('hud-detail');
  sCod.box.classList.add('hud-detail');
  const goals = el('div', 'goals');
  const goal = el('div', 'goal');
  const goalText = el('span', 'goal-text');
  goalText.setAttribute('aria-live', 'polite');
  goalText.dataset.qa = 'hud-goal';
  // Compact chip for the collapsed phone HUD: a short name, or its glyph when the chip is too narrow (CSS container query).
  // Screen readers get the full sentence from goalText instead.
  const goalShort = el('span', 'goal-short');
  goalShort.setAttribute('aria-hidden', 'true');
  goalShort.dataset.qa = 'hud-goal-short';
  const goalName = el('span', 'goal-name');
  const goalIcon = el('span', 'goal-icon');
  goalShort.append(goalName, goalIcon);
  const goalEta = el('span', 'goal-eta muted');
  const goalFill = el('div', 'fill');
  const goalBar = el('div', 'bar');
  goalBar.append(goalFill);
  goal.append(el('span', 'label', 'Now'), goalText, goalShort, goalEta, goalBar);
  const explain = el('p', 'explain');
  const nextLabel = el('span', 'label');
  const fill = el('div', 'fill');
  const bar = el('div', 'bar');
  bar.append(fill);
  const next = el('div', 'next');
  next.append(nextLabel, bar);
  goals.append(explain, next);
  hud.id = 'hud';
  const hudToggle = el('button', 'hud-toggle');
  hudToggle.type = 'button';
  hudToggle.dataset.qa = 'hud-toggle';
  hudToggle.setAttribute('aria-controls', hud.id);
  const hudSeg = el('div', 'hud-seg');
  hudSeg.dataset.qa = 'hud-seg';
  hudSeg.append(goal, hudToggle);
  let hudOpen = false;
  const setHud = (open: boolean) => {
    hudOpen = open;
    hud.classList.toggle('hud-open', open);
    hudToggle.setAttribute('aria-expanded', String(open));
    hudToggle.setAttribute('aria-label', open ? 'Hide HUD details' : 'Show HUD details');
    hudToggle.textContent = open ? 'Hide details ▴' : '▾';
  };
  hudToggle.onclick = () => setHud(!hudOpen);
  hud.append(goals, hudSeg);
  setHud(false);

  // ---- Palette ----
  const palette = el('div', 'palette');
  palette.setAttribute('role', 'toolbar');
  palette.setAttribute('aria-label', 'Tools');
  const addTool = (t: Tool, key: string, desc: string, tile?: TileType) => {
    const b = help(el('button', 'tool'), `${TOOL_NAME[t]} (${key})`, desc);
    b.type = 'button';
    b.setAttribute('aria-label', `${TOOL_NAME[t]}, key ${key}. ${desc}`);
    const n = el('span', 'name');
    if (tile !== undefined) {
      n.append(paletteDot(tileChipColour(tile)));
    }
    n.append(TOOL_NAME[t]);
    const cost = el('span', 'cost');
    // Letter hotkeys get a "Key X" label and their own class so they can't be mistaken for digit hotkeys (S reads like 5 in small monospace).
    const isLetter = /^[a-z]$/i.test(key);
    const badge = el('span', isLetter ? 'key letter' : 'key', isLetter ? `Key ${key.toUpperCase()}` : key);
    b.append(badge, n, cost);
    b.onclick = () => {
      ctx.tool.current = t;
      update();
    };
    palette.append(b);
    return { t, b, cost };
  };
  const tileBtns: { t: TileType; b: HTMLButtonElement; cost: HTMLElement }[] = TILE_TYPES.map((t, i) => ({
    ...addTool(t, `${i + 1}`, TOOL_HELP[t], t),
    t,
  }));
  const sellBtn = addTool('sell', 'S', TOOL_HELP.sell);
  const pinBtn = addTool('pin', 'P', TOOL_HELP.pin);
  sellBtn.cost.textContent = `${config.sellRefund * 100}% refund`;
  const palHint = el('span', 'palette-scroll-hint', '›');
  palHint.setAttribute('aria-hidden', 'true');
  palette.dataset.qa = 'palette';
  palette.append(palHint);
  palette.addEventListener('scroll', () => palette.classList.add('scrolled'), { passive: true });

  // ---- Panel ----
  const panel = el('div', 'panel');
  panel.id = 'menu-panel';
  panel.dataset.qa = 'panel';
  const toggle = help(btn('Menu', 'panel-toggle', () => setPanel(panel.classList.contains('hidden'))), 'Menu', BUTTON_HELP.menu);
  toggle.setAttribute('aria-controls', panel.id);
  let menuAttSeen = new Set<string>();
  const setPanel = (open: boolean) => {
    panel.classList.toggle('hidden', !open);
    root.classList.toggle('panel-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Close' : 'Menu';
    if (open) menuAttSeen = new Set([...menuAttSeen, ...menuAttention(get()).keys]);
  };
  const openTab = (t: Tab) => {
    tab = t;
    bodyKey = '';
    setPanel(true);
    const att = menuAttention(get());
    for (const k of att.keys) {
      if ((t === 'drift' && k === 'drift-ready') || (t === 'proj' && k === 'proj-ready')
        || (t === 'charts' && (k.startsWith('chart-') || k.startsWith('curv-')))) menuAttSeen.add(k);
    }
    update();
  };
  const head = el('div', 'panel-head');
  head.append(
    el('h2', '', 'Cartographer'),
    help(btn('Close', 'panel-close', () => setPanel(false)), 'Close', 'Close this panel and return to the board.'),
  );
  const tabBar = el('div', 'tabs');
  tabBar.setAttribute('role', 'tablist');
  const tabBtns = new Map<Tab, HTMLButtonElement>();
  for (const [id, label] of TABS) {
    const b = help(btn(label, 'tab', () => openTab(id)), `${label} tab`, TAB_HELP[id]);
    b.setAttribute('role', 'tab');
    b.dataset.qa = `tab-${id}`;
    tabBtns.set(id, b);
    tabBar.append(b);
  }
  const body = el('div', 'panel-body');
  body.setAttribute('role', 'tabpanel');
  panel.append(head, tabBar, body);

  // ---- Guide button (reopens / hides the tutorial) ----
  const guideBtn = help(
    btn('Guide', 'guide-btn', () => setTut(tutVisible() ? dismissTutorial(tut) : reopenTutorial(tut))),
    'Guide',
    BUTTON_HELP.guide,
  );
  const actions = el('div', 'top-actions');
  actions.append(...(ctx.audio ? [help(soundToggle(ctx.audio), 'Sound', BUTTON_HELP.sound)] : []), guideBtn, toggle);
  topbar.append(hud, actions);
  setPanel(!narrow());

  const manifoldBar = el('div', 'manifold-bar hidden');
  manifoldBar.dataset.qa = 'manifold-bar';
  manifoldBar.setAttribute('role', 'toolbar');
  manifoldBar.setAttribute('aria-label', 'Manifold preview');
  const mBtn = (label: string, qaId: string, on: () => void) => {
    const b = btn(label, 'mf-btn', on);
    b.dataset.qa = qaId;
    return b;
  };
  const barSync = () => {
    const mp = ctx.act.manifoldPreview?.() ?? 'off';
    manifoldBar.classList.toggle('hidden', mp === 'off');
    root.classList.toggle('manifold-preview', mp !== 'off');
    if (mp !== 'off') setPanel(false);
    torusBtn.classList.toggle('active', mp === 'torus');
    kleinBtn.classList.toggle('active', mp === 'klein');
    chartBtn.style.display = mp === 'klein' ? 'none' : '';
    immBtn.style.display = mp === 'klein' ? '' : 'none';
    chartBtn.textContent = '2D chart';
    immBtn.textContent = '3D';
  };
  const torusBtn = mBtn('Torus', 'mf-torus', () => ctx.act.switchManifold?.('torus') ?? ctx.act.enterManifoldPreview?.('torus'));
  const kleinBtn = mBtn('Klein', 'mf-klein', () => ctx.act.switchManifold?.('klein') ?? ctx.act.enterManifoldPreview?.('klein'));
  const seamBtn = mBtn('Seams', 'mf-seams', () => ctx.act.toggleSeamView?.());
  const chartBtn = mBtn('2D chart', 'mf-chart', () => ctx.act.toggleSurfaceChart?.());
  const immBtn = mBtn('3D', 'mf-immersion', () => ctx.act.toggleKleinImmersion?.());
  const exitBtn = mBtn('Exit', 'mf-exit', () => ctx.act.exitManifoldPreview?.());
  manifoldBar.append(torusBtn, kleinBtn, seamBtn, chartBtn, immBtn, exitBtn);
  const setManifoldPreview = (on: boolean, surface?: SurfacePreview) => {
    root.classList.toggle('manifold-preview', on);
    manifoldBar.classList.toggle('hidden', !on);
    if (on) {
      setPanel(false);
      torusBtn.classList.toggle('active', surface === 'torus');
      kleinBtn.classList.toggle('active', surface === 'klein');
      chartBtn.style.display = surface === 'klein' ? 'none' : '';
      immBtn.style.display = surface === 'klein' ? '' : 'none';
    }
    barSync();
  };

  // ---- Dock: tutorial card + info / preview card ----
  const dock = el('div', 'dock');
  const tutBox = el('section', 'tutorial hidden');
  tutBox.setAttribute('aria-label', 'Tutorial');
  tutBox.dataset.qa = 'tutorial';
  const tutTitle = el('h3', 'tut-title');
  const tutProg = el('span', 'tut-progress muted');
  const tutBody = el('p', 'tut-body');
  const tutBack = help(btn('Back', '', () => setTut(prevStep(tut))), 'Back', BUTTON_HELP.tutBack);
  const tutNext = help(btn('Next', 'primary', () => {
    setTut(nextStep(tut));
    if (tut.done) toast('Tutorial done. The Guide button brings it back.');
  }), 'Next', BUTTON_HELP.tutNext);
  const tutHide = help(btn('Hide', '', () => setTut(dismissTutorial(tut))), 'Hide', BUTTON_HELP.tutHide);
  const tutActs = el('div', 'row tut-actions');
  tutActs.append(tutBack, tutNext, tutHide);
  tutBox.append(tutProg, tutTitle, tutBody, tutActs);
  const tutVisible = () => !tut.dismissed && !tut.done;

  const info = el('section', 'infocard');
  info.setAttribute('aria-label', 'Selected tool and cell');
  const infoScroll = el('div', 'info-scroll');
  infoScroll.dataset.qa = 'info-scroll';
  const infoText = el('div', 'info-text');
  infoText.dataset.qa = 'info-text';
  const infoScrollHint = el('span', 'info-scroll-hint', '▾');
  infoScrollHint.setAttribute('aria-hidden', 'true');
  infoScroll.append(infoText, infoScrollHint);
  const syncInfoScroll = () => {
    const overflow = infoText.scrollHeight > infoText.clientHeight + 2;
    infoScroll.classList.toggle('has-overflow', overflow);
    const atBottom = infoText.scrollTop + infoText.clientHeight >= infoText.scrollHeight - 2;
    infoScroll.classList.toggle('scrolled-bottom', atBottom || !overflow);
  };
  infoText.addEventListener('scroll', syncInfoScroll, { passive: true });
  const infoScrollSink = (e: Event) => {
    if (e.type === 'pointerdown' || e.type === 'touchstart') e.stopPropagation();
  };
  infoScroll.addEventListener('pointerdown', infoScrollSink);
  infoScroll.addEventListener('touchstart', infoScrollSink, { passive: true });
  const placeBtn = help(btn('Place', 'primary', () => ctx.act.confirmPlace()), 'Place', BUTTON_HELP.place);
  const cancelBtn = help(btn('Cancel', '', () => ctx.act.cancelPlace()), 'Cancel', 'Clear the previewed cell without buying anything.');
  const centreBtn = help(btn('Centre cell', '', () => ctx.act.centreSelected()), 'Bring cell to centre', 'Slides the board so the previewed cell sits at the middle. Zoom and selection stay put.');
  centreBtn.setAttribute('aria-label', 'Bring previewed cell to the centre of the board');
  const infoActs = el('div', 'row info-actions');
  infoActs.append(placeBtn, cancelBtn, centreBtn);
  info.append(infoScroll, infoActs);
  dock.append(tutBox, info);
  dock.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') e.stopPropagation();
  });
  dock.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

  /** Help for the control under keyboard focus or the mouse, shown in the info card. */
  let helpFor: HTMLElement | null = null;
  let hoverHelp = false; // helpFor came from mouse hover (not focus), so it must yield to touch previews
  const helpTarget = (e: Event) => (e.target as HTMLElement | null)?.closest?.('[data-help]') as HTMLElement | null;
  root.addEventListener('focusin', (e) => {
    const t = helpTarget(e);
    if (t?.matches(':focus-visible')) (helpFor = t), (hoverHelp = false), update();
  });
  root.addEventListener('focusout', () => ((helpFor = null), (hoverHelp = false), update()));
  // Hover help only on devices with a real hover pointer, so touch taps never see stale mouse tooltips.
  if (typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches) {
    root.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const t = helpTarget(e);
      if (t !== helpFor) (helpFor = t), (hoverHelp = true), update();
    });
    root.addEventListener('pointerout', (e) => {
      if (e.pointerType !== 'mouse' || !helpFor) return;
      const to = (e.relatedTarget as HTMLElement | null)?.closest?.('[data-help]');
      if (!to || !root.contains(to)) (helpFor = null), (hoverHelp = false), update();
    });
  }
  // Touch/pen input clears any hover-only help so the cell preview and Place controls take over.
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' && hoverHelp) (helpFor = null), (hoverHelp = false), update();
  });

  // ---- Modal ----
  const backdrop = el('div', 'modal-backdrop hidden');
  const modal = el('div', 'modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.dataset.qa = 'modal';
  backdrop.append(modal);
  let opener: HTMLElement | null = null; // focus to restore when the modal closes
  const closeModal = () => {
    if (backdrop.classList.contains('hidden')) return;
    backdrop.classList.add('hidden');
    opener?.focus();
    opener = null;
  };
  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeModal();
  };
  /** Tab stays inside the open modal (simple wrap-around trap). */
  const trapTab = (e: KeyboardEvent) => {
    const f = [...modal.querySelectorAll<HTMLElement>('button, input, textarea, select')].filter((x) => !(x as HTMLButtonElement).disabled);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (e.shiftKey && (a === first || !modal.contains(a))) (e.preventDefault(), last.focus());
    else if (!e.shiftKey && (a === last || !modal.contains(a))) (e.preventDefault(), first.focus());
  };
  const openModal = (heading: string, content: HTMLElement, buttons: HTMLElement[]) => {
    if (backdrop.classList.contains('hidden')) opener = document.activeElement as HTMLElement | null;
    const bodyEl = el('div', 'modal-body');
    bodyEl.dataset.qa = 'modal-body';
    bodyEl.append(content);
    const foot = row(...buttons);
    foot.classList.add('modal-foot');
    foot.dataset.qa = 'modal-foot';
    modal.replaceChildren(el('h2', '', heading), bodyEl, foot);
    backdrop.classList.remove('hidden');
    buttons[0]?.focus();
  };
  const closeBtn = (label = 'Close') => help(btn(label, '', closeModal), label, label === 'Cancel' ? BUTTON_HELP.cancel : BUTTON_HELP.close);
  const showText = (str: string) => {
    const ta = el('textarea');
    ta.value = str;
    ta.readOnly = true;
    ta.setAttribute('aria-label', 'Save string');
    ta.dataset.qa = 'export-text';
    openModal('Save string', ta, [closeBtn()]);
  };
  const openImport = (text = '') => {
    const ta = el('textarea');
    ta.rows = 5;
    ta.value = text;
    ta.placeholder = 'Paste a save string or .json text';
    ta.setAttribute('aria-label', 'Save string');
    ta.dataset.qa = 'import-text';
    const file = el('input');
    file.type = 'file';
    file.accept = '.json,.txt';
    file.setAttribute('aria-label', 'Load save from file');
    file.onchange = async () => {
      const f = file.files?.[0];
      if (f) ta.value = await f.text();
    };
    const msg = el('div');
    msg.dataset.qa = 'import-preview';
    const check = help(btn('Check', '', () => {
      msg.replaceChildren();
      const r = ctx.act.parseImport(ta.value);
      if (!r.ok) {
        const err = el('p', 'neg', r.error);
        err.dataset.qa = 'import-error';
        msg.append(err);
        return;
      }
      const g = r.state;
      msg.append(
        txt(`Ink: ${fmt(g.ink, g.notation)}`),
        txt(`Charts: ${fmt(g.charts, g.notation)}`),
        txt(`Curvature: ${fmt(g.curvature, g.notation)}`),
        txt(`Saved: ${new Date(r.save.savedAt).toLocaleString()}`),
        ctl(btn('Overwrite current save', 'primary', () => {
          ctx.act.applyImport(g);
          closeModal();
          toast('Save imported');
        }), 'Overwrite', BUTTON_HELP.overwrite).box,
      );
    }), 'Check', BUTTON_HELP.check);
    check.dataset.qa = 'import-check';
    const body2 = el('div');
    body2.append(txt(`${BUTTON_HELP.import} Check shows a preview first.`), ta, file, msg);
    openModal('Import save', body2, [check, closeBtn('Cancel')]);
  };
  const openReset = (afterReset: () => void) => {
    const input = el('input');
    input.type = 'text';
    input.placeholder = 'RESET';
    input.setAttribute('aria-label', 'Type RESET to confirm');
    const go = help(btn('Confirm reset', 'danger', () => {
      ctx.act.hardReset();
      afterReset();
      closeModal();
      toast('Progress wiped');
    }), 'Confirm reset', BUTTON_HELP.confirmReset);
    go.disabled = true;
    input.oninput = () => {
      go.disabled = input.value !== 'RESET';
    };
    const content = el('div');
    content.append(txt('This wipes all progress, including Charts, Curvature and milestones. Type RESET to enable Confirm reset.'), input);
    openModal('Hard reset', content, [go, closeBtn('Cancel')]);
    input.focus();
  };
  const resetOpen = () => openReset(() => setTut(restartTutorial()));
  // Drift / Projection go through a confirmation first; the button only opens it.
  // Confirming closes the menu too, so the board transition is visible; the confirmation itself is never skipped.
  const confirmDrift = () => {
    const g = get();
    const why = driftBlocked(g);
    const go = help(btn('Confirm Drift', 'primary', () => {
      closeModal();
      setPanel(false);
      ctx.act.drift();
    }), 'Confirm Drift', BUTTON_HELP.drift);
    go.disabled = why !== null;
    const content = el('div');
    content.append(txt(`Payoff: +${fmt(chartsOnDrift(g), g.notation)} Charts.`));
    if (why) content.append(el('p', 'neg', why));
    content.append(title('Resets'), list('reset', DRIFT_RESETS), title('Keeps'), list('keep', DRIFT_KEEPS));
    openModal('Drift?', content, [closeBtn('Cancel'), go]);
  };
  const confirmProject = () => {
    const g = get();
    const why = projectBlocked(g);
    const go = help(btn('Confirm Projection', 'primary', () => {
      closeModal();
      setPanel(false);
      ctx.act.project();
    }), 'Confirm Projection', BUTTON_HELP.project);
    go.disabled = why !== null;
    const content = el('div');
    content.append(txt(`Payoff: +${fmt(curvatureOnProjection(g), g.notation)} Curvature.`));
    if (why) content.append(el('p', 'neg', why));
    content.append(title('Resets'), list('reset', PROJECTION_RESETS), title('Keeps'), list('keep', PROJECTION_KEEPS));
    openModal('Projection?', content, [closeBtn('Cancel'), go]);
  };

  // ---- Tab bodies (each returns fresh elements; live bits register via watch) ----
  const upgCard = <Id extends string>(
    d: UpgradeDef<Id>,
    unit: string,
    levels: (s: GameState) => Record<Id, number>,
    bank: (s: GameState) => Dec,
    buy: (id: Id) => void,
  ) => {
    const lv = txt('');
    const b = btn('', 'buy', () => buy(d.id));
    const c = ctl(b, d.name, `${d.desc} ${unit === 'Charts' ? BUTTON_HELP.buyChart : BUTTON_HELP.buyCurv}`);
    const box = card(title(d.name), lv, c.box);
    watch(() => {
      const g = get();
      const l = levels(g)[d.id];
      const maxed = l >= d.max;
      const cost = d.cost(l);
      lv.textContent = `Lv ${l}/${d.max}`;
      b.textContent = maxed ? 'Maxed' : `Buy · ${fmt(cost, g.notation)} ${unit}`;
      const why = upgradeBlocked(l, d.max, new Decimal(cost), bank(g), unit, g.notation);
      b.disabled = why !== null;
      c.why(maxed ? null : why);
      box.classList.toggle('done', maxed);
    });
    return box;
  };

  const constellationsTab = (_s: GameState): HTMLElement[] => {
    const intro = card(
      title('Constellations'),
      txt('Place named shapes on the board for Ink bonuses. Gold lines mark a pattern; dashed lines show a hint while you preview.'),
      list('guide-list', [
        `${config.constellations.inkstream.name}: ${config.constellations.inkstream.blurb} (+${config.constellations.inkstream.bonusInk} Ink)`,
        `${config.constellations.millwheel.name}: ${config.constellations.millwheel.blurb} (+${config.constellations.millwheel.bonusInk} Ink)`,
        `${config.constellations.twinmills.name}: ${config.constellations.twinmills.blurb} (+${config.constellations.twinmills.bonusInk} Ink)`,
      ]),
    );
    const logCard = card(title('Completed this journey'));
    const logList = el('ul', 'guide-list');
    logCard.append(logList);
    watch(() => {
      const g = get();
      logList.replaceChildren();
      if (!g.constellationLog.length) {
        logList.append(el('li', 'muted', 'None yet — complete a pattern on the board.'));
        return;
      }
      for (const row of [...g.constellationLog].reverse().slice(0, 24)) {
        logList.append(el('li', '', `${CONST_NAMES[row.id]} · +${fmt(row.bonusInk, g.notation)} Ink`));
      }
    });
    return [intro, logCard];
  };

  const mapTab = (s: GameState): HTMLElement[] => {
    const full = s.ring >= maxRing(s);
    const sb = btn('', 'buy', () => ctx.act.survey());
    const sc = ctl(sb, 'Survey', BUTTON_HELP.survey);
    watch(() => {
      const g = get();
      sb.textContent = `Survey · ${fmt(surveyCost(g), g.notation)}`;
      const why = surveyBlocked(g);
      sb.disabled = why !== null;
      const r = prod(g).total;
      const eta = why && g.ring < maxRing(g) && r > 0 ? ` (~${fmtTime(surveyCost(g).sub(g.ink).toNumber() / r)})` : '';
      sc.why(why && why + eta);
    });
    const survey = card(
      title(full ? 'Survey complete' : `Survey ring ${s.ring + 1}`),
      txt(full ? 'Every ring is surveyed.' : `Adds ${cellsInRing(s, s.ring + 1)} cells to the board. ${SURVEY_EXPLAIN}`),
      ...(autoSurveyOn(s) ? [txt('Auto-Survey is on.')] : []),
      sc.box,
    );
    const boardP = txt('');
    watch(() => {
      const g = get();
      const active = g.tiles.filter((_, i) => isActive(g, i)).length;
      const placed = g.tiles.filter((t) => t).length;
      const geo = g.geometry === 'square' ? 'Square grid' : 'Hyperbolic {7,3}';
      boardP.textContent = `${geo}: ${active} active cells, ${placed} tiles placed, ${g.pinned.length}/${maxPins(g)} pins.`;
    });
    const board = card(title('Board'), boardP, ctl(btn('Recenter view', '', () => ctx.act.recenter()), 'Recenter view', BUTTON_HELP.recenter).box);
    const how = card(
      title('Controls'),
      list('guide-list', [
        'Mouse: click a cell to use the tool at once; hover shows cost and Ink/s change.',
        'Touch: tap a cell to preview it, then tap it again or press Place to buy.',
        'Drag to pan, pinch or scroll to zoom, right-drag to tilt. Dragging never buys.',
      ]),
    );
    return [survey, board, how];
  };

  const driftTab = (s: GameState): HTMLElement[] => {
    const stats = txt('');
    const dbtn = btn('', 'primary', confirmDrift);
    const dc = ctl(dbtn, 'Drift', BUTTON_HELP.drift);
    watch(() => {
      const g = get();
      const cod = chartsOnDrift(g);
      const perMin = g.runTime > 0 ? cod.toNumber() / (g.runTime / 60) : 0;
      stats.textContent = `Charts on drift: ${fmt(cod, g.notation)} (${fmt(perMin, g.notation)}/min). Run Ink: ${fmt(g.runInk, g.notation)}.`;
      dbtn.textContent = `Drift for ${fmt(cod, g.notation)} Charts`;
      const why = driftBlocked(g);
      dbtn.disabled = why !== null;
      dc.why(why);
    });
    const out = [
      card(title('Drift'), txt(DRIFT_EXPLAIN), stats, dc.box),
      card(title('Drift resets'), list('reset', DRIFT_RESETS), title('Drift keeps'), list('keep', DRIFT_KEEPS)),
    ];
    if (has(s, 'autoDrift')) {
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = s.autoDrift.on;
      cb.onchange = () => {
        get().autoDrift.on = cb.checked;
      };
      const at = el('input');
      at.type = 'number';
      at.min = '1';
      at.value = String(s.autoDrift.at);
      at.setAttribute('aria-label', 'Auto-Drift Charts threshold');
      at.onchange = () => {
        get().autoDrift.at = Math.max(1, Number(at.value) || 1);
      };
      const lab = el('label', 'check');
      lab.append(cb, ' Auto-Drift at ', at, ' Charts');
      out.push(card(title('Auto-Drift'), lab, el('p', 'help', BUTTON_HELP.autoDrift)));
    }
    return out;
  };

  const chartsTab = (s: GameState): HTMLElement[] =>
    s.drifts === 0
      ? [card(title('Locked until your first Drift'), txt(`Drift (at ${fmt(config.drift.minInk)} run Ink) to earn Charts. Charts buy permanent upgrades that survive every Drift.`))]
      : chartUpgrades.map((d) => upgCard(d, 'Charts', (g) => g.chartUpg, (g) => g.charts, (id) => ctx.act.buyChart(id)));

  const projTab = (s: GameState): HTMLElement[] => {
    const cmp = projectionCompare();
    const box = (head: string, n: number, mill: number) => {
      const b = el('div', 'box');
      b.append(head, el('span', 'big', `${n}`), 'neighbours per cell', el('br'), `Mill up to ${fmt(mill)} Ink/s`);
      return b;
    };
    const compare = el('div', 'compare');
    compare.append(box('Square (now)', cmp.square.neighbours, cmp.square.millMax), box('Hyperbolic {7,3}', cmp.hyper.neighbours, cmp.hyper.millMax));
    const req = txt('');
    const curvP = txt('');
    const pb = btn('', 'primary', confirmProject);
    const pc = ctl(pb, 'Project', BUTTON_HELP.project);
    watch(() => {
      const g = get();
      req.textContent = `Requires ${config.projection.minCharts} Charts this cycle (${fmt(g.cycleCharts, g.notation)}/${config.projection.minCharts}).`;
      curvP.textContent = `Curvature on projection: ${fmt(curvatureOnProjection(g), g.notation)}.`;
      pb.textContent = `Project for ${fmt(curvatureOnProjection(g), g.notation)} Curvature`;
      const why = projectBlocked(g);
      pb.disabled = why !== null;
      pc.why(why);
    });
    const lead = s.projections > 0 || canProject(s) ? 'Projection' : 'Projection (locked)';
    const out = [
      card(title(lead), compare, list('guide-list', cmp.lines), req, curvP, pc.box),
      card(title('Projection resets'), list('reset', PROJECTION_RESETS), title('Projection keeps'), list('keep', PROJECTION_KEEPS)),
    ];
    if (s.projections > 0 || s.curvature.gt(0))
      out.push(...curvUpgrades.map((d) => upgCard(d, 'Curvature', (g) => g.curvUpg, (g) => g.curvature, (id) => ctx.act.buyCurv(id))));
    const mp = ctx.act.manifoldPreview?.() ?? 'off';
    const prev = card(
      title('Manifold preview (locked)'),
      txt('Layer 3 surfaces: orbit a 3D torus or study the Klein bottle fundamental square with coloured seams. Controls move to a floating bar on the board. No Handles currency or Loops scoring yet.'),
    );
    const row = el('div', 'row');
    const torusB = btn(mp === 'torus' ? 'Torus (active)' : 'Open torus preview', mp === 'torus' ? 'primary' : '', () => ctx.act.enterManifoldPreview?.('torus'));
    const kleinB = btn(mp === 'klein' ? 'Klein (active)' : 'Open Klein preview', mp === 'klein' ? 'primary' : '', () => ctx.act.enterManifoldPreview?.('klein'));
    torusB.dataset.qa = 'open-torus-preview';
    kleinB.dataset.qa = 'open-klein-preview';
    row.append(torusB, kleinB);
    prev.append(row);
    if (mp !== 'off') prev.append(txt('Preview is open — use the floating toolbar on the board.'));
    out.push(prev);
    return out;
  };

  const milesTab = (s: GameState): HTMLElement[] => [
    txt(`Drifts: ${s.drifts} · Projections: ${s.projections}`),
    ...MILESTONES.map((m) => {
      const c = card(title(m.name), txt(m.desc));
      c.classList.add(m.req(s) ? 'done' : 'locked');
      return c;
    }),
  ];

  const saveTab = (s: GameState): HTMLElement[] => {
    const copy = btn('Copy save string', '', async () => {
      const str = ctx.act.exportString();
      try {
        await navigator.clipboard.writeText(str);
        toast('Copied');
      } catch {
        showText(str);
      }
    });
    const view = btn('View save string', '', () => showText(ctx.act.exportString()));
    const notation = el('select');
    notation.append(new Option('Suffix (1.23M)', 'suffix'), new Option('Scientific (1.23e6)', 'sci'));
    notation.value = s.notation;
    notation.onchange = () => {
      get().notation = notation.value === 'sci' ? 'sci' : 'suffix';
    };
    const nl = el('label', '', 'Notation ');
    nl.append(notation);
    return [
      ...(ctx.audio ? [soundCard(ctx.audio)] : []),
      card(
        title('Save'),
        txt('The game autosaves every 10 seconds and when you leave. Export a copy to move or back up progress.'),
        ctl(copy, 'Copy save string', BUTTON_HELP.copy).box,
        ctl(view, 'View save string', 'Show the save string in a box you can select and copy by hand.').box,
        ctl(btn('Download file', '', () => ctx.act.exportFile()), 'Download file', BUTTON_HELP.download).box,
        ctl(btn('Import…', '', () => openImport()), 'Import', BUTTON_HELP.import).box,
      ),
      card(title('Display'), nl, el('p', 'help', BUTTON_HELP.notation)),
      ...(ctx.audio ? [creditsCard()] : []),
      card(title('Hard reset'), ctl(btn('Hard reset', 'danger', resetOpen), 'Hard reset', BUTTON_HELP.reset).box),
    ];
  };

  const guideTab = (): HTMLElement[] => {
    const tutState = txt('');
    watch(() => {
      tutState.textContent = tut.done ? 'Tutorial finished.' : `Tutorial step ${tut.step + 1} of ${STEPS.length}${tut.dismissed ? ' (hidden)' : ''}.`;
    });
    const show = ctl(btn('Show tutorial', 'primary', () => {
      setTut(reopenTutorial(tut));
      if (narrow()) setPanel(false);
    }), 'Show tutorial', 'Show the tutorial card above the tools, at the step you reached.');
    const restart = ctl(btn('Restart tutorial', '', () => {
      setTut(restartTutorial());
      if (narrow()) setPanel(false);
    }), 'Restart tutorial', BUTTON_HELP.tutRestart);
    const named = (items: [string, string][]) => {
      const u = el('ul', 'guide-list');
      for (const [n, d] of items) {
        const li = el('li');
        li.append(el('b', '', `${n}: `), d);
        u.append(li);
      }
      return u;
    };
    return [
      card(title('Tutorial'), tutState, show.box, restart.box),
      card(
        title('Goals'),
        txt('The top bar always shows "Now", your next concrete step, a live line about what your board is doing, and the next big unlock with its progress bar.'),
      ),
      card(title('Tools'), named([...TILE_TYPES.map((t, i) => [`${TILE_INFO[t].name} (${i + 1})`, TOOL_HELP[t]] as [string, string]), ['Sell (S)', TOOL_HELP.sell], ['Pin (P)', TOOL_HELP.pin]])),
      card(title('Survey'), txt(SURVEY_EXPLAIN)),
      card(title('Drift'), txt(DRIFT_EXPLAIN), list('reset', DRIFT_RESETS), list('keep', DRIFT_KEEPS)),
      card(title('Projection'), list('guide-list', projectionCompare().lines)),
      card(
        title('Buttons'),
        named([
          ['Guide', BUTTON_HELP.guide], ['Menu / Close', BUTTON_HELP.menu], ['Place', BUTTON_HELP.place],
          ['Cancel', 'Clear the previewed cell without buying anything.'],
          ['Next / Back / Hide', `${BUTTON_HELP.tutNext} ${BUTTON_HELP.tutBack} ${BUTTON_HELP.tutHide}`],
          ['Survey', BUTTON_HELP.survey], ['Recenter view', BUTTON_HELP.recenter], ['Drift', BUTTON_HELP.drift], ['Project', BUTTON_HELP.project],
          ['Buy (upgrades)', `${BUTTON_HELP.buyChart} ${BUTTON_HELP.buyCurv}`], ['Copy / Download / Import', `${BUTTON_HELP.copy} ${BUTTON_HELP.download} ${BUTTON_HELP.import}`],
          ['Hard reset', BUTTON_HELP.reset],
          ['Greyed-out buttons', 'A red line under a disabled button says exactly what is missing.'],
        ]),
      ),
      card(title('Keyboard'), txt('1-5 pick tiles, S Sell, P Pin, Esc cancels a preview or closes a window. Tab moves between buttons; focused buttons show their help in the card above the tools.')),
    ];
  };

  const tabs: Record<Tab, (s: GameState) => HTMLElement[]> = {
    map: mapTab, constellations: constellationsTab, drift: driftTab, charts: chartsTab, proj: projTab, miles: milesTab, save: saveTab, guide: guideTab,
  };

  // ---- Tooltip / toast / flash ----
  const tip = el('div', 'tooltip');
  tip.style.display = 'none';
  const tooltip = (x: number, y: number, html: string | null) => {
    if (html === null) {
      tip.style.display = 'none';
      return;
    }
    tip.innerHTML = html;
    tip.style.display = 'block';
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(x + 14, window.innerWidth - w - 8))}px`;
    tip.style.top = `${Math.max(8, Math.min(y + 14, window.innerHeight - h - 8))}px`;
  };
  const boardGain = el('div', 'board-gain-label hidden');
  boardGain.setAttribute('aria-hidden', 'true');
  const flowLabelRoot = el('div', 'flow-rate-labels');
  flowLabelRoot.setAttribute('aria-hidden', 'true');
  const toastEl = el('div', 'toast');
  toastEl.setAttribute('role', 'status');
  let toastTimer = 0;
  const toast = (msg: string) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2000);
  };
  const flash = () => {
    const f = el('div', 'flash');
    document.body.append(f);
    setTimeout(() => f.remove(), 1300);
  };
  // HUD Ink pulse when GPU motes land: visual only, rate-limited, restarts the CSS animation without reflow churn
  let bumpAt = 0;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const bumpInk = (weight: number) => {
    const now = performance.now();
    if (reduceMotion.matches || now - bumpAt < 140) return;
    bumpAt = now;
    const b = sInk.box;
    b.style.setProperty('--bump', String(Math.min(1, 0.35 + 0.15 * weight)));
    b.classList.remove('ink-bump');
    requestAnimationFrame(() => b.classList.add('ink-bump'));
  };
  let transitionText: string | null = null;
  let transitionShort = '';
  let transitionIcon: GoalIcon = 'project';
  const setTransition = (t: string | null, short = '', icon: GoalIcon = 'project') => (
    (transitionText = t), (transitionShort = short || 'Mapping'), (transitionIcon = icon), update()
  );
  const showOffline = (r: OfflineReport) => {
    if (r.seconds < 10) return;
    const content = el('div');
    content.append(txt(`Away for ${fmtTime(r.seconds)}.`), txt(`Ink gained: ${fmt(r.ink)}`), txt(`Efficiency: ${Math.round(r.eff * 100)}%`));
    if (r.drifts > 0) content.append(txt(`Drifts: ${r.drifts}`));
    content.dataset.qa = 'offline';
    openModal('While you were away', content, [help(btn('OK', 'primary', closeModal), 'OK', BUTTON_HELP.close)]);
  };

  // ---- Dev panel ----
  const dev = el('div', 'dev hidden');
  if (ctx.dev) {
    const g = (label: string, f: () => void) => help(btn(label, '', f), label, 'Dev/QA cheat; not part of normal play.');
    dev.append(
      g('+1e3 Ink', () => ctx.act.grant('ink', 1e3)),
      g('+1e6 Ink', () => ctx.act.grant('ink', 1e6)),
      g('+1e9 Ink', () => ctx.act.grant('ink', 1e9)),
      g('+5 Charts', () => ctx.act.grant('charts', 5)),
      g('+25 Charts', () => ctx.act.grant('charts', 25)),
      g('+5 Curvature', () => ctx.act.grant('curvature', 5)),
      g('x1', () => ctx.act.setSpeed(1)),
      g('x10', () => ctx.act.setSpeed(10)),
      g('x100', () => ctx.act.setSpeed(100)),
      g('Jump to Drift', () => ctx.act.grant('ink', 1e6)),
      g('Jump to Projection', () => ctx.act.grant('charts', 25)),
    );
  }

  // ---- Update ----
  let infoHtml = '';
  const setInfo = (html: string) => {
    if (html !== infoHtml) infoText.innerHTML = infoHtml = html;
    requestAnimationFrame(() => requestAnimationFrame(syncInfoScroll));
  };
  function updateDock(s: GameState) {
    // Tutorial card
    setTut(syncTutorial(tut, s));
    const step = currentStep(tut);
    const boardFocus = ctx.selected() >= 0 || ctx.inspectCell() >= 0;
    tutBox.classList.toggle('hidden', !tutVisible() || !step || boardFocus);
    guideBtn.classList.toggle('attention', !tutVisible() && !tut.done);
    guideBtn.setAttribute('aria-pressed', String(tutVisible()));
    const att = menuAttention(s);
    const menuDot = att.menu && !attentionCleared(menuAttSeen, att);
    toggle.classList.toggle('attention', menuDot);
    toggle.classList.toggle('attention-pulse', menuDot);
    for (const [id, btn] of tabBtns) btn.classList.toggle('tab-attention', !!att.tabs[id] && tab !== id);
    if (step && tutVisible()) {
      tutProg.textContent = `Tutorial ${tut.step + 1}/${STEPS.length}`;
      tutTitle.textContent = step.title;
      const b = step.body(s);
      if (tutBody.textContent !== b) tutBody.textContent = b;
      tutBack.hidden = tut.step === 0;
      tutNext.hidden = !step.manual;
      tutNext.textContent = tut.step === STEPS.length - 1 ? 'Finish' : 'Next';
    }
    const hint = step && tutVisible() ? step.tool : undefined;
    for (const x of tileBtns) x.b.classList.toggle('hint', x.t === hint && ctx.tool.current !== hint);

    // Info card: focused/hovered control help > touch cell preview > selected tool
    const sel = ctx.selected();
    const tl = ctx.tool.current;
    // A selected touch cell beats stale hover help; keyboard/focus help still wins.
    if (helpFor?.isConnected && !(hoverHelp && sel >= 0)) {
      setInfo(`<b>${escape(helpFor.dataset.helpName ?? '')}</b> · ${escape(helpFor.dataset.help ?? '')}${helpFor.matches(':disabled') ? ' <span class="neg">(unavailable now; see the red note)</span>' : ''}`);
      infoActs.hidden = true;
    } else if (sel >= 0) {
      const far = s.geometry === 'hyper' ? '<div class="info-note muted">Edge cells shrink. Drag closer or centre this cell.</div>' : '';
      setInfo(ctx.cellInfo(sel) + far);
      const why = placeBlocked(s, sel, tl);
      placeBtn.disabled = why !== null;
      placeBtn.textContent = tl === 'sell' ? 'Sell' : tl === 'pin' ? (s.pinned.includes(sel) ? 'Unpin' : 'Pin') : `Place ${TOOL_NAME[tl]}`;
      centreBtn.hidden = s.geometry !== 'hyper';
      infoActs.hidden = false;
    } else {
      const isTile = tl !== 'sell' && tl !== 'pin';
      const cost = isTile ? tileCost(s, tl) : null;
      const need = cost && s.ink.lt(cost) ? `<div class="info-note neg">Need ${fmt(cost.sub(s.ink), s.notation)} more Ink.</div>` : '';
      const hyperHint = s.geometry === 'hyper' ? ' Drag the board to bring far cells closer.' : '';
      const meta = cost ? `${fmt(cost, s.notation)} Ink` : 'Select a tile';
      setInfo(
        `<div class="info-lead"><b>${TOOL_NAME[tl]}</b></div><div class="info-meta">${meta}</div><div class="info-effect">${escape(TOOL_EFFECT[tl])}</div><div class="info-note muted">Tap a cell to preview; tap again to confirm.${hyperHint}</div><div class="info-detail muted">${escape(TOOL_HELP[tl])}</div>${need}`,
      );
      infoActs.hidden = true;
    }
    syncBridgeGainLabel();
    syncFlowRateLabels();
  }

  const flowLabelPool: HTMLDivElement[] = [];
  function syncFlowRateLabels() {
    const labels = ctx.flowRateLabels?.() ?? [];
    while (flowLabelPool.length < labels.length) {
      const n = el('div', 'flow-rate-label hidden');
      flowLabelRoot.append(n);
      flowLabelPool.push(n);
    }
    for (let i = 0; i < flowLabelPool.length; i++) {
      const node = flowLabelPool[i];
      const L = labels[i];
      if (!L) {
        node.classList.add('hidden');
        continue;
      }
      node.textContent = L.text;
      node.style.left = `${Math.round(L.x)}px`;
      node.style.top = `${Math.round(L.y)}px`;
      node.classList.remove('hidden');
    }
  }

  function syncBridgeGainLabel() {
    const s = get();
    const sel = ctx.selected();
    const tl = ctx.tool.current;
    const focus = ctx.boardFocus?.() ?? (sel >= 0 ? sel : -1);
    const previewInk = ctx.bridgePreviewDelta?.() ?? null;
    const pos = focus >= 0 ? ctx.cellScreenPos?.(focus) ?? null : null;
    const surf = ctx.act.manifoldPreview?.();
    const bridgeOn = tl === 'bridge';
    if (previewInk != null && focus >= 0 && pos && bridgeOn && (!surf || surf === 'off')) {
      boardGain.textContent = `+${fmt(previewInk, s.notation)} Ink/s`;
      boardGain.style.left = `${Math.round(pos.x)}px`;
      boardGain.style.top = `${Math.round(pos.y - 40)}px`;
      boardGain.classList.remove('hidden');
    } else boardGain.classList.add('hidden');
  }

  function update() {
    const s = get();
    sInk.v.textContent = fmt(s.ink, s.notation);
    sRate.v.textContent = fmt(prod(s).total, s.notation);
    sCharts.box.style.display = s.drifts > 0 || s.charts.gt(0) ? '' : 'none';
    sCharts.v.textContent = fmt(s.charts, s.notation);
    sCurv.box.style.display = s.projections > 0 ? '' : 'none';
    sCurv.v.textContent = fmt(s.curvature, s.notation);
    const cod = chartsOnDrift(s);
    sCod.v.textContent = fmt(cod, s.notation);
    sCod.sub.textContent = `${fmt(s.runTime > 0 ? cod.toNumber() / (s.runTime / 60) : 0, s.notation)}/min`;
    const g = transitionText
      ? { text: transitionText, short: transitionShort, icon: transitionIcon, eta: '', progress: 0 }
      : immediateGoal(s);
    if (goalText.textContent !== g.text) goalText.textContent = g.text;
    if (goalName.textContent !== g.short) goalName.textContent = g.short;
    if (goalIcon.dataset.icon !== g.icon) {
      goalIcon.dataset.icon = g.icon;
      goalIcon.innerHTML = `<svg viewBox="0 0 24 24" focusable="false">${GOAL_ICON_SVG[g.icon]}</svg>`;
    }
    goal.title = g.text;
    goalEta.textContent = g.eta;
    goalFill.style.width = `${Math.round(clamp(g.progress) * 100)}%`;
    explain.textContent = explainNow(s);
    const [label, p] = longGoal(s);
    nextLabel.textContent = `Next unlock: ${label}`;
    fill.style.width = `${Math.round(clamp(p) * 100)}%`;

    for (const x of tileBtns) {
      const c = tileCost(s, x.t);
      x.cost.textContent = fmt(c, s.notation);
      x.b.classList.toggle('cant', s.ink.lt(c));
      x.b.classList.toggle('active', ctx.tool.current === x.t);
      x.b.setAttribute('aria-pressed', String(ctx.tool.current === x.t));
    }
    for (const x of [sellBtn, pinBtn]) {
      x.b.classList.toggle('active', ctx.tool.current === x.t);
      x.b.setAttribute('aria-pressed', String(ctx.tool.current === x.t));
    }
    pinBtn.cost.textContent = `${s.pinned.length}/${maxPins(s)}`;

    for (const [id, b] of tabBtns) {
      b.classList.toggle('active', id === tab);
      b.setAttribute('aria-selected', String(id === tab));
    }
    tabBtns.get('charts')!.classList.toggle('locked', s.drifts === 0);
    tabBtns.get('proj')!.classList.toggle('locked', !(canProject(s) || s.projections > 0));

    const key = [
      tab, s.drifts, s.projections, s.ring, s.geometry, s.curvature.gt(0), canProject(s), autoSurveyOn(s),
      JSON.stringify(s.chartUpg), JSON.stringify(s.curvUpg), MILESTONES.map((m) => (m.req(s) ? 1 : 0)).join(''),
    ].join('|');
    if (key !== bodyKey) {
      bodyKey = key;
      live = [];
      body.replaceChildren(el('p', 'help', TAB_HELP[tab]), ...tabs[tab](s));
    }
    for (const f of live) f();
    updateDock(s);
  }

  // ---- Keyboard ----
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !backdrop.classList.contains('hidden')) return trapTab(e);
    if (e.key === 'Escape') {
      if (!backdrop.classList.contains('hidden')) closeModal();
      else if (ctx.selected() >= 0) ctx.act.cancelPlace();
      else if (narrow() && !panel.classList.contains('hidden')) setPanel(false);
      update();
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!backdrop.classList.contains('hidden')) return;
    if (e.key === '`') {
      if (ctx.dev) dev.classList.toggle('hidden');
      return;
    }
    const k = e.key.toLowerCase();
    const n = Number(k);
    if (Number.isInteger(n) && n >= 1 && n <= TILE_TYPES.length) ctx.tool.current = TILE_TYPES[n - 1];
    else if (k === 's') ctx.tool.current = 'sell';
    else if (k === 'p') ctx.tool.current = 'pin';
    else return;
    update();
  });

  // ---- Mount ----
  root.append(topbar, panel, dock, palette, manifoldBar, tip, toastEl, dev, backdrop);
  document.body.append(boardGain, flowLabelRoot);
  update();
  return {
    update, syncBridgeGain: syncBridgeGainLabel, syncFlowLabels: syncFlowRateLabels, tooltip, showOffline, toast, flash, bumpInk, setTransition, setManifoldPreview,
    qa: {
      tab: (id: string) => tabBtns.has(id as Tab) && openTab(id as Tab),
      openImport: (text?: string) => openImport(text),
      checkImport: () => modal.querySelector<HTMLButtonElement>('[data-qa="import-check"]')?.click(),
      showExport: () => showText(ctx.act.exportString()),
      openReset: resetOpen,
      confirmDrift,
      confirmProject,
      closeModal,
      modalOpen: () => !backdrop.classList.contains('hidden'),
      /** Re-reads the tutorial from storage (QA fixtures write it directly). */
      reloadTutorial: () => ((tut = parseTutorial(ctx.tutorial.load(), get())), update()),
      hud: (open?: boolean) => {
        if (open !== undefined) setHud(open);
        return hudOpen;
      },
      menu: (open?: boolean) => {
        if (open !== undefined) setPanel(open);
        return !panel.classList.contains('hidden');
      },
    },
  };
}

const escape = (str: string) => str.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
