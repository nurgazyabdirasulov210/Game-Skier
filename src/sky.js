// Sky dome: gradient, sun or moon with glow, soft cloud banks, stars and an
// aurora. Plus falling snow around the camera.
import * as THREE from 'three';
import { U } from './shading.js';

export function buildSky(radius) {
  const uniforms = {
    uSunDir: U.uSunDir,
    uFogColor: U.uFogColor,
    uFogSunColor: U.uFogSunColor,
    uTime: U.uTime,
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlowColor: { value: new THREE.Color() },
    uGlow: { value: 1 },
    uDiscColor: { value: new THREE.Color() },
    uDisc: { value: 1 },
    uDiscSize: { value: 0.0006 },
    uStars: { value: 0 },
    uAurora: { value: 0 },
    uClouds: { value: 0 },
    uCloudColor: { value: new THREE.Color() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uFogColor;
      uniform vec3 uFogSunColor;
      uniform float uTime;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGlowColor;
      uniform float uGlow;
      uniform vec3 uDiscColor;
      uniform float uDisc;
      uniform float uDiscSize;
      uniform float uStars;
      uniform float uAurora;
      uniform float uClouds;
      uniform vec3 uCloudColor;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float sd = max(dot(d, uSunDir), 0.0);
        vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.75, h), 0.6));
        // warm/cool horizon toward the sun
        col = mix(col, uFogSunColor, pow(sd, 3.0) * smoothstep(0.6, 0.0, h) * 0.6);
        col += uGlowColor * (pow(sd, 6.0) * 0.35 + pow(sd, 48.0) * 0.8 + pow(sd, 600.0) * 2.0) * uGlow;

        // stars
        if (uStars > 0.0 && h > -0.05) {
          vec3 p = d * 260.0;
          vec3 cell = floor(p);
          vec3 f = fract(p) - 0.5;
          float r = hash(cell);
          vec3 jitter = vec3(hash(cell + 1.3), hash(cell + 2.7), hash(cell + 4.1)) - 0.5;
          float dist = length(f - jitter * 0.6);
          float star = step(0.93, r) * smoothstep(0.12, 0.0, dist) * (0.4 + 0.6 * hash(cell + 9.0));
          star *= 0.7 + 0.3 * sin(uTime * (2.0 + r * 6.0) + r * 40.0);
          col += vec3(0.85, 0.9, 1.0) * star * uStars * 2.5 * smoothstep(-0.02, 0.2, h);
        }

        // aurora curtains
        if (uAurora > 0.0 && h > 0.0) {
          float az = atan(d.x, d.z);
          vec3 acc = vec3(0.0);
          for (int i = 0; i < 4; i++) {
            float fi = float(i);
            float band = 0.18 + 0.1 * sin(az * 1.3 + fi * 1.7 + uTime * 0.03) + 0.05 * fi;
            float curtain = fbm(vec2(az * 2.4 + fi * 3.1, uTime * 0.02 + fi));
            float streak = pow(vnoise(vec2(az * 60.0 + fi * 10.0, uTime * 0.15)), 2.0);
            float y = (h - band * (0.7 + curtain * 0.6)) / 0.16;
            float shape = exp(-y * y * 2.5) * (y < 0.0 ? 1.0 : exp(-y * 1.2));
            float mask = smoothstep(0.35, 0.65, curtain) * (0.4 + streak);
            vec3 c = mix(vec3(0.1, 1.0, 0.65), vec3(0.45, 0.35, 1.0), clamp(y * 0.4 + 0.3, 0.0, 1.0));
            acc += c * shape * mask;
          }
          float side = smoothstep(-0.2, 0.6, sin(az - 0.9));
          col += acc * uAurora * 0.9 * side;
        }

        // cloud banks low over the horizon
        if (uClouds > 0.0 && h > -0.02) {
          float az = atan(d.x, d.z);
          vec2 cp = vec2(az * 3.0, h * 14.0) + vec2(uTime * 0.004, 0.0);
          float c = fbm(cp * vec2(1.0, 1.6)) * smoothstep(0.35, 0.02, h) * smoothstep(-0.02, 0.05, h);
          c = smoothstep(0.35, 0.75, c);
          vec3 cc = mix(uCloudColor, uFogSunColor * 1.3, pow(sd, 4.0));
          col = mix(col, cc, c * uClouds);
        }

        // sun / moon disc
        float disc = smoothstep(1.0 - uDiscSize, 1.0 - uDiscSize * 0.7, sd);
        col += uDiscColor * disc * uDisc;

        // below the horizon blend into fog
        col = mix(col, uFogColor, smoothstep(0.02, -0.08, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';
  return { mesh, uniforms };
}

export function buildSnowfall(count) {
  const box = 140;
  const pos = new Float32Array(count * 3);
  const rnd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = Math.random() * box;
    pos[i * 3 + 1] = Math.random() * box;
    pos[i * 3 + 2] = Math.random() * box;
    rnd[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  const uniforms = {
    uTime: U.uTime,
    uBox: { value: box },
    uAmount: { value: 0.5 },
    uColor: { value: new THREE.Color(1, 1, 1) },
    uPixel: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aRnd;
      uniform float uTime;
      uniform float uBox;
      uniform float uAmount;
      uniform float uPixel;
      varying float vA;
      void main() {
        vec3 p = position;
        p.y -= uTime * (1.2 + aRnd * 1.3);
        p.x += sin(uTime * 0.6 + aRnd * 30.0) * 1.5 + uTime * 0.7;
        p.z += cos(uTime * 0.5 + aRnd * 20.0) * 1.2;
        vec3 cam = cameraPosition;
        p = mod(p - cam + uBox * 0.5, uBox) - uBox * 0.5 + cam;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        gl_PointSize = uPixel * (0.06 + aRnd * 0.08) * 900.0 / max(dist, 0.5);
        vA = step(aRnd, uAmount) * smoothstep(70.0, 20.0, dist) * smoothstep(0.5, 2.0, dist);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.15, d) * vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a * 0.85);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.name = 'snowfall';
  return { points, uniforms };
}
