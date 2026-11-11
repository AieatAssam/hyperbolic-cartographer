import * as THREE from 'three';
import type { TileType } from '../core/tiles';
import { TILE_IDENTITIES, MOTIF } from '../art/palette';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Node names in public/models/tiles.glb (one mesh per node, authored at world scale). */
export const MODEL_NAMES = ['spring', 'mill', 'mill_wheel', 'beacon', 'bridge', 'vault', 'lighthouse'] as const;
export type ModelName = (typeof MODEL_NAMES)[number];
/** Keyed by GLB node name; tile types without a node (cistern, scriptorium) keep their primitive motif. */
export type TileModels = Partial<Record<ModelName | TileType, THREE.BufferGeometry>>;

let pending: Promise<TileModels> | null = null;

/**
 * Loads the tile GLB once. Resolves to {} when the file is missing or fails to parse, so callers keep
 * their primitive motifs and never block on it.
 */
export function loadTileModels(): Promise<TileModels> {
  pending ??= new Promise<TileModels>((resolve) => {
    try {
      new GLTFLoader().load(
        `${import.meta.env.BASE_URL}models/tiles.glb`,
        (gltf) => {
          const out: TileModels = {};
          gltf.scene.traverse((o) => {
            if (o instanceof THREE.Mesh && (MODEL_NAMES as readonly string[]).includes(o.name)) out[o.name as ModelName] = o.geometry;
          });
          resolve(out);
        },
        undefined,
        () => resolve({}),
      );
    } catch {
      resolve({});
    }
  });
  return pending;
}

/** Non-indexed, uv-free copy so primitives can be merged into one motif. */
const plain = (g: THREE.BufferGeometry) => {
  const q = g.index ? g.toNonIndexed() : g;
  q.deleteAttribute('uv');
  return q;
};
export const merged = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts.map(plain)) ?? plain(parts[0]);

/** Procedural fallback per tile type, authored around the origin on the table (y = 0). Fitted like the GLB models. */
export function primitiveMotif(t: TileType): THREE.BufferGeometry {
  switch (t) {
    case 'spring': return new THREE.SphereGeometry(0.16, 12, 8);
    case 'mill': return new THREE.CylinderGeometry(0.15, 0.17, 0.4, 10).translate(0, 0.2, 0);
    case 'beacon': return new THREE.ConeGeometry(0.15, 0.4, 6).translate(0, 0.2, 0);
    case 'bridge': return new THREE.TorusGeometry(0.17, 0.045, 6, 12, Math.PI);
    case 'vault': return new THREE.OctahedronGeometry(0.19);
    case 'lighthouse': return new THREE.CylinderGeometry(0.07, 0.11, 0.42, 8).translate(0, 0.21, 0);
    case 'cistern': { // water tank on four legs with a brim
      const legs = [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].map(([x, z]) =>
        new THREE.CylinderGeometry(0.03, 0.03, 0.2, 5).translate(x, 0.1, z));
      return merged([
        new THREE.CylinderGeometry(0.3, 0.26, 0.34, 16).translate(0, 0.37, 0),
        new THREE.TorusGeometry(0.3, 0.035, 6, 20).rotateX(Math.PI / 2).translate(0, 0.54, 0),
        ...legs,
      ]);
    }
    case 'scriptorium': { // writing desk: a book block, its page edge, and an inkwell with a quill
      return merged([
        new THREE.BoxGeometry(0.56, 0.08, 0.42).translate(0, 0.04, 0).rotateY(0.2),
        new THREE.BoxGeometry(0.5, 0.06, 0.36).translate(0, 0.11, 0).rotateY(0.2),
        new THREE.CylinderGeometry(0.07, 0.09, 0.14, 12).translate(0.36, 0.07, -0.16),
        new THREE.CylinderGeometry(0.012, 0.004, 0.5, 5).rotateZ(-0.6).translate(0.38, 0.36, -0.14),
      ]);
    }
  }
}

interface Fit { x: number; y: number; z: number; s: number; h: number }

/** Scales a model so its footprint (larger of x / z extent) is 1, base on y = 0, centred on the origin. */
function fitOf(g: THREE.BufferGeometry): Fit {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const span = Math.max(b.max.x - b.min.x, b.max.z - b.min.z, 1e-6);
  return { x: (b.max.x + b.min.x) / 2, y: b.min.y, z: (b.max.z + b.min.z) / 2, s: 1 / span, h: (b.max.y - b.min.y) / span };
}
const applyFit = (g: THREE.BufferGeometry, f: Fit) => g.translate(-f.x, -f.y, -f.z).scale(f.s, f.s, f.s);

/** Accent region per type in fitted units: x in −0.5..0.5, yn = height / model height. */
const ACCENT: Record<TileType, (x: number, yn: number) => boolean> = {
  spring: (_, yn) => yn > 0.7,
  mill: () => false, // the wheel carries the accent
  beacon: (_, yn) => yn > 0.78,
  bridge: (x) => Math.abs(x) > 0.3,
  vault: (_, yn) => yn > 0.5,
  lighthouse: (_, yn) => yn > 0.86,
  cistern: (_, yn) => yn > 0.7,
  scriptorium: (_, yn) => yn > 0.9,
};

/** Vertex colours: body = the type's emissive hue (vivid, not pastel), accent band = the type's accent. */
function paint(g: THREE.BufferGeometry, t: TileType, h: number) {
  const tk = TILE_IDENTITIES[t];
  const body = new THREE.Color(tk.base), acc = new THREE.Color(tk.accent);
  const pos = g.attributes.position, n = pos.count, out = new Float32Array(n * 3);
  const rule = ACCENT[t];
  for (let i = 0; i < n; i++) {
    const c = rule(pos.getX(i), pos.getY(i) / h) ? acc : body;
    out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return g;
}

/** Shared material per type: lit, vertex-coloured, emissive only a low tint so the form survives bloom. */
export function motifMaterial(t: TileType): THREE.MeshStandardMaterial {
  const tk = TILE_IDENTITIES[t];
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: 0xffffff,
    emissive: tk.emissive,
    emissiveIntensity: MOTIF.emissive,
    roughness: 0.6,
    metalness: 0,
  });
}

/** Everything the board needs for the tile models: one fitted geometry per type, and the mill wheel with its offset. */
export interface MotifSet {
  geos: Record<TileType, THREE.BufferGeometry>;
  /** Mill wheel, centred on its own origin; place it with wheelAt (fitted units), then spin about its own Z. */
  wheel: THREE.BufferGeometry;
  wheelAt: THREE.Vector3;
}

/**
 * Fits and colours every motif. GLB models win over primitives; the mill wheel is sized to the housing and set on its
 * front face. Call once per loaded GLB (cheap; no per-frame work).
 */
export function prepareMotifs(models: TileModels): MotifSet {
  const geos = {} as Record<TileType, THREE.BufferGeometry>;
  const wheelAt = new THREE.Vector3();
  for (const t of Object.keys(TILE_IDENTITIES) as TileType[]) {
    const g = (models[t] ?? primitiveMotif(t)).clone();
    applyFit(g, fitOf(g));
    g.computeBoundingBox();
    const b = g.boundingBox!;
    geos[t] = paint(g, t, Math.max(b.max.y, 1e-6));
    if (t === 'mill') wheelAt.set(0, b.max.y * 0.3, b.max.z + 0.01); // wheel on the housing's front face, 30% up
  }
  // wheel: centred on its own origin, diameter 0.42 of the footprint (spins about its Z, the disc normal)
  const w = (models.mill_wheel?.clone() ?? new THREE.TorusGeometry(0.15, 0.05, 6, 12).rotateX(Math.PI / 2));
  w.computeBoundingBox();
  const wb = w.boundingBox!;
  const r = Math.max(wb.max.x - wb.min.x, wb.max.y - wb.min.y) / 2;
  const k = 0.21 / Math.max(r, 1e-6);
  w.translate(-(wb.max.x + wb.min.x) / 2, -(wb.max.y + wb.min.y) / 2, -(wb.max.z + wb.min.z) / 2).scale(k, k, k);
  const wheel = plain(w), acc = new THREE.Color(TILE_IDENTITIES.mill.accent);
  wheel.setAttribute('color', new THREE.BufferAttribute(new Float32Array(wheel.attributes.position.count * 3), 3));
  for (let i = 0; i < wheel.attributes.position.count; i++) wheel.attributes.color.setXYZ(i, acc.r, acc.g, acc.b);
  return { geos, wheel, wheelAt };
}
