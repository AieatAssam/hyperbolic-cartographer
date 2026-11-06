import * as THREE from 'three';

const N = 160;

/** Production pulses: small additive sparks travelling from a contributing neighbour into a producing tile. */
export class Pulses {
  readonly points: THREE.Points;
  private from = new Int32Array(N).fill(-1);
  private to = new Int32Array(N);
  private t = new Float32Array(N);
  private pos = new Float32Array(N * 3);

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0x8fe6ff, size: 0.24, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.points.frustumCulled = false;
  }

  /** links: [from, to] pairs worth animating; rate: how many spawns per second. */
  update(dt: number, tops: THREE.Vector3[], links: [number, number][], rate: number) {
    let spawn = links.length ? rate * dt : 0;
    for (let p = 0; p < N; p++) {
      if (this.from[p] < 0) {
        if (spawn-- > Math.random()) {
          const [a, b] = links[(Math.random() * links.length) | 0];
          this.from[p] = a;
          this.to[p] = b;
          this.t[p] = 0;
        } else {
          this.pos[p * 3 + 1] = -99;
          continue;
        }
      }
      this.t[p] += dt * 1.6;
      if (this.t[p] >= 1) {
        this.from[p] = -1;
        continue;
      }
      const a = tops[this.from[p]], b = tops[this.to[p]], k = this.t[p];
      this.pos[p * 3] = a.x + (b.x - a.x) * k;
      this.pos[p * 3 + 1] = a.y + (b.y - a.y) * k + 0.15 + Math.sin(k * Math.PI) * 0.35;
      this.pos[p * 3 + 2] = a.z + (b.z - a.z) * k;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
