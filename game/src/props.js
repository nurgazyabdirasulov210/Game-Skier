import * as THREE from '../vendor/three.module.js';
import { makeMaterial, mergeParts, M4, rng, jitter } from './materials.js';
import { heightAt, biomeAt, forestAt, cliffMask, kickerInfo, hash01, KICK_CELL, POWDER } from './world.js';

export const CHUNK = 48;

// ------------------------------------------------------------ геометрия деревьев

function jaggedCone(r, h, seg, seed) {
  const g = new THREE.ConeGeometry(r, h, seg, 1, false);
  const P = g.attributes.position, R = rng(seed);
  for (let i = 0; i < P.count; i++) {
    const y = P.getY(i);
    if (y < -h / 2 + 1e-3) {
      const x = P.getX(i), z = P.getZ(i);
      const a = Math.atan2(z, x);
      const k = (Math.round((a / (Math.PI * 2)) * seg * 2) % 2 === 0 ? 1.0 : 0.72) * (0.9 + R() * 0.2);
      P.setXYZ(i, x * k, y - (k < 0.9 ? -0.12 : 0.08), z * k);
    }
  }
  return g;
}

function spruceGeo(seed) {
  const R = rng(seed);
  const parts = [];
  parts.push({ geo: new THREE.CylinderGeometry(0.1, 0.24, 2.6, 6), matrix: M4(0, 1.3, 0), color: '#3a2a28' });
  const T = 6;
  for (let k = 0; k < T; k++) {
    const f = k / T;
    const r = 2.0 * Math.pow(1 - f, 0.95) + 0.3;
    const h = 1.75 - f * 0.4;
    const y = 1.3 + k * 0.98 + h / 2;
    const c = new THREE.Color('#163c3e').lerp(new THREE.Color('#2a5e52'), f * 0.8 + R() * 0.15);
    parts.push({ geo: jaggedCone(r, h, 9, seed * 13 + k), matrix: M4((R() - 0.5) * 0.15, y, (R() - 0.5) * 0.15, (R() - 0.5) * 0.1, R() * 6, (R() - 0.5) * 0.1), color: c });
  }
  parts.push({ geo: new THREE.ConeGeometry(0.32, 1.3, 6), matrix: M4(0, 1.3 + T * 0.98 + 0.5, 0), color: '#2a5e52' });
  return mergeParts(parts);
}

function pineGeo(seed) {
  const R = rng(seed);
  const parts = [];
  const H = 9 + R() * 2;
  parts.push({
    geo: new THREE.CylinderGeometry(0.13, 0.27, H, 7, 6), matrix: M4(0, H / 2, 0),
    color: (p) => new THREE.Color('#3b2620').lerp(new THREE.Color('#b8643a'), Math.min(1, Math.max(0, (p.y - 1.5) / (H * 0.7)))),
  });
  const blobs = 7 + Math.floor(R() * 4);
  for (let i = 0; i < blobs; i++) {
    const a = R() * Math.PI * 2, d = 0.5 + R() * 1.9;
    const y = H - 4.8 + (i / blobs) * 5.2 + R() * 0.6;
    const s = (1.25 - (i / blobs) * 0.5) * (0.85 + R() * 0.4);
    const g = jitter(new THREE.IcosahedronGeometry(1, 1), 0.22, seed * 7 + i, 1);
    parts.push({ sphere: true, geo: g, matrix: M4(Math.cos(a) * d, y, Math.sin(a) * d, R(), R() * 6, R(), s * 1.25, s * 0.62, s * 1.25), color: new THREE.Color('#1c3d36').lerp(new THREE.Color('#2f5a46'), R() * 0.7) });
    if (d > 0.8) parts.push({ geo: new THREE.CylinderGeometry(0.04, 0.07, d, 4), matrix: M4(Math.cos(a) * d * 0.5, y - 0.4, Math.sin(a) * d * 0.5, 0, -a, Math.PI / 2 - 0.35), color: '#6a3a26' });
  }
  return mergeParts(parts);
}

function birchGeo(seed) {
  const R = rng(seed);
  const parts = [];
  const H = 7 + R() * 2.5;
  const lean = (R() - 0.5) * 0.12;
  parts.push({
    geo: new THREE.CylinderGeometry(0.08, 0.17, H, 6, 12), matrix: M4(0, H / 2, 0, lean, 0, lean * 0.5),
    color: (p) => {
      const b = Math.floor(p.y * 3.1 + Math.floor(Math.atan2(p.z, p.x) * 1.3) * 0.37);
      const dark = hash01(b, seed) > 0.72 ? 1 : 0;
      return dark ? '#24222c' : '#e8e4dc';
    },
  });
  const n = 7 + Math.floor(R() * 4);
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, y = H * (0.45 + R() * 0.5), L = 1.0 + R() * 1.6;
    parts.push({ geo: new THREE.CylinderGeometry(0.02, 0.05, L, 4), matrix: M4(Math.cos(a) * L * 0.45, y + L * 0.35, Math.sin(a) * L * 0.45, 0, -a, Math.PI / 2 - 0.75 - R() * 0.3), color: '#5a4038' });
  }
  // редкие сухие серёжки в кроне
  for (let i = 0; i < 0; i++) {
    const a = R() * Math.PI * 2, d = 0.4 + R() * 0.9;
    const g = jitter(new THREE.IcosahedronGeometry(1, 1), 0.3, seed * 3 + i);
    parts.push({ sphere: true, geo: g, matrix: M4(Math.cos(a) * d, H * (0.7 + R() * 0.3), Math.sin(a) * d, R(), R(), R(), 0.9 + R() * 0.5, 0.7, 0.9 + R() * 0.5), color: new THREE.Color('#5b3f4f').lerp(new THREE.Color('#7a5560'), R()) });
  }
  return mergeParts(parts);
}

function snagGeo(seed) {
  const R = rng(seed);
  const H = 4 + R() * 3;
  const parts = [{ geo: new THREE.CylinderGeometry(0.09, 0.22, H, 6), matrix: M4(0, H / 2, 0, (R() - 0.5) * 0.15, 0, (R() - 0.5) * 0.15), color: '#5d5552' }];
  for (let i = 0; i < 3; i++) {
    const a = R() * 6.28, y = H * (0.4 + R() * 0.5), L = 0.6 + R();
    parts.push({ geo: new THREE.CylinderGeometry(0.03, 0.06, L, 4), matrix: M4(Math.cos(a) * L * 0.4, y, Math.sin(a) * L * 0.4, 0, -a, Math.PI / 2 - 0.5), color: '#4a4442' });
  }
  return mergeParts(parts);
}

function bushGeo(seed) {
  const R = rng(seed);
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const g = jitter(new THREE.IcosahedronGeometry(1, 1), 0.3, seed + i);
    parts.push({ sphere: true, geo: g, matrix: M4((R() - 0.5) * 1.4, 0.5 + R() * 0.4, (R() - 0.5) * 1.4, 0, R() * 6, 0, 0.7 + R() * 0.4, 0.55, 0.7 + R() * 0.4), color: new THREE.Color('#2a3e34').lerp(new THREE.Color('#4a3a36'), R()) });
  }
  return mergeParts(parts);
}

function rockGeo(seed) {
  const g = jitter(new THREE.IcosahedronGeometry(1, 1), 0.5, seed, 0.7);
  const R = rng(seed + 9);
  return mergeParts([{ geo: g, color: () => new THREE.Color('#2d3046').lerp(new THREE.Color('#4a4c64'), R()) }]);
}

function logGeo() {
  const parts = [
    { geo: new THREE.CylinderGeometry(0.34, 0.38, 1, 8, 1, true), matrix: M4(0, 0, 0, Math.PI / 2, 0, 0), color: (p) => (Math.sin(p.z * 9 + Math.atan2(p.y, p.x) * 3) > 0.6 ? '#3a2620' : '#5a3a2c') },
    { geo: new THREE.CircleGeometry(0.34, 8), matrix: M4(0, 0, 0.5, 0, 0, 0), color: '#c2965e' },
    { geo: new THREE.CircleGeometry(0.38, 8), matrix: M4(0, 0, -0.5, 0, Math.PI, 0), color: '#c2965e' },
  ];
  return mergeParts(parts);
}

function archGeo(seed) {
  const R = rng(seed);
  const parts = [];
  const stone = () => new THREE.Color('#3a3d54').lerp(new THREE.Color('#5c5e74'), R());
  // две опоры из нагромождения плит, наклонённые внутрь
  for (const side of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const g = jitter(new THREE.BoxGeometry(1.6 - k * 0.12, 1.7, 1.5 - k * 0.1, 2, 2, 2), 0.35, seed * 5 + k + (side > 0 ? 50 : 0));
      parts.push({ geo: g, matrix: M4(side * (3.1 - k * 0.32), 0.85 + k * 1.55, (R() - 0.5) * 0.3, (R() - 0.5) * 0.2, R() * 0.4, side * -0.2), color: stone });
    }
  }
  const lintel = jitter(new THREE.BoxGeometry(5.6, 1.3, 1.7, 4, 2, 2), 0.4, seed + 77);
  parts.push({ geo: lintel, matrix: M4(0, 6.9, 0, 0, 0, (R() - 0.5) * 0.12), color: stone });
  return mergeParts(parts);
}

// ------------------------------------------------------------ менеджер

const TYPES = ['spruce', 'pine', 'birch', 'snag', 'bush', 'rock', 'log', 'arch'];
const VARIANTS = { spruce: 3, pine: 3, birch: 3, snag: 2, bush: 2, rock: 3, log: 1, arch: 2 };

export class Props {
  constructor(scene, shadows, { radius = 230 } = {}) {
    this.scene = scene; this.shadows = shadows;
    this.radius = radius;
    this.chunks = new Map();
    this.meshes = {};
    const treeMat = makeMaterial({ snow: 1, wind: true, wrap: 0.45, rim: 0.35 });
    const rockMat = makeMaterial({ snow: 1, wrap: 0.25, rim: 0.15 });
    const logMat = makeMaterial({ snow: 0.9, wrap: 0.3, rim: 0.2 });
    const caps = { spruce: 2600, pine: 1400, birch: 1400, snag: 500, bush: 900, rock: 900, log: 220, arch: 40 };
    const builders = { spruce: spruceGeo, pine: pineGeo, birch: birchGeo, snag: snagGeo, bush: bushGeo, rock: rockGeo, log: logGeo, arch: archGeo };
    for (const t of TYPES) {
      this.meshes[t] = [];
      const mat = t === 'rock' || t === 'arch' ? rockMat : t === 'log' ? logMat : treeMat;
      for (let v = 0; v < VARIANTS[t]; v++) {
        const geo = builders[t](101 + v * 37);
        const m = new THREE.InstancedMesh(geo, mat, Math.ceil(caps[t] / VARIANTS[t]) + 8);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.count = 0; m.frustumCulled = false;
        m.userData.depthMat = mat.userData.depthMat;
        m.setColorAt(0, new THREE.Color(1, 1, 1));
        scene.add(m);
        shadows.add(m, t === 'bush' || t === 'log' ? 1 : 3);
        this.meshes[t].push(m);
      }
    }
    this.center = { cx: 1e9, cz: 1e9 };
    this.dirty = true;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this._c = new THREE.Color();
    this.spawnClear = { x: 0, z: 0, r: 0 };
  }

  setSpawnClear(x, z, r) { this.spawnClear = { x, z, r }; this.chunks.clear(); this.center.cx = 1e9; this.queue = []; }

  genChunk(cx, cz) {
    const items = [];
    const R = rng((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const kick = kickerInfo(Math.floor((x0 + 1) / KICK_CELL), Math.floor((z0 + 1) / KICK_CELL));
    const sc = this.spawnClear;
    const blocked = (x, z, r) => {
      if (kick && Math.hypot(x - kick.x, z - kick.z) < kick.L + 6 + r) return true;
      const dx = x - sc.x, dz = z - sc.z;
      if (sc.r > 0 && Math.abs(dx) < sc.r * 0.5 + r && dz > -sc.r * 0.3 && dz < sc.r * 1.6) return true;
      for (const it of items) if (Math.hypot(it.x - x, it.z - z) < it.r + r + 0.6) return true;
      return false;
    };
    const slope = (x, z) => {
      const hx = heightAt(x + 0.8, z) - heightAt(x - 0.8, z), hz = heightAt(x, z + 0.8) - heightAt(x, z - 0.8);
      return Math.hypot(hx, hz) / 1.6;
    };
    const cell = 4;
    for (let i = 0; i < CHUNK / cell; i++) for (let j = 0; j < CHUNK / cell; j++) {
      const x = x0 + i * cell + 0.5 + R() * (cell - 1), z = z0 + j * cell + 0.5 + R() * (cell - 1);
      const b = biomeAt(x, z);
      const f = forestAt(x, z);
      const glade = smooth(-0.12, 0.22, f + (0.45 - b) * 0.5);
      let dens = (0.62 - 0.58 * smooth(0.15, 0.85, b)) * glade;
      dens += 0.025; // одиночные деревья везде
      const rr = R();
      if (rr > dens) continue;
      const s = slope(x, z);
      if (s > 0.95) continue;
      let type;
      const tr = R();
      if (b < 0.3) type = tr < 0.78 ? 'spruce' : tr < 0.9 ? 'pine' : tr < 0.96 ? 'snag' : 'bush';
      else if (b < 0.6) type = tr < 0.35 ? 'pine' : tr < 0.68 ? 'birch' : tr < 0.88 ? 'spruce' : tr < 0.94 ? 'bush' : 'snag';
      else type = tr < 0.3 ? 'spruce' : tr < 0.5 ? 'snag' : tr < 0.75 ? 'bush' : 'pine';
      const scale = type === 'bush' ? 0.7 + R() * 0.6 : 0.75 + R() * 0.65;
      const rad = type === 'bush' ? 0.6 * scale : (type === 'spruce' ? 0.3 : 0.24) * scale;
      if (blocked(x, z, type === 'bush' ? rad : 0.8)) continue;
      const y = heightAt(x, z);
      const h = type === 'spruce' ? 8 * scale : type === 'pine' ? 11 * scale : type === 'birch' ? 9 * scale : type === 'bush' ? 1.0 * scale : 6 * scale;
      items.push({ type, v: Math.floor(R() * VARIANTS[type]), x, y: y - 0.25, z, ry: R() * 6.28, s: scale, r: rad, h, solid: type !== 'bush' });
    }
    // камни
    const bc = biomeAt(x0 + 24, z0 + 24);
    const cm = cliffMask(x0 + 24, z0 + 24);
    const nRocks = Math.floor((Math.max(0, bc - 0.35) * 9 + cm * 3) * (0.5 + R()));
    for (let k = 0; k < nRocks; k++) {
      const x = x0 + R() * CHUNK, z = z0 + R() * CHUNK;
      const s = 0.6 + Math.pow(R(), 2) * 2.6;
      if (blocked(x, z, s)) continue;
      const y = heightAt(x, z);
      items.push({ type: 'rock', v: Math.floor(R() * 3), x, y: y + POWDER - s * 0.22, z, ry: R() * 6.28, s, r: s * 0.95, h: POWDER + s * 0.5, solid: true });
    }
    // брёвна (можно скользить)
    if (bc < 0.7) {
      for (let k = 0; k < 2; k++) {
        if (R() > 0.42) continue;
        const x = x0 + 8 + R() * (CHUNK - 16), z = z0 + 8 + R() * (CHUNK - 16);
        const L = 6 + R() * 5;
        const yaw = (R() - 0.5) * 1.2;
        if (blocked(x, z, L * 0.5 + 0.5) || slope(x, z) > 0.7) continue;
        const dx = Math.sin(yaw) * L * 0.5, dz = Math.cos(yaw) * L * 0.5;
        const ya = heightAt(x - dx, z - dz) + POWDER - 0.06, yb = heightAt(x + dx, z + dz) + POWDER - 0.06;
        items.push({ type: 'log', v: 0, x, y: (ya + yb) / 2, z, ry: yaw, s: 1, L, r: 0.4, h: 0.4, solid: false,
          rail: { ax: x - dx, az: z - dz, ay: ya + 0.36, bx: x + dx, bz: z + dz, by: yb + 0.36 }, pitch: Math.atan2(ya - yb, L) });
      }
    }
    // каменные арки
    if (bc > 0.4 && hash01(cx * 5 + 3, cz * 11 + 7) < 0.16) {
      const x = x0 + 14 + R() * 20, z = z0 + 14 + R() * 20;
      if (!blocked(x, z, 5) && slope(x, z) < 0.6) {
        const yaw = (R() - 0.5) * 0.6;
        const y = Math.min(heightAt(x - 3 * Math.cos(yaw), z + 3 * Math.sin(yaw)), heightAt(x + 3 * Math.cos(yaw), z - 3 * Math.sin(yaw)));
        items.push({ type: 'arch', v: Math.floor(R() * 2), x, y: y - 0.2, z, ry: yaw, s: 1, r: 4, h: 7.5, solid: false, arch: true });
      }
    }
    return items;
  }

  // инкрементальная генерация: ближние чанки сразу, остальные — по бюджету времени
  update(px, pz, budgetMs = 4, sync = false) {
    const cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK);
    if (cx !== this.center.cx || cz !== this.center.cz || this.dirty) {
      this.center.cx = cx; this.center.cz = cz; this.dirty = false;
      const n = Math.ceil(this.radius / CHUNK);
      const need = new Set();
      this.queue = [];
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
        const d2 = (i * i + j * j) * CHUNK * CHUNK;
        if (d2 > (this.radius + CHUNK) ** 2) continue;
        const key = (cx + i) + ',' + (cz + j);
        need.add(key);
        if (!this.chunks.has(key)) this.queue.push({ key, x: cx + i, z: cz + j, d2 });
      }
      let removed = false;
      for (const k of this.chunks.keys()) if (!need.has(k)) { this.chunks.delete(k); removed = true; }
      this.queue.sort((a, b) => a.d2 - b.d2);
      if (removed) this.pending = true;
    }
    const t0 = performance.now();
    let made = 0;
    while (this.queue && this.queue.length) {
      const q = this.queue[0];
      const near = q.d2 <= 2 * CHUNK * CHUNK;
      if (!sync && !near && performance.now() - t0 > budgetMs) break;
      this.queue.shift();
      if (!this.chunks.has(q.key)) { this.chunks.set(q.key, this.genChunk(q.x, q.z)); made++; }
    }
    if (made) this.pending = true;
    if (this.pending && (!this.queue.length || made >= 3 || performance.now() - (this.lastRebuild || 0) > 400)) {
      this.rebuild();
      this.pending = false;
      this.lastRebuild = performance.now();
    }
  }

  rebuild() {
    const counts = {};
    for (const t of TYPES) { counts[t] = this.meshes[t].map(() => 0); }
    const m = this._m, q = this._q, e = this._e, s = this._s, p = this._p, c = this._c;
    for (const items of this.chunks.values()) {
      for (const it of items) {
        const list = this.meshes[it.type];
        const mesh = list[it.v % list.length];
        const idx = counts[it.type][it.v % list.length];
        if (idx >= mesh.instanceMatrix.count) continue;
        counts[it.type][it.v % list.length]++;
        if (it.type === 'log') { e.set(it.pitch, it.ry, 0, 'YXZ'); s.set(1, 1, it.L); }
        else { e.set(0, it.ry, 0); s.set(it.s, it.s, it.s); }
        q.setFromEuler(e); p.set(it.x, it.y, it.z);
        m.compose(p, q, s);
        mesh.setMatrixAt(idx, m);
        const v = hash01(Math.floor(it.x * 10), Math.floor(it.z * 10));
        c.setRGB(0.88 + v * 0.24, 0.9 + v * 0.18, 0.88 + v * 0.2);
        mesh.setColorAt(idx, c);
      }
    }
    for (const t of TYPES) this.meshes[t].forEach((mesh, i) => {
      mesh.count = counts[t][i];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }

  // объекты рядом с точкой
  near(x, z, out = []) {
    out.length = 0;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const items = this.chunks.get((cx + i) + ',' + (cz + j));
      if (items) for (const it of items) out.push(it);
    }
    return out;
  }
}

function smooth(a, b, x) { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
