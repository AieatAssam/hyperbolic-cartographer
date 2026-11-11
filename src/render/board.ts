import * as THREE from 'three';
import { GRAPHS, type GameState, type Geometry } from '../core/state';
import type { SquareBoard } from '../core/geometry/square';
import { apply, boost, boostToOrigin, dist, geodesic, identity, inverse, mul, normalize, orthonormalize, toDisk, type HyperBoard, type Mat3, type Vec3 } from '../core/geometry/hyperbolic';
import { TILE_TYPES, type TileType } from '../core/tiles';
import { config } from '../core/config';
import {
  BLOOM, BOARD, CONSTELLATION, CONSTELLATION_BURST, EMPTY_SLOT, MATERIAL, MOTIF, NEXT_SLOT, PLACE, PREVIEW, TILE_IDENTITIES, bevelColour, hoverFace, motifScale, sideColour, tileHeight, trimGlow,
} from '../art/palette';
import type { BoardHighlight } from './board-highlight';
import { FlowArchOverlay } from './flow-arch';
import { placeGlsl, placeScale } from './transition';
import { motifMaterial, prepareMotifs, type MotifSet, type TileModels } from './tile-models';
import { prod } from '../core/economy';
import { bumpRev, createEmbedding, medianEdgePitch, writeFrame, type Embedding } from './fx-graph';

export const DISK_R = 9;
const SEG = 8; // geodesic segments per heptagon edge
const GAP = 0.9;
const INSET = 0.8; // inner face / outline ratio for placed tiles and focused or neighbour slots; at rest empty slots use EMPTY_SLOT.restInset
const REVEAL_S = 0.25; // survey rise: tile height ramps 0 → full over this many seconds from its reveal time
const PER_K = 15; // verts per outline segment: top fan 3 + bevel quad 6 + side quad 6
const GLOW_STEPS = 8; // output quantisation per decade, so the cache key only changes on visible steps

const col = (hex: number) => new THREE.Color(hex);
/** Precomputed face / side / bevel colours per type; tokens and coefficients live in palette.ts. */
const TOK = Object.fromEntries(TILE_TYPES.map((t) => {
  const tk = TILE_IDENTITIES[t];
  return [t, {
    face: col(tk.base), hover: col(hoverFace(tk.base)), side: col(sideColour(tk.base)),
    bevel: col(bevelColour(tk)), bevelPin: col(bevelColour(tk, true)),
    faceGlow: col(tk.base).multiplyScalar(MATERIAL.faceGlow), emissive: col(tk.emissive),
  }];
})) as Record<TileType, Record<'face' | 'hover' | 'side' | 'bevel' | 'bevelPin' | 'faceGlow' | 'emissive', THREE.Color>>;
const C = {
  slot: col(EMPTY_SLOT.base), slotGlow: col(EMPTY_SLOT.emissive).multiplyScalar(EMPTY_SLOT.emissiveIntensity),
  slotBorder: col(EMPTY_SLOT.accent), slotSide: col(sideColour(EMPTY_SLOT.base)),
  next: col(NEXT_SLOT.base), nextBorder: col(NEXT_SLOT.border),
  white: col(BOARD.hover), adj: col(BOARD.adjacency), gold: col(BOARD.gold), bridge: col(PREVIEW.bridgeOutline),
  dim: col(EMPTY_SLOT.base), black: col(0),
};

/** Procedural cartographer's tabletop: rhumb lines, graticule, contours and constellations in ink. Local, no assets. */
function tableTexture(round: boolean): THREE.CanvasTexture {
  const N = 1024, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const grad = g.createRadialGradient(N / 2, N / 2, N * 0.05, N / 2, N / 2, N * 0.72);
  grad.addColorStop(0, '#6a4e86');
  grad.addColorStop(1, '#' + BOARD.table.toString(16).padStart(6, '0'));
  g.fillStyle = grad;
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < 9000; i++) { // parchment grain
    g.fillStyle = `rgba(232,216,176,${0.02 + rnd() * 0.04})`;
    g.fillRect(rnd() * N, rnd() * N, 1.5, 1.5);
  }
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(232,200,114,0.22)'; // graticule
  for (let i = 1; i < 12; i++) {
    g.beginPath(); g.arc(N / 2, N / 2, (i * N) / 22, 0, Math.PI * 2); g.stroke();
  }
  g.strokeStyle = 'rgba(95,212,255,0.16)'; // compass-rose rhumb lines
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    g.beginPath(); g.moveTo(N / 2, N / 2); g.lineTo(N / 2 + Math.cos(a) * N, N / 2 + Math.sin(a) * N); g.stroke();
  }
  g.strokeStyle = 'rgba(208,112,154,0.18)'; // wobbly contours
  for (let c = 0; c < 6; c++) {
    const cx = rnd() * N, cy = rnd() * N;
    for (let r = 20; r < 140; r += 18) {
      g.beginPath();
      for (let a = 0; a <= 64; a++) {
        const th = (a / 64) * Math.PI * 2, rr = r * (1 + 0.18 * Math.sin(th * 3 + c));
        g.lineTo(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr);
      }
      g.stroke();
    }
  }
  for (let k = 0; k < 7; k++) { // constellations
    const pts: [number, number][] = [];
    let x = rnd() * N, y = rnd() * N;
    for (let j = 0; j < 5; j++) pts.push([(x += (rnd() - 0.5) * 120), (y += (rnd() - 0.5) * 120)]);
    g.strokeStyle = 'rgba(255,240,208,0.25)';
    g.beginPath(); pts.forEach(([a, b]) => g.lineTo(a, b)); g.stroke();
    g.fillStyle = 'rgba(255,240,208,0.7)';
    pts.forEach(([a, b]) => { g.beginPath(); g.arc(a, b, 2.5 + rnd() * 2, 0, Math.PI * 2); g.fill(); });
  }
  if (round) {
    g.strokeStyle = 'rgba(232,200,114,0.5)'; g.lineWidth = 6;
    g.beginPath(); g.arc(N / 2, N / 2, N / 2 - 8, 0, Math.PI * 2); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * One merged extruded-prism mesh for either geometry (one draw call). Tile i owns a fixed slice of the vertex buffer.
 * Per-vertex emissive is a custom `glow` attribute patched into MeshStandardMaterial; type motifs are 5 InstancedMeshes.
 */
export class Board {
  readonly group = new THREE.Group();
  readonly tops: THREE.Vector3[];
  /** Per-tile frame for FX (fx-graph.ts). Rewritten on rebuild, `embed.rev` bumps once per rebuild. */
  readonly embed: Embedding;
  private geom = new THREE.BufferGeometry();
  private K: number;
  private view: Mat3 = identity();
  private viewRev = 0;
  private key = '';
  private hyper: HyperBoard | null;
  private square: SquareBoard | null;
  private motifs: Record<TileType, THREE.InstancedMesh>;
  private glowQ: Int16Array;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private sc = new THREE.Vector3();
  private c = new THREE.Color();
  private side = new THREE.Color();
  private border = new THREE.Color();
  private glow = new THREE.Color();
  private trim = new THREE.Color();
  private c2 = new THREE.Vector3();
  /** Squash-settle: per-vertex birth time (fx clock) read by the shader against uFxClock; no per-frame rebuild. */
  private born: Float32Array;
  /** Survey reveal: per-vertex fx time at which the tile starts rising. Default −1e4 means already revealed. */
  private revealed: Float32Array;
  private uClock = { value: 0 };
  private motifSlot: Int32Array;
  /** mill_wheel layer (from the GLB): one instance per mill, spun in tick() while that mill produces. */
  private wheel: THREE.InstancedMesh | null = null;
  private wheelBase: THREE.Matrix4[] = [];
  /** Wheel offset on the housing face (fitted units), from prepareMotifs. */
  private wheelOffset = new THREE.Matrix4();
  /** Glow ring under each model: one instanced flat ring for every tile, colour = type hue or strain state. */
  private rings: THREE.InstancedMesh;
  private tmpC = new THREE.Color();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Color();
  private tmpR = new THREE.Color();
  private r4 = new THREE.Matrix4();
  private pr: ReturnType<typeof prod> | null = null;
  private wheelOn: boolean[] = [];
  private spin = new THREE.Matrix4();
  private settling = new Map<number, number>();
  private mats: THREE.Material[] = [];
  private tileType: GameState['tiles'] = [];
  private previewLine: THREE.Line;
  private constellationPulse: THREE.LineSegments;
  private constellationFaint: THREE.LineSegments;
  private readonly flowArch = new FlowArchOverlay();
  private constellationStars: THREE.InstancedMesh;
  private ghostLine: THREE.LineSegments;
  private reducedMotion = false;

  constructor(readonly geometry: Geometry, env: THREE.Texture | null = null) {
    const g = GRAPHS[geometry];
    this.hyper = geometry === 'hyper' ? (g as HyperBoard) : null;
    this.square = geometry === 'square' ? (g as SquareBoard) : null;
    this.K = this.hyper ? 7 * SEG : 4;
    const n = g.ring.length, verts = n * this.K * PER_K;
    this.glowQ = new Int16Array(n);
    this.motifSlot = new Int32Array(n).fill(-1);
    this.born = new Float32Array(verts).fill(-1e4);
    this.geom.setAttribute('born', new THREE.BufferAttribute(this.born, 1).setUsage(THREE.DynamicDrawUsage));
    this.revealed = new Float32Array(verts).fill(-1e4);
    this.geom.setAttribute('revealAt', new THREE.BufferAttribute(this.revealed, 1).setUsage(THREE.DynamicDrawUsage));
    // embedding positions in table world units, so the seam test compares like with like
    const xy: [number, number][] = this.square ? this.square.xy : this.hyper!.centers.map((c) => {
      const [u, w] = toDisk(c);
      return [u * DISK_R, w * DISK_R];
    });
    const scale = this.square ? g.ring.map(() => 1) : xy.map(([x, z]) => Math.max(0, 1 - (x * x + z * z) / (DISK_R * DISK_R)));
    this.embed = createEmbedding(n);
    this.embed.pitch = medianEdgePitch(g, xy, scale);
    for (const name of ['position', 'normal', 'color', 'glow'])
      this.geom.setAttribute(name, new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    // one merged draw call, so roughness/metalness are shared: the mean of the tile tokens
    const toks = TILE_TYPES.map((t) => TILE_IDENTITIES[t]);
    // explicit envMap: three ignores envMapIntensity when envMap is null and scene.environment is used
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: toks.reduce((a, t) => a + t.roughness, 0) / toks.length,
      metalness: toks.reduce((a, t) => a + t.metalness, 0) / toks.length,
      envMap: env, envMapIntensity: MATERIAL.bodyEnv,
    });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec3 glow;
attribute float born;
attribute float revealAt;
uniform float uFxClock;
varying vec3 vGlow;
${placeGlsl()}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vGlow = glow;
float sqT = uFxClock - born;
if (sqT >= 0.0 && sqT < ${PLACE.life.toFixed(2)}) transformed.y *= placeScale(sqT);
float rvT = uFxClock - revealAt;
transformed.y *= smoothstep(0.0, ${REVEAL_S.toFixed(2)}, rvT);
vGlow += 0.5 * clamp(1.0 - abs(rvT - 0.1) / 0.1, 0.0, 1.0) * step(0.0, rvT) * vec3(0.35, 0.7, 1.0);`);
      sh.uniforms.uFxClock = this.uClock;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;');
    };
    mat.customProgramCacheKey = () => 'board-glow';
    const mesh = new THREE.Mesh(this.geom, mat);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.tops = g.ring.map(() => new THREE.Vector3());

    this.motifs = {} as Record<TileType, THREE.InstancedMesh>;
    const set = prepareMotifs({});
    for (const t of TILE_TYPES) {
      const im = new THREE.InstancedMesh(set.geos[t], motifMaterial(t), n);
      im.count = 0;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.motifs[t] = im;
      this.group.add(im);
    }
    this.rings = new THREE.InstancedMesh(
      new THREE.RingGeometry(MOTIF.ringInner, MOTIF.ringOuter, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        transparent: true, opacity: MOTIF.ringAlpha, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
      n,
    );
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 4;
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.rings);
    this.buildTable();
    const bridgeTk = TILE_IDENTITIES.bridge;
    this.previewLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: bridgeTk.accent, transparent: true, opacity: 0.88,
        depthTest: false, depthWrite: false,
      }),
    );
    this.previewLine.visible = false;
    this.previewLine.frustumCulled = false;
    this.previewLine.renderOrder = 6;
    this.group.add(this.previewLine);
    this.constellationPulse = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({
        color: CONSTELLATION.inkPulse, transparent: true, opacity: CONSTELLATION.opacityPulse,
        dashSize: 0.22, gapSize: 0.12, depthTest: false, depthWrite: false,
      }),
    );
    this.constellationPulse.visible = false;
    this.constellationPulse.frustumCulled = false;
    this.constellationPulse.renderOrder = 8;
    this.group.add(this.constellationPulse);
    this.constellationFaint = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({
        color: CONSTELLATION.inkComplete, transparent: true, opacity: CONSTELLATION.opacityComplete,
        dashSize: 0.14, gapSize: 0.08, depthTest: true, depthWrite: false,
      }),
    );
    this.constellationFaint.visible = false;
    this.constellationFaint.frustumCulled = false;
    this.constellationFaint.renderOrder = 6.5;
    this.group.add(this.constellationFaint);
    this.group.add(this.flowArch.group);
    const starCap = GRAPHS[geometry].ring.length;
    this.constellationStars = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.13, 10, 8),
      new THREE.MeshBasicMaterial({
        color: col(CONSTELLATION.star), transparent: true, opacity: 0.95,
        depthTest: false, depthWrite: false,
      }),
      starCap,
    );
    this.constellationStars.count = 0;
    this.constellationStars.frustumCulled = false;
    this.constellationStars.renderOrder = 9;
    this.group.add(this.constellationStars);
    this.ghostLine = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({
        color: CONSTELLATION.inkGhost, transparent: true, opacity: CONSTELLATION.opacityGhost,
        dashSize: 0.2, gapSize: 0.09, linewidth: 1,
        depthTest: false, depthWrite: false,
      }),
    );
    this.ghostLine.visible = false;
    this.ghostLine.frustumCulled = false;
    this.ghostLine.renderOrder = 6.5;
    this.group.add(this.ghostLine);
  }

  private updateEdgeLines(
    edges: readonly [number, number][] | undefined,
    mesh: THREE.LineSegments,
    lift: number,
    opacity = 1,
    reveal = 1,
  ) {
    const mat = mesh.material as THREE.LineBasicMaterial | THREE.LineDashedMaterial;
    mat.opacity = opacity;
    if (!edges?.length) {
      mesh.visible = false;
      return;
    }
    const pts: number[] = [];
    const n = edges.length;
    edges.forEach(([a, b], k) => {
      const ta = this.tops[a], tb = this.tops[b];
      if (!ta || !tb) return;
      // reveal runs 0..1 over the whole set: each edge draws in turn, so the star chart is traced edge by edge
      const f = Math.min(1, Math.max(0, reveal * n - k));
      if (f <= 0) return;
      pts.push(ta.x, ta.y + lift, ta.z, ta.x + (tb.x - ta.x) * f, ta.y + lift + (tb.y - ta.y) * f, ta.z + (tb.z - ta.z) * f);
    });
    mesh.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    if (mesh.material instanceof THREE.LineDashedMaterial) (mesh as THREE.Line).computeLineDistances();
    mesh.visible = pts.length > 0;
  }

  private updateConstellationStars(edges: readonly [number, number][] | undefined, pulse: number) {
    if (!edges?.length || pulse <= 0) {
      this.constellationStars.count = 0;
      return;
    }
    const cells = [...new Set(edges.flat())];
    const m4 = new THREE.Matrix4();
    const elapsed = (1 - pulse) * CONSTELLATION_BURST.seconds;
    let i = 0;
    cells.forEach((c, j) => {
      const t = this.tops[c];
      if (!t) return;
      // members flare in sequence: each star gets a short bump once its turn comes, then settles
      const age = elapsed - j * CONSTELLATION_BURST.stagger;
      const bump = !this.reducedMotion && age >= 0 ? CONSTELLATION_BURST.bump * Math.exp(-age * 5) : 0;
      const sc = 0.65 + 0.55 * pulse + bump;
      m4.makeTranslation(t.x, t.y + 0.38 * sc, t.z);
      m4.scale(new THREE.Vector3(sc, sc, sc));
      this.constellationStars.setMatrixAt(i++, m4);
    });
    this.constellationStars.count = i;
    this.constellationStars.instanceMatrix.needsUpdate = true;
    (this.constellationStars.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.65 * pulse;
  }

  /** Constellation overlays: update every frame (pulse animation). */
  overlayConstellations(hl?: BoardHighlight) {
    const pulse = hl?.constellationPulse ?? 0;
    const bright = hl?.constellation;
    const faint = hl?.constellationPermanent;
    const ghost = hl?.constellationGhost;
    const pulseOp = bright?.length ? (0.55 + 0.45 * pulse) * CONSTELLATION.opacityPulse : 0;
    const elapsed = (1 - pulse) * CONSTELLATION_BURST.seconds;
    const reveal = this.reducedMotion ? 1 : Math.min(1, elapsed / CONSTELLATION_BURST.drawSeconds);
    this.updateEdgeLines(bright, this.constellationPulse, 0.07, pulseOp, reveal);
    this.updateEdgeLines(faint, this.constellationFaint, 0.06, CONSTELLATION.opacityComplete * 0.85);
    this.updateEdgeLines(ghost, this.ghostLine, 0.06, CONSTELLATION.opacityGhost);
    if (pulse <= 0 && bright?.length) {
      this.constellationStars.count = 0;
    } else {
      this.updateConstellationStars(bright, pulse);
    }
  }

  private updatePreviewArc(arc: readonly [number, number] | undefined) {
    if (!arc) {
      this.previewLine.visible = false;
      return;
    }
    const [a, b] = arc;
    const ya = this.tops[a]?.y ?? 0.5;
    const yb = this.tops[b]?.y ?? 0.5;
    const ax = this.tops[a]?.x ?? 0;
    const az = this.tops[a]?.z ?? 0;
    const bx = this.tops[b]?.x ?? 0;
    const bz = this.tops[b]?.z ?? 0;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const lift = Math.max(ya, yb) + 0.55 + Math.hypot(ax - bx, az - bz) * 0.12;
    const pts = new Float32Array([ax, ya + 0.08, az, mx, lift, mz, bx, yb + 0.08, bz]);
    this.previewLine.geometry.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.previewLine.visible = true;
  }

  /** Bevelled table (square) or hyperbolic disk with a luminous rim, both in the ink-map language. */
  private buildTable() {
    const tex = tableTexture(!!this.hyper);
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 });
    const edge = new THREE.MeshStandardMaterial({ color: BOARD.tableEdge, roughness: 0.5, metalness: 0.35 });
    const DEPTH = 0.35;
    if (this.hyper) {
      const slab = new THREE.Mesh(new THREE.CylinderGeometry(DISK_R + 0.25, DISK_R + 0.55, DEPTH, 128, 1, true), edge);
      slab.position.y = -DEPTH / 2 - 0.01;
      const face = new THREE.Mesh(new THREE.CircleGeometry(DISK_R + 0.25, 128).rotateX(-Math.PI / 2), top);
      face.position.y = -0.01;
      // colour scaled past the bloom threshold: the rim is meant to glow
      const rimCol = col(BOARD.rim).multiplyScalar(BLOOM.threshold + 1.2);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(DISK_R + 0.25, 0.07, 8, 160).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: rimCol }));
      this.group.add(slab, face, rim);
    } else {
      const S = 12;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(S + 0.6, DEPTH, S + 0.6), [edge, edge, top, edge, edge, edge]);
      slab.position.y = -DEPTH / 2 - 0.01;
      const lip = new THREE.Mesh(new THREE.BoxGeometry(S + 0.9, 0.12, S + 0.9), edge);
      lip.position.y = -DEPTH - 0.07;
      this.group.add(slab, lip);
    }
  }

  /** Tile outline (world xz) + centre + local scale. Hyperbolic tiles go through the view boost and Poincaré projection. */
  private outline(i: number): { pts: [number, number][]; c: [number, number]; scale: number } {
    if (this.square) {
      const [x, y] = this.square.xy[i], h = GAP / 2;
      return { pts: [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]], c: [x, y], scale: 1 };
    }
    const hb = this.hyper!;
    const vs = hb.verts[i].map((v) => apply(this.view, v));
    const cv = apply(this.view, hb.centers[i]);
    const [cu, cw] = toDisk(cv);
    const pts: [number, number][] = [];
    for (let k = 0; k < 7; k++)
      for (let s = 0; s < SEG; s++) {
        const [u, w] = toDisk(geodesic(vs[k], vs[(k + 1) % 7], s / SEG));
        pts.push([(cu + (u - cu) * GAP) * DISK_R, (cw + (w - cw) * GAP) * DISK_R]);
      }
    return { pts, c: [cu * DISK_R, cw * DISK_R], scale: Math.max(0, 1 - cu * cu - cw * cw) };
  }

  /** Swaps the primitive motifs for GLB geometry (see tile-models.ts): fitted, vertex-coloured, wheel placed. */
  useModels(models: TileModels) {
    const set: MotifSet = prepareMotifs(models);
    for (const t of TILE_TYPES) this.motifs[t].geometry.dispose(), (this.motifs[t].geometry = set.geos[t]);
    const n = this.glowQ.length;
    if (!this.wheel) {
      this.wheel = new THREE.InstancedMesh(set.wheel, motifMaterial('mill'), n);
      this.wheel.count = 0;
      this.wheel.frustumCulled = false;
      this.wheel.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.wheelBase = Array.from({ length: n }, () => new THREE.Matrix4());
      this.wheelOn = new Array(n).fill(false);
      this.group.add(this.wheel);
    } else this.wheel.geometry.dispose(), (this.wheel.geometry = set.wheel);
    this.wheelOffset.makeTranslation(set.wheelAt.x, set.wheelAt.y, set.wheelAt.z);
    this.key = ''; // force a rebuild so the instances are written to the new geometry
  }

  /** Rebuilds geometry only when tiles, ring, pins, focus, view or (quantised) output change. Normals recomputed then. */
  update(s: GameState, perTile: number[], hover: number, hoverAdj: number[], hl?: BoardHighlight) {
    const n = this.glowQ.length;
    let glowSig = 0;
    for (let i = 0; i < n; i++) {
      const qv = s.tiles[i] ? Math.round(Math.log10(1 + (perTile[i] || 0)) * GLOW_STEPS) : 0;
      this.glowQ[i] = qv;
      glowSig = (glowSig * 31 + qv) | 0;
    }
    const ghostCells = new Set(hl?.constellationGhost?.flat() ?? []);
    const hlKey = hl
      ? `${hl.dim ?? 0}|${hl.pulse ?? 0}|${hl.direct?.join() ?? ''}|${hl.bridge?.join() ?? ''}|${hl.lit?.join() ?? ''}|${hl.arc?.join() ?? ''}`
      : '';
    const key = `${s.tiles.join()}|${s.ring}|${s.pinned}|${hover}|${hoverAdj}|${this.viewRev}|${glowSig}|${hlKey}`;
    if (key === this.key) return;
    this.key = key;
    this.tileType = s.tiles;
    const pos = this.geom.attributes.position.array as Float32Array;
    const colA = this.geom.attributes.color.array as Float32Array;
    const glowA = this.geom.attributes.glow.array as Float32Array;
    const g = GRAPHS[this.geometry], K = this.K, { c, side, border, glow, trim } = this;
    for (const t of TILE_TYPES) this.motifs[t].count = 0;
    this.rings.count = 0;
    this.pr = prod(s);
    if (this.wheel) this.wheel.count = 0;
    const embed = this.embed;
    for (let i = 0; i < n; i++) {
      const o = this.outline(i), t = s.tiles[i], r = g.ring[i];
      const active = r <= s.ring, next = r === s.ring + 1;
      const directSet = hl?.direct ?? hoverAdj;
      const bridgeSet = hl?.bridge ?? [];
      const nearDirect = i !== hover && directSet.includes(i);
      const nearBridge = i !== hover && !nearDirect && bridgeSet.includes(i);
      const nearGhost = ghostCells.has(i);
      const near = nearDirect || nearBridge || nearGhost;
      // output level 0..1 (log decades / heightLogFull), quantised by glowQ
      const L = Math.min(1, this.glowQ[i] / GLOW_STEPS / MATERIAL.heightLogFull);
      const pinned = s.pinned.includes(i);
      let h = 0, ins = INSET;
      // face: lit albedo + tiny glow. trim (bevel): glassy edge glow, scaled by output, below bloom.
      if (t) {
        const tk = TOK[t];
        h = tileHeight(L);
        c.copy(i === hover ? tk.hover : tk.face);
        side.copy(tk.side);
        border.copy(pinned ? tk.bevelPin : tk.bevel);
        glow.copy(tk.faceGlow);
        trim.copy(tk.emissive).multiplyScalar(i === hover ? MATERIAL.hoverTrim : trimGlow(L));
        if (hl?.lit && hl.dim && hl.dim > 0 && !hl.lit.includes(i)) {
          const d = PREVIEW.inspectDim * hl.dim;
          const sat = 1 - PREVIEW.inspectSatMul * hl.dim;
          c.lerp(C.dim, d).multiplyScalar(sat);
          side.lerp(C.dim, d * 0.88).multiplyScalar(sat);
          border.lerp(C.dim, d * 0.72).multiplyScalar(sat);
          trim.lerp(C.dim, d * 0.78).multiplyScalar(sat);
          glow.multiplyScalar(1 - 0.92 * hl.dim);
        }
      } else if (active || next) {
        h = active ? MATERIAL.slotHeight : MATERIAL.nextHeight;
        const edge = active ? C.slotBorder : C.nextBorder, face = active ? C.slot : C.next;
        c.copy(face);
        side.copy(C.slotSide);
        glow.copy(active ? C.slotGlow : C.black);
        if (i === hover || near) {
          border.copy(edge); trim.copy(glow); // focus or neighbour: the current bright rim at the placed-tile inset
        } else {
          // at rest: a thin, quiet rim so the empty lattice does not shout
          ins = EMPTY_SLOT.restInset;
          border.copy(edge).lerp(face, EMPTY_SLOT.restRimMix);
          trim.copy(glow).multiplyScalar(EMPTY_SLOT.restTrim);
        }
        if (i === hover) {
          c.lerp(C.white, MATERIAL.hoverLerp);
          if (nearGhost || ghostCells.has(i)) border.copy(C.gold), trim.copy(C.gold).multiplyScalar(0.5);
          else border.copy(C.adj), trim.copy(C.adj).multiplyScalar(0.25);
        }
        if (hl?.lit && hl.dim && hl.dim > 0 && !hl.lit.includes(i)) {
          const d = PREVIEW.inspectDim * hl.dim;
          const sat = 1 - PREVIEW.inspectSatMul * hl.dim;
          c.lerp(C.dim, d).multiplyScalar(sat);
          side.lerp(C.dim, d * 0.85).multiplyScalar(sat);
          border.lerp(C.dim, d * 0.65).multiplyScalar(sat);
          trim.lerp(C.dim, d * 0.7).multiplyScalar(sat);
          glow.multiplyScalar(1 - 0.82 * hl.dim);
        }
      } else o.scale = 0;
      if (nearBridge) {
        const ph = hl?.pulse ?? 0;
        const m = PREVIEW.bridgeMix + PREVIEW.bridgePulse * Math.sin(ph * Math.PI * 2);
        border.lerp(C.bridge, m), trim.lerp(C.bridge, 0.35);
      } else if (nearGhost) {
        border.lerp(C.gold, 0.72), trim.lerp(C.gold, 0.45);
      } else if (nearDirect && ghostCells.size > 0) {
        border.lerp(C.gold, PREVIEW.directMix * 0.85), trim.lerp(C.gold, 0.3);
      } else if (nearDirect) border.lerp(C.adj, PREVIEW.directMix), trim.lerp(C.adj, 0.25);
      h *= o.scale;
      const [cx, cz] = o.c;
      this.tops[i].set(cx, h, cz);
      writeFrame(embed, i, { p: [cx, h, cz], s: o.scale, n: [0, 1, 0] });
      if (t && o.scale > 0.02) {
        const im = this.motifs[t], st = this.strain(i, t);
        const sc = MOTIF.fill * GAP * Math.sqrt(o.scale) * (this.hyper ? 1.3 : 1) * motifScale(L) * (1 - MOTIF.strainShrink * st.k);
        this.m4.compose(this.tops[i], this.q, this.sc.setScalar(sc));
        this.motifSlot[i] = im.count;
        im.setColorAt(im.count, st.tint);
        im.setMatrixAt(im.count++, this.m4);
        this.tmpV.copy(this.tops[i]).y += MOTIF.ringLift;
        this.r4.compose(this.tmpV, this.q, this.sc.setScalar(GAP * Math.sqrt(o.scale)));
        this.rings.setColorAt(this.rings.count, st.ring);
        this.rings.setMatrixAt(this.rings.count++, this.r4);
        if (t === 'mill' && this.wheel) {
          const k = this.wheel.count++;
          this.wheelBase[k].copy(this.m4).multiply(this.wheelOffset);
          this.wheelOn[k] = perTile[i] > 0;
          this.wheel.setMatrixAt(k, this.wheelBase[k]);
        }
      } else this.motifSlot[i] = -1;
      const hidden = o.scale <= 0, hb = h * 0.82;
      let v = i * K * PER_K;
      const put = (x: number, y: number, z: number, cc: THREE.Color, gl: THREE.Color) => {
        const j = v * 3;
        pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
        colA[j] = cc.r; colA[j + 1] = cc.g; colA[j + 2] = cc.b;
        glowA[j] = gl.r; glowA[j + 1] = gl.g; glowA[j + 2] = gl.b;
        v++;
      };
      for (let k = 0; k < K; k++) {
        // hidden tiles collapse to the centre, giving zero-area triangles
        const [px, pz] = hidden ? o.c : o.pts[k], [qx, qz] = hidden ? o.c : o.pts[(k + 1) % K];
        const ax = cx + (px - cx) * ins, az = cz + (pz - cz) * ins, bx = cx + (qx - cx) * ins, bz = cz + (qz - cz) * ins;
        put(cx, h, cz, c, glow); put(bx, h, bz, c, glow); put(ax, h, az, c, glow); // inner face (CCW from above)
        put(ax, h, az, border, trim); put(bx, h, bz, border, trim); put(qx, hb, qz, border, trim); // bevel / slot border
        put(ax, h, az, border, trim); put(qx, hb, qz, border, trim); put(px, hb, pz, border, trim);
        put(px, hb, pz, side, C.black); put(qx, hb, qz, side, C.black); put(qx, 0, qz, side, C.black); // side
        put(px, hb, pz, side, C.black); put(qx, 0, qz, side, C.black); put(px, 0, pz, side, C.black);
      }
    }
    this.geom.computeVertexNormals(); // non-indexed: face normals, written in place
    bumpRev(embed);
    for (const name of ['position', 'normal', 'color', 'glow']) this.geom.attributes[name].needsUpdate = true;
    for (const t of TILE_TYPES) {
      const im = this.motifs[t];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    if (this.wheel) this.wheel.instanceMatrix.needsUpdate = true;
    this.updatePreviewArc(hl?.arc);
    this.overlayConstellations(hl);
  }

  /**
   * Spring strain from core economy (prod: share / feeds, read only). k in 0..1 = how far below full share, drives the
   * model's dim and shrink. A Bridge-channelled Spring (full share, feeds > 1) gets a bright gold ring instead.
   */
  private strain(i: number, t: TileType): { k: number; tint: THREE.Color; ring: THREE.Color } {
    const tk = TILE_IDENTITIES[t];
    const tint = this.tmpC.set(0xffffff), ring = this.tmpR.set(tk.emissive).multiplyScalar(0.35);
    if (t !== 'spring' || !this.pr || !(this.pr.feeds[i] > 0)) return { k: 0, tint, ring };
    const share = this.pr.share[i], feeds = this.pr.feeds[i];
    const k = Math.min(1, Math.max(0, (1 - share) * 2));
    if (feeds > 1 && share >= 1) {
      return { k: 0, tint, ring: this.tmpV2.set(TILE_IDENTITIES.bridge.accent).multiplyScalar(MOTIF.channelBoost) };
    }
    const dim = 1 - MOTIF.strainDim * k;
    tint.set(0xffffff).lerp(this.tmpV2.set(MOTIF.strainTint), 0.6 * k).multiplyScalar(dim);
    ring.set(MOTIF.strainTint).multiplyScalar(0.5 * (1 - k));
    return { k, tint, ring };
  }

  /** Inspect ink-flow arches (runs every frame). */
  overlayFlow(hl: BoardHighlight | undefined, reducedMotion: boolean) {
    this.flowArch.update(hl?.flowLinks ?? [], this.tops, hl?.flowPhase ?? 0, reducedMotion);
  }

  /** Starts a squash-settle on tile i at fx time `now` (writes only that tile's vertex span). */
  markPlaced(i: number, now: number) {
    if (!(i >= 0 && i < this.glowQ.length)) return;
    const span = this.K * PER_K, a = this.geom.attributes.born as THREE.BufferAttribute;
    this.born.fill(now, i * span, (i + 1) * span);
    a.addUpdateRange(i * span, span);
    a.needsUpdate = true;
    this.settling.set(i, now);
  }

  /**
   * Survey reveal: tile indices[j] rises from the table starting at fx time now + delays[j] (shader smoothstep over
   * REVEAL_S, with a brief rim brightening). Writes only those tiles' vertex spans. Out-of-range indices are ignored.
   */
  markRevealed(indices: readonly number[], now: number, delays: readonly number[]) {
    if (!Number.isFinite(now)) return;
    const n = this.glowQ.length, span = this.K * PER_K, a = this.geom.attributes.revealAt as THREE.BufferAttribute;
    indices.forEach((i, j) => {
      if (!Number.isInteger(i) || i < 0 || i >= n) return;
      const d = delays[j];
      const at = now + (Number.isFinite(d) && d > 0 ? d : 0);
      this.revealed.fill(at, i * span, (i + 1) * span);
      a.addUpdateRange(i * span, span);
    });
    a.needsUpdate = true;
  }

  /** Per frame: advance the squash clock; motifs of settling tiles (few) follow the same curve. */
  tick(now: number, reduced: boolean) {
    this.reducedMotion = reduced;
    this.uClock.value = reduced ? 1e9 : now;
    if (this.wheel && !reduced) {
      // producing mills turn their wheel about the tile normal (local Z of the authored mesh)
      this.spin.makeRotationZ(now * config.ui.wheelSpin);
      for (let k = 0; k < this.wheel.count; k++) {
        if (!this.wheelOn[k]) continue;
        this.m4.multiplyMatrices(this.wheelBase[k], this.spin);
        this.wheel.setMatrixAt(k, this.m4);
      }
      this.wheel.instanceMatrix.needsUpdate = true;
    }
    for (const [i, t0] of this.settling) {
      if (now - t0 >= PLACE.life || reduced) this.settling.delete(i);
      const slot = this.motifSlot[i], t = this.tileType[i];
      if (slot < 0 || !t) continue;
      const im = this.motifs[t];
      if (slot >= im.count) continue;
      im.getMatrixAt(slot, this.m4);
      this.m4.decompose(this.c2, this.q, this.sc);
      this.c2.y = this.tops[i].y * (reduced ? 1 : placeScale(now - t0));
      this.m4.compose(this.c2, this.q, this.sc);
      im.setMatrixAt(slot, this.m4);
      im.instanceMatrix.needsUpdate = true;
    }
  }

  /** Whole-board fade/warp for prestige transitions: a = opacity 0..1, warp = 0..1 swirl + shrink. */
  setFade(a: number, warp = 0) {
    if (!this.mats.length) this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) this.mats.push(m);
    });
    const op = Math.max(0, Math.min(1, a)), tr = op < 0.999;
    for (const m of this.mats) {
      if (m.transparent !== tr) (m.transparent = tr), (m.needsUpdate = true);
      m.opacity = op;
    }
    this.group.rotation.y = warp * warp * 2.4;
    this.group.scale.setScalar(1 - 0.35 * warp);
  }

  /** World point on the table (y=0) → tile index, or −1. */
  pick(x: number, z: number, s: GameState): number {
    const g = GRAPHS[this.geometry];
    const ok = (i: number) => i >= 0 && g.ring[i] <= s.ring + 1;
    if (this.square) {
      const i = this.square.xy.findIndex(([a, b]) => Math.abs(a - x) <= 0.5 && Math.abs(b - z) <= 0.5);
      return ok(i) ? i : -1;
    }
    const u = x / DISK_R, w = z / DISK_R, r2 = u * u + w * w;
    if (r2 >= 0.995) return -1;
    const p = apply(inverse(this.view), normalize([2 * u, 2 * w, 1 + r2]));
    let best = -1, bd = Infinity;
    this.hyper!.centers.forEach((c, i) => {
      const d = dist(c, p);
      if (d < bd) (bd = d), (best = i);
    });
    return bd < 0.75 && ok(best) ? best : -1;
  }

  /** Hyperbolic pan: boost the view by a small disk-space displacement. Rejected if it would leave the board. */
  pan(dx: number, dz: number, maxRadius: number) {
    if (!this.hyper) return;
    const du = dx / DISK_R, dw = dz / DISK_R, m = Math.hypot(du, dw);
    if (m < 1e-6) return;
    const next = orthonormalize(mul(boost(2 * Math.atanh(Math.min(0.9, m)), Math.atan2(dw, du)), this.view));
    const origin = apply(next, [0, 0, 1] as Vec3);
    if (dist(origin, [0, 0, 1]) > 1.1 * maxRadius + 0.6) return;
    this.view = next;
    this.viewRev++;
  }

  recenter() {
    this.view = identity();
    this.viewRev++;
  }

  /** Brings tile i to the disk centre: left-multiplies the view by the boost that sends its current display point to the
   *  origin. Zoom (camera) is untouched, no Poincare clamp, tile indices unchanged. */
  centreOn(i: number) {
    if (!this.hyper) return;
    const p = apply(this.view, this.hyper.centers[i]);
    this.view = orthonormalize(mul(boostToOrigin(p), this.view));
    this.viewRev++;
  }

  /** Copy of the current view (row-major Lorentz matrix). */
  viewMatrix(): Mat3 {
    return this.view.slice();
  }

  /** World-plane (x, z) centre of tile i and of its first corner under the current view (QA projection input). */
  cellWorld(i: number): { c: [number, number]; corner: [number, number] } {
    if (this.square) {
      const [x, y] = this.square.xy[i], h = GAP / 2;
      return { c: [x, y], corner: [x + h, y + h] };
    }
    const hb = this.hyper!;
    const toWorld = (v: Vec3): [number, number] => {
      const [u, w] = toDisk(apply(this.view, v));
      return [u * DISK_R, w * DISK_R];
    };
    return { c: toWorld(hb.centers[i]), corner: toWorld(hb.verts[i][0]) };
  }

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        }
      }
    });
  }
}
