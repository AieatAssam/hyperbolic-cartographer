import * as THREE from 'three';
import type { FlowLink, FlowLinkKind } from './flow-links';
import { FLOW_LINK } from '../art/palette';

const col = (h: number) => new THREE.Color(h);
const FOOT_Y = 0.034;
const SHADOW = 0x0a0e18;

export function archPeakY(yA: number, yB: number, dist: number): number {
  const base = Math.max(yA, yB) + FOOT_Y;
  return base + 0.03 + Math.min(0.18, 0.04 + dist * 0.05);
}

export function sampleArch(
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, segments = 18,
): THREE.Vector3[] {
  const y0 = ay + FOOT_Y;
  const y1 = by + FOOT_Y;
  const dist = Math.hypot(bx - ax, bz - az);
  const peak = archPeakY(ay, by, dist);
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    pts.push(new THREE.Vector3(
      u * u * ax + 2 * u * t * mx + t * t * bx,
      u * u * y0 + 2 * u * t * peak + t * t * y1,
      u * u * az + 2 * u * t * mz + t * t * bz,
    ));
  }
  return pts;
}

const kindColour = (k: FlowLinkKind) => {
  switch (k) {
    case 'feed': return FLOW_LINK.feed;
    case 'boost': return FLOW_LINK.boost;
    case 'bridge': return FLOW_LINK.bridge;
    case 'penalty': return FLOW_LINK.penalty;
    default: return FLOW_LINK.relay;
  }
};

const kindRadius = (k: FlowLinkKind, rate: number) => {
  const base = k === 'bridge' ? 0.085 : k === 'relay' ? 0.072 : 0.078;
  const scale = rate > 0 ? Math.min(1.4, 0.9 + Math.log10(1 + rate) * 0.15) : 1;
  return base * scale;
};

type TubePair = { core: THREE.Mesh; shadow: THREE.Mesh };

/** Saturated ink-flow arches: shadow stroke, thick core, foot rings, dash motes. */
export class FlowArchOverlay {
  readonly group = new THREE.Group();
  private tubes: TubePair[] = [];
  private feet: THREE.InstancedMesh;
  private motes: THREE.InstancedMesh;
  private footColors: THREE.InstancedBufferAttribute;
  private matCache = new Map<FlowLinkKind, THREE.MeshStandardMaterial>();
  private readonly shadowTubeMat: THREE.MeshStandardMaterial;

  constructor() {
    const footGeo = new THREE.RingGeometry(0.075, 0.128, 24);
    const footMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.95, side: THREE.DoubleSide,
      depthTest: true, depthWrite: false,
    });
    this.footColors = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
    footGeo.setAttribute('instanceColor', this.footColors);
    footMat.vertexColors = true;
    this.feet = new THREE.InstancedMesh(footGeo, footMat, 64);
    this.feet.count = 0;
    this.feet.renderOrder = 8;
    this.feet.frustumCulled = false;
    this.group.add(this.feet);

    this.motes = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false }),
      96,
    );
    this.motes.count = 0;
    this.motes.renderOrder = 9;
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
    this.group.renderOrder = 7;
    this.shadowTubeMat = new THREE.MeshStandardMaterial({
      color: col(SHADOW), emissive: col(SHADOW), emissiveIntensity: 0.15,
      roughness: 1, metalness: 0, transparent: true, opacity: 0.92, depthWrite: false,
    });
  }

  private mat(kind: FlowLinkKind) {
    let m = this.matCache.get(kind);
    if (!m) {
      const h = kindColour(kind);
      m = new THREE.MeshStandardMaterial({
        color: col(h), emissive: col(h), emissiveIntensity: 1.05,
        roughness: 0.35, metalness: 0, transparent: true, opacity: 0.98,
        depthTest: true, depthWrite: false,
      });
      this.matCache.set(kind, m);
    }
    return m;
  }

  update(
    links: readonly FlowLink[],
    tops: readonly THREE.Vector3[],
    phase: number,
    reducedMotion: boolean,
  ) {
    while (this.tubes.length > links.length) {
      const p = this.tubes.pop()!;
      this.group.remove(p.core, p.shadow);
      p.core.geometry.dispose();
      p.shadow.geometry.dispose();
    }
    while (this.tubes.length < links.length) {
      const core = new THREE.Mesh(new THREE.BufferGeometry(), this.mat('feed'));
      const shadow = new THREE.Mesh(new THREE.BufferGeometry(), this.shadowTubeMat);
      for (const m of [core, shadow]) {
        m.frustumCulled = false;
        this.group.add(m);
      }
      this.tubes.push({ core, shadow });
    }

    const m4 = new THREE.Matrix4();
    const c = new THREE.Color();
    let footI = 0;
    let moteI = 0;
    const anim = reducedMotion ? 0 : phase;

    for (let i = 0; i < links.length; i++) {
      const L = links[i];
      const ta = tops[L.from];
      const tb = tops[L.to];
      if (!ta || !tb) continue;
      const pts = sampleArch(ta.x, ta.y, ta.z, tb.x, tb.y, tb.z);
      const curve = new THREE.CatmullRomCurve3(pts);
      const r = kindRadius(L.kind, L.rate);
      const geoCore = new THREE.TubeGeometry(curve, 22, r, 8, false);
      const geoSh = new THREE.TubeGeometry(curve, 22, r * 1.38, 8, false);
      const pair = this.tubes[i];
      pair.core.geometry.dispose();
      pair.shadow.geometry.dispose();
      pair.core.geometry = geoCore;
      pair.shadow.geometry = geoSh;
      pair.core.material = this.mat(L.kind);
      (pair.core.material as THREE.MeshStandardMaterial).emissiveIntensity =
        0.95 + 0.2 * Math.sin((anim + i * 0.11) * Math.PI * 2);
      pair.core.renderOrder = 7.5;
      pair.shadow.renderOrder = 7;

      const hex = kindColour(L.kind === 'relay' && L.rate > 0 ? 'feed' : L.kind);
      c.setHex(hex);
      for (const [ti, t] of [[L.from, ta], [L.to, tb]] as const) {
        void ti;
        m4.makeRotationX(-Math.PI / 2);
        m4.setPosition(t.x, t.y + FOOT_Y, t.z);
        this.feet.setMatrixAt(footI, m4);
        this.footColors.setXYZ(footI, c.r, c.g, c.b);
        footI++;
      }

      if (!reducedMotion) {
        const nMotes = 5;
        for (let m = 0; m < nMotes; m++) {
          const t = ((m / nMotes) + anim * 0.85) % 1;
          const p = curve.getPoint(t);
          const sc = r * 1.1;
          m4.makeScale(sc, sc, sc);
          m4.setPosition(p.x, p.y, p.z);
          this.motes.setMatrixAt(moteI, m4);
          (this.motes.material as THREE.MeshBasicMaterial).color.setHex(hex);
          moteI++;
        }
      }
    }

    for (let j = footI; j < this.feet.count; j++) m4.makeScale(0, 0, 0), this.feet.setMatrixAt(j, m4);
    this.feet.count = footI;
    this.feet.instanceMatrix.needsUpdate = true;
    this.footColors.needsUpdate = true;

    for (let j = moteI; j < this.motes.count; j++) m4.makeScale(0, 0, 0), this.motes.setMatrixAt(j, m4);
    this.motes.count = moteI;
    this.motes.instanceMatrix.needsUpdate = true;
    this.group.visible = links.length > 0;
  }
}
