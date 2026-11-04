import * as THREE from 'three';
import { CONFIG } from './config.js';
import { mulberry32, makeNoise2D, smoothstep } from './noise.js';
import { Scatter, Occupancy } from './scatter.js';
import { PEAK_UV, heightAt } from './terrain.js';
import {
  makeBirch, makePine, makeSpruce, makeSnag, makeLog, makeStump,
  makeRock, makeCliff, makeArch, makeCloud, makeBush,
} from './geometry.js';
import { makeFoliageMaterial, makeSpruceMaterial, makeSnowyMaterial } from './materials.js';
import { makeFurTexture, makeCloudTexture, makeBirchBarkTexture } from './textures.js';

const S = CONFIG.MAP_SIZE;
const HALF = S / 2;
const H = CONFIG.PEAK_HEIGHT;

const C = (hex) => new THREE.Color(hex);
const BIRCH_ORANGE = ['#ff9b40', '#ffab4d', '#f78a35', '#ffbb58', '#ff8f3a', '#ffa244'].map(C);
const BIRCH_CREAM = ['#f4dc8a', '#efd27a', '#f7e3a2', '#e9d88e'].map(C);
const BIRCH_RED = ['#f06a3c', '#e85a36', '#f37b45'].map(C);
const PINE_CROWN = ['#d8dca4', '#cdd696', '#e6e2b4', '#bfcf8e', '#d2d9a0'].map(C);

// Билинейная выборка из сетки высот (быстрее, чем считать шум заново).
export function makeSampler(grid) {
  const N = grid.N, n1 = N + 1, st = grid.step, hgt = grid.heights;
  const sample = (x, z) => {
    const fx = Math.min(N - 1e-4, Math.max(0, (x + HALF) / st));
    const fz = Math.min(N - 1e-4, Math.max(0, (z + HALF) / st));
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const a = hgt[j * n1 + i], b = hgt[j * n1 + i + 1], c = hgt[(j + 1) * n1 + i], d = hgt[(j + 1) * n1 + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
  const normal = (x, z, out = new THREE.Vector3()) => {
    const e = st;
    return out.set(sample(x - e, z) - sample(x + e, z), 2 * e, sample(x, z - e) - sample(x, z + e)).normalize();
  };
  return { sample, normal };
}

export function buildWorld(scene, grid, quality, onProgress = () => {}) {
  const rng = mulberry32(CONFIG.SEED + 500);
  const { sample, normal } = makeSampler(grid);
  const occ = new Occupancy(16);
  const D = quality.density;
  const nForest = makeNoise2D(CONFIG.SEED + 100);
  const nGrove = makeNoise2D(CONFIG.SEED + 101);
  const nGlade = makeNoise2D(CONFIG.SEED + 102);
  const nCol = makeNoise2D(CONFIG.SEED + 103);
  const nRock = makeNoise2D(CONFIG.SEED + 104);
  const fbm = (n, x, z) => n(x, z) * 0.6 + n(x * 2.1, z * 2.1) * 0.28 + n(x * 4.3, z * 4.3) * 0.12;
  const nrm = new THREE.Vector3();
  const msaa = quality.bloom;

  // ---------- материалы и текстуры
  const furTex = makeFurTexture();
  const cloudTex = makeCloudTexture();
  const barkTex = makeBirchBarkTexture();
  const mats = {
    crown: makeFoliageMaterial(furTex, { key: 'crown', alphaToCoverage: msaa }),
    cloud: makeFoliageMaterial(cloudTex, { key: 'cloud', translucency: 0.9 }),
    spruce: makeSpruceMaterial(),
    birchBark: makeSnowyMaterial(0xffffff, { key: 'birchBark', map: barkTex, snowLo: 0.55, snowHi: 0.85, amount: 0.9 }),
    pineBark: makeSnowyMaterial(0x4a3f3a, { key: 'pineBark', snowLo: 0.5, snowHi: 0.85 }),
    snag: makeSnowyMaterial(0x6f655c, { key: 'snag', snowLo: 0.35, snowHi: 0.7 }),
    log: makeSnowyMaterial(0x58483d, { key: 'log', snowLo: 0.1, snowHi: 0.45, speckle: 0.5 }),
    rock: makeSnowyMaterial(0x2c3350, { key: 'rock', snowLo: 0.38, snowHi: 0.68, speckle: 0.8 }),
    cliff: makeSnowyMaterial(0x2a3150, { key: 'cliff', snowLo: 0.3, snowHi: 0.62, speckle: 1.0 }),
    arch: makeSnowyMaterial(0x2a3050, { key: 'arch', snowLo: 0.38, snowHi: 0.7, speckle: 1.0 }),
  };

  const scatters = [];
  const near = quality.lodNear, far = quality.lodFar;
  const mk = (name, lods, opts) => { const s = new Scatter(name, lods, opts); scatters.push(s); return s; };
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const alt = (h) => Math.min(1, Math.max(0, h / H));

  // ---------- каменные арки (через них можно пролететь/проехать)
  const arches = [];
  const archMesh = [];
  let tries = 0;
  while (arches.length < 4 && tries++ < 4000) {
    const x = (rng() - 0.5) * S * 0.8, z = (rng() - 0.5) * S * 0.8;
    const h = sample(x, z);
    const a = alt(h);
    normal(x, z, nrm);
    if (a < 0.18 || a > 0.75 || nrm.y < 0.86 || nrm.y > 0.985) continue;
    if (arches.some((p) => Math.hypot(p.x - x, p.z - z) < 380)) continue;
    const fall = Math.atan2(nrm.x, nrm.z);
    const scale = 0.95 + rng() * 0.45;
    const geo = makeArch(rng, { span: 14 + rng() * 6, height: 20 + rng() * 8 });
    const halfW = 11 * scale;
    const cx = Math.cos(fall), cz = -Math.sin(fall);
    const y = Math.min(h, sample(x + cx * halfW, z + cz * halfW), sample(x - cx * halfW, z - cz * halfW)) - 0.6;
    const m = new THREE.Mesh(geo, mats.arch);
    m.position.set(x, y, z);
    m.rotation.set(0, fall, (rng() - 0.5) * 0.06);
    m.scale.setScalar(scale);
    m.castShadow = true; m.receiveShadow = true;
    archMesh.push(m);
    arches.push({ x, z, y, fall, scale });
    occ.add(x, z, 30 * scale);
    grid.stamp(x + cx * halfW, z + cz * halfW, 7, 0.35);
    grid.stamp(x - cx * halfW, z - cz * halfW, 7, 0.35);
  }
  onProgress('Скалы и камни');

  // ---------- скальные плиты
  const cliffGeos = [0, 1, 2].map(() => makeCliff(rng));
  const cliffs = cliffGeos.map((g, i) => mk('cliff' + i, [{ parts: [{ geometry: g, material: mats.cliff }], maxDist: far * 1.4 }]));
  for (let z = -HALF + 30; z < HALF - 30; z += 55) {
    for (let x = -HALF + 30; x < HALF - 30; x += 55) {
      const px = x + (rng() - 0.5) * 45, pz = z + (rng() - 0.5) * 45;
      const h = sample(px, pz); normal(px, pz, nrm);
      const a = alt(h);
      const p = 0.85 * smoothstep(0.8, 0.6, nrm.y) + 0.3 * smoothstep(0.82, 0.97, a) + 0.08 * smoothstep(0.3, 0.6, fbm(nRock, px / 300, pz / 300));
      if (rng() > p) continue;
      const sx = 9 + rng() * 14, sy = 7 + rng() * 10, sz = 7 + rng() * 9;
      const r = Math.max(sx, sz) * 0.85;
      if (!occ.free(px, pz, r * 0.6)) continue;
      const fall = Math.atan2(nrm.x, nrm.z);
      pick(cliffs).add(px, h - sy * 0.45, pz, fall + (rng() - 0.5) * 0.6, new THREE.Vector3(sx, sy, sz), null, -0.15 - rng() * 0.2, (rng() - 0.5) * 0.2);
      occ.add(px, pz, r);
      grid.stamp(px, pz, r * 1.4, 0.35);
    }
  }

  // ---------- валуны и камни
  const rockGeos = [0, 1, 2, 3, 4].map((i) => makeRock(rng, i < 2 ? 2 : 1));
  const boulders = rockGeos.slice(0, 3).map((g, i) => mk('boulder' + i, [{ parts: [{ geometry: g, material: mats.rock }], maxDist: far }]));
  const pebbles = rockGeos.slice(2).map((g, i) => mk('rock' + i, [{ parts: [{ geometry: g, material: mats.rock }], maxDist: near * 1.1 }], { castShadow: true }));
  for (let z = -HALF + 10; z < HALF - 10; z += 22) {
    for (let x = -HALF + 10; x < HALF - 10; x += 22) {
      const px = x + (rng() - 0.5) * 20, pz = z + (rng() - 0.5) * 20;
      const h = sample(px, pz); normal(px, pz, nrm);
      const a = alt(h);
      const field = smoothstep(0.25, 0.55, fbm(nRock, px / 160 + 9, pz / 160));
      const p = (0.04 + 0.45 * smoothstep(0.86, 0.68, nrm.y) + 0.25 * smoothstep(0.8, 0.95, a) + 0.5 * field) * Math.sqrt(D);
      if (rng() > p) continue;
      const s = 2.5 + Math.pow(rng(), 2) * 6;
      if (!occ.free(px, pz, s * 0.8)) continue;
      pick(boulders).add(px, h - s * 0.3, pz, rng() * 6.28, new THREE.Vector3(s * (0.8 + rng() * 0.4), s * (0.7 + rng() * 0.5), s * (0.8 + rng() * 0.4)), null, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.4);
      occ.add(px, pz, s * 1.1);
      grid.stamp(px, pz, s * 1.8, 0.3);
    }
  }
  for (let z = -HALF + 4; z < HALF - 4; z += 9) {
    for (let x = -HALF + 4; x < HALF - 4; x += 9) {
      const px = x + (rng() - 0.5) * 8.5, pz = z + (rng() - 0.5) * 8.5;
      const h = sample(px, pz); normal(px, pz, nrm);
      const field = smoothstep(0.2, 0.55, fbm(nRock, px / 160 + 9, pz / 160));
      const p = (0.015 + 0.2 * smoothstep(0.88, 0.7, nrm.y) + 0.25 * field + 0.1 * smoothstep(0.85, 0.97, alt(h))) * D;
      if (rng() > p) continue;
      const s = 0.4 + Math.pow(rng(), 2.2) * 2.0;
      if (!occ.free(px, pz, s * 0.6)) continue;
      pick(pebbles).add(px, h - s * 0.25, pz, rng() * 6.28, new THREE.Vector3(s, s * (0.6 + rng() * 0.6), s * (0.8 + rng() * 0.4)), null, (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.5);
      occ.add(px, pz, s * 0.7);
    }
  }
  onProgress('Ельники');

  // ---------- ели
  const spruceLods = [0, 1, 2].map(() => {
    const seed = Math.floor(rng() * 1e9);
    return [0, 1, 2].map((l) => makeSpruce(mulberry32(seed), l));
  });
  const spruces = spruceLods.map((g, i) => mk('spruce' + i, [
    { parts: [{ geometry: g[0], material: mats.spruce, colored: true }], maxDist: near * 0.45 },
    { parts: [{ geometry: g[1], material: mats.spruce, colored: true }], maxDist: near * 1.4 },
    { parts: [{ geometry: g[2], material: mats.spruce, colored: true, castShadow: false }], maxDist: far },
  ]));
  const treeSpots = [];
  for (let z = -HALF + 4; z < HALF - 4; z += 6.5) {
    for (let x = -HALF + 4; x < HALF - 4; x += 6.5) {
      const px = x + (rng() - 0.5) * 6.2, pz = z + (rng() - 0.5) * 6.2;
      const h = sample(px, pz); normal(px, pz, nrm);
      const a = alt(h);
      const forest = fbm(nForest, px / 260, pz / 260);
      const glade = nGlade(px / 70, pz / 70);
      let p = smoothstep(0.72, 0.35, a) * smoothstep(-0.02, 0.22, forest) * 0.55;
      p *= glade > 0.35 ? 0.08 : 1;
      p += 0.012 * smoothstep(0.75, 0.4, a);
      p *= smoothstep(0.76, 0.88, nrm.y);
      if (rng() > p * D) continue;
      if (!occ.free(px, pz, 1.2)) continue;
      const sc = 0.75 + rng() * 0.55;
      const w = 0.85 + rng() * 0.3;
      const tint = 0.85 + rng() * 0.25;
      const col = new THREE.Color(tint * (0.95 + rng() * 0.1), tint, tint * (1 + rng() * 0.12));
      pick(spruces).add(px, h - 0.2, pz, rng() * 6.28, new THREE.Vector3(sc * w, sc, sc * w), col, (rng() - 0.5) * 0.05, (rng() - 0.5) * 0.05);
      occ.add(px, pz, 1.6 * sc);
      grid.stamp(px, pz, 4.2 * sc, 0.38, 0.55 * sc);
      treeSpots.push({ x: px, z: pz, kind: 'spruce' });
    }
  }
  onProgress('Берёзовые рощи');

  // ---------- берёзы с пушистыми кронами
  const birchLods = [0, 1, 2].map(() => {
    const seed = Math.floor(rng() * 1e9);
    return [makeBirch(mulberry32(seed), 0), makeBirch(mulberry32(seed), 1)];
  });
  const birches = birchLods.map((g, i) => mk('birch' + i, [
    { parts: [{ geometry: g[0].trunk, material: mats.birchBark }, { geometry: g[0].crown, material: mats.crown, colored: true }], maxDist: near * 0.8 },
    { parts: [{ geometry: g[1].trunk, material: mats.birchBark, castShadow: false }, { geometry: g[1].crown, material: mats.crown, colored: true }], maxDist: far },
  ]));
  const birchPalette = (px, pz) => {
    const cn = nCol(px / 380, pz / 380) + (rng() - 0.5) * 0.25;
    if (cn > 0.38) return BIRCH_CREAM;
    if (cn < -0.5) return BIRCH_RED;
    return BIRCH_ORANGE;
  };
  for (let z = -HALF + 4; z < HALF - 4; z += 8) {
    for (let x = -HALF + 4; x < HALF - 4; x += 8) {
      const px = x + (rng() - 0.5) * 7.5, pz = z + (rng() - 0.5) * 7.5;
      const h = sample(px, pz); normal(px, pz, nrm);
      const a = alt(h);
      const grove = fbm(nGrove, px / 170, pz / 170);
      const forest = fbm(nForest, px / 260, pz / 260);
      let p = Math.exp(-Math.pow((a - 0.45) / 0.28, 2)) * smoothstep(-0.02, 0.22, grove) * 0.6;
      p *= forest > 0.18 ? 0.35 : 1;
      p += 0.01;
      p *= smoothstep(0.8, 0.9, nrm.y);
      if (rng() > p * D) continue;
      if (!occ.free(px, pz, 1.5)) continue;
      const sc = 0.8 + rng() * 0.45;
      const col = pick(birchPalette(px, pz)).clone().multiplyScalar(0.92 + rng() * 0.16);
      pick(birches).add(px, h - 0.1, pz, rng() * 6.28, new THREE.Vector3(sc, sc * (0.9 + rng() * 0.2), sc), col, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08);
      occ.add(px, pz, 1.8 * sc);
      grid.stamp(px, pz, 3.2 * sc, 0.25, 0.25);
      treeSpots.push({ x: px, z: pz, kind: 'birch' });
    }
  }

  // ---------- высокие сосны со светлыми шапками
  const pineLods = [0, 1].map(() => {
    const seed = Math.floor(rng() * 1e9);
    return [makePine(mulberry32(seed), 0), makePine(mulberry32(seed), 1)];
  });
  const pines = pineLods.map((g, i) => mk('pine' + i, [
    { parts: [{ geometry: g[0].trunk, material: mats.pineBark }, { geometry: g[0].crown, material: mats.crown, colored: true }], maxDist: near * 0.8 },
    { parts: [{ geometry: g[1].trunk, material: mats.pineBark, castShadow: false }, { geometry: g[1].crown, material: mats.crown, colored: true }], maxDist: far },
  ]));
  for (let z = -HALF + 5; z < HALF - 5; z += 11) {
    for (let x = -HALF + 5; x < HALF - 5; x += 11) {
      const px = x + (rng() - 0.5) * 10, pz = z + (rng() - 0.5) * 10;
      const h = sample(px, pz); normal(px, pz, nrm);
      const a = alt(h);
      const grove = fbm(nGrove, px / 170, pz / 170);
      let p = Math.exp(-Math.pow((a - 0.3) / 0.22, 2)) * smoothstep(0.05, 0.3, -grove) * 0.45 + 0.008;
      p *= smoothstep(0.8, 0.9, nrm.y);
      if (rng() > p * D) continue;
      if (!occ.free(px, pz, 1.4)) continue;
      const sc = 0.85 + rng() * 0.35;
      pick(pines).add(px, h - 0.1, pz, rng() * 6.28, sc, pick(PINE_CROWN).clone().multiplyScalar(0.9 + rng() * 0.15), (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.12);
      occ.add(px, pz, 1.5);
      grid.stamp(px, pz, 2.6, 0.22, 0.2);
      treeSpots.push({ x: px, z: pz, kind: 'pine' });
    }
  }
  onProgress('Сухостой, брёвна, кусты');

  // ---------- сухостой
  const snagGeos = [0, 1, 2].map(() => makeSnag(rng));
  const snags = snagGeos.map((g, i) => mk('snag' + i, [{ parts: [{ geometry: g, material: mats.snag }], maxDist: far * 0.8 }]));
  for (let z = -HALF + 6; z < HALF - 6; z += 16) {
    for (let x = -HALF + 6; x < HALF - 6; x += 16) {
      const px = x + (rng() - 0.5) * 15, pz = z + (rng() - 0.5) * 15;
      const h = sample(px, pz); normal(px, pz, nrm);
      const a = alt(h);
      const forest = fbm(nForest, px / 260, pz / 260);
      const p = (0.05 * smoothstep(0.4, 0.75, a) + 0.08 * (1 - Math.min(1, Math.abs(forest) / 0.08))) * smoothstep(0.75, 0.88, nrm.y);
      if (rng() > p * D) continue;
      if (!occ.free(px, pz, 1)) continue;
      pick(snags).add(px, h - 0.1, pz, rng() * 6.28, 0.8 + rng() * 0.5, null, (rng() - 0.5) * 0.25, (rng() - 0.5) * 0.25);
      occ.add(px, pz, 1);
      grid.stamp(px, pz, 2, 0.2);
    }
  }

  // ---------- поваленные брёвна и пни
  const logGeos = [0, 1, 2].map(() => makeLog(rng));
  const logs = logGeos.map((g, i) => mk('log' + i, [{ parts: [{ geometry: g, material: mats.log }], maxDist: near * 1.3 }]));
  const stumpGeos = [0, 1].map(() => makeStump(rng));
  const stumps = stumpGeos.map((g, i) => mk('stump' + i, [{ parts: [{ geometry: g, material: mats.log }], maxDist: near }]));
  for (let z = -HALF + 6; z < HALF - 6; z += 14) {
    for (let x = -HALF + 6; x < HALF - 6; x += 14) {
      const px = x + (rng() - 0.5) * 13, pz = z + (rng() - 0.5) * 13;
      const h = sample(px, pz); normal(px, pz, nrm);
      const a = alt(h);
      const forest = fbm(nForest, px / 260, pz / 260);
      const nearForest = smoothstep(-0.15, 0.1, forest) * smoothstep(0.75, 0.3, a);
      if (nrm.y < 0.86) continue;
      const r = rng();
      if (r < 0.1 * nearForest * D) {
        if (!occ.free(px, pz, 3.5)) continue;
        const across = Math.atan2(nrm.x, nrm.z) + Math.PI / 2 + (rng() - 0.5) * 0.9;
        pick(logs).add(px, h - 0.15, pz, across, 0.9 + rng() * 0.4, null, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.1);
        occ.add(px, pz, 3.5);
        grid.stamp(px, pz, 4.5, 0.3);
      } else if (r < 0.16 * nearForest * D) {
        if (!occ.free(px, pz, 0.8)) continue;
        pick(stumps).add(px, h, pz, rng() * 6.28, 0.8 + rng() * 0.6);
        occ.add(px, pz, 0.8);
      }
    }
  }

  // ---------- пушистые кусты
  const bushGeos = [0, 1, 2].map(() => makeBush(rng));
  const bushes = bushGeos.map((g, i) => mk('bush' + i, [{ parts: [{ geometry: g, material: mats.crown, colored: true }], maxDist: near * 1.2 }]));
  for (let z = -HALF + 3; z < HALF - 3; z += 7) {
    for (let x = -HALF + 3; x < HALF - 3; x += 7) {
      const px = x + (rng() - 0.5) * 6.5, pz = z + (rng() - 0.5) * 6.5;
      const h = sample(px, pz); normal(px, pz, nrm);
      const a = alt(h);
      const grove = fbm(nGrove, px / 170, pz / 170);
      const p = (smoothstep(-0.12, 0.18, grove) * 0.12 + 0.006) * smoothstep(0.85, 0.5, a) * smoothstep(0.8, 0.9, nrm.y);
      if (rng() > p * D) continue;
      if (!occ.free(px, pz, 0.9)) continue;
      const sc = 0.7 + rng() * 0.8;
      pick(bushes).add(px, h - 0.25 * sc, pz, rng() * 6.28, sc, pick(birchPalette(px, pz)).clone().multiplyScalar(0.85 + rng() * 0.2));
      occ.add(px, pz, 1.1 * sc);
    }
  }

  // ---------- сборка
  const objects = new THREE.Group();
  objects.name = 'objects';
  archMesh.forEach((m) => objects.add(m));
  for (const s of scatters) if (s.count > 0) s.build(objects);
  scene.add(objects);

  const live = scatters.filter((s) => s.count > 0);
  const stats = {};
  for (const s of live) {
    const k = s.name.replace(/\d+$/, '');
    stats[k] = (stats[k] || 0) + s.count;
  }
  stats.arch = arches.length;

  return { scatters: live, arches, treeSpots, stats, mats, cloudMat: mats.cloud, occ };
}

// ------------------------------------------------------------- облака
export function buildClouds(scene, material) {
  const rng = mulberry32(CONFIG.SEED + 900);
  const geos = [0, 1, 2, 3].map(() => makeCloud(rng));
  const group = new THREE.Group();
  group.name = 'clouds';
  const place = [];
  // «море облаков» под горой
  for (let i = 0; i < 420; i++) {
    const a = rng() * Math.PI * 2;
    const r = HALF * 1.25 + Math.pow(rng(), 0.8) * HALF * 4.2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const ground = heightAt(x, z);
    const y = -190 + rng() * 60;
    if (ground > y + 40) continue;
    place.push([x, y, z, 1.4 + rng() * 1.4, 0.5 + rng() * 0.3]);
  }
  // высокие облака
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const r = HALF * 1.5 + rng() * HALF * 4.5;
    place.push([Math.cos(a) * r, 1250 + rng() * 600, Math.sin(a) * r, 1.6 + rng() * 1.4, 0.45 + rng() * 0.2]);
  }
  const per = geos.map(() => []);
  place.forEach((p) => per[Math.floor(rng() * geos.length)].push(p));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  const white = new THREE.Color(1, 1, 1);
  geos.forEach((g, gi) => {
    const list = per[gi];
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(g, material, list.length);
    list.forEach(([x, y, z, sc, sy], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      m4.compose(v.set(x, y, z), q, s.set(sc, sc * sy, sc));
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, white);
    });
    mesh.computeBoundingSphere();
    mesh.frustumCulled = false;
    group.add(mesh);
  });
  scene.add(group);
  return group;
}

// Точки обзора для быстрого перелёта камеры.
export function makeViewpoints(world, sample) {
  const vps = [];
  // настоящая высшая точка рядом с расчётной вершиной
  let px = PEAK_UV.u * HALF, pz = PEAK_UV.v * HALF, ph = -1e9;
  for (let dz = -150; dz <= 150; dz += 6) for (let dx = -150; dx <= 150; dx += 6) {
    const hh = sample(PEAK_UV.u * HALF + dx, PEAK_UV.v * HALF + dz);
    if (hh > ph) { ph = hh; px = PEAK_UV.u * HALF + dx; pz = PEAK_UV.v * HALF + dz; }
  }
  world.peak = new THREE.Vector3(px, ph, pz);
  // свободное от деревьев место рядом с точкой
  const clear = (x0, z0, r) => {
    for (let ring = 0; ring < 30; ring++) {
      for (let k = 0; k < 12; k++) {
        const a = k / 12 * Math.PI * 2 + ring;
        const x = x0 + Math.cos(a) * ring * 3, z = z0 + Math.sin(a) * ring * 3;
        if (world.treeSpots.every((t) => (t.x - x) ** 2 + (t.z - z) ** 2 > r * r)) return { x, z };
      }
    }
    return { x: x0, z: z0 };
  };
  vps.push({ name: 'Вершина', pos: new THREE.Vector3(px, ph + 28, pz + 35), look: new THREE.Vector3(px, sample(px, pz + 700) - 30, pz + 700) });
  {
    // вид с высоты над серединой главного склона — вниз, на леса и рощи
    const sx = 40, sz = -170;
    const lx = -60, lz = 520;
    vps.push({ name: 'Склон', pos: new THREE.Vector3(sx, sample(sx, sz) + 32, sz), look: new THREE.Vector3(lx, sample(lx, lz), lz) });
  }
  if (world.arches.length) {
    const a = world.arches[0];
    const fx = Math.sin(a.fall), fz = Math.cos(a.fall);
    const cx = a.x - fx * 45, cz = a.z - fz * 45;
    vps.push({ name: 'Арка', pos: new THREE.Vector3(cx, sample(cx, cz) + 6, cz), look: new THREE.Vector3(a.x, a.y + 10 * a.scale, a.z) });
  }
  const best = (kind) => {
    const bins = new Map();
    for (const t of world.treeSpots) {
      if (t.kind !== kind) continue;
      const k = Math.floor((t.x + HALF) / 60) * 1000 + Math.floor((t.z + HALF) / 60);
      bins.set(k, (bins.get(k) || 0) + 1);
    }
    let bk = null, bc = 0;
    for (const [k, c] of bins) if (c > bc) { bc = c; bk = k; }
    if (bk === null) return null;
    return { x: Math.floor(bk / 1000) * 60 - HALF + 30, z: (bk % 1000) * 60 - HALF + 30 };
  };
  const b = best('birch');
  if (b) {
    const p = clear(b.x, b.z - 25, 6);
    vps.push({ name: 'Берёзы', pos: new THREE.Vector3(p.x, sample(p.x, p.z) + 3.5, p.z), look: new THREE.Vector3(b.x, sample(b.x, b.z + 40) + 4, b.z + 40) });
  }
  const s = best('spruce');
  if (s) {
    const p = clear(s.x, s.z - 15, 6);
    vps.push({ name: 'Ельник', pos: new THREE.Vector3(p.x, sample(p.x, p.z) + 3, p.z), look: new THREE.Vector3(s.x, sample(s.x, s.z + 40) + 3, s.z + 40) });
  }
  vps.push({ name: 'Обзор', pos: new THREE.Vector3(250, 820, HALF * 2.3), look: new THREE.Vector3(px, 300, pz) });
  return vps;
}
