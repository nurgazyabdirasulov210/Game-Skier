import * as THREE from '../vendor/three.module.js';
import { G } from './shaderlib.js';

// Карта деформации снега: R — глубина колеи, G — бруствер.
// Окно привязано к миру и переезжает вслед за игроком (копированием со сдвигом).

const STAMP_VERT = /* glsl */`
attribute vec4 aSeg;    // x0, z0, x1, z1 (в мировых координатах)
attribute vec4 aParam;  // halfWidth, depth, berm, round
uniform vec2 uOrigin; uniform float uSize;
varying vec2 vP; varying vec4 vSeg; varying vec4 vParam;
void main(){
  vec2 a = aSeg.xy, b = aSeg.zw;
  float r = aParam.x * 2.1;
  vec2 mn = min(a, b) - r, mx = max(a, b) + r;
  vec2 p = mix(mn, mx, position.xy * 0.5 + 0.5);
  vP = p; vSeg = aSeg; vParam = aParam;
  vec2 uv = (p - uOrigin) / uSize;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;
const STAMP_FRAG = /* glsl */`
varying vec2 vP; varying vec4 vSeg; varying vec4 vParam;
void main(){
  vec2 a = vSeg.xy, b = vSeg.zw;
  vec2 ab = b - a; float l2 = max(dot(ab, ab), 1e-6);
  float t = clamp(dot(vP - a, ab) / l2, 0.0, 1.0);
  float d = length(vP - (a + ab * t));
  float w = vParam.x;
  float x = d / w;
  float carve = vParam.y * (1.0 - smoothstep(0.55, 1.0, x));
  float bx = (x - 1.25) / 0.42;
  float berm = vParam.z * exp(-bx * bx);
  gl_FragColor = vec4(carve, berm, 0.0, 1.0);
}`;

const COPY_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const COPY_FRAG = /* glsl */`
uniform sampler2D uSrc; uniform vec2 uShift;
varying vec2 vUv;
void main(){
  vec2 uv = vUv + uShift;
  vec4 c = texture2D(uSrc, uv);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) c = vec4(0.0);
  gl_FragColor = c;
}`;

const MAX_STAMPS = 64;

export class Trail {
  constructor(renderer, { res = 1024, size = 160 } = {}) {
    this.renderer = renderer;
    this.res = res; this.size = size;
    const mk = () => new THREE.WebGLRenderTarget(res, res, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    });
    this.rtA = mk(); this.rtB = mk();
    this.origin = new THREE.Vector2(-size / 2, -size / 2);
    this.cam = new THREE.Camera();

    // штампы
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aSeg = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4);
    this.aParam = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4);
    this.aSeg.setUsage(THREE.DynamicDrawUsage); this.aParam.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSeg', this.aSeg); geo.setAttribute('aParam', this.aParam);
    geo.instanceCount = 0;
    this.stampMat = new THREE.ShaderMaterial({
      uniforms: { uOrigin: { value: this.origin }, uSize: { value: size } },
      vertexShader: STAMP_VERT, fragmentShader: STAMP_FRAG,
      depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this.stampGeo = geo;
    this.stampMesh = new THREE.Mesh(geo, this.stampMat);
    this.stampMesh.frustumCulled = false;
    this.stampScene = new THREE.Scene(); this.stampScene.add(this.stampMesh);
    this.count = 0;

    // копирование со сдвигом
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { uSrc: { value: null }, uShift: { value: new THREE.Vector2() } },
      vertexShader: COPY_VERT, fragmentShader: COPY_FRAG, depthTest: false, depthWrite: false,
    });
    this.copyMesh = new THREE.Mesh(quad, this.copyMat); this.copyMesh.frustumCulled = false;
    this.copyScene = new THREE.Scene(); this.copyScene.add(this.copyMesh);

    this.clear();
    G.uTrail.value = this.rtA.texture;
    G.uTrailOrigin.value = this.origin;
    G.uTrailSize.value = size;
    G.uTrailTexel.value = size / res;
  }
  clear() {
    const r = this.renderer, prev = r.getRenderTarget();
    const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rtA); r.clear(true, false, false);
    r.setRenderTarget(this.rtB); r.clear(true, false, false);
    r.setRenderTarget(prev); r.setClearColor(cc, ca);
  }
  resetAt(x, z) {
    this.origin.set(x - this.size / 2, z - this.size / 2);
    this.clear();
  }
  // добавить отрезок колеи
  stamp(x0, z0, x1, z1, halfWidth, depth = 1, berm = 1) {
    if (this.count >= MAX_STAMPS) return;
    const i = this.count++;
    this.aSeg.array.set([x0, z0, x1, z1], i * 4);
    this.aParam.array.set([halfWidth, depth, berm, 0], i * 4);
  }
  update(px, pz) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const ac = r.autoClear; r.autoClear = false;
    // переезд окна
    const cx = this.origin.x + this.size / 2, cz = this.origin.y + this.size / 2;
    if (Math.abs(px - cx) > this.size * 0.22 || Math.abs(pz - cz) > this.size * 0.22) {
      const texel = this.size / this.res;
      const nx = Math.round((px - this.size / 2) / texel) * texel;
      const nz = Math.round((pz - this.size / 2) / texel) * texel;
      this.copyMat.uniforms.uSrc.value = this.rtA.texture;
      this.copyMat.uniforms.uShift.value.set((nx - this.origin.x) / this.size, (nz - this.origin.y) / this.size);
      r.setRenderTarget(this.rtB);
      r.render(this.copyScene, this.cam);
      [this.rtA, this.rtB] = [this.rtB, this.rtA];
      this.origin.set(nx, nz);
      G.uTrail.value = this.rtA.texture;
    }
    if (this.count > 0) {
      this.stampGeo.instanceCount = this.count;
      this.aSeg.needsUpdate = true; this.aParam.needsUpdate = true;
      r.setRenderTarget(this.rtA);
      r.render(this.stampScene, this.cam);
      this.count = 0;
    }
    r.setRenderTarget(prev);
    r.autoClear = ac;
  }
}
