// Time-of-day palettes. All colours are authored in sRGB hex and converted to
// linear by THREE.Color. The cycle blends smoothly between keyframes.
import * as THREE from '../vendor/three.module.js';

const K = (o) => o;

// sunEl / sunAz in degrees. Azimuth 0 = towards -Z (downhill, in front of the rider).
export const KEYS = [
  K({
    name: 'Рассвет', t: 0.0,
    sunEl: 6, sunAz: -60, keyIntensity: 1.6,
    sun: '#ffb38a', zenith: '#5a6fb8', horizon: '#ffc2a8', fog: '#e9b6b8', fogSun: '#ffd0a0',
    snowLit: '#fff1e6', snowShadow: '#7d86d6', ambTop: '#8c9be0', ambBottom: '#e8b8c8',
    exposure: 1.05, bloom: 0.55, rays: 0.55, stars: 0.15, aurora: 0.0, snowfall: 0.0, clouds: 0.5,
    lift: '#20142a', gain: '#fff4ec', sat: 1.08, fogDist: 1.0, lamp: 0.0,
  }),
  K({
    name: 'Утро', t: 0.16,
    sunEl: 24, sunAz: -35, keyIntensity: 2.1,
    sun: '#fff0dc', zenith: '#2058c8', horizon: '#a9d2fb', fog: '#b9d3f2', fogSun: '#fff0d6',
    snowLit: '#ffffff', snowShadow: '#5a83df', ambTop: '#86acff', ambBottom: '#dfe9ff',
    exposure: 1.0, bloom: 0.35, rays: 0.35, stars: 0.0, aurora: 0.0, snowfall: 0.0, clouds: 0.55,
    lift: '#0c1426', gain: '#ffffff', sat: 1.05, fogDist: 1.15, lamp: 0.0,
  }),
  K({
    name: 'День', t: 0.34,
    sunEl: 46, sunAz: 30, keyIntensity: 2.25,
    sun: '#fffaf0', zenith: '#1446b8', horizon: '#93c4f2', fog: '#aac8ee', fogSun: '#eaf3ff',
    snowLit: '#fbfcff', snowShadow: '#557ce0', ambTop: '#7aa2ff', ambBottom: '#dfe9ff',
    exposure: 0.95, bloom: 0.3, rays: 0.25, stars: 0.0, aurora: 0.0, snowfall: 0.0, clouds: 0.65,
    lift: '#0a1224', gain: '#ffffff', sat: 1.04, fogDist: 1.25, lamp: 0.0,
  }),
  K({
    name: 'Золотой час', t: 0.52,
    sunEl: 12, sunAz: 15, keyIntensity: 2.05,
    sun: '#ffd09a', zenith: '#3558b8', horizon: '#ffd2ae', fog: '#d9c4c4', fogSun: '#ffc888',
    snowLit: '#fff6ee', snowShadow: '#6a72d6', ambTop: '#8a98e0', ambBottom: '#f2d2c4',
    exposure: 1.0, bloom: 0.55, rays: 0.7, stars: 0.0, aurora: 0.0, snowfall: 0.0, clouds: 0.5,
    lift: '#1a1230', gain: '#fff8f0', sat: 1.1, fogDist: 1.1, lamp: 0.0,
  }),
  K({
    name: 'Закат', t: 0.64,
    sunEl: 2.5, sunAz: 5, keyIntensity: 1.9,
    sun: '#ff9a6e', zenith: '#3b3b8f', horizon: '#ff9e6e', fog: '#d98aa0', fogSun: '#ff8a4a',
    snowLit: '#fff0f0', snowShadow: '#5d58b8', ambTop: '#6f68c4', ambBottom: '#f0a0a0',
    exposure: 1.1, bloom: 0.8, rays: 0.95, stars: 0.1, aurora: 0.0, snowfall: 0.0, clouds: 0.45,
    lift: '#26103a', gain: '#ffe6dc', sat: 1.18, fogDist: 0.95, lamp: 0.15,
  }),
  K({
    name: 'Сумерки', t: 0.74,
    sunEl: -6, sunAz: 0, keyIntensity: 0.55,
    sun: '#9a7cff', zenith: '#16195a', horizon: '#6a5ab0', fog: '#4c4a96', fogSun: '#9a6ac0',
    snowLit: '#c9c6ff', snowShadow: '#3b3f9c', ambTop: '#4a50b0', ambBottom: '#7a68b8',
    exposure: 1.3, bloom: 0.75, rays: 0.25, stars: 0.6, aurora: 0.3, snowfall: 0.35, clouds: 0.35,
    lift: '#0c0a2a', gain: '#e6e4ff', sat: 1.12, fogDist: 0.85, lamp: 0.8,
  }),
  K({
    name: 'Ночь', t: 0.86,
    sunEl: -25, sunAz: 0, keyIntensity: 0.55,
    sun: '#8fb0ff', zenith: '#050a2a', horizon: '#1d3170', fog: '#1d2e6b', fogSun: '#2a4490',
    snowLit: '#b8ccff', snowShadow: '#1e2c7a', ambTop: '#2a3c99', ambBottom: '#3a4aa0',
    exposure: 1.55, bloom: 0.9, rays: 0.0, stars: 1.0, aurora: 1.0, snowfall: 0.7, clouds: 0.25,
    lift: '#050820', gain: '#dce6ff', sat: 1.15, fogDist: 0.8, lamp: 1.0,
    moon: true,
  }),
];

const COLOR_KEYS = ['sun', 'zenith', 'horizon', 'fog', 'fogSun', 'snowLit', 'snowShadow', 'ambTop', 'ambBottom', 'lift', 'gain'];
const NUM_KEYS = ['sunEl', 'sunAz', 'keyIntensity', 'exposure', 'bloom', 'rays', 'stars', 'aurora', 'snowfall', 'clouds', 'sat', 'fogDist', 'lamp'];

const prepared = KEYS.map((k) => {
  const o = { ...k };
  for (const c of COLOR_KEYS) o[c] = new THREE.Color(k[c]);
  return o;
});

function smooth(t) { return t * t * (3 - 2 * t); }

/** The live palette, updated by `samplePalette`. */
export function makePalette() {
  const p = { name: '', t: 0 };
  for (const c of COLOR_KEYS) p[c] = new THREE.Color();
  for (const n of NUM_KEYS) p[n] = 0;
  p.sunDir = new THREE.Vector3();
  p.moonDir = new THREE.Vector3();
  p.keyDir = new THREE.Vector3();
  p.night = 0;
  return p;
}

function dirFrom(el, az, out) {
  const e = THREE.MathUtils.degToRad(el), a = THREE.MathUtils.degToRad(az);
  out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
  return out;
}

const _moon = new THREE.Vector3();
export function samplePalette(t, out) {
  t = ((t % 1) + 1) % 1;
  let i = prepared.length - 1;
  for (let k = 0; k < prepared.length; k++) if (prepared[k].t <= t) i = k;
  const a = prepared[i];
  const b = prepared[(i + 1) % prepared.length];
  const ta = a.t, tb = b.t <= ta ? b.t + 1 : b.t;
  const f = smooth((t - ta) / (tb - ta));
  for (const c of COLOR_KEYS) out[c].copy(a[c]).lerp(b[c], f);
  for (const n of NUM_KEYS) out[n] = a[n] + (b[n] - a[n]) * f;
  // wrap night->dawn sun angles sensibly
  out.name = f < 0.5 ? a.name : b.name;
  out.t = t;
  dirFrom(out.sunEl, out.sunAz, out.sunDir);
  dirFrom(38, 160, _moon);
  out.moonDir.copy(_moon);
  // the key light is the sun while it is up, the moon when it is down
  const night = 1 - THREE.MathUtils.smoothstep(out.sunEl, -10, 2);
  out.night = night;
  out.keyDir.copy(out.sunDir);
  if (out.keyDir.y < 0.06) out.keyDir.y = 0.06;
  out.keyDir.normalize().lerp(out.moonDir, night).normalize();
  return out;
}

export function keyIndexAt(t) {
  t = ((t % 1) + 1) % 1;
  let i = KEYS.length - 1;
  for (let k = 0; k < KEYS.length; k++) if (KEYS[k].t <= t) i = k;
  return i;
}
