import * as THREE from 'three';

// Ключевые состояния по часам; между ними — плавная интерполяция.
// Цвета в sRGB (hex), интенсивности — в линейных единицах.
const K = [
  { h: 0.0, zenith: '#020836', horizon: '#2a4ad8', ground: '#1430a0', fog: '#2442c4', fogD: 0.0011,
    light: '#8aa6ff', lightI: 1.15, hemiSky: '#3355ff', hemiGround: '#2a3cc0', hemiI: 1.6, exposure: 1.3,
    stars: 1, aurora: 1, glow: 0, rays: 0, snow: '#dfe6ff', flakes: 1, sparkle: 0, trans: 0.25, sglow: 0.06 },
  { h: 4.8, zenith: '#030b40', horizon: '#2c48c8', ground: '#1430a0', fog: '#2844bc', fogD: 0.0011,
    light: '#8aa6ff', lightI: 1.0, hemiSky: '#3858ff', hemiGround: '#2a3cc0', hemiI: 1.5, exposure: 1.3,
    stars: 0.9, aurora: 0.5, glow: 0, rays: 0, snow: '#dfe6ff', flakes: 0.6, sparkle: 0, trans: 0.25, sglow: 0.06 },
  { h: 6.2, zenith: '#1b2a78', horizon: '#e88aa0', ground: '#6a5ab0', fog: '#b58ac8', fogD: 0.0009,
    light: '#ffa08a', lightI: 0.3, hemiSky: '#7a74e0', hemiGround: '#c89ad0', hemiI: 1.3, exposure: 1.15,
    stars: 0.2, aurora: 0, glow: 0.8, rays: 0.2, snow: '#f4eeff', flakes: 0.1, sparkle: 0, trans: 0.6, sglow: 0.05 },
  { h: 7.4, zenith: '#3b6ad0', horizon: '#ffd0a0', ground: '#d8b8d8', fog: '#f2d2c8', fogD: 0.0005,
    light: '#ffbf8a', lightI: 1.9, hemiSky: '#8a90f0', hemiGround: '#ffd8d8', hemiI: 1.25, exposure: 1.0,
    stars: 0, aurora: 0, glow: 1.1, rays: 0.5, snow: '#fff8f6', flakes: 0, sparkle: 0, trans: 1, sglow: 0.04 },
  { h: 9.5, zenith: '#1d4fe0', horizon: '#d4e4ff', ground: '#d8e2ff', fog: '#dfe8ff', fogD: 0.00045,
    light: '#fff2e0', lightI: 2.3, hemiSky: '#7f96ff', hemiGround: '#f4f2ff', hemiI: 1.35, exposure: 0.95,
    stars: 0, aurora: 0, glow: 1, rays: 0.15, snow: '#f8f9ff', flakes: 0, sparkle: 0, trans: 1, sglow: 0.04 },
  { h: 13.0, zenith: '#1848e0', horizon: '#d0e2ff', ground: '#d8e2ff', fog: '#dae6ff', fogD: 0.00042,
    light: '#fff5ea', lightI: 2.4, hemiSky: '#7a93ff', hemiGround: '#f4f2ff', hemiI: 1.35, exposure: 0.93,
    stars: 0, aurora: 0, glow: 1, rays: 0.1, snow: '#f8f9ff', flakes: 0, sparkle: 0, trans: 1, sglow: 0.04 },
  { h: 16.4, zenith: '#2050d0', horizon: '#ffe0b8', ground: '#e8d8e8', fog: '#f0e0d8', fogD: 0.00045,
    light: '#ffd49a', lightI: 2.3, hemiSky: '#8090f0', hemiGround: '#ffe6e0', hemiI: 1.3, exposure: 0.95,
    stars: 0, aurora: 0, glow: 1.1, rays: 0.4, snow: '#fffaf6', flakes: 0, sparkle: 0, trans: 1.1, sglow: 0.04 },
  { h: 18.4, zenith: '#135a5a', horizon: '#ffa63a', ground: '#b45a8a', fog: '#e7869a', fogD: 0.0006,
    light: '#ff9c55', lightI: 2.3, hemiSky: '#7a48d0', hemiGround: '#ff8fb0', hemiI: 1.35, exposure: 1.0,
    stars: 0, aurora: 0, glow: 1.5, rays: 1, snow: '#fff0f4', flakes: 0, sparkle: 0, trans: 1.4, sglow: 0.05 },
  { h: 19.4, zenith: '#0d2a5c', horizon: '#d06078', ground: '#4a3a90', fog: '#6a4aa0', fogD: 0.001,
    light: '#ff7a6a', lightI: 0.25, hemiSky: '#5a48e0', hemiGround: '#8a5ac0', hemiI: 1.35, exposure: 1.2,
    stars: 0.3, aurora: 0, glow: 0.9, rays: 0.3, snow: '#f2ecff', flakes: 0.2, sparkle: 0, trans: 0.5, sglow: 0.05 },
  { h: 20.6, zenith: '#020836', horizon: '#2a4ad8', ground: '#1430a0', fog: '#2442c4', fogD: 0.0011,
    light: '#8aa6ff', lightI: 1.1, hemiSky: '#3355ff', hemiGround: '#2a3cc0', hemiI: 1.6, exposure: 1.3,
    stars: 1, aurora: 0.85, glow: 0, rays: 0, snow: '#dfe6ff', flakes: 0.9, sparkle: 0, trans: 0.25, sglow: 0.06 },
];

const COLOR_KEYS = ['zenith', 'horizon', 'ground', 'fog', 'light', 'hemiSky', 'hemiGround', 'snow'];
const NUM_KEYS = ['fogD', 'lightI', 'hemiI', 'exposure', 'stars', 'aurora', 'glow', 'rays', 'flakes', 'sparkle', 'trans', 'sglow'];
const parsed = K.map((k) => {
  const o = { h: k.h };
  COLOR_KEYS.forEach((c) => { o[c] = new THREE.Color(k[c]); });
  NUM_KEYS.forEach((n) => { o[n] = k[n]; });
  return o;
});

function sample(hour) {
  const h = ((hour % 24) + 24) % 24;
  let i = parsed.length - 1;
  for (let k = 0; k < parsed.length; k++) if (parsed[k].h <= h) i = k;
  const a = parsed[i], b = parsed[(i + 1) % parsed.length];
  let span = b.h - a.h; if (span <= 0) span += 24;
  let t = h - a.h; if (t < 0) t += 24;
  t = THREE.MathUtils.smootherstep(t / span, 0, 1);
  const out = {};
  COLOR_KEYS.forEach((c) => { out[c] = a[c].clone().lerp(b[c], t); });
  NUM_KEYS.forEach((n) => { out[n] = a[n] + (b[n] - a[n]) * t; });
  return out;
}

const RAD = Math.PI / 180;

// Положение солнца: восход на востоке (+X), днём солнце за спиной у смотрящего вниз по склону
// (тени тянутся к зрителю, склон освещён — как в видео), закат на западе.
export function sunDirection(hour, out = new THREE.Vector3()) {
  const ang = Math.PI * (hour - 6.6) / 12.8;
  const el = (54 * Math.sin(ang) - 2) * RAD;
  const az = ang;
  return out.set(Math.cos(az) * Math.cos(el), Math.sin(el), -Math.sin(az) * Math.cos(el));
}

export function moonDirection(hour, out = new THREE.Vector3()) {
  const ang = Math.PI * (hour - 18.6) / 12.8;
  const el = Math.max(18, 48 * Math.sin(ang) + 6) * RAD;
  const az = ang + 0.5;
  return out.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
}

export class TimeOfDay {
  constructor(ctx) {
    this.ctx = ctx; // { renderer, scene, sun, hemi, sky, shared, snowfall }
    this.hour = 13;
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.state = null;
  }

  set(hour) {
    this.hour = ((hour % 24) + 24) % 24;
    const s = sample(this.hour);
    this.state = s;
    const { renderer, scene, sun, hemi, sky, shared, snowfall } = this.ctx;
    sunDirection(this.hour, this.sunDir);
    moonDirection(this.hour, this.moonDir);
    // днём светит солнце, ночью — луна; переключение в сумерках, когда свет почти погас
    const sunEl = Math.asin(this.sunDir.y) / RAD;
    const useSun = sunEl > -4;
    this.lightDir.copy(useSun ? this.sunDir : this.moonDir);
    if (useSun && this.lightDir.y < 0.035) this.lightDir.y = 0.035;
    this.lightDir.normalize();
    let fade = 1;
    if (useSun) fade = THREE.MathUtils.smoothstep(sunEl, -4, 3);
    else fade = THREE.MathUtils.smoothstep(-sunEl, 4, 12);

    renderer.toneMappingExposure = s.exposure;
    scene.fog.color.copy(s.fog);
    scene.fog.density = s.fogD;
    sun.color.copy(s.light);
    sun.intensity = s.lightI * fade;
    hemi.color.copy(s.hemiSky);
    hemi.groundColor.copy(s.hemiGround);
    hemi.intensity = s.hemiI;

    const u = sky.uniforms;
    u.uZenith.value.copy(s.zenith);
    u.uHorizon.value.copy(s.fog).lerp(s.horizon, 0.55);
    u.uGround.value.copy(s.fog);
    u.uSunDir.value.copy(this.sunDir);
    u.uSunColor.value.copy(s.light);
    u.uSunGlow.value = s.glow * THREE.MathUtils.smoothstep(sunEl, -8, 1);
    u.uMoonDir.value.copy(this.moonDir);
    u.uStars.value = s.stars;
    u.uAurora.value = s.aurora;
    u.uRays.value = s.rays;

    shared.uSunDir.value.copy(this.lightDir);
    shared.uSunColor.value.copy(s.light).multiplyScalar(fade);
    shared.uSnowColor.value.copy(s.snow);
    shared.uSparkle.value = s.sparkle;
    shared.uTranslucency.value = s.trans;
    shared.uSelfLit.value = 0.12 + 0.2 * Math.min(1, s.trans);
    shared.uSnowGlow.value = s.sglow;

    if (snowfall) {
      snowfall.uniforms.uColor.value.copy(s.snow).lerp(s.hemiSky, 0.25);
      this.flakesAuto = s.flakes;
    }
  }

  static label(hour) {
    const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
