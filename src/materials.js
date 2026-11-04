import * as THREE from 'three';

// Общие юниформы, которые меняются со временем суток (одни объекты на все материалы).
export const SHARED = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uSnowColor: { value: new THREE.Color(0.93, 0.96, 1.0) },
  uRockColor: { value: new THREE.Color(0.08, 0.09, 0.14) },
  uSparkle: { value: 1.0 },
  uTime: { value: 0 },
  uTranslucency: { value: 1.0 },
  uSelfLit: { value: 0.3 },
};

const GLSL_NOISE = /* glsl */`
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn2(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h12(i), b = h12(i + vec2(1.0, 0.0)), c = h12(i + vec2(0.0, 1.0)), d = h12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float vn3(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n000 = h13(i), n100 = h13(i + vec3(1,0,0)), n010 = h13(i + vec3(0,1,0)), n110 = h13(i + vec3(1,1,0));
  float n001 = h13(i + vec3(0,0,1)), n101 = h13(i + vec3(1,0,1)), n011 = h13(i + vec3(0,1,1)), n111 = h13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
`;

const WORLD_VARYINGS = 'varying vec3 vWPos; varying vec3 vWNorm;\n';

const WORLD_V = /* glsl */`
{
  vec4 _wp = vec4(transformed, 1.0);
  vec3 _wn = objectNormal;
  #ifdef USE_INSTANCING
    _wp = instanceMatrix * _wp;
    _wn = mat3(instanceMatrix) * _wn;
  #endif
  _wp = modelMatrix * _wp;
  vWPos = _wp.xyz;
  vWNorm = normalize(mat3(modelMatrix) * _wn);
}
`;

const UNIFORM_DECL = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSnowColor; uniform vec3 uRockColor;
uniform float uSparkle; uniform float uTime; uniform float uTranslucency; uniform float uSelfLit;
`;

function patch(mat, key, p) {
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, SHARED, p.uniforms || {});
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WORLD_VARYINGS + (p.vHead || ''))
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + WORLD_V + (p.vMain || ''));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WORLD_VARYINGS + UNIFORM_DECL + GLSL_NOISE + (p.fHead || ''))
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + (p.fColor || ''))
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + (p.fNormal || ''))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + (p.fEmissive || ''));
  };
  return mat;
}

// ---------------------------------------------------------------- снег (рельеф)
export function makeTerrainMaterial(quality) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const detail = quality.detail;
  return patch(mat, 'terrain-' + detail, {
    vHead: 'attribute vec3 aTerr; varying vec3 vTerr;',
    vMain: 'vTerr = aTerr;',
    fHead: /* glsl */`
      varying vec3 vTerr;
      float snowDetail(vec2 p){
        vec2 w = vec2(0.8, 0.6);
        vec2 q = vec2(dot(p, w), dot(p, vec2(-w.y, w.x)));
        float rip = vn2(vec2(q.x * 1.1, q.y * 0.18));
        float rip2 = vn2(vec2(q.x * 2.7, q.y * 0.4));
        float bump = vn2(p * 0.16) * 1.6 + vn2(p * 0.45) * 0.55;
        return rip * 0.35 + rip2 * 0.12 + bump;
      }
    `,
    fColor: /* glsl */`
      float tAO = vTerr.x;
      float dCamC = length(vWPos - cameraPosition);
      float rockN = vn2(vWPos.xz * 0.09) * 0.6 + mix(vn2(vWPos.xz * 0.4), 0.5, smoothstep(150.0, 600.0, dCamC)) * 0.4;
      float rockM = smoothstep(0.45, 0.7, vTerr.y + (rockN - 0.5) * 0.7);
      vec3 snowC = uSnowColor * (0.975 + 0.05 * vTerr.z);
      vec3 rockC = mix(uRockColor, snowC * 0.8, smoothstep(0.62, 0.85, rockN) * 0.6);
      diffuseColor.rgb = mix(snowC, rockC, rockM) * mix(1.0, tAO, 0.92);
    `,
    fNormal: detail ? /* glsl */`
      {
        float dCam = length(vWPos - cameraPosition);
        float fade = 1.0 - smoothstep(40.0, 260.0, dCam);
        if (fade > 0.0) {
          vec2 xz = vWPos.xz;
          float e = 0.3;
          float n0 = snowDetail(xz);
          float nx = snowDetail(xz + vec2(e, 0.0));
          float nz = snowDetail(xz + vec2(0.0, e));
          vec3 dW = vec3(-(nx - n0) / e, 0.0, -(nz - n0) / e) * 0.32 * fade * (1.0 - rockM);
          normal = normalize(normal + (viewMatrix * vec4(dW, 0.0)).xyz);
        }
      }
    ` : '',
    fEmissive: /* glsl */`
      {
        vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
        vec3 V = normalize(cameraPosition - vWPos);
        vec3 Hh = normalize(V + uSunDir);
        vec3 gp = vWPos * 14.0;
        float cell = h13(floor(gp));
        float dotShape = smoothstep(0.32, 0.08, length(fract(gp) - 0.5));
        float glint = step(0.993, cell) * dotShape * pow(max(dot(wN, Hh), 0.0), 30.0);
        float dist = length(cameraPosition - vWPos);
        float near = 1.0 - smoothstep(4.0, 40.0, dist);
        totalEmissiveRadiance += uSunColor * glint * 5.0 * uSparkle * near * (1.0 - rockM) * max(dot(wN, uSunDir), 0.0);
        float rim = pow(1.0 - max(dot(wN, V), 0.0), 5.0);
        totalEmissiveRadiance += uSunColor * rim * 0.05 * (1.0 - rockM);
      }
    `,
  });
}

// ------------------------------------------------- пушистые кроны / кусты / облака
export function makeFoliageMaterial(map, { key = 'foliage', alphaToCoverage = false, translucency = 0.55, side = THREE.DoubleSide } = {}) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, map, alphaTest: 0.5, side, alphaToCoverage });
  return patch(mat, key + alphaToCoverage, {
    vHead: 'attribute vec2 aFol; varying vec2 vFol;',
    vMain: 'vFol = aFol;',
    fHead: 'varying vec2 vFol;',
    fColor: /* glsl */`
      float sn = vFol.y;
      sn = smoothstep(0.25, 0.6, sn + (vn3(vWPos * 1.7) - 0.5) * 0.35);
      diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor * 0.97, sn) * vFol.x;
    `,
    // карточки двусторонние — не разворачиваем нормаль, чтобы шар освещался ровно
    fNormal: 'normal = normalize(vNormal);',
    fEmissive: /* glsl */`
      {
        vec3 V = normalize(cameraPosition - vWPos);
        float tr = pow(max(dot(-V, uSunDir), 0.0), 5.0);
        totalEmissiveRadiance += diffuseColor.rgb * uSunColor * tr * ${translucency.toFixed(3)} * uTranslucency * (1.0 - sn);
        totalEmissiveRadiance += diffuseColor.rgb * uSelfLit * (1.0 - sn * 0.7);
      }
    `,
  });
}

// --------------------------------------------------- ель: вершинные цвета + снег
export function makeSpruceMaterial() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  return patch(mat, 'spruce', {
    vHead: 'attribute vec2 aFol; varying vec2 vFol;',
    vMain: 'vFol = aFol;',
    fHead: 'varying vec2 vFol;',
    fColor: /* glsl */`
      float sn = smoothstep(0.35, 0.65, vFol.y + (vn3(vWPos * 1.3) - 0.5) * 0.55 + (vn3(vWPos * 4.0) - 0.5) * 0.2);
      diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor * 0.95, sn) * vFol.x;
    `,
  });
}

// -------------- камни, брёвна, сухостой, арки: снег ложится на верхние грани пятнами
export function makeSnowyMaterial(color, { key = 'snowy', map = null, snowLo = 0.25, snowHi = 0.6, speckle = 0.6, amount = 1.0, flat = false } = {}) {
  const mat = new THREE.MeshLambertMaterial({ color, map, flatShading: flat });
  return patch(mat, key, {
    fColor: /* glsl */`
      {
        vec3 wn = normalize(vWNorm);
        float n = vn3(vWPos * 0.55) * 0.5 + vn3(vWPos * 1.9) * 0.32 + vn3(vWPos * 6.5) * 0.18;
        float s = smoothstep(${snowLo.toFixed(3)}, ${snowHi.toFixed(3)}, wn.y + (n - 0.5) * ${speckle.toFixed(3)});
        diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor, s * ${amount.toFixed(3)});
      }
    `,
  });
}
