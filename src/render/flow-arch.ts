import * as THREE from 'three';
import type { FlowLink, FlowLinkKind } from './flow-links';
import { FLOW_LINK } from '../art/palette';

const col = (h: number) => new THREE.Color(h);
const FOOT_Y = 0.032;

/** Arch peak height: modest, scales with tile separation. */
export function archPeakY(yA: number, yB: number, dist: number): number {
  const base = Math.max(yA, yB) + FOOT_Y;
  return base + 0.035 + Math.min(0.2, 0.045 + dist * 0.055);
}

export function sampleArch(
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, segments = 14,
): Float32Array {
  const y0 = ay + FOOT_Y;
  const y1 = by + FOOT_Y;
  const dist = Math.hypot(bx - ax, bz - az);
  const peak = archPeakY(ay, by, dist);
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const out = new Float32Array((segments + 1) * 3);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    out[i * 3] = u * u * ax + 2 * u * t * mx + t * t * bx;
    out[i * 3 + 1] = u * u * y0 + 2 * u * t * peak + t * t * y1;
    out[i * 3 + 2] = u * u * az + 2 * u * t * mz + t * t * bz;
  }
  return out;
}

const kindColour = (k: FlowLinkKind) => {
  switch (k) {
    case 'feed': return FLOW_LINK.feed;
    case 'boost': return FLOW_LINK.boost;
    case 'bridge': return FLOW_LINK.bridge;
    default: return FLOW_LINK.relay;
  }
};

const kindRadius = (k: FlowLinkKind, rate: number) => {
  const base = k === 'bridge' ? 0.028 : k === 'relay' ? 0.022 : 0.026;
  const scale = rate > 0 ? Math.min(1.35, 0.85 + Math.log10(1 + rate) * 0.2) : 1;
  return base * scale;
};

/** World-space ink-flow arches with foot rings. */
export class FlowArchOverlay {
  readonly group = new THREE.Group();
  private tubes: THREE.Mesh[] = [];
  private feet: THREE.InstancedMesh;
  private matCache = new Map<FlowLinkKind, THREE.MeshStandardMaterial>();
  private footMat: THREE.MeshBasicMaterial;

  constructor() {
    const footGeo = new THREE.RingGeometry(0.06, 0.092, 20);
    this.footMat = new THREE.MeshBasicMaterial({
      color: col(0xffffff), transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      depthTest: true, depthWrite: false,
    });
    this.feet = new THREE.InstancedMesh(footGeo, this.footMat, 64);
    this.feet.count = 0;
    this.feet.renderOrder = 7;
    this.feet.frustumCulled = false;
    this.group.add(this.feet);
    this.group.renderOrder = 7;
  }

  private mat(kind: FlowLinkKind) {
    let m = this.matCache.get(kind);
    if (!m) {
      const h = kindColour(kind);
      m = new THREE.MeshStandardMaterial({
        color: col(h), emissive: col(h), emissiveIntensity: 0.55,
        roughness: 0.45, metalness: 0, transparent: true, opacity: 0.92,
        depthTest: true, depthWrite: false,
      });
      this.matCache.set(kind, m);
    }
    return m;
  }

  dispose() {
    for (const t of this.tubes) t.geometry.dispose();
    this.feet.geometry.dispose();
    for (const m of this.matCache.values()) m.dispose();
    this.footMat.dispose();
  }

  update(
    links: readonly FlowLink[],
    tops: readonly THREE.Vector3[],
    phase: number,
    reducedMotion: boolean,
  ) {
    while (this.tubes.length > links.length) {
      const m = this.tubes.pop()!;
      this.group.remove(m);
      m.geometry.dispose();
    }
    while (this.tubes.length < links.length) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat('feed'));
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.tubes.push(mesh);
    }
    const m4 = new THREE.Matrix4();
    let footI = 0;
    const anim = reducedMotion ? 0 : phase;
    for (let i = 0; i < links.length; i++) {
      const L = links[i];
      const ta = tops[L.from];
      const tb = tops[L.to];
      if (!ta || !tb) continue;
      const pts = sampleArch(ta.x, ta.y, ta.z, tb.x, tb.y, tb.z);
      const curve = new THREE.CatmullRomCurve3(
        Array.from({ length: pts.length / 3 }, (_, k) => new THREE.Vector3(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2])),
      );
      const r = kindRadius(L.kind, L.rate);
      const geo = new THREE.TubeGeometry(curve, 16, r, 6, false);
      const mesh = this.tubes[i];
      mesh.geometry.dispose();
      mesh.geometry = geo;
      mesh.material = this.mat(L.kind);
      (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity =
        0.45 + 0.12 * Math.sin((anim + i * 0.17) * Math.PI * 2);
      const footC = kindColour(L.kind);
      this.footMat.color.setHex(footC);
      for (const [idx, t] of [[L.from, ta], [L.to, tb]] as const) {
        void idx;
        const y = t.y + FOOT_Y + 0.004;
        m4.makeRotationX(-Math.PI / 2);
        m4.setPosition(t.x, y, t.z);
        this.feet.setMatrixAt(footI++, m4);
      }
    }
    for (let j = footI; j < this.feet.count; j++) m4.makeScale(0, 0, 0), this.feet.setMatrixAt(j, m4);
    this.feet.count = footI;
    this.feet.instanceMatrix.needsUpdate = true;
    this.group.visible = links.length > 0;
  }
}
