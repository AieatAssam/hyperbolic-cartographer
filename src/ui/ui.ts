import type { GameState } from '../core/state';
import { TILE_INFO, TILE_TYPES, type TileType } from '../core/tiles';
import type { ImportResult } from '../core/save';
import type { OfflineReport } from '../core/tick';
import { autoSurveyOn } from '../core/tick';
import { config, chartUpgrades, curvUpgrades, type ChartUpgradeId, type CurvUpgradeId, type UpgradeDef } from '../core/config';
import { MILESTONES, has } from '../core/milestones';
import { canDrift, canProject, chartsOnDrift, curvatureOnProjection } from '../core/prestige';
import { cellsInRing, isActive, maxPins, maxRing, prod, surveyCost, tileCost } from '../core/economy';
import { fmt, fmtTime } from './format';

export type Tool = TileType | 'sell' | 'pin';
export interface UICtx {
  state: () => GameState; // live mutable state object (may be replaced after import/reset, so always call it)
  tool: { current: Tool };
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
  };
  dev: boolean;
}
export interface UI {
  update(): void; // called ~10x per second; cheap. Rebuilds panel body only on tab/state-key change.
  tooltip(x: number, y: number, html: string | null): void; // null hides
  showOffline(r: OfflineReport): void;
  toast(msg: string): void;
  flash(): void;
}

type Dec = GameState['ink'];
type Tab = 'map' | 'drift' | 'charts' | 'proj' | 'miles' | 'save';
const TABS: [Tab, string][] = [
  ['map', 'Map'], ['drift', 'Drift'], ['charts', 'Charts'], ['proj', 'Projection'], ['miles', 'Milestones'], ['save', 'Save'],
];

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
const btn = (label: string, cls: string, onclick: () => void) => {
  const b = el('button', cls, label);
  b.onclick = onclick;
  return b;
};
const clamp = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Next unlock label and its progress (0..1). */
const nextGoal = (s: GameState): [string, number] => {
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

  // ---- HUD ----
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
  const sRate = stat('Ink/s');
  const sCharts = stat('Charts');
  const sCurv = stat('Curvature');
  const sCod = stat('Charts on Drift');
  const nextLabel = el('span', 'label');
  const fill = el('div', 'fill');
  const bar = el('div', 'bar');
  bar.append(fill);
  const next = el('div', 'next');
  next.append(nextLabel, bar);
  hud.append(next);

  // ---- Palette ----
  const palette = el('div', 'palette');
  const addTool = (t: Tool, key: string, name: string, desc: string, color?: number) => {
    const b = el('button', 'tool');
    b.title = desc;
    const n = el('span', 'name');
    if (color !== undefined) {
      const dot = el('span');
      dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:${hex(color)}`;
      n.append(dot);
    }
    n.append(name);
    const cost = el('span', 'cost');
    b.append(el('span', 'key', key), n, cost);
    b.onclick = () => {
      ctx.tool.current = t;
    };
    palette.append(b);
    return { t, b, cost };
  };
  const tileBtns: { t: TileType; b: HTMLButtonElement; cost: HTMLElement }[] = TILE_TYPES.map((t, i) => ({
    ...addTool(t, `${i + 1}`, TILE_INFO[t].name, TILE_INFO[t].desc, TILE_INFO[t].color),
    t,
  }));
  const sellBtn = addTool('sell', 'S', 'Sell', `Remove a tile for a ${config.sellRefund * 100}% refund.`);
  const pinBtn = addTool('pin', 'P', 'Pin', 'Pinned tiles survive Drift.');
  sellBtn.cost.textContent = `${config.sellRefund * 100}% refund`;

  // ---- Panel ----
  const panel = el('div', innerWidth < 700 ? 'panel hidden' : 'panel');
  const tabBar = el('div', 'tabs');
  const tabBtns = new Map<Tab, HTMLButtonElement>();
  for (const [id, label] of TABS) {
    const b = el('button', 'tab', label);
    b.onclick = () => {
      tab = id;
      bodyKey = '';
      update();
    };
    tabBtns.set(id, b);
    tabBar.append(b);
  }
  const body = el('div');
  panel.append(tabBar, body);
  const toggle = btn('☰', 'panel-toggle', () => panel.classList.toggle('hidden'));

  // ---- Modal ----
  const backdrop = el('div', 'modal-backdrop hidden');
  const modal = el('div', 'modal');
  backdrop.append(modal);
  const closeModal = () => backdrop.classList.add('hidden');
  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeModal();
  };
  const openModal = (heading: string, content: HTMLElement, buttons: HTMLElement[]) => {
    modal.replaceChildren(el('h2', '', heading), content, row(...buttons));
    backdrop.classList.remove('hidden');
  };
  const showText = (str: string) => {
    const ta = el('textarea');
    ta.value = str;
    ta.readOnly = true;
    openModal('Save string', ta, [btn('Close', '', closeModal)]);
  };
  const openImport = () => {
    const ta = el('textarea');
    ta.rows = 5;
    ta.placeholder = 'Paste a save string or .json text';
    const file = el('input');
    file.type = 'file';
    file.accept = '.json,.txt';
    file.onchange = async () => {
      const f = file.files?.[0];
      if (f) ta.value = await f.text();
    };
    const msg = el('div');
    const check = btn('Check', '', () => {
      msg.replaceChildren();
      const r = ctx.act.parseImport(ta.value);
      if (!r.ok) {
        msg.append(el('p', 'neg', r.error));
        return;
      }
      const g = r.state;
      msg.append(
        txt(`Ink: ${fmt(g.ink, g.notation)}`),
        txt(`Charts: ${fmt(g.charts, g.notation)}`),
        txt(`Curvature: ${fmt(g.curvature, g.notation)}`),
        txt(`Saved: ${new Date(r.save.savedAt).toLocaleString()}`),
        btn('Overwrite current save', 'primary', () => {
          ctx.act.applyImport(g);
          closeModal();
          toast('Save imported');
        }),
      );
    });
    const body2 = el('div');
    body2.append(ta, file, msg);
    openModal('Import save', body2, [check, btn('Cancel', '', closeModal)]);
  };
  const openReset = () => {
    const input = el('input');
    input.type = 'text';
    input.placeholder = 'RESET';
    const go = btn('Confirm reset', 'danger', () => {
      ctx.act.hardReset();
      closeModal();
      toast('Progress wiped');
    });
    go.disabled = true;
    input.oninput = () => {
      go.disabled = input.value !== 'RESET';
    };
    const content = el('div');
    content.append(txt('This wipes all progress, including Charts, Curvature and milestones. Type RESET to confirm.'), input);
    openModal('Hard reset', content, [go, btn('Cancel', '', closeModal)]);
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
    const c = card(title(d.name), txt(d.desc), lv, b);
    watch(() => {
      const g = get();
      const l = levels(g)[d.id];
      const maxed = l >= d.max;
      const cost = d.cost(l);
      lv.textContent = `Lv ${l}/${d.max}`;
      b.textContent = maxed ? 'Maxed' : `Buy · ${fmt(cost, g.notation)} ${unit}`;
      b.disabled = maxed || bank(g).lt(cost);
      c.classList.toggle('done', maxed);
    });
    return c;
  };

  const mapTab = (s: GameState): HTMLElement[] => {
    const full = s.ring >= maxRing(s);
    const sb = btn('', 'buy', () => ctx.act.survey());
    watch(() => {
      const g = get();
      sb.textContent = `Survey · ${fmt(surveyCost(g), g.notation)}`;
      sb.disabled = g.ring >= maxRing(g) || g.ink.lt(surveyCost(g));
    });
    const survey = card(
      title(full ? 'Survey complete' : `Survey ring ${s.ring + 1}`),
      txt(full ? 'Every ring is surveyed.' : `Adds ${cellsInRing(s, s.ring + 1)} cells to the board.`),
      ...(autoSurveyOn(s) ? [txt('Auto-Survey is on.')] : []),
      sb,
    );
    const boardP = txt('');
    watch(() => {
      const g = get();
      const active = g.tiles.filter((_, i) => isActive(g, i)).length;
      const placed = g.tiles.filter((t) => t).length;
      const geo = g.geometry === 'square' ? 'Square grid' : 'Hyperbolic {7,3}';
      boardP.textContent = `${geo}: ${active} active cells, ${placed} tiles placed, ${g.pinned.length}/${maxPins(g)} pins.`;
    });
    const board = card(title('Board'), boardP, btn('Recenter view', '', () => ctx.act.recenter()));
    return [survey, board, txt('Click a cell to place the selected tile. Hover shows the Ink/s change. Drag to pan, right-drag to tilt, scroll to zoom.')];
  };

  const driftTab = (s: GameState): HTMLElement[] => {
    const stats = txt('');
    const dbtn = btn('', 'primary', () => ctx.act.drift());
    watch(() => {
      const g = get();
      const cod = chartsOnDrift(g);
      const perMin = g.runTime > 0 ? cod.toNumber() / (g.runTime / 60) : 0;
      stats.textContent = `Charts on drift: ${fmt(cod, g.notation)} (${fmt(perMin, g.notation)}/min). Run Ink: ${fmt(g.runInk, g.notation)}.`;
      dbtn.textContent = `Drift for ${fmt(cod, g.notation)} Charts`;
      dbtn.disabled = !canDrift(g);
    });
    const out = [card(title('Drift'), stats, txt('Resets Ink, tiles (except pinned), Survey rings. Keeps Charts, upgrades, milestones, pins.'), dbtn)];
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
      at.onchange = () => {
        get().autoDrift.at = Math.max(1, Number(at.value) || 1);
      };
      const lab = el('label');
      lab.append(cb, ' Auto-Drift at ', at, ' Charts');
      out.push(card(title('Auto-Drift'), lab));
    }
    return out;
  };

  const chartsTab = (s: GameState): HTMLElement[] =>
    s.drifts === 0
      ? [txt('Drift once to start earning Charts. Charts buy permanent upgrades.')]
      : chartUpgrades.map((d) => upgCard(d, 'Charts', (g) => g.chartUpg, (g) => g.charts, (id) => ctx.act.buyChart(id)));

  const projTab = (s: GameState): HTMLElement[] => {
    const req = txt('');
    const curvP = txt('');
    const pb = btn('', 'primary', () => ctx.act.project());
    watch(() => {
      const g = get();
      req.textContent = `Requires ${config.projection.minCharts} Charts this cycle (${fmt(g.cycleCharts, g.notation)}/${config.projection.minCharts}).`;
      curvP.textContent = `Curvature on projection: ${fmt(curvatureOnProjection(g), g.notation)}.`;
      pb.textContent = `Project for ${fmt(curvatureOnProjection(g), g.notation)} Curvature`;
      pb.disabled = !canProject(g);
    });
    const out = [card(title('Projection'), req, txt('Board becomes a hyperbolic {7,3} tiling: every cell has 7 neighbours.'), curvP, pb)];
    if (s.projections > 0 || s.curvature.gt(0))
      out.push(...curvUpgrades.map((d) => upgCard(d, 'Curvature', (g) => g.curvUpg, (g) => g.curvature, (id) => ctx.act.buyCurv(id))));
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
    const notation = el('select');
    notation.append(new Option('Suffix (1.23M)', 'suffix'), new Option('Scientific (1.23e6)', 'sci'));
    notation.value = s.notation;
    notation.onchange = () => {
      get().notation = notation.value === 'sci' ? 'sci' : 'suffix';
    };
    const nl = el('label', '', 'Notation ');
    nl.append(notation);
    return [
      card(
        title('Save'),
        txt('Export or import your progress as a string or .json file.'),
        row(copy, btn('Download file', '', () => ctx.act.exportFile()), btn('Import…', '', openImport)),
      ),
      card(title('Display'), nl),
      card(title('Hard reset'), txt('Wipes all progress, including Charts, Curvature and milestones.'), btn('Hard reset', 'danger', openReset)),
    ];
  };

  const tabs: Record<Tab, (s: GameState) => HTMLElement[]> = {
    map: mapTab, drift: driftTab, charts: chartsTab, proj: projTab, miles: milesTab, save: saveTab,
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
  const toastEl = el('div', 'toast');
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
  const showOffline = (r: OfflineReport) => {
    if (r.seconds < 10) return;
    const content = el('div');
    content.append(txt(`Away for ${fmtTime(r.seconds)}.`), txt(`Ink gained: ${fmt(r.ink)}`), txt(`Efficiency: ${Math.round(r.eff * 100)}%`));
    if (r.drifts > 0) content.append(txt(`Drifts: ${r.drifts}`));
    openModal('While you were away', content, [btn('OK', 'primary', closeModal)]);
  };

  // ---- Dev panel ----
  const dev = el('div', 'dev hidden');
  if (ctx.dev) {
    const g = (label: string, f: () => void) => btn(label, '', f);
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
    const [label, p] = nextGoal(s);
    nextLabel.textContent = label;
    fill.style.width = `${Math.round(clamp(p) * 100)}%`;

    for (const x of tileBtns) {
      const c = tileCost(s, x.t);
      x.cost.textContent = fmt(c, s.notation);
      x.b.classList.toggle('cant', s.ink.lt(c));
      x.b.classList.toggle('active', ctx.tool.current === x.t);
    }
    for (const x of [sellBtn, pinBtn]) x.b.classList.toggle('active', ctx.tool.current === x.t);
    pinBtn.cost.textContent = `${s.pinned.length}/${maxPins(s)}`;

    for (const [id, b] of tabBtns) b.classList.toggle('active', id === tab);
    tabBtns.get('charts')!.classList.toggle('locked', s.drifts === 0);
    const proj = tabBtns.get('proj')!;
    proj.style.display = s.drifts > 0 || s.cycleCharts.gt(0) || s.projections > 0 ? '' : 'none';
    proj.classList.toggle('locked', !(canProject(s) || s.projections > 0));

    const key = [
      tab, s.drifts, s.projections, s.ring, s.geometry, s.curvature.gt(0), canProject(s), autoSurveyOn(s),
      JSON.stringify(s.chartUpg), JSON.stringify(s.curvUpg), MILESTONES.map((m) => (m.req(s) ? 1 : 0)).join(''),
    ].join('|');
    if (key !== bodyKey) {
      bodyKey = key;
      live = [];
      body.replaceChildren(...tabs[tab](s));
    }
    for (const f of live) f();
  }

  // ---- Keyboard ----
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
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
  });

  // ---- Mount ----
  root.append(hud, palette, toggle, panel, tip, toastEl, dev, backdrop);
  update();
  return { update, tooltip, showOffline, toast, flash };
}
