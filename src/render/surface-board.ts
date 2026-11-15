import * as THREE from 'three';
import type { GameState, Surface } from '../core/state';
import type { SurfaceGraph } from '../core/geometry/quotient';
import {
  BOARD, CONSTELLATION, EMPTY_SLOT, MATERIAL, MOTIF, NEXT_SLOT, SURFACE, TILE_IDENTITIES, bevelColour, hoverFace,
  lerpHex, motifScale, sideColour, tileHeight, trimGlow,
} from '../art/palette';
import { placeGlsl } from './transition';
import { bumpRev, createEmbedding, EMBED_STRIDE, type Embedding } from './fx-graph';
import type { TileType } from '../core/tiles';
import { TILE_TYPES } from '../core/tiles';
import { merged, motifMaterial, prepareMotifs, type TileModels } from './tile-models';
import { prod } from '../core/economy';
import { config } from '../core/config';
import { chartCell } from './surface-params';
import { buildKleinImmersionSkin, buildMobiusSkin, buildSelfIntersectionLine, buildTorusSkin } from './surface-skin';
import { buildChartSeams, buildEdgeGhosts } from './surface-deco';
import { FlowArchOverlay } from './flow-arch';
import type { BoardHighlight } from './board-highlight';
import { flowCell, flowPeriodU, flowsV, foldEase, shapeFrame, shapePos } from './surface-shape';

/** Seconds for the chart ↔ surface fold (and the 2D/3D toggle). */
export const FOLD_S = 2.7;
/** Seconds for the reduced-motion cross-fade that replaces the fold. */
const CROSS_S = 0.6;
/** Seconds for the gold band to race once around a newly closed loop. */
const LOOP_RACE_S = 2.2;
/** Flow inertia: velocity half-life in seconds after the pointer lets go. */
const FLOW_DAMP = 0.28;
const FLOW_VMAX = 1.2; // turns/s

const col = (hex: number) => new THREE.Color(hex);
const TOK = Object.fromEntries(TILE_TYPES.map((t) => {
  const tk = TILE_IDENTITIES[t];
  return [t, {
    face: col(tk.base), hover: col(hoverFace(tk.base)), side: col(sideColour(tk.base)),
    bevel: col(bevelColour(tk)), bevelPin: col(bevelColour(tk, true)),
    faceGlow: col(tk.base).multiplyScalar(MATERIAL.faceGlow), emissive: col(tk.emissive),
  }];
})) as Record<TileType, Record<'face' | 'hover' | 'side' | 'bevel' | 'bevelPin' | 'faceGlow' | 'emissive', THREE.Color>>;

const C = {
  slot: col(EMPTY_SLOT.base), slotGlow: col(EMPTY_SLOT.emissive).multiplyScalar(EMPTY_SLOT.emissiveIntensity),
  slotBorder: col(lerpHex(EMPTY_SLOT.accent, SURFACE.skinGrid, 0.28)), slotSide: col(sideColour(EMPTY_SLOT.base)),
  next: col(SURFACE.uncharted), nextBorder: col(SURFACE.unchartedEdge),
  far: col(SURFACE.uncharted), farBorder: col(lerpHex(SURFACE.uncharted, SURFACE.unchartedEdge, 0.35)),
  farSide: col(sideColour(SURFACE.uncharted)),
  white: col(BOARD.hover), adj: col(BOARD.adjacency), black: col(0), flip: col(SURFACE.seamFlip),
  gold: col(SURFACE.loopGold), bridge: col(TILE_IDENTITIES.bridge.accent), grey: col(0x2a2638),
  nextGlow: col(NEXT_SLOT.border).multiplyScalar(0.05), strain: col(MOTIF.strainTint),
};

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const wrapTo = (x: number, p: number) => ((x % p) + p) % p;
/** Shortest signed step from a to b on a circle of period p. */
const wrapDelta = (a: number, b: number, p: number) => wrapTo(b - a + p / 2, p) - p / 2;

/**
 * A closed-surface stage board (Möbius strip, torus, Klein bottle), and the manifold preview. Every vertex comes
 * from one shape function (surface-shape.ts), so the flat chart, the 3D surface and the fold between them are the
 * same mesh. Positions are recomputed only when the flow, fold or tile heights change; colours only when the state
 * or highlight changes. No allocation on either path.
 */
export class SurfaceBoard {
  readonly group = new THREE.Group();
  readonly tops: THREE.Vector3[];
  readonly embed: Embedding;
  readonly graph: SurfaceGraph;
  seamView = true;
  /** Tiling shift in turns, [u, v]. u is in [0, 2) on the Möbius strip and Klein bottle (two laps come home). */
  flow: [number, number] = [0, 0];
  /** Flow velocity in turns/s (drag inertia). */
  readonly flowVel: [number, number] = [0, 0];
  /** 0 = flat chart, 1 = the 3D surface. Eases towards morphTo in tick(). */
  morph = 1;
  morphTo = 1;
  /** Per-tile unit normal of the drawn tile top (fx and overlays). */
  normals!: Float32Array;
  /** Per-tile mirror parity under the current flow (1 = has crossed the flip seam an odd number of times). */
  readonly parity: Uint8Array;
  private readonly W: number;
  private readonly H: number;
  private readonly S = config.manifold.patchSubdiv;
  private readonly N = config.manifold.patchSubdiv + 1;
  private readonly vpt: number;
  private readonly topN: number;
  private readonly geom = new THREE.BufferGeometry();
  private readonly tileMesh: THREE.Mesh;
  private readonly GP: Float64Array;
  private readonly GN: Float64Array;
  private hTop!: Float32Array;
  private ins!: Float32Array;
  private face!: Float32Array;
  private border!: Float32Array;
  private side!: Float32Array;
  private glowF!: Float32Array;
  private trimF!: Float32Array;
  private radius!: Float32Array;
  private readonly disp: Float32Array;
  private readonly tileType: (TileType | null)[];
  private strainK!: Float32Array;
  private tint!: Float32Array;
  private motifs: Record<TileType, THREE.InstancedMesh>;
  private readonly uClock = { value: 0 };
  private readonly uBackDim = { value: 1 };
  private readonly uFlash = { value: col(SURFACE.surveyFlash) };
  private styleKey = '';
  private layoutDirty = true;
  private colourDirty = true;
  private skinGroup = new THREE.Group();
  private decoGroup = new THREE.Group();
  private skinMats: { m: THREE.Material; base: number }[] = [];
  private decoMats: { m: THREE.Material; base: number }[] = [];
  private fadeMats: { m: THREE.Material; base: number; tr: boolean }[] | null = null;
  private extFade = 1;
  private cross = -1;
  private lastNow = -1;
  private centreGoal: { fu: number; fv: number; yaw: number } | null = null;
  private loopCells = new Set<number>();
  private race: { mesh: THREE.Mesh; t0: number; mat: THREE.ShaderMaterial } | null = null;
  /** A loop waiting for the surface to settle (Centre easing, flick inertia) before its race starts. */
  private racePending: number[] | null = null;
  /** True while a loop race is queued or running (the idle drift holds still so the band stays on its cells). */
  get racing() { return !!(this.race || this.racePending); }
  private pr: ReturnType<typeof prod> | null = null;
  private readonly lines: Record<'pulse' | 'faint' | 'ghost', THREE.LineSegments>;
  private readonly flowArch = new FlowArchOverlay();
  private reducedMotion = false;
  private readonly m4 = new THREE.Matrix4();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
  private readonly v5 = new THREE.Vector3();
  private readonly ray = new THREE.Ray();
  private readonly inv = new THREE.Matrix4();
  private readonly tmp = [0, 0];
  private readonly F = new Float64Array(9);
  private readonly cc = new THREE.Color();
  private readonly sc = new THREE.Vector3();

  constructor(readonly surface: Surface, graph: SurfaceGraph, private readonly envMap: THREE.Texture | null = null) {
    this.graph = graph;
    this.W = graph.width;
    this.H = graph.height;
    const n = graph.ring.length, S = this.S, N = this.N;
    this.topN = N * N;
    const bottom = surface === 'mobius' ? N * N : 0;
    this.vpt = N * N + bottom + 16 * S;
    this.GP = new Float64Array(N * N * 3);
    this.GN = new Float64Array(N * N * 3);
    for (const k of ['hTop', 'ins', 'radius', 'strainK'] as const) this[k] = new Float32Array(n);
    for (const k of ['face', 'border', 'side', 'glowF', 'trimF', 'normals', 'tint'] as const) this[k] = new Float32Array(n * 3);
    this.disp = new Float32Array(n * 2);
    this.parity = new Uint8Array(n);
    this.tileType = graph.ring.map(() => null);
    this.embed = createEmbedding(n);
    this.embed.seam = (a, b) => this.morph < 0.5
      && (Math.abs(this.disp[a * 2] - this.disp[b * 2]) > 1.5 || Math.abs(this.disp[a * 2 + 1] - this.disp[b * 2 + 1]) > 1.5);
    this.tops = graph.ring.map(() => new THREE.Vector3());
    const V = n * this.vpt;
    for (const name of ['position', 'normal', 'aLift'])
      this.geom.setAttribute(name, new THREE.BufferAttribute(new Float32Array(V * 3), 3).setUsage(THREE.DynamicDrawUsage));
    for (const name of ['color', 'glow']) this.geom.setAttribute(name, new THREE.BufferAttribute(new Float32Array(V * 3), 3));
    for (const name of ['born', 'revealAt']) this.geom.setAttribute(name, new THREE.BufferAttribute(new Float32Array(V).fill(-1e4), 1));
    this.geom.setIndex(this.buildIndex(n, bottom > 0));
    this.geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);
    const toks = TILE_TYPES.map((t) => TILE_IDENTITIES[t]);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: toks.reduce((a, t) => a + t.roughness, 0) / toks.length,
      metalness: toks.reduce((a, t) => a + t.metalness, 0) / toks.length,
      envMap: envMap, envMapIntensity: MATERIAL.bodyEnv,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float born;
attribute float revealAt;
attribute vec3 aLift;
attribute vec3 glow;
uniform float uFxClock;
uniform vec3 uFlash;
varying vec3 vGlow;
${placeGlsl()}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
float sqT = uFxClock - born;
float rv = clamp((uFxClock - revealAt) / 0.6, 0.0, 1.0);
rv = rv * rv * (3.0 - 2.0 * rv);
transformed -= aLift * (1.0 - placeScale(sqT) * rv);
float fl = clamp(1.0 - abs(uFxClock - revealAt - 0.45) / 0.45, 0.0, 1.0);
vGlow = glow + uFlash * fl * 0.9;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uBackDim;\nvarying vec3 vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;')
        .replace('#include <output_fragment>', 'if (!gl_FrontFacing) { diffuseColor.rgb *= uBackDim; }\n#include <output_fragment>');
      sh.uniforms.uFxClock = this.uClock;
      sh.uniforms.uBackDim = this.uBackDim;
      sh.uniforms.uFlash = this.uFlash;
    };
    // The shadow pass would skip the displacement chunk, so tiles cast no shadow (the stage light is soft anyway).
    this.tileMesh = new THREE.Mesh(this.geom, mat);
    this.tileMesh.frustumCulled = false;
    this.tileMesh.name = 'surface-tiles';
    this.skinGroup.renderOrder = -10;
    this.decoGroup.renderOrder = 4;
    this.group.add(this.skinGroup, this.tileMesh, this.decoGroup);
    this.motifs = {} as Record<TileType, THREE.InstancedMesh>;
    const set = prepareMotifs({});
    for (const t of TILE_TYPES) {
      const im = new THREE.InstancedMesh(set.geos[t], motifMaterial(t), n);
      im.count = 0;
      im.frustumCulled = false;
      im.renderOrder = 3;
      this.motifs[t] = im;
      this.group.add(im);
    }
    const line = (color: number, opacity: number, depthTest: boolean, order: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 8 * 6), 3).setUsage(THREE.DynamicDrawUsage));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest, depthWrite: false }));
      l.frustumCulled = false;
      l.renderOrder = order;
      l.visible = false;
      this.group.add(l);
      return l;
    };
    this.lines = {
      pulse: line(CONSTELLATION.inkPulse, CONSTELLATION.opacityPulse, false, 8),
      faint: line(CONSTELLATION.inkComplete, CONSTELLATION.opacityComplete, true, 6.5),
      ghost: line(CONSTELLATION.inkGhost, CONSTELLATION.opacityGhost, false, 6.5),
    };
    this.group.add(this.flowArch.group);
    this.buildSkin();
    this.buildDeco();
  }

  /** Static triangle list: top grid (front = tile normal), Möbius underside, then 4·S wall quads per tile. */
  private buildIndex(n: number, bottom: boolean): number[] {
    const S = this.S, N = this.N, idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const base = i * this.vpt;
      for (let a = 0; a < S; a++) {
        for (let b = 0; b < S; b++) {
          const p = base + a * N + b, q = p + N, r = p + 1, s = q + 1;
          idx.push(p, r, q, q, r, s);
          if (bottom) idx.push(p + N * N, q + N * N, r + N * N, q + N * N, s + N * N, r + N * N);
        }
      }
      const w0 = base + N * N + (bottom ? N * N : 0);
      for (let k = 0; k < 4 * S; k++) {
        const o = w0 + k * 4; // A_top, B_top, A_base, B_base
        idx.push(o + 2, o + 3, o + 1, o + 2, o + 1, o);
      }
    }
    return idx;
  }

  get chartMode() { return this.morphTo < 0.5; }
  set chartMode(v: boolean) { this.setChart(v, true); }
  /** Klein only: the 3D immersion is showing (kept for the preview hooks). */
  get immersion3d() { return this.surface === 'klein' && !this.chartMode; }
  set immersion3d(v: boolean) { if (this.surface === 'klein') this.setChart(!v, true); }

  /** Chart (2D) or surface (3D). animate=false snaps (loads, QA). Reduced motion uses a cross-fade in tick(). */
  setChart(chart: boolean, animate = true) {
    this.morphTo = chart ? 0 : 1;
    if (!animate) this.morph = this.morphTo, (this.cross = -1), (this.layoutDirty = true), this.syncSkinFade();
    else if (this.reducedMotion) this.cross = 0;
  }

  /** True while the board is (or is folding into) the flat chart; camera framing uses the destination. */
  isChartFlat() { return this.morphTo < 0.5; }

  /** Ground-plane footprint of the flat chart (camera framing). */
  bounds(): [number, number][] {
    const cell = chartCell(this.W, this.H);
    const hw = this.W * cell * 0.55, hh = this.H * cell * 0.55;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  }

  /** Sets the tiling shift (wrapped). Only the torus flows along v. */
  setFlow(u: number, v: number) {
    const fu = wrapTo(u, flowPeriodU(this.surface)), fv = flowsV(this.surface) ? wrapTo(v, 1) : 0;
    if (fu === this.flow[0] && fv === this.flow[1]) return;
    if (this.race) this.endRace(); // the band is built on the tile tops; a slide would leave it behind
    this.flow[0] = fu;
    this.flow[1] = fv;
    this.layoutDirty = true;
  }

  /** Drag in turns: moves the flow now and sets the inertia velocity (turns/s) for after release. */
  nudge(du: number, dv: number, dt: number) {
    this.centreGoal = null;
    this.setFlow(this.flow[0] + du, this.flow[1] + dv);
    if (dt > 0) {
      const k = Math.min(1, dt * 12);
      // capped so a flick coasts at most about half a turn (synthetic / high-rate pointers report tiny dt)
      const cap = (x: number) => Math.max(-FLOW_VMAX, Math.min(FLOW_VMAX, x));
      this.flowVel[0] = cap(this.flowVel[0] + (du / dt - this.flowVel[0]) * k);
      this.flowVel[1] = cap(this.flowVel[1] + (dv / dt - this.flowVel[1]) * k);
    }
  }

  stopFlow() { this.flowVel[0] = this.flowVel[1] = 0; this.centreGoal = null; }
  get centring() { return this.centreGoal !== null; }

  invalidate() { this.styleKey = ''; this.layoutDirty = true; }

  private clearGroup(g: THREE.Group) {
    while (g.children.length) {
      const ch = g.children[0];
      g.remove(ch);
      ch.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((x: THREE.Material) => x.dispose());
        }
      });
    }
  }

  private collect(g: THREE.Group) {
    const out: { m: THREE.Material; base: number }[] = [];
    g.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) out.push({ m, base: m.opacity });
      }
    });
    return out;
  }

  private buildSkin() {
    this.clearGroup(this.skinGroup);
    if (this.surface === 'torus') this.skinGroup.add(buildTorusSkin(this.envMap));
    else if (this.surface === 'mobius') this.skinGroup.add(buildMobiusSkin(this.envMap));
    else this.skinGroup.add(buildKleinImmersionSkin(this.envMap), buildSelfIntersectionLine());
    this.skinMats = this.collect(this.skinGroup);
    for (const { m } of this.skinMats) m.transparent = true;
    this.fadeMats = null;
    this.syncSkinFade();
  }

  private buildDeco() {
    this.clearGroup(this.decoGroup);
    this.decoGroup.add(buildChartSeams(this.graph, this.surface), buildEdgeGhosts(this.graph, this.surface));
    this.decoMats = this.collect(this.decoGroup);
    for (const { m } of this.decoMats) m.transparent = true;
    this.fadeMats = null;
    this.syncSkinFade();
  }

  /** Skin fades in over the last part of the fold; chart seams fade out over the first part. */
  private syncSkinFade() {
    const f = this.extFade * this.crossAlpha();
    const skinK = smooth((this.morph - 0.55) / 0.45) * f, decoK = (this.seamView ? smooth(1 - this.morph * 3) : 0) * f;
    this.skinGroup.visible = skinK > 0.01;
    for (const { m, base } of this.skinMats) m.opacity = base * skinK;
    this.decoGroup.visible = decoK > 0.01;
    for (const { m, base } of this.decoMats) m.opacity = base * decoK;
    const glass = this.surface === 'klein' && this.morph > 0.5;
    this.uBackDim.value = glass ? config.manifold.kleinBackfaceDim : this.morph > 0.5 ? 0.55 : 1;
  }

  private crossAlpha() { return this.cross < 0 ? 1 : Math.abs(1 - 2 * this.cross); }

  /** Per-tile style from state and highlight. Runs only when the inputs change. */
  private restyle(s: GameState, hover: number, adj: readonly number[] | undefined, hl: BoardHighlight | undefined) {
    const g = this.graph, n = g.ring.length;
    this.pr = prod(s);
    const lit = hl?.lit && (hl.dim ?? 0) > 0 ? new Set(hl.lit) : null, dim = hl?.dim ?? 0;
    const near = new Set(hl?.direct ?? adj ?? []), bridge = new Set(hl?.bridge ?? []);
    const put = (arr: Float32Array, i: number, c: THREE.Color) => { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; };
    const c = this.cc;
    for (let i = 0; i < n; i++) {
      const t = s.tiles[i];
      const active = g.ring[i] <= s.ring, next = g.ring[i] === s.ring + 1;
      this.tileType[i] = t;
      this.strainK[i] = 0;
      this.tint[i * 3] = this.tint[i * 3 + 1] = this.tint[i * 3 + 2] = 1;
      if (t) {
        const tk = TOK[t], L = 0.35;
        this.hTop[i] = tileHeight(L);
        this.ins[i] = 0.7;
        put(this.face, i, i === hover ? tk.hover : tk.face);
        put(this.side, i, tk.side);
        put(this.border, i, s.pinned.includes(i) ? tk.bevelPin : tk.bevel);
        put(this.glowF, i, c.copy(tk.faceGlow).multiplyScalar(1.22));
        put(this.trimF, i, c.copy(tk.emissive).multiplyScalar(trimGlow(L) * 1.25));
        if (t === 'spring' && this.pr.feeds[i] > 0) {
          const share = this.pr.share[i], k = Math.min(1, Math.max(0, (1 - share) * 2));
          if (!(this.pr.feeds[i] > 1 && share >= 1)) {
            this.strainK[i] = k;
            c.set(0xffffff).lerp(C.strain, 0.6 * k).multiplyScalar(1 - MOTIF.strainDim * k);
            put(this.tint, i, c);
          }
        }
      } else if (active) {
        this.hTop[i] = MATERIAL.slotHeight;
        this.ins[i] = 0.9;
        put(this.face, i, i === hover ? C.white : C.slot);
        put(this.side, i, C.slotSide);
        put(this.border, i, C.slotBorder);
        put(this.glowF, i, C.slotGlow);
        put(this.trimF, i, c.copy(C.slotGlow).multiplyScalar(EMPTY_SLOT.restTrim * 0.85));
      } else {
        // Uncharted dark glass; the next ring to survey keeps a faint outline.
        this.hTop[i] = next ? MATERIAL.nextHeight : MATERIAL.nextHeight * 0.4;
        this.ins[i] = next ? 0.9 : 0.86;
        put(this.face, i, i === hover ? c.copy(C.next).lerp(C.white, 0.25) : next ? C.next : C.far);
        put(this.side, i, C.farSide);
        put(this.border, i, next ? C.nextBorder : C.farBorder);
        put(this.glowF, i, C.black);
        put(this.trimF, i, next ? C.nextGlow : C.black);
      }
      if (near.has(i)) put(this.border, i, C.adj), put(this.trimF, i, c.copy(C.adj).multiplyScalar(0.5));
      if (bridge.has(i)) put(this.border, i, C.bridge), put(this.trimF, i, c.copy(C.bridge).multiplyScalar(0.4 + 0.4 * (hl?.pulse ?? 0)));
      if (this.loopCells.has(i)) {
        for (let k = 0; k < 3; k++) this.glowF[i * 3 + k] += [C.gold.r, C.gold.g, C.gold.b][k] * 0.32;
        put(this.border, i, C.gold);
      }
      if (lit && !lit.has(i)) {
        for (const arr of [this.face, this.border, this.side]) {
          c.setRGB(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]).lerp(C.grey, 0.7 * dim);
          put(arr, i, c);
        }
        for (const arr of [this.glowF, this.trimF]) for (let k = 0; k < 3; k++) arr[i * 3 + k] *= 1 - 0.8 * dim;
      }
    }
    this.colourDirty = true;
    this.layoutDirty = true;
  }

  /** Writes vertex colours: top rim = border (gold flip rim on mirrored tiles), centre = face, walls/underside = side. */
  private writeColours() {
    this.colourDirty = false;
    const n = this.graph.ring.length, S = this.S, N = this.N;
    const colA = this.geom.attributes.color.array as Float32Array, glA = this.geom.attributes.glow.array as Float32Array;
    const flipSurf = this.surface !== 'torus';
    for (let i = 0; i < n; i++) {
      const base = i * this.vpt, i3 = i * 3;
      const flipRim = flipSurf && this.parity[i] === 1 && !this.loopCells.has(i);
      for (let v = 0; v < this.vpt; v++) {
        const j = (base + v) * 3;
        let src: Float32Array, gsrc: Float32Array | null, alt: THREE.Color | null = null;
        if (v < this.topN) {
          const a = Math.floor(v / N), b = v % N, rim = a === 0 || b === 0 || a === S || b === S;
          src = rim ? this.border : this.face;
          gsrc = rim ? this.trimF : this.glowF;
          if (rim && flipRim) alt = C.flip;
        } else (src = this.side), (gsrc = null);
        if (alt) (colA[j] = alt.r), (colA[j + 1] = alt.g), (colA[j + 2] = alt.b);
        else (colA[j] = src[i3]), (colA[j + 1] = src[i3 + 1]), (colA[j + 2] = src[i3 + 2]);
        if (gsrc) (glA[j] = gsrc[i3] * (alt ? 1.6 : 1)), (glA[j + 1] = gsrc[i3 + 1]), (glA[j + 2] = gsrc[i3 + 2] * (alt ? 0.6 : 1));
        else glA[j] = glA[j + 1] = glA[j + 2] = 0;
      }
    }
    this.geom.attributes.color.needsUpdate = true;
    this.geom.attributes.glow.needsUpdate = true;
  }

  /** Recomputes every vertex from the shape function under the current flow and fold. */
  private layout() {
    this.layoutDirty = false;
    const g = this.graph, n = g.ring.length, S = this.S, N = this.N, W = this.W, H = this.H, surf = this.surface;
    const pos = this.geom.attributes.position.array as Float32Array;
    const nrm = this.geom.attributes.normal.array as Float32Array;
    const lift = this.geom.attributes.aLift.array as Float32Array;
    const GP = this.GP, GN = this.GN, out = this.tmp, ed = this.embed.data;
    const cell = chartCell(W, H), ex = config.manifold.tileExtrude3d, cs = Math.min(1, cell * 1.1);
    const mob = surf === 'mobius', slab = config.manifold.mobiusSlab / 2;
    let parityChanged = false;
    for (const t of TILE_TYPES) this.motifs[t].count = 0;
    for (let i = 0; i < n; i++) {
      const [x, y] = g.xy[i];
      const par = flowCell(surf, x + 0.5, y + 0.5, W, H, this.flow[0], this.flow[1], out);
      const gx = out[0], gy = out[1];
      this.disp[i * 2] = gx; this.disp[i * 2 + 1] = gy;
      if (this.parity[i] !== par) (this.parity[i] = par), (parityChanged = true);
      const d = Math.max(Math.abs(gx - W / 2) / (W / 2), Math.abs(gy - H / 2) / (H / 2));
      const e = this.morph >= 1 ? 1 : this.morph <= 0 ? 0 : foldEase(this.morph, d);
      const half = 0.5 * this.ins[i];
      for (let a = 0; a <= S; a++) {
        for (let b = 0; b <= S; b++) {
          shapePos(surf, gx + (2 * a / S - 1) * half, gy + (2 * b / S - 1) * half, W, H, e, GP, (a * N + b) * 3);
        }
      }
      for (let a = 0; a <= S; a++) {
        const a0 = a > 0 ? a - 1 : 0, a1 = a < S ? a + 1 : S;
        for (let b = 0; b <= S; b++) {
          const b0 = b > 0 ? b - 1 : 0, b1 = b < S ? b + 1 : S;
          const pa = (a1 * N + b) * 3, pb = (a0 * N + b) * 3, qa = (a * N + b1) * 3, qb = (a * N + b0) * 3;
          const ux = GP[pa] - GP[pb], uy = GP[pa + 1] - GP[pb + 1], uz = GP[pa + 2] - GP[pb + 2];
          const vx = GP[qa] - GP[qb], vy = GP[qa + 1] - GP[qb + 1], vz = GP[qa + 2] - GP[qb + 2];
          let nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux;
          const L = Math.hypot(nx, ny, nz) || 1;
          nx /= L; ny /= L; nz /= L;
          const k = (a * N + b) * 3;
          GN[k] = nx; GN[k + 1] = ny; GN[k + 2] = nz;
        }
      }
      // A mirrored Möbius tile on the 3D band stands on the other face; everywhere else tiles stand on the front.
      const ext = mob && par && e >= 0.5 ? -1 : 1;
      const hT = this.hTop[i] * (cs + (ex - cs) * e) + (mob ? slab * e : 0);
      const hB = mob ? e * (slab + 0.5 * this.hTop[i] * ex) : 0;
      const base = i * this.vpt;
      for (let v = 0; v < this.topN; v++) {
        const k = v * 3, j = (base + v) * 3;
        const lx = GN[k] * ext * hT, ly = GN[k + 1] * ext * hT, lz = GN[k + 2] * ext * hT;
        pos[j] = GP[k] + lx; pos[j + 1] = GP[k + 1] + ly; pos[j + 2] = GP[k + 2] + lz;
        nrm[j] = GN[k]; nrm[j + 1] = GN[k + 1]; nrm[j + 2] = GN[k + 2];
        lift[j] = lx; lift[j + 1] = ly; lift[j + 2] = lz;
        if (mob) {
          const jb = (base + this.topN + v) * 3;
          const bx = -GN[k] * ext * hB, by = -GN[k + 1] * ext * hB, bz = -GN[k + 2] * ext * hB;
          pos[jb] = GP[k] + bx; pos[jb + 1] = GP[k + 1] + by; pos[jb + 2] = GP[k + 2] + bz;
          nrm[jb] = -GN[k]; nrm[jb + 1] = -GN[k + 1]; nrm[jb + 2] = -GN[k + 2];
          lift[jb] = bx; lift[jb + 1] = by; lift[jb + 2] = bz;
        }
      }
      // Walls: boundary loop counter-clockwise about the normal: +b, +a, −b, −a.
      let w = base + this.topN * (mob ? 2 : 1);
      for (let side = 0; side < 4; side++) {
        for (let sgm = 0; sgm < S; sgm++) {
          const A = side === 0 ? sgm : side === 1 ? sgm * N + S : side === 2 ? S * N + (S - sgm) : (S - sgm) * N;
          const B = side === 0 ? sgm + 1 : side === 1 ? (sgm + 1) * N + S : side === 2 ? S * N + (S - sgm - 1) : (S - sgm - 1) * N;
          const ka = A * 3, kb = B * 3;
          const tx = GP[kb] - GP[ka], ty = GP[kb + 1] - GP[ka + 1], tz = GP[kb + 2] - GP[ka + 2];
          const sx = GN[ka] + GN[kb], sy = GN[ka + 1] + GN[kb + 1], sz = GN[ka + 2] + GN[kb + 2];
          let ox = ty * sz - tz * sy, oy = tz * sx - tx * sz, oz = tx * sy - ty * sx;
          const L = (Math.hypot(ox, oy, oz) || 1) / ext;
          ox /= L; oy /= L; oz /= L;
          for (let q = 0; q < 4; q++) {
            const k = (q & 1 ? kb : ka), top = q < 2, j = (w + q) * 3;
            const hh = top ? ext * hT : -ext * hB;
            const lx = GN[k] * hh, ly = GN[k + 1] * hh, lz = GN[k + 2] * hh;
            pos[j] = GP[k] + lx; pos[j + 1] = GP[k + 1] + ly; pos[j + 2] = GP[k + 2] + lz;
            nrm[j] = ox; nrm[j + 1] = oy; nrm[j + 2] = oz;
            lift[j] = lx; lift[j + 1] = ly; lift[j + 2] = lz;
          }
          w += 4;
        }
      }
      // Tile frame at the centre sample (S is even), for tops, fx, picking and the motif.
      const kc = ((S / 2) * N + S / 2) * 3;
      const nx = GN[kc] * ext, ny = GN[kc + 1] * ext, nz = GN[kc + 2] * ext;
      const top = this.tops[i].set(GP[kc] + nx * hT, GP[kc + 1] + ny * hT, GP[kc + 2] + nz * hT);
      this.normals[i * 3] = nx; this.normals[i * 3 + 1] = ny; this.normals[i * 3 + 2] = nz;
      const k1 = ((S / 2 + 1) * N + S / 2) * 3, k0 = ((S / 2 - 1) * N + S / 2) * 3;
      const t = this.v1.set(GP[k1] - GP[k0], GP[k1 + 1] - GP[k0 + 1], GP[k1 + 2] - GP[k0 + 2]);
      const tileSize = t.length() / (2 / S) / Math.max(0.05, this.ins[i]);
      t.normalize();
      if (par) t.negate(); // mirrored tiles come back upside-down
      const nv = this.v2.set(nx, ny, nz);
      const bt = this.v3.crossVectors(nv, t).normalize();
      t.crossVectors(bt, nv);
      let r = 0;
      for (const kk of [0, S * 3, S * N * 3, (S * N + S) * 3]) r = Math.max(r, Math.hypot(GP[kk] - GP[kc], GP[kk + 1] - GP[kc + 1], GP[kk + 2] - GP[kc + 2]));
      this.radius[i] = r + hT;
      const o = i * EMBED_STRIDE;
      ed[o] = top.x; ed[o + 1] = top.y; ed[o + 2] = top.z; ed[o + 3] = 1;
      ed[o + 4] = nx; ed[o + 5] = ny; ed[o + 6] = nz; ed[o + 7] = 0;
      ed[o + 8] = t.x; ed[o + 9] = t.y; ed[o + 10] = t.z; ed[o + 11] = par ? -1 : 1;
      const tt = this.tileType[i];
      if (tt) {
        const im = this.motifs[tt];
        const sc = MOTIF.fill * 0.85 * motifScale(0.35) * Math.min(1.18, tileSize * 0.95) * (1 - MOTIF.strainShrink * this.strainK[i]);
        this.m4.makeBasis(t, bt, nv);
        this.m4.setPosition(GP[kc] + nx * hT * 0.55, GP[kc + 1] + ny * hT * 0.55, GP[kc + 2] + nz * hT * 0.55);
        this.m4.scale(this.sc.set(sc, sc, sc));
        im.setColorAt(im.count, this.cc.setRGB(this.tint[i * 3], this.tint[i * 3 + 1], this.tint[i * 3 + 2]));
        im.setMatrixAt(im.count++, this.m4);
      }
    }
    this.embed.pitch = cell + ((surf === 'klein' ? 1.1 : 1.3) - cell) * smooth(this.morph);
    bumpRev(this.embed);
    for (const name of ['position', 'normal', 'aLift']) this.geom.attributes[name].needsUpdate = true;
    for (const t of TILE_TYPES) {
      this.motifs[t].instanceMatrix.needsUpdate = true;
      if (this.motifs[t].instanceColor) this.motifs[t].instanceColor!.needsUpdate = true;
    }
    if (parityChanged) this.colourDirty = true;
  }

  update(s: GameState, _perTile: readonly number[], hover: number, hoverAdj?: readonly number[], hl?: BoardHighlight) {
    const lit = hl?.lit && (hl.dim ?? 0) > 0 ? `${hl.lit.join()}|${Math.round((hl.dim ?? 0) * 20)}` : '';
    const key = `${s.tiles.join()}|${s.ring}|${s.pinned.join()}|${hover}|${(hl?.direct ?? hoverAdj ?? []).join()}|${hl?.bridge?.join() ?? ''}|${hl?.bridge?.length ? Math.round((hl.pulse ?? 0) * 8) : 0}|${lit}|${this.loopCells.size}`;
    if (key !== this.styleKey) (this.styleKey = key), this.restyle(s, hover, hoverAdj, hl);
    if (this.layoutDirty) this.layout();
    if (this.colourDirty) this.writeColours();
    this.overlayConstellations(hl);
  }

  /** Constellation links between tile tops, lifted off the surface along the tile normals. */
  overlayConstellations(hl?: BoardHighlight) {
    const pulse = hl?.constellationPulse ?? 0;
    this.edgeLines(this.lines.pulse, hl?.constellation, 0.12, (0.55 + 0.45 * pulse) * CONSTELLATION.opacityPulse);
    this.edgeLines(this.lines.faint, hl?.constellationPermanent, 0.08, CONSTELLATION.opacityComplete * 0.85);
    this.edgeLines(this.lines.ghost, hl?.constellationGhost, 0.1, CONSTELLATION.opacityGhost);
  }

  private edgeLines(l: THREE.LineSegments, edges: readonly (readonly [number, number])[] | undefined, lift: number, opacity: number) {
    (l.material as THREE.LineBasicMaterial).opacity = opacity * this.extFade;
    if (!edges?.length) return void (l.visible = false);
    const attr = l.geometry.attributes.position as THREE.BufferAttribute, a = attr.array as Float32Array;
    let k = 0;
    for (const [p, q] of edges) {
      if (k + 6 > a.length || !this.tops[p] || !this.tops[q]) continue;
      if (this.embed.seam!(p, q)) continue; // never draw across a cut of the chart
      for (const i of [p, q]) {
        const t = this.tops[i];
        a[k++] = t.x + this.normals[i * 3] * lift; a[k++] = t.y + this.normals[i * 3 + 1] * lift; a[k++] = t.z + this.normals[i * 3 + 2] * lift;
      }
    }
    l.geometry.setDrawRange(0, k / 3);
    attr.needsUpdate = true;
    l.visible = k > 0;
  }

  /** Inspect ink-flow arches. */
  overlayFlow(hl: BoardHighlight | undefined, reducedMotion: boolean) {
    this.flowArch.update(hl?.flowLinks ?? [], this.tops, hl?.flowPhase ?? 0, reducedMotion);
  }

  /** Per frame: fold / cross-fade, flow inertia and Centre easing, loop race. `now` is fx time in seconds. */
  tick(now: number, reduced = false) {
    this.reducedMotion = reduced;
    const dt = this.lastNow < 0 ? 0 : Math.min(0.1, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    this.uClock.value = reduced ? 1e9 : now;
    if (this.cross >= 0) {
      const before = this.cross;
      this.cross = Math.min(1, this.cross + dt / CROSS_S);
      if (before < 0.5 && this.cross >= 0.5) (this.morph = this.morphTo), (this.layoutDirty = true);
      if (this.cross >= 1) this.cross = -1;
      this.applyFade();
    } else if (this.morph !== this.morphTo) {
      if (reduced) this.cross = 0;
      else {
        const step = dt / FOLD_S;
        this.morph = this.morphTo > this.morph ? Math.min(this.morphTo, this.morph + step) : Math.max(this.morphTo, this.morph - step);
        this.layoutDirty = true;
        this.syncSkinFade();
      }
    }
    if (this.centreGoal) {
      const g = this.centreGoal, k = 1 - Math.exp(-dt * 5);
      const pu = flowPeriodU(this.surface);
      const du = wrapDelta(this.flow[0], g.fu, pu), dv = wrapDelta(this.flow[1], g.fv, 1);
      const dy = wrapDelta(this.group.rotation.y, g.yaw, Math.PI * 2);
      this.setFlow(this.flow[0] + du * k, this.flow[1] + dv * k);
      this.group.rotation.y += dy * k;
      if (Math.abs(du) < 2e-3 && Math.abs(dv) < 2e-3 && Math.abs(dy) < 4e-3) {
        this.setFlow(g.fu, g.fv); // land exactly (a sliver this small is not visible)
        this.group.rotation.y = g.yaw;
        this.centreGoal = null;
      }
    } else if (this.flowVel[0] || this.flowVel[1]) {
      this.setFlow(this.flow[0] + this.flowVel[0] * dt, this.flow[1] + this.flowVel[1] * dt);
      const damp = Math.pow(0.5, dt / FLOW_DAMP);
      this.flowVel[0] *= damp;
      this.flowVel[1] *= damp;
      if (Math.abs(this.flowVel[0]) + Math.abs(this.flowVel[1]) < 1e-4) this.flowVel[0] = this.flowVel[1] = 0;
    }
    if (this.racePending && !this.centreGoal && !this.flowVel[0] && !this.flowVel[1] && this.morph === this.morphTo) {
      if (this.layoutDirty) this.layout();
      this.startRace(this.racePending, now);
      this.racePending = null;
    }
    if (this.race) {
      const t = (now - this.race.t0) / LOOP_RACE_S;
      this.race.mat.uniforms.uHead.value = Math.min(1.3, t);
      this.race.mat.uniforms.uFade.value = Math.max(0, Math.min(1, (1.3 - t) / 0.3)) * this.extFade;
      if (t >= 1.3 || reduced) this.endRace();
    }
    if (this.layoutDirty) this.layout();
    if (this.colourDirty) this.writeColours();
  }

  /**
   * Flow (and yaw) that bring cell i to face a viewer at camLocal (group-local coords, before yaw). Searches every
   * flow step along the period and, on the Möbius strip and Klein bottle, 24 yaw angles; scores how squarely the
   * tile top faces the viewer.
   */
  centreTarget(i: number, cam: THREE.Vector3): { fu: number; fv: number; yaw: number; score: number } {
    const [x, y] = this.graph.xy[i], W = this.W, H = this.H, surf = this.surface;
    const torus = surf === 'torus', pu = flowPeriodU(surf);
    const nu = W * pu, nv = torus ? H : 1, ny = torus ? 1 : 24;
    let best = { fu: this.flow[0], fv: this.flow[1], yaw: this.group.rotation.y, score: -2 };
    const F = this.F, out = this.tmp, c = this.v4;
    for (let a = 0; a < nu; a++) {
      for (let b = 0; b < nv; b++) {
        const fu = a / W, fv = torus ? b / H : 0;
        const par = flowCell(surf, x + 0.5, y + 0.5, W, H, fu, fv, out);
        shapeFrame(surf, out[0], out[1], W, H, 1, F);
        const s = surf === 'mobius' && par ? -1 : 1;
        for (let k = 0; k < ny; k++) {
          const yaw = torus ? this.group.rotation.y : (k / ny) * Math.PI * 2;
          c.copy(cam).applyAxisAngle(this.v5.set(0, 1, 0), -yaw);
          const dx = c.x - F[0], dy = c.y - F[1], dz = c.z - F[2], L = Math.hypot(dx, dy, dz) || 1;
          const sc = (s * (F[3] * dx + F[4] * dy + F[5] * dz)) / L;
          const turn = Math.abs(wrapDelta(this.group.rotation.y, yaw, Math.PI * 2)) * 0.02;
          if (sc - turn > best.score) best = { fu: wrapTo(fu, pu), fv, yaw, score: sc - turn };
        }
      }
    }
    return best;
  }

  /** Eases the flow (and yaw) so cell i faces a camera at camWorld. */
  centreOn(i: number, camWorld?: THREE.Vector3) {
    if (!(i >= 0 && i < this.graph.ring.length) || !camWorld) return;
    this.flowVel[0] = this.flowVel[1] = 0;
    const g = this.centreTarget(i, this.localCam(camWorld));
    // flowCell starts each search at fu = 0; pick the representative of g.fu nearest the current flow
    this.centreGoal = { fu: g.fu, fv: g.fv, yaw: g.yaw };
  }

  /** How squarely cell i faces the camera now (1 = head on, ≤ 0 = turned away). */
  facing(i: number, camWorld: THREE.Vector3): number {
    this.group.updateMatrixWorld();
    const p = this.v4.copy(this.tops[i]).applyMatrix4(this.group.matrixWorld);
    const n = this.v5.set(this.normals[i * 3], this.normals[i * 3 + 1], this.normals[i * 3 + 2]).transformDirection(this.group.matrixWorld);
    const d = this.v3.copy(camWorld).sub(p).normalize();
    const f = n.dot(d);
    return this.surface === 'mobius' ? Math.abs(f) : f;
  }

  /** Camera position in group-local coords with the yaw removed (yaw is searched separately). */
  private localCam(camWorld: THREE.Vector3) {
    this.group.updateMatrixWorld();
    const yaw = this.group.rotation.y;
    return this.v1.copy(camWorld).applyMatrix4(this.inv.copy(this.group.matrixWorld).invert()).applyAxisAngle(this.v2.set(0, 1, 0), yaw);
  }

  /**
   * The tile under a ray: nearest hit on any tile top whose face points at the viewer (both faces count on the
   * Möbius slab). Glass and far-side tiles behind it never win. Unsurveyed cells are pickable (the tooltip says so).
   */
  pickRay(raycaster: THREE.Raycaster): number {
    this.group.updateMatrixWorld();
    const r = this.ray.copy(raycaster.ray).applyMatrix4(this.inv.copy(this.group.matrixWorld).invert());
    const pos = this.geom.attributes.position.array as Float32Array, S = this.S, N = this.N;
    let best = -1, bd = Infinity;
    const a = this.v1, b = this.v2, c = this.v3, hit = this.v4;
    for (let i = 0; i < this.graph.ring.length; i++) {
      if (r.distanceSqToPoint(this.tops[i]) > this.radius[i] * this.radius[i]) continue;
      const nd = r.direction.x * this.normals[i * 3] + r.direction.y * this.normals[i * 3 + 1] + r.direction.z * this.normals[i * 3 + 2];
      if (nd >= 0 && this.surface !== 'mobius') continue;
      const base = i * this.vpt;
      for (let p = 0; p < S; p++) {
        for (let q = 0; q < S; q++) {
          const v00 = (base + p * N + q) * 3, v10 = v00 + N * 3, v01 = v00 + 3, v11 = v10 + 3;
          for (const [x, y, z] of [[v00, v01, v10], [v10, v01, v11]]) {
            a.fromArray(pos, x); b.fromArray(pos, y); c.fromArray(pos, z);
            if (!r.intersectTriangle(a, b, c, false, hit)) continue;
            const d = hit.distanceToSquared(r.origin);
            if (d < bd) (bd = d), (best = i);
          }
        }
      }
    }
    return best;
  }

  /** Flat-plane pick (unused on surfaces: picking is by ray, see pickRay). */
  pick(): number { return -1; }

  markPlaced(i: number, now: number) {
    if (!(i >= 0 && i < this.graph.ring.length)) return;
    const a = this.geom.attributes.born as THREE.BufferAttribute;
    (a.array as Float32Array).fill(now, i * this.vpt, (i + 1) * this.vpt);
    a.needsUpdate = true;
  }

  /** Survey ripple: cells rise and flash in turn from the patch edge outward (delays from revealSpans). */
  markRevealed(indices: readonly number[], now: number, delays: readonly number[]) {
    if (!Number.isFinite(now)) return;
    const a = this.geom.attributes.revealAt as THREE.BufferAttribute, arr = a.array as Float32Array;
    indices.forEach((i, j) => {
      if (!Number.isInteger(i) || i < 0 || i >= this.graph.ring.length) return;
      const d = delays[j];
      arr.fill(now + (Number.isFinite(d) && d > 0 ? d : 0), i * this.vpt, (i + 1) * this.vpt);
    });
    a.needsUpdate = true;
  }

  /** Closed loops: cells that keep a permanent gold glow. */
  setLoopCells(cells: Iterable<number>) {
    const next = new Set(cells);
    if (next.size === this.loopCells.size && [...next].every((c) => this.loopCells.has(c))) return;
    this.loopCells = next;
    this.styleKey = '';
  }

  /** A gold band races once around the loop (cells in order), then fades; the loop keeps its glow. It starts once the
   *  surface has settled (a Centre ease or flick in progress would slide the cells out from under it). */
  raceLoop(loop: readonly number[], _now?: number) {
    this.endRace();
    this.racePending = loop.length >= 2 ? loop.slice() : null;
  }

  private startRace(loop: readonly number[], now: number) {
    const pts = loop.map((i) => new THREE.Vector3(
      this.tops[i].x + this.normals[i * 3] * 0.14, this.tops[i].y + this.normals[i * 3 + 1] * 0.14, this.tops[i].z + this.normals[i * 3 + 2] * 0.14,
    ));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    const mat = new THREE.ShaderMaterial({
      uniforms: { uHead: { value: 0 }, uFade: { value: 1 }, uCol: { value: col(SURFACE.loopGold) } },
      vertexShader: 'varying float vU; void main() { vU = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uHead; uniform float uFade; uniform vec3 uCol; varying float vU;
void main() {
  float behind = uHead - vU;
  float trail = behind < 0.0 ? 0.0 : exp(-behind * 6.0);
  float lit = step(vU, uHead) * 0.35;
  gl_FragColor = vec4(uCol * (0.6 + 2.4 * trail), (lit + trail) * uFade);
}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, loop.length * 10, 0.07, 6, true), mat);
    mesh.renderOrder = 9;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.race = { mesh, t0: now, mat };
  }

  private endRace() {
    this.racePending = null;
    if (!this.race) return;
    this.group.remove(this.race.mesh);
    this.race.mesh.geometry.dispose();
    this.race.mat.dispose();
    this.race = null;
  }

  /** Whole-board fade/warp for prestige transitions; multiplies each material's own opacity (the glass keeps its alpha). */
  setFade(a = 1, warp = 0) {
    this.extFade = Math.max(0, Math.min(1, a));
    this.applyFade();
    this.group.scale.setScalar(1 - 0.35 * warp);
  }

  private applyFade() {
    if (!this.fadeMats) {
      this.fadeMats = [];
      const skip = new Set([...this.skinMats, ...this.decoMats].map((x) => x.m));
      this.group.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o === this.race?.mesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!skip.has(m)) this.fadeMats!.push({ m, base: m.opacity, tr: m.transparent });
        }
      });
    }
    const f = this.extFade * this.crossAlpha();
    for (const { m, base, tr } of this.fadeMats) {
      const want = tr || f < 0.999;
      if (m.transparent !== want) (m.transparent = want), (m.needsUpdate = true);
      m.opacity = base * f;
    }
    this.syncSkinFade();
  }

  dispose() {
    this.endRace();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((x: THREE.Material) => x.dispose());
      }
    });
  }

  cellWorld(i: number) {
    const t = this.tops[i];
    return { c: [t.x, t.z] as [number, number], corner: [t.x + 0.4, t.z + 0.4] as [number, number] };
  }

  /** Swaps the primitive motifs for GLB geometry (see tile-models.ts). Mill housing and wheel are merged, static here. */
  useModels(models: TileModels) {
    const set = prepareMotifs(models);
    for (const t of TILE_TYPES) {
      let geo = set.geos[t];
      if (t === 'mill' && models.mill_wheel) {
        const w = set.wheel.clone().translate(set.wheelAt.x, set.wheelAt.y, set.wheelAt.z);
        geo = merged([geo.clone(), w]);
      }
      if (geo) this.motifs[t].geometry.dispose(), (this.motifs[t].geometry = geo);
    }
    this.fadeMats = null;
  }

  viewMatrix(): number[] { return [1, 0, 0, 0, 1, 0, 0, 0, 1]; }
  recenter() { this.stopFlow(); this.setFlow(0, 0); }
  pan() {}
}
