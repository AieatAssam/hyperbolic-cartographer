import * as THREE from 'three';
import { GRAPHS, type GameState, type Geometry } from '../core/state';
import type { SquareBoard } from '../core/geometry/square';
import { apply, boost, dist, geodesic, identity, inverse, mul, normalize, orthonormalize, toDisk, type HyperBoard, type Mat3, type Vec3 } from '../core/geometry/hyperbolic';
import { TILE_TYPES, type TileType } from '../core/tiles';
import { BLOOM, BOARD, EMPTY_SLOT, TILE_IDENTITIES } from '../art/palette';

export const DISK_R = 9;
const SEG = 8; // geodesic segments per heptagon edge
const GAP = 0.9;
const INSET = 0.8; // inner face / outline ratio; the ring between is the bevel or empty-slot border
const PER_K = 15; // verts per outline segment: top fan 3 + bevel quad 6 + side quad 6
/** Placed-tile glow at log10(1 + output) = GLOW_LOG_FULL. Above BLOOM.threshold: busy tiles bloom on purpose. */
const GLOW_MAX = 1.25;
const GLOW_LOG_FULL = 6;
const GLOW_STEPS = 8; // output quantisation per decade, so the cache key only changes on visible steps
const PARCHMENT = 0xe8d8b0, SLOT_TEAL = 0x6fe3d0;

const col = (hex: number) => new THREE.Color(hex);
const TOK = Object.fromEntries(TILE_TYPES.map((t) => [t, {
  base: col(TILE_IDENTITIES[t].base), emissive: col(TILE_IDENTITIES[t].emissive), rest: TILE_IDENTITIES[t].emissiveIntensity, accent: col(TILE_IDENTITIES[t].accent),
}])) as Record<TileType, { base: THREE.Color; emissive: THREE.Color; rest: number; accent: THREE.Color }>;
const C = {
  slot: col(EMPTY_SLOT.base).lerp(col(PARCHMENT), 0.18), slotGlow: col(EMPTY_SLOT.emissive).multiplyScalar(EMPTY_SLOT.emissiveIntensity),
  slotBorder: col(PARCHMENT).lerp(col(SLOT_TEAL), 0.35), next: col(EMPTY_SLOT.base).multiplyScalar(0.7), nextBorder: col(EMPTY_SLOT.accent).multiplyScalar(0.45),
  white: col(BOARD.hover), adj: col(BOARD.adjacency), gold: col(BOARD.gold), black: col(0),
};

/** Motif accent per tile type: a distinct silhouette so tiles read on phones and for colour-blind players. */
function motif(t: TileType): THREE.BufferGeometry {
  switch (t) {
    case 'spring': return new THREE.SphereGeometry(0.16, 12, 8); // droplet orb
    case 'mill': return new THREE.TorusGeometry(0.15, 0.05, 6, 12).rotateX(Math.PI / 2); // wheel
    case 'beacon': return new THREE.ConeGeometry(0.15, 0.4, 6).translate(0, 0.2, 0); // spire
    case 'bridge': return new THREE.TorusGeometry(0.17, 0.045, 6, 12, Math.PI); // arch
    case 'vault': return new THREE.OctahedronGeometry(0.19); // gem
  }
}

/** Procedural cartographer's tabletop: rhumb lines, graticule, contours and constellations in ink. Local, no assets. */
function tableTexture(round: boolean): THREE.CanvasTexture {
  const N = 1024, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const grad = g.createRadialGradient(N / 2, N / 2, N * 0.05, N / 2, N / 2, N * 0.72);
  grad.addColorStop(0, '#6a4e86');
  grad.addColorStop(1, '#' + BOARD.table.toString(16).padStart(6, '0'));
  g.fillStyle = grad;
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < 9000; i++) { // parchment grain
    g.fillStyle = `rgba(232,216,176,${0.02 + rnd() * 0.04})`;
    g.fillRect(rnd() * N, rnd() * N, 1.5, 1.5);
  }
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(232,200,114,0.22)'; // graticule
  for (let i = 1; i < 12; i++) {
    g.beginPath(); g.arc(N / 2, N / 2, (i * N) / 22, 0, Math.PI * 2); g.stroke();
  }
  g.strokeStyle = 'rgba(95,212,255,0.16)'; // compass-rose rhumb lines
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    g.beginPath(); g.moveTo(N / 2, N / 2); g.lineTo(N / 2 + Math.cos(a) * N, N / 2 + Math.sin(a) * N); g.stroke();
  }
  g.strokeStyle = 'rgba(208,112,154,0.18)'; // wobbly contours
  for (let c = 0; c < 6; c++) {
    const cx = rnd() * N, cy = rnd() * N;
    for (let r = 20; r < 140; r += 18) {
      g.beginPath();
      for (let a = 0; a <= 64; a++) {
        const th = (a / 64) * Math.PI * 2, rr = r * (1 + 0.18 * Math.sin(th * 3 + c));
        g.lineTo(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr);
      }
      g.stroke();
    }
  }
  for (let k = 0; k < 7; k++) { // constellations
    const pts: [number, number][] = [];
    let x = rnd() * N, y = rnd() * N;
    for (let j = 0; j < 5; j++) pts.push([(x += (rnd() - 0.5) * 120), (y += (rnd() - 0.5) * 120)]);
    g.strokeStyle = 'rgba(255,240,208,0.25)';
    g.beginPath(); pts.forEach(([a, b]) => g.lineTo(a, b)); g.stroke();
    g.fillStyle = 'rgba(255,240,208,0.7)';
    pts.forEach(([a, b]) => { g.beginPath(); g.arc(a, b, 2.5 + rnd() * 2, 0, Math.PI * 2); g.fill(); });
  }
  if (round) {
    g.strokeStyle = 'rgba(232,200,114,0.5)'; g.lineWidth = 6;
    g.beginPath(); g.arc(N / 2, N / 2, N / 2 - 8, 0, Math.PI * 2); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * One merged extruded-prism mesh for either geometry (one draw call). Tile i owns a fixed slice of the vertex buffer.
 * Per-vertex emissive is a custom `glow` attribute patched into MeshStandardMaterial; type motifs are 5 InstancedMeshes.
 */
export class Board {
  readonly group = new THREE.Group();
  readonly tops: THREE.Vector3[];
  private geom = new THREE.BufferGeometry();
  private K: number;
  private view: Mat3 = identity();
  private viewRev = 0;
  private key = '';
  private hyper: HyperBoard | null;
  private square: SquareBoard | null;
  private motifs: Record<TileType, THREE.InstancedMesh>;
  private glowQ: Int16Array;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private sc = new THREE.Vector3();
  private c = new THREE.Color();
  private side = new THREE.Color();
  private border = new THREE.Color();
  private glow = new THREE.Color();

  constructor(readonly geometry: Geometry) {
    const g = GRAPHS[geometry];
    this.hyper = geometry === 'hyper' ? (g as HyperBoard) : null;
    this.square = geometry === 'square' ? (g as SquareBoard) : null;
    this.K = this.hyper ? 7 * SEG : 4;
    const n = g.ring.length, verts = n * this.K * PER_K;
    this.glowQ = new Int16Array(n);
    for (const name of ['position', 'normal', 'color', 'glow'])
      this.geom.setAttribute(name, new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.12 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 glow;\nvarying vec3 vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;');
    };
    mat.customProgramCacheKey = () => 'board-glow';
    const mesh = new THREE.Mesh(this.geom, mat);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.tops = g.ring.map(() => new THREE.Vector3());

    this.motifs = {} as Record<TileType, THREE.InstancedMesh>;
    for (const t of TILE_TYPES) {
      const tk = TILE_IDENTITIES[t];
      const im = new THREE.InstancedMesh(motif(t), new THREE.MeshStandardMaterial({
        color: tk.accent, emissive: tk.accent, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.4,
      }), n);
      im.count = 0;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.motifs[t] = im;
      this.group.add(im);
    }
    this.buildTable();
  }

  /** Bevelled table (square) or hyperbolic disk with a luminous rim, both in the ink-map language. */
  private buildTable() {
    const tex = tableTexture(!!this.hyper);
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 });
    const edge = new THREE.MeshStandardMaterial({ color: BOARD.tableEdge, roughness: 0.5, metalness: 0.35 });
    const DEPTH = 0.35;
    if (this.hyper) {
      const slab = new THREE.Mesh(new THREE.CylinderGeometry(DISK_R + 0.25, DISK_R + 0.55, DEPTH, 128, 1, true), edge);
      slab.position.y = -DEPTH / 2 - 0.01;
      const face = new THREE.Mesh(new THREE.CircleGeometry(DISK_R + 0.25, 128).rotateX(-Math.PI / 2), top);
      face.position.y = -0.01;
      // colour scaled past the bloom threshold: the rim is meant to glow
      const rimCol = col(BOARD.rim).multiplyScalar(BLOOM.threshold + 1.2);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(DISK_R + 0.25, 0.07, 8, 160).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: rimCol }));
      this.group.add(slab, face, rim);
    } else {
      const S = 12;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(S + 0.6, DEPTH, S + 0.6), [edge, edge, top, edge, edge, edge]);
      slab.position.y = -DEPTH / 2 - 0.01;
      const lip = new THREE.Mesh(new THREE.BoxGeometry(S + 0.9, 0.12, S + 0.9), edge);
      lip.position.y = -DEPTH - 0.07;
      this.group.add(slab, lip);
    }
  }

  /** Tile outline (world xz) + centre + local scale. Hyperbolic tiles go through the view boost and Poincaré projection. */
  private outline(i: number): { pts: [number, number][]; c: [number, number]; scale: number } {
    if (this.square) {
      const [x, y] = this.square.xy[i], h = GAP / 2;
      return { pts: [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]], c: [x, y], scale: 1 };
    }
    const hb = this.hyper!;
    const vs = hb.verts[i].map((v) => apply(this.view, v));
    const cv = apply(this.view, hb.centers[i]);
    const [cu, cw] = toDisk(cv);
    const pts: [number, number][] = [];
    for (let k = 0; k < 7; k++)
      for (let s = 0; s < SEG; s++) {
        const [u, w] = toDisk(geodesic(vs[k], vs[(k + 1) % 7], s / SEG));
        pts.push([(cu + (u - cu) * GAP) * DISK_R, (cw + (w - cw) * GAP) * DISK_R]);
      }
    return { pts, c: [cu * DISK_R, cw * DISK_R], scale: Math.max(0, 1 - cu * cu - cw * cw) };
  }

  /** Rebuilds geometry only when tiles, ring, pins, focus, view or (quantised) output change. Normals recomputed then. */
  update(s: GameState, perTile: number[], hover: number, hoverAdj: number[]) {
    const n = this.glowQ.length;
    let glowSig = 0;
    for (let i = 0; i < n; i++) {
      const qv = s.tiles[i] ? Math.round(Math.log10(1 + (perTile[i] || 0)) * GLOW_STEPS) : 0;
      this.glowQ[i] = qv;
      glowSig = (glowSig * 31 + qv) | 0;
    }
    const key = `${s.tiles.join()}|${s.ring}|${s.pinned}|${hover}|${hoverAdj}|${this.viewRev}|${glowSig}`;
    if (key === this.key) return;
    this.key = key;
    const pos = this.geom.attributes.position.array as Float32Array;
    const colA = this.geom.attributes.color.array as Float32Array;
    const glowA = this.geom.attributes.glow.array as Float32Array;
    const g = GRAPHS[this.geometry], K = this.K, { c, side, border, glow } = this;
    for (const t of TILE_TYPES) this.motifs[t].count = 0;
    for (let i = 0; i < n; i++) {
      const o = this.outline(i), t = s.tiles[i], r = g.ring[i];
      const active = r <= s.ring, next = r === s.ring + 1;
      const L = this.glowQ[i] / GLOW_STEPS;
      let h = 0;
      if (t) {
        const tk = TOK[t];
        h = 0.25 + 0.22 * L;
        c.copy(tk.base);
        border.copy(tk.base).lerp(tk.accent, 0.25).multiplyScalar(1.15);
        glow.copy(tk.emissive).multiplyScalar(tk.rest + (GLOW_MAX - tk.rest) * Math.min(1, L / GLOW_LOG_FULL));
      } else if (active) {
        h = 0.06;
        c.copy(C.slot); border.copy(C.slotBorder); glow.copy(C.slotGlow);
      } else if (next) {
        h = 0.02;
        c.copy(C.next); border.copy(C.nextBorder); glow.copy(C.black);
      } else o.scale = 0;
      if (i === hover) {
        c.lerp(C.white, 0.35); border.lerp(C.white, 0.5);
        glow.copy(t ? TOK[t].emissive : C.slotBorder).multiplyScalar(t ? BOARD.glowAccentIntensity : 0.6);
      } else if (hoverAdj.includes(i)) border.lerp(C.adj, 0.6), glow.lerp(C.adj, 0.25);
      h *= o.scale;
      if (s.pinned.includes(i)) side.copy(C.gold);
      else side.copy(c).multiplyScalar(0.5);
      const [cx, cz] = o.c;
      this.tops[i].set(cx, h, cz);
      if (t && o.scale > 0.02) {
        const im = this.motifs[t], sc = Math.sqrt(o.scale) * (this.hyper ? 1.3 : 1);
        this.m4.compose(this.tops[i], this.q, this.sc.setScalar(sc));
        im.setMatrixAt(im.count++, this.m4);
      }
      const hidden = o.scale <= 0, hb = h * 0.82;
      let v = i * K * PER_K;
      const put = (x: number, y: number, z: number, cc: THREE.Color, gl: THREE.Color) => {
        const j = v * 3;
        pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
        colA[j] = cc.r; colA[j + 1] = cc.g; colA[j + 2] = cc.b;
        glowA[j] = gl.r; glowA[j + 1] = gl.g; glowA[j + 2] = gl.b;
        v++;
      };
      for (let k = 0; k < K; k++) {
        // hidden tiles collapse to the centre, giving zero-area triangles
        const [px, pz] = hidden ? o.c : o.pts[k], [qx, qz] = hidden ? o.c : o.pts[(k + 1) % K];
        const ax = cx + (px - cx) * INSET, az = cz + (pz - cz) * INSET, bx = cx + (qx - cx) * INSET, bz = cz + (qz - cz) * INSET;
        put(cx, h, cz, c, glow); put(bx, h, bz, c, glow); put(ax, h, az, c, glow); // inner face (CCW from above)
        put(ax, h, az, border, glow); put(bx, h, bz, border, glow); put(qx, hb, qz, border, glow); // bevel / slot border
        put(ax, h, az, border, glow); put(qx, hb, qz, border, glow); put(px, hb, pz, border, glow);
        put(px, hb, pz, side, C.black); put(qx, hb, qz, side, C.black); put(qx, 0, qz, side, C.black); // side
        put(px, hb, pz, side, C.black); put(qx, 0, qz, side, C.black); put(px, 0, pz, side, C.black);
      }
    }
    this.geom.computeVertexNormals(); // non-indexed: face normals, written in place
    for (const name of ['position', 'normal', 'color', 'glow']) this.geom.attributes[name].needsUpdate = true;
    for (const t of TILE_TYPES) this.motifs[t].instanceMatrix.needsUpdate = true;
  }

  /** World point on the table (y=0) → tile index, or −1. */
  pick(x: number, z: number, s: GameState): number {
    const g = GRAPHS[this.geometry];
    const ok = (i: number) => i >= 0 && g.ring[i] <= s.ring + 1;
    if (this.square) {
      const i = this.square.xy.findIndex(([a, b]) => Math.abs(a - x) <= 0.5 && Math.abs(b - z) <= 0.5);
      return ok(i) ? i : -1;
    }
    const u = x / DISK_R, w = z / DISK_R, r2 = u * u + w * w;
    if (r2 >= 0.995) return -1;
    const p = apply(inverse(this.view), normalize([2 * u, 2 * w, 1 + r2]));
    let best = -1, bd = Infinity;
    this.hyper!.centers.forEach((c, i) => {
      const d = dist(c, p);
      if (d < bd) (bd = d), (best = i);
    });
    return bd < 0.75 && ok(best) ? best : -1;
  }

  /** Hyperbolic pan: boost the view by a small disk-space displacement. Rejected if it would leave the board. */
  pan(dx: number, dz: number, maxRadius: number) {
    if (!this.hyper) return;
    const du = dx / DISK_R, dw = dz / DISK_R, m = Math.hypot(du, dw);
    if (m < 1e-6) return;
    const next = orthonormalize(mul(boost(2 * Math.atanh(Math.min(0.9, m)), Math.atan2(dw, du)), this.view));
    const origin = apply(next, [0, 0, 1] as Vec3);
    if (dist(origin, [0, 0, 1]) > 1.1 * maxRadius + 0.6) return;
    this.view = next;
    this.viewRev++;
  }

  recenter() {
    this.view = identity();
    this.viewRev++;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        }
      }
    });
  }
}
