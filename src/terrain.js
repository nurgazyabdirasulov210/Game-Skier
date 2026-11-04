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
export const PEAK_UV = { u: 0.04, v: -0.6 };

function fbm(n, x, z, oct) {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { sum += n(x * f, z * f) * amp; f *= 2.03; amp *= 0.5; }
  return sum;
}

// Высота поверхности в мировых координатах (метры).
// Стиль: гладкие, «надутые» формы — округлая вершина, широкие ложбины-халфпайпы
// вдоль склона, плавные валы-«роллеры» поперёк склона и мягкие снежные дюны.
// Никакого мелкого шума: всё, что меньше ~25 м, сглажено.
export function heightAt(x, z) {
  const u = x / HALF, v = z / HALF;

  const wu = u + nWarp(u * 0.7 + 3.1, v * 0.7) * 0.1;
  const wv = v + nWarp(u * 0.7 - 7.3, v * 0.7 + 2.2) * 0.1;
  const dx = wu - PEAK_UV.u, dz = wv - PEAK_UV.v;
  const dzs = dz > 0 ? dz / 1.75 : dz / 0.8;
  const dxs = dx / 1.15;
  const r = Math.sqrt(dxs * dxs + dzs * dzs);

  // купол горы: округлая вершина, длинный плавный склон
  const t = Math.min(1, r / 1.2);
  let h = H * Math.pow(1 - t * t * (3 - 2 * t), 1.25);
  const massif = 1 - smoothstep(0.0, 1.3, r);

  // широкие плечи и пологие террасы
  h += fbm(nBig, u * 1.3 + 10, v * 1.3, 3) * 42;

  // ложбины и гребни вдоль линии падения (радиально от вершины), гладкие
  const theta = Math.atan2(dx, dz);
  const slopeZone = smoothstep(0.06, 0.3, r) * smoothstep(-0.15, 0.1, dz);
  h += nRad(theta * 2.4, r * 1.3) * 17 * slopeZone * (0.5 + massif);

  // валы поперёк склона — как волны в видео
  h += nPil(theta * 7.5 + 20, r * 11.0) * 5.5 * slopeZone;
  h += nBump(theta * 13.0 - 7, r * 19.0) * 2.0 * slopeZone;

  // мягкие снежные дюны
  h += fbm(nPil, x / 75 + 50, z / 75, 2) * 3.2;

  // за краем карты — пологий спуск в дымку
  const au = Math.abs(u), av = Math.abs(v);
  const edge = Math.pow(au * au * au * au + av * av * av * av, 0.25) + nWarp(u * 1.7 + 30, v * 1.7) * 0.1;
  h -= 380 * smoothstep(1.0, 1.8, edge);

  // далёкие округлые горы, тонущие в дымке
  const dist = Math.sqrt(u * u + v * v);
  if (dist > 2.6) {
    const fr = fbm(nFar, u * 0.3 + 4, v * 0.3 - 2, 3) * 0.5 + 0.5;
    h += (fr * fr * 650 - 60) * smoothstep(3.0, 5.5, dist);
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
