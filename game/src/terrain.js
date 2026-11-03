// The mountain: one deterministic height function h(x, z) plus everything that
// lives on it (forests, rocks, logs, gates, cabins, an old chairlift...).
// Downhill is -Z. Units are metres.

import { noise2, hash2, hashInt, mulberry32, seedNoise, smoothstep, clamp } from './noise.js';

export const CHUNK = 64;
export const SLOPE = 0.3;

export const OBJ = {
  FIR: 1, LARCH: 2, GHOST: 3, SNAG: 4,
  ROCK: 10, LOG: 11, GATE: 12, CRYSTAL: 13, CABIN: 14, TOWER: 15, STUMP: 16,
};
export const OBJ_STRIDE = 10; // type, x, y, z, rot, scale, e0, e1, e2, e3

let SEED = 1;
let SPAWN = null;
export function setWorldSeed(seed) {
  SEED = seed | 0;
  seedNoise(SEED);
  kcache.clear();
  SPAWN = null;
  SPAWN = computeSpawn();
  kcache.clear();
}
export function getWorldSeed() { return SEED; }

// ---------------------------------------------------------------- features

const KCELL = 92;       // one possible kicker per cell
const LIFT_SPACING = 760;
const TOWER_SPACING = 64;
const CABIN_CELL = 280;

const CLIFF_SPACING = 240;
function cliff(x, wz, m) {
  if (m < 0.2) return 0;
  const D = 7.5 * smoothstep(0.2, 0.55, m);
  const c = (wz + 26 * noise2(x * 0.009, 3.3)) / CLIFF_SPACING;
  const s = c - Math.floor(c);
  const w = 2.4 / CLIFF_SPACING;
  let g = (1 - s) * smoothstep(0, w, s);
  g += 0.05 * smoothstep(w, w * 2.5, s) * (1 - smoothstep(w * 2.5, w * 7, s));
  return D * (g - 0.5);
}

const kcache = new Map();
/** Kicker parameters for a cell (cached), or null when the cell has none. */
function kickerCell(cx, cz) {
  const key = (cx + 40000) * 80000 + (cz + 40000);
  let k = kcache.get(key);
  if (k !== undefined) return k;
  k = null;
  if (hash2(cx, cz, SEED + 11) <= 0.62) {
    const a = (hash2(cx, cz, SEED + 12) - 0.5) * 0.7;
    const big = hash2(cx, cz, SEED + 15);
    k = {
      x: (cx + 0.2 + hash2(cx, cz, SEED + 13) * 0.6) * KCELL,
      z: (cz + 0.2 + hash2(cx, cz, SEED + 14) * 0.6) * KCELL,
      dx: Math.sin(a), dz: -Math.cos(a),     // downhill direction (towards -z)
      H: 1.4 + big * 2.4, L: 8 + big * 7, K: 2.2 + big * 1.6,
      W: 5 + hash2(cx, cz, SEED + 16) * 6,
    };
    // no kickers stacked on top of cliff bands, and a calm start area
    const m = noise2(k.x * 0.0032 + 41.0, k.z * 0.0032 - 13.0);
    if (m > 0.18) {
      const wz = k.z + 38 * noise2(k.x * 0.0021 - 3.7, k.z * 0.0021 + 19.9);
      const c = (wz + 26 * noise2(k.x * 0.009, 3.3)) / CLIFF_SPACING;
      const f = c - Math.floor(c);
      if (Math.min(f, 1 - f) * CLIFF_SPACING < k.L + k.K + 18) k = null;
    }
    if (k && SPAWN && Math.hypot(k.x - SPAWN.x, k.z - SPAWN.z) < 110) k = null;
  }
  if (kcache.size > 8192) kcache.clear();
  kcache.set(key, k);
  return k;
}
function kickerParams(cx, cz, out) {
  const k = kickerCell(cx, cz);
  if (!k) return false;
  Object.assign(out, k);
  return true;
}
const _k = { x: 0, z: 0, dx: 0, dz: 0, H: 0, L: 0, K: 0, W: 0 };

function computeSpawn() {
  let best = { x: 0, z: 0 }, bestScore = -1e9;
  for (let i = -7; i <= 7; i++) {
    for (let j = -7; j <= 7; j++) {
      const x = i * 55, z = j * 55;
      let px = x, pz = z, ph = heightAt(px, pz), score = 0;
      for (let k = 0; k < 18; k++) {
        const n = normalAt(px, pz, 2.5);
        const hl = Math.hypot(n[0], n[2]) || 1;
        px += (n[0] / hl) * 10; pz += (n[2] / hl) * 10;
        const h = heightAt(px, pz);
        const d = ph - h;
        if (d < 1.2 || d > 6.5) score -= 4 + Math.abs(d - 3);
        else score += 1;
        ph = h;
      }
      score -= Math.hypot(x, z) * 0.004;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
  }
  return best;
}

function kickers(x, z) {
  const cx = Math.floor(x / KCELL), cz = Math.floor(z / KCELL);
  let h = 0;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      if (!kickerParams(cx + i, cz + j, _k)) continue;
      const dx = x - _k.x, dz = z - _k.z;
      const R = _k.L + _k.W + 6;
      if (dx * dx + dz * dz > R * R) continue;
      const u = dx * _k.dx + dz * _k.dz;      // along downhill
      const v = -dx * _k.dz + dz * _k.dx;     // across
      let y = 0;
      if (u > -_k.L && u <= 0) { const t = (u + _k.L) / _k.L; y = _k.H * t * t; }
      else if (u > 0 && u < _k.K) y = _k.H * (1 - smoothstep(0, _k.K, u));
      if (y <= 0) continue;
      const hw = _k.W * 0.5;
      const m = 1 - smoothstep(hw, hw + 2.6, Math.abs(v));
      h += y * m;
    }
  }
  return h;
}

/** 0..1, how close we are to a kicker (used to keep trees off the ramps). */
export function kickerZone(x, z) {
  const cx = Math.floor(x / KCELL), cz = Math.floor(z / KCELL);
  let best = 0;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      if (!kickerParams(cx + i, cz + j, _k)) continue;
      const dx = x - _k.x, dz = z - _k.z;
      const u = dx * _k.dx + dz * _k.dz;
      const v = -dx * _k.dz + dz * _k.dx;
      if (u > -_k.L - 14 && u < _k.K + 26 && Math.abs(v) < _k.W * 0.5 + 6) best = 1;
    }
  }
  return best;
}

export function liftX(k, z) {
  return k * LIFT_SPACING + 140 + 70 * noise2(z * 0.0016, k * 7.31 + 0.5);
}

function liftCorridor(x, z) {
  const k = Math.round((x - 140) / LIFT_SPACING);
  return Math.abs(x - liftX(k, z));
}

function cabinSpot(ci, cj, out) {
  if (hash2(ci, cj, SEED + 41) > 0.5) return false;
  out.x = (ci + 0.25 + hash2(ci, cj, SEED + 42) * 0.5) * CABIN_CELL;
  out.z = (cj + 0.25 + hash2(ci, cj, SEED + 43) * 0.5) * CABIN_CELL;
  return true;
}
const _c = { x: 0, z: 0 };

function cabinClearing(x, z) {
  const ci = Math.floor(x / CABIN_CELL), cj = Math.floor(z / CABIN_CELL);
  if (!cabinSpot(ci, cj, _c)) return 1e9;
  const dx = x - _c.x, dz = z - _c.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// ---------------------------------------------------------------- height

export function baseHeight(x, z) {
  const wx = x + 38 * noise2(x * 0.0021 + 11.3, z * 0.0021 - 7.1);
  const wz = z + 38 * noise2(x * 0.0021 - 3.7, z * 0.0021 + 19.9);
  let h = z * SLOPE;
  h += 40 * noise2(x * 0.0009 + 3.1, z * 0.0022);           // benches and steeps
  // long spines and gullies (soft-abs keeps the crests rounded and rideable)
  const n1 = noise2(wx * 0.0062, wz * 0.0019);
  let r = 1.04 - Math.sqrt(n1 * n1 + 0.012);
  r *= r;
  const n2 = noise2(wx * 0.015 + 5.2, wz * 0.0048 + 1.7);
  let r2 = 1.06 - Math.sqrt(n2 * n2 + 0.02);
  r2 *= r2;
  h += 20 * r + 6 * r2;
  h += 3.6 * noise2(wx * 0.017, wz * 0.02);                 // rollers
  h += 0.9 * noise2(x * 0.045 + 9.1, z * 0.05 - 4.4);
  h += 0.42 * noise2(x * 0.11, z * 0.11);                   // pillows
  h += 0.12 * noise2(x * 0.31 + 1.3, z * 0.29 + 7.7);
  const m = noise2(x * 0.0032 + 41.0, z * 0.0032 - 13.0);
  h += cliff(x, wz, m);
  return h;
}

export function heightAt(x, z) {
  return baseHeight(x, z) + kickers(x, z);
}

const _n = [0, 1, 0];
/** Surface normal; returns a reused array [nx, ny, nz]. */
export function normalAt(x, z, e = 0.35) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  let nx = -hx, ny = 2 * e, nz = -hz;
  const l = Math.hypot(nx, ny, nz);
  _n[0] = nx / l; _n[1] = ny / l; _n[2] = nz / l;
  return _n;
}

/** Rock exposure 0..1 (cliff faces + wind-scoured ridges). */
export function rockiness(x, z) {
  return smoothstep(0.35, 0.8, noise2(x * 0.02 + 70, z * 0.02 - 30));
}

/** 0..1 forest density. */
export function forestDensity(x, z) {
  let d = noise2(x * 0.0042 + 100, z * 0.0042 - 50) * 0.75 + noise2(x * 0.017 - 9, z * 0.017 + 4) * 0.35;
  d = smoothstep(-0.18, 0.42, d);
  // lift corridors are cut through the forest
  const lc = liftCorridor(x, z);
  d *= smoothstep(7, 16, lc);
  // clearings around cabins
  d *= smoothstep(16, 30, cabinClearing(x, z));
  // spawn meadow
  d *= smoothstep(30, 75, spawnDist(x, z));
  return d;
}

function spawnDist(x, z) {
  return SPAWN ? Math.hypot(x - SPAWN.x, z - SPAWN.z) : 1e9;
}

/** A nice open start on a steady fall line (deterministic per seed). */
export function findSpawn() {
  return SPAWN ? { ...SPAWN } : { x: 0, z: 0 };
}

// ---------------------------------------------------------------- objects

/**
 * Deterministic list of objects in a chunk. Returns Float32Array with
 * OBJ_STRIDE floats per object.
 */
export function chunkObjects(cx, cz) {
  const out = [];
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const rnd = mulberry32(hashInt(cx, cz, SEED + 777));
  const push = (t, x, y, z, rot, s, e0 = 0, e1 = 0, e2 = 0, e3 = 0) => {
    out.push(t, x, y, z, rot, s, e0, e1, e2, e3);
  };

  // --- trees on a jittered grid
  const step = 4;
  const n = CHUNK / step;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = x0 + (i + 0.1 + rnd() * 0.8) * step;
      const z = z0 + (j + 0.1 + rnd() * 0.8) * step;
      const r = rnd();
      const dens = forestDensity(x, z);
      if (r > dens * 0.62) continue;
      const nrm = normalAt(x, z, 0.8);
      if (nrm[1] < 0.8) continue;
      if (kickerZone(x, z)) continue;
      const y = heightAt(x, z);
      const sp = noise2(x * 0.006 - 31, z * 0.006 + 17);
      const rid = noise2(x * 0.011 + 3, z * 0.011 + 8);
      let type = OBJ.FIR;
      if (sp > 0.28) type = OBJ.LARCH;
      if (rid > 0.42 && rnd() < 0.7) type = OBJ.GHOST;
      if (rnd() < 0.04) type = OBJ.SNAG;
      const s = 0.75 + rnd() * 0.65 + (dens > 0.8 ? 0.15 : 0);
      push(type, x, y, z, rnd() * Math.PI * 2, s, rnd());
    }
  }

  // --- scattered small trees in the open (lone trees look great)
  for (let k = 0; k < 3; k++) {
    if (rnd() > 0.35) continue;
    const x = x0 + rnd() * CHUNK, z = z0 + rnd() * CHUNK;
    if (kickerZone(x, z) || spawnDist(x, z) < 40) continue;
    const nrm = normalAt(x, z, 0.8);
    if (nrm[1] < 0.85) continue;
    const type = rnd() < 0.5 ? OBJ.GHOST : OBJ.FIR;
    push(type, x, heightAt(x, z), z, rnd() * 6.28, 0.5 + rnd() * 0.5, rnd());
  }

  // --- rocks: on steep ground and in random outcrops
  for (let k = 0; k < 26; k++) {
    const x = x0 + rnd() * CHUNK, z = z0 + rnd() * CHUNK;
    const nrm = normalAt(x, z, 1.0);
    const steep = 1 - nrm[1];
    const want = steep > 0.3 ? 0.55 : rockiness(x, z) * 0.18;
    if (rnd() > want) continue;
    if (kickerZone(x, z) || spawnDist(x, z) < 30) continue;
    const y = heightAt(x, z);
    const s = 0.6 + rnd() * (steep > 0.3 ? 2.6 : 1.6);
    push(OBJ.ROCK, x, y - s * 0.35, z, rnd() * 6.28, s, rnd(), rnd() * 0.5 + 0.6);
  }

  // --- fallen logs (grindable) in and around forests
  for (let k = 0; k < 2; k++) {
    if (rnd() > 0.55) continue;
    const x = x0 + 6 + rnd() * (CHUNK - 12), z = z0 + 6 + rnd() * (CHUNK - 12);
    const dens = forestDensity(x, z);
    if (dens < 0.08 || dens > 0.85) continue;
    if (kickerZone(x, z)) continue;
    const nrm = normalAt(x, z, 1.0);
    if (nrm[1] < 0.86) continue;
    // mostly along the fall line so you can slide them
    const a = (rnd() - 0.5) * 0.9 + (rnd() < 0.2 ? Math.PI / 2 : 0);
    const len = 6 + rnd() * 7;
    const rad = 0.28 + rnd() * 0.14;
    const dx = Math.sin(a) * len * 0.5, dz = -Math.cos(a) * len * 0.5;
    const ya = heightAt(x - dx, z - dz) + rad * 0.55;
    const yb = heightAt(x + dx, z + dz) + rad * 0.55;
    push(OBJ.LOG, x - dx, ya, z - dz, a, rad, x + dx, yb, z + dz, len);
  }

  // --- tree stumps poking out of the snow
  for (let k = 0; k < 4; k++) {
    const x = x0 + rnd() * CHUNK, z = z0 + rnd() * CHUNK;
    if (rnd() > forestDensity(x, z) * 0.8) continue;
    if (kickerZone(x, z)) continue;
    push(OBJ.STUMP, x, heightAt(x, z) - 0.15, z, rnd() * 6.28, 0.7 + rnd() * 0.6);
  }

  // --- flag gates (ride under the bunting for a multiplier)
  if (rnd() < 0.42) {
    const x = x0 + 12 + rnd() * (CHUNK - 24), z = z0 + 12 + rnd() * (CHUNK - 24);
    const dens = forestDensity(x, z);
    const nrm = normalAt(x, z, 2.0);
    if (dens < 0.35 && nrm[1] > 0.84 && !kickerZone(x, z)) {
      // gate spans across the local fall line
      const fx = nrm[0], fz = nrm[2];
      const fl = Math.hypot(fx, fz) || 1;
      const a = Math.atan2(fx / fl, -fz / fl);
      const w = 5.5 + rnd() * 2.5;
      const id = cx * 7919 + cz * 104729 + 1;
      push(OBJ.GATE, x, heightAt(x, z), z, a, w, id,
        heightAt(x + Math.cos(a) * w * 0.5, z + Math.sin(a) * w * 0.5),
        heightAt(x - Math.cos(a) * w * 0.5, z - Math.sin(a) * w * 0.5), Math.floor(rnd() * 4));
    }
  }

  // --- glowing ice crystals to collect
  for (let k = 0; k < 2; k++) {
    if (rnd() > 0.3) continue;
    const x = x0 + rnd() * CHUNK, z = z0 + rnd() * CHUNK;
    const nrm = normalAt(x, z, 1.0);
    if (nrm[1] < 0.8 || forestDensity(x, z) > 0.6) continue;
    const id = cx * 7919 + cz * 104729 + 2 + k;
    push(OBJ.CRYSTAL, x, heightAt(x, z) + 1.3 + rnd() * 1.8, z, rnd() * 6.28, 1, id);
  }

  // --- cabins
  {
    const ci = Math.floor((x0 + CHUNK * 0.5) / CABIN_CELL), cj = Math.floor((z0 + CHUNK * 0.5) / CABIN_CELL);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      if (!cabinSpot(ci + a, cj + b, _c)) continue;
      if (_c.x < x0 || _c.x >= x0 + CHUNK || _c.z < z0 || _c.z >= z0 + CHUNK) continue;
      if (kickerZone(_c.x, _c.z)) continue;
      const nrm = normalAt(_c.x, _c.z, 3);
      const yaw = Math.atan2(nrm[0], -nrm[2]);
      // sit the cabin on the lowest corner so it never floats
      let y = 1e9;
      for (let q = 0; q < 4; q++) {
        const ox = (q & 1 ? 3.5 : -3.5), oz = (q & 2 ? 3 : -3);
        y = Math.min(y, heightAt(_c.x + ox, _c.z + oz));
      }
      push(OBJ.CABIN, _c.x, y, _c.z, yaw, 1, hash2(ci + a, cj + b, 5));
    }
  }

  // --- chairlift towers (each stores the next tower uphill for the cable)
  {
    const k0 = Math.floor((x0 - 400) / LIFT_SPACING), k1 = Math.ceil((x0 + CHUNK + 400) / LIFT_SPACING);
    for (let k = k0; k <= k1; k++) {
      const ja = Math.ceil(z0 / TOWER_SPACING), jb = Math.floor((z0 + CHUNK - 0.001) / TOWER_SPACING);
      for (let j = ja; j <= jb; j++) {
        const z = j * TOWER_SPACING;
        const x = liftX(k, z);
        if (x < x0 || x >= x0 + CHUNK) continue;
        const z2 = z + TOWER_SPACING;
        const x2 = liftX(k, z2);
        const y = heightAt(x, z) - 0.4;
        const y2 = heightAt(x2, z2) - 0.4;
        const yaw = Math.atan2(x2 - x, -(z2 - z)); // unused by renderer, kept for colliders
        push(OBJ.TOWER, x, y, z, yaw, 1, x2, y2, z2, j);
      }
    }
  }

  return new Float32Array(out);
}

setWorldSeed(1);
