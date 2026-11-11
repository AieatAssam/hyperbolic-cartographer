import * as THREE from 'three';
import type { GameState } from '../core/state';
import type { SurfaceGraph } from '../core/geometry/quotient';
import { type SurfacePreview } from '../core/state';
import {
  BOARD, EMPTY_SLOT, MATERIAL, NEXT_SLOT, PLACE, TILE_IDENTITIES, bevelColour, hoverFace, lerpHex, motifScale, sideColour,
  tileHeight, trimGlow, SURFACE,
} from '../art/palette';
import { placeGlsl } from './transition';
import { bumpRev, createEmbedding, frameAt, writeFrame, type Embedding } from './fx-graph';
import { embedKlein, embedKleinImmersion, embedTorus } from './embed-providers';
import type { TileType } from '../core/tiles';
import { TILE_TYPES } from '../core/tiles';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TileModels } from './tile-models';
import { config } from '../core/config';
import {
  chartCell, kleinBoundingRadius, surfaceFrame, TILE_GAP, type Flow, type Surface3d,
  torusBoundingRadius,
} from './surface-params';
import { buildKleinImmersionSkin, buildSelfIntersectionLine, buildTorusSkin } from './surface-skin';
import { buildChartSeams, buildEdgeGhosts } from './surface-deco';
import { circlePts } from './framing';

const GAP = 0.85;
const INSET = 0.8;
const PER_K = 15;
const K = 4;
/** Bounding radius for the 3D tile geometry (set once; the mesh is never frustum-culled). */
const SPHERE_R = 40;

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
  seamA: col(SURFACE.seamA), seamB: col(SURFACE.seamB), seamFlip: col(SURFACE.seamFlip),
  ghost: col(SURFACE.ghost),
};

/** Per-tile vertex attributes (position, normal, color, glow) plus the per-vertex placement clock. */
function tileGeometry(verts: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  for (const name of ['born', 'revealAt'])
    geo.setAttribute(name, new THREE.BufferAttribute(new Float32Array(verts).fill(-1e4), 1));
  for (const name of ['position', 'normal', 'color', 'glow'])
    geo.setAttribute(name, new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
  return geo;
}

function markBorn(geo: THREE.BufferGeometry, i: number, span: number, now: number) {
  const a = geo.attributes.born as THREE.BufferAttribute;
  (a.array as Float32Array).fill(now, i * span, (i + 1) * span);
  a.needsUpdate = true;
}

/** Manifold preview board (torus 3D / chart, Klein square, Klein immersion). */
export class SurfaceBoard {
  readonly group = new THREE.Group();
  readonly tops: THREE.Vector3[];
  readonly embed: Embedding;
  readonly graph: SurfaceGraph;
  chartMode = false;
  seamView = true;
  immersion3d = false;
  /** Tiling shift in turns of the torus period, [u, v] in [0, 1). Ignored on Klein. */
  flow: [number, number] = [0, 0];
  private readonly geom: THREE.BufferGeometry;
  private readonly geom3d: THREE.BufferGeometry;
  private readonly S: number;
  /** Vertices per tile in the curved 3D geometry: 6·S² top triangles + 24·S wall triangle vertices. */
  private readonly vpt3d: number;
  private readonly gridP: Float64Array;
  private readonly gridN: Float64Array;
  private hidden: Uint8Array;
  private lastRing = 99;
  private skinKey = '';
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
  private readonly tileMesh: THREE.Mesh;
  private readonly uBackDim = { value: 1 };
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
    this.S = config.manifold.patchSubdiv;
    this.vpt3d = 6 * this.S * this.S + 24 * this.S;
    this.gridP = new Float64Array((this.S + 1) * (this.S + 1) * 3);
    this.gridN = new Float64Array((this.S + 1) * (this.S + 1) * 3);
    this.hidden = new Uint8Array(n);
    this.embed = createEmbedding(n);
    this.tops = graph.ring.map(() => new THREE.Vector3());
    this.geom = tileGeometry(n * K * PER_K);
    this.geom3d = tileGeometry(n * this.vpt3d);
    this.geom3d.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SPHERE_R);
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
        .replace('#include <common>', `#include <common>\nattribute float born;\nuniform float uFxClock;\nuniform float uBackDim;\n${placeGlsl()}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nfloat sqT = uFxClock - born;\nif (sqT >= 0.0 && sqT < ${PLACE.life.toFixed(2)}) transformed.y *= placeScale(sqT);`);
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <output_fragment>',
        'if (!gl_FrontFacing) { diffuseColor.rgb *= uBackDim; }\n#include <output_fragment>',
      );
      sh.uniforms.uFxClock = this.uClock;
      sh.uniforms.uBackDim = this.uBackDim;
    };
    const mesh = new THREE.Mesh(this.geom, mat);
    mesh.frustumCulled = false;
    mesh.name = 'surface-tiles';
    this.tileMesh = mesh;
    this.skinGroup.renderOrder = -10;
    this.decoGroup.renderOrder = 4;
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
      im.renderOrder = 3;
      this.motifs[t] = im;
      this.group.add(im);
    }
    this.ghostGroup.name = 'seam-ghosts';
    this.ghostGroup.renderOrder = 5;
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

  /** Sets the torus tiling shift (wrapped to [0, 1)). Klein has no flow: the glide tears under any v-shift. */
  setFlow(u: number, v: number) {
    const wrap = (t: number) => ((t % 1) + 1) % 1;
    this.flow = [wrap(u), this.surface === 'torus' ? wrap(v) : 0];
  }

  /** The 3D surface name (only called on the curved 3D path, where surface is torus or klein). */
  private surface3d(): Surface3d {
    return this.surface === 'klein' ? 'klein' : 'torus';
  }

  private flowObj(): Flow {
    return { u: this.flow[0], v: this.flow[1] };
  }

  private clearGroup(g: THREE.Group) {
    while (g.children.length) {
      const ch = g.children[0];
      g.remove(ch);
      if (ch instanceof THREE.Group) {
        this.clearGroup(ch);
        continue;
      }
      if (ch instanceof THREE.Mesh || ch instanceof THREE.Line || ch instanceof THREE.InstancedMesh) {
        ch.geometry.dispose();
        const m = ch.material;
        (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
      }
    }
  }

  private kleinGlass() {
    return this.surface === 'klein' && this.immersion3d;
  }

  private syncTilePresentation() {
    const kleinGlass = this.kleinGlass();
    const mat = this.tileMesh.material as THREE.MeshStandardMaterial;
    mat.transparent = kleinGlass;
    mat.opacity = kleinGlass ? config.manifold.kleinTileAlpha : 1;
    mat.depthWrite = true;
    this.uBackDim.value = kleinGlass ? config.manifold.kleinBackfaceDim : 1;
    this.tileMesh.renderOrder = kleinGlass ? 2 : 0;
    for (const t of TILE_TYPES) {
      const im = this.motifs[t];
      im.renderOrder = kleinGlass ? 3 : 0;
      (im.material as THREE.MeshStandardMaterial).depthWrite = true;
    }
  }

  private syncSkin() {
    this.clearGroup(this.skinGroup);
    if (this.surface === 'torus' && !this.chartMode) {
      this.skinGroup.add(buildTorusSkin(this.envMap));
    } else if (this.surface === 'klein' && this.immersion3d) {
      this.skinGroup.add(buildKleinImmersionSkin(this.envMap));
      this.skinGroup.add(buildSelfIntersectionLine());
    }
    this.syncTilePresentation();
  }

  private syncDeco() {
    this.clearGroup(this.decoGroup);
    if (!this.seamView) return;
    if (this.isChartFlat()) {
      this.decoGroup.add(buildChartSeams(this.graph, this.surface === 'klein'));
      this.decoGroup.add(buildEdgeGhosts(this.graph, this.surface === 'klein'));
    }
  }

  private syncEmbedding() {
    const g = this.graph;
    if (this.surface === 'torus') embedTorus(g, this.embed, { chart: this.chartMode, flow: this.flowObj() });
    else if (this.immersion3d) embedKleinImmersion(g, this.embed, { flow: this.flowObj() });
    else embedKlein(g, this.embed, {});
  }

  invalidate() { this.meshKey = ''; }

  private tileCorners(i: number): { c: THREE.Vector3; n: THREE.Vector3; t: THREE.Vector3; pts: THREE.Vector3[]; scale: number } {
    const [x, y] = this.graph.xy[i];
    const g = this.graph;
    const flat = this.isChartFlat();
    if (!flat) {
      // Curved 3D: the tile frame sits at the cell centre; the patch itself is sampled in emitCurved.
      const f = surfaceFrame(this.surface3d(), x + 0.5, y + 0.5, g.width, g.height, this.flowObj());
      return {
        c: new THREE.Vector3(...f.skin),
        n: new THREE.Vector3(...f.n),
        t: new THREE.Vector3(...f.t),
        pts: [],
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
    const half = cell * 0.5 * (1 - TILE_GAP()) * Math.max(0.05, f.s);
    const pts = [
      c.clone().addScaledVector(t, -half).addScaledVector(b, -half),
      c.clone().addScaledVector(t, half).addScaledVector(b, -half),
      c.clone().addScaledVector(t, half).addScaledVector(b, half),
      c.clone().addScaledVector(t, -half).addScaledVector(b, half),
    ];
    return { c, n, t, pts, scale: f.s };
  }

  /**
   * Curved 3D tile: an S×S top sampled on the surface (lifted along the normal by h) with perimeter walls
   * down to the surface. Writes vpt3d vertices at this tile's slot in geom3d. Hidden tiles collapse to a point.
   */
  private emitCurved(i: number, faceCol: THREE.Color, sideCol: THREE.Color, glowCol: THREE.Color, h: number, ins: number, hidden: boolean, centre: THREE.Vector3) {
    const S = this.S, N = S + 1;
    const g = this.graph;
    const [x, y] = g.xy[i];
    const pos = this.geom3d.attributes.position.array as Float32Array;
    const nrm = this.geom3d.attributes.normal.array as Float32Array;
    const colA = this.geom3d.attributes.color.array as Float32Array;
    const glowA = this.geom3d.attributes.glow.array as Float32Array;
    const gp = this.gridP, gn = this.gridN;
    const half = hidden ? 0 : 0.5 * ins;
    const hTop = hidden ? 0 : h;
    const flow = this.flowObj();
    for (let a = 0; a <= S; a++) {
      for (let b = 0; b <= S; b++) {
        const f = surfaceFrame(this.surface3d(), x + 0.5 + (2 * a / S - 1) * half, y + 0.5 + (2 * b / S - 1) * half, g.width, g.height, flow, 0);
        const k = (a * N + b) * 3;
        gp[k] = f.p[0]; gp[k + 1] = f.p[1]; gp[k + 2] = f.p[2];
        gn[k] = f.n[0]; gn[k + 1] = f.n[1]; gn[k + 2] = f.n[2];
      }
    }
    let v = i * this.vpt3d;
    const put = (px: number, py: number, pz: number, nx: number, ny: number, nz: number, cc: THREE.Color, gl: THREE.Color) => {
      const j = v * 3;
      pos[j] = px; pos[j + 1] = py; pos[j + 2] = pz;
      nrm[j] = nx; nrm[j + 1] = ny; nrm[j + 2] = nz;
      colA[j] = cc.r; colA[j + 1] = cc.g; colA[j + 2] = cc.b;
      glowA[j] = gl.r; glowA[j + 1] = gl.g; glowA[j + 2] = gl.b;
      v++;
    };
    // Grid sample (a, b) lifted by `lift` along its normal.
    const vtx = (a: number, b: number, lift: number, cc: THREE.Color, gl: THREE.Color) => {
      const k = (a * N + b) * 3;
      put(gp[k] + gn[k] * lift, gp[k + 1] + gn[k + 1] * lift, gp[k + 2] + gn[k + 2] * lift, gn[k], gn[k + 1], gn[k + 2], cc, gl);
    };
    for (let a = 0; a < S; a++) {
      for (let b = 0; b < S; b++) {
        vtx(a, b, hTop, faceCol, glowCol);
        vtx(a + 1, b, hTop, faceCol, glowCol);
        vtx(a, b + 1, hTop, faceCol, glowCol);
        vtx(a + 1, b, hTop, faceCol, glowCol);
        vtx(a + 1, b + 1, hTop, faceCol, glowCol);
        vtx(a, b + 1, hTop, faceCol, glowCol);
      }
    }
    // Perimeter walls: one quad per boundary segment, top edge down to the surface.
    const wall = (a0: number, b0: number, a1: number, b1: number) => {
      const k0 = (a0 * N + b0) * 3, k1 = (a1 * N + b1) * 3;
      const mx = (gp[k0] + gp[k1]) / 2 - centre.x, my = (gp[k0 + 1] + gp[k1 + 1]) / 2 - centre.y, mz = (gp[k0 + 2] + gp[k1 + 2]) / 2 - centre.z;
      const tx = gp[k1] - gp[k0], ty = gp[k1 + 1] - gp[k0 + 1], tz = gp[k1 + 2] - gp[k0 + 2];
      const sx = gn[k0] + gn[k1], sy = gn[k0 + 1] + gn[k1 + 1], sz = gn[k0 + 2] + gn[k1 + 2];
      let wx = ty * sz - tz * sy, wy = tz * sx - tx * sz, wz = tx * sy - ty * sx;
      const wl = Math.hypot(wx, wy, wz) || 1;
      wx /= wl; wy /= wl; wz /= wl;
      if (wx * mx + wy * my + wz * mz < 0) { wx = -wx; wy = -wy; wz = -wz; }
      const t0 = (k: number, c: number, lift: number) => gp[k + c] + gn[k + c] * lift;
      const put4 = (k: number, lift: number) => put(t0(k, 0, lift), t0(k, 1, lift), t0(k, 2, lift), wx, wy, wz, sideCol, C.black);
      put4(k0, hTop); put4(k0, 0); put4(k1, hTop);
      put4(k1, hTop); put4(k0, 0); put4(k1, 0);
    };
    for (let a = 0; a < S; a++) {
      wall(a, 0, a + 1, 0);
      wall(a, S, a + 1, S);
      wall(0, a, 0, a + 1);
      wall(S, a, S, a + 1);
    }
  }

  private rebuildMesh(g: SurfaceGraph, s: Pick<GameState, 'tiles' | 'ring'>) {
    this.lastRing = s.ring;
    this.syncEmbedding();
    const n = g.ring.length;
    const manifold3d = !this.isChartFlat();
    const geo = manifold3d ? this.geom3d : this.geom;
    if (this.tileMesh.geometry !== geo) this.tileMesh.geometry = geo;
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
    const kleinGlass = this.kleinGlass();
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
        if (manifold3d) glow.multiplyScalar(1.22);
        const trimK = trimGlow(L) * (kleinGlass ? 1.55 : manifold3d ? 1.25 : 1);
        trim.copy(tk.emissive).multiplyScalar(trimK);
        if (manifold3d) {
          border.copy(col(lerpHex(TILE_IDENTITIES[t].accent, SURFACE.skinGrid, kleinGlass ? 0.25 : 0.15)));
          ins = 0.66;
        }
      } else if (active || next) {
        h = active ? MATERIAL.slotHeight : MATERIAL.nextHeight;
        let edge = active ? C.slotBorder : C.nextBorder;
        let face = active ? C.slot : C.next;
        if (kleinGlass && active) {
          face = col(lerpHex(EMPTY_SLOT.base, SURFACE.skinInk, 0.38));
          edge = col(lerpHex(EMPTY_SLOT.accent, SURFACE.skinGrid, 0.5));
        } else if (manifold3d && active) {
          edge = col(lerpHex(EMPTY_SLOT.accent, SURFACE.skinGrid, 0.28));
        }
        c.copy(face);
        side.copy(kleinGlass && active ? col(sideColour(lerpHex(EMPTY_SLOT.base, SURFACE.skin, 0.2))) : C.slotSide);
        glow.copy(active ? (kleinGlass ? col(lerpHex(EMPTY_SLOT.emissive, SURFACE.skinInk, 0.35)) : C.slotGlow) : C.black);
        border.copy(edge);
        const trimMul = kleinGlass && active ? 0.55 : EMPTY_SLOT.restTrim;
        trim.copy(glow).multiplyScalar(trimMul);
        if (manifold3d && active) {
          ins = kleinGlass ? 0.9 : 0.91;
          if (!kleinGlass) trim.multiplyScalar(0.85);
        } else if (!active) ins = EMPTY_SLOT.restInset;
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
        const sc = 0.85 * motifScale(L) * (manifold3d ? 1.18 : 1);
        this.m4.setPosition(
          o.c.x + norm.x * h * 0.55,
          o.c.y + norm.y * h * 0.55,
          o.c.z + norm.z * h * 0.55,
        );
        this.sc.set(sc, sc, sc);
        this.m4.scale(this.sc);
        im.setMatrixAt(im.count++, this.m4);
      }
      const hiddenTile = o.scale <= 0;
      this.hidden[i] = hiddenTile ? 1 : 0;
      if (manifold3d) {
        this.emitCurved(i, c, side, glow, h, ins, hiddenTile, o.c);
        continue;
      }
      const hidden = hiddenTile;
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
      const seamBorderAt = (k: number) => {
        for (const j of g.neighbours[i]) {
          if (!g.seamEdge(i, j)) continue;
          const [ax, ay] = g.xy[i], [bx, by] = g.xy[j];
          const dx = bx - ax, dy = by - ay;
          if (Math.abs(dx) > 1 && Math.abs(dy) > 1) continue;
          const hit = k === (dx > 0 || dy > 0 ? 1 : 3) % 4 || k === (dx > 0 || dy > 0 ? 2 : 0);
          if (!hit) continue;
          if (g.flipEdge(i, j)) return C.seamFlip;
          return dy !== 0 ? C.seamB : C.seamA;
        }
        return border;
      };
      for (let k = 0; k < K; k++) {
        const p = hidden ? o.c : o.pts[k];
        const q = hidden ? o.c : o.pts[(k + 1) % K];
        const pTop = hidden ? topC : topPts[k];
        const qTop = hidden ? topC : topPts[(k + 1) % K];
        const pBev = hidden ? topC : bevelPts[k];
        const qBev = hidden ? topC : bevelPts[(k + 1) % K];
        const ax = insetAt(pTop), bx = insetAt(qTop);
        const seam = seamEdge(k);
        const bord = seam ? seamBorderAt(k) : border;
        const rimTrim = trim.clone();
        if (seam) rimTrim.multiplyScalar(t ? 1.35 : 0.65);
        put(topC.x, topC.y, topC.z, c, glow);
        put(bx.x, bx.y, bx.z, c, glow);
        put(ax.x, ax.y, ax.z, c, glow);
        put(ax.x, ax.y, ax.z, bord, rimTrim);
        put(bx.x, bx.y, bx.z, bord, rimTrim);
        put(qBev.x, qBev.y, qBev.z, bord, rimTrim);
        put(ax.x, ax.y, ax.z, bord, rimTrim);
        put(qBev.x, qBev.y, qBev.z, bord, rimTrim);
        put(pBev.x, pBev.y, pBev.z, bord, rimTrim);
        put(pBev.x, pBev.y, pBev.z, side, C.black);
        put(qBev.x, qBev.y, qBev.z, side, C.black);
        put(q.x, q.y, q.z, side, C.black);
        put(pBev.x, pBev.y, pBev.z, side, C.black);
        put(q.x, q.y, q.z, side, C.black);
        put(p.x, p.y, p.z, side, C.black);
      }
      if (this.seamView && !manifold3d) {
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
    if (!manifold3d) this.geom.computeVertexNormals();
    bumpRev(embed);
    for (const name of ['position', 'normal', 'color', 'glow']) geo.attributes[name].needsUpdate = true;
    for (const t of TILE_TYPES) this.motifs[t].instanceMatrix.needsUpdate = true;
    const skinKey = `${this.surface}|${this.chartMode}|${this.immersion3d}|${this.seamView}`;
    if (skinKey !== this.skinKey) {
      this.skinKey = skinKey;
      this.syncSkin();
      this.syncDeco();
    }
  }

  update(s: GameState, _perTile: number[], hover: number, hoverAdj?: number[]) {
    const key = `${s.tiles.join()}|${s.ring}|${hover}|${hoverAdj?.join() ?? ''}|${this.chartMode}|${this.seamView}|${this.immersion3d}|${this.flow.join()}`;
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

  /** 3D only: the tile under a ray, via the hit triangle's first vertex (tile = vertex / vpt3d). -1 on miss. */
  pickRay(raycaster: THREE.Raycaster): number {
    if (this.isChartFlat()) return -1;
    const n = this.graph.ring.length;
    for (const hit of raycaster.intersectObject(this.tileMesh, false)) {
      const a = hit.face?.a;
      if (a === undefined) continue;
      const tile = Math.floor(a / this.vpt3d);
      if (tile >= n || this.hidden[tile]) continue;
      if (this.graph.ring[tile] > this.lastRing + 1) continue;
      return tile;
    }
    return -1;
  }

  markPlaced(i: number, now: number) {
    if (!(i >= 0 && i < this.graph.ring.length)) return;
    markBorn(this.geom, i, K * PER_K, now);
    markBorn(this.geom3d, i, this.vpt3d, now);
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
    this.geom.dispose();
    this.geom3d.dispose();
  }

  cellWorld(i: number) {
    const t = this.tops[i];
    return { c: [t.x, t.z] as [number, number], corner: [t.x + 0.4, t.z + 0.4] as [number, number] };
  }
  /** Swaps the primitive motifs for GLB geometry (see tile-models.ts). Mill housing and wheel are merged, static here. */
  useModels(models: TileModels) {
    for (const t of TILE_TYPES) {
      let geo = models[t];
      if (t === 'mill' && models.mill && models.mill_wheel) {
        try { geo = mergeGeometries([models.mill, models.mill_wheel]) ?? geo; } catch { /* keep housing only */ }
      }
      if (geo) this.motifs[t].geometry.dispose(), (this.motifs[t].geometry = geo);
    }
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
    case 'lighthouse': return new THREE.CylinderGeometry(0.07, 0.11, 0.42, 8).translate(0, 0.21, 0);
  }
}
