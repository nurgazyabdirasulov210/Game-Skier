// Open world streaming: terrain chunks with distance LODs built in workers,
// instanced forests/props, colliders and collectibles around the rider.
import * as THREE from '../vendor/three.module.js';
import { CHUNK, OBJ, OBJ_STRIDE, setWorldSeed, chunkObjects } from './terrain.js';
import { buildChunk } from './terrainWorker.js';
import { makeTerrainMaterial, makeTreeMaterial, makeToonMaterial, makeCrystalMaterial } from './materials.js';
import * as P from './props.js';

const key = (cx, cz) => cx + ',' + cz;

const FLAG_COLORS = ['#e8433a', '#f2b33d', '#2fa58f', '#3c6fd8', '#f4f4f4', '#d0457a'];
const GATE_SETS = [[0, 1, 2, 3], [0, 4, 3, 4], [1, 5, 2, 4], [2, 1, 0, 5]];

export class World {
  constructor(scene, trail, quality, seed) {
    this.scene = scene;
    this.q = quality;
    this.seed = seed;
    setWorldSeed(seed);
    this.chunks = new Map();
    this.pending = new Map();      // key -> request
    this.inflight = new Map();     // id -> request
    this.reqId = 1;
    this.indexCache = new Map();
    this.terrainMat = makeTerrainMaterial(trail);
    trail.onSwap = (tex) => { this.terrainMat.uniforms.uTrail.value = tex; };
    this.terrainGroup = new THREE.Group();
    scene.add(this.terrainGroup);
    this.gatesDone = new Set();
    this.crystalsDone = new Set();
    this.objDirty = true;
    this.lastRebuild = new THREE.Vector2(1e9, 1e9);
    this.time = 0;
    this._initWorkers();
    this._initPools();
  }

  // ------------------------------------------------------------ workers
  _initWorkers() {
    this.workers = [];
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
        w.busy = 0;
        w.onmessage = (ev) => { w.busy--; this._onResult(ev.data); };
        w.onerror = (e) => { console.warn('terrain worker failed, falling back', e); this.workers = []; };
        w.postMessage({ type: 'seed', seed: this.seed });
        this.workers.push(w);
      }
    } catch (e) {
      console.warn('module workers unavailable, building on main thread', e);
      this.workers = [];
    }
  }

  _dispatch() {
    if (this.pending.size === 0) return;
    const reqs = [...this.pending.values()].sort((a, b) => a.pri - b.pri);
    if (this.workers.length) {
      for (const r of reqs) {
        const w = this.workers.reduce((a, b) => (a.busy <= b.busy ? a : b));
        if (w.busy >= 2) break;
        w.busy++;
        this.pending.delete(r.key);
        this.inflight.set(r.id, r);
        w.postMessage({ type: r.type, id: r.id, cx: r.cx, cz: r.cz, segs: r.segs });
      }
    } else {
      // main-thread fallback with a small time budget
      const t0 = performance.now();
      for (const r of reqs) {
        this.pending.delete(r.key);
        this.inflight.set(r.id, r);
        if (r.type === 'chunk') this._onResult({ type: 'chunk', id: r.id, cx: r.cx, cz: r.cz, segs: r.segs, ...buildChunk(r.cx, r.cz, r.segs) });
        else this._onResult({ type: 'objects', id: r.id, cx: r.cx, cz: r.cz, objs: chunkObjects(r.cx, r.cz) });
        if (performance.now() - t0 > 6) break;
      }
    }
  }

  _request(type, cx, cz, segs, pri) {
    const k = type + ':' + key(cx, cz);
    const ex = this.pending.get(k);
    if (ex) { ex.pri = pri; ex.segs = segs; return; }
    this.pending.set(k, { key: k, type, cx, cz, segs, pri, id: this.reqId++ });
  }

  _onResult(m) {
    const req = this.inflight.get(m.id);
    this.inflight.delete(m.id);
    const ch = this.chunks.get(key(m.cx, m.cz));
    if (!ch) return;
    if (m.type === 'chunk') {
      if (ch.requested === m.segs) ch.requested = 0;
      if (m.segs !== ch.wantSegs && ch.mesh) return; // stale LOD, a newer request is coming
      this._setChunkMesh(ch, m);
    } else if (m.type === 'objects') {
      ch.objRequested = false;
      this._setChunkObjects(ch, m.objs);
    }
  }

  // ------------------------------------------------------------ terrain meshes
  _index(segs) {
    if (this.indexCache.has(segs)) return this.indexCache.get(segs);
    const N = segs + 1;
    const idx = [];
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const S = N * N;
    for (let e = 0; e < 4; e++) {
      for (let k = 0; k < N - 1; k++) {
        const edge = [(q) => q, (q) => (N - 1) * N + q, (q) => q * N, (q) => q * N + (N - 1)][e];
        const a = edge(k), b = edge(k + 1);
        const sa = S + e * N + k, sb = sa + 1;
        if (e === 0) idx.push(a, b, sa, b, sb, sa);
        else if (e === 1) idx.push(a, sa, b, b, sa, sb);
        else if (e === 2) idx.push(a, sa, b, b, sa, sb);
        else idx.push(a, b, sa, b, sb, sa);
      }
    }
    const attr = new THREE.BufferAttribute(S + 4 * N > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1);
    this.indexCache.set(segs, attr);
    return attr;
  }

  _setChunkMesh(ch, m) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 4, true));
    geo.setAttribute('aData', new THREE.BufferAttribute(m.dat, 4, true));
    geo.setIndex(this._index(m.segs));
    const cy = (m.ymin + m.ymax) / 2;
    const r = Math.hypot(CHUNK / 2, CHUNK / 2, (m.ymax - m.ymin) / 2) + 2;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(CHUNK / 2, cy, CHUNK / 2), r);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(0, m.ymin, 0), new THREE.Vector3(CHUNK, m.ymax, CHUNK));
    const mesh = new THREE.Mesh(geo, this.terrainMat);
    mesh.position.set(ch.cx * CHUNK, 0, ch.cz * CHUNK);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.receiveShadow = true;
    mesh.castShadow = m.segs >= 128 || (m.segs >= 64 && this.q.lod[0][1] < 128);
    if (ch.mesh) {
      this.terrainGroup.remove(ch.mesh);
      ch.mesh.geometry.dispose();
    }
    ch.mesh = mesh;
    ch.segs = m.segs;
    this.terrainGroup.add(mesh);
  }

  segsFor(d) {
    const l = this.q.lod; // array of [maxDist, segs]
    for (const [maxD, segs] of l) if (d <= maxD) return segs;
    return 0;
  }

  // ------------------------------------------------------------ objects
  _setChunkObjects(ch, objs) {
    ch.objs = objs;
    const col = [], logs = [], gates = [], crystals = [], cabins = [], towers = [];
    for (let i = 0; i < objs.length; i += OBJ_STRIDE) {
      const t = objs[i], x = objs[i + 1], y = objs[i + 2], z = objs[i + 3], rot = objs[i + 4], s = objs[i + 5];
      switch (t) {
        case OBJ.FIR: case OBJ.LARCH: case OBJ.SNAG:
          col.push({ x, z, y, r: 0.32 * s + 0.12, h: 9 * s, kind: 'tree' });
          break;
        case OBJ.GHOST:
          col.push({ x, z, y, r: 0.9 * s + 0.2, h: 7 * s, kind: 'tree' });
          break;
        case OBJ.ROCK:
          col.push({ x, z, y: y + s * 0.35, r: s * 0.9, h: s * (objs[i + 7] * 0.75 - 0.35) + 0.05, kind: 'rock' });
          break;
        case OBJ.STUMP:
          col.push({ x, z, y: y + 0.15, r: 0.38 * s, h: 0.75 * s, kind: 'rock' });
          break;
        case OBJ.CABIN:
          col.push({ x, z, y, r: 4.3, h: 6, kind: 'cabin' });
          cabins.push({ x, y, z, rot });
          break;
        case OBJ.TOWER:
          col.push({ x, z, y, r: 0.55, h: 11, kind: 'tree' });
          towers.push({ x, y, z, x2: objs[i + 6], y2: objs[i + 7], z2: objs[i + 8], j: objs[i + 9] });
          break;
        case OBJ.LOG:
          logs.push({ ax: x, ay: y, az: z, bx: objs[i + 6], by: objs[i + 7], bz: objs[i + 8], r: s, len: objs[i + 9], rot });
          break;
        case OBJ.GATE:
          gates.push({ id: objs[i + 6], x, y, z, a: rot, w: s, y1: objs[i + 7], y2: objs[i + 8], set: objs[i + 9] | 0 });
          break;
        case OBJ.CRYSTAL:
          crystals.push({ id: objs[i + 6], x, y, z });
          break;
      }
    }
    ch.colliders = col; ch.logs = logs; ch.gates = gates; ch.crystals = crystals; ch.cabins = cabins; ch.towers = towers;
    this.objDirty = true;
  }

  _initPools() {
    const q = this.q;
    const pools = this.pools = {};
    const mk = (name, geo, mat, cap, cast) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = !!cast;
      m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m);
      pools[name] = m;
      return m;
    };
    const firMat = makeTreeMaterial({ needle: '#1d4a45', needle2: '#2b5d4a', snow: 0.75, trans: 0.25 });
    const larchMat = makeTreeMaterial({ needle: '#c98a2b', needle2: '#e6b54a', snow: 0.45, trans: 0.8 });
    const ghostMat = makeTreeMaterial({ needle: '#e9eefc', needle2: '#dfe6fb', snow: 1, trans: 0.2, windAmp: 0.3 });
    const snagMat = makeTreeMaterial({ needle: '#7e7a77', bark: '#9a948e', snow: 0.4, trans: 0 });
    const capHi = q.treeHiCap, capMid = q.treeMidCap, capFar = q.treeFarCap;
    mk('firHi', P.makeConifer({ seed: 3 }), firMat, capHi, true);
    mk('firMid', P.makeConiferLow({}), firMat, capMid, q.midShadows);
    mk('firFar', P.makeConiferFar({}), firMat, capFar, false);
    mk('larchHi', P.makeConifer({ seed: 8, tiers: 7, segs: 10, droop: 0.7, spike: 0.45, narrow: 0.72, height: 10 }), larchMat, capHi, true);
    mk('larchMid', P.makeConiferLow({ narrow: 0.72, height: 10 }), larchMat, capMid, q.midShadows);
    mk('larchFar', P.makeConiferFar({ narrow: 0.72, height: 10 }), larchMat, capFar, false);
    mk('ghostHi', P.makeGhost({ seed: 4, detail: 1 }), ghostMat, capHi, true);
    mk('ghostMid', P.makeGhost({ seed: 4, detail: 0 }), ghostMat, capMid, q.midShadows);
    mk('ghostFar', P.makeConiferFar({ height: 7.5, radius: 2.4 }), ghostMat, capFar, false);
    mk('snag', P.makeSnag({}), snagMat, Math.floor(capMid / 6), true);

    const rockMat = makeToonMaterial({ color: '#4b4f60', snowTop: 1, flat: true, rim: 0.2 });
    mk('rock', P.makeRock(7, 1), rockMat, 3000, true);
    const barkMat = makeToonMaterial({ color: '#5d3f2c', snowTop: 1, rim: 0.2 });
    mk('log', P.makeLog(), barkMat, 600, true);
    mk('stump', P.makeStump(), barkMat, 1500, true);
    const propMat = makeToonMaterial({ vertexColors: true, rim: 0.25 });
    mk('cabin', P.makeCabin(), propMat, 64, true);
    mk('tower', P.makeTower(), propMat, 128, true);
    mk('chair', P.makeChair(), propMat, 1500, true);
    const cableMat = makeToonMaterial({ color: '#1b1d24', rim: 0.1 });
    mk('cable', P.makeCable(), cableMat, 4000, false);
    mk('gatePole', P.makeGatePole(), propMat, 400, true);
    const flagMat = makeToonMaterial({ rim: 0.3 });
    flagMat.side = THREE.DoubleSide;
    const flags = mk('flag', P.makeFlag(), flagMat, 4000, true);
    flags.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(4000 * 3), 3);
    flags.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mk('rope', P.makeCable(), cableMat, 4000, false);
    mk('crystal', P.makeCrystal(), makeCrystalMaterial(), 400, false);
    this.flagColors = FLAG_COLORS.map((c) => new THREE.Color(c));
    this.gold = new THREE.Color('#ffe9a8').multiplyScalar(1.6);
  }

  // ------------------------------------------------------------ streaming
  update(px, pz, dt, force = false) {
    this.time += dt;
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    const R = this.q.viewChunks;
    const OR = this.q.objChunks;
    const fx = px / CHUNK - 0.5, fz = pz / CHUNK - 0.5;

    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const d = Math.max(Math.abs(dx), Math.abs(dz));
        const segs = this.segsFor(d);
        if (!segs) continue;
        const k = key(cx, cz);
        let ch = this.chunks.get(k);
        if (!ch) {
          ch = { cx, cz, mesh: null, segs: 0, wantSegs: segs, requested: 0, objs: null, objRequested: false, colliders: [], logs: [], gates: [], crystals: [], cabins: [], towers: [] };
          this.chunks.set(k, ch);
        }
        const pri = Math.hypot(cx - fx, cz - fz);
        if (ch.segs !== segs) {
          ch.wantSegs = segs;
          if (ch.requested !== segs) {
            ch.requested = segs;
            this._request('chunk', cx, cz, segs, pri + (ch.mesh ? 0.5 : 0));
          }
        }
        if (d <= OR && !ch.objs && !ch.objRequested) {
          ch.objRequested = true;
          this._request('objects', cx, cz, 0, pri + 0.25);
        }
      }
    }
    // unload far chunks
    for (const [k, ch] of this.chunks) {
      const d = Math.max(Math.abs(ch.cx - pcx), Math.abs(ch.cz - pcz));
      if (d > R + 1) {
        if (ch.mesh) { this.terrainGroup.remove(ch.mesh); ch.mesh.geometry.dispose(); }
        this.chunks.delete(k);
        this.pending.delete('chunk:' + k);
        this.pending.delete('objects:' + k);
        if (ch.objs) this.objDirty = true;
      } else if (d > OR + 1 && ch.objs) {
        ch.objs = null; ch.colliders = []; ch.logs = []; ch.gates = []; ch.crystals = []; ch.cabins = []; ch.towers = [];
        this.objDirty = true;
      }
    }
    this._dispatch();

    const moved = Math.hypot(px - this.lastRebuild.x, pz - this.lastRebuild.y);
    if (this.objDirty || moved > 14 || force) {
      this._rebuildInstances(px, pz);
      this.lastRebuild.set(px, pz);
      this.objDirty = false;
    }
    this._animateChairs(px, pz);
  }

  /** Fraction of the near ring that is ready (for the loading screen). */
  readiness(px, pz, ring = 2) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    let total = 0, ok = 0;
    for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) {
      total += 2;
      const ch = this.chunks.get(key(pcx + dx, pcz + dz));
      if (ch && ch.mesh) ok++;
      if (ch && ch.objs) ok++;
    }
    return ok / total;
  }

  // ------------------------------------------------------------ instancing
  _rebuildInstances(px, pz) {
    const p = this.pools;
    for (const k in p) p[k].count = 0;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), e = new THREE.Euler();
    const hi2 = this.q.treeHi ** 2, mid2 = this.q.treeMid ** 2;
    const put = (pool, x, y, z, ry, sx, sy = sx, sz = sx, rx = 0, rz = 0) => {
      if (pool.count >= pool.instanceMatrix.count) return -1;
      e.set(rx, ry, rz);
      q.setFromEuler(e);
      v.set(x, y, z); s.set(sx, sy, sz);
      m.compose(v, q, s);
      pool.setMatrixAt(pool.count, m);
      return pool.count++;
    };
    this.cabinList = [];
    this.towerList = [];
    for (const ch of this.chunks.values()) {
      const o = ch.objs;
      if (!o) continue;
      for (let i = 0; i < o.length; i += OBJ_STRIDE) {
        const t = o[i], x = o[i + 1], y = o[i + 2], z = o[i + 3], rot = o[i + 4], sc = o[i + 5], r0 = o[i + 6];
        const d2 = (x - px) ** 2 + (z - pz) ** 2;
        const lod = d2 < hi2 ? 'Hi' : d2 < mid2 ? 'Mid' : 'Far';
        const tilt = (r0 - 0.5) * 0.08;
        switch (t) {
          case OBJ.FIR: put(p['fir' + lod], x, y - 0.4, z, rot, sc, sc, sc, tilt, -tilt); break;
          case OBJ.LARCH: put(p['larch' + lod], x, y - 0.4, z, rot, sc, sc, sc, tilt, tilt); break;
          case OBJ.GHOST: put(p['ghost' + lod], x, y - 0.5, z, rot, sc, sc * (0.9 + r0 * 0.3), sc, tilt * 2, 0); break;
          case OBJ.SNAG: if (lod !== 'Far') put(p.snag, x, y - 0.3, z, rot, sc, sc, sc, tilt * 2, tilt); break;
          case OBJ.ROCK: put(p.rock, x, y, z, rot, sc, sc * o[i + 7], sc * (0.8 + r0 * 0.4)); break;
          case OBJ.STUMP: if (lod !== 'Far') put(p.stump, x, y, z, rot, sc); break;
          case OBJ.LOG: {
            if (lod === 'Far') break;
            const bx = o[i + 6], by = o[i + 7], bz = o[i + 8], len = o[i + 9];
            const dx = bx - x, dy = by - y, dz = bz - z;
            v.set(dx, dy, dz).normalize();
            q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), v);
            m.compose(new THREE.Vector3((x + bx) / 2, (y + by) / 2, (z + bz) / 2), q, new THREE.Vector3(len + 0.4, sc, sc));
            if (p.log.count < p.log.instanceMatrix.count) p.log.setMatrixAt(p.log.count++, m);
            break;
          }
          case OBJ.CABIN: put(p.cabin, x, y, z, -rot + Math.PI, 1); this.cabinList.push({ x, y, z, rot }); break;
          case OBJ.TOWER: {
            const x2 = o[i + 6], y2 = o[i + 7], z2 = o[i + 8];
            const ang = Math.atan2(x2 - x, z2 - z);
            put(p.tower, x, y, z, ang, 1);
            this._cables(x, y, z, x2, y2, z2, ang);
            break;
          }
          case OBJ.GATE: this._gate(ch, o, i); break;
          case OBJ.CRYSTAL: {
            if (this.crystalsDone.has(r0)) break;
            put(p.crystal, x, y, z, rot, 1);
            break;
          }
        }
      }
    }
    for (const k in p) {
      p[k].instanceMatrix.needsUpdate = true;
      if (p[k].instanceColor) p[k].instanceColor.needsUpdate = true;
    }
  }

  _cables(x, y, z, x2, y2, z2, ang) {
    const p = this.pools;
    const lx = Math.cos(ang), lz = -Math.sin(ang); // lateral (horizontal, perpendicular to span)
    const H = 10.55;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
    for (const side of [-1, 1]) {
      const ox = lx * 2.1 * side, oz = lz * 2.1 * side;
      const seg = 5, sag = 1.4;
      const pt = (t, out) => out.set(x + ox + (x2 - x) * t, y + H + (y2 - y) * t - sag * 4 * t * (1 - t), z + oz + (z2 - z) * t);
      for (let k = 0; k < seg; k++) {
        pt(k / seg, a); pt((k + 1) / seg, b);
        d.subVectors(b, a);
        const len = d.length();
        q.setFromUnitVectors(up, d.normalize());
        m.compose(a, q, new THREE.Vector3(1, len, 1));
        if (p.cable.count < p.cable.instanceMatrix.count) p.cable.setMatrixAt(p.cable.count++, m);
      }
      this.towerList.push({ side, x, y, z, x2, y2, z2, ox, oz, ang, H, sag });
    }
  }

  _animateChairs(px, pz) {
    const pool = this.pools.chair;
    if (!this.towerList) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    let n = 0;
    const per = 4;
    for (const s of this.towerList) {
      if (Math.abs(s.x - px) > 320 || Math.abs(s.z - pz) > 320) continue;
      const span = Math.hypot(s.x2 - s.x, s.y2 - s.y, s.z2 - s.z);
      const speed = 2.2 / span;
      for (let k = 0; k < per; k++) {
        let t = (k / per + this.time * speed * s.side) % 1;
        if (t < 0) t += 1;
        v.set(s.x + s.ox + (s.x2 - s.x) * t, s.y + s.H + (s.y2 - s.y) * t - s.sag * 4 * t * (1 - t), s.z + s.oz + (s.z2 - s.z) * t);
        const sway = Math.sin(this.time * 1.3 + k + s.x) * 0.06;
        e.set(sway, s.ang + (s.side > 0 ? 0 : Math.PI), 0);
        q.setFromEuler(e);
        m.compose(v, q, one);
        if (n < pool.instanceMatrix.count) pool.setMatrixAt(n++, m);
      }
    }
    pool.count = n;
    pool.instanceMatrix.needsUpdate = true;
  }

  _gate(ch, o, i) {
    const p = this.pools;
    const x = o[i + 1], y = o[i + 2], z = o[i + 3], a = o[i + 4], w = o[i + 5], id = o[i + 6];
    const y1 = o[i + 7], y2 = o[i + 8], set = GATE_SETS[(o[i + 9] | 0) % GATE_SETS.length];
    const done = this.gatesDone.has(id);
    const cx = Math.cos(a), cz = Math.sin(a);
    const ax = x + cx * w * 0.5, az = z + cz * w * 0.5;
    const bx = x - cx * w * 0.5, bz = z - cz * w * 0.5;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    m.compose(new THREE.Vector3(ax, y1 - 0.25, az), q.identity(), one);
    if (p.gatePole.count < p.gatePole.instanceMatrix.count) p.gatePole.setMatrixAt(p.gatePole.count++, m);
    m.compose(new THREE.Vector3(bx, y2 - 0.25, bz), q.identity(), one);
    if (p.gatePole.count < p.gatePole.instanceMatrix.count) p.gatePole.setMatrixAt(p.gatePole.count++, m);
    // sagging bunting between pole tops
    const top1 = y1 + 4.3, top2 = y2 + 4.3, sag = 0.8;
    const pt = (t) => new THREE.Vector3(ax + (bx - ax) * t, top1 + (top2 - top1) * t - sag * 4 * t * (1 - t), az + (bz - az) * t);
    const seg = 6;
    for (let k = 0; k < seg; k++) {
      const A = pt(k / seg), B = pt((k + 1) / seg);
      const d = B.clone().sub(A);
      const len = d.length();
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      m.compose(A, q, new THREE.Vector3(0.6, len, 0.6));
      if (p.rope.count < p.rope.instanceMatrix.count) p.rope.setMatrixAt(p.rope.count++, m);
    }
    const nf = Math.max(6, Math.round(w / 0.62));
    for (let k = 1; k < nf; k++) {
      const t = k / nf;
      const P0 = pt(t);
      e.set(Math.sin(this.time + k) * 0.1, -a, 0);
      q.setFromEuler(e);
      m.compose(P0, q, one);
      const fi = p.flag.count;
      if (fi >= p.flag.instanceMatrix.count) break;
      p.flag.setMatrixAt(p.flag.count++, m);
      const c = done ? this.gold : this.flagColors[set[k % set.length]];
      p.flag.instanceColor.setXYZ(fi, c.r, c.g, c.b);
    }
  }

  // ------------------------------------------------------------ queries
  *nearChunks(x, z, ring = 1) {
    const pcx = Math.floor(x / CHUNK), pcz = Math.floor(z / CHUNK);
    for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) {
      const ch = this.chunks.get(key(pcx + dx, pcz + dz));
      if (ch && ch.objs) yield ch;
    }
  }

  markGate(id) { this.gatesDone.add(id); this.objDirty = true; }
  markCrystal(id) { this.crystalsDone.add(id); this.objDirty = true; }

  dispose() {
    for (const w of this.workers) w.terminate();
    for (const ch of this.chunks.values()) if (ch.mesh) { ch.mesh.geometry.dispose(); }
    this.scene.remove(this.terrainGroup);
    for (const k in this.pools) this.scene.remove(this.pools[k]);
  }
}
