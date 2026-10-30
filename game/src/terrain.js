// Процедурная бесконечная гора. Спуск идёт в сторону +Z.
import { noise2, fbm2, hash2i, smoothstep } from './noise.js';

export const CHUNK = 64;
export const RES = 40; // сегментов на чанк
export const CELL = CHUNK / RES;

const KICK_CELL = 52;

// Возвращает трамплин в ячейке сетки (или null). Детерминированно.
export function kickerAt(cx, cz) {
  const h = hash2i(cx, cz, 911);
  if ((h & 1023) / 1024 > 0.38) return null;
  if (Math.abs(cx) < 1 && cz === 0) return null; // старт чистый
  const ox = ((h >>> 10) & 255) / 255;
  const oz = ((h >>> 18) & 255) / 255;
  return {
    x: (cx + 0.2 + ox * 0.6) * KICK_CELL,
    z: (cz + 0.2 + oz * 0.6) * KICK_CELL,
    height: 1.6 + ((h >>> 26) & 7) * 0.32,
    width: 3.5 + ((h >>> 4) & 3) * 0.8,
    yaw: (((h >>> 6) & 15) / 15 - 0.5) * 0.7,
  };
}

function kickerHeight(x, z) {
  const cx = Math.floor(x / KICK_CELL), cz = Math.floor(z / KICK_CELL);
  let best = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const k = kickerAt(cx + dx, cz + dz);
      if (!k) continue;
      const rx = x - k.x, rz = z - k.z;
      const c = Math.cos(k.yaw), s = Math.sin(k.yaw);
      const u = rz * c + rx * s; // вдоль склона
      const w = rx * c - rz * s; // поперёк
      if (u < -11 || u > 2.5 || Math.abs(w) > k.width + 2.5) continue;
      let p;
      if (u <= 0) {
        const t = (u + 11) / 11;
        p = t * t * t;
      } else {
        p = 1 - smoothstep(0, 2.5, u);
      }
      const lat = 1 - smoothstep(k.width * 0.6, k.width + 2.5, Math.abs(w));
      best = Math.max(best, p * lat * k.height);
    }
  }
  return best;
}

export function height(x, z) {
  // крупный рельеф: долины, гребни, перегибы
  const slopeVar = 0.3 + 0.1 * noise2(x * 0.0015, z * 0.0015, 5);
  let h = -z * slopeVar;
  h += fbm2(x * 0.0028, z * 0.0028, 4, 11) * 42;
  // боковые «трубы» и кулуары
  const ridge = 1 - Math.abs(noise2(x * 0.009, z * 0.004, 23));
  h += ridge * ridge * 7;
  h += fbm2(x * 0.013 + 31, z * 0.013 - 7, 3, 41) * 8;
  // бугры (могулы)
  h += noise2(x * 0.085, z * 0.07, 77) * 0.75;
  h += kickerHeight(x, z);
  return h;
}

const _e = 0.6;
export function normalAt(x, z, out) {
  const hx = height(x + _e, z) - height(x - _e, z);
  const hz = height(x, z + _e) - height(x, z - _e);
  out.set(-hx, 2 * _e, -hz).normalize();
  return out;
}

// Высота ровно такая, как у отрисованного треугольника сетки (для следов).
export function meshHeight(x, z) {
  const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
  const fx = x / CELL - gx, fz = z / CELL - gz;
  const x0 = gx * CELL, z0 = gz * CELL;
  const h00 = height(x0, z0), h10 = height(x0 + CELL, z0);
  const h01 = height(x0, z0 + CELL), h11 = height(x0 + CELL, z0 + CELL);
  // диагональ (0,0)-(1,1), как в индексации чанка
  if (fx > fz) return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
  return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
}

export { KICK_CELL };
