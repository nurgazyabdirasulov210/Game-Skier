// Instanced objects split into square chunks, each with a detailed and a
// low-poly version. Chunks far from the camera switch to the low version.
import * as THREE from 'three';

export class InstancedField {
  /**
   * variants: [{ hi: BufferGeometry, lo: BufferGeometry }]
   * material: shared material (or array per variant)
   */
  constructor(name, variants, material, { chunk = 300, loDist = 380, castShadow = true, receiveShadow = true } = {}) {
    this.name = name;
    this.variants = variants;
    this.material = material;
    this.chunk = chunk;
    this.loDist = loDist;
    this.castShadow = castShadow;
    this.receiveShadow = receiveShadow;
    this.items = [];
    this.group = new THREE.Group();
    this.group.name = name;
    this.chunks = [];
  }

  add(variant, matrix) {
    this.items.push({ v: variant, m: matrix.clone() });
  }

  build() {
    const map = new Map();
    const p = new THREE.Vector3();
    for (const it of this.items) {
      p.setFromMatrixPosition(it.m);
      const k = `${Math.floor(p.x / this.chunk)},${Math.floor(p.z / this.chunk)}`;
      if (!map.has(k)) map.set(k, { center: new THREE.Vector3(), n: 0, byVar: new Map() });
      const c = map.get(k);
      c.center.add(p);
      c.n++;
      if (!c.byVar.has(it.v)) c.byVar.set(it.v, []);
      c.byVar.get(it.v).push(it.m);
    }
    for (const c of map.values()) {
      c.center.divideScalar(c.n);
      const hi = [], lo = [];
      for (const [v, mats] of c.byVar) {
        const mat = Array.isArray(this.material) ? this.material[v] : this.material;
        for (const [list, geo] of [[hi, this.variants[v].hi], [lo, this.variants[v].lo || this.variants[v].hi]]) {
          const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
          mats.forEach((m, i) => mesh.setMatrixAt(i, m));
          mesh.castShadow = this.castShadow;
          mesh.receiveShadow = this.receiveShadow;
          mesh.computeBoundingSphere();
          list.push(mesh);
          this.group.add(mesh);
        }
      }
      this.chunks.push({ center: c.center, hi, lo, state: null });
    }
    return this.group;
  }

  update(camPos) {
    for (const c of this.chunks) {
      const dx = c.center.x - camPos.x, dz = c.center.z - camPos.z;
      const near = dx * dx + dz * dz < this.loDist * this.loDist;
      if (near === c.state) continue;
      c.state = near;
      for (const m of c.hi) m.visible = near;
      for (const m of c.lo) { m.visible = !near; m.castShadow = false; }
    }
  }
}
