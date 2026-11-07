import * as THREE from 'three';
import { BOARD, SURFACE } from '../art/palette';
import { config } from '../core/config';
import type { SurfaceGraph } from '../core/geometry/quotient';
import { KLEIN_U_MAX, KLEIN_V_MAX, KLEIN_SELF_INTERSECT_U, kleinImmersionFrame } from './klein-bottle';
import {
  KLEIN_SCALE, kleinImmersionPos, torusPosFromUv,
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
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skinMaterial(uSeg: number, vSeg: number, env: THREE.Texture | null, rim = false) {
  const map = skinTexture(uSeg, vSeg);
  const rimCol = col(0xc8b0e8);
  return new THREE.MeshStandardMaterial({
    map,
    color: col(SURFACE.skinInk),
    emissive: rim ? rimCol : col(0x000000),
    emissiveIntensity: rim ? config.manifold.skinRimEmissive : 0,
    transparent: true,
    opacity: config.manifold.skinAlpha,
    roughness: rim ? 0.72 : 0.88,
    metalness: rim ? 0.12 : 0.08,
    envMap: env,
    envMapIntensity: rim ? 0.38 : 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
}

function parametricMesh(
  uSteps: number, vSteps: number, texW: number, texH: number,
  posAt: (u: number, v: number) => [number, number, number], env: THREE.Texture | null, name: string,
) {
  const pos: number[] = [], idx: number[] = [], uvs: number[] = [];
  for (let yi = 0; yi <= vSteps; yi++) {
    for (let xi = 0; xi <= uSteps; xi++) {
      const u = (xi / uSteps) * Math.PI * 2;
      const v = (yi / vSteps) * Math.PI * 2;
      const [px, py, pz] = posAt(u, v);
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
  const mesh = new THREE.Mesh(geom, skinMaterial(texW, texH, env, name === 'klein-skin'));
  mesh.name = name;
  mesh.renderOrder = -2;
  return mesh;
}

export function buildTorusSkin(g: SurfaceGraph, env: THREE.Texture | null): THREE.Mesh {
  return parametricMesh(g.width * 4, g.height * 4, g.width, g.height, (u, v) => torusPosFromUv(u, v), env, 'torus-skin');
}

function kleinParametricMesh(
  uSteps: number, vSteps: number, texW: number, texH: number,
  posAt: (u: number, v: number) => [number, number, number], env: THREE.Texture | null,
) {
  const pos: number[] = [], idx: number[] = [], uvs: number[] = [], nrm: number[] = [];
  const scale = KLEIN_SCALE();
  for (let yi = 0; yi <= vSteps; yi++) {
    for (let xi = 0; xi <= uSteps; xi++) {
      const u = (xi / uSteps) * KLEIN_U_MAX;
      const v = (yi / vSteps) * KLEIN_V_MAX;
      const [px, py, pz] = posAt(u, v);
      pos.push(px, py, pz);
      uvs.push(xi / uSteps, yi / vSteps);
      const n = kleinImmersionFrame(u, v, scale).n;
      nrm.push(n[0], n[1], n[2]);
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
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geom.setIndex(idx);
  const mesh = new THREE.Mesh(geom, skinMaterial(texW, texH, env, true));
  mesh.name = 'klein-skin';
  mesh.renderOrder = -2;
  return mesh;
}

export function buildKleinImmersionSkin(g: SurfaceGraph, env: THREE.Texture | null): THREE.Mesh {
  const scale = KLEIN_SCALE();
  const uSteps = config.manifold.kleinSkinU;
  const vSteps = config.manifold.kleinSkinV;
  return kleinParametricMesh(
    uSteps, vSteps, g.width, g.height,
    (u, v) => kleinImmersionPos(u, v, scale), env,
  );
}

export function buildSelfIntersectionLine(scale = KLEIN_SCALE()): THREE.Line {
  const pts: number[] = [];
  const n = 96;
  for (let i = 0; i <= n; i++) {
    const v = (i / n) * Math.PI * 2;
    const [x, y, z] = kleinImmersionPos(KLEIN_SELF_INTERSECT_U, v, scale);
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

export function buildTorusSeamRing(g: SurfaceGraph): THREE.Line {
  const pts: number[] = [];
  const n = g.height * 8;
  for (let i = 0; i <= n; i++) {
    const gy = (i / n) * g.height;
    const u = (0.5 / g.width) * Math.PI * 2;
    const v = (gy / g.height) * Math.PI * 2;
    const [x, y, z] = torusPosFromUv(u, v);
    pts.push(x, y, z);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineDashedMaterial({
    color: SURFACE.seamA,
    transparent: true,
    opacity: 0.85,
    dashSize: SURFACE.dashPattern[0] * 1.2,
    gapSize: SURFACE.dashPattern[1],
  });
  const line = new THREE.Line(geom, mat);
  line.computeLineDistances();
  return line;
}
