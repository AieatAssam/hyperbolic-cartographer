import * as THREE from 'three';
import { FX } from '../art/palette';
import { ArrivalQueue, SlotRing, accumulate, budgetFor, finite3, loneSprings, streamRate, validLinks, type FxBudget } from './fx-model';

/**
 * CartographyFX: every effect is one instanced quad in a single pooled InstancedBufferGeometry,
 * drawn with one ShaderMaterial (1 draw call). The CPU only writes per-instance spawn attributes
 * into a fixed ring of slots; paths, lifetime, fade and size are evaluated in the vertex shader
 * from uTime. Paths use the live camera's view/projection, so main need not pass the camera.
 *
 * Modes (aTime.w): 0 world arc (pulses, bridge arcs), 1 ink mote to HUD NDC target,
 * 2 puff/burst (world, eased displacement), 3 flat world ring (survey, beacon aura),
 * 4 screen wash particle, 5 screen vortex particle.
 */
const enum Mode { Arc = 0, Mote = 1, Puff = 2, Ring = 3, Wash = 4, Vortex = 5 }

export type FxQuality = 0 | 1 | 2;
export type PrestigeKind = 'drift' | 'projection';

export interface FxContext {
  /** Board tile top positions, world space (board.tops). */
  tops: readonly THREE.Vector3[];
  /** Production links [from, to] (same list main builds today). */
  links: readonly (readonly [number, number])[];
  /** Tile types by index (s.tiles). */
  tiles: readonly (string | null | undefined)[];
  /** Optional per-tile output; brightens/enlarges busy sources. */
  perTile?: readonly number[];
  /** Optional neighbour lists (graph.neighbours) for Bridge arcs. */
  neighbours?: readonly (readonly number[])[];
  quality: FxQuality;
  /** HUD Ink counter centre in NDC (-1..1, y up). Null/undefined uses top-centre. */
  inkTargetNdc?: readonly [number, number] | null;
}

export interface FxStats { capacity: number; live: number; spawned: number; pendingInk: number; quality: FxQuality; drawCalls: 1; time: number }

const VERT = /* glsl */ `
attribute vec3 aA; attribute vec3 aB; attribute vec3 aCol; attribute vec4 aTime; attribute vec2 aExtra;
uniform float uTime; uniform float uPx; uniform vec2 uRes; uniform vec2 uInk;
varying vec2 vUv; varying vec3 vCol; varying float vAlpha; varying float vRing;
const float PI = 3.14159265;
vec4 proj(vec3 p) { return projectionMatrix * viewMatrix * vec4(p, 1.0); }
void main() {
  float life = aTime.y, mode = aTime.w;
  float t = (uTime - aTime.x) / max(life, 1e-4);
  vUv = position.xy; vCol = aCol; vRing = 0.0;
  if (t < 0.0 || t > 1.0 || life <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
  float fade = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.7, 1.0, t));
  float px = aTime.z;
  vec4 clip;
  if (mode < 0.5) {
    vec3 p = mix(aA, aB, t); p.y += sin(t * PI) * aExtra.x;
    clip = proj(p);
  } else if (mode < 1.5) {
    vec4 c0 = proj(aA);
    vec2 s = c0.xy / c0.w; float k = smoothstep(0.0, 1.0, t);
    vec2 d = uInk - s; float b = sin(t * PI) * aExtra.x;
    clip = vec4(s + d * k + vec2(-d.y, d.x) * b, -0.5, 1.0);
    px *= mix(1.0, 0.75, k);
    fade = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.9, 1.0, t));
  } else if (mode < 2.5) {
    float k = 1.0 - (1.0 - t) * (1.0 - t);
    vec3 p = aA + aB * k; p.y += aExtra.x * t;
    clip = proj(p); px *= 1.0 - 0.45 * t;
  } else if (mode < 3.5) {
    float r = mix(aB.x, aB.y, 1.0 - (1.0 - t) * (1.0 - t));
    // Negated z keeps the quad's CCW front face pointing +Y (XY->XZ mapping alone flips it to -Y, which FrontSide culls from above).
    gl_Position = proj(aA + vec3(position.x * r, 0.03, -position.y * r));
    vAlpha = (1.0 - t) * smoothstep(0.0, 0.08, t); vRing = max(aB.z, 0.02);
    return;
  } else if (mode < 4.5) {
    clip = vec4(aA.xy + aB.xy * t, -0.9, 1.0);
    fade *= 0.8;
  } else {
    float ang = aA.x + aB.x * t * (1.0 + t);
    float rad = aA.y * (1.0 - aB.y * t * t);
    clip = vec4(vec2(cos(ang), sin(ang)) * rad * vec2(uRes.y / max(uRes.x, 1.0), 1.0), -0.9, 1.0);
  }
  vAlpha = fade;
  clip.xy += position.xy * px * uPx * 2.0 / max(uRes, vec2(1.0)) * clip.w;
  gl_Position = clip;
}`;

const FRAG = /* glsl */ `
varying vec2 vUv; varying vec3 vCol; varying float vAlpha; varying float vRing;
void main() {
  float d = length(vUv);
  if (d > 1.0 || vAlpha <= 0.0) discard;
  float a; vec3 c;
  if (vRing > 0.0) {
    float edge = 1.0 - vRing;
    a = smoothstep(edge - 0.06, edge, d) * (1.0 - smoothstep(0.96, 1.0, d));
    c = vCol * (1.0 + 0.6 * a);
  } else {
    float core = exp(-d * d * 18.0);
    a = exp(-d * d * 4.0) * (1.0 - smoothstep(0.8, 1.0, d));
    c = mix(vCol, vec3(1.0), core * 0.55) * (1.0 + core);
  }
  gl_FragColor = vec4(c * a * vAlpha, a * vAlpha);
}`;

const MAX_CAPACITY = budgetFor(2).capacity;
const DEFAULT_INK: [number, number] = [0, 0.92];
const col = new THREE.Color();

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
  private attrs: THREE.InstancedBufferAttribute[] = [];
  private dirtyMin = Infinity;
  private dirtyMax = -1;

  private quality: FxQuality = 1;
  private budget: FxBudget = budgetFor(1);
  private ring = new SlotRing(this.budget.capacity);
  private arrivals = new ArrivalQueue(256);
  private time = 0;
  private spawned = 0;
  private frameSpawns = 0;
  private pulseCarry = 0;
  private moteCarry = 0;
  private auraClock = 0;
  private bridgeClock = 0;
  private tops: readonly THREE.Vector3[] = [];
  private births = new Map<number, number>();

  constructor(quality: FxQuality = 1) {
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
    for (let i = 0; i < MAX_CAPACITY; i++) this.aTime[i * 4 + 1] = -1; // dead
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) }, uInk: { value: new THREE.Vector2(...DEFAULT_INK) } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      premultipliedAlpha: true,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    const res = new THREE.Vector2();
    this.mesh.onBeforeRender = (r) => {
      r.getDrawingBufferSize(res);
      this.mat.uniforms.uRes.value.copy(res);
      this.mat.uniforms.uPx.value = r.getPixelRatio();
    };
    this.group.add(this.mesh);
    this.applyQuality(quality);
  }

  setQuality(q: FxQuality) {
    if (q === this.quality && this.ring) return;
    this.applyQuality(q);
  }

  /** Derives every quality-dependent field. Runs unconditionally from the constructor, since the field defaults already match quality 1. */
  private applyQuality(q: FxQuality) {
    this.quality = q;
    this.budget = budgetFor(q);
    this.ring = new SlotRing(this.budget.capacity);
    this.geo.instanceCount = this.budget.capacity;
  }

  /** Per-frame driver. dt in seconds (clamped to 0.25 so a tab switch does not flood). */
  update(dt: number, ctx: FxContext) {
    dt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.25) : 0;
    this.time += dt;
    this.frameSpawns = 0;
    this.tops = ctx.tops;
    this.setQuality(ctx.quality);
    const b = this.budget;
    const ink = ctx.inkTargetNdc;
    if (ink && Number.isFinite(ink[0]) && Number.isFinite(ink[1])) this.mat.uniforms.uInk.value.set(ink[0], ink[1]);

    const links = validLinks(ctx.links, ctx.tops);
    let n: number;
    [n, this.pulseCarry] = accumulate(this.pulseCarry, streamRate(links.length, b.pulsePerLink, b.pulseRate), dt, this.room());
    for (let k = 0; k < n; k++) {
      const [from, to] = links[(Math.random() * links.length) | 0];
      this.pulse(from, to, this.tileColour(ctx.tiles[from], FX.production), this.sizeFor(ctx, to, FX.pulsePx));
      // Producers also send ink to the HUD, so the economy reads as flowing to the counter.
      if (Math.random() < 0.5) this.mote(to, this.tileColour(ctx.tiles[to], FX.ink), this.sizeFor(ctx, to, FX.motePx), FX.pulseLife);
    }

    const lone = loneSprings(ctx.tiles, links).filter((i) => finite3(ctx.tops[i]));
    [n, this.moteCarry] = accumulate(this.moteCarry, streamRate(lone.length, b.motePerSpring, b.moteRate), dt, this.room());
    for (let k = 0; k < n; k++) {
      const i = lone[(Math.random() * lone.length) | 0];
      this.mote(i, FX.ink, this.sizeFor(ctx, i, FX.motePx));
    }

    if ((this.auraClock += dt) >= b.auraEvery) {
      this.auraClock = 0;
      ctx.tiles.forEach((t, i) => t === 'beacon' && this.beaconAura(i));
    }
    if (ctx.neighbours && (this.bridgeClock += dt) >= FX.arcLife * 1.4) {
      this.bridgeClock = 0;
      ctx.tiles.forEach((t, i) => {
        if (t !== 'bridge') return;
        const nb = ctx.neighbours![i]?.filter((j) => finite3(ctx.tops[j])) ?? [];
        for (let k = 0; k < b.arcsPerBridge && nb.length >= 2; k++) {
          const a = (Math.random() * nb.length) | 0;
          this.bridgeArc(nb[a], nb[(a + 1 + ((Math.random() * (nb.length - 1)) | 0)) % nb.length]);
        }
      });
    }

    const arrived = this.arrivals.pop(this.time);
    if (arrived > 0) this.onInkArrive?.(arrived);
    this.mat.uniforms.uTime.value = this.time;
    this.flush();
  }

  // ---- one-shots (indices refer to the tops passed in the last update) ----

  /** Placement burst: radial sparks in the tile's colour. Records the birth time for squash-settle. */
  placement(index: number, colour: number) {
    const p = this.top(index);
    if (!p) return;
    this.births.set(index, this.time);
    const n = this.budget.burst;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.4, r = 0.6 + Math.random() * 0.5;
      this.write(Mode.Puff, p, Math.cos(a) * r, 0.25 + Math.random() * 0.4, Math.sin(a) * r, colour, FX.burstPx, FX.burstLife, 0.2, 0);
    }
    this.ringAt(p, 0.1, 0.9, colour, FX.burstLife, 0.18);
  }

  /** Sell puff: slow grey-violet smoke drifting up and out. */
  sell(index: number, colour: number = FX.sell) {
    const p = this.top(index);
    if (!p) return;
    this.births.delete(index);
    for (let k = 0; k < this.budget.puff; k++) {
      const a = Math.random() * Math.PI * 2, r = 0.2 + Math.random() * 0.35;
      this.write(Mode.Puff, p, Math.cos(a) * r, 0.1, Math.sin(a) * r, colour, FX.puffPx, FX.puffLife * (0.8 + Math.random() * 0.4), 0.7, 0);
    }
  }

  /** Survey reveal: expanding ring from the origin out to the new board radius (world units), plus sparks on its rim. */
  survey(radius: number, centre: THREE.Vector3 = new THREE.Vector3()) {
    if (!(radius > 0) || !finite3(centre)) return;
    this.ringAt(centre, radius * 0.2, radius, FX.ring, FX.ringLife, FX.ringWidth * 0.5);
    this.ringAt(centre, radius * 0.1, radius * 0.85, FX.ring, FX.ringLife * 1.2, FX.ringWidth);
    const n = this.budget.ringParticles;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      this.write(Mode.Puff, centre, Math.cos(a) * radius, 0, Math.sin(a) * radius, FX.ring, FX.burstPx, FX.ringLife, 0.3, 0);
    }
  }

  /** Beacon aura: a soft coral ring expanding from the beacon over its neighbours. Called automatically from update. */
  beaconAura(index: number) {
    const p = this.top(index);
    if (p) this.ringAt(p, 0.3, 2.2, FX.beacon, FX.auraLife, FX.ringWidth);
  }

  /** Bridge arc: a comet train of glow sprites hopping neighbour to neighbour over the bridge. */
  bridgeArc(from: number, to: number) {
    const a = this.top(from), b = this.top(to);
    if (!a || !b || from === to) return;
    for (let k = 0; k < 6; k++)
      this.write(Mode.Arc, a, b.x, b.y, b.z, FX.bridge, FX.pulsePx * (1 - k * 0.12), FX.arcLife, FX.arcLift, 0, -k * 0.035);
  }

  /** Big prestige overlays in screen space: Drift ink-wash sweeping down, Projection vortex collapsing into the centre. */
  prestige(kind: PrestigeKind) {
    const n = this.budget.overlay;
    for (let k = 0; k < n; k++) {
      if (kind === 'drift') {
        const x = Math.random() * 2.4 - 1.2, y = 1.1 + Math.random() * 0.3;
        this.writeRaw(Mode.Wash, x, y, 0, (Math.random() - 0.5) * 0.4, -2.4 - Math.random(), 0, FX.wash, FX.overlayPx * (0.7 + Math.random()), FX.overlayLife * (0.7 + Math.random() * 0.3), 0, Math.random() * 0.3);
      } else {
        this.writeRaw(Mode.Vortex, Math.random() * Math.PI * 2, 0.4 + Math.random() * 0.9, 0, 3 + Math.random() * 2, 0.95, 0, k % 3 ? FX.vortex : FX.bridge, FX.overlayPx * (0.5 + Math.random() * 0.6), FX.overlayLife, 0, Math.random() * 0.25);
      }
    }
    this.flush();
  }

  /** Suggested squash-settle hook: seconds since index was placed (Infinity if never/sold). Board shader can map this to a squash curve. */
  sincePlaced(index: number): number {
    const t = this.births.get(index);
    return t === undefined ? Infinity : this.time - t;
  }
  get now() {
    return this.time;
  }

  /** Kills every live instance and pending arrival. Call on board geometry swap (indices change). */
  clear() {
    for (let i = 0; i < MAX_CAPACITY; i++) this.aTime[i * 4 + 1] = -1;
    this.dirtyMin = 0;
    this.dirtyMax = MAX_CAPACITY - 1;
    this.flush();
    this.ring.reset();
    this.arrivals.clear();
    this.births.clear();
    this.pulseCarry = this.moteCarry = this.auraClock = this.bridgeClock = 0;
    this.tops = [];
  }

  dispose() {
    this.group.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }

  stats(): FxStats {
    let live = 0;
    for (let i = 0; i < this.budget.capacity; i++) {
      const b = this.aTime[i * 4], l = this.aTime[i * 4 + 1];
      if (l > 0 && this.time >= b && this.time <= b + l) live++;
    }
    return { capacity: this.budget.capacity, live, spawned: this.spawned, pendingInk: this.arrivals.size, quality: this.quality, drawCalls: 1, time: this.time };
  }

  // ---- internals ----

  private room() {
    return Math.max(0, this.budget.maxSpawnPerFrame - this.frameSpawns);
  }
  private top(i: number): THREE.Vector3 | null {
    const p = Number.isInteger(i) ? this.tops[i] : undefined;
    return finite3(p) ? p : null;
  }
  private tileColour(t: string | null | undefined, fallback: number) {
    return t === 'spring' ? FX.ink : t === 'mill' ? 0xffbe55 : t === 'beacon' ? FX.beacon : t === 'bridge' ? FX.bridge : fallback;
  }
  private sizeFor(ctx: FxContext, i: number, base: number) {
    const v = ctx.perTile?.[i];
    return base * (1 + 0.12 * Math.min(4, Math.log10(1 + (Number.isFinite(v) && v! > 0 ? v! : 0))));
  }
  private pulse(from: number, to: number, colour: number, px: number) {
    const a = this.tops[from], b = this.tops[to];
    this.write(Mode.Arc, a, b.x, b.y, b.z, colour, px, FX.pulseLife, FX.pulseLift, 0);
    this.frameSpawns++;
  }
  private mote(i: number, colour: number, px: number, delay = 0) {
    const p = this.tops[i];
    const life = FX.moteLife * (0.85 + Math.random() * 0.3);
    this.write(Mode.Mote, p, 0, 0, 0, colour, px, life, (Math.random() - 0.5) * 0.5, delay);
    this.arrivals.push(this.time + delay + life);
    this.frameSpawns++;
  }
  private ringAt(c: THREE.Vector3, r0: number, r1: number, colour: number, life: number, width: number) {
    this.write(Mode.Ring, c, r0, r1, width, colour, 0, life, 0, 0);
  }
  private write(mode: Mode, a: THREE.Vector3, bx: number, by: number, bz: number, colour: number, px: number, life: number, extra: number, delay: number, offset = 0) {
    this.writeRaw(mode, a.x, a.y, a.z, bx, by, bz, colour, px, life, extra, delay + offset);
  }
  private writeRaw(mode: Mode, ax: number, ay: number, az: number, bx: number, by: number, bz: number, colour: number, px: number, life: number, extra: number, delay: number) {
    if (![ax, ay, az, bx, by, bz, life].every(Number.isFinite)) return;
    const s = this.ring.alloc();
    col.setHex(colour); // linear working space; saturated hues survive ACES
    this.aA.set([ax, ay, az], s * 3);
    this.aB.set([bx, by, bz], s * 3);
    this.aCol.set([col.r, col.g, col.b], s * 3);
    this.aTime.set([this.time + delay, life, px, mode], s * 4);
    this.aExtra.set([extra, Math.random()], s * 2);
    this.spawned++;
    if (s < this.dirtyMin) this.dirtyMin = s;
    if (s > this.dirtyMax) this.dirtyMax = s;
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

/**
 * Temporary backwards-compatible wrapper for main.ts until the integration pass switches to CartographyFX.
 * `points` is the FX group (an Object3D), so `scene.add(pulses.points)` keeps working.
 */
export class Pulses {
  readonly fx = new CartographyFX(1);
  get points(): THREE.Object3D {
    return this.fx.group;
  }
  clear() {
    this.fx.clear();
  }
  update(dt: number, tops: THREE.Vector3[], links: [number, number][], _rate?: number) {
    this.fx.update(dt, { tops, links, tiles: [], quality: 1 });
  }
}
