import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BACKDROP, BLOOM, FOG, LIGHTS } from '../art/palette';

// ---------------------------------------------------------------------------
// Adaptive quality (pure, unit-testable)
// ---------------------------------------------------------------------------

export type QualityLevel = 0 | 1 | 2; // 0 = low, 1 = medium, 2 = high

export interface QualityProfile {
  level: QualityLevel;
  maxDpr: number;
  bloom: boolean;
  bloomScale: number; // bloom buffer size relative to drawing buffer
}

export const QUALITY_PROFILES: readonly QualityProfile[] = [
  { level: 0, maxDpr: 1, bloom: false, bloomScale: 0 },
  { level: 1, maxDpr: 1.5, bloom: true, bloomScale: 0.5 },
  { level: 2, maxDpr: 2, bloom: true, bloomScale: 1 },
];

export interface DeviceHints { dpr: number; coarsePointer: boolean; minSide: number }

/** Phones / coarse pointers start at medium (DPR <= 1.5, half-res bloom). */
export function initialQuality(h: DeviceHints): QualityLevel {
  return h.coarsePointer || h.minSide < 700 ? 1 : 2;
}

export function effectiveDpr(level: QualityLevel, dpr: number): number {
  return Math.min(QUALITY_PROFILES[level].maxDpr, Math.max(1, dpr));
}

/** Slow-frame governor: only ever steps down, so it can't oscillate. */
export const GOVERNOR = { emaAlpha: 0.05, slowMs: 1000 / 40, sustainS: 2, cooldownS: 4, ignoreDtS: 0.25 } as const;

export interface GovernorState { level: QualityLevel; emaMs: number; slowFor: number; cooldown: number }

export function stepGovernor(g: GovernorState, dtS: number): GovernorState {
  if (dtS <= 0 || dtS > GOVERNOR.ignoreDtS) return g; // tab switch / hitch: ignore
  const emaMs = g.emaMs + (dtS * 1000 - g.emaMs) * GOVERNOR.emaAlpha;
  const cooldown = Math.max(0, g.cooldown - dtS);
  const slowFor = emaMs > GOVERNOR.slowMs ? g.slowFor + dtS : 0;
  if (g.level > 0 && cooldown === 0 && slowFor >= GOVERNOR.sustainS) {
    return { level: (g.level - 1) as QualityLevel, emaMs: 1000 / 60, slowFor: 0, cooldown: GOVERNOR.cooldownS };
  }
  return { level: g.level, emaMs, slowFor, cooldown };
}

// ---------------------------------------------------------------------------
// Nebula / parchment backdrop
// ---------------------------------------------------------------------------

const BACKDROP_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const BACKDROP_FRAG = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
uniform vec3 uTop, uHorizon, uBottom, uNebulaA, uNebulaB, uStar;
uniform float uVignette, uGrain;
varying vec3 vDir;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.85, h));
  col = mix(col, uBottom, smoothstep(0.0, -0.55, h));

  float t = uTime;
  float n1 = fbm(d * 2.2 + vec3(t * 0.012, 0.0, t * 0.008));
  float n2 = fbm(d * 4.1 + vec3(0.0, -t * 0.010, 0.0) + n1 * 1.5);
  col += uNebulaA * smoothstep(0.42, 0.82, n1) * 0.55;
  col += uNebulaB * smoothstep(0.48, 0.88, n2) * 0.42;

  // Sparse ink-speck stars, kept under the bloom threshold.
  float s = noise(d * 160.0);
  col += uStar * pow(s, 24.0) * 0.6 * smoothstep(-0.1, 0.3, h);

  // Parchment grain + screen-space vignette; floor keeps it from going dead black.
  vec2 uv = gl_FragCoord.xy / uRes;
  col += (hash(vec3(gl_FragCoord.xy, 0.0)) - 0.5) * uGrain;
  col *= mix(1.0 - uVignette, 1.0, smoothstep(0.95, 0.2, length(uv - 0.5)));
  col = max(col, uBottom * 0.55);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function createBackdrop() {
  const c = (hex: number) => new THREE.Color(hex);
  const material = new THREE.ShaderMaterial({
    vertexShader: BACKDROP_VERT,
    fragmentShader: BACKDROP_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTop: { value: c(BACKDROP.top) },
      uHorizon: { value: c(BACKDROP.horizon) },
      uBottom: { value: c(BACKDROP.bottom) },
      uNebulaA: { value: c(BACKDROP.nebulaA) },
      uNebulaB: { value: c(BACKDROP.nebulaB) },
      uStar: { value: c(BACKDROP.star) },
      uVignette: { value: BACKDROP.vignette },
      uGrain: { value: BACKDROP.grain },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'backdrop';
  return { mesh, material };
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export interface QualityReport extends QualityProfile { dpr: number; emaMs: number; width: number; height: number }

export function createScene(canvas: HTMLCanvasElement, opts: { preserveDrawingBuffer?: boolean } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LIGHTS.exposure;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG.color); // fallback only; backdrop covers it
  scene.fog = new THREE.FogExp2(FOG.color, FOG.density);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(0, 13, 11);

  // Lighting: warm key, cool fill, coloured rim, balanced hemisphere.
  scene.add(new THREE.HemisphereLight(LIGHTS.hemiSky, LIGHTS.hemiGround, LIGHTS.hemiIntensity));
  const addDir = (color: number, intensity: number, pos: readonly [number, number, number], name: string) => {
    const l = new THREE.DirectionalLight(color, intensity);
    l.position.set(...pos);
    l.name = name;
    scene.add(l);
    return l;
  };
  addDir(LIGHTS.key, LIGHTS.keyIntensity, LIGHTS.keyPos, 'key');
  addDir(LIGHTS.fill, LIGHTS.fillIntensity, LIGHTS.fillPos, 'fill');
  addDir(LIGHTS.rim, LIGHTS.rimIntensity, LIGHTS.rimPos, 'rim');

  // Subtle reflections from a procedural room (no network assets).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  scene.environment = envRT.texture;
  scene.environmentIntensity = LIGHTS.envIntensity;

  const backdrop = createBackdrop();
  scene.add(backdrop.mesh);

  const controls = new OrbitControls(camera, canvas);
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.screenSpacePanning = false;
  controls.enableDamping = true;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = 1.15;
  controls.minDistance = 5;
  controls.maxDistance = 40;

  // Post: Render -> UnrealBloom -> Output (tone mapping + sRGB happen once, in OutputPass).
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  let gov: GovernorState = {
    level: initialQuality({ dpr: devicePixelRatio, coarsePointer: coarse, minSide: Math.min(innerWidth, innerHeight) }),
    emaMs: 1000 / 60, slowFor: 0, cooldown: GOVERNOR.cooldownS,
  };
  const drawSize = new THREE.Vector2();

  const applyQuality = () => {
    const p = QUALITY_PROFILES[gov.level];
    const dpr = effectiveDpr(gov.level, devicePixelRatio);
    renderer.setPixelRatio(dpr);
    renderer.setSize(innerWidth, innerHeight, false);
    composer.setPixelRatio(dpr);
    composer.setSize(innerWidth, innerHeight);
    renderer.getDrawingBufferSize(drawSize);
    bloom.enabled = p.bloom;
    if (p.bloom) bloom.setSize(Math.max(1, Math.round(drawSize.x * p.bloomScale)), Math.max(1, Math.round(drawSize.y * p.bloomScale)));
    backdrop.material.uniforms.uRes.value.copy(drawSize);
  };

  const resize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    applyQuality();
  };
  addEventListener('resize', resize);
  resize();

  let time = 0;
  /** Call once per rAF with frame delta in seconds. Replaces renderer.render(scene, camera). */
  const renderFrame = (dt: number) => {
    time += Math.min(Math.max(dt, 0), 0.1) * BACKDROP.drift;
    backdrop.material.uniforms.uTime.value = time;
    backdrop.mesh.position.copy(camera.position);
    const prev = gov.level;
    gov = stepGovernor(gov, dt);
    if (gov.level !== prev) applyQuality();
    composer.render(dt);
  };

  const getQuality = (): QualityReport => ({
    ...QUALITY_PROFILES[gov.level],
    dpr: renderer.getPixelRatio(),
    emaMs: gov.emaMs,
    width: drawSize.x,
    height: drawSize.y,
  });

  /** Force a level (QA / settings). Governor continues to only step down from here. */
  const setQuality = (level: QualityLevel) => {
    gov = { ...gov, level, slowFor: 0, cooldown: GOVERNOR.cooldownS };
    applyQuality();
  };

  const dispose = () => {
    removeEventListener('resize', resize);
    controls.dispose();
    composer.dispose();
    bloom.dispose();
    envRT.dispose();
    backdrop.mesh.geometry.dispose();
    backdrop.material.dispose();
    renderer.dispose();
  };

  return { renderer, scene, camera, controls, composer, renderFrame, resize, getQuality, setQuality, dispose };
}

export type SceneHandle = ReturnType<typeof createScene>;
