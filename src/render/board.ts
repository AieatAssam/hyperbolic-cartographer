import * as THREE from 'three';
import { GRAPHS, type GameState, type Geometry } from '../core/state';
import type { SquareBoard } from '../core/geometry/square';
import { apply, boost, dist, geodesic, identity, inverse, mul, normalize, orthonormalize, toDisk, type HyperBoard, type Mat3, type Vec3 } from '../core/geometry/hyperbolic';
import { TILE_INFO } from '../core/tiles';

export const DISK_R = 9;
const SEG = 8; // geodesic segments per heptagon edge
const GAP = 0.9;
const GOLD = new THREE.Color(0xe8c872);

/** One merged extruded-prism mesh for either geometry. Tile i owns a fixed slice of the vertex buffer. */
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

  constructor(readonly geometry: Geometry) {
    const g = GRAPHS[geometry];
    this.hyper = geometry === 'hyper' ? (g as HyperBoard) : null;
    this.square = geometry === 'square' ? (g as SquareBoard) : null;
    this.K = this.hyper ? 7 * SEG : 4;
    const n = g.ring.length, verts = n * this.K * 9;
    this.geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const mesh = new THREE.Mesh(this.geom, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.65, metalness: 0.05 }));
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.tops = g.ring.map(() => new THREE.Vector3());
    const base = this.hyper
      ? new THREE.Mesh(new THREE.CircleGeometry(DISK_R, 96), new THREE.MeshBasicMaterial({ color: 0x0c1528 }))
      : new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ color: 0x0c1528 }));
    base.rotation.x = -Math.PI / 2;
    base.position.y = -0.01;
    this.group.add(base);
    if (this.hyper) {
      const rim = new THREE.Mesh(new THREE.RingGeometry(DISK_R, DISK_R + 0.35, 128), new THREE.MeshBasicMaterial({ color: 0x5fd4ff, transparent: true, opacity: 0.35 }));
      rim.rotation.x = -Math.PI / 2;
      this.group.add(rim);
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

  update(s: GameState, perTile: number[], hover: number, hoverAdj: number[]) {
    const key = `${s.tiles.join()}|${s.ring}|${s.pinned}|${hover}|${this.viewRev}`;
    if (key === this.key) return;
    this.key = key;
    const pos = this.geom.attributes.position.array as Float32Array;
    const col = this.geom.attributes.color.array as Float32Array;
    const g = GRAPHS[this.geometry], K = this.K, c = new THREE.Color(), side = new THREE.Color();
    const adj = new Set(hoverAdj);
    for (let i = 0; i < g.ring.length; i++) {
      const o = this.outline(i), t = s.tiles[i], r = g.ring[i];
      const active = r <= s.ring, next = r === s.ring + 1;
      let h = 0;
      if (t) {
        h = 0.25 + 0.22 * Math.log10(1 + perTile[i]);
        c.setHex(TILE_INFO[t].color).multiplyScalar(0.55 + 0.45 * Math.min(1, Math.log10(1 + perTile[i]) / 3));
      } else if (active) (h = 0.06), c.setHex(0x1f3150);
      else if (next) (h = 0.015), c.setHex(0x111a2e);
      else o.scale = 0;
      if (i === hover) c.lerp(new THREE.Color(0xffffff), 0.45);
      else if (adj.has(i)) c.lerp(new THREE.Color(0x5fd4ff), 0.3);
      h *= o.scale;
      side.copy(c).multiplyScalar(0.55);
      if (s.pinned.includes(i)) side.copy(GOLD);
      this.tops[i].set(o.c[0], h, o.c[1]);
      // pts collapse to the centre when hidden, giving zero-area triangles
      const pts = o.scale > 0 ? o.pts : o.pts.map(() => o.c);
      let v = i * K * 9;
      const put = (x: number, y: number, z: number, cc: THREE.Color) => {
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        col[v * 3] = cc.r; col[v * 3 + 1] = cc.g; col[v * 3 + 2] = cc.b;
        v++;
      };
      for (let k = 0; k < K; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[(k + 1) % K];
        put(o.c[0], h, o.c[1], c); put(bx, h, bz, c); put(ax, h, az, c); // top (CCW from above)
        put(ax, h, az, side); put(bx, h, bz, side); put(bx, 0, bz, side); // side
        put(ax, h, az, side); put(bx, 0, bz, side); put(ax, 0, az, side);
      }
    }
    this.geom.attributes.position.needsUpdate = true;
    this.geom.attributes.color.needsUpdate = true;
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
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
