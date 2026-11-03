import * as THREE from '../vendor/three.module.js';

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PREFILTER = /* glsl */`
uniform sampler2D uSrc; uniform vec2 uHp; uniform float uThresh;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(uSrc, vUv).rgb * 4.0;
  c += texture2D(uSrc, vUv - uHp).rgb; c += texture2D(uSrc, vUv + uHp).rgb;
  c += texture2D(uSrc, vUv + vec2(uHp.x, -uHp.y)).rgb; c += texture2D(uSrc, vUv - vec2(uHp.x, -uHp.y)).rgb;
  c /= 8.0;
  float br = max(c.r, max(c.g, c.b));
  float k = clamp(br - uThresh, 0.0, 2.5);
  k = k * k / (k + 0.6);
  c *= k / max(br, 1e-4);
  gl_FragColor = vec4(min(c, vec3(20.0)), 1.0);
}`;
const DOWN = /* glsl */`
uniform sampler2D uSrc; uniform vec2 uHp;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(uSrc, vUv).rgb * 4.0;
  c += texture2D(uSrc, vUv - uHp).rgb; c += texture2D(uSrc, vUv + uHp).rgb;
  c += texture2D(uSrc, vUv + vec2(uHp.x, -uHp.y)).rgb; c += texture2D(uSrc, vUv - vec2(uHp.x, -uHp.y)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}`;
const UP = /* glsl */`
uniform sampler2D uSrc; uniform sampler2D uBase; uniform vec2 uHp;
varying vec2 vUv;
void main(){
  vec2 h = uHp;
  vec3 s = texture2D(uSrc, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
  s += texture2D(uSrc, vUv + vec2(-h.x, h.y)).rgb * 2.0;
  s += texture2D(uSrc, vUv + vec2(0.0, h.y * 2.0)).rgb;
  s += texture2D(uSrc, vUv + vec2(h.x, h.y)).rgb * 2.0;
  s += texture2D(uSrc, vUv + vec2(h.x * 2.0, 0.0)).rgb;
  s += texture2D(uSrc, vUv + vec2(h.x, -h.y)).rgb * 2.0;
  s += texture2D(uSrc, vUv + vec2(0.0, -h.y * 2.0)).rgb;
  s += texture2D(uSrc, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  gl_FragColor = vec4(s / 12.0 + texture2D(uBase, vUv).rgb, 1.0);
}`;
const COMPOSITE = /* glsl */`
uniform sampler2D uScene; uniform sampler2D uBloom;
uniform float uBloomStr; uniform float uExposure; uniform float uSpeed; uniform float uVig;
uniform float uTime; uniform vec2 uRes; uniform float uFade; uniform vec3 uFadeCol; uniform float uSat;
uniform vec2 uBlurCenter;
varying vec2 vUv;
// мягкая кривая Рейнхарда с точкой белого: снег остаётся белым, а полутона — контрастными
vec3 tonemap(vec3 x){
  const float k = 0.5;
  vec3 hi = k + (1.0 - k) * (1.0 - exp(-(x - k) / (1.0 - k)));
  return mix(x, hi, step(k, x));
}
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 uv = vUv;
  vec3 c = texture2D(uScene, uv).rgb;
  if (uSpeed > 0.01) {
    vec2 dir = uv - uBlurCenter;
    float amt = uSpeed * smoothstep(0.12, 0.75, length(dir * vec2(uRes.x / uRes.y, 1.0)));
    vec3 acc = c;
    float jit = h12(uv * uRes + uTime * 60.0);
    for (int i = 1; i < 7; i++) acc += texture2D(uScene, uv - dir * amt * (float(i) + jit) * 0.011).rgb;
    c = acc / 7.0;
  }
  c += texture2D(uBloom, uv).rgb * uBloomStr;
  c = tonemap(c * uExposure);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  vec2 q = uv - 0.5;
  c *= 1.0 - dot(q, q) * uVig;
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));
  c = mix(c, uFadeCol, uFade);
  c += (h12(uv * uRes + fract(uTime) * 100.0) - 0.5) / 255.0 * 1.5;
  gl_FragColor = vec4(c, 1.0);
}`;

export class Post {
  constructor(renderer, { bloom = true, msaa = 4 } = {}) {
    this.renderer = renderer;
    this.bloomOn = bloom;
    const gl = renderer.getContext();
    const hf = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    this.type = hf ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.sceneRT = new THREE.WebGLRenderTarget(4, 4, {
      type: this.type, samples: msaa, depthBuffer: true, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.camera = new THREE.Camera();
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new THREE.Mesh(quad); this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
    const M = (frag, u) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: QUAD_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
    this.mPre = M(PREFILTER, { uSrc: { value: null }, uHp: { value: new THREE.Vector2() }, uThresh: { value: 1.9 } });
    this.mDown = M(DOWN, { uSrc: { value: null }, uHp: { value: new THREE.Vector2() } });
    this.mUp = M(UP, { uSrc: { value: null }, uBase: { value: null }, uHp: { value: new THREE.Vector2() } });
    this.mComp = M(COMPOSITE, {
      uScene: { value: null }, uBloom: { value: null }, uBloomStr: { value: 0.42 }, uExposure: { value: 0.85 },
      uSpeed: { value: 0 }, uVig: { value: 0.55 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      uFade: { value: 0 }, uFadeCol: { value: new THREE.Color(1, 1, 1) }, uSat: { value: 1.18 },
      uBlurCenter: { value: new THREE.Vector2(0.5, 0.5) },
    });
    this.down = []; this.up = [];
    this.levels = 5;
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); this.black.needsUpdate = true;
  }
  setSize(w, h) {
    this.w = w; this.h = h;
    this.sceneRT.setSize(w, h);
    this.mComp.uniforms.uRes.value.set(w, h);
    for (const rt of [...this.down, ...this.up]) rt.dispose();
    this.down = []; this.up = [];
    if (!this.bloomOn) return;
    let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    for (let i = 0; i < this.levels; i++) {
      const o = { type: this.type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
      this.down.push(new THREE.WebGLRenderTarget(bw, bh, o));
      this.up.push(new THREE.WebGLRenderTarget(bw, bh, o));
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
    }
  }
  pass(mat, target) {
    this.mesh.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }
  begin() { this.renderer.setRenderTarget(this.sceneRT); }
  end(time) {
    const u = this.mComp.uniforms;
    u.uTime.value = time;
    u.uScene.value = this.sceneRT.texture;
    if (this.bloomOn && this.down.length) {
      this.mPre.uniforms.uSrc.value = this.sceneRT.texture;
      this.mPre.uniforms.uHp.value.set(0.5 / this.w, 0.5 / this.h);
      this.pass(this.mPre, this.down[0]);
      for (let i = 1; i < this.levels; i++) {
        const src = this.down[i - 1];
        this.mDown.uniforms.uSrc.value = src.texture;
        this.mDown.uniforms.uHp.value.set(0.5 / src.width, 0.5 / src.height);
        this.pass(this.mDown, this.down[i]);
      }
      let low = this.down[this.levels - 1];
      for (let i = this.levels - 2; i >= 0; i--) {
        this.mUp.uniforms.uSrc.value = low.texture;
        this.mUp.uniforms.uBase.value = this.down[i].texture;
        this.mUp.uniforms.uHp.value.set(0.5 / low.width, 0.5 / low.height);
        this.pass(this.mUp, this.up[i]);
        low = this.up[i];
      }
      u.uBloom.value = this.up[0].texture;
    } else {
      u.uBloom.value = this.black;
    }
    this.pass(this.mComp, null);
  }
}
