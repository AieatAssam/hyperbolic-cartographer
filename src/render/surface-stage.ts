import * as THREE from 'three';
import { STAGE } from '../art/palette';

/**
 * Procedural display stage for the manifold object: contact shadow, lacquered chart plinth with a brass rim
 * and engraved compass ring, two slowly turning armillary rings, drifting dust motes, and a warm key + cool rim
 * light. Everything is sized from the manifold's bounding radius. Lights live in the group, so they exist only
 * while a stage is shown.
 */
export interface ManifoldStage {
  readonly group: THREE.Group;
  /** call every frame; t = seconds, reduced = prefers-reduced-motion (then nothing moves) */
  tick(t: number, dt: number, reduced: boolean): void;
  dispose(): void;
}

const MOTE_COUNT = { low: 60, medium: 140, high: 260 } as const;
const SHADOW_N = 256;
const SHADOW_PEAK = 0.55;
const TWO_PI = Math.PI * 2;
/** Motes live in a shell that never comes closer to the origin than this many radii. */
const MOTE_NEAR = 1.15;
const MOTE_FAR = 1.9;
const MOTE_MAX_ELEV = 1.1;
const MOTE_RISE = 0.02; // rad/s of elevation drift
const RING_SPIN = [0.05, -0.035] as const;

/** Shadow alpha at normalised distance u (0 centre .. 1 edge): SHADOW_PEAK with smoothstep falloff. */
function shadowAlpha(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return SHADOW_PEAK * (1 - x * x * (3 - 2 * x));
}

function contactShadowTexture(): THREE.Texture {
  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas');
    cv.width = cv.height = SHADOW_N;
    const g = cv.getContext('2d');
    if (g) {
      const half = SHADOW_N / 2;
      const grad = g.createRadialGradient(half, half, 0, half, half, half);
      for (let i = 0; i <= 16; i++) grad.addColorStop(i / 16, `rgba(0,0,0,${shadowAlpha(i / 16).toFixed(4)})`);
      g.fillStyle = grad;
      g.fillRect(0, 0, SHADOW_N, SHADOW_N);
      return new THREE.CanvasTexture(cv);
    }
  }
  // Node / no 2D context: same falloff, written straight into pixels.
  const data = new Uint8Array(SHADOW_N * SHADOW_N * 4);
  for (let y = 0; y < SHADOW_N; y++) {
    for (let x = 0; x < SHADOW_N; x++) {
      const dx = ((x + 0.5) / SHADOW_N) * 2 - 1, dy = ((y + 0.5) / SHADOW_N) * 2 - 1;
      const i = (y * SHADOW_N + x) * 4;
      data[i + 3] = Math.round(shadowAlpha(Math.hypot(dx, dy)) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, SHADOW_N, SHADOW_N, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/** Engraved plinth: 72 ticks every 5 degrees (every 6th longer) plus two concentric circles, as LineSegments. */
function engravingGeometry(r: number): THREE.BufferGeometry {
  const pts: number[] = [];
  const seg = (a0: number, r0: number, a1: number, r1: number) => {
    pts.push(Math.cos(a0) * r0, 0, Math.sin(a0) * r0, Math.cos(a1) * r1, 0, Math.sin(a1) * r1);
  };
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * TWO_PI;
    seg(a, i % 6 === 0 ? 0.86 * r : 0.9 * r, a, 0.95 * r);
  }
  for (const k of [0.8, 0.97]) {
    for (let i = 0; i < 128; i++) {
      seg((i / 128) * TWO_PI, k * r, ((i + 1) / 128) * TWO_PI, k * r);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return geom;
}

export function buildManifoldStage(
  radius: number,
  floorY: number,
  env: THREE.Texture | null,
  quality: 'low' | 'medium' | 'high',
): ManifoldStage {
  const r = radius;
  const group = new THREE.Group();
  group.name = 'manifold-stage';

  const owned: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => { owned.push(x); return x; };

  // Materials
  const brass = track(new THREE.MeshStandardMaterial({
    color: STAGE.brass, metalness: 1, roughness: 0.42, envMap: env, envMapIntensity: 0.55,
  }));
  const lacquer = track(new THREE.MeshPhysicalMaterial({
    color: STAGE.lacquer, roughness: 0.5, clearcoat: 0.35, envMap: env, envMapIntensity: 0.3,
  }));
  const engraveMat = track(new THREE.LineBasicMaterial({
    color: STAGE.engrave, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
  }));

  // a) Contact shadow, drawn before the manifold.
  const shadowTex = track(contactShadowTexture());
  const shadowMat = track(new THREE.MeshBasicMaterial({
    map: shadowTex, transparent: true, depthWrite: false, fog: false,
  }));
  const shadow = new THREE.Mesh(track(new THREE.CircleGeometry(1.25 * r, 64)), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = floorY - 0.14 * r;
  shadow.renderOrder = -20;
  shadow.name = 'stage-shadow';
  group.add(shadow);

  // b) Chart plinth: lacquer disc, brass rim, engraved top face.
  const plinthY = floorY - 0.2 * r;
  const plinth = new THREE.Mesh(track(new THREE.CylinderGeometry(1.05 * r, 1.05 * r, 0.06 * r, 96)), lacquer);
  plinth.position.y = plinthY;
  plinth.name = 'stage-plinth';
  group.add(plinth);

  const rim = new THREE.Mesh(track(new THREE.TorusGeometry(1.05 * r, 0.012 * r, 12, 96)), brass);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = plinthY;
  rim.name = 'stage-plinth-rim';
  group.add(rim);

  const engraving = new THREE.LineSegments(track(engravingGeometry(r)), engraveMat);
  engraving.position.y = plinthY + 0.03 * r + 0.002 * r;
  engraving.name = 'stage-engraving';
  group.add(engraving);

  // c) Armillary gimbal. A torus spun about its own axis looks unchanged, so each ring sits in a tilt group
  //    inside a spin group; the spin group precesses about world Y and the ring stays centred on the origin.
  const ringSpecs = quality === 'low'
    ? [{ rx: 1.25, rz: 0, R: 1.16 }]
    : [{ rx: 1.25, rz: 0, R: 1.16 }, { rx: 0.35, rz: 0.5, R: 1.24 }];
  const rings: THREE.Group[] = [];
  ringSpecs.forEach((spec, i) => {
    const spin = new THREE.Group();
    spin.name = `gimbal-spin-${i}`;
    const tilt = new THREE.Group();
    tilt.rotation.set(spec.rx, 0, spec.rz);
    const ring = new THREE.Mesh(track(new THREE.TorusGeometry(spec.R * r, 0.006 * r, 12, 128)), brass);
    ring.name = `gimbal-${i}`;
    tilt.add(ring);
    spin.add(tilt);
    group.add(spin);
    rings.push(spin);
  });

  // d) Dust motes in a shell [MOTE_NEAR, MOTE_FAR] * r. Positions are stored as spherical coordinates so the
  //    shell radius is fixed and drift only changes elevation (no per-frame allocation). Motes stay above the
  //    plinth top: each one's lowest elevation is where its height reaches that plane.
  const plinthTop = plinthY + 0.03 * r;
  const moteCount = MOTE_COUNT[quality];
  const shellR = new Float32Array(moteCount);
  const shellTheta = new Float32Array(moteCount);
  const shellElev = new Float32Array(moteCount);
  const shellElevLow = new Float32Array(moteCount);
  const phase = new Float32Array(moteCount);
  const positions = new Float32Array(moteCount * 3);
  const colours = new Float32Array(moteCount * 3).fill(1);
  for (let i = 0; i < moteCount; i++) {
    shellR[i] = r * (MOTE_NEAR + Math.random() * (MOTE_FAR - MOTE_NEAR));
    shellTheta[i] = Math.random() * TWO_PI;
    shellElevLow[i] = Math.max(-MOTE_MAX_ELEV, Math.asin(Math.max(-1, Math.min(1, plinthTop / shellR[i]))));
    shellElev[i] = shellElevLow[i] + Math.random() * (MOTE_MAX_ELEV - shellElevLow[i]);
    phase[i] = Math.random() * TWO_PI;
  }
  const motePosition = (i: number) => {
    const e = shellElev[i], s = shellR[i], c = Math.cos(e) * s, th = shellTheta[i];
    positions[i * 3] = Math.cos(th) * c;
    positions[i * 3 + 1] = Math.sin(e) * s;
    positions[i * 3 + 2] = Math.sin(th) * c;
  };
  for (let i = 0; i < moteCount; i++) motePosition(i);
  const moteGeom = track(new THREE.BufferGeometry());
  moteGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  moteGeom.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const moteMat = track(new THREE.PointsMaterial({
    color: STAGE.mote, size: 0.05, vertexColors: true, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  const motes = new THREE.Points(moteGeom, moteMat);
  motes.frustumCulled = false;
  motes.renderOrder = 6;
  motes.name = 'stage-motes';
  group.add(motes);

  // e) Dedicated lights, parented to the group. Targets live in the group so they track its transform.
  const key = new THREE.SpotLight(STAGE.key, 2.2, 0, 0.5, 0.8, 0);
  key.position.set(1.6 * r, 2.2 * r, 1.4 * r);
  key.target.position.set(0, 0, 0);
  key.name = 'stage-key';
  const rimLight = new THREE.DirectionalLight(STAGE.rim, 1.6);
  rimLight.position.set(-1.5 * r, 0.6 * r, -1.8 * r);
  rimLight.target.position.set(0, 0, 0);
  rimLight.name = 'stage-rim';
  group.add(key, key.target, rimLight, rimLight.target);

  const tick = (t: number, dt: number, reduced: boolean) => {
    if (reduced) return;
    rings.forEach((spin, i) => { spin.rotation.y += RING_SPIN[i] * dt; });
    for (let i = 0; i < moteCount; i++) {
      let e = shellElev[i] + MOTE_RISE * dt;
      if (e > MOTE_MAX_ELEV) e = shellElevLow[i];
      shellElev[i] = e;
      motePosition(i);
      const b = 0.6 + 0.4 * Math.sin(t * (0.7 + (i % 5) * 0.13) + phase[i]);
      colours[i * 3] = b; colours[i * 3 + 1] = b; colours[i * 3 + 2] = b;
    }
    moteGeom.getAttribute('position').needsUpdate = true;
    moteGeom.getAttribute('color').needsUpdate = true;
  };

  const dispose = () => {
    group.removeFromParent();
    for (const x of owned) x.dispose();
    owned.length = 0;
  };

  return { group, tick, dispose };
}
