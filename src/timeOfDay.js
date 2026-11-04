import * as THREE from 'three';

// Ключевые состояния по часам; между ними — плавная интерполяция.
// Цвета в sRGB (hex), интенсивности — в линейных единицах.
const K = [
  { h: 0.0, zenith: '#02061a', horizon: '#1d3590', ground: '#0c1648', fog: '#1b3184', fogD: 0.00028,
    light: '#7f97ff', lightI: 1.05, hemiSky: '#3b5cff', hemiGround: '#2a3aa8', hemiI: 1.2, exposure: 1.3,
    stars: 1, aurora: 1, glow: 0, cirrus: 0.15, snow: '#e6ecff', flakes: 1, sparkle: 0.6, trans: 0.2 },
  { h: 4.6, zenith: '#040b2c', horizon: '#26398f', ground: '#0e1a50', fog: '#20368a', fogD: 0.00028,
    light: '#7f97ff', lightI: 0.9, hemiSky: '#3b5cff', hemiGround: '#2a3aa8', hemiI: 1.1, exposure: 1.3,
    stars: 0.9, aurora: 0.6, glow: 0, cirrus: 0.2, snow: '#e6ecff', flakes: 0.6, sparkle: 0.5, trans: 0.2 },
  { h: 6.1, zenith: '#13245e', horizon: '#c0779a', ground: '#3a3a78', fog: '#7a6aa8', fogD: 0.00026,
    light: '#ff9e7a', lightI: 0.15, hemiSky: '#6b78d8', hemiGround: '#a68ab8', hemiI: 0.95, exposure: 1.2,
    stars: 0.25, aurora: 0, glow: 0.8, cirrus: 0.5, snow: '#f1f2ff', flakes: 0.1, sparkle: 0.5, trans: 0.6 },
  { h: 7.3, zenith: '#3a64b8', horizon: '#ffbf8f', ground: '#a9a0c8', fog: '#f0c4a8', fogD: 0.00022,
    light: '#ffb684', lightI: 1.9, hemiSky: '#8296e6', hemiGround: '#f0c8c8', hemiI: 0.95, exposure: 1.0,
    stars: 0, aurora: 0, glow: 1, cirrus: 0.6, snow: '#f6f6ff', flakes: 0, sparkle: 1, trans: 1 },
  { h: 9.5, zenith: '#1f5fd6', horizon: '#a9d0ff', ground: '#b8cdef', fog: '#bdd6fa', fogD: 0.00013,
    light: '#fff0d8', lightI: 2.5, hemiSky: '#6a98ff', hemiGround: '#d6e2ff', hemiI: 1.15, exposure: 0.88,
    stars: 0, aurora: 0, glow: 1, cirrus: 0.55, snow: '#f2f6ff', flakes: 0, sparkle: 1, trans: 1 },
  { h: 13.0, zenith: '#1857d2', horizon: '#a2ccff', ground: '#b8cdef', fog: '#b6d2fa', fogD: 0.00012,
    light: '#fff3e2', lightI: 2.6, hemiSky: '#6593ff', hemiGround: '#d6e2ff', hemiI: 1.15, exposure: 0.86,
    stars: 0, aurora: 0, glow: 1, cirrus: 0.45, snow: '#f2f6ff', flakes: 0, sparkle: 1, trans: 1 },
  { h: 16.4, zenith: '#2258b8', horizon: '#ffd3a0', ground: '#c9c0d8', fog: '#e8d2c0', fogD: 0.00015,
    light: '#ffcb88', lightI: 2.4, hemiSky: '#7090f0', hemiGround: '#f0d6d0', hemiI: 1.05, exposure: 0.9,
    stars: 0, aurora: 0, glow: 1, cirrus: 0.6, snow: '#f6f4ff', flakes: 0, sparkle: 1, trans: 1 },
  { h: 18.2, zenith: '#18506e', horizon: '#ff9442', ground: '#8a5a8a', fog: '#e89068', fogD: 0.00026,
    light: '#ff9a52', lightI: 2.0, hemiSky: '#7d58c2', hemiGround: '#ffa0a8', hemiI: 1.0, exposure: 1.0,
    stars: 0, aurora: 0, glow: 1.2, cirrus: 0.75, snow: '#fff2f6', flakes: 0, sparkle: 1, trans: 1.3 },
  { h: 19.3, zenith: '#0f2c5e', horizon: '#c8566a', ground: '#3a2a64', fog: '#6a4890', fogD: 0.00027,
    light: '#ff7a6a', lightI: 0.25, hemiSky: '#5b4fd0', hemiGround: '#8a5ab0', hemiI: 1.0, exposure: 1.15,
    stars: 0.3, aurora: 0, glow: 0.9, cirrus: 0.5, snow: '#f2ecff', flakes: 0.2, sparkle: 0.5, trans: 0.5 },
  { h: 20.6, zenith: '#03081f', horizon: '#22378f', ground: '#0e1850', fog: '#1d3488', fogD: 0.00028,
    light: '#7f97ff', lightI: 0.95, hemiSky: '#3b5cff', hemiGround: '#2a3aa8', hemiI: 1.15, exposure: 1.3,
    stars: 1, aurora: 0.85, glow: 0, cirrus: 0.15, snow: '#e6ecff', flakes: 0.9, sparkle: 0.6, trans: 0.2 },
];

const COLOR_KEYS = ['zenith', 'horizon', 'ground', 'fog', 'light', 'hemiSky', 'hemiGround', 'snow'];
const NUM_KEYS = ['fogD', 'lightI', 'hemiI', 'exposure', 'stars', 'aurora', 'glow', 'cirrus', 'flakes', 'sparkle', 'trans'];
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

// Положение солнца: восход на востоке (+X), полдень на юге (+Z, вниз по склону), закат на западе.
export function sunDirection(hour, out = new THREE.Vector3()) {
  const ang = Math.PI * (hour - 6.6) / 12.8;
  const el = (54 * Math.sin(ang) - 2) * RAD;
  const az = ang;
  return out.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
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
    u.uCirrus.value = s.cirrus;

    shared.uSunDir.value.copy(this.lightDir);
    shared.uSunColor.value.copy(s.light).multiplyScalar(fade);
    shared.uSnowColor.value.copy(s.snow);
    shared.uSparkle.value = s.sparkle;
    shared.uTranslucency.value = s.trans;
    shared.uSelfLit.value = 0.1 + 0.22 * Math.min(1, s.trans);

    if (this.ctx.cloudMat) this.ctx.cloudMat.emissive.copy(s.fog).lerp(s.hemiSky, 0.3).multiplyScalar(0.32);

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
