import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeNoise2D, smoothstep } from './noise.js';

const S = CONFIG.MAP_SIZE;
const HALF = S / 2;
const H = CONFIG.PEAK_HEIGHT;

const nWarp = makeNoise2D(CONFIG.SEED + 1);
const nBig = makeNoise2D(CONFIG.SEED + 2);
const nRad = makeNoise2D(CONFIG.SEED + 3);
const nPil = makeNoise2D(CONFIG.SEED + 4);
const nFar = makeNoise2D(CONFIG.SEED + 5);
const nBump = makeNoise2D(CONFIG.SEED + 6);

// Вершина в северной части карты, главный склон смотрит на юг (+Z).
export const PEAK_UV = { u: 0.04, v: -0.62 };

// Главный гребень массива (с запада на восток) с высотой каждой точки (доля от H).
const CREST = [
  [-1.25, -0.5, 0.42], [-0.75, -0.7, 0.66], [-0.38, -0.6, 0.74], [0.04, -0.62, 1.0],
  [0.42, -0.74, 0.8], [0.78, -0.64, 0.66], [1.25, -0.48, 0.42],
];

// Отроги, спускающиеся от гребня на юг; между ними — цирки и кулуары.
const RIDGES = [
  { a: [0.04, -0.62], b: [-0.62, 0.62], h: 70, w: 0.075 },
  { a: [0.04, -0.62], b: [0.72, 0.5], h: 64, w: 0.07 },
  { a: [-0.38, -0.6], b: [-0.95, 0.1], h: 46, w: 0.065 },
  { a: [0.42, -0.74], b: [1.0, -0.1], h: 40, w: 0.06 },
  { a: [0.02, -0.4], b: [0.08, 0.35], h: 26, w: 0.055 },
];

function crestInfo(u, v) {
  let best = 1e9, bh = 0, bt = 0;
  for (let i = 0; i < CREST.length - 1; i++) {
    const a = CREST[i], b = CREST[i + 1];
    const [d, t] = segDist(u, v, a[0], a[1], b[0], b[1]);
    if (d < best) { best = d; bt = t; bh = a[2] + (b[2] - a[2]) * t; }
  }
  return [best, bh];
}

function fbm(n, x, z, oct) {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { sum += n(x * f, z * f) * amp; f *= 2.03; amp *= 0.5; }
  return sum;
}

function ridged(n, x, z, oct) {
  let sum = 0, amp = 0.55, f = 1, prev = 1;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(n(x * f, z * f));
    v *= v;
    sum += v * amp * prev;
    prev = v;
    f *= 2.1; amp *= 0.5;
  }
  return sum;
}

function segDist(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  let t = ((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + abx * t), dz = pz - (az + abz * t);
  return [Math.sqrt(dx * dx + dz * dz), t];
}

// Высота поверхности в мировых координатах (метры).
export function heightAt(x, z) {
  const u = x / HALF, v = z / HALF;

  // искажение, чтобы форма горы была неровной
  const wu = u + nWarp(u * 0.8 + 3.1, v * 0.8) * 0.13;
  const wv = v + nWarp(u * 0.8 - 7.3, v * 0.8 + 2.2) * 0.13;

  let dx = wu - PEAK_UV.u, dz = wv - PEAK_UV.v;
  const dzs = dz > 0 ? dz / 1.8 : dz / 0.85;
  const dxs = dx / 1.1;
  const r = Math.sqrt(dxs * dxs + dzs * dzs);

  // основной массив: гребень с вогнутым южным склоном и крутой северной стеной
  const [cd, chRaw] = crestInfo(wu, wv);
  const ch = chRaw * (0.94 + 0.06 * nBig(wu * 3.0, 7.7));
  const crestV = wv; // знак: южнее гребня — главный склон
  let south = true;
  {
    // ближайшая точка гребня по u — для определения стороны
    let cv = CREST[0][1];
    for (let i = 0; i < CREST.length - 1; i++) {
      const a = CREST[i], b = CREST[i + 1];
      if (wu >= a[0] && wu <= b[0]) { cv = a[1] + (b[1] - a[1]) * (wu - a[0]) / (b[0] - a[0]); break; }
      if (wu > b[0]) cv = b[1];
    }
    south = crestV > cv;
  }
  const prof = south ? Math.exp(-Math.pow(cd / 0.92, 1.2) * 1.7) : Math.exp(-Math.pow(cd / 0.4, 1.1) * 1.7);
  let h = H * ch * prof;
  // остроконечная вершина над гребнем
  h += H * 0.16 * Math.exp(-Math.pow(r / 0.17, 1.15));
  const massif = Math.exp(-r * 1.2);

  // хребты
  for (let i = 0; i < RIDGES.length; i++) {
    const R = RIDGES[i];
    const [d, t] = segDist(wu, wv, R.a[0], R.a[1], R.b[0], R.b[1]);
    const k = d / R.w;
    h += R.h * Math.exp(-k * k) * (1 - 0.55 * t);
  }

  // крупные холмы и впадины
  h += fbm(nBig, u * 1.6 + 10, v * 1.6, 3) * (34 + 30 * massif);

  // кулуары и гребешки вдоль линии падения (радиально от вершины)
  const theta = Math.atan2(dx, dz);
  const backFade = smoothstep(-0.2, 0.08, dz);
  const rad = ridged(nRad, theta * 3.0, r * 3.0, 3);
  h += (rad - 0.42) * 40 * backFade * smoothstep(0.05, 0.3, r) * (0.45 + massif) * (south ? 1 : 0.4);

  // мягкие снежные волны и «подушки»
  h += fbm(nPil, x / 130, z / 130, 3) * 6.0;
  h += nBump(x / 34, z / 34) * 0.8;

  // за краем карты склоны уходят вниз, в море облаков
  const au = Math.abs(u), av = Math.abs(v);
  const edge = Math.pow(au * au * au * au + av * av * av * av, 0.25) + nWarp(u * 1.7 + 30, v * 1.7) * 0.12;
  h -= 470 * smoothstep(1.0, 1.75, edge);

  // далёкие хребты на горизонте
  const dist = Math.sqrt(u * u + v * v);
  if (dist > 2.4) {
    const fr = ridged(nFar, u * 0.22 + 4, v * 0.22 - 2, 3);
    const big = nFar(u * 0.09 + 40, v * 0.09) * 0.5 + 0.5;
    h += (fr * (800 + 1300 * big) - 150) * smoothstep(3.0, 5.2, dist);
  }
  return h;
}

export function normalAt(x, z, out = new THREE.Vector3(), e = 1.5) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return out.set(-hx, 2 * e, -hz).normalize();
}

export function insideMap(x, z, margin = 0) {
  return Math.abs(x) < HALF - margin && Math.abs(z) < HALF - margin;
}

// ---------------------------------------------------------------------------
// Сетка высот карты. Хранит высоты, нормали и AO для построения меша и
// для «штампов» (лунки у ёлок, затенение у стволов).
export class TerrainGrid {
  constructor(segments) {
    this.N = segments;
    this.step = S / segments;
    const n1 = segments + 1;
    this.heights = new Float32Array(n1 * n1);
    this.ao = new Float32Array(n1 * n1).fill(1);
    for (let j = 0; j <= segments; j++) {
      const z = -HALF + j * this.step;
      for (let i = 0; i <= segments; i++) {
        this.heights[j * n1 + i] = heightAt(-HALF + i * this.step, z);
      }
    }
  }

  index(i, j) { return j * (this.N + 1) + i; }

  // затенение и «лунка» вокруг объекта
  stamp(x, z, radius, aoStrength, dent = 0) {
    const n1 = this.N + 1, st = this.step;
    const i0 = Math.max(0, Math.floor((x - radius + HALF) / st));
    const i1 = Math.min(this.N, Math.ceil((x + radius + HALF) / st));
    const j0 = Math.max(0, Math.floor((z - radius + HALF) / st));
    const j1 = Math.min(this.N, Math.ceil((z + radius + HALF) / st));
    for (let j = j0; j <= j1; j++) {
      const pz = -HALF + j * st;
      for (let i = i0; i <= i1; i++) {
        const px = -HALF + i * st;
        const d = Math.hypot(px - x, pz - z) / radius;
        if (d >= 1) continue;
        const f = 1 - d * d;
        const k = j * n1 + i;
        this.ao[k] *= 1 - aoStrength * f * f;
        if (dent) this.heights[k] -= dent * f * f;
      }
    }
  }

  // затенение во впадинах по кривизне
  computeCavityAO() {
    const N = this.N, n1 = N + 1, hgt = this.heights;
    const rad = Math.max(1, Math.round(10 / this.step));
    const tmp = new Float32Array(hgt.length);
    const blur = new Float32Array(hgt.length);
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        let s = 0, c = 0;
        for (let k = -rad; k <= rad; k++) {
          const ii = Math.min(N, Math.max(0, i + k));
          s += hgt[j * n1 + ii]; c++;
        }
        tmp[j * n1 + i] = s / c;
      }
    }
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        let s = 0, c = 0;
        for (let k = -rad; k <= rad; k++) {
          const jj = Math.min(N, Math.max(0, j + k));
          s += tmp[jj * n1 + i]; c++;
        }
        blur[j * n1 + i] = s / c;
      }
    }
    for (let k = 0; k < hgt.length; k++) {
      const cav = hgt[k] - blur[k];
      this.ao[k] *= Math.min(1.06, Math.max(0.72, 1 + cav * 0.045));
    }
  }

  buildChunks(material, chunks = 8) {
    const N = this.N, n1 = N + 1, st = this.step, hgt = this.heights;
    const per = N / chunks;
    const group = new THREE.Group();
    group.name = 'terrain';
    const nrm = new THREE.Vector3();
    const rockNoise = makeNoise2D(CONFIG.SEED + 40);

    for (let cj = 0; cj < chunks; cj++) {
      for (let ci = 0; ci < chunks; ci++) {
        const vc = (per + 1) * (per + 1);
        const pos = new Float32Array(vc * 3);
        const nor = new Float32Array(vc * 3);
        const ter = new Float32Array(vc * 3);
        let p = 0;
        for (let j = 0; j <= per; j++) {
          const gj = cj * per + j;
          for (let i = 0; i <= per; i++) {
            const gi = ci * per + i;
            const k = gj * n1 + gi;
            const x = -HALF + gi * st, z = -HALF + gj * st;
            pos[p * 3] = x; pos[p * 3 + 1] = hgt[k]; pos[p * 3 + 2] = z;
            const hl = hgt[gj * n1 + Math.max(0, gi - 1)], hr = hgt[gj * n1 + Math.min(N, gi + 1)];
            const hd = hgt[Math.max(0, gj - 1) * n1 + gi], hu = hgt[Math.min(N, gj + 1) * n1 + gi];
            nrm.set(hl - hr, 2 * st, hd - hu).normalize();
            nor[p * 3] = nrm.x; nor[p * 3 + 1] = nrm.y; nor[p * 3 + 2] = nrm.z;
            const rn = rockNoise(x / 30, z / 30) * 0.5 + 0.5;
            const rock = smoothstep(0.7, 0.52, nrm.y + (rn - 0.5) * 0.12);
            ter[p * 3] = this.ao[k];
            ter[p * 3 + 1] = rock;
            ter[p * 3 + 2] = rn;
            p++;
          }
        }
        const idx = new Uint32Array(per * per * 6);
        let q = 0;
        for (let j = 0; j < per; j++) {
          for (let i = 0; i < per; i++) {
            const a = j * (per + 1) + i, b = a + 1, c = a + per + 1, d = c + 1;
            idx[q++] = a; idx[q++] = c; idx[q++] = b;
            idx[q++] = b; idx[q++] = c; idx[q++] = d;
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('aTerr', new THREE.BufferAttribute(ter, 3));
        g.setIndex(new THREE.BufferAttribute(idx, 1));
        g.computeBoundingSphere();
        g.computeBoundingBox();
        const m = new THREE.Mesh(g, material);
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
      }
    }
    return group;
  }
}

// Дальний ландшафт вокруг карты (без объектов, растворяется в дымке).
export function buildFarTerrain(material) {
  const SIZE = S * 7, SEG = 210;
  const st = SIZE / SEG;
  const pos = [], nor = [], ter = [], idx = [];
  const n = new THREE.Vector3();
  const inner = HALF - 4;
  for (let j = 0; j <= SEG; j++) {
    for (let i = 0; i <= SEG; i++) {
      const x = -SIZE / 2 + i * st, z = -SIZE / 2 + j * st;
      let h = heightAt(x, z);
      const cheb = Math.max(Math.abs(x), Math.abs(z));
      if (cheb < HALF + st) h -= 6 * (1 - Math.max(0, cheb - HALF) / st);
      pos.push(x, h, z);
      normalAt(x, z, n, st * 0.5);
      nor.push(n.x, n.y, n.z);
      ter.push(1, smoothstep(0.62, 0.4, n.y), 0.5);
    }
  }
  for (let j = 0; j < SEG; j++) {
    for (let i = 0; i < SEG; i++) {
      const x0 = -SIZE / 2 + i * st, z0 = -SIZE / 2 + j * st;
      const x1 = x0 + st, z1 = z0 + st;
      if (x0 > -inner && x1 < inner && z0 > -inner && z1 < inner) continue;
      const a = j * (SEG + 1) + i, b = a + 1, c = a + SEG + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aTerr', new THREE.Float32BufferAttribute(ter, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  m.name = 'farTerrain';
  return m;
}

export const MAP_HALF = HALF;
