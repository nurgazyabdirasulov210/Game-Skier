// Shared uniforms and GLSL snippets used by every material in the game.
import * as THREE from '../vendor/three.module.js';

export const G = {
  uTime: { value: 0 },
  uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
  uKeyColor: { value: new THREE.Color(1, 1, 1) },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
  uAmbTop: { value: new THREE.Color() },
  uAmbBottom: { value: new THREE.Color() },
  uSnowLit: { value: new THREE.Color() },
  uSnowShadow: { value: new THREE.Color() },
  uFogColor: { value: new THREE.Color() },
  uFogSun: { value: new THREE.Color() },
  uFogDist: { value: 400 },
  uHorizon: { value: new THREE.Color() },
  uZenith: { value: new THREE.Color() },
  uNight: { value: 0 },
  uStars: { value: 0 },
  uAurora: { value: 0 },
  uClouds: { value: 0.5 },
  uWind: { value: 1 },
  uLampPos: { value: new THREE.Vector4(0, 0, 0, 0) },
  uLampDir: { value: new THREE.Vector3(0, 0, -1) },
};

/** Build a uniforms object that includes the light/shadow uniforms three.js needs. */
export function makeUniforms(own = {}) {
  const u = THREE.UniformsUtils.clone(THREE.UniformsLib.lights);
  Object.assign(u, G);
  Object.assign(u, own);
  return u;
}

export const GLSL_COMMON = /* glsl */`
uniform float uTime;
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uAmbTop;
uniform vec3 uAmbBottom;
uniform vec3 uSnowLit;
uniform vec3 uSnowShadow;
uniform vec3 uFogColor;
uniform vec3 uFogSun;
uniform float uFogDist;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uNight;
uniform vec4 uLampPos;
uniform vec3 uLampDir;

float p_hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float p_hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float p_vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = p_hash12(i), b = p_hash12(i + vec2(1, 0)), c = p_hash12(i + vec2(0, 1)), d = p_hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float p_fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * p_vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

vec3 applyFog(vec3 col, vec3 wpos) {
  vec3 d = wpos - cameraPosition;
  float dist = length(d);
  vec3 dir = d / max(dist, 0.001);
  float x = dist / uFogDist;
  float f = 1.0 - exp(-x * x * 1.25 - dist * 0.0005);
  float below = clamp((cameraPosition.y - wpos.y) / 180.0, 0.0, 1.0);
  f = clamp(f + below * 0.22 * smoothstep(30.0, 260.0, dist), 0.0, 1.0);
  float s = pow(max(dot(dir, uSunDir), 0.0), 5.0);
  vec3 fc = mix(uFogColor, uFogSun, s * 0.85);
  return mix(col, fc, f);
}

vec3 lampLight(vec3 wpos, vec3 N) {
  if (uLampPos.w < 0.01) return vec3(0.0);
  vec3 L = uLampPos.xyz - wpos;
  float d = length(L);
  L /= max(d, 0.001);
  float cone = smoothstep(0.72, 0.93, dot(-L, uLampDir));
  float att = 1.0 / (1.0 + d * d * 0.006);
  return vec3(1.0, 0.86, 0.66) * uLampPos.w * cone * att * max(dot(N, L), 0.0) * 3.2;
}

vec3 ambient(vec3 N) {
  return mix(uAmbBottom, uAmbTop, N.y * 0.5 + 0.5);
}
`;

export const GLSL_SHADOW_FRAG = /* glsl */`
#include <packing>
#include <shadowmap_pars_fragment>
float keyShadow() {
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  DirectionalLightShadow s = directionalLightShadows[0];
  return getShadow(directionalShadowMap[0], s.shadowMapSize, s.shadowBias, s.shadowRadius, vDirectionalShadowCoord[0]);
#else
  return 1.0;
#endif
}
`;
