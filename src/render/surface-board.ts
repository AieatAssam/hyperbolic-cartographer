import * as THREE from 'three';
import type { GameState } from '../core/state';
import type { SurfaceGraph } from '../core/geometry/quotient';
import { type SurfacePreview } from '../core/state';
import {
  EMPTY_SLOT, MATERIAL, PLACE, TILE_IDENTITIES, bevelColour, hoverFace, sideColour, tileHeight,
  SURFACE,
} from '../art/palette';
import { placeGlsl } from './transition';
import { bumpRev, createEmbedding, writeFrame, type Embedding } from './fx-graph';
import { embedKlein, embedKleinImmersion, embedTorus } from './embed-providers';
import type { TileType } from '../core/tiles';
import { TILE_TYPES } from '../core/tiles';

const GAP = 0.85;
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
  private key = '';

  constructor(
    readonly surface: SurfacePreview,
    graph: SurfaceGraph,
    env: THREE.Texture | null = null,
  ) {
    this.graph = graph;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.chartMode = surface === 'torus' && coarse;
    const n = graph.ring.length;
    const verts = n * K * PER_K;
    this.embed = createEmbedding(n);
    this.tops = graph.ring.map(() => new THREE.Vector3());
    this.geom.setAttribute('born', new THREE.BufferAttribute(new Float32Array(verts).fill(-1e4), 1));
    this.geom.setAttribute('revealAt', new THREE.BufferAttribute(new Float32Array(verts).fill(-1e4), 1));
    for (const name of ['position', 'normal', 'color', 'glow'])
      this.geom.setAttribute(name, new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.65, metalness: 0.05, envMap: env, envMapIntensity: MATERIAL.bodyEnv,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\nattribute float born;\nattribute float revealAt;\nuniform float uFxClock;\n${placeGlsl()}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nfloat sqT = uFxClock - born;\nif (sqT >= 0.0 && sqT < ${PLACE.life.toFixed(2)}) transformed.y *= placeScale(sqT);`);
      sh.uniforms.uFxClock = this.uClock;
    };
    const mesh = new THREE.Mesh(this.geom, mat);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.motifs = {} as Record<TileType, THREE.InstancedMesh>;
    for (const t of TILE_TYPES) {
      const tk = TILE_IDENTITIES[t];
      const im = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.14, 10, 8),
        new THREE.MeshStandardMaterial({ color: tk.emissive, emissive: tk.emissive, emissiveIntensity: tk.emissiveIntensity }),
        n,
      );
      im.count = 0;
      im.frustumCulled = false;
      this.motifs[t] = im;
      this.group.add(im);
    }
    this.rebuildMesh(graph, initialPreviewState(n));
  }

  private rebuildMesh(g: SurfaceGraph, s: Pick<GameState, 'tiles' | 'ring'>) {
    const n = g.ring.length;
    const pos = this.geom.attributes.position.array as Float32Array;
    const colA = this.geom.attributes.color.array as Float32Array;
    const isTorus = this.surface === 'torus';
    const useChart = this.chartMode || this.surface === 'klein';
    if (isTorus && !this.chartMode) embedTorus(g, this.embed, { chart: false });
    else if (isTorus) embedTorus(g, this.embed, { chart: true });
    else if (this.immersion3d) embedKleinImmersion(g, this.embed, {});
    else embedKlein(g, this.embed, {});
    const cell = GAP;
    for (const t of TILE_TYPES) this.motifs[t].count = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const seamCol = col(SURFACE.seamA);
    const ghostCol = col(SURFACE.ghost);
    for (let i = 0; i < n; i++) {
      const [gx, gy] = g.xy[i];
      let cx: number, cz: number, h = 0.4;
      if (this.surface === 'klein' && this.immersion3d) {
        const u = (gx / g.width) * Math.PI * 2;
        const v = (gy / g.height) * Math.PI * 2;
        const sc = 2.2;
        cx = sc * (Math.cos(u / 2) * Math.sin(v) - Math.sin(u / 2) * Math.sin(2 * v));
        cz = sc * (Math.sin(u / 2) * Math.sin(v) + Math.cos(u / 2) * Math.sin(2 * v));
        h = sc * Math.sin(u / 2) * Math.cos(v) * 2 + 2;
      } else if (isTorus && !useChart) {
        const u = (gx / g.width) * Math.PI * 2, v = (gy / g.height) * Math.PI * 2;
        const R = 5, r = 1.8;
        cx = (R + r * Math.cos(v)) * Math.cos(u);
        cz = (R + r * Math.cos(v)) * Math.sin(u);
        h = r * Math.sin(v) + r + 0.2;
      } else {
        cx = gx * cell;
        cz = gy * cell;
      }
      const t = s.tiles[i];
      const active = g.ring[i] <= s.ring;
      this.tops[i].set(cx, h, cz);
      writeFrame(this.embed, i, { p: [cx, h, cz], s: active ? 1 : 0, n: [0, 1, 0] });
      const face = t ? TOK[t].face : col(EMPTY_SLOT.base);
      let v = i * K * PER_K;
      const put = (x: number, y: number, z: number, cc: THREE.Color) => {
        const j = v * 3;
        pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
        colA[j] = cc.r; colA[j + 1] = cc.g; colA[j + 2] = cc.b;
        v++;
      };
      const hs = t ? tileHeight(0.3) : MATERIAL.slotHeight;
      const half = cell * 0.4;
      if (t && active) {
        m4.compose(this.tops[i], q, sc.setScalar(0.8));
        this.motifs[t].setMatrixAt(this.motifs[t].count++, m4);
      }
      if (!active) continue;
      for (let k = 0; k < K; k++) {
        const ang = (k / K) * Math.PI * 2;
        const px = cx + Math.cos(ang) * half, pz = cz + Math.sin(ang) * half;
        const ang2 = ((k + 1) / K) * Math.PI * 2;
        const qx = cx + Math.cos(ang2) * half, qz = cz + Math.sin(ang2) * half;
        put(cx, hs + h, cz, face);
        put(qx, hs + h, qz, face);
        put(px, hs + h, pz, face);
        const seamN = g.neighbours[i].some((j) => g.seamEdge(i, j) && this.seamView);
        const edgeC = seamN ? seamCol : face;
        put(px, hs + h * 0.9, pz, edgeC);
        put(qx, hs + h * 0.9, qz, edgeC);
        put(qx, h, qz, TOK[t ?? 'spring'].side);
        put(px, h, pz, TOK[t ?? 'spring'].side);
        put(px, hs + h, pz, edgeC);
      }
      if (this.seamView && this.surface === 'klein') {
        g.neighbours[i].forEach((j) => {
          if (!g.seamEdge(i, j)) return;
          const [jx, jy] = g.xy[j];
          put(jx * cell, h * 0.5, jy * cell, ghostCol);
        });
      }
    }
    this.geom.computeVertexNormals();
    bumpRev(this.embed);
    for (const name of ['position', 'normal', 'color']) this.geom.attributes[name].needsUpdate = true;
  }

  update(s: GameState, _perTile: number[], hover: number, _hoverAdj?: number[]) {
    const key = `${s.tiles.join()}|${s.ring}|${hover}|${this.chartMode}|${this.seamView}|${this.immersion3d}`;
    if (key === this.key) return;
    this.key = key;
    this.rebuildMesh(this.graph, s);
  }

  tick(now: number, _reduced?: boolean) {
    this.uClock.value = now;
  }

  pick(x: number, z: number, s: GameState): number {
    const e = this.embed;
    if (e.chart2d) {
      let best = -1, bd = Infinity;
      for (let i = 0; i < this.graph.ring.length; i++) {
        if (this.graph.ring[i] > s.ring + 1) continue;
        const cx = e.chart2d[i * 2], cz = e.chart2d[i * 2 + 1];
        const d = Math.hypot(cx - x, cz - z);
        if (d < bd && d < GAP * 0.55) (bd = d), (best = i);
      }
      return best;
    }
    return -1;
  }

  markPlaced(_i: number, _now: number) {}
  markRevealed() {}
  setFade() {}
  dispose() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
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

function initialPreviewState(n: number): Pick<GameState, 'tiles' | 'ring'> {
  return { tiles: Array.from({ length: n }, () => null), ring: 99 };
}
