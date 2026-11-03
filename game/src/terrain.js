import * as THREE from '../vendor/three.module.js';
import { G, VERT_HEAD, FRAG_HEAD, GLSL_TRAIL } from './shaderlib.js';
import { GLSL_WORLD } from './world.js';

// GPU clipmap: концентрические сетки, высота считается прямо в вершинном шейдере.

const VERT = /* glsl */`
${VERT_HEAD}
uniform vec2 uCenter; uniform float uSpacing; uniform float uHalfExt;
varying vec3 vWorld; varying vec3 vN; varying float vEdge;
void main(){
  vec2 g = position.xz;
  vec2 wp = uCenter + g * uSpacing;
  vec2 dv = abs(wp - uCenter) / uHalfExt;
  float r = max(dv.x, dv.y);
  float k = clamp((r - 0.68) / 0.24, 0.0, 1.0);
  wp -= fract(g * 0.5) * 2.0 * uSpacing * k;
  float h = heightAt(wp);
  #ifndef DEPTH_ONLY
    float e = max(uSpacing, 0.3);
    float hx = heightAt(wp + vec2(e, 0.0)) - h;
    float hz = heightAt(wp + vec2(0.0, e)) - h;
    vN = normalize(vec3(-hx, e, -hz));
    vEdge = r;
  #endif
  vec2 tr = trailAt(wp);
  vec3 w = vec3(wp.x, h + POWDER + trailDisp(tr), wp.y);
  vWorld = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const FRAG = /* glsl */`
${FRAG_HEAD}
${GLSL_WORLD}
${GLSL_TRAIL}
uniform vec2 uInnerCenter; uniform float uInnerHalf; uniform float uOuter;
varying vec3 vWorld; varying vec3 vN; varying float vEdge;
void main(){
  #ifndef NO_DISCARD
    vec2 dd = abs(vWorld.xz - uInnerCenter);
    if (max(dd.x, dd.y) < uInnerHalf) discard;
  #endif
  vec3 n = normalize(vN);
  float dist = length(vWorld - uCamPos);

  // колея: нормаль из градиента карты следов
  float tx = uTrailTexel;
  vec2 t0 = trailAt(vWorld.xz);
  float carve = t0.x;
  if (dist < 90.0) {
    float d0 = trailDisp(t0);
    float dx = trailDisp(trailAt(vWorld.xz + vec2(tx, 0.0))) - d0;
    float dz = trailDisp(trailAt(vWorld.xz + vec2(0.0, tx))) - d0;
    // рваные «комковатые» стенки колеи
    float chunk = gnoise(vWorld.xz * 3.1) * 0.5 + gnoise(vWorld.xz * 7.3) * 0.25;
    float wall = clamp(length(vec2(dx, dz)) / tx * 1.5, 0.0, 1.0);
    vec3 tn = vec3(-dx / tx, 0.0, -dz / tx) * (1.0 + chunk * 1.2);
    n = normalize(n + tn * 0.85);
    n = normalize(n + vec3(chunk, 0.0, -chunk) * 0.35 * wall);
  }
  // ветровая рябь и микрорельеф
  float fade = 1.0 - smoothstep(25.0, 120.0, dist);
  if (fade > 0.0) {
    float rip = gnoise(vec2(vWorld.x * 0.9, vWorld.z * 0.35)) * 0.06 + gnoise(vWorld.xz * 2.2) * 0.025;
    n = normalize(n + vec3(rip, 0.0, rip * 0.6) * fade * (1.0 - carve));
  }

  float sh = shadowAt(vWorld, n);
  float ndl = dot(n, uSunDir);
  float diff = clamp((ndl + 0.3) / 1.3, 0.0, 1.0);
  diff = diff * diff * (3.0 - 2.0 * diff);
  float lit = diff * sh;

  vec3 albedo = vec3(0.93, 0.95, 1.0);
  // скальные выходы на крутых сбросах
  float rock = smoothstep(0.66, 0.56, n.y + gnoise(vWorld.xz * 0.45) * 0.05);
  rock *= (1.0 - carve);
  vec3 rockCol = mix(vec3(0.07, 0.075, 0.11), vec3(0.16, 0.16, 0.2), gnoise(vWorld.xz * 1.3) * 0.5 + 0.5);
  float streak = smoothstep(0.1, 0.4, gnoise(vec2(vWorld.x * 1.8, vWorld.y * 0.6)));
  albedo = mix(albedo, mix(rockCol, albedo * 0.9, streak * 0.55), rock);

  float ao = 1.0 - carve * 0.3;
  vec3 col = albedo * (ambientAt(n) * ao + uSunCol * lit);
  // подповерхностное рассеяние — голубизна на границе тени
  col += uSkyAmb * 0.1 * (1.0 - lit) * (1.0 - rock);
  vec3 V = normalize(uCamPos - vWorld);
  vec3 H = normalize(uSunDir + V);
  col += uSunCol * pow(max(dot(n, H), 0.0), 48.0) * 0.18 * sh * (1.0 - rock);
  float fr = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 4.0);
  col += uSkyAmb * fr * 0.22;

  // искрящийся снег
  if (dist < 40.0) {
    vec2 cell = floor(vWorld.xz * 11.0);
    float s = hash01(ivec2(cell));
    float tw = fract(s * 37.0 + dot(V, vec3(5.0, 3.0, 4.0)));
    float glint = smoothstep(0.985, 1.0, tw) * step(0.82, s) * lit * (1.0 - dist / 40.0) * (1.0 - carve);
    col += (uSunCol + vec3(0.6) * uNight) * glint * 1.6;
  }

  col = fogApply(col, vWorld);
  // растворение у внешнего края дальнего кольца
  float edge = smoothstep(0.82, 0.98, vEdge) * uOuter;
  col = mix(col, skyColor(normalize(vec3(-V.x, 0.015, -V.z))), edge);
  gl_FragColor = vec4(col, 1.0);
}
`;

const DEPTH_FRAG = /* glsl */`
uniform vec2 uInnerCenter; uniform float uInnerHalf;
varying vec3 vWorld;
void main(){
  #ifndef NO_DISCARD
    vec2 dd = abs(vWorld.xz - uInnerCenter);
    if (max(dd.x, dd.y) < uInnerHalf) discard;
  #endif
}`;

function buildGrid(N) {
  const g = new THREE.BufferGeometry();
  const v = new Float32Array((N + 1) * (N + 1) * 3);
  let p = 0;
  for (let z = 0; z <= N; z++) for (let x = 0; x <= N; x++) {
    v[p++] = x - N / 2; v[p++] = 0; v[p++] = z - N / 2;
  }
  const idx = new Uint32Array(N * N * 6);
  let q = 0;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const a = z * (N + 1) + x, b = a + 1, c = a + N + 1, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b;
    idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return g;
}

export class Terrain {
  constructor(scene, { N = 128, s0 = 0.25, levels = 7 } = {}) {
    this.N = N; this.s0 = s0; this.levels = [];
    this.geo = buildGrid(N);
    for (let i = 0; i < levels; i++) {
      const spacing = s0 * Math.pow(2, i);
      const lu = {
        uCenter: { value: new THREE.Vector2() },
        uSpacing: { value: spacing },
        uHalfExt: { value: (N / 2) * spacing },
        uInnerCenter: { value: new THREE.Vector2() },
        uInnerHalf: { value: -1 },
        uOuter: { value: i === levels - 1 ? 1 : 0 },
      };
      const uniforms = Object.assign({}, G, lu);
      const mat = new THREE.ShaderMaterial({
        uniforms, vertexShader: VERT, fragmentShader: FRAG,
        defines: i === 0 ? { NO_DISCARD: 1 } : {},
      });
      const depth = new THREE.ShaderMaterial({
        uniforms, vertexShader: VERT, fragmentShader: DEPTH_FRAG,
        defines: i === 0 ? { DEPTH_ONLY: 1, NO_DISCARD: 1 } : { DEPTH_ONLY: 1 }, colorWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = i;
      mesh.userData.depthMat = depth;
      mesh.userData.shadowLevel = i;
      scene.add(mesh);
      this.levels.push({ mesh, lu, spacing });
    }
  }
  get meshes() { return this.levels.map((l) => l.mesh); }
  update(pos) {
    for (let i = 0; i < this.levels.length; i++) {
      const L = this.levels[i];
      const snap = L.spacing * 2;
      L.lu.uCenter.value.set(Math.floor(pos.x / snap) * snap, Math.floor(pos.z / snap) * snap);
      if (i > 0) {
        const inner = this.levels[i - 1];
        L.lu.uInnerCenter.value.copy(inner.lu.uCenter.value);
        L.lu.uInnerHalf.value = inner.lu.uHalfExt.value - 0.001;
      }
    }
  }
}
