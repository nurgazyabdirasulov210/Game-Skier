import * as THREE from '../vendor/three.module.js';
import { G, GLSL_UNIFORMS, FRAG_HEAD } from './shaderlib.js';

// GPU-частицы: траектория считается аналитически (гравитация + линейное сопротивление).

const BALLISTIC = /* glsl */`
vec3 ballistic(vec3 p0, vec3 v0, float k, float grav, float t){
  float e = exp(-k * t);
  vec3 g = vec3(0.0, -grav, 0.0);
  return p0 + v0 * (1.0 - e) / k + g * (t / k - (1.0 - e) / (k * k));
}
mat3 rotAxis(vec3 a, float ang){
  float s = sin(ang), c = cos(ang), oc = 1.0 - c;
  return mat3(oc*a.x*a.x + c, oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,
              oc*a.x*a.y - a.z*s, oc*a.y*a.y + c, oc*a.y*a.z + a.x*s,
              oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c);
}`;

const CLUMP_VERT = /* glsl */`
${GLSL_UNIFORMS}
${BALLISTIC}
uniform float uNow;
attribute vec4 aP0; attribute vec4 aV0; attribute vec4 aMisc;
varying vec3 vWorld; varying vec3 vN; varying float vFade;
void main(){
  float age = uNow - aP0.w, life = aV0.w;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 c = ballistic(aP0.xyz, aV0.xyz, aMisc.z, 7.5, age);
  float f = age / life;
  float s = aMisc.x * (1.0 - smoothstep(0.55, 1.0, f)) * smoothstep(0.0, 0.06, age);
  vec3 ax = normalize(vec3(sin(aMisc.y * 12.9), cos(aMisc.y * 7.3), sin(aMisc.y * 3.1) + 0.2));
  mat3 R = rotAxis(ax, aMisc.y * 6.0 + age * (2.0 + aMisc.y * 4.0) * (1.0 - f * 0.7));
  vec3 w = c + R * (position * s);
  vWorld = w; vN = R * normal; vFade = f;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const CLUMP_FRAG = /* glsl */`
${FRAG_HEAD}
varying vec3 vWorld; varying vec3 vN; varying float vFade;
void main(){
  vec3 n = normalize(vN);
  float sh = shadowAt(vWorld, n);
  float ndl = dot(n, uSunDir);
  float d = clamp((ndl + 0.5) / 1.5, 0.0, 1.0);
  vec3 col = vec3(0.94, 0.96, 1.0) * (ambientAt(n) * 1.05 + uSunCol * d * mix(0.35, 1.0, sh));
  vec3 V = normalize(uCamPos - vWorld);
  col += uSkyAmb * pow(1.0 - abs(dot(n, V)), 3.0) * 0.35;
  gl_FragColor = vec4(fogApply(col, vWorld), 1.0);
}`;

const MIST_VERT = /* glsl */`
${GLSL_UNIFORMS}
${BALLISTIC}
uniform float uNow;
attribute vec4 aP0; attribute vec4 aV0; attribute vec4 aMisc;
varying vec2 vQ; varying float vA; varying vec3 vWorld;
void main(){
  float age = uNow - aP0.w, life = aV0.w;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float f = age / life;
  vec3 c = ballistic(aP0.xyz, aV0.xyz, aMisc.z, 1.2, age);
  float s = aMisc.x * (0.35 + f * 1.2);
  vec4 mv = viewMatrix * vec4(c, 1.0);
  float a = aMisc.y * 6.28 + age * 0.4;
  vec2 q = mat2(cos(a), sin(a), -sin(a), cos(a)) * position.xy;
  mv.xy += q * s;
  vQ = position.xy; vWorld = c;
  vA = aMisc.w * smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.35, 1.0, f));
  gl_Position = projectionMatrix * mv;
}`;
const MIST_FRAG = /* glsl */`
${FRAG_HEAD}
varying vec2 vQ; varying float vA; varying vec3 vWorld;
void main(){
  float r = length(vQ);
  float a = smoothstep(1.0, 0.0, r);
  a *= a * vA;
  if (a < 0.003) discard;
  vec3 col = vec3(0.95, 0.97, 1.0) * (uSkyAmb * 1.1 + uSunCol * 0.55);
  gl_FragColor = vec4(fogApply(col, vWorld), a);
}`;

class Emitter {
  constructor(scene, geo, mat, max) {
    this.max = max; this.i = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.index = geo.index;
    for (const k of Object.keys(geo.attributes)) g.setAttribute(k, geo.attributes[k]);
    this.aP0 = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aV0 = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    for (const a of [this.aP0, this.aV0, this.aMisc]) a.setUsage(THREE.DynamicDrawUsage);
    // все частицы изначально «мертвы»
    for (let k = 0; k < max; k++) { this.aP0.array[k * 4 + 3] = -1e6; this.aV0.array[k * 4 + 3] = 0.001; }
    g.setAttribute('aP0', this.aP0); g.setAttribute('aV0', this.aV0); g.setAttribute('aMisc', this.aMisc);
    g.instanceCount = max;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.dirty = false;
    this.lo = max; this.hi = -1;
  }
  emit(now, px, py, pz, vx, vy, vz, life, size, seed, drag, alpha = 1) {
    const i = this.i; this.i = (this.i + 1) % this.max;
    this.aP0.array.set([px, py, pz, now], i * 4);
    this.aV0.array.set([vx, vy, vz, life], i * 4);
    this.aMisc.array.set([size, seed, drag, alpha], i * 4);
    this.dirty = true;
  }
  flush() {
    if (!this.dirty) return;
    this.aP0.needsUpdate = true; this.aV0.needsUpdate = true; this.aMisc.needsUpdate = true;
    this.dirty = false;
  }
}

const SNOW_VERT = /* glsl */`
${GLSL_UNIFORMS}
uniform float uDensity; uniform float uSize;
attribute vec3 aSeed;
varying float vA;
void main(){
  vec3 box = vec3(70.0, 40.0, 70.0);
  vec3 drift = vec3(sin(uTime * 0.3 + aSeed.x * 6.0) * 0.6 + uWind * 1.5, -1.1 - aSeed.y * 0.8, cos(uTime * 0.25 + aSeed.z * 6.0) * 0.6);
  vec3 p = aSeed * box + drift * uTime;
  p = mod(p - uCamPos + box * 0.5, box) - box * 0.5 + uCamPos;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  gl_PointSize = clamp(uSize * (0.6 + aSeed.x) / max(d, 0.5), 1.0, 9.0);
  float show = step(fract(aSeed.y * 7.13), uDensity);
  vA = show * smoothstep(0.5, 3.0, d) * (1.0 - smoothstep(20.0, 34.0, d));
}`;
const SNOW_FRAG = /* glsl */`
${GLSL_UNIFORMS}
varying float vA;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.15, length(q)) * vA;
  if (a < 0.01) discard;
  vec3 col = uSkyAmb * 1.3 + uSunCol * 0.3 + vec3(0.25) * uNight;
  gl_FragColor = vec4(col, a * 0.85);
}`;

export class Particles {
  constructor(scene, { clumps = 900, mist = 260, flakes = 2500 } = {}) {
    const U = Object.assign({}, G, { uNow: { value: 0 } });
    this.U = U;
    const clumpGeo = new THREE.IcosahedronGeometry(1, 0);
    const P = clumpGeo.attributes.position;
    for (let i = 0; i < P.count; i++) { const k = 0.8 + ((i * 7919) % 13) / 30; P.setXYZ(i, P.getX(i) * k, P.getY(i) * k * 0.85, P.getZ(i) * k); }
    clumpGeo.computeVertexNormals();
    this.clumps = new Emitter(scene, clumpGeo, new THREE.ShaderMaterial({ uniforms: U, vertexShader: CLUMP_VERT, fragmentShader: CLUMP_FRAG }), clumps);
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    this.mist = new Emitter(scene, quad, new THREE.ShaderMaterial({
      uniforms: U, vertexShader: MIST_VERT, fragmentShader: MIST_FRAG, transparent: true, depthWrite: false,
    }), mist);
    this.mist.mesh.renderOrder = 50;

    // снегопад
    const sg = new THREE.BufferGeometry();
    const seeds = new Float32Array(flakes * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    sg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flakes * 3), 3));
    this.snowU = Object.assign({}, G, { uDensity: { value: 0.3 }, uSize: { value: 26 } });
    this.snow = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: this.snowU, vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG, transparent: true, depthWrite: false,
    }));
    this.snow.frustumCulled = false; this.snow.renderOrder = 60;
    scene.add(this.snow);
    this.now = 0;
    this.seed = 0;
  }
  rnd() { this.seed = (this.seed * 16807 + 11) % 2147483647; return (this.seed % 100000) / 100000; }
  // ком снега
  clump(p, v, size, life = 1.2, drag = 1.6) {
    this.clumps.emit(this.now, p.x, p.y, p.z, v.x, v.y, v.z, life, size, Math.random(), drag);
  }
  puff(p, v, size, alpha = 0.35, life = 1.6) {
    this.mist.emit(this.now, p.x, p.y, p.z, v.x, v.y, v.z, life, size, Math.random(), 2.2, alpha);
  }
  update(dt, pixelRatio = 1) {
    this.now += dt;
    this.U.uNow.value = this.now;
    this.snowU.uSize.value = 22 * pixelRatio;
    this.clumps.flush(); this.mist.flush();
  }
}
