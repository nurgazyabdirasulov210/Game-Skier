// Открытый мир: стриминг чанков рельефа, леса, камней, ворот и кристаллов.
import * as THREE from 'three';
import { CHUNK, RES, CELL, height, kickerAt, KICK_CELL } from './terrain.js';
import { noise2, mulberry32, hash2i, smoothstep } from './noise.js';
import { snowMaterial, makeObjectMaterial, shardMaterial } from './shaders.js';

// ---------- сборщик слитой геометрии ----------
class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.snow = []; this.kind = []; this.idx = []; }
  add(geo, matrix, color, snow = 0, kind = 0, colorJitter = 0, rng = Math.random) {
    const p = geo.attributes.position, n = geo.attributes.normal;
    const base = this.pos.length / 3;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.nor.push(v.x, v.y, v.z);
      const j = colorJitter ? 1 + (rng() - 0.5) * colorJitter : 1;
      this.col.push(color.r * j, color.g * j, color.b * j);
      this.snow.push(snow);
      this.kind.push(kind);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSnow', new THREE.Float32BufferAttribute(this.snow, 1));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kind, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
export { GeoBuilder };

// ---------- базовые формы ----------
function lumpySphere(seed, detail = 2, amp = 0.16) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise2(v.x * 1.7 + seed, v.z * 1.7 + v.y * 1.3, seed);
    const s = 1 + n * amp;
    p.setXYZ(i, v.x * s, v.y * s * 0.85, v.z * s);
  }
  // нормали остаются «сферическими» — так крона выглядит мягкой
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const o = new THREE.Vector3().fromBufferAttribute(nrm, i);
    o.lerp(v, 1.0).normalize();
    nrm.setXYZ(i, o.x, o.y, o.z);
  }
  return g;
}

function jaggedRock(seed) {
  const g = new THREE.DodecahedronGeometry(1, 0);
  const p = g.attributes.position;
  const r = mulberry32(seed);
  const map = new Map();
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!map.has(key)) map.set(key, [0.75 + r() * 0.5, 0.7 + r() * 0.5, 0.75 + r() * 0.5]);
    const s = map.get(key);
    p.setXYZ(i, v.x * s[0], v.y * s[1] * 0.75, v.z * s[2]);
  }
  g.computeVertexNormals();
  return g;
}

const SHAPES = {
  trunk: new THREE.CylinderGeometry(0.1, 0.17, 1, 6, 1).translate(0, 0.5, 0),
  branch: new THREE.CylinderGeometry(0.04, 0.07, 1, 5, 1).translate(0, 0.5, 0),
  puffs: [lumpySphere(1.3), lumpySphere(7.7), lumpySphere(19.1)],
  cone: new THREE.ConeGeometry(1, 1, 8, 1).translate(0, 0.5, 0),
  rocks: [jaggedRock(3), jaggedRock(9), jaggedRock(27)],
  log: new THREE.CylinderGeometry(0.32, 0.36, 1, 7, 1).rotateZ(Math.PI / 2),
  slab: new THREE.BoxGeometry(1, 1, 1, 1, 1, 1).translate(0, 0.5, 0).toNonIndexed(),
  pole: new THREE.CylinderGeometry(0.04, 0.04, 1, 5).translate(0, 0.5, 0),
  flag: new THREE.BoxGeometry(0.02, 0.45, 0.7).translate(0, 0, 0.35),
};
SHAPES.slab.computeVertexNormals();

const C = (r, g, b) => new THREE.Color(r, g, b);
const CANOPY = [
  [C(1.0, 0.5, 0.26), C(1.0, 0.62, 0.36)], // оранжевые
  [C(1.0, 0.68, 0.5), C(1.0, 0.78, 0.6)], // персиковые
  [C(0.86, 0.92, 0.5), C(0.7, 0.88, 0.52)], // кремово-зелёные
  [C(0.98, 0.42, 0.34), C(1.0, 0.55, 0.4)], // коралловые
];
const BARK = C(0.93, 0.9, 0.86);
const PINE = C(0.1, 0.28, 0.33);
const PINE_TRUNK = C(0.25, 0.17, 0.16);
const ROCK = C(0.2, 0.22, 0.36);
const FLAG = C(1.0, 0.32, 0.22);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function addOriented(b, geo, from, to, radiusScale, color, snow, kind) {
  const dir = _p.copy(to).sub(from);
  const len = dir.length();
  _q.setFromUnitVectors(UP, dir.normalize());
  _m.compose(from, _q, _s.set(radiusScale, len, radiusScale));
  b.add(geo, _m, color, snow, kind);
}

function fluffyTree(b, x, y, z, r, cols, colliders, id) {
  const H = 3.5 + r() * 4.5;
  const lean = (r() - 0.5) * 0.15;
  const base = new THREE.Vector3(x, y - 0.3, z);
  const top = new THREE.Vector3(x + lean * H, y + H, z + lean * H * 0.5);
  addOriented(b, SHAPES.trunk, base, top, 1 + H * 0.06, BARK, 0.6, 2);
  const nPuffs = 3 + Math.floor(r() * 2);
  const col = cols;
  for (let i = 0; i < nPuffs; i++) {
    const t = 0.45 + (i / nPuffs) * 0.55;
    const a = r() * Math.PI * 2;
    const rad = (1 - t) * 1.8 + 0.4;
    const c = new THREE.Vector3(
      base.x + (top.x - base.x) * t + Math.cos(a) * rad,
      base.y + H * t + 0.3 + r() * 0.4,
      base.z + (top.z - base.z) * t + Math.sin(a) * rad
    );
    const bf = new THREE.Vector3(base.x + (top.x - base.x) * t * 0.8, base.y + H * t * 0.8, base.z + (top.z - base.z) * t * 0.8);
    addOriented(b, SHAPES.branch, bf, c, 1, BARK, 0.4, 2);
    const s = 0.9 + r() * 0.9 + (1 - t) * 0.6;
    _m.compose(c, _q.setFromAxisAngle(UP, r() * 6.28), _s.set(s, s, s));
    const tint = (i % 2 ? col[1] : col[0]);
    b.add(SHAPES.puffs[Math.floor(r() * 3)], _m, tint, 0.55, 1, 0.12, r);
  }
  _m.compose(top, _q.identity(), _s.set(1.2, 1.1, 1.2));
  b.add(SHAPES.puffs[Math.floor(r() * 3)], _m, col[0], 0.6, 1, 0.12, r);
  colliders.push({ x, z, y, top: y + H + 1, r: 0.45, kind: 'tree', id });
}

function pineTree(b, x, y, z, r, colliders, id) {
  const H = 6 + r() * 7;
  const W = 1.5 + r() * 1.2;
  _m.compose(_p.set(x, y - 0.3, z), _q.identity(), _s.set(1.3, H * 0.4, 1.3));
  b.add(SHAPES.trunk, _m, PINE_TRUNK, 0, 0);
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const w = W * (1 - t * 0.75);
    _m.compose(_p.set(x, y + H * (0.15 + t * 0.62), z), _q.setFromAxisAngle(UP, r() * 6.28), _s.set(w, H * 0.38, w));
    b.add(SHAPES.cone, _m, PINE, 1, 0, 0.25, r);
  }
  colliders.push({ x, z, y, top: y + H, r: 0.55, kind: 'tree', id });
}

function rock(b, x, y, z, r, colliders, id, scale = 1) {
  const s = (0.8 + r() * 1.8) * scale;
  _m.compose(_p.set(x, y + s * 0.15, z), _q.setFromEuler(new THREE.Euler(r() * 0.4, r() * 6.28, r() * 0.4)), _s.set(s * 1.2, s, s));
  b.add(SHAPES.rocks[Math.floor(r() * 3)], _m, ROCK, 1, 0, 0.3, r);
  colliders.push({ x, z, y, top: y + s * 0.85, r: s * 0.95, kind: 'rock', id });
}

function log(b, x, y, z, r, colliders, id) {
  const L = 4 + r() * 4;
  const yaw = r() * Math.PI;
  _m.compose(_p.set(x, y + 0.2, z), _q.setFromAxisAngle(UP, yaw), _s.set(L, 1, 1));
  b.add(SHAPES.log, _m, BARK, 0.8, 2);
  const dx = Math.cos(yaw), dz = -Math.sin(yaw);
  for (let i = -1; i <= 1; i++) {
    const t = i * L * 0.35;
    colliders.push({ x: x + dx * t, z: z + dz * t, y, top: y + 0.6, r: 0.6, kind: 'log', id: id + '_' + i });
  }
}

// ---------- чанк ----------
function buildTerrain(cx, cz) {
  const N = RES + 1;
  const ox = cx * CHUNK, oz = cz * CHUNK;
  const H = new Float32Array((N + 2) * (N + 2));
  for (let j = -1; j <= N; j++)
    for (let i = -1; i <= N; i++) H[(j + 1) * (N + 2) + (i + 1)] = height(ox + i * CELL, oz + j * CELL);
  const pos = new Float32Array(N * N * 3), nor = new Float32Array(N * N * 3);
  const hv = (i, j) => H[(j + 1) * (N + 2) + (i + 1)];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = (j * N + i) * 3;
      pos[k] = i * CELL; pos[k + 1] = hv(i, j); pos[k + 2] = j * CELL;
      const nx = hv(i - 1, j) - hv(i + 1, j), nz = hv(i, j - 1) - hv(i, j + 1), ny = 2 * CELL;
      const l = Math.hypot(nx, ny, nz);
      nor[k] = nx / l; nor[k + 1] = ny / l; nor[k + 2] = nz / l;
    }
  }
  const idx = [];
  for (let j = 0; j < RES; j++) {
    for (let i = 0; i < RES; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      idx.push(a, d, b, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, snowMaterial);
  mesh.position.set(ox, 0, oz);
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.radius = 3;
    this.objMat = makeObjectMaterial();
    this.shardGeo = new THREE.OctahedronGeometry(0.45, 0);
    this.collected = new Set();
    this.queue = [];
  }

  key(cx, cz) { return cx + ',' + cz; }

  update(px, pz, budget = 2) {
    const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);
    const want = [];
    for (let dz = -this.radius; dz <= this.radius; dz++)
      for (let dx = -this.radius; dx <= this.radius; dx++) {
        if (dx * dx + dz * dz > (this.radius + 0.5) ** 2) continue;
        const k = this.key(ccx + dx, ccz + dz);
        if (!this.chunks.has(k)) want.push([ccx + dx, ccz + dz, dx * dx + dz * dz]);
      }
    want.sort((a, b) => a[2] - b[2]);
    for (let i = 0; i < Math.min(budget, want.length); i++) this.generate(want[i][0], want[i][1]);
    for (const [k, ch] of this.chunks) {
      const dx = ch.cx - ccx, dz = ch.cz - ccz;
      if (dx * dx + dz * dz > (this.radius + 1.6) ** 2) this.dispose(k, ch);
    }
    return want.length;
  }

  generate(cx, cz) {
    const group = new THREE.Group();
    const terrain = buildTerrain(cx, cz);
    group.add(terrain);
    const r = mulberry32(hash2i(cx, cz, 4242));
    const b = new GeoBuilder();
    const colliders = [], gates = [], shards = [];
    const ox = cx * CHUNK, oz = cz * CHUNK;

    // трамплины, чьи центры в этом чанке — флажки по бокам
    const kickers = [];
    for (let kx = Math.floor(ox / KICK_CELL) - 1; kx <= Math.floor((ox + CHUNK) / KICK_CELL) + 1; kx++)
      for (let kz = Math.floor(oz / KICK_CELL) - 1; kz <= Math.floor((oz + CHUNK) / KICK_CELL) + 1; kz++) {
        const k = kickerAt(kx, kz);
        if (!k) continue;
        kickers.push(k);
        if (k.x < ox || k.x >= ox + CHUNK || k.z < oz || k.z >= oz + CHUNK) continue;
        const c = Math.cos(k.yaw), s = Math.sin(k.yaw);
        for (const side of [-1, 1]) {
          const fx = k.x + c * side * (k.width + 1.2), fz = k.z - s * side * (k.width + 1.2);
          const fy = height(fx, fz);
          _m.compose(_p.set(fx, fy - 0.2, fz), _q.identity(), _s.set(1, 2.2, 1));
          b.add(SHAPES.pole, _m, C(0.95, 0.95, 0.95), 0, 0);
          _m.compose(_p.set(fx, fy + 1.75, fz), _q.setFromAxisAngle(UP, k.yaw + Math.PI), _s.set(1, 1, 1));
          b.add(SHAPES.flag, _m, FLAG, 0, 0);
        }
      }
    const nearKicker = (x, z) => kickers.some((k) => Math.hypot(x - k.x, z - k.z) < k.width + 12);

    // лес
    const N = 70;
    for (let i = 0; i < N; i++) {
      const x = ox + r() * CHUNK, z = oz + r() * CHUNK;
      if (Math.hypot(x, z) < 30) continue;
      const forest = smoothstep(-0.15, 0.45, noise2(x * 0.0085, z * 0.0085, 99)) * 0.85 + 0.07;
      const roll = r();
      if (roll > forest) continue;
      if (nearKicker(x, z)) continue;
      const y = height(x, z);
      const biome = noise2(x * 0.004 + 50, z * 0.004, 7);
      const id = `t${cx}_${cz}_${i}`;
      if (biome > 0.25 && r() < 0.85) pineTree(b, x, y, z, r, colliders, id);
      else fluffyTree(b, x, y, z, r, CANOPY[Math.floor(((biome + 1) * 2.3 + r() * 1.2)) % 4], colliders, id);
    }
    // камни и бревна
    const nr = Math.floor(r() * 5);
    for (let i = 0; i < nr; i++) {
      const x = ox + r() * CHUNK, z = oz + r() * CHUNK;
      if (Math.hypot(x, z) < 30 || nearKicker(x, z)) continue;
      const y = height(x, z);
      if (r() < 0.75) rock(b, x, y, z, r, colliders, `r${cx}_${cz}_${i}`);
      else log(b, x, y, z, r, colliders, `l${cx}_${cz}_${i}`);
    }
    // каменные ворота
    if (r() < 0.22) {
      const x = ox + 10 + r() * (CHUNK - 20), z = oz + 10 + r() * (CHUNK - 20);
      if (Math.hypot(x, z) > 40 && !nearKicker(x, z)) {
        const yaw = (r() - 0.5) * 0.6;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const gap = 2.2 + r();
        const pts = [];
        for (const side of [-1, 1]) {
          const gx = x + c * side * gap, gz = z - s * side * gap;
          const gy = height(gx, gz);
          const Hh = 4 + r() * 2.5;
          _m.compose(_p.set(gx, gy - 0.5, gz), _q.setFromEuler(new THREE.Euler(0, yaw, side * -0.12)), _s.set(0.7, Hh, 1.6));
          b.add(SHAPES.slab, _m, ROCK, 1, 2, 0.2, r);
          colliders.push({ x: gx, z: gz, y: gy, top: gy + Hh, r: 0.75, kind: 'rock', id: `g${cx}_${cz}_${side}` });
          pts.push([gx, gz]);
        }
        gates.push({ ax: pts[0][0], az: pts[0][1], bx: pts[1][0], bz: pts[1][1], id: `gate${cx}_${cz}` });
      }
    }
    // кристаллы
    const ns = r() < 0.7 ? 1 + Math.floor(r() * 2) : 0;
    for (let i = 0; i < ns; i++) {
      const id = `s${cx}_${cz}_${i}`;
      const x = ox + r() * CHUNK, z = oz + r() * CHUNK;
      if (this.collected.has(id)) continue;
      const m = new THREE.Mesh(this.shardGeo, shardMaterial);
      m.position.set(x, height(x, z) + 1.4, z);
      m.userData = { id, baseY: m.position.y };
      group.add(m);
      shards.push(m);
    }

    if (b.pos.length) {
      const mesh = new THREE.Mesh(b.build(), this.objMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.scene.add(group);
    this.chunks.set(this.key(cx, cz), { cx, cz, group, colliders, gates, shards });
  }

  dispose(k, ch) {
    this.scene.remove(ch.group);
    ch.group.traverse((o) => { if (o.isMesh && o.geometry !== this.shardGeo) o.geometry.dispose(); });
    this.chunks.delete(k);
  }

  // объекты в соседних чанках
  nearby(px, pz) {
    const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);
    const out = { colliders: [], gates: [], shards: [] };
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const ch = this.chunks.get(this.key(ccx + dx, ccz + dz));
        if (!ch) continue;
        out.colliders.push(...ch.colliders);
        out.gates.push(...ch.gates);
        out.shards.push(...ch.shards);
      }
    return out;
  }

  collectShard(mesh) {
    this.collected.add(mesh.userData.id);
    mesh.parent && mesh.parent.remove(mesh);
    for (const ch of this.chunks.values()) {
      const i = ch.shards.indexOf(mesh);
      if (i >= 0) ch.shards.splice(i, 1);
    }
  }

  animate(t) {
    for (const ch of this.chunks.values())
      for (const s of ch.shards) {
        s.rotation.y = t * 1.5;
        s.position.y = s.userData.baseY + Math.sin(t * 2 + s.position.x) * 0.25;
      }
  }
}
