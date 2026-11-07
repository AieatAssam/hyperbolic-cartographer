import * as THREE from 'three';
import { FX, PLACE, TILE_IDENTITIES } from '../art/palette';
import type { TileType } from '../core/tiles';
import { TRANSITION_S, prestigeTimeline } from './transition';
import { CadenceCounter, MOTE_ACCEL, SlotArrivals, SlotRing, Throttle, accumulate, budgetFor, finite3, loneSprings, mulberry32, streamRate, validLinks, type FxBudget } from './fx-model';
import { EMBED_STRIDE, bumpRev, capRoutes, createEmbedding, planEdge, routeSchedule, writeFrame, type Embedding, type Route, type WaveCell } from './fx-graph';

/**
 * CartographyFX: every effect is one instanced quad in a pooled InstancedBufferGeometry, drawn with one ShaderMaterial
 * (1 draw call). The CPU writes spawn attributes into a fixed ring of slots and never writes positions for graph
 * effects. Anchored instances carry tile indices (aIdx). The vertex shader reads each tile's live frame from the
 * embedding texture and transforms it by uBoard, so boost-pan, recentre and prestige warp move particles with the board.
 *
 * Modes (aTime.w):
 *   0 Leg     edge a→b (or half-leg stub when aFx.z = 1 leave, 2 arrive), lifted along the local normal, directional trail.
 *   1 Mote    rises along the tile normal, then flies to the HUD Ink counter with an accelerating bow (screen space).
 *   2 Spark   billboard in the tile's tangent plane: radius aA.z → aB.z (eased), height aA.x along the normal.
 *   3 Ring    annulus in the tile's tangent plane, radius aB.x → aB.y, width aB.z (world, pitch units).
 *   4 Pop     screen-space annulus at the HUD Ink counter (counter arrival).
 *   5 Wash    screen-space overlay sprite (Drift).
 *   6 Vortex  screen-space spiral sprite (Projection).
 *
 * Sizes: anchored modes use radii in tile pitches (aTime.z), converted with the perspective projection and clamped
 * to [minPx, maxPx]. Screen modes use CSS px. Only the screen modes and Pop use CSS px.
 * Board fade: Leg, Mote, Spark and Ring multiply their alpha by uAnchorFade (setAnchorFade), so they fade with the board
 * during a prestige. Wash, Vortex and Pop are screen space and ignore it.
 * Randomness comes from a seeded PRNG (seed()), never Math.random.
 */
const enum Mode { Leg = 0, Mote = 1, Spark = 2, Ring = 3, Pop = 4, Wash = 5, Vortex = 6 }

export type FxQuality = 0 | 1 | 2;
export type PrestigeKind = 'drift' | 'projection';
export type PrestigePhase = 'out' | 'in';

export interface FxContext {
  /** Legacy: board tile tops. Used for anchors only when `embed` is absent. */
  tops: readonly THREE.Vector3[];
  /** Legacy: production links [from, to]. Used only when `routes` is absent. */
  links?: readonly (readonly [number, number])[];
  /** Tile types by index (s.tiles). */
  tiles: readonly (string | null | undefined)[];
  /** Optional per-tile output; brightens/enlarges busy sources. */
  perTile?: readonly number[];
  /** Unused since B2 (Bridge arcs are routes now). Kept so older callers still compile. */
  neighbours?: readonly (readonly number[])[];
  quality: FxQuality;
  /** HUD Ink counter centre in NDC (-1..1, y up). Null/undefined uses top-centre. */
  inkTargetNdc?: readonly [number, number] | null;
  /** Live per-tile frames (board.embed). Preferred: anchored instances read it every frame. */
  embed?: Embedding;
  /** Production routes (productionRoutes). Preferred over `links`. */
  routes?: readonly Route[];
  /** Live board transform (board.group.matrixWorld). Read at render time, so boost-pan and warp stay attached. */
  boardMatrix?: THREE.Matrix4;
  /** CSS viewport area for budget scaling (budgetFor). Optional. */
  viewportPx?: number;
}

export interface FxStats {
  capacity: number; live: number; spawned: number; pendingInk: number; quality: FxQuality; drawCalls: 1; time: number;
  /** PRNG seed in use (fx.seed). */
  seed: number;
  /** Live instances anchored to a tile, and screen-space ones. */
  anchored: number; screen: number;
  /**
   * ESTIMATE, not a GPU measurement: sum of π·r² over live instances (anchored assumed 12 CSS px) divided by the
   * CSS viewport area. 0 before the first render.
   */
  overdrawEst: number;
  /** Embedding revision last uploaded to the texture (0 when no embedding yet). */
  embedRev: number;
  /** Board opacity for the anchored layer last set by setAnchorFade (1 = shown). Diagnostic only. */
  readonly anchorFade: number;
}

const TEX_W = 256;
const ANCHOR_ESTIMATE_PX = 12;
const MAX_CAPACITY = budgetFor(2).capacity;
const DEFAULT_INK: [number, number] = [0, 0.92];
const ZERO3: [number, number, number] = [0, 0, 0];
const col = new THREE.Color();
const lit = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`);

const VERT = /* glsl */ `
attribute vec3 aA; attribute vec3 aB; attribute vec3 aCol; attribute vec4 aTime; attribute vec2 aExtra;
attribute vec2 aIdx; attribute vec3 aFx;
uniform float uTime; uniform float uPx; uniform vec2 uRes; uniform vec2 uInk;
uniform float uPitch; uniform float uEmbedH; uniform float uMinPx; uniform float uMaxPx;
uniform float uAnchorFade;
uniform mat4 uBoard; uniform sampler2D uEmbed;
varying vec2 vP; varying vec2 vS; varying vec3 vCol; varying float vAlpha; varying float vKind; varying float vAdd; varying float vStr;
const float PI = 3.14159265;
const float TRAIL = ${lit(FX.trail)};
const float RISE_T = ${lit(FX.riseFrac)};
const float RISE_R = ${lit(FX.riseR)};
const float STUB = ${lit(FX.stub)};
const float MOTE_P = ${lit(MOTE_ACCEL)};

// Embedding texture, RGBA32F, 256 texels wide, read with texture2D and NEAREST (no texelFetch, so GLSL1 style works).
// Tile i: texel 3i = (x,y,z,s); 3i+1 = (nx,ny,nz,0); 3i+2 = (tx,ty,tz,chi).
vec4 texel(float k) { return texture2D(uEmbed, vec2((mod(k, 256.0) + 0.5) / 256.0, (floor(k / 256.0) + 0.5) / uEmbedH)); }
vec4 tilePos(float i) { return texel(3.0 * i); }
vec4 tileNrm(float i) { return texel(3.0 * i + 1.0); }
vec4 tileTan(float i) { return texel(3.0 * i + 2.0); }

// Same tangent rule as fx-graph tangentBasis: reference axis Y unless the normal is near-vertical.
vec3 tangentX(vec3 n) { return normalize(cross(abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), n)); }
float vis(float s) { return smoothstep(0.02, 0.08, s); }
float easeIO(float x) { return 0.5 - 0.5 * cos(PI * clamp(x, 0.0, 1.0)); }
float easeOut2(float x) { float u = 1.0 - clamp(x, 0.0, 1.0); return 1.0 - u * u; }

// Board-local point to clip space, through the live board transform.
vec4 toClip(vec3 p) { return projectionMatrix * viewMatrix * vec4((uBoard * vec4(p, 1.0)).xyz, 1.0); }

// Device-px radius for a world radius R (pitch units) on a tile of scale s at clip depth w, clamped to the CSS px range.
float worldPx(float R, float s, float w) {
  return clamp(R * uPitch * s * projectionMatrix[1][1] * uRes.y * 0.5 / max(w, 1e-4), uMinPx * uPx, uMaxPx * uPx);
}

// Screen billboard around clip point c, radius Q device px.
void emit(vec4 c, float Q, float alpha) {
  vec2 off = position.xy * Q;
  gl_Position = vec4(c.xy + off * 2.0 / uRes * c.w, c.z, c.w);
  vP = off; vS = vec2(0.0, Q); vKind = 0.0; vAlpha = alpha;
}
// Screen annulus at clip point c: radius R, half-width W, quad radius Q (device px).
void emitRing(vec4 c, float R, float W, float Q, float alpha) {
  vec2 off = position.xy * Q;
  gl_Position = vec4(c.xy + off * 2.0 / uRes * c.w, c.z, c.w);
  vP = off; vS = vec2(R, W); vKind = 1.0; vAlpha = alpha;
}

// Local-space point along an edge at eased parameter k. Phase 0 is a lifted leg a→b. Phase 1 leaves the anchor a toward b.
// Phase 2 arrives at the anchor a from b, so the anchor is the far end and k runs inward.
vec3 edgeAt(vec4 fa, vec3 na, vec4 fb, vec3 nb, vec3 nLow, float phase, float k, float lift) {
  if (phase > 0.5) {
    float u = phase < 1.5 ? k : 1.0 - k;
    vec3 d = fb.xyz - fa.xyz;
    d -= dot(d, na) * na;
    vec3 dir = length(d) > 1e-6 ? normalize(d) : tangentX(na);
    return fa.xyz + dir * (STUB * uPitch * fa.w * u);
  }
  vec3 n = na + nb;
  n = length(n) >= 1e-3 ? normalize(n) : tangentX(nLow);
  float sBar = 0.5 * (fa.w + fb.w);
  return mix(fa.xyz, fb.xyz, k) + n * (lift * uPitch * sBar * sin(PI * k));
}

void main() {
  float life = aTime.y, mode = aTime.w;
  float t = (uTime - aTime.x) / max(life, 1e-4);
  vCol = aCol; vAdd = aFx.x; vStr = aFx.y; vKind = 0.0; vS = vec2(0.0, 1.0); vP = position.xy; vAlpha = 0.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (t < 0.0 || t > 1.0 || life <= 0.0) return;
  float fade = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.7, 1.0, t));
  float px = aTime.z;
  float ia = max(aIdx.x, 0.0), ib = max(aIdx.y, 0.0);
  vec4 fa = tilePos(ia);
  vec3 na = tileNrm(ia).xyz;

  if (mode < 0.5) {
    // Leg: one edge (or half-leg stub). The trail is the same path sampled at t - TRAIL, stretched along the screen motion.
    vec4 fb = tilePos(ib);
    vec3 nb = tileNrm(ib).xyz;
    vec3 nLow = aIdx.x <= aIdx.y ? na : nb;
    vec3 hL = edgeAt(fa, na, fb, nb, nLow, aFx.z, easeIO(t), aExtra.x);
    vec3 tL = edgeAt(fa, na, fb, nb, nLow, aFx.z, easeIO(max(t - TRAIL, 0.0)), aExtra.x);
    vec4 cH = toClip(hL), cT = toClip(tL);
    if (cH.w <= 1e-3 || cT.w <= 1e-3) return;
    vec2 nH = cH.xy / cH.w, nT = cT.xy / cT.w;
    vec2 dpx = (nH - nT) * 0.5 * uRes;
    float L = length(dpx);
    vec2 dir = L > 1e-3 ? dpx / L : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    float W = worldPx(px, 0.5 * (fa.w + fb.w), cH.w);
    float h = 0.5 * L;
    vec2 off = dir * (position.x * (h + W)) + perp * (position.y * W);
    gl_Position = vec4((0.5 * (nH + nT) + off * 2.0 / uRes) * cH.w, cH.z, cH.w);
    vP = off; vS = vec2(h, W);
    vAlpha = fade * min(vis(fa.w), vis(fb.w)) * uAnchorFade;
  } else if (mode < 1.5) {
    // Mote: rise along the normal (world), then a screen-space flight to the Ink counter with an accelerating bow.
    float fm = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.9, 1.0, t));
    float rise = RISE_R * uPitch * fa.w;
    if (t < RISE_T) {
      emit(toClip(fa.xyz + na * (rise * easeOut2(t / RISE_T))), px * uPx, fm * vis(fa.w) * uAnchorFade);
    } else {
      vec2 st = toClip(fa.xyz + na * rise).xy / toClip(fa.xyz + na * rise).w;
      float k2 = (t - RISE_T) / (1.0 - RISE_T);
      float k = pow(k2, MOTE_P);
      vec2 dv = uInk - st;
      vec2 ndc = st + dv * k + vec2(-dv.y, dv.x) * (sin(PI * k2) * aExtra.x);
      emit(vec4(ndc, -0.5, 1.0), px * uPx * mix(1.0, 0.8, k), fm * uAnchorFade);
    }
  } else if (mode < 2.5) {
    // Spark: billboard at a point in the tangent plane, eased outward or inward (aA.z → aB.z) and lifted along the normal.
    vec3 T = tangentX(na), B = cross(na, T);
    float k = easeOut2(t);
    float rad = mix(aA.z, aB.z, k) * uPitch * fa.w;
    vec4 c = toClip(fa.xyz + (T * aB.x + B * aB.y) * rad + na * (aA.x * uPitch * fa.w * k));
    emit(c, worldPx(px, fa.w, c.w), fade * vis(fa.w) * uAnchorFade);
  } else if (mode < 3.5) {
    // Ring: annulus lying in the tile's tangent plane (a real world ring on the local frame).
    float k = easeOut2(t);
    float Rw = mix(aB.x, aB.y, k) * uPitch * fa.w;
    float ww = max(aB.z * uPitch * fa.w, 1e-4);
    float Q = Rw + 2.0 * ww;
    vec3 T = tangentX(na), B = cross(na, T);
    gl_Position = toClip(fa.xyz + na * (0.01 * uPitch * fa.w) + (T * position.x + B * position.y) * Q);
    vP = position.xy * Q; vS = vec2(Rw, ww); vKind = 1.0; vAlpha = fade * vis(fa.w) * uAnchorFade;
  } else if (mode < 4.5) {
    // Pop: soft expanding annulus at the HUD Ink counter.
    float k = easeOut2(t);
    float R = mix(0.2, 1.0, k) * px * uPx;
    float W = max(0.14 * px * uPx, 1.0);
    emitRing(vec4(uInk, -0.5, 1.0), R, W, R + 2.0 * W, fade);
  } else if (mode < 5.5) {
    emit(vec4(aA.xy + aB.xy * t, -0.9, 1.0), px * uPx, fade * 0.8);
  } else {
    float ang = aA.x + aB.x * t * (1.0 + t);
    float rad = aA.y * (1.0 - aB.y * t * t);
    vec2 c = vec2(cos(ang), sin(ang)) * rad * vec2(uRes.y / max(uRes.x, 1.0), 1.0);
    emit(vec4(c, -0.9, 1.0), px * uPx, fade);
  }
}`;

const FRAG = /* glsl */ `
varying vec2 vP; varying vec2 vS; varying vec3 vCol; varying float vAlpha; varying float vKind; varying float vAdd; varying float vStr;
void main() {
  if (vAlpha <= 0.0) discard;
  float cov, I;
  if (vKind > 0.5) {
    // Annulus: vS.x is the centre radius, vS.y the half-width.
    cov = 1.0 - smoothstep(0.0, vS.y, abs(length(vP) - vS.x));
    if (cov <= 0.0) discard;
    I = 1.25 * cov;
  } else {
    // Soft billboard, or a capsule for legs (vS.x = half-length, vS.y = radius). Distance is normalised to the radius.
    float dx = clamp(vP.x, -vS.x, vS.x);
    float d = length(vec2(vP.x - dx, vP.y)) / max(vS.y, 1e-4);
    if (d > 1.0) discard;
    float core = exp(-18.0 * d * d);
    float halo = exp(-4.0 * d * d) * (1.0 - smoothstep(0.92, 1.0, d));
    cov = min(1.0, halo + core);
    I = 0.55 * halo + 1.25 * core;
    // Trail: brightest at the head (+x), fading linearly to 0 at the tail.
    if (vS.x > 0.0) I *= clamp(0.5 + 0.5 * vP.x / vS.x, 0.0, 1.0);
  }
  // Source colour only, never mixed toward white. Cap the brightest channel while keeping the hue ratio.
  vec3 c = vCol * I;
  c *= min(1.0, 1.6 / max(max(c.r, max(c.g, c.b)), 1e-4));
  float g = vAlpha * vStr;
  // Premultiplied over: rgb = colour · coverage; alpha is reduced by additivity, so overlaps saturate and do not blow to white.
  gl_FragColor = vec4(c * cov * g, min(1.0, cov * g) * (1.0 - vAdd));
}`;

const makeTexture = (data: Float32Array, h: number) => {
  const t = new THREE.DataTexture(data, TEX_W, h, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
};

interface Put {
  mode: Mode;
  /** Anchor tile (or from-tile for legs). -1 for screen modes. */
  a?: number;
  /** Second tile for legs and stubs (toward). */
  b?: number;
  A?: readonly [number, number, number];
  B?: readonly [number, number, number];
  col: number;
  /** Anchored modes: radius in pitches (aTime.z). Screen modes: CSS px. */
  size: number;
  life: number;
  delay: number;
  /** Additive share of the colour (aFx.x). */
  add: number;
  /** Colour and alpha multiplier (aFx.y). */
  str?: number;
  /** aExtra.x: leg lift (pitches) or mote bow. */
  x?: number;
  /** Leg phase (aFx.z): 0 full leg, 1 leave, 2 arrive. */
  phase?: number;
}

const routesFromLinks = (links: readonly (readonly [number, number])[], tiles: readonly (string | null | undefined)[]): Route[] =>
  links.map(([a, b]): Route => ({ nodes: [a, b], source: (tiles[a] ?? 'spring') as TileType, kind: tiles[a] === 'beacon' ? 'boost' : 'feed' }));

const IDENTITY = new THREE.Matrix4();

export class CartographyFX {
  readonly group = new THREE.Group();
  /** Called with the summed weight of ink motes that reached the HUD target this update. */
  onInkArrive: ((weight: number) => void) | null = null;

  private geo = new THREE.InstancedBufferGeometry();
  private mat: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private aA = new Float32Array(MAX_CAPACITY * 3);
  private aB = new Float32Array(MAX_CAPACITY * 3);
  private aCol = new Float32Array(MAX_CAPACITY * 3);
  private aTime = new Float32Array(MAX_CAPACITY * 4);
  private aExtra = new Float32Array(MAX_CAPACITY * 2);
  private aIdx = new Float32Array(MAX_CAPACITY * 2);
  private aFx = new Float32Array(MAX_CAPACITY * 3);
  private attrs: THREE.InstancedBufferAttribute[] = [];
  private dirtyMin = Infinity;
  private dirtyMax = -1;

  private quality: FxQuality = 1;
  private viewport: number | undefined;
  private budget: FxBudget = budgetFor(1);
  private ring = new SlotRing(this.budget.capacity);
  /** Pending mote arrivals, keyed by the mote's slot. A Pop is made only when one of these actually fires. */
  private arrivals = new SlotArrivals(MAX_CAPACITY);
  /** End time of each Pop in flight, one slot per budget.pops, so concurrent pops stay bounded. */
  private popEnd = new Float64Array(this.budget.pops);
  private popGate = new Throttle(FX.popGap);
  private cadence = new CadenceCounter(FX.motesPerArrivals);
  private time = 0;
  private spawned = 0;
  private frameSpawns = 0;
  private pulseCarry = 0;
  private moteCarry = 0;
  private auraClock = 0;
  private pulseCursor = 0;
  private moteCursor = 0;
  private births = new Map<number, number>();
  private seedValue = 0;
  private rng: () => number = mulberry32(0);
  /** Board opacity for the anchored layer (1 = shown). Below 1 the board is fading, so no new streams start. */
  private anchorFade = 1;

  /** Frames the instances read: the caller's embedding, or one built from legacy tops. */
  private src: Embedding | null = null;
  private legacy: Embedding | null = null;
  private legacyTops: readonly THREE.Vector3[] | null = null;
  private routes: readonly Route[] = [];
  /** Streamed production: feed routes only. Boost routes fire on the Beacon aura tick, never on the stream. */
  private feedRoutes: readonly Route[] = [];
  private boostRoutes: readonly Route[] = [];
  /** Producers with no feed route (Springs, Mills): each emits a mote on its own stream. */
  private loneProducers: number[] = [];
  private tiles: readonly (string | null | undefined)[] = [];
  private perTile: readonly number[] | undefined;
  private boardRef: THREE.Matrix4 | null = null;

  private texBuf = new Float32Array(TEX_W * 4);
  private tex = makeTexture(this.texBuf, 1);
  private texSrc: Embedding | null = null;
  private texRev = -1;
  private texCount = -1;
  private texH = 1;
  private cssW = 1;
  private cssH = 1;
  private res = new THREE.Vector2();

  constructor(quality: FxQuality = 1) {
    this.seed(Date.now());
    const quad = new THREE.PlaneGeometry(2, 2);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    const add = (name: string, arr: Float32Array, size: number) => {
      const a = new THREE.InstancedBufferAttribute(arr, size).setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(name, a);
      this.attrs.push(a);
    };
    add('aA', this.aA, 3);
    add('aB', this.aB, 3);
    add('aCol', this.aCol, 3);
    add('aTime', this.aTime, 4);
    add('aExtra', this.aExtra, 2);
    add('aIdx', this.aIdx, 2);
    add('aFx', this.aFx, 3);
    for (let i = 0; i < MAX_CAPACITY; i++) (this.aTime[i * 4 + 1] = -1), (this.aIdx[i * 2] = -1), (this.aIdx[i * 2 + 1] = -1);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 }, uPx: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) }, uInk: { value: new THREE.Vector2(...DEFAULT_INK) },
        uPitch: { value: 1 }, uEmbedH: { value: 1 }, uMinPx: { value: FX.minPx }, uMaxPx: { value: FX.maxPx },
        uAnchorFade: { value: 1 }, uBoard: { value: new THREE.Matrix4() }, uEmbed: { value: this.tex },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      premultipliedAlpha: true,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.onBeforeRender = (r) => {
      r.getDrawingBufferSize(this.res);
      const dpr = r.getPixelRatio();
      this.mat.uniforms.uRes.value.copy(this.res);
      this.mat.uniforms.uPx.value = dpr;
      this.mat.uniforms.uBoard.value.copy(this.boardRef ?? IDENTITY);
      this.cssW = this.res.x / dpr;
      this.cssH = this.res.y / dpr;
    };
    this.group.add(this.mesh);
    this.applyQuality(quality);
  }

  setQuality(q: FxQuality) {
    if (q === this.quality && this.ring) return;
    this.applyQuality(q);
  }

  /**
   * Derives every quality- and viewport-dependent field. Capacity is never scaled. A quality change cancels pending
   * arrivals and ends in-flight Pops in the attributes themselves, so no feedback outlives the budget that made it.
   * Slots at or above the new capacity are no longer drawn (instanceCount).
   */
  private applyQuality(q: FxQuality) {
    this.quality = q;
    this.budget = budgetFor(q, this.viewport);
    this.ring = new SlotRing(this.budget.capacity);
    this.geo.instanceCount = this.budget.capacity;
    this.killMode(Mode.Pop);
    this.arrivals.clear();
    this.popEnd = new Float64Array(this.budget.pops);
  }

  /**
   * Viewport-only change: re-derives the budget (stream rates, overlay, reveal) and keeps the ring, the pool and pending
   * arrivals. A change of capacity or Pop count still takes the full path, because those arrays are sized from them.
   */
  private rescale() {
    const next = budgetFor(this.quality, this.viewport);
    if (next.capacity !== this.budget.capacity || next.pops !== this.budget.pops) return this.applyQuality(this.quality);
    this.budget = next;
  }

  /**
   * Board opacity for the anchored layer, set from the same value as board.setFade during a prestige (1 when shown).
   * Leg, Mote, Spark and Ring fade with it. Wash, Vortex and Pop are screen space and do not. Below 1, update() starts
   * no production streams, lone-producer motes or aura ticks, so no arrival is armed for a board that is not visible.
   */
  setAnchorFade(a: number) {
    this.anchorFade = Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1;
    this.mat.uniforms.uAnchorFade.value = this.anchorFade;
  }

  /** Ends every live instance of one mode (life -1, so the shader discards it) and marks the buffers dirty. */
  private killMode(m: Mode) {
    for (let i = 0; i < MAX_CAPACITY; i++) if (this.aTime[i * 4 + 3] === m) this.aTime[i * 4 + 1] = -1;
    this.markAllDirty();
  }

  /** Reseeds the PRNG. The same seed and dt sequence give the same frames. */
  seed(n: number) {
    this.seedValue = Number.isFinite(n) ? n >>> 0 : 0;
    this.rng = mulberry32(this.seedValue);
  }

  /**
   * Binds the frame's inputs without advancing time, emitting streams or processing arrivals: embedding and texture,
   * board transform, routes (split into feed and boost), lone producers, quality and viewport, and the HUD Ink target.
   * update() calls it first. Call it after board.update and before scheduling FX against the new frame, so a Projection
   * or rebuild never spawns against stale indices or a stale transform.
   */
  prepare(ctx: FxContext): void {
    const viewportChanged = ctx.viewportPx !== this.viewport;
    this.viewport = ctx.viewportPx;
    if (ctx.quality !== this.quality) this.applyQuality(ctx.quality);
    else if (viewportChanged) this.rescale();
    this.tiles = ctx.tiles;
    this.perTile = ctx.perTile;
    this.boardRef = ctx.boardMatrix ?? null;
    this.src = ctx.embed ?? this.legacyFrom(ctx.tops);
    this.syncTexture(this.src);
    this.routes = ctx.routes ?? routesFromLinks(validLinks(ctx.links ?? [], ctx.tops), ctx.tiles);
    this.feedRoutes = this.routes.filter((r) => r.kind === 'feed');
    this.boostRoutes = this.routes.filter((r) => r.kind === 'boost');
    const feedEnds = this.feedRoutes.map((r) => [r.nodes[0], r.nodes[r.nodes.length - 1]] as const);
    this.loneProducers = loneSprings(ctx.tiles, feedEnds, ['spring', 'mill']).filter((i) => this.anchorOK(i));
    const ink = ctx.inkTargetNdc;
    if (ink && Number.isFinite(ink[0]) && Number.isFinite(ink[1])) this.mat.uniforms.uInk.value.set(ink[0], ink[1]);
  }

  /** Per-frame driver. Calls prepare(ctx), then advances. dt in seconds (clamped to 0.25 so a tab switch does not flood). */
  update(dt: number, ctx: FxContext) {
    this.prepare(ctx);
    dt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.25) : 0;
    this.time += dt;
    this.frameSpawns = 0;
    if (this.anchorFade >= 1) this.streams(dt);

    // Arrivals that survived to their time (an overwritten mote is not here). One HUD bump with the summed weight,
    // and at most one Pop per throttle gap, created now rather than booked at spawn.
    const arrived = this.arrivals.due(this.time);
    if (arrived > 0) {
      this.onInkArrive?.(arrived);
      if (this.popGate.take(this.time) && this.takePop(this.time)) {
        this.put({ mode: Mode.Pop, col: FX.ink, size: FX.popPx, life: FX.popLife, delay: 0, add: FX.addPop, str: FX.popStrength });
      }
    }
    this.mat.uniforms.uTime.value = this.time;
    this.flush();
  }

  /**
   * Production streams: feed legs, lone-producer motes and Beacon aura ticks. Only update() calls it, and only while the
   * anchored layer is fully shown (see setAnchorFade).
   */
  private streams(dt: number) {
    const b = this.budget;
    let n: number;

    // Production: round-robin over feed routes (deterministic, not random), gated by the per-second rate.
    [n, this.pulseCarry] = accumulate(this.pulseCarry, streamRate(this.feedRoutes.length, b.pulsePerLink, b.pulseRate), dt, this.room());
    for (let k = 0; k < n && this.feedRoutes.length; k++) this.fireRoute(this.feedRoutes[this.pulseCursor++ % this.feedRoutes.length], 0);

    // Producers with no feed route (lone Springs and Mills) emit motes on their own stream, in their own colour.
    [n, this.moteCarry] = accumulate(this.moteCarry, streamRate(this.loneProducers.length, b.motePerSpring, b.moteRate), dt, this.room());
    for (let k = 0; k < n && this.loneProducers.length; k++) {
      const i = this.loneProducers[this.moteCursor++ % this.loneProducers.length];
      this.mote(i, this.tileColour(this.tiles[i], FX.ink), FX.motePx * this.grow(i));
      this.frameSpawns++;
    }

    if ((this.auraClock += dt) >= b.auraEvery) {
      this.auraClock = 0;
      this.tiles.forEach((t, i) => t === 'beacon' && this.beaconAura(i));
    }
  }

  // ---- one-shots (indices refer to the embedding frames of the last update) ----

  /** Placement: a Ring and sparks that begin at PLACE.dip, the moment of impact on the compressed tile. */
  placement(index: number, colour: number) {
    if (!this.anchorOK(index)) return;
    this.births.set(index, this.time);
    const d = PLACE.dip;
    this.ringAt(index, 0.35, 0.75, FX.ringWidth, colour, FX.impactLife, d, 1);
    const n = this.budget.burst;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + this.rnd() * 0.4, r = 0.45 * (0.6 + 0.5 * this.rnd());
      this.put({ mode: Mode.Spark, a: index, A: [0.12, 0, 0], B: [Math.cos(a), Math.sin(a), r], col: colour, size: FX.sparkR, life: FX.sparkLife, delay: d, add: FX.addSpark });
    }
  }

  /** Sell: sold-type sparks start on a 0.45-pitch ring, move inward and sink along the normal. One refund mote goes to Ink. */
  sell(index: number, colour: number = FX.sell) {
    if (!this.anchorOK(index)) return;
    this.births.delete(index);
    for (let k = 0; k < this.budget.puff; k++) {
      const a = this.rnd() * Math.PI * 2;
      this.put({
        mode: Mode.Spark, a: index, A: [-0.15, 0, 0.45], B: [Math.cos(a), Math.sin(a), 0.1], col: colour, size: FX.sparkR,
        life: FX.sellLife * (0.9 + 0.2 * this.rnd()), delay: 0, add: FX.addSpark,
      });
    }
    this.mote(index, FX.ink, FX.motePx);
  }

  /** Survey reveal from a precomputed wave (fx-graph surveyWave): strong cells get a ring and sparks, others a glint. */
  surveyReveal(wave: readonly WaveCell[]) {
    for (const w of wave) {
      if (!this.anchorOK(w.i)) continue;
      if (w.strong) {
        this.ringAt(w.i, 0.2, FX.revealRadius, FX.ringWidth, FX.ring, FX.ringLife, w.delay, 1);
        for (let k = 0; k < 2; k++) {
          const a = this.rnd() * Math.PI * 2;
          this.put({ mode: Mode.Spark, a: w.i, A: [0.1, 0, 0], B: [Math.cos(a), Math.sin(a), 0.5], col: FX.ring, size: FX.sparkR, life: FX.sparkLife, delay: w.delay, add: FX.addSpark });
        }
      } else {
        const a = this.rnd() * Math.PI * 2;
        this.put({ mode: Mode.Spark, a: w.i, A: [0.05, 0, 0.02], B: [Math.cos(a), Math.sin(a), 0.3], col: FX.ring, size: FX.sparkR * 0.7, life: FX.relayLife, delay: w.delay, add: FX.addSpark, str: 0.4 });
      }
    }
  }

  /** Beacon aura: a thin coral ring on the beacon, plus boost legs along real routes to affected producers. */
  beaconAura(index: number) {
    if (!this.anchorOK(index)) return;
    const boost = this.boostRoutes.filter((r) => r.nodes[0] === index);
    const sent = capRoutes(boost, this.budget.auraLinks);
    this.ringAt(index, 0.45, 0.7, FX.ringWidth, FX.beacon, FX.auraLife, 0, sent.length ? FX.beaconAlpha : FX.beaconIdle);
    for (const r of sent) this.fireRoute(r, 0);
  }

  /**
   * Prestige overlay for one phase of the timeline (transition.ts prestigeTimeline). 'out' spawns at the start of the
   * transition and every window ends by the swap. 'in' spawns at the swap, so its windows are relative to it.
   * 'reveal' windows are board work (board.markRevealed), so FX skips them.
   * Drift: the wash sweeps down (out) and recedes outward (in). Projection: the vortex collapses to 0 at the swap (out)
   * and reverses outward (in). Reduced motion passes reduced = true, which scales counts by 0.3 and stops the spin.
   */
  prestige(kind: PrestigeKind, phase: PrestigePhase = 'out', total = TRANSITION_S, reduced = false) {
    const T = Number.isFinite(total) && total > 0 ? total : TRANSITION_S;
    const shift = phase === 'in' ? T / 2 : 0;
    for (const w of prestigeTimeline(kind, T, reduced)) {
      if (w.phase !== phase || w.effect === 'reveal') continue;
      const span = Math.max(0, w.end - w.start), from = w.start - shift;
      const n = Math.max(1, Math.round(this.budget.overlay * w.countScale));
      for (let k = 0; k < n && span > 0; k++) {
        const r = this.rnd(), th = this.rnd() * Math.PI * 2;
        if (w.effect === 'wash') {
          const life = Math.min(FX.overlayLife * (0.7 + 0.3 * r), span);
          const delay = from + this.rnd() * (span - life);
          const A: [number, number, number] = phase === 'out' ? [this.rnd() * 2.4 - 1.2, 1.1 + 0.3 * this.rnd(), 0] : [0, 0, 0];
          const B: [number, number, number] = phase === 'out'
            ? [(this.rnd() - 0.5) * 0.4, -2.4 - this.rnd(), 0]
            : [Math.cos(th) * (1.2 + r), Math.sin(th) * (1.2 + r), 0];
          this.put({ mode: Mode.Wash, A, B, col: FX.wash, size: FX.overlayPx * (0.7 + 0.5 * this.rnd()), life, delay, add: FX.addWash, str: w.alpha });
        } else {
          const spin = w.spin ? 3 + 2 * this.rnd() : 0;
          const A: [number, number, number] = phase === 'out' ? [th, 0.4 + 0.9 * r, 0] : [th, 0.15, 0];
          const B: [number, number, number] = phase === 'out' ? [spin, 1, 0] : [spin, -3, 0];
          this.put({
            mode: Mode.Vortex, A, B, col: k % 3 ? FX.vortex : FX.bridge, size: FX.overlayPx * (0.5 + 0.6 * r),
            life: span, delay: from, add: FX.addVortex, str: w.alpha,
          });
        }
      }
    }
  }

  /** Seconds since index was placed (Infinity if never or sold). Used for the squash-settle timing. */
  sincePlaced(index: number): number {
    const t = this.births.get(index);
    return t === undefined ? Infinity : this.time - t;
  }
  get now() {
    return this.time;
  }

  /**
   * Kills graph-anchored instances, pending motes, their pops and pending arrivals. Call on a board swap (indices change).
   * Screen-space Wash and Vortex keep running, so the prestige overlay survives the swap.
   */
  clearAnchored() {
    for (let i = 0; i < MAX_CAPACITY; i++) if (this.aIdx[i * 2] >= 0) this.aTime[i * 4 + 1] = -1;
    this.killMode(Mode.Pop);
    // Every pending arrival belongs to an anchored mote, so all of them go with the old indices.
    this.arrivals.clear();
    this.popEnd.fill(0);
    this.births.clear();
  }

  /** Kills every live instance and pending arrival. Call on board geometry swap (indices change). */
  clear() {
    for (let i = 0; i < MAX_CAPACITY; i++) this.aTime[i * 4 + 1] = -1;
    this.markAllDirty();
    this.ring.reset();
    this.arrivals.clear();
    this.popEnd.fill(0);
    this.births.clear();
    this.cadence.reset();
    this.pulseCarry = this.moteCarry = this.auraClock = 0;
    this.src = null;
    this.routes = this.feedRoutes = this.boostRoutes = [];
    this.loneProducers = [];
  }

  dispose() {
    this.group.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }

  stats(): FxStats {
    let live = 0, anchored = 0, area = 0;
    const now = this.time, cap = this.budget.capacity;
    for (let i = 0; i < cap; i++) {
      const b = this.aTime[i * 4], l = this.aTime[i * 4 + 1];
      if (!(l > 0 && now >= b && now <= b + l)) continue;
      live++;
      const isAnchored = this.aIdx[i * 2] >= 0;
      if (isAnchored) anchored++;
      const r = isAnchored ? ANCHOR_ESTIMATE_PX : this.aTime[i * 4 + 2];
      area += Math.PI * r * r;
    }
    const viewArea = this.cssW * this.cssH;
    return {
      capacity: cap, live, spawned: this.spawned, pendingInk: this.arrivals.size, quality: this.quality, drawCalls: 1, time: now,
      seed: this.seedValue, anchored, screen: live - anchored,
      overdrawEst: this.res.x > 1 && viewArea > 0 ? area / viewArea : 0,
      embedRev: this.texRev < 0 ? 0 : this.texRev,
      anchorFade: this.anchorFade,
    };
  }

  // ---- internals ----

  private room() {
    return Math.max(0, this.budget.maxSpawnPerFrame - this.frameSpawns);
  }
  private rnd() {
    return this.rng();
  }
  private anchorOK(i: number): boolean {
    const e = this.src;
    return !!e && Number.isInteger(i) && i >= 0 && i < e.count && e.data[i * EMBED_STRIDE + 3] > 0;
  }
  /** Size growth from output, as before: busy tiles draw slightly larger. */
  private grow(i: number) {
    const v = this.perTile?.[i];
    return 1 + 0.12 * Math.min(4, Math.log10(1 + (Number.isFinite(v) && v! > 0 ? v! : 0)));
  }
  private tileColour(t: string | null | undefined, fallback: number = FX.production) {
    return t && t in TILE_IDENTITIES ? (TILE_IDENTITIES as Record<string, { emissive: number }>)[t].emissive : fallback;
  }
  private legacyFrom(tops: readonly THREE.Vector3[]): Embedding {
    if (this.legacy && this.legacyTops === tops && this.legacy.count === tops.length) return this.legacy;
    const e = createEmbedding(tops.length);
    tops.forEach((p, i) => writeFrame(e, i, finite3(p) ? { p: [p.x, p.y, p.z], s: 1, n: [0, 1, 0] } : { p: [0, 0, 0], s: 0, n: [0, 1, 0] }));
    bumpRev(e);
    this.legacy = e;
    this.legacyTops = tops;
    return e;
  }

  /** Uploads the embedding to the texture once per rebuild (rev bump) or board change. Reallocates only if the height changes. */
  private syncTexture(e: Embedding) {
    if (e === this.texSrc && e.rev === this.texRev && e.count === this.texCount) return;
    const h = Math.max(1, Math.ceil((e.count * 3) / TEX_W));
    if (h !== this.texH) {
      this.tex.dispose();
      this.texBuf = new Float32Array(TEX_W * h * 4);
      this.tex = makeTexture(this.texBuf, h);
      this.texH = h;
      this.mat.uniforms.uEmbed.value = this.tex;
      this.mat.uniforms.uEmbedH.value = h;
    }
    this.texBuf.set(e.data);
    this.tex.needsUpdate = true;
    this.mat.uniforms.uPitch.value = e.pitch;
    this.texSrc = e;
    this.texRev = e.rev;
    this.texCount = e.count;
  }

  /**
   * Writes a slot's full attribute set and returns the slot (-1 if rejected). Every field is rewritten, so a reused slot
   * never inherits a stale frame. The write also cancels any arrival armed on that slot.
   */
  private put(p: Put): number {
    if (![p.life, p.delay, p.size].every(Number.isFinite) || !(p.life > 0)) return -1;
    const s = this.ring.alloc();
    this.arrivals.cancel(s);
    const A = p.A ?? ZERO3, B = p.B ?? ZERO3;
    col.setHex(p.col); // linear working space; saturated hues survive ACES
    this.aA.set(A, s * 3);
    this.aB.set(B, s * 3);
    this.aCol.set([col.r, col.g, col.b], s * 3);
    this.aTime.set([this.time + p.delay, p.life, p.size, p.mode], s * 4);
    this.aExtra.set([p.x ?? 0, this.rnd()], s * 2);
    this.aIdx.set([p.a ?? -1, p.b ?? -1], s * 2);
    this.aFx.set([p.add, p.str ?? 1, p.phase ?? 0], s * 3);
    this.spawned++;
    if (s < this.dirtyMin) this.dirtyMin = s;
    if (s > this.dirtyMax) this.dirtyMax = s;
    return s;
  }

  /** Schedules a route as legs (one per edge, planEdge splits seams into stubs), relay glints on Bridges, and a producer mote on the deterministic cadence. */
  private fireRoute(r: Route, delay: number): boolean {
    const src = this.src;
    if (!src) return false;
    const { legs, relays } = routeSchedule(r, FX.legLife, delay);
    const parts = legs.map((l) => planEdge(src, l.from, l.to, l.delay, FX.legLife));
    const cost = parts.reduce((n, p) => n + p.length, 0) + 3 * relays.length + (r.kind === 'feed' ? 1 : 0);
    if (cost === 0 || cost > this.room()) return false;
    const colour = this.tileColour(r.source);
    for (const ps of parts)
      for (const p of ps) {
        if (p.kind === 'leg') this.pulse(p.from, p.to, colour, FX.coreR * this.grow(p.from), p.delay, 0);
        else this.pulse(p.anchor, p.toward, colour, FX.coreR * this.grow(p.anchor), p.delay, p.phase === 'leave' ? 1 : 2);
      }
    for (const g of relays) this.glint(g.node, g.at);
    if (r.kind === 'feed') {
      const end = r.nodes[r.nodes.length - 1];
      if (this.cadence.hit(end)) this.mote(end, this.tileColour(this.tiles[end]), FX.motePx * this.grow(end), delay + (r.nodes.length - 1) * FX.legLife);
    }
    this.frameSpawns += cost;
    return true;
  }

  /** One leg instance (or a stub, when phase is 1 or 2). Pitch-unit size. */
  private pulse(from: number, to: number, colour: number, size: number, delay = 0, phase = 0) {
    if (!this.anchorOK(from) || !this.anchorOK(to)) return;
    this.put({ mode: Mode.Leg, a: from, b: to, col: colour, size, life: FX.legLife, delay, add: FX.addLeg, x: FX.legLift, phase });
  }

  /**
   * Ink mote: rises from the tile, flies to the counter. It arms an arrival on its own slot, so the counter only counts
   * a mote that is still drawn when it lands. The Pop is made in update(), when that arrival fires.
   */
  private mote(i: number, colour: number, px: number, delay = 0) {
    if (!this.anchorOK(i)) return;
    const life = FX.moteLife * (0.85 + 0.3 * this.rnd());
    const s = this.put({ mode: Mode.Mote, a: i, col: colour, size: px, life, delay, add: FX.addLeg, x: (this.rnd() - 0.5) * 0.25 });
    if (s >= 0) this.arrivals.arm(s, this.time + delay + life);
  }

  private takePop(at: number): boolean {
    for (let k = 0; k < this.popEnd.length; k++) {
      if (this.popEnd[k] <= at) {
        this.popEnd[k] = at + FX.popLife;
        return true;
      }
    }
    return false;
  }

  /** Bridge relay glint: two violet sparks and a small ring when a leg arrives at the Bridge. */
  private glint(node: number, delay: number) {
    if (!this.anchorOK(node)) return;
    for (let k = 0; k < 2; k++) {
      const a = this.rnd() * Math.PI * 2;
      this.put({ mode: Mode.Spark, a: node, A: [0, 0, 0.02], B: [Math.cos(a), Math.sin(a), 0.22], col: FX.bridge, size: FX.sparkR * 0.7, life: FX.relayLife, delay, add: FX.addSpark });
    }
    this.ringAt(node, 0.08, 0.2, 0.04, FX.bridge, FX.relayLife, delay, 0.8);
  }

  private ringAt(i: number, r0: number, r1: number, width: number, colour: number, life: number, delay: number, str: number) {
    if (!this.anchorOK(i)) return;
    this.put({ mode: Mode.Ring, a: i, B: [r0, r1, width], col: colour, size: 0, life, delay, add: FX.addRing, str });
  }

  private markAllDirty() {
    this.dirtyMin = 0;
    this.dirtyMax = MAX_CAPACITY - 1;
  }

  private flush() {
    if (this.dirtyMax < 0) return;
    const lo = this.dirtyMin, count = this.dirtyMax - lo + 1;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(lo * a.itemSize, count * a.itemSize);
      a.needsUpdate = true;
    }
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
  }
}
