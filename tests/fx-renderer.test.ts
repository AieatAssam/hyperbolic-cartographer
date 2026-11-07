import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FX, TILE_IDENTITIES } from '../src/art/palette';
import type { TileType } from '../src/core/tiles';
import { CartographyFX, type FxContext, type FxQuality } from '../src/render/fx';
import { bumpRev, createEmbedding, writeFrame, type Embedding, type Route } from '../src/render/fx-graph';
import { FX_BUDGETS, budgetFor } from '../src/render/fx-model';

// Renderer-level checks that run in Node: CartographyFX builds its geometry and material without a WebGL context,
// so these tests drive update()/prepare() with a fixed dt and read the instance attributes back.

const Mode = { Leg: 0, Mote: 1, Spark: 2, Ring: 3, Pop: 4, Wash: 5 } as const;

const embedFor = (n: number, hidden: number[] = []): Embedding => {
  const e = createEmbedding(n);
  for (let i = 0; i < n; i++) writeFrame(e, i, { p: [i, 0, 0], s: hidden.includes(i) ? 0 : 1, n: [0, 1, 0] });
  return e;
};

const ctxOf = (tiles: (TileType | null)[], o: Partial<FxContext> & { quality?: FxQuality } = {}): FxContext => ({
  tops: [], tiles, quality: 1, embed: embedFor(tiles.length), ...o,
});

const geoOf = (fx: CartographyFX) => (fx.group.children[0] as THREE.Mesh).geometry as THREE.InstancedBufferGeometry;
const attr = (fx: CartographyFX, name: string) => geoOf(fx).getAttribute(name).array as Float32Array;
const uniforms = (fx: CartographyFX) => ((fx.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;

/** Slots drawn at fx.now (aTime: start, life, size, mode). Optionally only one mode. */
function live(fx: CartographyFX, mode?: number): number[] {
  const t = attr(fx, 'aTime'), now = fx.now, cap = fx.stats().capacity, out: number[] = [];
  for (let i = 0; i < cap; i++) {
    const b = t[i * 4], l = t[i * 4 + 1];
    if (l > 0 && now >= b && now <= b + l && (mode === undefined || t[i * 4 + 3] === mode)) out.push(i);
  }
  return out;
}

const step = (fx: CartographyFX, c: FxContext, frames: number, dt = 0.25) => {
  for (let k = 0; k < frames; k++) fx.update(dt, c);
};

describe('production streams: feed routes only', () => {
  it('feed routes stream legs', () => {
    const fx = new CartographyFX(1);
    fx.seed(3);
    const c = ctxOf(['spring', 'mill'], { routes: [{ nodes: [0, 1], source: 'spring', kind: 'feed' }] });
    let sawLeg = false;
    for (let k = 0; k < 6; k++) {
      fx.update(0.25, c);
      if (live(fx, Mode.Leg).length) sawLeg = true;
    }
    expect(sawLeg).toBe(true);
  });

  it('boost routes never stream: their legs appear only after the Beacon aura tick', () => {
    const fx = new CartographyFX(1);
    fx.seed(3);
    const routes: Route[] = [{ nodes: [0, 1], source: 'beacon', kind: 'boost' }];
    const c = ctxOf(['beacon', 'spring'], { routes });
    step(fx, c, 6); // before aura tick (~2.4 s at quality 1)
    expect(fx.stats().spawned).toBeGreaterThan(0); // the lone Spring is emitting motes
    expect(live(fx, Mode.Leg)).toEqual([]);
    let sawBoostLeg = false;
    for (let k = 0; k < 16; k++) {
      fx.update(0.25, c);
      if (live(fx, Mode.Leg).length) sawBoostLeg = true;
    }
    expect(sawBoostLeg).toBe(true);
  });
});

describe('lone producers: Ink motes for Springs and Mills with no feed route', () => {
  it('a Spring touched only by a Beacon still emits Ink motes', () => {
    const fx = new CartographyFX(1);
    fx.seed(5);
    let arrived = 0;
    fx.onInkArrive = (w) => (arrived += w);
    const c = ctxOf(['beacon', 'spring'], { routes: [{ nodes: [0, 1], source: 'beacon', kind: 'boost' }] });
    step(fx, c, 16);
    expect(arrived).toBeGreaterThanOrEqual(1);
  });

  it('an isolated Mill emits its own mote, in the Mill colour', () => {
    const fx = new CartographyFX(1);
    fx.seed(5);
    const c = ctxOf(['mill']);
    const want = new THREE.Color().setHex(TILE_IDENTITIES.mill.emissive);
    let matched = false;
    for (let k = 0; k < 12; k++) {
      fx.update(0.25, c);
      const col = attr(fx, 'aCol');
      for (const s of live(fx, Mode.Mote)) {
        if (Math.abs(col[s * 3] - want.r) < 1e-6 && Math.abs(col[s * 3 + 1] - want.g) < 1e-6 && Math.abs(col[s * 3 + 2] - want.b) < 1e-6) matched = true;
      }
    }
    expect(matched).toBe(true);
  });

  it('Vaults and Bridges produce nothing at all', () => {
    const fx = new CartographyFX(1);
    fx.seed(5);
    let arrived = 0;
    fx.onInkArrive = (w) => (arrived += w);
    step(fx, ctxOf(['vault', 'bridge']), 12);
    expect(fx.stats().spawned).toBe(0);
    expect(arrived).toBe(0);
  });
});

describe('ink arrival ownership', () => {
  it('a surviving mote arrives once, and its Pop is made at the arrival, not booked at spawn', () => {
    const fx = new CartographyFX(1);
    fx.seed(9);
    const c = ctxOf([null, null]);
    let arrived = 0, arrivedAt = -1;
    fx.onInkArrive = (w) => {
      arrived += w;
      arrivedAt = fx.now;
    };
    fx.prepare(c);
    fx.sell(0);
    for (let k = 0; k < 12 && arrived === 0; k++) {
      fx.update(0.25, c);
      if (arrived === 0) expect(live(fx, Mode.Pop)).toEqual([]);
    }
    expect(arrived).toBe(1);
    const pops = live(fx, Mode.Pop);
    expect(pops.length).toBe(1);
    expect(attr(fx, 'aTime')[pops[0] * 4]).toBeCloseTo(arrivedAt, 10);
  });

  it('an overwritten mote never pops the counter, even after the ring wraps over its slot', () => {
    const fx = new CartographyFX(1);
    fx.seed(9);
    const c = ctxOf([null, null]);
    let arrived = 0;
    fx.onInkArrive = (w) => (arrived += w);
    fx.prepare(c);
    fx.sell(0); // arms one arrival on the mote's slot
    for (let k = 0; k < fx.stats().capacity; k++) fx.placement(1, 0x6cc4ff); // reuses every slot once
    step(fx, c, 8);
    expect(arrived).toBe(0);
    expect(live(fx, Mode.Pop)).toEqual([]);
  });

  it('clearAnchored cancels pending arrivals and drops the mote instances', () => {
    const fx = new CartographyFX(1);
    fx.seed(9);
    const c = ctxOf([null, null]);
    let arrived = 0;
    fx.onInkArrive = (w) => (arrived += w);
    fx.prepare(c);
    fx.sell(0);
    fx.clearAnchored();
    expect(live(fx, Mode.Mote)).toEqual([]);
    step(fx, c, 8);
    expect(arrived).toBe(0);
  });

  it('a downgrade cancels pending arrivals and ends in-flight Pops in the attributes', () => {
    const fx = new CartographyFX(2);
    fx.seed(11);
    const hi = ctxOf([null, null], { quality: 2 });
    const lo: FxContext = { ...hi, quality: 0 };
    let arrived = 0;
    fx.onInkArrive = (w) => (arrived += w);
    fx.prepare(hi);
    fx.sell(0);
    for (let k = 0; k < 12 && arrived === 0; k++) fx.update(0.25, hi);
    expect(arrived).toBe(1);
    expect(live(fx, Mode.Pop).length).toBe(1);

    fx.sell(1); // pending when the quality drops
    fx.update(0.25, lo);
    expect(live(fx, Mode.Pop)).toEqual([]);
    step(fx, lo, 8);
    expect(arrived).toBe(1);
    expect(fx.stats().pendingInk).toBe(0);
    expect(geoOf(fx).instanceCount).toBe(fx.stats().capacity);
  });

  it('Pops stay bounded: one arrival batch makes at most one Pop', () => {
    const fx = new CartographyFX(1);
    fx.seed(13);
    const c = ctxOf([null, null, null, null]);
    fx.prepare(c);
    for (let i = 0; i < 4; i++) fx.sell(i);
    fx.update(0.25, c);
    step(fx, c, 4);
    expect(live(fx, Mode.Pop).length).toBeLessThanOrEqual(1);
  });
});

describe('prepare(ctx): binds the frame without advancing time', () => {
  it('binds the HUD target and leaves time, spawns and live instances untouched', () => {
    const fx = new CartographyFX(1);
    const e = embedFor(2);
    const boardMatrix = new THREE.Matrix4().makeTranslation(1, 0, 0);
    let arrived = 0;
    fx.onInkArrive = (w) => (arrived += w);
    fx.prepare({
      tops: [], tiles: ['spring', 'mill'], quality: 1, embed: e, boardMatrix, inkTargetNdc: [0.5, -0.25],
      routes: [{ nodes: [0, 1], source: 'spring', kind: 'feed' }],
    });
    expect(fx.now).toBe(0);
    expect(fx.stats().spawned).toBe(0);
    expect(fx.stats().live).toBe(0);
    expect(arrived).toBe(0);
    expect(uniforms(fx).uInk.value.x).toBeCloseTo(0.5, 10);
    expect(uniforms(fx).uInk.value.y).toBeCloseTo(-0.25, 10);
  });

  it('rebinds the embedding: a tile hidden in the new frame cannot be spawned on', () => {
    const fx = new CartographyFX(1);
    const shown = ctxOf([null, null]);
    const hiddenFrame: FxContext = { ...shown, embed: embedFor(2, [0]) };
    fx.prepare(shown);
    fx.placement(0, 0x6cc4ff);
    const before = fx.stats().spawned;
    expect(before).toBeGreaterThan(0);
    fx.prepare(hiddenFrame);
    fx.placement(0, 0x6cc4ff);
    expect(fx.stats().spawned).toBe(before);
  });

  it('the board transform reaches the shader at render time', () => {
    const fx = new CartographyFX(1);
    const boardMatrix = new THREE.Matrix4().makeTranslation(2, 0, -3);
    fx.prepare(ctxOf([null], { boardMatrix }));
    const mesh = fx.group.children[0] as THREE.Mesh;
    const fakeRenderer = { getDrawingBufferSize: (v: THREE.Vector2) => v.set(800, 600), getPixelRatio: () => 1 };
    (mesh.onBeforeRender as unknown as (r: unknown) => void)(fakeRenderer);
    expect(Array.from((uniforms(fx).uBoard.value as THREE.Matrix4).elements)).toEqual(Array.from(boardMatrix.elements));
  });
});

describe('board fade: anchored streams stop, and the anchored layer follows the board', () => {
  // Feed 0→1, Beacon boost 2→1 and a lone Spring at 3: every stream source is present, and the aura ticks at 1.8 s.
  const streamCtx = () => ctxOf(['spring', 'mill', 'beacon', 'spring'], {
    routes: [
      { nodes: [0, 1], source: 'spring', kind: 'feed' },
      { nodes: [2, 1], source: 'beacon', kind: 'boost' },
    ],
  });

  it('control: a shown board streams', () => {
    const fx = new CartographyFX(1);
    fx.seed(4);
    step(fx, streamCtx(), 12);
    expect(fx.stats().spawned).toBeGreaterThan(0);
  });

  it('fade 0 spawns no streams and arms no arrivals', () => {
    const fx = new CartographyFX(1);
    fx.seed(4);
    let arrived = 0;
    fx.onInkArrive = (w) => (arrived += w);
    fx.setAnchorFade(0);
    step(fx, streamCtx(), 12);
    expect(fx.stats().spawned).toBe(0);
    expect(fx.stats().pendingInk).toBe(0);
    expect(arrived).toBe(0);
  });

  it('a stream stops when the fade drops below 1 and resumes when the board is shown again', () => {
    const fx = new CartographyFX(1);
    fx.seed(4);
    const c = streamCtx();
    // Spy on the stream entry points: a Pop from a mote already in flight is allowed, a new stream is not.
    const fire = vi.spyOn(fx as any, 'fireRoute');
    const mote = vi.spyOn(fx as any, 'mote');
    step(fx, c, 4);
    expect(fire.mock.calls.length + mote.mock.calls.length).toBeGreaterThan(0);
    fire.mockClear();
    mote.mockClear();
    fx.setAnchorFade(0.5);
    step(fx, c, 8);
    expect(fire).not.toHaveBeenCalled();
    expect(mote).not.toHaveBeenCalled();
    fx.setAnchorFade(1);
    step(fx, c, 4);
    expect(fire.mock.calls.length + mote.mock.calls.length).toBeGreaterThan(0);
  });

  it('a mote already in flight still lands while the board fades', () => {
    const fx = new CartographyFX(1);
    fx.seed(9);
    const c = ctxOf([null, null]);
    let arrived = 0;
    fx.onInkArrive = (w) => (arrived += w);
    fx.prepare(c);
    fx.sell(0);
    fx.setAnchorFade(0);
    for (let k = 0; k < 12 && arrived === 0; k++) fx.update(0.25, c);
    expect(arrived).toBe(1);
  });

  it('screen-space Wash keeps spawning at fade 0', () => {
    const fx = new CartographyFX(1);
    fx.seed(4);
    fx.setAnchorFade(0);
    fx.prestige('drift', 'out', 1.5);
    expect(fx.stats().spawned).toBeGreaterThan(0);
    step(fx, streamCtx(), 2);
    expect(live(fx, Mode.Wash).length).toBeGreaterThan(0);
  });

  it('setAnchorFade drives uAnchorFade and clamps: non-finite means shown, out-of-range is clamped', () => {
    const fx = new CartographyFX(1);
    const u = () => uniforms(fx).uAnchorFade.value as number;
    expect(u()).toBe(1);
    fx.setAnchorFade(0.25);
    expect(u()).toBe(0.25);
    fx.setAnchorFade(2);
    expect(u()).toBe(1);
    fx.setAnchorFade(-1);
    expect(u()).toBe(0);
    fx.setAnchorFade(NaN);
    expect(u()).toBe(1);
  });
});

describe('embedding rewrite in place', () => {
  it('the same Embedding rewritten and bumped with bumpRev re-uploads, and stats().embedRev follows it', () => {
    const fx = new CartographyFX(1);
    const e = embedFor(2);
    fx.prepare(ctxOf([null, null], { embed: e }));
    const before = fx.stats().embedRev;
    expect(before).toBe(e.rev);
    writeFrame(e, 0, { p: [7, 0, 0], s: 1, n: [0, 1, 0] });
    expect(bumpRev(e)).toBe(before + 1);
    fx.prepare(ctxOf([null, null], { embed: e }));
    expect(fx.stats().embedRev).toBe(e.rev);
    expect(fx.stats().embedRev).toBeGreaterThan(before);
    expect((fx as unknown as { texBuf: Float32Array }).texBuf[0]).toBe(7);
  });
});

describe('viewport changes keep the pool', () => {
  it('a viewport-only change re-derives the budget, keeps the pending mote and its slot, and still lands it', () => {
    const fx = new CartographyFX(1);
    fx.seed(9);
    let arrived = 0;
    fx.onInkArrive = (w) => (arrived += w);
    const big = ctxOf([null, null], { viewportPx: 1_024_000 });
    fx.prepare(big);
    fx.sell(0);
    const slots = live(fx, Mode.Mote);
    expect(fx.stats().pendingInk).toBe(1);
    const small: FxContext = { ...big, viewportPx: 400 * 300 };
    fx.update(0.25, small);
    expect((fx as unknown as { budget: unknown }).budget).toEqual(budgetFor(1, 400 * 300));
    expect((fx as unknown as { budget: { pulseRate: number } }).budget.pulseRate).toBeLessThan(FX_BUDGETS[1].pulseRate);
    expect(fx.stats().pendingInk).toBe(1);
    expect(live(fx, Mode.Mote)).toEqual(slots);
    for (let k = 0; k < 12 && arrived === 0; k++) fx.update(0.25, small);
    expect(arrived).toBe(1);
  });

  it('a real quality change still cancels pending arrivals', () => {
    const fx = new CartographyFX(1);
    fx.seed(9);
    const hi = ctxOf([null, null], { quality: 1 });
    let arrived = 0;
    fx.onInkArrive = (w) => (arrived += w);
    fx.prepare(hi);
    fx.sell(0);
    fx.update(0.25, { ...hi, quality: 0 });
    expect(fx.stats().pendingInk).toBe(0);
    step(fx, { ...hi, quality: 0 }, 12);
    expect(arrived).toBe(0);
  });
});

describe('survey reveal: strong ring stays inside its own cell', () => {
  it('a strong cell gets a ring whose max radius is at most 0.5 pitch', () => {
    const fx = new CartographyFX(1);
    fx.seed(3);
    const c = ctxOf(['spring', 'mill']);
    fx.update(0.25, c);
    fx.surveyReveal([{ i: 0, delay: 0, strong: true }]);
    const t = attr(fx, 'aTime'), B = attr(fx, 'aB'), cap = fx.stats().capacity;
    const radii: number[] = [];
    for (let s = 0; s < cap; s++) {
      if (t[s * 4 + 1] > 0 && t[s * 4 + 3] === Mode.Ring) radii.push(B[s * 3 + 1]);
    }
    expect(radii).toHaveLength(1);
    expect(radii[0]).toBeCloseTo(FX.revealRadius, 6);
    expect(radii[0]).toBeLessThanOrEqual(0.5);
  });
});

describe('shader source', () => {
  const src = readFileSync(new URL('../src/render/fx.ts', import.meta.url), 'utf8');
  const main = src.slice(src.indexOf('void main() {', src.indexOf('const VERT')), src.indexOf('const FRAG'));
  /** The text of one mode branch of the vertex main(), from its opening marker up to the next one. */
  const branch = (from: string, to?: string) => {
    const a = main.indexOf(from);
    expect(a, from).toBeGreaterThan(-1);
    return main.slice(a, to === undefined ? undefined : main.indexOf(to, a + from.length));
  };

  it('uses no Math.random (determinism comes from the seeded PRNG)', () => {
    expect(src).not.toMatch(/Math\.random\(/);
  });

  it('never mixes a colour toward white', () => {
    expect(src).not.toMatch(/mix\(vCol/);
  });

  it('takes the Mote exponent from the shared MOTE_ACCEL constant, not a literal', () => {
    expect(src).toMatch(/const float MOTE_P = \$\{lit\(MOTE_ACCEL\)\};/);
    expect(src).toMatch(/pow\(k2, MOTE_P\)/);
    expect(src).not.toMatch(/pow\(k2, 2\.2\)/);
  });

  it('declares uAnchorFade and multiplies it into every anchored branch (Leg, Mote, Spark, Ring)', () => {
    expect(src).toMatch(/uniform float uAnchorFade;/);
    expect(branch('if (mode < 0.5)', 'else if (mode < 1.5)')).toContain('* uAnchorFade');
    expect(branch('else if (mode < 1.5)', 'else if (mode < 2.5)')).toContain('* uAnchorFade');
    expect(branch('else if (mode < 2.5)', 'else if (mode < 3.5)')).toContain('* uAnchorFade');
    expect(branch('else if (mode < 3.5)', 'else if (mode < 4.5)')).toContain('* uAnchorFade');
  });

  it('leaves the screen-space branches (Pop, Wash, Vortex) on screen alpha only', () => {
    expect(branch('else if (mode < 4.5)', 'else if (mode < 5.5)')).not.toContain('uAnchorFade');
    expect(branch('else if (mode < 5.5)', 'float ang')).not.toContain('uAnchorFade');
    expect(branch('float ang')).not.toContain('uAnchorFade');
  });
});
