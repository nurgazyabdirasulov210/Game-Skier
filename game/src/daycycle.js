import * as THREE from '../vendor/three.module.js';
import { G } from './shaderlib.js';

// Ключевые кадры палитры. t: 0 — полночь, 0.25 — рассвет, 0.5 — полдень, 0.75 — закат.
const RAW = [
  { t: 0.00, top: '#040a2c', hor: '#1c2c80', glow: '#000000', sun: '#5f7dff', si: 0.62, amb: '#2a3cb0', gnd: '#111a5e', fog: 0.0021, night: 1.0 },
  { t: 0.19, top: '#091040', hor: '#33398f', glow: '#2a1f60', sun: '#6f7ce6', si: 0.42, amb: '#3442a8', gnd: '#161c62', fog: 0.0022, night: 0.85 },
  { t: 0.225, top: '#1d2a78', hor: '#c8708a', glow: '#ff6a48', sun: '#ff8a5a', si: 0.35, amb: '#5a50b0', gnd: '#2a2270', fog: 0.0023, night: 0.35 },
  { t: 0.255, top: '#2c4296', hor: '#ffac80', glow: '#ff8a46', sun: '#ffaa6a', si: 1.3, amb: '#7a74cc', gnd: '#363086', fog: 0.0018, night: 0.0 },
  { t: 0.31, top: '#3168d0', hor: '#ffd2b4', glow: '#ffbe84', sun: '#ffd8b0', si: 1.75, amb: '#8498e2', gnd: '#4c58aa', fog: 0.0013, night: 0 },
  { t: 0.40, top: '#1f5ad8', hor: '#a6c8ff', glow: '#fff1d6', sun: '#fff4e4', si: 1.9, amb: '#86a6ee', gnd: '#5266bc', fog: 0.0009, night: 0 },
  { t: 0.50, top: '#1b56d6', hor: '#a8caff', glow: '#ffffff', sun: '#ffffff', si: 2.0, amb: '#8aa9f0', gnd: '#566abf', fog: 0.0009, night: 0 },
  { t: 0.62, top: '#2058d2', hor: '#b0ceff', glow: '#fff0d8', sun: '#fff0dc', si: 1.95, amb: '#8aa6ea', gnd: '#5868b8', fog: 0.001, night: 0 },
  { t: 0.69, top: '#2a4cb4', hor: '#ffc89e', glow: '#ffa45e', sun: '#ffc282', si: 1.8, amb: '#8a82d8', gnd: '#46409e', fog: 0.0013, night: 0 },
  { t: 0.745, top: '#24308c', hor: '#ff9a5c', glow: '#ff7a30', sun: '#ffb058', si: 1.8, amb: '#6a58c6', gnd: '#2c2280', fog: 0.0018, night: 0.0 },
  { t: 0.775, top: '#191c66', hor: '#b45486', glow: '#d0406a', sun: '#c86a9a', si: 0.45, amb: '#5e3ea6', gnd: '#2a2070', fog: 0.0022, night: 0.4 },
  { t: 0.82, top: '#080d3a', hor: '#2a338e', glow: '#30206a', sun: '#6a78e6', si: 0.45, amb: '#2e3cac', gnd: '#141a60', fog: 0.0021, night: 0.9 },
  { t: 1.00, top: '#040a2c', hor: '#1c2c80', glow: '#000000', sun: '#5f7dff', si: 0.62, amb: '#2a3cb0', gnd: '#111a5e', fog: 0.0021, night: 1.0 },
];
const KEYS = RAW.map((k) => ({
  t: k.t, si: k.si, fog: k.fog, night: k.night,
  top: new THREE.Color(k.top), hor: new THREE.Color(k.hor), glow: new THREE.Color(k.glow),
  sun: new THREE.Color(k.sun), amb: new THREE.Color(k.amb), gnd: new THREE.Color(k.gnd),
}));

export const TIME_PRESETS = { dawn: 0.262, day: 0.42, sunset: 0.735, night: 0.95 };
export const TIME_NAMES = [
  [0.0, 'ночь'], [0.215, 'рассвет'], [0.3, 'утро'], [0.45, 'день'], [0.66, 'вечер'], [0.715, 'закат'], [0.79, 'сумерки'], [0.83, 'ночь'],
];

const tmpC = new THREE.Color();

export class DayCycle {
  constructor() {
    this.t = TIME_PRESETS.day;
    this.speed = 1 / 420;     // полный цикл ≈ 7 минут
    this.running = true;
    this.skip = 0;
    this.sunDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.current = {};
  }
  set(t) { this.t = ((t % 1) + 1) % 1; }
  skipTo(t) { this.skip = ((t - this.t) % 1 + 1) % 1; }
  name() {
    let n = 'ночь';
    for (const [t, s] of TIME_NAMES) if (this.t >= t) n = s;
    return n;
  }
  update(dt) {
    if (this.skip > 0) {
      const step = Math.min(this.skip, dt * 0.12);
      this.t = (this.t + step) % 1; this.skip -= step;
    } else if (this.running) {
      this.t = (this.t + dt * this.speed) % 1;
    }
    const t = this.t;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].t <= t) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    let f = (t - a.t) / (b.t - a.t);
    f = f * f * (3 - 2 * f);
    const L = (ca, cb, out) => out.copy(ca).lerp(cb, f);

    L(a.top, b.top, G.uSkyTop.value);
    L(a.hor, b.hor, G.uSkyHor.value);
    L(a.glow, b.glow, G.uGlowCol.value);
    L(a.amb, b.amb, G.uSkyAmb.value);
    L(a.gnd, b.gnd, G.uGndAmb.value);
    const si = a.si + (b.si - a.si) * f;
    L(a.sun, b.sun, tmpC);
    G.uSunCol.value.copy(tmpC).multiplyScalar(si * 0.62);
    G.uFogDen.value = a.fog + (b.fog - a.fog) * f;
    G.uNight.value = a.night + (b.night - a.night) * f;

    // солнце: восход сбоку-сзади, закат впереди по склону
    const phi = (t - 0.25) * Math.PI * 2;
    const elev = Math.sin(phi) * 0.52 + 0.07;
    const th = -0.35 + (phi / Math.PI) * 2.45;
    const ch = Math.cos(Math.asin(Math.max(-1, Math.min(1, elev))));
    this.sunDir.set(Math.cos(th) * ch, elev, Math.sin(th) * ch).normalize();
    G.uSunDisc.value.copy(this.sunDir);
    const moon = G.uMoonDir.value.set(-this.sunDir.x, Math.max(0.35, -this.sunDir.y * 0.8), -this.sunDir.z).normalize();

    let k = (this.sunDir.y + 0.1) / 0.15; k = Math.max(0, Math.min(1, k)); k = k * k * (3 - 2 * k);
    this.lightDir.copy(moon).lerp(this.sunDir, k);
    this.lightDir.y = Math.max(this.lightDir.y, 0.07);
    this.lightDir.normalize();
    G.uSunDir.value.copy(this.lightDir);
    this.current.si = si;
  }
}
