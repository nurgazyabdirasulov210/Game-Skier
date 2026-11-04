import * as THREE from 'three';
import { CONFIG } from './config.js';

const HALF = CONFIG.MAP_SIZE / 2;
const CELL = CONFIG.CELL_SIZE;
const CELLS = Math.ceil(CONFIG.MAP_SIZE / CELL);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

// Набор экземпляров одного вида объекта, разложенный по ячейкам карты,
// с уровнями детализации (LOD) по расстоянию до камеры.
export class Scatter {
  /**
   * @param {string} name
   * @param {Array<{parts: Array<{geometry, material, colored?: boolean}>, maxDist: number}>} lods
   */
  constructor(name, lods, { castShadow = true, receiveShadow = true } = {}) {
    this.name = name;
    this.lods = lods;
    this.castShadow = castShadow;
    this.receiveShadow = receiveShadow;
    this.cells = new Map();
    this.count = 0;
  }

  add(x, y, z, rotY, scale, color = null, tiltX = 0, tiltZ = 0) {
    const ci = Math.min(CELLS - 1, Math.max(0, Math.floor((x + HALF) / CELL)));
    const cj = Math.min(CELLS - 1, Math.max(0, Math.floor((z + HALF) / CELL)));
    const key = cj * CELLS + ci;
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { matrices: [], colors: [], cx: -HALF + (ci + 0.5) * CELL, cz: -HALF + (cj + 0.5) * CELL, meshes: [] };
      this.cells.set(key, cell);
    }
    _e.set(tiltX, rotY, tiltZ, 'YXZ');
    _q.setFromEuler(_e);
    if (typeof scale === 'number') _s.set(scale, scale, scale); else _s.copy(scale);
    _p.set(x, y, z);
    _m.compose(_p, _q, _s);
    cell.matrices.push(_m.clone());
    cell.colors.push(color);
    this.count++;
  }

  addMatrix(x, z, matrix, color = null) {
    const ci = Math.min(CELLS - 1, Math.max(0, Math.floor((x + HALF) / CELL)));
    const cj = Math.min(CELLS - 1, Math.max(0, Math.floor((z + HALF) / CELL)));
    const key = cj * CELLS + ci;
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { matrices: [], colors: [], cx: -HALF + (ci + 0.5) * CELL, cz: -HALF + (cj + 0.5) * CELL, meshes: [] };
      this.cells.set(key, cell);
    }
    cell.matrices.push(matrix.clone());
    cell.colors.push(color);
    this.count++;
  }

  build(parent) {
    this.group = new THREE.Group();
    this.group.name = this.name;
    const white = new THREE.Color(1, 1, 1);
    for (const cell of this.cells.values()) {
      cell.meshes = this.lods.map((lod) => lod.parts.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, cell.matrices.length);
        for (let i = 0; i < cell.matrices.length; i++) {
          mesh.setMatrixAt(i, cell.matrices[i]);
          if (part.colored) mesh.setColorAt(i, cell.colors[i] || white);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = this.castShadow && part.castShadow !== false;
        if (part.material.userData.depth) mesh.customDepthMaterial = part.material.userData.depth;
        mesh.receiveShadow = this.receiveShadow;
        mesh.computeBoundingSphere();
        mesh.visible = false;
        this.group.add(mesh);
        return mesh;
      }));
    }
    parent.add(this.group);
  }

  update(camPos, scaleDist = 1) {
    for (const cell of this.cells.values()) {
      const d = Math.max(0, Math.hypot(cell.cx - camPos.x, cell.cz - camPos.z) - CELL * 0.71);
      let chosen = -1;
      for (let l = 0; l < this.lods.length; l++) {
        if (d <= this.lods[l].maxDist * scaleDist) { chosen = l; break; }
      }
      for (let l = 0; l < cell.meshes.length; l++) {
        const vis = l === chosen;
        for (const m of cell.meshes[l]) m.visible = vis;
      }
    }
  }
}

// Пространственный хэш для проверки, что объекты не налезают друг на друга.
export class Occupancy {
  constructor(cell = 16) { this.cell = cell; this.map = new Map(); }
  key(i, j) { return i * 73856093 ^ j * 19349663; }
  add(x, z, r) {
    const c = this.cell;
    const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c);
    const j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j);
      let arr = this.map.get(k);
      if (!arr) { arr = []; this.map.set(k, arr); }
      arr.push(x, z, r);
    }
  }
  free(x, z, r) {
    const c = this.cell;
    const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c);
    const j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const arr = this.map.get(this.key(i, j));
      if (!arr) continue;
      for (let k = 0; k < arr.length; k += 3) {
        const dx = arr[k] - x, dz = arr[k + 1] - z, rr = arr[k + 2] + r;
        if (dx * dx + dz * dz < rr * rr) return false;
      }
    }
    return true;
  }
}
