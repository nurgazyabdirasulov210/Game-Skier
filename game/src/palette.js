// Время суток: палитры и общие униформы для всех шейдеров.
import * as THREE from 'three';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const c = (r, g, b) => new THREE.Color(r, g, b);

// hour: 0..24
const KEYS = [
  { hour: 0, name: 'Ночь', sunDir: v(-0.35, 0.55, 0.75), sun: c(0.62, 0.72, 1.0), shadow: c(0.1, 0.16, 0.48),
    top: c(0.01, 0.03, 0.14), horizon: c(0.12, 0.2, 0.52), fog: c(0.14, 0.22, 0.55), glow: c(0.4, 0.5, 0.95),
    disk: 0.55, stars: 1, snowfall: 0.8, density: 0.0062 },
  { hour: 5.5, name: 'Рассвет', sunDir: v(-0.85, 0.1, 0.5), sun: c(1.0, 0.66, 0.5), shadow: c(0.36, 0.32, 0.66),
    top: c(0.22, 0.28, 0.6), horizon: c(1.0, 0.64, 0.55), fog: c(0.86, 0.62, 0.66), glow: c(1.0, 0.72, 0.42),
    disk: 1, stars: 0.15, snowfall: 0.1, density: 0.0058 },
  { hour: 9, name: 'Утро', sunDir: v(-0.5, 0.55, 0.65), sun: c(1.0, 0.94, 0.86), shadow: c(0.42, 0.55, 0.92),
    top: c(0.16, 0.4, 0.88), horizon: c(0.74, 0.85, 1.0), fog: c(0.8, 0.87, 1.0), glow: c(1.0, 0.92, 0.78),
    disk: 1, stars: 0, snowfall: 0, density: 0.0045 },
  { hour: 13, name: 'День', sunDir: v(0.25, 0.8, 0.55), sun: c(1.0, 0.98, 0.94), shadow: c(0.48, 0.6, 0.95),
    top: c(0.14, 0.4, 0.92), horizon: c(0.7, 0.84, 1.0), fog: c(0.78, 0.86, 1.0), glow: c(1.0, 0.96, 0.86),
    disk: 1, stars: 0, snowfall: 0, density: 0.0042 },
  { hour: 17.2, name: 'Золотой час', sunDir: v(0.35, 0.22, 0.92), sun: c(1.0, 0.74, 0.48), shadow: c(0.4, 0.38, 0.75),
    top: c(0.22, 0.32, 0.68), horizon: c(1.0, 0.72, 0.5), fog: c(0.95, 0.72, 0.62), glow: c(1.0, 0.75, 0.4),
    disk: 1, stars: 0, snowfall: 0, density: 0.005 },
  { hour: 19, name: 'Закат', sunDir: v(0.2, 0.07, 0.98), sun: c(1.0, 0.5, 0.36), shadow: c(0.42, 0.24, 0.55),
    top: c(0.24, 0.22, 0.52), horizon: c(1.0, 0.5, 0.36), fog: c(0.92, 0.48, 0.48), glow: c(1.0, 0.62, 0.28),
    disk: 1, stars: 0.1, snowfall: 0, density: 0.0062 },
  { hour: 21, name: 'Сумерки', sunDir: v(-0.2, 0.45, 0.85), sun: c(0.62, 0.74, 1.0), shadow: c(0.07, 0.14, 0.58),
    top: c(0.03, 0.06, 0.28), horizon: c(0.2, 0.34, 0.85), fog: c(0.2, 0.33, 0.8), glow: c(0.45, 0.58, 1.0),
    disk: 0.5, stars: 0.7, snowfall: 0.5, density: 0.0058 },
  { hour: 24, name: 'Ночь', sunDir: v(-0.35, 0.55, 0.75), sun: c(0.62, 0.72, 1.0), shadow: c(0.1, 0.16, 0.48),
    top: c(0.01, 0.03, 0.14), horizon: c(0.12, 0.2, 0.52), fog: c(0.14, 0.22, 0.55), glow: c(0.4, 0.5, 0.95),
    disk: 0.55, stars: 1, snowfall: 0.8, density: 0.0062 },
];

export const shared = {
  uSunDir: { value: v(0, 1, 0) },
  uSunColor: { value: c(1, 1, 1) },
  uShadowColor: { value: c(0.5, 0.6, 0.9) },
  uSkyTop: { value: c(0.2, 0.4, 0.9) },
  uHorizon: { value: c(0.7, 0.8, 1) },
  uFogColor: { value: c(0.8, 0.85, 1) },
  uGlowColor: { value: c(1, 0.9, 0.8) },
  uFogDensity: { value: 0.005 },
  uSunDisk: { value: 1 },
  uStars: { value: 0 },
  uTime: { value: 0 },
};

export const tod = { hour: 17.2, speed: 0.04, name: '', snowfall: 0 };

const SHORT = [0, 5.5, 9, 13, 17.2, 19, 21];
export function nextPreset() {
  const i = SHORT.findIndex((h) => h > tod.hour + 0.05);
  tod.hour = i === -1 ? SHORT[0] : SHORT[i];
}

const lerp = (a, b, t) => a + (b - a) * t;

export function updatePalette(dt) {
  tod.hour = (tod.hour + dt * tod.speed) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].hour <= tod.hour) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  let t = (tod.hour - a.hour) / (b.hour - a.hour);
  t = t * t * (3 - 2 * t);
  shared.uSunDir.value.copy(a.sunDir).lerp(b.sunDir, t).normalize();
  shared.uSunColor.value.copy(a.sun).lerp(b.sun, t);
  shared.uShadowColor.value.copy(a.shadow).lerp(b.shadow, t);
  shared.uSkyTop.value.copy(a.top).lerp(b.top, t);
  shared.uHorizon.value.copy(a.horizon).lerp(b.horizon, t);
  shared.uFogColor.value.copy(a.fog).lerp(b.fog, t);
  shared.uGlowColor.value.copy(a.glow).lerp(b.glow, t);
  shared.uFogDensity.value = lerp(a.density, b.density, t);
  shared.uSunDisk.value = lerp(a.disk, b.disk, t);
  shared.uStars.value = lerp(a.stars, b.stars, t);
  tod.snowfall = lerp(a.snowfall, b.snowfall, t);
  tod.name = t < 0.5 ? a.name : b.name;
}
