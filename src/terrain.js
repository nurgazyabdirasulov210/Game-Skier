// Height field of the whole valley: one long run from the summit bowl down to
// a frozen lake, with side walls, gullies, rollers, pillows and a cliff band.
import * as THREE from 'three';
import { SEED, MAP, ZONES } from './config.js';
import { makeNoise2D, fbm, smoothstep, mulberry32, clamp } from './noise.js';
import { stylize } from './shading.js';

const N1 = makeNoise2D(SEED);
const N2 = makeNoise2D(SEED + 11);
const N3 = makeNoise2D(SEED + 23);

export function centerX(z) {
  return 150 * Math.sin(z * 0.0024 + 0.6) + 55 * Math.sin(z * 0.0061 + 2.0) - 40;
}

// ---- downhill profile: steepness (m of drop per m) at control points --------
const STEEP = [
  [-1300, 0.02], [-1230, 0.30], [-1000, 0.40], [-760, 0.31], [-450, 0.29],
  [-210, 0.27], [-150, 0.07], [170, 0.07], [215, 0.62], [275, 0.55], [330, 0.30],
  [800, 0.28], [900, 0.16], [1010, 0.07], [1070, 0.0], [1300, 0.0],
];
function steepAt(z) {
  for (let i = 0; i < STEEP.length - 1; i++) {
    const [z0, s0] = STEEP[i];
    const [z1, s1] = STEEP[i + 1];
    if (z <= z1) {
      const t = smoothstep(z0, z1, z);
      return s0 + (s1 - s0) * t;
    }
  }
  return 0;
}
const PROFILE_STEP = 2;
const profile = (() => {
  const n = Math.ceil((2 * MAP.halfZ) / PROFILE_STEP) + 1;
  const arr = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    arr[i] = acc;
    acc += steepAt(-MAP.halfZ + i * PROFILE_STEP) * PROFILE_STEP;
  }
  const total = arr[n - 1];
  for (let i = 0; i < n; i++) arr[i] = MAP.top * (1 - arr[i] / total);
  return arr;
})();
function baseHeight(z) {
  const f = clamp((z + MAP.halfZ) / PROFILE_STEP, 0, profile.length - 1.001);
  const i = Math.floor(f);
  return profile[i] + (profile[i + 1] - profile[i]) * (f - i);
}

// ---- pillows: soft round mounds on the stone plateau -----------------------
const PILLOWS = [];
const PILLOW_CELL = 40;
const pillowGrid = new Map();
(() => {
  const rnd = mulberry32(SEED + 101);
  for (let i = 0; i < 170; i++) {
    const z = ZONES.stones[0] + 30 + rnd() * (ZONES.stones[1] - ZONES.stones[0] - 90);
    const x = centerX(z) + (rnd() * 2 - 1) * 330;
    const r = 5 + rnd() * 10;
    const h = 1.5 + rnd() * 3.5;
    PILLOWS.push({ x, z, r, h });
  }
  // a few big pillow lines in the spruce forest
  for (let i = 0; i < 90; i++) {
    const z = ZONES.spruce[0] + 60 + rnd() * (ZONES.spruce[1] - ZONES.spruce[0] - 80);
    const x = centerX(z) + (rnd() * 2 - 1) * 420;
    PILLOWS.push({ x, z, r: 6 + rnd() * 8, h: 1.2 + rnd() * 2.5 });
  }
  for (const p of PILLOWS) {
    const span = Math.ceil((p.r * 2) / PILLOW_CELL);
    const cx = Math.floor(p.x / PILLOW_CELL), cz = Math.floor(p.z / PILLOW_CELL);
    for (let a = -span; a <= span; a++) for (let b = -span; b <= span; b++) {
      const k = `${cx + a},${cz + b}`;
      if (!pillowGrid.has(k)) pillowGrid.set(k, []);
      pillowGrid.get(k).push(p);
    }
  }
})();
function pillowsAt(x, z) {
  const list = pillowGrid.get(`${Math.floor(x / PILLOW_CELL)},${Math.floor(z / PILLOW_CELL)}`);
  if (!list) return 0;
  let h = 0;
  for (const p of list) {
    const d2 = ((x - p.x) ** 2 + (z - p.z) ** 2) / (p.r * p.r);
    if (d2 < 4) h = Math.max(h, p.h * Math.exp(-d2 * 1.6));
  }
  return h;
}

// ---- frozen lake ------------------------------------------------------------
export const LAKE = { x: centerX(1175) + 20, z: 1175, rx: 300, rz: 150, level: 0 };
export function lakeFactor(x, z) {
  const e = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz) + 0.06 * N3(x * 0.01, z * 0.01);
  return e;
}

// ---- zones ------------------------------------------------------------------
export function zoneWeight(name, x, z) {
  const [a, b] = ZONES[name];
  const zz = z + 70 * N2(x * 0.0035, z * 0.0035);
  const lo = a <= -MAP.halfZ ? 1 : smoothstep(a - 60, a + 60, zz);
  const hi = b >= MAP.halfZ ? 1 : 1 - smoothstep(b - 60, b + 60, zz);
  return lo * hi;
}

const GULLIES = [
  { off: -175, wig: 35, depth: 9, w: 20, ph: 0.3 },
  { off: -70, wig: 25, depth: 6, w: 16, ph: 2.1 },
  { off: 95, wig: 40, depth: 10, w: 22, ph: 4.0 },
  { off: 215, wig: 30, depth: 7, w: 18, ph: 5.2 },
];

function ridged(x, z) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let o = 0; o < 5; o++) {
    const r = 1 - Math.abs(N1(x * f, z * f));
    s += a * r * r;
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

/** Height of the playable map at (x, z). */
export function heightAt(x, z) {
  const cx = centerX(z);
  const d = x - cx;
  const ad = Math.abs(d);
  let h = baseHeight(z);

  // rounded summit dome at the top
  h += 75 * Math.exp(-((x + 60) ** 2 + (z + 1230) ** 2) / (2 * 260 * 260));

  // U-shaped valley with side walls
  const w = 330 + 70 * N2(z * 0.0021, 7.3);
  h += 0.00009 * Math.min(ad, w) ** 2;
  const wall = smoothstep(0.55 * w, 1.85 * w, ad);
  h += 175 * Math.pow(wall, 1.4) + 0.09 * Math.max(0, ad - 1.85 * w);
  h += wall * ridged(x * 0.0055, z * 0.0055) * 55;

  // gullies running down the slope
  const gullyMask = 1 - zoneWeight('stones', x, z) * 0.7 - zoneWeight('pines', x, z) * 0.6;
  for (const g of GULLIES) {
    const gx = cx + g.off + g.wig * Math.sin(z * 0.0045 + g.ph);
    const t = (x - gx) / g.w;
    h -= g.depth * Math.exp(-t * t) * gullyMask * (1 - wall);
  }

  // rollers across the slope + soft dunes + very fine waviness
  const lakeE = lakeFactor(x, z);
  const notLake = smoothstep(0.9, 1.35, lakeE);
  const rollMask = (1 - zoneWeight('summit', x, z) * 0.5) * notLake;
  h += 3.2 * Math.sin(z * 0.028 + 2.4 * N1(x * 0.004, z * 0.0025)) * rollMask;
  h += fbm(N1, x / 160, z / 160, 3) * 7 * notLake;
  h += N3(x / 48, z / 48) * 1.1 * notLake;

  // cornice lip along the top of the cliff band
  const lip = Math.exp(-(((z - 205) / 14) ** 2)) * (1 - wall);
  h += 3.5 * lip;

  h += pillowsAt(x, z);

  // frozen lake basin with a soft snow bank
  const lakeMask = 1 - smoothstep(0.86, 1.04, lakeE);
  h = h + (LAKE.level - 0.7 - h) * lakeMask;
  h += 1.4 * Math.exp(-(((lakeE - 1.08) / 0.07) ** 2));
  return h;
}

/** Height of the surrounding ranges (outside the map rectangle). */
function outerHeight(x, z) {
  const hx = MAP.halfX, hz = MAP.halfZ;
  const qx = clamp(x, -hx, hx), qz = clamp(z, -hz, hz);
  const ex = Math.abs(x) - hx, ez = Math.abs(z) - hz;
  const e = Math.hypot(Math.max(ex, 0), Math.max(ez, 0)) + Math.min(Math.max(ex, ez), 0);
  const edge = heightAt(qx, qz);
  if (e <= 0) return edge - 25;
  const downhill = z > hz ? smoothstep(hz, hz + 400, z) * (1 - smoothstep(600, 1500, Math.abs(x))) : 0;
  const near = 230 * smoothstep(0, 1300, e) * (1 - downhill * 0.95);
  const far = ridged(x * 0.00055, z * 0.00055) * 1500 * smoothstep(300, 3200, e) * (1 - downhill * 0.55);
  const fade = smoothstep(0, 80, e);
  return edge + near + far - 25 * (1 - fade) - downhill * 30 * smoothstep(0, 600, e);
}

export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 1.0;
  const hl = heightAt(x - e, z), hr = heightAt(x + e, z);
  const hd = heightAt(x, z - e), hu = heightAt(x, z + e);
  return out.set(hl - hr, 2 * e, hd - hu).normalize();
}

export function slopeAt(x, z) {
  const n = normalAt(x, z);
  return Math.acos(clamp(n.y, -1, 1));
}

export function buildTerrain(quality) {
  const [rx, rz] = quality.terrainRes;
  const geo = new THREE.PlaneGeometry(MAP.halfX * 2, MAP.halfZ * 2, rx, rz);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const heights = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) heights[i] = pos.getY(i);
  const cellX = (MAP.halfX * 2) / rx, cellZ = (MAP.halfZ * 2) / rz;
  /** Height of the rendered (triangulated) surface, matches the mesh exactly. */
  const surfaceAt = (x, z) => {
    const fx = clamp((x + MAP.halfX) / cellX, 0, rx - 1e-4);
    const fz = clamp((z + MAP.halfZ) / cellZ, 0, rz - 1e-4);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const u = fx - ix, v = fz - iz;
    const W = rx + 1;
    const ha = heights[ix + W * iz], hb = heights[ix + W * (iz + 1)];
    const hc = heights[ix + 1 + W * (iz + 1)], hd = heights[ix + 1 + W * iz];
    if (u + v <= 1) return ha + (hd - ha) * u + (hb - ha) * v;
    return hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
  };

  const snowMat = stylize(new THREE.MeshLambertMaterial({ color: 0xffffff }), { rim: 0.35, sparkle: true });
  const mesh = new THREE.Mesh(geo, snowMat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  // surrounding ranges
  const size = 16000, res = 230;
  const og = new THREE.PlaneGeometry(size, size, res, res);
  og.rotateX(-Math.PI / 2);
  const op = og.attributes.position;
  for (let i = 0; i < op.count; i++) {
    op.setY(i, outerHeight(op.getX(i), op.getZ(i) + 1500));
    op.setZ(i, op.getZ(i) + 1500);
  }
  og.computeVertexNormals();
  const outerMat = stylize(new THREE.MeshLambertMaterial({ color: 0xffffff }), { rim: 0.45 });
  const outer = new THREE.Mesh(og, outerMat);
  outer.receiveShadow = false;
  outer.name = 'ranges';

  return { mesh, outer, snowMat, outerMat, surfaceAt };
}
