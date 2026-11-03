// Deformable snow. A world-aligned height field (RGBA8 render target) follows
// the rider; every frame the previous field is shifted by whole texels and
// new ski/body stamps are carved into it. R = trench depth, G = berm height,
// B = compaction. The terrain shader displaces vertices and bends normals.
import * as THREE from '../vendor/three.module.js';

const MAX_STAMPS = 12;

export class SnowTrail {
  constructor(renderer, { size = 128, res = 1024 } = {}) {
    this.renderer = renderer;
    this.size = size;
    this.res = res;
    this.texel = size / res;
    this.depthScale = 0.75;   // metres for R = 1
    this.bermScale = 0.32;    // metres for G = 1
    const opts = {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    };
    this.rtA = new THREE.WebGLRenderTarget(res, res, opts);
    this.rtB = new THREE.WebGLRenderTarget(res, res, opts);
    this.cx = 0; this.cz = 0;
    this.params = { value: new THREE.Vector4(0, 0, size, res) };
    this.stamps = [];
    this.first = true;

    const a = []; const b = [];
    for (let i = 0; i < MAX_STAMPS; i++) { a.push(new THREE.Vector4()); b.push(new THREE.Vector4()); }
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uPrev: { value: null },
        uShift: { value: new THREE.Vector2() },
        uTexel: { value: this.texel },
        uRes: { value: res },
        uA: { value: a },
        uB: { value: b },
        uCount: { value: 0 },
        uClear: { value: 1 },
      },
      vertexShader: /* glsl */`
        void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D uPrev;
        uniform vec2 uShift;
        uniform float uTexel;
        uniform float uRes;
        uniform vec4 uA[${MAX_STAMPS}];
        uniform vec4 uB[${MAX_STAMPS}];
        uniform int uCount;
        uniform float uClear;
        void main() {
          ivec2 p = ivec2(gl_FragCoord.xy);
          ivec2 q = p + ivec2(uShift);
          int R = int(uRes);
          vec4 old = vec4(0.0);
          if (uClear < 0.5 && q.x >= 0 && q.y >= 0 && q.x < R && q.y < R) old = texelFetch(uPrev, q, 0);
          vec2 wp = (vec2(p) + 0.5 - uRes * 0.5) * uTexel;
          float depth = old.r, berm = old.g, comp = old.b;
          for (int i = 0; i < ${MAX_STAMPS}; i++) {
            if (i >= uCount) break;
            vec4 A = uA[i];
            vec4 B = uB[i];
            vec2 pa = wp - A.xy, ba = A.zw - A.xy;
            float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
            float d = length(pa - ba * h);
            float r = B.x;
            // soft-walled trench with a flat floor
            float tr = 1.0 - smoothstep(r * 0.45, r, d);
            depth = max(depth, tr * B.y);
            comp = max(comp, (1.0 - smoothstep(r * 0.7, r * 1.02, d)) * B.w);
            // pushed-out snow forms a lumpy berm on both sides
            float bm = smoothstep(r * 0.8, r * 1.1, d) * (1.0 - smoothstep(r * 1.1, r * 2.0, d));
            float lump = 0.65 + 0.35 * fract(sin(dot(floor((wp + 400.0) * 3.0), vec2(12.9898, 78.233))) * 43758.5453);
            berm = max(berm, bm * B.z * lump);
          }
          gl_FragColor = vec4(depth, berm, comp, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.scene = new THREE.Scene();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const tri = new THREE.Mesh(geo, this.mat);
    tri.frustumCulled = false;
    this.scene.add(tri);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  get texture() { return this.rtA.texture; }

  /**
   * Carve a capsule from (ax,az) to (bx,bz).
   * depth / berm in metres, comp 0..1 (how packed the snow becomes).
   */
  stamp(ax, az, bx, bz, radius, depth, berm, comp = 1) {
    if (this.stamps.length >= MAX_STAMPS) return;
    this.stamps.push([ax, az, bx, bz, radius, depth, berm, comp]);
  }

  reset() { this.first = true; }

  update(focusX, focusZ) {
    const t = this.texel;
    const ncx = Math.round(focusX / t) * t;
    const ncz = Math.round(focusZ / t) * t;
    const sx = Math.round((ncx - this.cx) / t);
    const sz = Math.round((ncz - this.cz) / t);
    if (!this.first && sx === 0 && sz === 0 && this.stamps.length === 0) return;
    const u = this.mat.uniforms;
    u.uPrev.value = this.rtA.texture;
    u.uShift.value.set(sx, sz);
    u.uClear.value = this.first || Math.abs(sx) >= this.res || Math.abs(sz) >= this.res ? 1 : 0;
    this.cx = ncx; this.cz = ncz;
    const n = Math.min(this.stamps.length, MAX_STAMPS);
    for (let i = 0; i < n; i++) {
      const s = this.stamps[i];
      u.uA.value[i].set(s[0] - ncx, s[1] - ncz, s[2] - ncx, s[3] - ncz);
      u.uB.value[i].set(s[4], Math.min(1, s[5] / this.depthScale), Math.min(1, s[6] / this.bermScale), s[7]);
    }
    u.uCount.value = n;
    this.stamps.length = 0;
    this.first = false;

    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.rtB);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
    const tmp = this.rtA; this.rtA = this.rtB; this.rtB = tmp;
    this.params.value.set(this.cx, this.cz, this.size, this.res);
    if (this.onSwap) this.onSwap(this.rtA.texture);
  }
}
