// Deformable snow. A world-space texture (wrapping around the rider) stores
// how deep the snow has been dug (R) and the pushed-up berms (G). Ski
// trenches, landing craters and crash holes are drawn into it as capsules
// with MAX blending; the terrain shader reads it back to lower vertices and
// bend normals.
import * as THREE from 'three';

export const TRAIL_RES = 2048;
export const TRAIL_SIZE = 256;          // metres covered by the texture
export const TRAIL_DIG = 0.62;          // metres for R = 1
export const TRAIL_LIP = 0.24;          // metres for G = 1
const TEXEL = TRAIL_SIZE / TRAIL_RES;
const MAX_STAMPS = 256;

export class SnowTrail {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(TRAIL_RES, TRAIL_RES, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.texture = this.rt.texture;

    // one instanced quad per stamp, drawn at 4 wrap offsets
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4 * 2), 2);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4 * 2), 2);
    this.aP = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4 * 4), 4);
    quad.setAttribute('aA', this.aA);
    quad.setAttribute('aB', this.aB);
    quad.setAttribute('aP', this.aP);
    quad.instanceCount = 0;
    this.quad = quad;

    this.material = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: TRAIL_SIZE } },
      vertexShader: /* glsl */`
        attribute vec2 aA; attribute vec2 aB; attribute vec4 aP;
        uniform float uSize;
        varying vec2 vW; varying vec2 vA; varying vec2 vB; varying vec4 vP;
        void main() {
          float pad = aP.x * (1.0 + aP.w) + 0.3;
          vec2 lo = min(aA, aB) - pad;
          vec2 hi = max(aA, aB) + pad;
          vec2 w = mix(lo, hi, position.xy);
          vW = w; vA = aA; vB = aB; vP = aP;
          gl_Position = vec4(w / uSize * 2.0 - 1.0, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vW; varying vec2 vA; varying vec2 vB; varying vec4 vP;
        void main() {
          vec2 ab = vB - vA;
          float t = clamp(dot(vW - vA, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
          float d = length(vW - (vA + ab * t));
          float r = vP.x;
          float q = d / r;
          // dig: round-bottomed trench with fairly steep walls
          float dig = vP.y * (1.0 - smoothstep(0.55, 1.0, q)) * (0.82 + 0.18 * (1.0 - q * q));
          // berm: ring just outside the trench
          float w = max(vP.w, 0.01);
          float lip = vP.z * smoothstep(0.75, 1.05, q) * (1.0 - smoothstep(1.05, 1.0 + w, q));
          gl_FragColor = vec4(dig, lip, 0.0, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(quad, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.pending = [];
    this.cx = null; this.cz = null;
    this.center = new THREE.Vector2();
    this.clearAll();
  }

  clearAll() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const cc = r.getClearColor(new THREE.Color());
    const ca = r.getClearAlpha();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.setRenderTarget(prev);
    r.setClearColor(cc, ca);
  }

  // A trench or crater from a to b (world xz). radius in metres,
  // dig/lip in 0..1, lipWidth relative to radius.
  stamp(ax, az, bx, bz, radius, dig, lip = 0.6, lipWidth = 0.7) {
    if (this.pending.length >= MAX_STAMPS) return;
    this.pending.push([ax, az, bx, bz, radius, dig, lip, lipWidth]);
  }

  _clearRect(x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    this.rt.scissor.set(x, y, w, h);
    this.rt.scissorTest = true;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear(true, false, false);
    this.rt.scissorTest = false;
  }

  // clear texture columns [a, b) (world texel indices) along one axis
  _clearBand(a, b, axis) {
    const N = TRAIL_RES;
    if (b - a >= N) { a = 0; b = N; }
    let s = ((a % N) + N) % N;
    let len = b - a;
    while (len > 0) {
      const run = Math.min(len, N - s);
      if (axis === 0) this._clearRect(s, 0, run, N);
      else this._clearRect(0, s, N, run);
      len -= run;
      s = 0;
    }
  }

  update(px, pz) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const cc = r.getClearColor(new THREE.Color());
    const ca = r.getClearAlpha();
    r.setClearColor(0x000000, 0);

    // forget snow that scrolled out of the window on the far side
    const ncx = Math.floor(px / TEXEL), ncz = Math.floor(pz / TEXEL);
    const H = TRAIL_RES / 2;
    if (this.cx === null) { this.cx = ncx; this.cz = ncz; }
    if (ncx > this.cx) this._clearBand(this.cx + H, ncx + H, 0);
    else if (ncx < this.cx) this._clearBand(ncx - H, this.cx - H, 0);
    if (ncz > this.cz) this._clearBand(this.cz + H, ncz + H, 1);
    else if (ncz < this.cz) this._clearBand(ncz - H, this.cz - H, 1);
    this.cx = ncx; this.cz = ncz;
    this.center.set(px, pz);

    if (this.pending.length) {
      const S = TRAIL_SIZE;
      let n = 0;
      const A = this.aA.array, B = this.aB.array, P = this.aP.array;
      for (const s of this.pending) {
        const ax = ((s[0] % S) + S) % S, az = ((s[1] % S) + S) % S;
        const bx = ax + (s[2] - s[0]), bz = az + (s[3] - s[1]);
        for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) {
          A[n * 2] = ax - ox * S; A[n * 2 + 1] = az - oy * S;
          B[n * 2] = bx - ox * S; B[n * 2 + 1] = bz - oy * S;
          P[n * 4] = s[4]; P[n * 4 + 1] = s[5]; P[n * 4 + 2] = s[6]; P[n * 4 + 3] = s[7];
          n++;
        }
      }
      this.aA.needsUpdate = this.aB.needsUpdate = this.aP.needsUpdate = true;
      this.quad.instanceCount = n;
      r.setRenderTarget(this.rt);
      const ac = r.autoClear;
      r.autoClear = false;
      r.render(this.scene, this.camera);
      r.autoClear = ac;
      this.pending.length = 0;
    }
    r.setRenderTarget(prev);
    r.setClearColor(cc, ca);
  }
}
