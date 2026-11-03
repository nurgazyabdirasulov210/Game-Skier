import * as THREE from '../vendor/three.module.js';
import { G, GLSL_UNIFORMS, FRAG_HEAD } from './shaderlib.js';

// Универсальный стилизованный материал + его «теневой» вариант.

const VERT = /* glsl */`
${GLSL_UNIFORMS}
varying vec3 vWorld; varying vec3 vN; varying vec3 vCol; varying vec3 vLocal;
void main(){
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = m * instanceMatrix;
  #endif
  vec3 p = position;
  vec4 w = m * vec4(p, 1.0);
  #ifdef WIND
    float hgt = max(p.y - 0.8, 0.0);
    float ph = w.x * 0.13 + w.z * 0.09;
    float sway = (sin(uTime * 1.2 + ph) + 0.45 * sin(uTime * 2.3 + ph * 2.0)) * uWind * 0.012 * hgt * hgt * 0.25;
    w.x += sway; w.z += sway * 0.55;
  #endif
  vWorld = w.xyz;
  vLocal = p;
  #ifndef DEPTH_ONLY
    vN = normalize(mat3(m) * normal);
    vCol = vec3(1.0);
    #ifdef USE_COLOR
      vCol = color;
    #endif
    #ifdef USE_INSTANCING_COLOR
      vCol *= instanceColor;
    #endif
  #endif
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */`
${FRAG_HEAD}
uniform vec3 uTint; uniform float uSnow; uniform float uWrap; uniform float uRim; uniform float uOpacity;
varying vec3 vWorld; varying vec3 vN; varying vec3 vCol; varying vec3 vLocal;
void main(){
  vec3 n = normalize(vN);
  #ifdef DOUBLE
    if (!gl_FrontFacing) n = -n;
  #endif
  vec3 albedo = vCol * uTint;
  #ifdef SNOW
    float nz = sin(vWorld.x * 3.1 + vWorld.y * 1.7) * sin(vWorld.z * 2.7 - vWorld.y * 2.3);
    float s = smoothstep(0.42, 0.62, n.y + nz * 0.16) * uSnow;
    albedo = mix(albedo, vec3(0.9, 0.93, 1.0), s);
  #endif
  float sh = shadowAt(vWorld, n);
  vec3 col = shadeLit(albedo, n, vWorld, sh, uWrap, 1.0);
  vec3 V = normalize(uCamPos - vWorld);
  float fr = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 2.5);
  col += (uSunCol * 0.35 + uSkyAmb * 0.5) * fr * uRim * clamp(dot(-V, uSunDir) * 0.5 + 0.6, 0.0, 1.0);
  col = fogApply(col, vWorld);
  gl_FragColor = vec4(col, uOpacity);
}`;

const DEPTH_FRAG = /* glsl */`void main(){}`;

export function makeMaterial({ snow = 0, wind = false, wrap = 0.35, rim = 0.25, tint = 0xffffff, vertexColors = true, double = false, transparent = false, opacity = 1 } = {}) {
  const defines = {};
  if (snow > 0) defines.SNOW = 1;
  if (wind) defines.WIND = 1;
  if (double) defines.DOUBLE = 1;
  const local = {
    uTint: { value: new THREE.Color(tint) },
    uSnow: { value: snow },
    uWrap: { value: wrap },
    uRim: { value: rim },
    uOpacity: { value: opacity },
  };
  const uniforms = Object.assign({}, G, local);
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, defines, vertexColors,
    side: double ? THREE.DoubleSide : THREE.FrontSide, transparent, depthWrite: !transparent,
  });
  const depth = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: DEPTH_FRAG,
    defines: Object.assign({ DEPTH_ONLY: 1 }, wind ? { WIND: 1 } : {}),
    colorWrite: false, side: THREE.DoubleSide,
  });
  mat.userData.depthMat = depth;
  return mat;
}

export function withDepth(mesh) {
  mesh.userData.depthMat = mesh.material.userData.depthMat;
  return mesh;
}

// ------------------------------------------------------------ геометрия

// Слить несколько частей в одну flat-shaded геометрию с вершинными цветами.
// part: { geo, color: Color | (p, n) => Color, matrix?: Matrix4 }
const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Color();
export function mergeParts(parts) {
  const pos = [], nor = [], col = [];
  for (const part of parts) {
    let g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
    if (part.sphere) {
      // мягкие «шарообразные» нормали для крон и комьев
      const P0 = g.attributes.position, nn = new Float32Array(P0.count * 3);
      for (let i = 0; i < P0.count; i++) { _n.fromBufferAttribute(P0, i).normalize(); nn[i * 3] = _n.x; nn[i * 3 + 1] = _n.y; nn[i * 3 + 2] = _n.z; }
      g.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
      if (part.matrix) g.applyMatrix4(part.matrix);
    } else {
      if (part.matrix) g.applyMatrix4(part.matrix);
      g.computeVertexNormals();
    }
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      _p.fromBufferAttribute(P, i); _n.fromBufferAttribute(N, i);
      pos.push(_p.x, _p.y, _p.z); nor.push(_n.x, _n.y, _n.z);
      const c = typeof part.color === 'function' ? part.color(_p, _n, i) : part.color;
      _c.set(c);
      col.push(_c.r, _c.g, _c.b);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

export function M4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  return m;
}

// детерминированный ГПСЧ
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// случайное смещение вершин (для камней/комьев), сохраняя совпадающие вершины
export function jitter(geo, amount, seed = 1, flattenY = 1) {
  const g = geo.index ? geo : geo;
  const P = g.attributes.position;
  const map = new Map();
  const r = rng(seed);
  for (let i = 0; i < P.count; i++) {
    const k = `${P.getX(i).toFixed(3)},${P.getY(i).toFixed(3)},${P.getZ(i).toFixed(3)}`;
    let d = map.get(k);
    if (!d) { d = [(r() - 0.5) * amount, (r() - 0.5) * amount, (r() - 0.5) * amount]; map.set(k, d); }
    P.setXYZ(i, P.getX(i) + d[0], (P.getY(i) + d[1]) * flattenY, P.getZ(i) + d[2]);
  }
  P.needsUpdate = true;
  return g;
}
