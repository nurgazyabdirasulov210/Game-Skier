// Детерминированный 2D/3D градиентный шум (Perlin-подобный) и fbm.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2i(x, z, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

const GRAD = new Float32Array(512);
{
  const r = mulberry32(1337);
  for (let i = 0; i < 256; i++) {
    const a = r() * Math.PI * 2;
    GRAD[i * 2] = Math.cos(a);
    GRAD[i * 2 + 1] = Math.sin(a);
  }
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export function noise2(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const g = (cx, cz, dx, dz) => {
    const h = (hash2i(cx, cz, seed) & 255) * 2;
    return GRAD[h] * dx + GRAD[h + 1] * dz;
  };
  const n00 = g(ix, iz, fx, fz);
  const n10 = g(ix + 1, iz, fx - 1, fz);
  const n01 = g(ix, iz + 1, fx, fz - 1);
  const n11 = g(ix + 1, iz + 1, fx - 1, fz - 1);
  const u = fade(fx), v = fade(fz);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.414; // ~[-1, 1]
}

export function fbm2(x, z, octaves = 4, seed = 0) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, z * freq, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
