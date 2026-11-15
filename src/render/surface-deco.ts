import * as THREE from 'three';
import type { SurfaceGraph } from '../core/geometry/quotient';
import type { Surface } from '../core/state';
import { STAGE, SURFACE } from '../art/palette';
import { chartCell, chartCellCenter } from './surface-params';
const col = (h: number) => new THREE.Color(h);

function dashMat(color: number, opacity = 0.9) {
  return new THREE.LineDashedMaterial({
    color: col(color),
    transparent: true,
    opacity,
    dashSize: SURFACE.dashPattern[0] * 1.4,
    gapSize: SURFACE.dashPattern[1],
  });
}

function arrowAt(group: THREE.Group, from: THREE.Vector3, to: THREE.Vector3, color: number) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 1e-4) return;
  const mid = from.clone().addScaledVector(dir, 0.55);
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.22, 8),
    new THREE.MeshBasicMaterial({ color: col(color), transparent: true, opacity: 0.95 }),
  );
  cone.position.copy(mid);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  group.add(cone);
}

function lineAlong(group: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, color: number, y = 0.04) {
  const pts = [a.x, y, a.z, b.x, y, b.z];
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const line = new THREE.Line(geom, dashMat(color));
  line.computeLineDistances();
  group.add(line);
}

/**
 * Identification arrows and dashed seam borders on the fundamental chart. Matching colour and arrow direction mean
 * "glued". The x seam is flipped on the Möbius strip and Klein bottle (gold, arrows opposed); the Möbius strip's
 * long edges are its boundary (solid brass, no arrows).
 */
export function buildChartSeams(g: SurfaceGraph, surf: Surface): THREE.Group {
  const cell = chartCell(g.width, g.height);
  const w = g.width, h = g.height;
  const box = new THREE.Group();
  const y = 0.05;
  const left = chartCellCenter(0, 0, w, h, cell)[0] - cell * 0.5;
  const right = chartCellCenter(w - 1, 0, w, h, cell)[0] + cell * 0.5;
  const top = chartCellCenter(0, 0, w, h, cell)[2] - cell * 0.5;
  const bottom = chartCellCenter(0, h - 1, w, h, cell)[2] + cell * 0.5;
  const flipX = surf !== 'torus';
  const xCol = flipX ? SURFACE.seamFlip : SURFACE.seamA;
  lineAlong(box, new THREE.Vector3(left, y, top), new THREE.Vector3(left, y, bottom), xCol, y);
  lineAlong(box, new THREE.Vector3(right, y, top), new THREE.Vector3(right, y, bottom), xCol, y);
  const midZ = (top + bottom) / 2, a = Math.min(cell * 0.5, (bottom - top) * 0.3);
  arrowAt(box, new THREE.Vector3(left - cell * 0.3, y, midZ - a), new THREE.Vector3(left - cell * 0.3, y, midZ + a), xCol);
  const r = flipX ? -1 : 1;
  arrowAt(box, new THREE.Vector3(right + cell * 0.3, y, midZ - r * a), new THREE.Vector3(right + cell * 0.3, y, midZ + r * a), xCol);
  if (surf === 'mobius') {
    const edge = new THREE.LineBasicMaterial({ color: col(STAGE.brass), transparent: true, opacity: 0.9 });
    for (const z of [top, bottom]) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute([left, y, z, right, y, z], 3));
      box.add(new THREE.Line(geom, edge));
    }
    return box;
  }
  lineAlong(box, new THREE.Vector3(left, y, top), new THREE.Vector3(right, y, top), SURFACE.seamB, y);
  lineAlong(box, new THREE.Vector3(left, y, bottom), new THREE.Vector3(right, y, bottom), SURFACE.seamB, y);
  const midX = (left + right) / 2;
  arrowAt(box, new THREE.Vector3(midX - cell * 0.45, y, top - cell * 0.3), new THREE.Vector3(midX + cell * 0.45, y, top - cell * 0.3), SURFACE.seamB);
  arrowAt(box, new THREE.Vector3(midX - cell * 0.45, y, bottom + cell * 0.3), new THREE.Vector3(midX + cell * 0.45, y, bottom + cell * 0.3), SURFACE.seamB);
  return box;
}

/** Faint copies of the edge cells drawn just past each glued edge, where the gluing puts them. */
export function buildEdgeGhosts(g: SurfaceGraph, surf: Surface): THREE.Group {
  const cell = chartCell(g.width, g.height);
  const w = g.width, h = g.height;
  const grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: col(SURFACE.ghost),
    transparent: true,
    opacity: SURFACE.edgeGhostAlpha,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const geo = new THREE.PlaneGeometry(cell * (1 - 0.12), cell * (1 - 0.12));
  const put = (x: number, yy: number) => {
    const c = chartCellCenter(x, yy, w, h, cell);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(c[0], 0.018, c[2]);
    grp.add(m);
  };
  const flip = surf !== 'torus';
  for (let i = 0; i < g.ring.length; i++) {
    const [x, y] = g.xy[i];
    const fy = flip ? h - 1 - y : y;
    if (x === w - 1) put(-1, fy);
    if (x === 0) put(w, fy);
    if (surf === 'mobius') continue;
    if (y === 0) put(x, h);
    if (y === h - 1) put(x, -1);
  }
  return grp;
}
