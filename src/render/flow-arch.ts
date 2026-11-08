import * as THREE from 'three';
import type { FlowLink, FlowLinkKind } from './flow-links';
import { FLOW_LINK } from '../art/palette';

const col = (h: number) => new THREE.Color(h);
const FOOT_Y = 0.028;
const SHADOW = FLOW_LINK.shadow;

export function kindColour(k: FlowLinkKind): number {
  switch (k) {
    case 'feed': return FLOW_LINK.feed;
    case 'boost': return FLOW_LINK.boost;
    case 'bridge': return FLOW_LINK.bridge;
    case 'penalty': return FLOW_LINK.penalty;
    default: return FLOW_LINK.relay;
  }
}

export function archPeakY(yA: number, yB: number, dist: number): number {
  const base = Math.max(yA, yB) + FOOT_Y;
  return base + 0.12 + Math.min(0.28, dist * 0.22);
}

/** Sideways fan so multiple arches between the same pair don't overlap. */
export function fanForLink(links: readonly FlowLink[], i: number): number {
  const L = links[i];
  const a = Math.min(L.from, L.to), b = Math.max(L.from, L.to);
  const sibs: number[] = [];
  for (let k = 0; k < links.length; k++) {
    const o = links[k];
    if (Math.min(o.from, o.to) === a && Math.max(o.from, o.to) === b) sibs.push(k);
  }
  const n = sibs.length;
  if (n <= 1) return 0;
  const slot = sibs.indexOf(i);
  const distHint = 1;
  const span = 0.16 * distHint;
  return (slot - (n - 1) / 2) * (span / Math.max(1, (n - 1) / 2));
}

export function archControl(
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, fan = 0,
): THREE.Vector3 {
  const dist = Math.hypot(bx - ax, bz - az) || 1;
  const nx = -(bz - az) / dist;
  const nz = (bx - ax) / dist;
  const peak = archPeakY(ay, by, dist) + Math.abs(fan) * 0.04;
  return new THREE.Vector3(
    (ax + bx) / 2 + nx * fan,
    peak,
    (az + bz) / 2 + nz * fan,
  );
}

export function archCurve(
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, fan = 0,
): THREE.QuadraticBezierCurve3 {
  const start = new THREE.Vector3(ax, ay + FOOT_Y, az);
  const end = new THREE.Vector3(bx, by + FOOT_Y, bz);
  return new THREE.QuadraticBezierCurve3(start, archControl(ax, ay, az, bx, by, bz, fan), end);
}

const kindRadius = (k: FlowLinkKind) => (k === 'bridge' || k === 'relay' ? 0.042 : 0.046);

type TubePair = { core: THREE.Mesh; shadow: THREE.Mesh };

/** Smooth quadratic arches: even tube, dark under-stroke, small motes, foot rings. */
export class FlowArchOverlay {
  readonly group = new THREE.Group();
  private tubes: TubePair[] = [];
  private feet: THREE.InstancedMesh;
  private motes: THREE.InstancedMesh;
  private matCache = new Map<FlowLinkKind, THREE.MeshBasicMaterial>();
  private readonly shadowMat: THREE.MeshBasicMaterial;

  constructor() {
    const footGeo = new THREE.RingGeometry(0.05, 0.09, 20);
    const footMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.92, side: THREE.DoubleSide,
      depthTest: true, depthWrite: false,
    });
    this.feet = new THREE.InstancedMesh(footGeo, footMat, 64);
    this.feet.count = 0;
    this.feet.renderOrder = 8;
    this.feet.frustumCulled = false;
    this.group.add(this.feet);

    this.motes = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, depthWrite: false }),
      96,
    );
    this.motes.count = 0;
    this.motes.renderOrder = 9;
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
    this.group.renderOrder = 7;
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: col(SHADOW), transparent: true, opacity: 0.88, depthWrite: false,
    });
  }

  private mat(kind: FlowLinkKind) {
    let m = this.matCache.get(kind);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        color: col(kindColour(kind)), transparent: true, opacity: 0.96, depthWrite: false,
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
      const shadow = new THREE.Mesh(new THREE.BufferGeometry(), this.shadowMat);
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
      const fan = fanForLink(links, i);
      const curve = archCurve(ta.x, ta.y, ta.z, tb.x, tb.y, tb.z, fan);
      const r = kindRadius(L.kind);
      const geoCore = new THREE.TubeGeometry(curve, 48, r, 10, false);
      const geoSh = new THREE.TubeGeometry(curve, 48, r * 1.32, 10, false);
      const pair = this.tubes[i];
      pair.core.geometry.dispose();
      pair.shadow.geometry.dispose();
      pair.core.geometry = geoCore;
      pair.shadow.geometry = geoSh;
      pair.core.material = this.mat(L.kind);
      pair.core.renderOrder = 7.5;
      pair.shadow.renderOrder = 7;

      const hex = kindColour(L.kind);
      c.setHex(hex);
      for (const t of [ta, tb]) {
        m4.makeRotationX(-Math.PI / 2);
        m4.setPosition(t.x, t.y + FOOT_Y * 0.4, t.z);
        this.feet.setMatrixAt(footI, m4);
        this.feet.setColorAt(footI, c);
        footI++;
      }

      if (!reducedMotion) {
        const nMotes = 3;
        for (let m = 0; m < nMotes; m++) {
          const t = ((m / nMotes) + anim * 0.7) % 1;
          const p = curve.getPoint(t);
          const sc = r * 0.42;
          m4.makeScale(sc, sc, sc);
          m4.setPosition(p.x, p.y, p.z);
          this.motes.setMatrixAt(moteI, m4);
          this.motes.setColorAt(moteI, c);
          moteI++;
        }
      }
    }

    for (let j = footI; j < this.feet.count; j++) m4.makeScale(0, 0, 0), this.feet.setMatrixAt(j, m4);
    this.feet.count = Math.max(footI, 0);
    this.feet.instanceMatrix.needsUpdate = true;
    if (this.feet.instanceColor) this.feet.instanceColor.needsUpdate = true;

    for (let j = moteI; j < this.motes.count; j++) m4.makeScale(0, 0, 0), this.motes.setMatrixAt(j, m4);
    this.motes.count = moteI;
    this.motes.instanceMatrix.needsUpdate = true;
    if (this.motes.instanceColor) this.motes.instanceColor.needsUpdate = true;
    this.group.visible = links.length > 0;
  }
}
