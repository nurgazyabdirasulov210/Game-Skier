import * as THREE from '../vendor/three.module.js';

// Глобальные uniform'ы, общие для всех материалов (свет, туман, тени, следы)
export const G = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.6, -0.7).normalize() },
  uSunCol: { value: new THREE.Color(2, 2, 2) },
  uSkyAmb: { value: new THREE.Color(0.5, 0.6, 0.9) },
  uGndAmb: { value: new THREE.Color(0.3, 0.35, 0.6) },
  uSkyTop: { value: new THREE.Color(0.1, 0.3, 0.8) },
  uSkyHor: { value: new THREE.Color(0.7, 0.8, 1.0) },
  uGlowCol: { value: new THREE.Color(1, 0.9, 0.8) },
  uSunDisc: { value: new THREE.Vector3(0, 0.5, -1).normalize() },
  uMoonDir: { value: new THREE.Vector3(0, 0.5, 1).normalize() },
  uNight: { value: 0 },
  uFogDen: { value: 0.0022 },
  uCamPos: { value: new THREE.Vector3() },
  uShadow0: { value: null },
  uShadow1: { value: null },
  uShadowM0: { value: new THREE.Matrix4() },
  uShadowM1: { value: new THREE.Matrix4() },
  uShadowInfo: { value: new THREE.Vector4(1 / 2048, 1 / 2048, 0, 0) },
  uShadowBias: { value: new THREE.Vector2(0.0005, 0.001) },
  uTrail: { value: null },
  uTrailOrigin: { value: new THREE.Vector2() },
  uTrailSize: { value: 160 },
  uTrailTexel: { value: 160 / 1024 },
  uPlayer: { value: new THREE.Vector3() },
  uWind: { value: 0.4 },
};

export const GLSL_UNIFORMS = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uSkyAmb; uniform vec3 uGndAmb;
uniform vec3 uSkyTop; uniform vec3 uSkyHor; uniform vec3 uGlowCol; uniform vec3 uSunDisc; uniform vec3 uMoonDir;
uniform float uNight; uniform float uFogDen; uniform vec3 uCamPos;
uniform sampler2D uTrail; uniform vec2 uTrailOrigin; uniform float uTrailSize; uniform float uTrailTexel;
uniform vec3 uPlayer; uniform float uWind;
`;

export const GLSL_TRAIL = /* glsl */`
// r — глубина колеи (0..1), g — бруствер
vec2 trailAt(vec2 xz){
  vec2 uv = (xz - uTrailOrigin) / uTrailSize;
  if (uv.x <= 0.002 || uv.y <= 0.002 || uv.x >= 0.998 || uv.y >= 0.998) return vec2(0.0);
  return textureLod(uTrail, uv, 0.0).rg;
}
float trailDisp(vec2 t){ return -t.x * POWDER * 0.9 + t.y * 0.24 * (1.0 - t.x); }
`;

export const GLSL_SHADING = /* glsl */`
uniform highp sampler2DShadow uShadow0;
uniform highp sampler2DShadow uShadow1;
uniform mat4 uShadowM0; uniform mat4 uShadowM1;
uniform vec4 uShadowInfo; uniform vec2 uShadowBias;

vec3 skyColor(vec3 v){
  float y = v.y;
  float t = pow(clamp(y + 0.02, 0.0, 1.0), 0.45);
  vec3 c = mix(uSkyHor, uSkyTop, t);
  float sd = max(dot(v, uSunDisc), 0.0);
  float glow = pow(sd, 4.0) * 0.38 + pow(sd, 28.0) * 0.6;
  c += uGlowCol * glow * (1.0 - 0.55 * clamp(y, 0.0, 1.0));
  float md = max(dot(v, uMoonDir), 0.0);
  c += vec3(0.22, 0.32, 0.75) * pow(md, 20.0) * 0.35 * uNight;
  return c;
}

vec3 fogApply(vec3 col, vec3 wpos){
  vec3 d = wpos - uCamPos;
  float dist = length(d);
  vec3 v = d / max(dist, 1e-3);
  float hf = clamp((uCamPos.y - wpos.y) / 140.0, -0.4, 1.0);
  float f = 1.0 - exp(-dist * uFogDen * (1.0 + 0.9 * hf));
  vec3 fc = skyColor(normalize(vec3(v.x, max(v.y, 0.0) * 0.3 + 0.015, v.z)));
  return mix(col, fc, clamp(f, 0.0, 1.0));
}

float shTap(highp sampler2DShadow m, vec3 c, float t){
  float s = textureLod(m, c, 0.0) * 2.0;
  s += textureLod(m, c + vec3( t,  t, 0.0), 0.0);
  s += textureLod(m, c + vec3(-t,  t, 0.0), 0.0);
  s += textureLod(m, c + vec3( t, -t, 0.0), 0.0);
  s += textureLod(m, c + vec3(-t, -t, 0.0), 0.0);
  return s / 6.0;
}
float shadowAt(vec3 wpos, vec3 n){
  if (uShadowInfo.z < 0.5) return 1.0;
  float ndl = clamp(dot(n, uSunDir), 0.0, 1.0);
  vec3 p = wpos + n * (0.03 + 0.07 * (1.0 - ndl)) + uSunDir * 0.02;
  vec3 a = (uShadowM0 * vec4(p, 1.0)).xyz;
  vec3 b = (uShadowM1 * vec4(p, 1.0)).xyz;
  float ea = max(abs(a.x - 0.5), abs(a.y - 0.5)) * 2.0;
  float eb = max(abs(b.x - 0.5), abs(b.y - 0.5)) * 2.0;
  float s1 = 1.0;
  if (eb < 1.0 && b.z < 1.0) s1 = mix(shTap(uShadow1, b - vec3(0.0, 0.0, uShadowBias.y), uShadowInfo.y * 1.2), 1.0, smoothstep(0.85, 1.0, eb));
  if (ea < 0.97 && a.z < 1.0 && a.z > 0.0){
    float s0 = shTap(uShadow0, a - vec3(0.0, 0.0, uShadowBias.x), uShadowInfo.x);
    return mix(s0, s1, smoothstep(0.8, 0.97, ea));
  }
  return s1;
}

vec3 ambientAt(vec3 n){ return mix(uGndAmb, uSkyAmb, clamp(n.y * 0.5 + 0.5, 0.0, 1.0)); }

vec3 shadeLit(vec3 albedo, vec3 n, vec3 wpos, float sh, float wrap, float ao){
  float ndl = dot(n, uSunDir);
  float d = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);
  vec3 col = albedo * (ambientAt(n) * ao + uSunCol * d * sh);
  vec3 V = normalize(uCamPos - wpos);
  float fr = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.0);
  col += uSkyAmb * fr * 0.18 * ao;
  return col;
}
`;

// Общая шапка для вершинных шейдеров: мир + следы
import { GLSL_WORLD } from './world.js';
export const VERT_HEAD = GLSL_UNIFORMS + GLSL_WORLD + GLSL_TRAIL;
export const FRAG_HEAD = GLSL_UNIFORMS + GLSL_SHADING;

export function sharedUniforms(extra = {}) {
  return Object.assign({}, G, extra);
}
