import * as THREE from 'three';
import type { GameState } from '../core/state';
import type { SurfaceGraph } from '../core/geometry/quotient';
import { type SurfacePreview } from '../core/state';
import {
  BOARD, EMPTY_SLOT, MATERIAL, NEXT_SLOT, PLACE, TILE_IDENTITIES, bevelColour, hoverFace, motifScale, sideColour,
  tileHeight, trimGlow, SURFACE,
} from '../art/palette';
import { placeGlsl } from './transition';
import { bumpRev, createEmbedding, frameAt, writeFrame, type Embedding } from './fx-graph';
import { embedKlein, embedKleinImmersion, embedTorus } from './embed-providers';
import type { TileType } from '../core/tiles';
import { TILE_TYPES } from '../core/tiles';
import { config } from '../core/config';
import {
  chartCell, kleinBoundingRadius, kleinPatchCorners, TILE_GAP,
  torusBoundingRadius, torusPatchCorners,
} from './surface-params';
import {
  buildKleinImmersionSkin, buildSelfIntersectionLine, buildTorusSeamRing, buildTorusSkin,
} from './surface-skin';
import { buildChartSeams, buildEdgeGhosts } from './surface-deco';
import { circlePts } from './framing';

const GAP = 0.85;
const INSET = 0.8;
const PER_K = 15;
const K = 4;

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
  slotBorder: col(EMPTY_SLOT.accent), slotSide: col(sideColour(EMPTY_SLOT.base)),
  next: col(NEXT_SLOT.base), nextBorder: col(NEXT_SLOT.border),
  white: col(BOARD.hover), adj: col(BOARD.adjacency), black: col(0),
  seamA: col(SURFACE.seamA), seamB: col(SURFACE.seamB), ghost: col(SURFACE.ghost),
};

/** Manifold preview board (torus 3D / chart, Klein square, Klein immersion). */
export class SurfaceBoard {
  readonly group = new THREE.Group();
  readonly tops: THREE.Vector3[];
  readonly embed: Embedding;
  readonly graph: SurfaceGraph;
  chartMode = false;
  seamView = true;
  immersion3d = false;
  private geom = new THREE.BufferGeometry();
  private motifs: Record<TileType, THREE.InstancedMesh>;
  private uClock = { value: 0 };
  private meshKey = '';
  private m4 = new THREE.Matrix4();
  private sc = new THREE.Vector3();
  private c = new THREE.Color();
  private side = new THREE.Color();
  private border = new THREE.Color();
  private glow = new THREE.Color();
  private trim = new THREE.Color();
  private ghostGroup = new THREE.Group();
  private skinGroup = new THREE.Group();
  private decoGroup = new THREE.Group();
  private readonly envMap: THREE.Texture | null;

  constructor(
    readonly surface: SurfacePreview,
    graph: SurfaceGraph,
    env: THREE.Texture | null = null,
  ) {
    this.graph = graph;
    this.envMap = env;
    this.chartMode = surface === 'klein';
    const n = graph.ring.length;
    const verts = n * K * PER_K;
    this.embed = createEmbedding(n);
    this.tops = graph.ring.map(() => new THREE.Vector3());
    for (const name of ['born', 'revealAt'])
      this.geom.setAttribute(name, new THREE.BufferAttribute(new Float32Array(verts).fill(-1e4), 1));
    for (const name of ['position', 'normal', 'color', 'glow'])
      this.geom.setAttribute(name, new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const toks = TILE_TYPES.map((t) => TILE_IDENTITIES[t]);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: toks.reduce((a, t) => a + t.roughness, 0) / toks.length,
      metalness: toks.reduce((a, t) => a + t.metalness, 0) / toks.length,
      envMap: env, envMapIntensity: MATERIAL.bodyEnv,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\nattribute float born;\nuniform float uFxClock;\n${placeGlsl()}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nfloat sqT = uFxClock - born;\nif (sqT >= 0.0 && sqT < ${PLACE.life.toFixed(2)}) transformed.y *= placeScale(sqT);`);
      sh.uniforms.uFxClock = this.uClock;
    };
    const mesh = new THREE.Mesh(this.geom, mat);
    mesh.frustumCulled = false;
    this.group.add(this.skinGroup, mesh, this.decoGroup);
    this.motifs = {} as Record<TileType, THREE.InstancedMesh>;
    for (const t of TILE_TYPES) {
      const tk = TILE_IDENTITIES[t];
      const im = new THREE.InstancedMesh(
        motifGeo(t),
        new THREE.MeshStandardMaterial({
          color: tk.emissive, emissive: tk.emissive, emissiveIntensity: tk.emissiveIntensity, roughness: 0.25, metalness: 0,
        }),
        n,
      );
      im.count = 0;
      im.frustumCulled = false;
      this.motifs[t] = im;
      this.group.add(im);
    }
    this.ghostGroup.name = 'seam-ghosts';
    this.group.add(this.ghostGroup);
    this.syncEmbedding();
    this.rebuildMesh(graph, { tiles: graph.ring.map(() => null), ring: 99 });
  }

  /** Ground-plane footprint for camera framing. */
  bounds(): [number, number][] {
    const g = this.graph;
    const chart = this.surface === 'klein' ? !this.immersion3d : this.chartMode;
    if (chart) {
      const cell = chartCell(g.width, g.height);
      const hw = g.width * cell * 0.55, hh = g.height * cell * 0.55;
      return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    }
    if (this.surface === 'torus') return circlePts(torusBoundingRadius(), 64);
    return circlePts(kleinBoundingRadius(), 64);
  }

  isChartFlat() {
    return this.surface === 'klein' ? !this.immersion3d : this.chartMode;
  }

  private clearGroup(g: THREE.Group) {
    while (g.children.length) {
      const ch = g.children[0];
      g.remove(ch);
      if (ch instanceof THREE.Mesh || ch instanceof THREE.Line) {
        ch.geometry.dispose();
        const m = ch.material;
        (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
      }
    }
  }

  private syncSkin() {
    this.clearGroup(this.skinGroup);
    const g = this.graph;
    if (this.surface === 'torus' && !this.chartMode) {
      this.skinGroup.add(buildTorusSkin(g, this.envMap));
      if (this.seamView) this.skinGroup.add(buildTorusSeamRing(g));
    } else if (this.surface === 'klein' && this.immersion3d) {
      this.skinGroup.add(buildKleinImmersionSkin(g, this.envMap));
      this.skinGroup.add(buildSelfIntersectionLine());
    }
  }

  private syncDeco() {
    this.clearGroup(this.decoGroup);
    const g = this.graph;
    if (!this.seamView) return;
    if (this.isChartFlat()) {
      this.decoGroup.add(buildChartSeams(g, this.surface === 'klein'));
      this.decoGroup.add(buildEdgeGhosts(g, this.surface === 'klein'));
    }
  }

  private syncEmbedding() {
    const g = this.graph;
    if (this.surface === 'torus') embedTorus(g, this.embed, { chart: this.chartMode });
    else if (this.immersion3d) embedKleinImmersion(g, this.embed, {});
    else embedKlein(g, this.embed, {});
  }

  invalidate() { this.meshKey = ''; }

  private tileCorners(i: number): { c: THREE.Vector3; n: THREE.Vector3; t: THREE.Vector3; pts: THREE.Vector3[]; scale: number } {
    const [x, y] = this.graph.xy[i];
    const g = this.graph;
    const flat = this.isChartFlat();
    if (!flat && this.surface === 'torus') {
      const patch = torusPatchCorners(x, y, g.width, g.height);
      return {
        c: new THREE.Vector3(...patch.p),
        n: new THREE.Vector3(...patch.n),
        t: new THREE.Vector3(...patch.t),
        pts: patch.corners.map((p) => new THREE.Vector3(...p)),
        scale: 1,
      };
    }
    if (!flat && this.surface === 'klein' && this.immersion3d) {
      const patch = kleinPatchCorners(x, y, g.width, g.height);
      return {
        c: new THREE.Vector3(...patch.p),
        n: new THREE.Vector3(...patch.n),
        t: new THREE.Vector3(...patch.t),
        pts: patch.corners.map((p) => new THREE.Vector3(...p)),
        scale: 1,
      };
    }
    const f = frameAt(this.embed, i);
    const n = new THREE.Vector3(...f.n).normalize();
    const t = new THREE.Vector3(...(f.t ?? [1, 0, 0])).normalize();
    const b = new THREE.Vector3().crossVectors(n, t).normalize();
    t.crossVectors(b, n).normalize();
    const c = new THREE.Vector3(...f.p);
    const cell = chartCell(g.width, g.height);
    const half = (flat ? cell * 0.5 * (1 - TILE_GAP()) : GAP * 0.28) * Math.max(0.05, f.s);
    const pts = [
      c.clone().addScaledVector(t, -half).addScaledVector(b, -half),
      c.clone().addScaledVector(t, half).addScaledVector(b, -half),
      c.clone().addScaledVector(t, half).addScaledVector(b, half),
      c.clone().addScaledVector(t, -half).addScaledVector(b, half),
    ];
    return { c, n, t, pts, scale: f.s };
  }

  private rebuildMesh(g: SurfaceGraph, s: Pick<GameState, 'tiles' | 'ring'>) {
    this.syncEmbedding();
    const n = g.ring.length;
    const pos = this.geom.attributes.position.array as Float32Array;
    const colA = this.geom.attributes.color.array as Float32Array;
    const glowA = this.geom.attributes.glow.array as Float32Array;
    for (const t of TILE_TYPES) this.motifs[t].count = 0;
    while (this.ghostGroup.children.length) {
      const ch = this.ghostGroup.children[0] as THREE.Mesh;
      ch.geometry.dispose();
      (ch.material as THREE.Material).dispose();
      this.ghostGroup.remove(ch);
    }
    const embed = this.embed;
    const { c, side, border, glow, trim } = this;
    for (let i = 0; i < n; i++) {
      const o = this.tileCorners(i);
      const t = s.tiles[i];
      const active = g.ring[i] <= s.ring;
      const next = false;
      const L = t ? 0.35 : 0;
      let h = 0, ins = INSET;
      if (t) {
        const tk = TOK[t];
        h = tileHeight(L);
        c.copy(tk.face);
        side.copy(tk.side);
        border.copy(tk.bevel);
        glow.copy(tk.faceGlow);
        trim.copy(tk.emissive).multiplyScalar(trimGlow(L));
      } else if (active || next) {
        h = active ? MATERIAL.slotHeight : MATERIAL.nextHeight;
        const edge = active ? C.slotBorder : C.nextBorder, face = active ? C.slot : C.next;
        c.copy(face);
        side.copy(C.slotSide);
        glow.copy(active ? C.slotGlow : C.black);
        border.copy(edge);
        trim.copy(glow).multiplyScalar(EMPTY_SLOT.restTrim);
        if (!active) ins = EMPTY_SLOT.restInset;
      } else o.scale = 0;
      if (!this.isChartFlat()) h *= config.manifold.tileExtrude3d;
      h *= o.scale;
      const norm = o.n;
      const topC = o.c.clone().addScaledVector(norm, h);
      const topPts = o.pts.map((p) => p.clone().addScaledVector(norm, h));
      const bevelPts = o.pts.map((p) => p.clone().addScaledVector(norm, h * 0.82));
      this.tops[i].copy(topC);
      writeFrame(embed, i, { p: [topC.x, topC.y, topC.z], s: o.scale, n: [norm.x, norm.y, norm.z], t: [o.t.x, o.t.y, o.t.z], chi: 1 });
      if (t && o.scale > 0.02) {
        const im = this.motifs[t];
        const bit = new THREE.Vector3().crossVectors(norm, o.t).normalize();
        this.m4.makeBasis(o.t, bit, norm);
        const sc = 0.85 * motifScale(L);
        this.m4.setPosition(
          o.c.x + norm.x * h * 0.55,
          o.c.y + norm.y * h * 0.55,
          o.c.z + norm.z * h * 0.55,
        );
        this.sc.set(sc, sc, sc);
        this.m4.scale(this.sc);
        im.setMatrixAt(im.count++, this.m4);
      }
      const hidden = o.scale <= 0;
      const insetAt = (corner: THREE.Vector3) => topC.clone().lerp(corner, ins);
      let v = i * K * PER_K;
      const put = (x: number, y: number, z: number, cc: THREE.Color, gl: THREE.Color) => {
        const j = v * 3;
        pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
        colA[j] = cc.r; colA[j + 1] = cc.g; colA[j + 2] = cc.b;
        glowA[j] = gl.r; glowA[j + 1] = gl.g; glowA[j + 2] = gl.b;
        v++;
      };
      const seamEdge = (k: number) => this.seamView && g.neighbours[i].some((j) => {
        if (!g.seamEdge(i, j)) return false;
        const [ax, ay] = g.xy[i], [bx, by] = g.xy[j];
        const dx = bx - ax, dy = by - ay;
        if (Math.abs(dx) > 1 && Math.abs(dy) > 1) return false;
        void ax; void ay;
        return k === (dx > 0 || dy > 0 ? 1 : 3) % 4 || k === (dx > 0 || dy > 0 ? 2 : 0);
      });
      for (let k = 0; k < K; k++) {
        const p = hidden ? o.c : o.pts[k];
        const q = hidden ? o.c : o.pts[(k + 1) % K];
        const pTop = hidden ? topC : topPts[k];
        const qTop = hidden ? topC : topPts[(k + 1) % K];
        const pBev = hidden ? topC : bevelPts[k];
        const qBev = hidden ? topC : bevelPts[(k + 1) % K];
        const ax = insetAt(pTop), bx = insetAt(qTop);
        const seam = seamEdge(k);
        const bord = seam ? (k % 2 === 0 ? C.seamA : C.seamB) : border;
        put(topC.x, topC.y, topC.z, c, glow);
        put(bx.x, bx.y, bx.z, c, glow);
        put(ax.x, ax.y, ax.z, c, glow);
        put(ax.x, ax.y, ax.z, bord, trim);
        put(bx.x, bx.y, bx.z, bord, trim);
        put(qBev.x, qBev.y, qBev.z, bord, trim);
        put(ax.x, ax.y, ax.z, bord, trim);
        put(qBev.x, qBev.y, qBev.z, bord, trim);
        put(pBev.x, pBev.y, pBev.z, bord, trim);
        put(pBev.x, pBev.y, pBev.z, side, C.black);
        put(qBev.x, qBev.y, qBev.z, side, C.black);
        put(q.x, q.y, q.z, side, C.black);
        put(pBev.x, pBev.y, pBev.z, side, C.black);
        put(q.x, q.y, q.z, side, C.black);
        put(p.x, p.y, p.z, side, C.black);
      }
      if (this.seamView) {
        for (const j of g.neighbours[i]) {
          if (!g.seamEdge(i, j) || j < i) continue;
          const ghost = new THREE.Mesh(
            new THREE.PlaneGeometry(GAP * 0.75, GAP * 0.75),
            new THREE.MeshBasicMaterial({ color: C.ghost, transparent: true, opacity: SURFACE.ghostAlpha, depthWrite: false, side: THREE.DoubleSide }),
          );
          const jc = this.tileCorners(j);
          const gp = jc.c.clone().addScaledVector(jc.n, h * 0.6);
          ghost.position.copy(gp);
          ghost.lookAt(gp.clone().add(jc.n));
          this.ghostGroup.add(ghost);
        }
      }
    }
    this.geom.computeVertexNormals();
    bumpRev(embed);
    for (const name of ['position', 'normal', 'color', 'glow']) this.geom.attributes[name].needsUpdate = true;
    for (const t of TILE_TYPES) this.motifs[t].instanceMatrix.needsUpdate = true;
    this.syncSkin();
    this.syncDeco();
  }

  update(s: GameState, _perTile: number[], hover: number, hoverAdj?: number[]) {
    const key = `${s.tiles.join()}|${s.ring}|${hover}|${hoverAdj?.join() ?? ''}|${this.chartMode}|${this.seamView}|${this.immersion3d}`;
    if (key === this.meshKey) return;
    this.meshKey = key;
    this.rebuildMesh(this.graph, s);
  }

  tick(now: number, _reduced?: boolean) {
    this.uClock.value = now;
  }

  pick(x: number, z: number, s: GameState): number {
    const chart = this.embed.chart2d;
    if (chart) {
      let best = -1, bd = Infinity;
      for (let i = 0; i < this.graph.ring.length; i++) {
        if (this.graph.ring[i] > s.ring + 1) continue;
        const cx = chart[i * 2], cz = chart[i * 2 + 1];
        const d = Math.hypot(cx - x, cz - z);
        const pickR = chartCell(this.graph.width, this.graph.height) * 0.48;
        if (d < bd && d < pickR) (bd = d), (best = i);
      }
      return best;
    }
    return this.graph.xy.findIndex(([gx, gy], i) => {
      if (this.graph.ring[i] > s.ring + 1) return false;
      const d = Math.hypot(gx * GAP - x, gy * GAP - z);
      return d < GAP * 0.45;
    });
  }

  markPlaced(i: number, now: number) {
    if (!(i >= 0 && i < this.graph.ring.length)) return;
    const span = K * PER_K;
    const a = this.geom.attributes.born as THREE.BufferAttribute;
    const born = a.array as Float32Array;
    born.fill(now, i * span, (i + 1) * span);
    a.needsUpdate = true;
  }

  markRevealed() {}
  setFade(a = 1) {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.MeshStandardMaterial;
        if (m.opacity !== undefined) m.opacity = a;
        m.transparent = a < 0.999;
      }
    });
  }

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
      }
    });
  }

  cellWorld(i: number) {
    const t = this.tops[i];
    return { c: [t.x, t.z] as [number, number], corner: [t.x + 0.4, t.z + 0.4] as [number, number] };
  }
  viewMatrix(): number[] { return [1, 0, 0, 0, 1, 0, 0, 0, 1]; }
  recenter() {}
  pan() {}
  centreOn() {}
}

function motifGeo(t: TileType): THREE.BufferGeometry {
  switch (t) {
    case 'spring': return new THREE.SphereGeometry(0.16, 12, 8);
    case 'mill': return new THREE.TorusGeometry(0.15, 0.05, 6, 12).rotateX(Math.PI / 2);
    case 'beacon': return new THREE.ConeGeometry(0.15, 0.4, 6).translate(0, 0.2, 0);
    case 'bridge': return new THREE.TorusGeometry(0.17, 0.045, 6, 12, Math.PI);
    case 'vault': return new THREE.OctahedronGeometry(0.19);
  }
}
