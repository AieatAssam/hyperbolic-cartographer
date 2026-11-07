import * as THREE from 'three';
import type { SurfaceGraph } from '../core/geometry/quotient';
import { SURFACE } from '../art/palette';
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

/** Identification arrows + thick dashed seam borders on the fundamental square. */
export function buildChartSeams(
  g: SurfaceGraph,
  flipVertical: boolean,
): THREE.Group {
  const cell = chartCell(g.width, g.height);
  const w = g.width, h = g.height;
  const box = new THREE.Group();
  const y = 0.05;
  const left = chartCellCenter(0, 0, w, h, cell)[0] - cell * 0.5;
  const right = chartCellCenter(w - 1, 0, w, h, cell)[0] + cell * 0.5;
  const top = chartCellCenter(0, 0, w, h, cell)[2] - cell * 0.5;
  const bottom = chartCellCenter(0, h - 1, w, h, cell)[2] + cell * 0.5;
  lineAlong(box, new THREE.Vector3(left, y, top), new THREE.Vector3(left, y, bottom), SURFACE.seamA, y);
  lineAlong(box, new THREE.Vector3(right, y, top), new THREE.Vector3(right, y, bottom), SURFACE.seamA, y);
  lineAlong(box, new THREE.Vector3(left, y, top), new THREE.Vector3(right, y, top), SURFACE.seamB, y);
  lineAlong(box, new THREE.Vector3(left, y, bottom), new THREE.Vector3(right, y, bottom), SURFACE.seamB, y);
  const midZ = (top + bottom) / 2;
  arrowAt(box, new THREE.Vector3(left + cell * 0.35, y, midZ - cell * 0.5), new THREE.Vector3(left + cell * 0.35, y, midZ + cell * 0.5), SURFACE.seamA);
  arrowAt(box, new THREE.Vector3(right - cell * 0.35, y, midZ - cell * 0.5), new THREE.Vector3(right - cell * 0.35, y, midZ + cell * 0.5), SURFACE.seamA);
  const midX = (left + right) / 2;
  arrowAt(box, new THREE.Vector3(midX - cell * 0.45, y, top + cell * 0.3), new THREE.Vector3(midX + cell * 0.45, y, top + cell * 0.3), SURFACE.seamB);
  const rev = flipVertical;
  arrowAt(
    box,
    new THREE.Vector3(midX + (rev ? -1 : 1) * cell * 0.45, y, bottom - cell * 0.3),
    new THREE.Vector3(midX + (rev ? 1 : -1) * cell * 0.45, y, bottom - cell * 0.3),
    SURFACE.seamB,
  );
  return box;
}

type GhostSpec = { i: number; ox: number; oy: number; flipY?: boolean };

function chartGhostSpecs(g: SurfaceGraph, klein: boolean): GhostSpec[] {
  const w = g.width, h = g.height;
  const specs: GhostSpec[] = [];
  for (let i = 0; i < g.ring.length; i++) {
    const [x, y] = g.xy[i];
    if (x === 0) specs.push({ i, ox: -1, oy: 0 });
    if (x === w - 1) specs.push({ i, ox: 1, oy: 0, flipY: klein });
    if (y === 0) specs.push({ i, ox: 0, oy: -1 });
    if (y === h - 1) specs.push({ i, ox: 0, oy: 1 });
  }
  return specs;
}

export function buildEdgeGhosts(g: SurfaceGraph, klein: boolean): THREE.Group {
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
  for (const spec of chartGhostSpecs(g, klein)) {
    const [x, y] = g.xy[spec.i];
    const gy = klein && spec.flipY ? h - 1 - y : y;
    const c = chartCellCenter(x + spec.ox, gy + spec.oy, w, h, cell);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(cell * (1 - 0.12), cell * (1 - 0.12)), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(c[0], 0.018, c[2]);
    grp.add(m);
  }
  return grp;
}
