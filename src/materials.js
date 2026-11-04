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
  uSnowGlow: { value: 0.0 },
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
uniform float uSparkle; uniform float uTime; uniform float uTranslucency; uniform float uSelfLit; uniform float uSnowGlow;
`;

function patch(mat, key, p) {
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, SHARED, p.uniforms || {});
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WORLD_VARYINGS + (p.vHead || ''))
      .replace('#include <project_vertex>', (p.project || '#include <project_vertex>') + '\n' + WORLD_V + (p.vMain || ''));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WORLD_VARYINGS + UNIFORM_DECL + GLSL_NOISE + (p.fHead || ''))
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + (p.fColor || ''))
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + (p.fNormal || ''))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + (p.fEmissive || ''));
  };
  return mat;
}

// ---------------------------------------------------------------- снег (рельеф)
// Стилизованный снег: гладкий, без фактуры. Цвет теней задаёт свет неба
// (синий днём, фиолетовый на закате, кобальт ночью), плюс мягкое затенение
// во впадинах и у стволов.
export function makeTerrainMaterial() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  return patch(mat, 'terrain-sno', {
    vHead: 'attribute vec3 aTerr; varying vec3 vTerr;',
    vMain: 'vTerr = aTerr;',
    fHead: 'varying vec3 vTerr;',
    fColor: /* glsl */`
      diffuseColor.rgb = uSnowColor * mix(1.0, vTerr.x, 0.85);
    `,
    fEmissive: /* glsl */`
      {
        // лёгкое «подсвечивание» снега изнутри — тени не проваливаются в серое
        totalEmissiveRadiance += uSnowColor * uSnowGlow * vTerr.x;
      }
    `,
  });
}

// ------------------------------------------------- пушистые кроны / кусты
// Крона — облако спрайтов, развёрнутых к камере (aCorner — смещение угла
// в пространстве вида). Нормаль сферическая, поэтому шар освещается объёмно,
// а по краю виден мех из текстуры.
const BILLBOARD_PROJECT = /* glsl */`
  vec4 mvPosition = vec4( transformed, 1.0 );
  float bbScale = 1.0;
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
    bbScale = length( instanceMatrix[0].xyz );
  #endif
  mvPosition = modelViewMatrix * mvPosition;
  mvPosition.xy += aCorner * bbScale;
  gl_Position = projectionMatrix * mvPosition;
`;

export function makeFoliageMaterial(map, { key = 'foliage', alphaToCoverage = false, translucency = 0.55 } = {}) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, map, alphaTest: 0.5, side: THREE.DoubleSide, alphaToCoverage });
  patch(mat, key + alphaToCoverage, {
    vHead: 'attribute vec2 aFol; attribute vec2 aCorner; varying vec2 vFol;',
    project: BILLBOARD_PROJECT,
    vMain: /* glsl */`
      vFol = aFol;
      // скругляем нормаль по краям спрайта — шар выглядит объёмнее
      vec2 cdir = aCorner / max(length(aCorner), 1e-4);
      vNormal = normalize(normalize(vNormal) + vec3(cdir, 0.0) * 0.35);
    `,
    fHead: 'varying vec2 vFol;',
    fColor: /* glsl */`
      float sn = smoothstep(0.3, 0.62, vFol.y + (vn3(vWPos * 1.3) - 0.5) * 0.3);
      diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor, sn) * vFol.x;
    `,
    fNormal: 'normal = normalize(vNormal);',
    fEmissive: /* glsl */`
      {
        vec3 V = normalize(cameraPosition - vWPos);
        float tr = pow(max(dot(-V, uSunDir), 0.0), 4.0);
        totalEmissiveRadiance += diffuseColor.rgb * uSunColor * tr * ${translucency.toFixed(3)} * uTranslucency * (1.0 - sn);
        totalEmissiveRadiance += diffuseColor.rgb * uSelfLit * (1.0 - sn * 0.6);
      }
    `,
  });
  // тень от спрайтов: те же развёрнутые карточки, но к источнику света
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
  depth.customProgramCacheKey = () => 'bb-depth';
  depth.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCorner;')
      .replace('#include <project_vertex>', BILLBOARD_PROJECT);
  };
  mat.userData.depth = depth;
  return mat;
}

// --------------------------------------------------- ель: вершинные цвета + снег
export function makeSpruceMaterial() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  return patch(mat, 'spruce', {
    vHead: 'attribute vec2 aFol; varying vec2 vFol;',
    vMain: 'vFol = aFol;',
    fHead: 'varying vec2 vFol;',
    fColor: /* glsl */`
      float sn = smoothstep(0.38, 0.62, vFol.y + (vn3(vWPos * 2.5) - 0.5) * 0.25);
      diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor * 0.95, sn) * vFol.x;
    `,
  });
}

// -------------- камни, брёвна, сухостой, арки: снег ложится на верхние грани пятнами
export function makeSnowyMaterial(color, { key = 'snowy', map = null, snowLo = 0.25, snowHi = 0.6, speckle = 0.6, amount = 1.0, flat = false, blotch = 0.0, blotchScale = 0.7 } = {}) {
  const mat = new THREE.MeshLambertMaterial({ color, map, flatShading: flat });
  return patch(mat, key, {
    fColor: /* glsl */`
      {
        vec3 wn = normalize(vWNorm);
        float n = vn3(vWPos * 0.55) * 0.5 + vn3(vWPos * 1.9) * 0.32 + vn3(vWPos * 6.5) * 0.18;
        float s = smoothstep(${snowLo.toFixed(3)}, ${snowHi.toFixed(3)}, wn.y + (n - 0.5) * ${speckle.toFixed(3)});
        // крупные снежные пятна и на боковых гранях
        float b = vn3(vWPos * ${blotchScale.toFixed(3)}) * 0.65 + vn3(vWPos * ${(blotchScale * 3.1).toFixed(3)}) * 0.35;
        s = max(s, smoothstep(0.5, 0.56, b + wn.y * 0.12) * ${blotch.toFixed(3)});
        diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor, s * ${amount.toFixed(3)});
      }
    `,
  });
}
