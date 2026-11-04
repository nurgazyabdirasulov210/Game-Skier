// Streams terrain chunks around the rider with distance-based detail and
// provides the snow material (trench displacement, normal bending, glints).
import * as THREE from 'three';
import { buildChunkData } from './chunkData.js';
import { TRAIL_SIZE, TRAIL_DIG, TRAIL_LIP, TRAIL_RES } from './trail.js';

export const CHUNK = 64;
// [max distance to chunk, segments per side]
const LODS = [
  [34, 256],   // 0.25 m: deep trenches
  [100, 128],  // 0.5 m
  [200, 64],   // 1 m
  [340, 32],   // 2 m
  [560, 16],   // 4 m
];
export const VIEW_RADIUS = LODS[LODS.length - 1][0];

export function makeSnowMaterial(trail) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  const uniforms = {
    uTrail: { value: trail.texture },
    uTrailSize: { value: TRAIL_SIZE },
    uCenter: { value: trail.center },
    uDig: { value: TRAIL_DIG },
    uLip: { value: TRAIL_LIP },
    uSunView: { value: new THREE.Vector3(0, 1, 0) },
    uSparkle: { value: 1 },
    uTrenchTint: { value: new THREE.Color('#c7d4ff') },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uTrail; uniform float uTrailSize; uniform vec2 uCenter;
        uniform float uDig; uniform float uLip;
        varying vec2 vTW; varying float vTMask;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec2 wp = (modelMatrix * vec4(transformed, 1.0)).xz;
          vTW = wp;
          vec2 dd = abs(wp - uCenter);
          vTMask = 1.0 - smoothstep(uTrailSize * 0.40, uTrailSize * 0.47, max(dd.x, dd.y));
          vec4 ts = textureLod(uTrail, wp / uTrailSize, 0.0);
          transformed.y += (ts.g * uLip * (1.0 - ts.r) - ts.r * uDig) * vTMask;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uTrail; uniform float uTrailSize; uniform float uDig; uniform float uLip;
        uniform vec3 uSunView; uniform float uSparkle; uniform vec3 uTrenchTint;
        varying vec2 vTW; varying float vTMask;
        float trailH(vec2 uv) { vec4 t = texture2D(uTrail, uv); return t.g * uLip * (1.0 - t.r) - t.r * uDig; }
        float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash12(i), hash12(i + vec2(1,0)), f.x), mix(hash12(i + vec2(0,1)), hash12(i + vec2(1,1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 tuv = vTW / uTrailSize;
        vec4 tS = texture2D(uTrail, tuv) * vTMask;
        diffuseColor.rgb *= mix(vec3(1.0), uTrenchTint, smoothstep(0.05, 0.9, tS.r));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float e = 1.0 / ${TRAIL_RES.toFixed(1)};
          float m = uTrailSize * e * 2.0;
          float hx = (trailH(tuv + vec2(e, 0.0)) - trailH(tuv - vec2(e, 0.0))) / m;
          float hz = (trailH(tuv + vec2(0.0, e)) - trailH(tuv - vec2(0.0, e))) / m;
          // wind-packed surface ripples, fading with distance
          float dist = length(vViewPosition);
          float rip = (1.0 - smoothstep(10.0, 60.0, dist)) * 0.06;
          vec2 rp = vTW * vec2(0.9, 2.2);
          float r0 = vnoise(rp), r1 = vnoise(rp + vec2(0.37, 0.0)), r2 = vnoise(rp + vec2(0.0, 0.37));
          hx += (r1 - r0) * rip * 6.0; hz += (r2 - r0) * rip * 2.5;
          vec3 pert = (viewMatrix * vec4(-hx, 0.0, -hz, 0.0)).xyz * vTMask;
          normal = normalize(normal + clamp(pert, -2.5, 2.5));
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // sun glints in the snow
          vec2 g = floor(vTW * 22.0);
          float h = hash12(g + floor(dot(normalize(vViewPosition), vec3(3.0, 5.0, 7.0)) * 6.0));
          float lit = max(dot(normal, uSunView), 0.0);
          float near = 1.0 - smoothstep(6.0, 40.0, length(vViewPosition));
          totalEmissiveRadiance += vec3(1.0) * step(0.9975, h) * lit * near * 1.6 * uSparkle * (1.0 - tS.r);
        }`);
  };
  mat.customProgramCacheKey = () => 'snow-v1';
  return mat;
}

export class Terrain {
  constructor(scene, material) {
    this.scene = scene;
    this.material = material;
    this.chunks = new Map();
    this.indexCache = new Map();
    this.jobs = new Map();
    this.nextId = 1;
    this.queue = [];
    this.workers = [];
    this.busy = [];
    this.onChunkReady = null;
    const nw = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    try {
      for (let i = 0; i < nw; i++) {
        const w = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e) => this._onResult(i, e.data);
        w.onerror = () => { this.workers = []; };
        this.workers.push(w);
        this.busy.push(false);
      }
    } catch (err) {
      this.workers = [];
    }
  }

  _index(seg) {
    let idx = this.indexCache.get(seg);
    if (idx) return idx;
    const V = seg + 3;
    const arr = new Uint32Array((V - 1) * (V - 1) * 6);
    let k = 0;
    for (let j = 0; j < V - 1; j++) {
      for (let i = 0; i < V - 1; i++) {
        const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
        if ((i + j) & 1) { arr[k++] = a; arr[k++] = c; arr[k++] = b; arr[k++] = b; arr[k++] = c; arr[k++] = d; }
        else { arr[k++] = a; arr[k++] = c; arr[k++] = d; arr[k++] = a; arr[k++] = d; arr[k++] = b; }
      }
    }
    idx = new THREE.BufferAttribute(arr, 1);
    this.indexCache.set(seg, idx);
    return idx;
  }

  static lodFor(dist) {
    for (let i = 0; i < LODS.length; i++) if (dist <= LODS[i][0]) return i;
    return -1;
  }

  _apply(key, lod, data) {
    const ch = this.chunks.get(key);
    if (!ch || ch.wantLod !== lod) return;
    const seg = LODS[lod][1];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    g.setIndex(this._index(seg));
    const x0 = ch.cx * CHUNK, z0 = ch.cz * CHUNK;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, data.minY - 1, z0), new THREE.Vector3(x0 + CHUNK, data.maxY + 1, z0 + CHUNK));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    if (!ch.mesh) {
      ch.mesh = new THREE.Mesh(g, this.material);
      ch.mesh.receiveShadow = true;
      ch.mesh.matrixAutoUpdate = false;
      this.scene.add(ch.mesh);
    } else {
      ch.mesh.geometry.dispose();
      ch.mesh.geometry = g;
    }
    ch.mesh.castShadow = lod <= 1;
    ch.lod = lod;
    ch.pending = false;
  }

  _onResult(wi, msg) {
    this.busy[wi] = false;
    const job = this.jobs.get(msg.id);
    this.jobs.delete(msg.id);
    if (job) this._apply(job.key, job.lod, msg);
    this._pump();
  }

  _pump() {
    for (let i = 0; i < this.workers.length && this.queue.length; i++) {
      if (this.busy[i]) continue;
      const job = this.queue.shift();
      const ch = this.chunks.get(job.key);
      if (!ch || ch.wantLod !== job.lod) { i--; continue; }
      job.id = this.nextId++;
      this.jobs.set(job.id, job);
      this.busy[i] = true;
      this.workers[i].postMessage({ id: job.id, x0: ch.cx * CHUNK, z0: ch.cz * CHUNK, size: CHUNK, seg: LODS[job.lod][1] });
    }
  }

  // synchronous build (fallback and initial load)
  _buildNow(job) {
    const ch = this.chunks.get(job.key);
    if (!ch) return;
    const data = buildChunkData(ch.cx * CHUNK, ch.cz * CHUNK, CHUNK, LODS[job.lod][1]);
    this._apply(job.key, job.lod, data);
  }

  update(px, pz, sync = false) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    const R = Math.ceil(VIEW_RADIUS / CHUNK) + 1;
    const want = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const x0 = cx * CHUNK, z0 = cz * CHUNK;
        const qx = Math.max(x0 - px, 0, px - (x0 + CHUNK));
        const qz = Math.max(z0 - pz, 0, pz - (z0 + CHUNK));
        const dist = Math.hypot(qx, qz);
        const lod = Terrain.lodFor(dist);
        if (lod < 0) continue;
        const key = cx + ',' + cz;
        let ch = this.chunks.get(key);
        if (!ch) {
          ch = { cx, cz, key, lod: -1, wantLod: -1, mesh: null, pending: false, dist };
          this.chunks.set(key, ch);
        }
        ch.dist = dist;
        ch.seen = true;
        if (ch.wantLod !== lod) {
          ch.wantLod = lod;
          if (ch.lod !== lod) want.push({ key, lod, dist });
        }
      }
    }
    // drop chunks that left the view
    for (const [key, ch] of this.chunks) {
      if (!ch.seen) {
        if (ch.mesh) { this.scene.remove(ch.mesh); ch.mesh.geometry.dispose(); }
        this.chunks.delete(key);
        if (this.onChunkRemoved) this.onChunkRemoved(ch);
      } else ch.seen = false;
    }
    if (want.length) {
      // re-prioritise: nearest and most detailed first
      this.queue = this.queue.filter((j) => {
        const ch = this.chunks.get(j.key);
        return ch && ch.wantLod === j.lod;
      });
      for (const w of want) this.queue.push(w);
      this.queue.sort((a, b) => a.dist - b.dist);
    }
    if (sync || !this.workers.length) {
      const t0 = performance.now();
      while (this.queue.length && (sync || performance.now() - t0 < 6)) this._buildNow(this.queue.shift());
    } else {
      this._pump();
    }
  }

  pendingCount() { return this.queue.length + this.jobs.size; }
}
