// Seeded 2D simplex noise + hashing helpers.
// Shared by the main thread (physics) and the terrain worker (meshes),
// so both always agree on the shape of the mountain.

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = new Float32Array([
  1, 1, -1, 1, 1, -1, -1, -1,
  1, 0, -1, 0, 1, 0, -1, 0,
  0, 1, 0, -1, 0, 1, 0, -1,
]);

const perm = new Uint8Array(512);
const permMod12 = new Uint8Array(512);

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedNoise(seed) {
  const rnd = mulberry32(seed * 9301 + 49297);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }
}
seedNoise(1);

/** Simplex noise, range roughly [-1, 1]. */
export function noise2(xin, yin) {
  let n0 = 0, n1 = 0, n2 = 0;
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  let i1, j1;
  if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 >= 0) {
    const g = permMod12[ii + perm[jj]] * 2;
    t0 *= t0; n0 = t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0);
  }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) {
    const g = permMod12[ii + i1 + perm[jj + j1]] * 2;
    t1 *= t1; n1 = t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1);
  }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) {
    const g = permMod12[ii + 1 + perm[jj + 1]] * 2;
    t2 *= t2; n2 = t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2);
  }
  return 70 * (n0 + n1 + n2);
}

/** Integer hash of a cell -> [0,1). */
export function hash2(ix, iz, salt = 0) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(salt | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822519 | 0);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function hashInt(ix, iz, salt = 0) {
  return Math.floor(hash2(ix, iz, salt) * 2147483647);
}

export function smoothstep(a, b, x) {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
export function lerp(a, b, t) { return a + (b - a) * t; }
