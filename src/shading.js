// Shared uniforms and GLSL used by every material: height fog with a warm
// glow toward the sun, a cool rim on grazing angles and an optional snow cover
// driven by the per-vertex attribute `aSnow`.
import * as THREE from 'three';

export const U = {
  uSunDir: { value: new THREE.Vector3(0.3, 0.6, -0.5).normalize() },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uSunIntensity: { value: 2.5 },
  uHemiSky: { value: new THREE.Color(0.5, 0.6, 1) },
  uHemiGround: { value: new THREE.Color(0.6, 0.6, 0.8) },
  uHemiIntensity: { value: 1.5 },
  uFogColor: { value: new THREE.Color(0.7, 0.8, 1) },
  uFogSunColor: { value: new THREE.Color(1, 0.9, 0.8) },
  uFogDensity: { value: 0.0006 },
  uFogFalloff: { value: 0.004 },
  uFogBase: { value: 0 },
  uRimColor: { value: new THREE.Color(0.4, 0.5, 1) },
  uSnowColor: { value: new THREE.Color(1, 1, 1) },
  uTime: { value: 0 },
  uSparkle: { value: 0.5 },
};

export const FOG_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform float uFogBase;
vec3 fogTint(vec3 rd) {
  float s = max(dot(rd, uSunDir), 0.0);
  return mix(uFogColor, uFogSunColor, pow(s, 5.0) * 0.85 + pow(s, 40.0) * 0.15);
}
float fogAmount(vec3 wp) {
  vec3 ray = wp - cameraPosition;
  float dist = length(ray);
  float b = uFogFalloff;
  float h0 = max(cameraPosition.y - uFogBase, -50.0);
  float amount = uFogDensity * exp(-b * h0) * dist;
  float dy = ray.y;
  if (abs(b * dy) > 0.001) amount *= (1.0 - exp(-b * dy)) / (b * dy);
  return clamp(1.0 - exp(-amount), 0.0, 1.0);
}
vec3 applyFog(vec3 col, vec3 wp) {
  vec3 rd = normalize(wp - cameraPosition);
  return mix(col, fogTint(rd), fogAmount(wp));
}
`;

/**
 * Patches a built-in lit material (Lambert) so it gets fog, rim light and snow.
 * opts.snow: use the `aSnow` attribute (0..1) to blend toward the snow colour.
 * opts.rim: strength of the grazing-angle rim.
 * opts.sparkle: add tiny view-dependent glints (for the snow ground).
 */
export function stylize(mat, opts = {}) {
  const rim = opts.rim ?? 0.25;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.uniforms.uRimStrength = { value: rim };
    let vs = shader.vertexShader;
    vs = vs.replace('#include <common>', `#include <common>
varying vec3 vWP;
${opts.snow ? 'attribute float aSnow; varying float vSnow;' : ''}`);
    vs = vs.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
{
  vec4 wp4 = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  wp4 = instanceMatrix * wp4;
  #endif
  vWP = (modelMatrix * wp4).xyz;
  ${opts.snow ? 'vSnow = aSnow;' : ''}
}`);
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    fs = fs.replace('#include <common>', `#include <common>
varying vec3 vWP;
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform vec3 uSnowColor;
uniform float uTime;
uniform float uSparkle;
${opts.snow ? 'varying float vSnow;' : ''}
${FOG_GLSL}
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }`);
    if (opts.snow) {
      fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
${opts.snowFromMap
    ? 'float snowAmt = clamp(vSnow, 0.0, 1.0) * smoothstep(0.45, 0.7, sampledDiffuseColor.r);'
    : 'float snowAmt = clamp(vSnow, 0.0, 1.0);'}
diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor, snowAmt);`);
    }
    fs = fs.replace('#include <opaque_fragment>', `
{
  float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  outgoingLight += uRimColor * pow(1.0 - ndv, 3.0) * uRimStrength;
  ${opts.sparkle ? `
  vec3 cell = floor(vWP * 22.0);
  float h = hash13(cell);
  float tw = hash13(cell + floor(cameraPosition * 1.5));
  float glint = step(0.997, h) * step(0.6, tw) * smoothstep(25.0, 3.0, length(vWP - cameraPosition));
  outgoingLight += vec3(1.0) * glint * uSparkle * 1.5;` : ''}
  outgoingLight = applyFog(outgoingLight, vWP);
}
#include <opaque_fragment>`);
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `stylize-${!!opts.snow}-${!!opts.snowFromMap}-${!!opts.sparkle}-${rim}`;
  return mat;
}
