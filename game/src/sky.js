// Sky dome (gradient, sun, stars, aurora) and a ring of far-away peaks.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uSunGlow: { value: 0.3 },
      uStars: { value: 0 },
      uAurora: { value: 0 },
      uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor;
        uniform float uSunGlow, uStars, uAurora, uTime;
        varying vec3 vDir;
        float hash(vec3 p) { p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
        void main() {
          vec3 d = normalize(vDir);
          float y = d.y;
          vec3 col = y > 0.0 ? mix(uHorizon, uTop, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(uHorizon, uBottom, clamp(-y * 4.0, 0.0, 1.0));
          // soft band of haze at the horizon
          col = mix(col, uHorizon * 1.06, exp(-abs(y) * 18.0) * 0.5);
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunColor * (pow(s, 900.0) * 6.0 + pow(s, 60.0) * 0.5 * uSunGlow + pow(s, 6.0) * 0.35 * uSunGlow);
          // soft drifting clouds low over the ranges
          if (y > 0.0) {
            vec2 cp = d.xz / (y + 0.12) * 1.6 + vec2(uTime * 0.01, 0.0);
            float cl = vn(cp) * 0.55 + vn(cp * 2.3 + 4.0) * 0.3 + vn(cp * 5.1 - 2.0) * 0.15;
            float cover = smoothstep(0.52, 0.8, cl) * smoothstep(0.0, 0.06, y) * (1.0 - smoothstep(0.25, 0.5, y));
            vec3 cc = mix(uHorizon * 1.08, uSunColor, 0.25 + 0.5 * pow(s, 4.0)) + uSunColor * pow(s, 20.0) * 0.6 * uSunGlow;
            col = mix(col, cc, cover * 0.75 * (1.0 - uStars * 0.6));
          }
          if (uStars > 0.0 && y > 0.0) {
            vec3 g = floor(d * 380.0);
            float h = hash(g);
            float tw = 0.6 + 0.4 * sin(uTime * 2.0 + h * 40.0);
            col += vec3(0.85, 0.9, 1.0) * step(0.9965, h) * tw * smoothstep(0.02, 0.25, y) * uStars * 1.4;
          }
          if (uAurora > 0.0 && y > 0.0) {
            float a = atan(d.x, d.z);
            vec3 acc = vec3(0.0);
            for (int k = 0; k < 3; k++) {
              float fk = float(k);
              float wave = sin(a * (2.0 + fk) + uTime * (0.05 + fk * 0.02) + fk * 2.0) * 0.08 + vn(vec2(a * 3.0 + fk * 7.0, uTime * 0.05)) * 0.12;
              float base = 0.16 + fk * 0.07 + wave;
              float band = smoothstep(base - 0.01, base + 0.02, y) * exp(-max(y - base, 0.0) * (7.0 - fk));
              float rays = 0.45 + 0.55 * vn(vec2(a * 70.0 + fk * 13.0, uTime * 0.4));
              float vis = smoothstep(0.1, 0.7, vn(vec2(a * 1.4 + fk * 3.0 + uTime * 0.03, fk)));
              vec3 c = mix(vec3(0.1, 1.0, 0.65), vec3(0.2, 0.75, 1.0), fk * 0.5);
              acc += c * band * rays * vis;
            }
            acc += vec3(0.6, 0.25, 1.0) * smoothstep(0.35, 0.6, y) * 0.0;
            col += acc * 0.75 * uAurora;
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // distant ranges
    this.mUniforms = {
      uLit: { value: new THREE.Color() },
      uShade: { value: new THREE.Color() },
      uHaze: { value: new THREE.Color() },
      uSunDir: this.uniforms.uSunDir,
    };
    const geo = this._ranges();
    const mmat = new THREE.ShaderMaterial({
      uniforms: this.mUniforms,
      fog: false,
      vertexShader: /* glsl */`
        attribute float aLayer;
        varying vec3 vN; varying float vH; varying float vL;
        void main() {
          vN = normal; vH = position.y; vL = aLayer;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uLit, uShade, uHaze, uSunDir;
        varying vec3 vN; varying float vH; varying float vL;
        void main() {
          float l = clamp(dot(normalize(vN), normalize(uSunDir)) * 1.4, 0.0, 1.0);
          vec3 c = mix(uShade, uLit, l);
          float haze = mix(0.25, 0.7, vL) + (1.0 - smoothstep(0.0, 500.0, vH)) * 0.25;
          c = mix(c, uHaze, clamp(haze, 0.0, 0.95));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.ranges = new THREE.Mesh(geo, mmat);
    this.ranges.frustumCulled = false;
    this.ranges.renderOrder = -9;
    scene.add(this.ranges);
  }

  _ranges() {
    const r = mulberry32(42);
    const pos = [], nor = [], lay = [];
    const layers = [[2600, 520], [3200, 760]];
    const tmp = new THREE.Vector3();
    layers.forEach(([R, H], li) => {
      const N = 180;
      const peaks = [];
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const h = H * (0.25 + 0.75 * Math.pow(Math.abs(Math.sin(a * (3 + li) + r() * 0.5)) * 0.6 + r() * 0.4, 1.6));
        peaks.push([Math.cos(a) * R, h, Math.sin(a) * R]);
      }
      for (let i = 0; i < N; i++) {
        const a = peaks[i], b = peaks[i + 1];
        const mid = [(a[0] + b[0]) / 2 * 0.985, Math.max(a[1], b[1]) * (0.9 + r() * 0.25), (a[2] + b[2]) / 2 * 0.985];
        const base = -900;
        const tris = [
          [[a[0], base, a[2]], a, mid],
          [[a[0], base, a[2]], mid, [b[0], base, b[2]]],
          [[b[0], base, b[2]], mid, b],
        ];
        for (const t of tris) {
          const e1 = new THREE.Vector3(...t[1]).sub(new THREE.Vector3(...t[0]));
          const e2 = new THREE.Vector3(...t[2]).sub(new THREE.Vector3(...t[0]));
          tmp.crossVectors(e2, e1).normalize();
          // facing inwards to the viewer
          const c = new THREE.Vector3(...t[0]).add(new THREE.Vector3(...t[1])).add(new THREE.Vector3(...t[2]));
          if (tmp.dot(c) > 0) tmp.negate();
          for (const v of t) { pos.push(...v); nor.push(tmp.x, tmp.y, tmp.z); lay.push(li); }
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('aLayer', new THREE.Float32BufferAttribute(lay, 1));
    return g;
  }

  setMood(m, sunDir) {
    const u = this.uniforms;
    u.uTop.value.copy(m.skyTop);
    u.uHorizon.value.copy(m.skyHorizon);
    u.uBottom.value.copy(m.skyBottom);
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(m.sunDisk);
    u.uSunGlow.value = m.sunGlow;
    u.uStars.value = m.stars;
    u.uAurora.value = m.aurora;
    this.mUniforms.uLit.value.copy(m.mountains);
    this.mUniforms.uShade.value.copy(m.mountainShade);
    this.mUniforms.uHaze.value.copy(m.skyHorizon).lerp(m.fog, 0.5);
  }

  update(camera, t) {
    this.uniforms.uTime.value = t;
    this.mesh.position.copy(camera.position);
    this.ranges.position.set(camera.position.x, camera.position.y - 380, camera.position.z);
  }
}
