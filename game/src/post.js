// HDR post-processing: dual-filter bloom, sun shafts, speed blur, chromatic
// aberration, ACES tone mapping, colour grading, vignette and film grain.
import * as THREE from '../vendor/three.module.js';

const VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function pass(frag, uniforms) {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: frag, depthTest: false, depthWrite: false });
}

export class Post {
  constructor(renderer, q) {
    this.r = renderer;
    this.q = q;
    const ext = renderer.extensions;
    this.hdr = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
    this.type = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(geo);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.sceneRT = new THREE.WebGLRenderTarget(4, 4, { type: this.type, samples: q.msaa, depthBuffer: true });
    this.levels = [];
    for (let i = 0; i < 5; i++) {
      this.levels.push(new THREE.WebGLRenderTarget(4, 4, { type: this.type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
    }
    this.ups = [];
    for (let i = 0; i < 4; i++) this.ups.push(new THREE.WebGLRenderTarget(4, 4, { type: this.type, depthBuffer: false }));
    this.raysRT = new THREE.WebGLRenderTarget(4, 4, { type: this.type, depthBuffer: false });

    this.bright = pass(/* glsl */`
      uniform sampler2D tIn; uniform float uThr; uniform vec2 uTexel;
      varying vec2 vUv;
      void main() {
        vec3 c = texture(tIn, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(tIn, vUv + uTexel * vec2(1.0, -1.0)).rgb
               + texture(tIn, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(tIn, vUv + uTexel * vec2(1.0, 1.0)).rgb;
        c *= 0.25;
        float l = max(c.r, max(c.g, c.b));
        float k = max(l - uThr, 0.0) / max(l, 1e-4);
        gl_FragColor = vec4(min(c * k, vec3(40.0)), 1.0);
      }`, { tIn: { value: null }, uThr: { value: 1.0 }, uTexel: { value: new THREE.Vector2() } });

    this.down = pass(/* glsl */`
      uniform sampler2D tIn; uniform vec2 uTexel;
      varying vec2 vUv;
      void main() {
        vec3 c = texture(tIn, vUv).rgb * 4.0;
        c += texture(tIn, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
        c += texture(tIn, vUv + uTexel * vec2(1.0, -1.0)).rgb;
        c += texture(tIn, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
        c += texture(tIn, vUv + uTexel * vec2(1.0, 1.0)).rgb;
        gl_FragColor = vec4(c / 8.0, 1.0);
      }`, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() } });

    this.up = pass(/* glsl */`
      uniform sampler2D tIn; uniform sampler2D tAdd; uniform vec2 uTexel;
      varying vec2 vUv;
      void main() {
        vec3 c = vec3(0.0);
        c += texture(tIn, vUv + uTexel * vec2(-2.0, 0.0)).rgb;
        c += texture(tIn, vUv + uTexel * vec2(2.0, 0.0)).rgb;
        c += texture(tIn, vUv + uTexel * vec2(0.0, -2.0)).rgb;
        c += texture(tIn, vUv + uTexel * vec2(0.0, 2.0)).rgb;
        c += texture(tIn, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 2.0;
        c += texture(tIn, vUv + uTexel * vec2(1.0, -1.0)).rgb * 2.0;
        c += texture(tIn, vUv + uTexel * vec2(-1.0, 1.0)).rgb * 2.0;
        c += texture(tIn, vUv + uTexel * vec2(1.0, 1.0)).rgb * 2.0;
        gl_FragColor = vec4(c / 12.0 + texture(tAdd, vUv).rgb, 1.0);
      }`, { tIn: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() } });

    this.rays = pass(/* glsl */`
      uniform sampler2D tIn; uniform vec2 uSun; uniform float uAspect; uniform float uOn;
      varying vec2 vUv;
      void main() {
        if (uOn < 0.01) { gl_FragColor = vec4(0.0); return; }
        vec2 d = (uSun - vUv);
        float dist = length(d * vec2(uAspect, 1.0));
        vec2 stepv = d / 36.0 * 0.9;
        vec2 uv = vUv;
        vec3 acc = vec3(0.0);
        float w = 1.0;
        for (int i = 0; i < 36; i++) {
          vec3 s = texture(tIn, uv).rgb;
          vec2 sd = (uv - uSun) * vec2(uAspect, 1.0);
          s *= exp(-dot(sd, sd) * 9.0);
          acc += s * w;
          w *= 0.965;
          uv += stepv;
        }
        gl_FragColor = vec4(acc / 36.0 * uOn * 2.2, 1.0);
      }`, { tIn: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 }, uOn: { value: 0 } });

    this.comp = pass(/* glsl */`
      uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tRays;
      uniform float uExposure; uniform float uBloom; uniform float uRays; uniform float uSpeed;
      uniform float uSat; uniform float uVig; uniform float uTime; uniform float uCA; uniform float uFlash;
      uniform vec3 uLift; uniform vec3 uGain; uniform vec2 uRes; uniform vec3 uFlashCol; uniform float uFade;
      varying vec2 vUv;
      vec3 aces(vec3 x) {
        const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
        return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
      }
      void main() {
        vec2 uv = vUv;
        vec2 dc = uv - 0.5;
        float r2 = dot(dc, dc);
        vec3 col = vec3(0.0);
        float sb = uSpeed * smoothstep(0.02, 0.35, r2);
        for (int i = 0; i < 6; i++) {
          float t = float(i) / 5.0;
          col += texture(tScene, uv - dc * sb * t * 0.07).rgb;
        }
        col /= 6.0;
        float ca = uCA * r2;
        col.r = mix(col.r, texture(tScene, uv - dc * ca * 0.03).r, 0.85);
        col.b = mix(col.b, texture(tScene, uv + dc * ca * 0.03).b, 0.85);
        col += texture(tBloom, uv).rgb * uBloom;
        col += texture(tRays, uv).rgb * uRays;
        col *= uExposure;
        col = aces(col);
        col = pow(col, vec3(1.0 / 2.2));
        col = col * uGain + uLift * (1.0 - col);
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(l), col, uSat);
        // S-curve for punchier contrast
        col = mix(col, col * col * (3.0 - 2.0 * col), 0.32);
        col *= 1.0 - uVig * smoothstep(0.18, 0.75, r2 * 1.6);
        float g = fract(sin(dot(uv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
        col += (g - 0.5) * 0.03;
        col = mix(col, uFlashCol, uFlash);
        col *= uFade;
        gl_FragColor = vec4(col, 1.0);
      }`, {
      tScene: { value: null }, tBloom: { value: null }, tRays: { value: null },
      uExposure: { value: 1 }, uBloom: { value: 0.4 }, uRays: { value: 0.5 }, uSpeed: { value: 0 },
      uSat: { value: 1.05 }, uVig: { value: 0.35 }, uTime: { value: 0 }, uCA: { value: 0.4 }, uFlash: { value: 0 },
      uLift: { value: new THREE.Color() }, uGain: { value: new THREE.Color(1, 1, 1) }, uRes: { value: new THREE.Vector2() },
      uFlashCol: { value: new THREE.Color(1, 1, 1) }, uFade: { value: 1 },
    });
    this.flash = 0;
    this.fade = 1;
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    this.sceneRT.setSize(w, h);
    let lw = Math.max(1, w >> 1), lh = Math.max(1, h >> 1);
    for (let i = 0; i < this.levels.length; i++) {
      this.levels[i].setSize(lw, lh);
      if (i < this.ups.length) this.ups[i].setSize(lw, lh);
      lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
    }
    this.raysRT.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    this.comp.uniforms.uRes.value.set(w, h);
  }

  _draw(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.scene, this.cam);
  }

  render(scene, camera, pal, opts) {
    const r = this.r;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    // bloom chain
    const L = this.levels;
    this.bright.uniforms.tIn.value = this.sceneRT.texture;
    this.bright.uniforms.uThr.value = 2.4;
    this.bright.uniforms.uTexel.value.set(0.5 / this.w, 0.5 / this.h);
    this._draw(this.bright, L[0]);
    for (let i = 1; i < L.length; i++) {
      this.down.uniforms.tIn.value = L[i - 1].texture;
      this.down.uniforms.uTexel.value.set(1 / L[i - 1].width, 1 / L[i - 1].height);
      this._draw(this.down, L[i]);
    }
    let src = L[L.length - 1];
    for (let i = L.length - 2; i >= 0; i--) {
      this.up.uniforms.tIn.value = src.texture;
      this.up.uniforms.tAdd.value = L[i].texture;
      this.up.uniforms.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
      this._draw(this.up, this.ups[i]);
      src = this.ups[i];
    }

    // sun shafts
    const sun = opts.sunScreen;
    this.rays.uniforms.tIn.value = L[0].texture;
    this.rays.uniforms.uSun.value.copy(sun.uv);
    this.rays.uniforms.uOn.value = sun.on;
    this.rays.uniforms.uAspect.value = this.w / this.h;
    this._draw(this.rays, this.raysRT);

    const u = this.comp.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.tBloom.value = src.texture;
    u.tRays.value = this.raysRT.texture;
    u.uExposure.value = pal.exposure * (this.hdr ? 1 : 0.85);
    u.uBloom.value = pal.bloom * this.q.bloom;
    u.uRays.value = pal.rays;
    u.uSpeed.value = opts.speedBlur;
    u.uSat.value = pal.sat;
    u.uLift.value.copy(pal.lift);
    u.uGain.value.copy(pal.gain);
    u.uTime.value = opts.time;
    u.uCA.value = 0.6 + opts.speedBlur * 2;
    u.uFlash.value = this.flash;
    u.uFade.value = this.fade;
    u.uVig.value = 0.32 + opts.speedBlur * 0.6;
    this._draw(this.comp, null);
  }
}
