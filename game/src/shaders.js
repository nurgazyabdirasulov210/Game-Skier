// Все шейдеры игры: снег, стилизованные объекты, небо, частицы, следы.
import * as THREE from 'three';
import { shared } from './palette.js';

const COMMON = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uShadowColor;
uniform vec3 uSkyTop;
uniform vec3 uHorizon;
uniform vec3 uFogColor;
uniform vec3 uGlowColor;
uniform float uFogDensity;
uniform float uTime;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1,0,0)), u.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), u.x), u.y);
  float b = mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), u.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), u.x), u.y);
  return mix(a, b, u.z);
}
vec3 fogColorFor(vec3 dir) {
  float s = max(dot(dir, uSunDir), 0.0);
  vec3 fc = mix(uFogColor, uGlowColor, pow(s, 6.0) * 0.75);
  return fc;
}
vec3 applyFog(vec3 col, vec3 wpos) {
  vec3 d = wpos - cameraPosition;
  float dist = length(d);
  float f = 1.0 - exp(-pow(dist * uFogDensity, 1.5));
  return mix(col, fogColorFor(d / max(dist, 0.001)), clamp(f, 0.0, 1.0));
}
`;

const SHADOW_VERT_PARS = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
`;
const SHADOW_FRAG_PARS = /* glsl */ `
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
`;

function litUniforms(extra = {}) {
  const u = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, extra]);
  return Object.assign(u, shared);
}

// ---------- Снег ----------
export const snowMaterial = new THREE.ShaderMaterial({
  lights: true,
  uniforms: litUniforms(),
  vertexShader: SHADOW_VERT_PARS + /* glsl */ `
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    void main() {
      #include <beginnormal_vertex>
      #include <defaultnormal_vertex>
      #include <begin_vertex>
      #include <worldpos_vertex>
      #include <shadowmap_vertex>
      vec4 wp = modelMatrix * vec4(transformed, 1.0);
      vWorldPos = wp.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: SHADOW_FRAG_PARS + COMMON + /* glsl */ `
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    void main() {
      vec3 N = normalize(vNormal);
      vec2 p = vWorldPos.xz;
      // ветровые застружки и мелкая рябь
      float r1 = vnoise(vec2(p.x * 0.18 + p.y * 0.05, p.y * 0.9));
      float r2 = vnoise(p * 2.3);
      float r3 = vnoise(p * 0.05);
      N = normalize(N + vec3(r1 - 0.5, 0.0, r2 - 0.5) * 0.16 + vec3(0.0, 0.0, (r3 - 0.5) * 0.1));
      float shadow = getShadowMask();
      float ndl = dot(N, uSunDir);
      float lit = smoothstep(-0.12, 0.42, ndl);
      lit *= mix(0.25, 1.0, shadow);
      vec3 col = mix(uShadowColor, uSunColor, lit);
      // заполнение от неба и отражённый свет
      col += uSkyTop * 0.1 * max(N.y, 0.0);
      vec3 V = normalize(cameraPosition - vWorldPos);
      float ndv = max(dot(N, V), 0.0);
      float rim = pow(1.0 - ndv, 4.0);
      col += uGlowColor * rim * 0.18;
      // блёстки
      float dist = distance(cameraPosition, vWorldPos);
      vec2 sg = vWorldPos.xz * 9.0;
      vec2 cell = floor(sg);
      float tw = floor(dot(V, vec3(23.0, 11.0, 17.0)) * 1.5 + uTime * 0.5);
      float sp = step(0.985, hash12(cell + tw * 0.37));
      vec2 off = vec2(hash12(cell + 7.1), hash12(cell + 3.3)) * 0.6 + 0.2;
      sp *= smoothstep(0.14, 0.0, length(fract(sg) - off));
      col += sp * mix(uSunColor, vec3(1.0), 0.5) * 0.9 * lit * (1.0 - smoothstep(6.0, 35.0, dist));
      vec3 H = normalize(uSunDir + V);
      col += pow(max(dot(N, H), 0.0), 80.0) * uSunColor * 0.25 * lit;
      gl_FragColor = vec4(applyFog(col, vWorldPos), 1.0);
    }`,
});

// ---------- Деревья, камни, персонаж ----------
// color: базовый цвет, aSnow: снежная шапка, aKind: 0 твёрдое, 1 пушистая крона, 2 береста
export function makeObjectMaterial() {
  return new THREE.ShaderMaterial({
    lights: true,
    uniforms: litUniforms(),
    vertexShader: SHADOW_VERT_PARS + COMMON + /* glsl */ `
      attribute vec3 color;
      attribute float aSnow;
      attribute float aKind;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying float vSnow;
      varying float vKind;
      void main() {
        #include <beginnormal_vertex>
        #include <defaultnormal_vertex>
        #include <begin_vertex>
        #include <worldpos_vertex>
        #include <shadowmap_vertex>
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        if (aKind > 0.5 && aKind < 1.5) {
          float sway = sin(uTime * 1.3 + wp.x * 0.15 + wp.z * 0.1) * 0.07 + sin(uTime * 2.7 + wp.y) * 0.02;
          wp.x += sway; wp.z += sway * 0.6;
        }
        vWorldPos = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vColor = color;
        vSnow = aSnow;
        vKind = aKind;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: SHADOW_FRAG_PARS + COMMON + /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying float vSnow;
      varying float vKind;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 base = vColor;
        float fluff = (vKind > 0.5 && vKind < 1.5) ? 1.0 : 0.0;
        if (vKind > 1.5) {
          float s = vnoise3(vWorldPos * vec3(2.2, 5.0, 2.2));
          base = mix(base, vec3(0.08, 0.08, 0.12), step(0.7, s));
        }
        float capN = vnoise(vWorldPos.xz * 2.5 + vWorldPos.y);
        float cap = smoothstep(0.38, 0.62, N.y + (capN - 0.5) * 0.5) * vSnow;
        base = mix(base, vec3(1.0), cap);
        float shadow = getShadowMask();
        float ndl = dot(N, uSunDir);
        float fn = vnoise3(vWorldPos * 2.6) * 0.65 + vnoise3(vWorldPos * 7.0) * 0.35;
        ndl += (fn - 0.5) * 0.9 * fluff;
        float lit = smoothstep(-0.08, 0.22, ndl) * mix(0.3, 1.0, shadow);
        vec3 light = mix(uShadowColor * 0.85, uSunColor * 1.08, lit);
        vec3 col = base * light;
        vec3 V = normalize(cameraPosition - vWorldPos);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
        col += mix(base, vec3(1.0), 0.3) * uGlowColor * rim * (0.22 + back * 1.3) * (0.5 + fluff * 0.6);
        // мягкая «шерсть» по краю кроны
        col += base * uGlowColor * back * fluff * 0.25;
        gl_FragColor = vec4(applyFog(col, vWorldPos), 1.0);
      }`,
  });
}

// ---------- Небо ----------
export const skyMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: Object.assign({ uSunDisk: shared.uSunDisk, uStars: shared.uStars }, shared),
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p.xyww;
    }`,
  fragmentShader: COMMON + /* glsl */ `
    uniform float uSunDisk;
    uniform float uStars;
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      float h = d.y;
      vec3 col = mix(uHorizon, uSkyTop, pow(smoothstep(-0.02, 0.65, h), 0.65));
      col = mix(fogColorFor(d), col, smoothstep(-0.08, 0.12, h));
      float s = max(dot(d, uSunDir), 0.0);
      col += uGlowColor * (pow(s, 10.0) * 0.22 + pow(s, 120.0) * 0.35);
      float disk = smoothstep(0.9990, 0.9995, s) * uSunDisk;
      col = mix(col, mix(uSunColor, vec3(1.0), 0.6) * 1.25, disk);
      // перистые облака
      vec2 cp = d.xz / max(h + 0.15, 0.05);
      float cl = vnoise(cp * 1.4 + vec2(uTime * 0.01, 0.0)) * 0.6 + vnoise(cp * 4.0) * 0.4;
      cl = smoothstep(0.55, 0.85, cl) * smoothstep(0.02, 0.25, h) * 0.35;
      col = mix(col, mix(uShadowColor, uSunColor, 0.7) + uGlowColor * pow(s, 4.0) * 0.4, cl);
      // звёзды
      vec3 sd = d * 220.0;
      float st = step(0.9965, hash13(floor(sd)));
      float tw = 0.6 + 0.4 * sin(uTime * 3.0 + hash13(floor(sd) + 3.1) * 40.0);
      col += vec3(st * tw * uStars * smoothstep(0.05, 0.3, h));
      gl_FragColor = vec4(col, 1.0);
    }`,
});

// ---------- Следы лыж ----------
export const trailMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
  uniforms: Object.assign({}, shared),
  vertexShader: /* glsl */ `
    attribute float aAlpha;
    attribute float aSide;
    varying float vAlpha;
    varying float vSide;
    varying vec3 vWorldPos;
    void main() {
      vAlpha = aAlpha; vSide = aSide;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: COMMON + /* glsl */ `
    varying float vAlpha;
    varying float vSide;
    varying vec3 vWorldPos;
    void main() {
      float groove = 1.0 - abs(vSide);
      vec3 col = mix(uShadowColor * 0.8, mix(uShadowColor, uSunColor, 0.45), smoothstep(0.0, 0.6, vSide + 0.4));
      float a = vAlpha * smoothstep(0.0, 0.5, groove) * 0.75;
      gl_FragColor = vec4(applyFog(col, vWorldPos), a);
    }`,
});

// ---------- Снежная пыль (частицы) ----------
export const particleMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: Object.assign({ uScale: { value: 600 } }, shared),
  vertexShader: /* glsl */ `
    uniform float uScale;
    attribute float aSize;
    attribute float aLife;
    varying float vLife;
    varying vec3 vWorldPos;
    void main() {
      vLife = aLife;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vec4 mv = viewMatrix * wp;
      gl_PointSize = aSize * uScale / max(-mv.z, 0.1) * step(0.001, aLife);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: COMMON + /* glsl */ `
    varying float vLife;
    varying vec3 vWorldPos;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float r = length(c);
      if (r > 0.5) discard;
      float a = smoothstep(0.5, 0.1, r) * clamp(vLife * 1.6, 0.0, 1.0) * 0.85;
      float lit = 0.55 + 0.45 * smoothstep(0.3, -0.3, c.y + c.x * 0.3);
      vec3 col = mix(uShadowColor, uSunColor, lit);
      col += uGlowColor * pow(max(dot(normalize(vWorldPos - cameraPosition), uSunDir), 0.0), 6.0) * 0.6;
      gl_FragColor = vec4(applyFog(col, vWorldPos), a);
    }`,
});

// ---------- Падающий снег ----------
export const snowfallMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: Object.assign({ uCenter: { value: new THREE.Vector3() }, uAmount: { value: 0 }, uScale: { value: 600 } }, shared),
  vertexShader: /* glsl */ `
    uniform vec3 uCenter;
    uniform float uAmount;
    uniform float uScale;
    uniform float uTime;
    attribute float aSeed;
    varying float vA;
    void main() {
      const float B = 50.0;
      vec3 p = position;
      p.y -= uTime * (2.0 + aSeed * 1.5);
      p.x += sin(uTime * 0.7 + aSeed * 30.0) * 1.5 + uTime * 1.2;
      p.z += cos(uTime * 0.5 + aSeed * 20.0) * 1.0;
      p = mod(p - uCenter + B * 0.5, B) + uCenter - B * 0.5;
      vec4 mv = viewMatrix * vec4(p, 1.0);
      vA = step(aSeed, uAmount) * smoothstep(25.0, 4.0, -mv.z) * smoothstep(0.3, 1.5, -mv.z);
      gl_PointSize = (0.07 + aSeed * 0.05) * uScale / max(-mv.z, 0.1);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: COMMON + /* glsl */ `
    varying float vA;
    void main() {
      float r = length(gl_PointCoord - 0.5);
      if (r > 0.5 || vA < 0.01) discard;
      gl_FragColor = vec4(mix(uSunColor, vec3(1.0), 0.5), smoothstep(0.5, 0.0, r) * vA * 0.9);
    }`,
});

// ---------- Кристаллы-коллекционки ----------
export const shardMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: Object.assign({}, shared),
  vertexShader: /* glsl */ `
    varying vec3 vN; varying vec3 vWorldPos;
    void main() {
      vN = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: COMMON + /* glsl */ `
    varying vec3 vN; varying vec3 vWorldPos;
    void main() {
      vec3 V = normalize(cameraPosition - vWorldPos);
      float f = pow(1.0 - abs(dot(normalize(vN), V)), 1.5);
      vec3 col = mix(vec3(0.4, 0.95, 1.0), vec3(1.0, 0.6, 1.0), 0.5 + 0.5 * sin(uTime * 2.0 + vWorldPos.x));
      gl_FragColor = vec4(col * (0.5 + f * 1.4), 0.9);
    }`,
});
