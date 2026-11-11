import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Node names in public/models/tiles.glb (one mesh per node, authored at world scale). */
export const MODEL_NAMES = ['spring', 'mill', 'mill_wheel', 'beacon', 'bridge', 'vault', 'lighthouse'] as const;
export type ModelName = (typeof MODEL_NAMES)[number];
export type TileModels = Partial<Record<ModelName, THREE.BufferGeometry>>;

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
