import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildManifoldStage } from '../src/render/surface-stage';

const R = 6;
const FLOOR = -2;

/** World-space vertices of every geometry-bearing object in the group. */
function worldPoints(root: THREE.Object3D): { obj: THREE.Object3D; x: number; y: number; z: number }[] {
  root.updateWorldMatrix(true, true);
  const out: { obj: THREE.Object3D; x: number; y: number; z: number }[] = [];
  const v = new THREE.Vector3();
  root.traverse((obj) => {
    const geom = (obj as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    const pos = geom?.getAttribute('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
      out.push({ obj, x: v.x, y: v.y, z: v.z });
    }
  });
  return out;
}

const moteCount = (root: THREE.Object3D) => {
  let n = 0;
  root.traverse((o) => { if (o instanceof THREE.Points) n = o.geometry.getAttribute('position').count; });
  return n;
};

describe('buildManifoldStage', () => {
  it('returns a named group with children', () => {
    const stage = buildManifoldStage(R, FLOOR, null, 'high');
    expect(stage.group).toBeInstanceOf(THREE.Group);
    expect(stage.group.children.length).toBeGreaterThan(0);
    stage.dispose();
  });

  it('keeps everything above floorY - 0.1r at least 1.12r from the origin, including after motion', () => {
    const stage = buildManifoldStage(R, FLOOR, null, 'high');
    const limit = FLOOR - 0.1 * R;
    const check = () => {
      for (const p of worldPoints(stage.group)) {
        if (p.y <= limit) continue;
        expect(Math.hypot(p.x, p.y, p.z), `${p.obj.name || p.obj.type} at y=${p.y}`).toBeGreaterThanOrEqual(1.12 * R);
      }
    };
    check();
    for (let i = 0; i < 400; i++) stage.tick(i * 0.1, 0.1, false);
    check();
    stage.dispose();
  });

  it("'low' has fewer children and motes than 'high'", () => {
    const low = buildManifoldStage(R, FLOOR, null, 'low');
    const high = buildManifoldStage(R, FLOOR, null, 'high');
    expect(low.group.children.length).toBeLessThan(high.group.children.length);
    expect(moteCount(low.group)).toBeLessThan(moteCount(high.group));
    expect(moteCount(high.group)).toBe(260);
    low.dispose();
    high.dispose();
  });

  it('tick precesses the gimbal rings (visible world transform) unless reduced motion is set', () => {
    const stage = buildManifoldStage(R, FLOOR, null, 'high');
    const ring = stage.group.getObjectByName('gimbal-0')!;
    const snap = () => { ring.updateWorldMatrix(true, false); return ring.matrixWorld.elements.slice(); };
    const before = snap();
    stage.tick(1, 0.1, true);
    expect(snap()).toEqual(before);
    stage.tick(1, 0.1, false);
    expect(snap()).not.toEqual(before);
    stage.dispose();
  });

  it('dispose does not throw', () => {
    const stage = buildManifoldStage(R, FLOOR, null, 'medium');
    expect(() => stage.dispose()).not.toThrow();
  });
});
