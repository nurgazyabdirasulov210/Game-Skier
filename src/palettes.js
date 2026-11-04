// Moods of the map. Colours are sRGB hex, angles in degrees.
// Sun azimuth is measured from downhill (+Z) toward +X.
import * as THREE from 'three';

export const PALETTES = {
  day: {
    name: 'Солнечный день',
    sun: { az: 215, el: 34 }, sunColor: '#fff0dc', sunI: 3.6,
    hemiSky: '#5c7cff', hemiGround: '#a294ff', hemiI: 1.35,
    zenith: '#0a3cc4', horizon: '#b4cdff', glow: '#fff3e0', glowI: 0.5, disc: '#fffaf0', discI: 6, discSize: 0.0009,
    fog: '#b2c8ff', fogSun: '#fff2e2', fogDensity: 0.00038, fogFalloff: 0.0045,
    rim: '#7f99ff', rimI: 0.35, snow: '#ffffff', sparkle: 0.6,
    birchA: '#ff7a2a', birchB: '#ffb255', tuftA: '#b9d27c', tuftB: '#f0e39a', birchShade: '#c98bb8', tuftShade: '#8fa6b0', translucency: 1.3,
    needles: '#1c3a50', rock: '#262c62', bark: '#ffffff', pineBark: '#b9a9b8',
    ice: '#86c4f2', iceDeep: '#2d5aa8',
    stars: 0, aurora: 0, clouds: 0, cloudColor: '#ffffff', snowfall: 0.08, flake: '#ffffff',
    exposure: 0.92, bloom: { strength: 0.32, radius: 0.55, threshold: 1.05 },
    grade: { sat: 1.18, contrast: 1.04, lift: '#10123a', gain: '#fffaf6', vignette: 0.28, streaks: 0, streakColor: '#ffffff' },
  },
  morning: {
    name: 'Ясное утро',
    sun: { az: 160, el: 44 }, sunColor: '#fff7ec', sunI: 2.7,
    hemiSky: '#9ab0ff', hemiGround: '#dcdcff', hemiI: 2.0,
    zenith: '#3470e0', horizon: '#e2ecff', glow: '#ffffff', glowI: 0.35, disc: '#ffffff', discI: 5, discSize: 0.0009,
    fog: '#dde6ff', fogSun: '#fff6ea', fogDensity: 0.00055, fogFalloff: 0.004,
    rim: '#a8b8ff', rimI: 0.3, snow: '#ffffff', sparkle: 0.5,
    birchA: '#ff9a4a', birchB: '#ffc777', tuftA: '#a6c870', tuftB: '#e6e6a2', birchShade: '#d49cb4', tuftShade: '#93ae9c', translucency: 1.0,
    needles: '#2a4a50', rock: '#2c3466', bark: '#ffffff', pineBark: '#c9b9c4',
    ice: '#a4d4f6', iceDeep: '#4a7ac0',
    stars: 0, aurora: 0, clouds: 0.25, cloudColor: '#f4f6ff', snowfall: 0.0, flake: '#ffffff',
    exposure: 0.9, bloom: { strength: 0.25, radius: 0.5, threshold: 1.1 },
    grade: { sat: 1.1, contrast: 1.02, lift: '#141a40', gain: '#fbfbff', vignette: 0.22, streaks: 0, streakColor: '#ffffff' },
  },
  twilight: {
    name: 'Синие сумерки',
    sun: { az: 25, el: 16 }, sunColor: '#9cc2ff', sunI: 1.9,
    hemiSky: '#4d78ff', hemiGround: '#6f8aff', hemiI: 1.9,
    zenith: '#040b40', horizon: '#3567dc', glow: '#86b6ff', glowI: 0.5, disc: '#dfeaff', discI: 3, discSize: 0.0005,
    fog: '#3f6fe0', fogSun: '#9fc4ff', fogDensity: 0.00075, fogFalloff: 0.0035,
    rim: '#5f8dff', rimI: 0.45, snow: '#e6eeff', sparkle: 0.9,
    birchA: '#e88a52', birchB: '#ffc49a', tuftA: '#8fb4a8', tuftB: '#c4dccc', birchShade: '#7a6ac8', tuftShade: '#5a7aa8', translucency: 1.0,
    needles: '#0e1d5e', rock: '#151b46', bark: '#c8d2ff', pineBark: '#8a8aa8',
    ice: '#5f9cf0', iceDeep: '#13307a',
    stars: 0.8, aurora: 0, clouds: 0.55, cloudColor: '#5c86e6', snowfall: 0.35, flake: '#cfe0ff',
    exposure: 1.0, bloom: { strength: 0.45, radius: 0.6, threshold: 0.8 },
    grade: { sat: 1.22, contrast: 1.05, lift: '#08105a', gain: '#eef4ff', vignette: 0.35, streaks: 0, streakColor: '#ffffff' },
  },
  night: {
    name: 'Северное сияние',
    sun: { az: 120, el: 22 }, sunColor: '#8fb0ff', sunI: 2.1,
    hemiSky: '#2a4cff', hemiGround: '#3a44d6', hemiI: 1.55,
    zenith: '#020630', horizon: '#14309a', glow: '#6f8fff', glowI: 0.3, disc: '#eef3ff', discI: 4, discSize: 0.0004,
    fog: '#1f3cb8', fogSun: '#5f7fe8', fogDensity: 0.0008, fogFalloff: 0.0035,
    rim: '#3d5cff', rimI: 0.5, snow: '#c9d6ff', sparkle: 1.0,
    birchA: '#c8703f', birchB: '#e8a56c', tuftA: '#6f9a9a', tuftB: '#a8c8c0', birchShade: '#6a4cb0', tuftShade: '#4a6a9a', translucency: 0.8,
    needles: '#0a1656', rock: '#10164a', bark: '#a8b8ff', pineBark: '#7a7aa8',
    ice: '#3f78e8', iceDeep: '#0b1e66',
    stars: 1.0, aurora: 1.0, clouds: 0, cloudColor: '#3050c0', snowfall: 0.6, flake: '#c8d8ff',
    exposure: 1.05, bloom: { strength: 0.55, radius: 0.65, threshold: 0.7 },
    grade: { sat: 1.3, contrast: 1.06, lift: '#06106a', gain: '#e8eeff', vignette: 0.4, streaks: 0, streakColor: '#ffffff' },
  },
  sunset: {
    name: 'Закат',
    sun: { az: 8, el: 7 }, sunColor: '#ffae66', sunI: 3.6,
    hemiSky: '#6a52e6', hemiGround: '#e0708e', hemiI: 1.7,
    zenith: '#0d4a58', horizon: '#ff9a5c', glow: '#ffcf6e', glowI: 1.6, disc: '#fff6d8', discI: 10, discSize: 0.0016,
    fog: '#d77b98', fogSun: '#ffcc70', fogDensity: 0.0006, fogFalloff: 0.004,
    rim: '#ff8fb0', rimI: 0.4, snow: '#ffe0e6', sparkle: 0.7,
    birchA: '#ff4e33', birchB: '#ff8a45', tuftA: '#c6703e', tuftB: '#f0a25a', birchShade: '#8a3a8a', tuftShade: '#7a4080', translucency: 2.2,
    needles: '#3a1f54', rock: '#2b1d52', bark: '#ffd8dc', pineBark: '#b08aa8',
    ice: '#ff9fb4', iceDeep: '#5a3a9a',
    stars: 0, aurora: 0, clouds: 0.45, cloudColor: '#f8a0b4', snowfall: 0.05, flake: '#ffe8d8',
    exposure: 0.95, bloom: { strength: 0.75, radius: 0.7, threshold: 0.85 },
    grade: { sat: 1.25, contrast: 1.05, lift: '#2a0d4a', gain: '#fff4ec', vignette: 0.35, streaks: 0.9, streakColor: '#fff0c8' },
  },
};

export const PALETTE_ORDER = ['day', 'morning', 'twilight', 'night', 'sunset'];

/** Flattens a palette into numbers and THREE.Color objects for blending. */
export function resolvePalette(p) {
  const out = {};
  const walk = (src, dst) => {
    for (const [k, v] of Object.entries(src)) {
      if (k === 'name') continue;
      if (typeof v === 'string' && v.startsWith('#')) dst[k] = new THREE.Color(v);
      else if (typeof v === 'object') { dst[k] = {}; walk(v, dst[k]); }
      else dst[k] = v;
    }
  };
  walk(p, out);
  return out;
}

export function blendPalettes(a, b, t, out = {}) {
  for (const k of Object.keys(a)) {
    const va = a[k], vb = b[k];
    if (va instanceof THREE.Color) out[k] = (out[k] instanceof THREE.Color ? out[k] : new THREE.Color()).copy(va).lerp(vb, t);
    else if (typeof va === 'number') out[k] = va + (vb - va) * t;
    else if (typeof va === 'object') out[k] = blendPalettes(va, vb, t, out[k] || {});
  }
  return out;
}

export function sunVector(az, el, out = new THREE.Vector3()) {
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).normalize();
}
