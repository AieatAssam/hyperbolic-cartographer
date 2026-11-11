import * as THREE from 'three';
import { SURFACE } from '../art/palette';
import { config } from '../core/config';
import { KLEIN_U_MAX, KLEIN_V_MAX, KLEIN_SELF_INTERSECT_U } from './klein-bottle';
import {
  KLEIN_SCALE, kleinImmersionPos, torusNormalFromUv, torusPosFromUv,
} from './surface-params';

const col = (h: number) => new THREE.Color(h);

/** Soft radial gradient only: the per-cell grid lines are gone (tiles carry the structure now). */
function skinTexture(): THREE.CanvasTexture {
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(N / 2, N / 2, N * 0.08, N / 2, N / 2, N * 0.78);
  const ink = SURFACE.skinInk.toString(16).padStart(6, '0');
  grad.addColorStop(0, `#${ink}`);
  grad.addColorStop(1, `#${SURFACE.skin.toString(16).padStart(6, '0')}`);
  g.fillStyle = grad;
  g.fillRect(0, 0, N, N);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Adds a fresnel edge glow (view-angle rim) to a physical material. */
function addFresnelRim(mat: THREE.MeshPhysicalMaterial, strength: number) {
  const rimCol = col(SURFACE.skinInk).lerp(col(SURFACE.skin), 0.35);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRimCol = { value: rimCol };
    sh.uniforms.uRimK = { value: strength };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimCol;\nuniform float uRimK;')
      .replace(
        '#include <opaque_fragment>',
        `float fres = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
        outgoingLight += uRimCol * fres * uRimK;
        #include <opaque_fragment>`,
      );
  };
  return mat;
}

function torusSkinMaterial(env: THREE.Texture | null) {
  const mat = new THREE.MeshPhysicalMaterial({
    map: skinTexture(),
    color: col(SURFACE.skinInk),
    emissive: col(0x000000),
    transparent: true,
    opacity: config.manifold.skinAlpha,
    roughness: 0.38,
    metalness: 0.15,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
    envMap: env,
    envMapIntensity: 1.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  return addFresnelRim(mat, config.manifold.skinRimEmissive);
}

/** Torus: smooth analytic normals, indexed grid. */
export function buildTorusSkin(env: THREE.Texture | null): THREE.Mesh {
  const uSteps = config.manifold.torusSkinU, vSteps = config.manifold.torusSkinV;
  const pos = new Float32Array((uSteps + 1) * (vSteps + 1) * 3);
  const nrm = new Float32Array(pos.length);
  let o = 0;
  for (let yi = 0; yi <= vSteps; yi++) {
    for (let xi = 0; xi <= uSteps; xi++) {
      const u = (xi / uSteps) * Math.PI * 2, v = (yi / vSteps) * Math.PI * 2;
      const [px, py, pz] = torusPosFromUv(u, v);
      const [nx, ny, nz] = torusNormalFromUv(u, v);
      pos[o] = px; pos[o + 1] = py; pos[o + 2] = pz;
      nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz;
      o += 3;
    }
  }
  const row = uSteps + 1;
  const idx: number[] = [];
  for (let yi = 0; yi < vSteps; yi++) {
    for (let xi = 0; xi < uSteps; xi++) {
      const a = yi * row + xi, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geom.setIndex(idx);
  const mesh = new THREE.Mesh(geom, torusSkinMaterial(env));
  mesh.name = 'torus-skin';
  mesh.renderOrder = -6;
  return mesh;
}

/**
 * Klein immersion skin as an indexed grid. Immersion gluing (π, v) ≡ (0, π − v) closes the u-seam: the u=π
 * column is not emitted; its quads reference the u=0 column at v → π − v. Shared vertices get averaged normals.
 */
function kleinIndexedGeometry(uSteps: number, vSteps: number): THREE.BufferGeometry {
  if (vSteps % 2 !== 0) throw new Error('kleinSkinV must be even for the glide seam');
  const scale = KLEIN_SCALE();
  const pos = new Float32Array(uSteps * vSteps * 3);
  const uvs = new Float32Array(uSteps * vSteps * 2);
  const idx: number[] = [];
  const at = (ui: number, vi: number) => {
    // Wrap u across the glide seam: column uSteps is column 0 with v → π − v.
    let uu = ui, vv = ((vi % vSteps) + vSteps) % vSteps;
    if (uu >= uSteps) { uu -= uSteps; vv = (vSteps / 2 - vv + vSteps) % vSteps; }
    return uu * vSteps + vv;
  };
  for (let ui = 0; ui < uSteps; ui++) {
    for (let vi = 0; vi < vSteps; vi++) {
      const u = (ui / uSteps) * KLEIN_U_MAX, v = (vi / vSteps) * KLEIN_V_MAX;
      const [x, y, z] = kleinImmersionPos(u, v, scale);
      const k = ui * vSteps + vi;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      uvs[k * 2] = ui / uSteps; uvs[k * 2 + 1] = vi / vSteps;
    }
  }
  for (let ui = 0; ui < uSteps; ui++) {
    for (let vi = 0; vi < vSteps; vi++) {
      const a = at(ui, vi), b = at(ui + 1, vi), c = at(ui, vi + 1), d = at(ui + 1, vi + 1);
      idx.push(a, c, b, b, c, d);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  return geom;
}

function kleinGlassMaterial(env: THREE.Texture | null, side: THREE.Side, colourK: number) {
  const mat = new THREE.MeshPhysicalMaterial({
    map: skinTexture(),
    color: col(SURFACE.skinInk).multiplyScalar(colourK),
    transparent: true,
    opacity: config.manifold.kleinSkinAlpha,
    roughness: 0.12,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    iridescence: 0.35,
    envMap: env,
    envMapIntensity: 1.2,
    side,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  return addFresnelRim(mat, config.manifold.skinRimEmissive * 1.8);
}

export function buildKleinImmersionSkin(env: THREE.Texture | null): THREE.Group {
  const k = config.manifold.kleinSkinDetail;
  const geom = kleinIndexedGeometry(config.manifold.kleinSkinU * k, config.manifold.kleinSkinV * k);
  // Two glass passes: the back wall (dimmer, drawn first) then the front wall.
  const back = new THREE.Mesh(geom, kleinGlassMaterial(env, THREE.BackSide, 0.6));
  back.name = 'klein-skin-back';
  back.renderOrder = -11;
  const front = new THREE.Mesh(geom, kleinGlassMaterial(env, THREE.FrontSide, 1));
  front.name = 'klein-skin';
  front.renderOrder = -10;
  const grp = new THREE.Group();
  grp.name = 'klein-skin';
  grp.add(back, front);
  return grp;
}

export function buildSelfIntersectionLine(scale = KLEIN_SCALE()): THREE.Group {
  const pts: THREE.Vector3[] = [];
  const n = 96;
  for (let i = 0; i <= n; i++) {
    const v = (i / n) * Math.PI * 2;
    const [x, y, z] = kleinImmersionPos(KLEIN_SELF_INTERSECT_U, v, scale);
    pts.push(new THREE.Vector3(x, y, z));
  }
  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  const lineMat = new THREE.LineDashedMaterial({
    color: col(SURFACE.seamGlow),
    transparent: true,
    opacity: 0.82,
    dashSize: SURFACE.dashPattern[0],
    gapSize: SURFACE.dashPattern[1],
  });
  const line = new THREE.Line(geom, lineMat);
  line.computeLineDistances();
  line.name = 'klein-self-intersection';
  line.renderOrder = 7;

  const beadGeo = new THREE.SphereGeometry(0.055, 6, 5);
  const beadMat = new THREE.MeshStandardMaterial({
    color: col(SURFACE.seamGlow),
    emissive: col(SURFACE.seamGlow),
    emissiveIntensity: SURFACE.seamGlowEmissive,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    roughness: 0.35,
    metalness: 0,
  });
  const step = 4;
  const count = Math.ceil((n + 1) / step);
  const beads = new THREE.InstancedMesh(beadGeo, beadMat, count);
  const m = new THREE.Matrix4();
  for (let b = 0, i = 0; i <= n; i += step, b++) {
    m.makeTranslation(pts[i].x, pts[i].y, pts[i].z);
    beads.setMatrixAt(b, m);
  }
  beads.count = count;
  beads.name = 'klein-self-intersection-glow';
  beads.renderOrder = 8;

  const grp = new THREE.Group();
  grp.name = 'klein-self-intersection';
  grp.add(line, beads);
  return grp;
}
