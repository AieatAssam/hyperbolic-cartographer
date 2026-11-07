import * as THREE from 'three';
import { BOARD, SURFACE } from '../art/palette';
import { config } from '../core/config';
import type { SurfaceGraph } from '../core/geometry/quotient';
import {
  KLEIN_SCALE, TORUS_R, TORUS_r, kleinImmersionPos, torusPos,
} from './surface-params';

const col = (h: number) => new THREE.Color(h);

function skinTexture(uSeg: number, vSeg: number): THREE.CanvasTexture {
  const N = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(N / 2, N / 2, N * 0.08, N / 2, N / 2, N * 0.78);
  grad.addColorStop(0, '#7a5a9a');
  grad.addColorStop(1, `#${SURFACE.skin.toString(16).padStart(6, '0')}`);
  g.fillStyle = grad;
  g.fillRect(0, 0, N, N);
  g.strokeStyle = 'rgba(139,108,196,0.35)';
  g.lineWidth = 1;
  const du = N / Math.max(1, uSeg), dv = N / Math.max(1, vSeg);
  for (let i = 0; i <= uSeg; i++) {
    g.beginPath(); g.moveTo(i * du, 0); g.lineTo(i * du, N); g.stroke();
  }
  for (let j = 0; j <= vSeg; j++) {
    g.beginPath(); g.moveTo(0, j * dv); g.lineTo(N, j * dv); g.stroke();
  }
  g.strokeStyle = 'rgba(95,212,255,0.14)';
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    for (let a = 0; a <= 64; a++) {
      const th = (a / 64) * Math.PI * 2, rr = (N / 2) * (0.15 + i * 0.12);
      g.lineTo(N / 2 + Math.cos(th) * rr, N / 2 + Math.sin(th) * rr);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skinMaterial(uSeg: number, vSeg: number, env: THREE.Texture | null) {
  const map = skinTexture(uSeg, vSeg);
  return new THREE.MeshStandardMaterial({
    map,
    color: col(SURFACE.skinInk),
    transparent: true,
    opacity: config.manifold.skinAlpha,
    roughness: 0.88,
    metalness: 0.08,
    envMap: env,
    envMapIntensity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

export function buildTorusSkin(g: SurfaceGraph, env: THREE.Texture | null): THREE.Mesh {
  const R = TORUS_R(), r = TORUS_r();
  const mat = skinMaterial(g.width, g.height, env);
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(R, r * 0.98, g.height * 3, g.width * 3),
    mat,
  );
  mesh.name = 'torus-skin';
  mesh.renderOrder = -2;
  return mesh;
}

/** Parametric Klein fig-8 immersion skin aligned with tile UVs. */
export function buildKleinImmersionSkin(g: SurfaceGraph, env: THREE.Texture | null): THREE.Mesh {
  const w = g.width, h = g.height, scale = KLEIN_SCALE();
  const uSteps = w * 4, vSteps = h * 4;
  const pos: number[] = [], idx: number[] = [], uvs: number[] = [];
  for (let yi = 0; yi <= vSteps; yi++) {
    for (let xi = 0; xi <= uSteps; xi++) {
      const u = (xi / uSteps) * Math.PI * 2;
      const v = (yi / vSteps) * Math.PI * 2;
      const [px, py, pz] = kleinImmersionPos(u, v, scale);
      pos.push(px, py, pz);
      uvs.push(xi / uSteps, yi / vSteps);
    }
  }
  const row = uSteps + 1;
  for (let yi = 0; yi < vSteps; yi++) {
    for (let xi = 0; xi < uSteps; xi++) {
      const a = yi * row + xi, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  const mat = skinMaterial(w, h, env);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'klein-skin';
  mesh.renderOrder = -2;
  return mesh;
}

/** Self-intersection locus (u = π) of the fig-8 immersion. */
export function buildSelfIntersectionLine(scale = KLEIN_SCALE()): THREE.Line {
  const pts: number[] = [];
  const n = 96;
  for (let i = 0; i <= n; i++) {
    const v = (i / n) * Math.PI * 2;
    const [x, y, z] = kleinImmersionPos(Math.PI, v, scale);
    pts.push(x, y, z);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineDashedMaterial({
    color: BOARD.gold,
    transparent: true,
    opacity: 0.45,
    dashSize: SURFACE.dashPattern[0],
    gapSize: SURFACE.dashPattern[1],
  });
  const line = new THREE.Line(geom, mat);
  line.computeLineDistances();
  line.name = 'klein-self-intersection';
  return line;
}

/** Closed seam loop on the torus (u = 0 cut). */
export function buildTorusSeamRing(g: SurfaceGraph): THREE.Line {
  const pts: number[] = [];
  const n = 64;
  for (let i = 0; i <= n; i++) {
    const y = Math.floor((i / n) * g.height) % g.height;
    const [x, yy, z] = torusPos(0, y, g.width, g.height);
    pts.push(x, yy, z);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineDashedMaterial({
    color: SURFACE.seamA,
    transparent: true,
    opacity: 0.85,
    dashSize: SURFACE.dashPattern[0] * 1.2,
    gapSize: SURFACE.dashPattern[1],
    linewidth: 2,
  });
  const line = new THREE.Line(geom, mat);
  line.computeLineDistances();
  return line;
}
