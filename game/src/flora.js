// Trees, rocks, logs and stone gates: geometry, materials, placement in
// 128 m sectors around the rider and obstacle lists for collisions.
import * as THREE from 'three';
import { mulberry32, hash2, makeNoise2D, smoothstep, clamp } from './util.js';
import { height, normalAt, forestDensity, forestKind, rockiness } from './world.js';

export const SECTOR = 128;
const FLORA_RADIUS = 330;
const NEAR_FUR = 140;

const fn = makeNoise2D(777);

// ---------- materials ----------
// Flora shares one shader tweak: attribute aMix = (snow, trunk, ao).
function makeMixMaterial({ flat = false, rim = 0, map = null } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, flatShading: flat, map });
  const u = {
    uSnow: { value: new THREE.Color(1, 1, 1) },
    uSnowAmt: { value: 1 },
    uTrunk: { value: new THREE.Color(0.2, 0.2, 0.3) },
    uRim: { value: new THREE.Color(1, 0.8, 0.6) },
    uRimAmt: { value: rim },
    uSunView: { value: new THREE.Vector3(0, 1, 0) },
  };
  mat.userData.uniforms = u;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aMix; varying vec3 vMix;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMix = aMix;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vMix; uniform vec3 uSnow; uniform float uSnowAmt; uniform vec3 uTrunk;
        uniform vec3 uRim; uniform float uRimAmt; uniform vec3 uSunView;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, uTrunk, vMix.y);
        diffuseColor.rgb *= mix(0.72, 1.0, vMix.z);
        diffuseColor.rgb = mix(diffuseColor.rgb, uSnow, clamp(vMix.x * uSnowAmt, 0.0, 1.0));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uRimAmt > 0.0) {
          vec3 toCam = normalize(vViewPosition);
          float rim = pow(1.0 - clamp(dot(normal, toCam), 0.0, 1.0), 2.5);
          float back = 0.35 + 0.65 * clamp(-dot(toCam, uSunView), 0.0, 1.0);
          float top = 0.5 + 0.5 * clamp(dot(normal, uSunView), 0.0, 1.0);
          totalEmissiveRadiance += uRim * rim * back * top * uRimAmt * (1.0 - vMix.y);
        }`);
  };
  mat.customProgramCacheKey = () => 'mix-' + (flat ? 1 : 0) + '-' + (rim > 0 ? 1 : 0) + (map ? 'm' : '');
  return mat;
}

function barkTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 512);
  const r = mulberry32(5);
  for (let i = 0; i < 70; i++) {
    const y = r() * 512, w = 6 + r() * 26, x = r() * 64;
    g.fillStyle = `rgba(20,22,40,${0.55 + r() * 0.4})`;
    g.fillRect(x, y, w, 1.5 + r() * 4);
    if (x + w > 64) g.fillRect(x - 64, y, w, 2);
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(140,140,170,${0.25 * r()})`;
    g.fillRect(r() * 64, r() * 512, 2 + r() * 8, 8 + r() * 30);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- geometry ----------
function setMix(geo, fnMix) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const arr = new Float32Array(p.count * 3);
  const v = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    nn.fromBufferAttribute(n, i);
    const m = fnMix(v, nn, i);
    arr[i * 3] = m[0]; arr[i * 3 + 1] = m[1]; arr[i * 3 + 2] = m[2];
  }
  geo.setAttribute('aMix', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// Furry crown ball: jagged silhouette, but smooth sphere normals so it
// shades like a soft ball of foliage.
function furBall(detail, seed) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const nrm = new Float32Array(p.count * 3);
  const mix = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  const spike = detail >= 3 ? 0.2 : 0.12;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const kx = Math.round(v.x * 1000), ky = Math.round(v.y * 1000), kz = Math.round(v.z * 1000);
    const hsh = hash2(kx * 31 + kz, ky, seed) / 4294967296;
    const lump = fn(v.x * 1.7 + seed, v.z * 1.7 + v.y * 1.3) * 0.14 + fn(v.y * 3.1 - seed, v.x * 2.9 + v.z) * 0.07;
    const r = 1 + lump + (hsh - 0.35) * spike;
    nrm[i * 3] = v.x; nrm[i * 3 + 1] = v.y; nrm[i * 3 + 2] = v.z;
    p.setXYZ(i, v.x * r, v.y * r * 0.92, v.z * r);
    const snow = smoothstep(0.35, 0.85, v.y + lump * 1.2 + (hsh - 0.5) * 0.5) * (hsh > 0.45 ? 1 : 0.35);
    mix[i * 3] = snow;
    mix[i * 3 + 1] = 0;
    mix[i * 3 + 2] = clamp(0.55 + lump * 2.5 + (hsh - 0.35) * 0.9 + v.y * 0.2, 0, 1);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aMix', new THREE.BufferAttribute(mix, 3));
  g.computeBoundingSphere();
  return g;
}

function birchTrunk() {
  const g = new THREE.CylinderGeometry(0.55, 1, 1, 7, 6, true);
  g.translate(0, 0.5, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 3);
  // a gentle kink
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + Math.sin(y * 5.1) * 0.25);
  }
  g.computeVertexNormals();
  return setMix(g, () => [0, 0, 1]);
}

function spruceGeo(seed) {
  const r = mulberry32(seed);
  const pos = [], mix = [];
  const tri = (a, b, c, ma, mb, mc) => { pos.push(...a, ...b, ...c); mix.push(...ma, ...mb, ...mc); };
  // trunk
  const TS = 6;
  for (let i = 0; i < TS; i++) {
    const a0 = (i / TS) * Math.PI * 2, a1 = ((i + 1) / TS) * Math.PI * 2;
    const b0 = [Math.cos(a0) * 0.05, 0, Math.sin(a0) * 0.05], b1 = [Math.cos(a1) * 0.05, 0, Math.sin(a1) * 0.05];
    const t0 = [Math.cos(a0) * 0.012, 0.85, Math.sin(a0) * 0.012], t1 = [Math.cos(a1) * 0.012, 0.85, Math.sin(a1) * 0.012];
    const T = [0, 1, 0.8];
    tri(b0, t0, b1, T, T, T); tri(b1, t0, t1, T, T, T);
  }
  // drooping tiers, unit height tree (scaled per instance)
  const tiers = 7 + Math.floor(r() * 3);
  const base = 0.12 + r() * 0.06;
  const RS = 13;
  for (let k = 0; k < tiers; k++) {
    const f = k / tiers;
    const y0 = base + f * (0.95 - base) * 0.98;
    const rad = (1 - f) * 0.27 + 0.03;
    const top = y0 + (0.95 - base) / tiers * 1.9;
    const apex = [0, Math.min(top, 1.0), 0];
    const ring = [];
    for (let i = 0; i < RS; i++) {
      const a = (i / RS) * Math.PI * 2 + r() * 0.3;
      const rr = rad * (0.7 + r() * 0.45);
      ring.push([Math.cos(a) * rr, y0 - rr * (0.25 + r() * 0.25), Math.sin(a) * rr, r()]);
    }
    for (let i = 0; i < RS; i++) {
      const a = ring[i], b = ring[(i + 1) % RS];
      // upper surface: snow-loaded
      const sa = a[3] > 0.25 ? 0.9 : 0.25, sb = b[3] > 0.25 ? 0.9 : 0.25;
      tri([a[0], a[1], a[2]], [apex[0], apex[1], apex[2]], [b[0], b[1], b[2]],
        [sa * 0.75, 0, 0.75], [0.15, 0, 0.5], [sb * 0.75, 0, 0.75]);
      // underside: dark
      const inner = [a[0] * 0.25, (a[1] + apex[1]) * 0.5 - 0.02, a[2] * 0.25];
      const inner2 = [b[0] * 0.25, (b[1] + apex[1]) * 0.5 - 0.02, b[2] * 0.25];
      tri([a[0], a[1], a[2]], [b[0], b[1], b[2]], inner, [0, 0, 0.35], [0, 0, 0.35], [0, 0, 0.1]);
      tri([b[0], b[1], b[2]], inner2, inner, [0, 0, 0.35], [0, 0, 0.1], [0, 0, 0.1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aMix', new THREE.Float32BufferAttribute(mix, 3));
  g.computeVertexNormals();
  return g;
}

function rockGeo(seed, kind) {
  const r = mulberry32(seed);
  let g;
  if (kind === 'shard') {
    g = new THREE.ConeGeometry(0.6, 1.8, 4 + Math.floor(r() * 2), 1);
    g.translate(0, 0.6, 0);
  } else {
    g = new THREE.IcosahedronGeometry(1, kind === 'big' ? 1 : 0);
  }
  if (g.index) g = g.toNonIndexed();
  const p = g.attributes.position;
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = Math.round(p.getX(i) * 100) + ',' + Math.round(p.getY(i) * 100) + ',' + Math.round(p.getZ(i) * 100);
    let d = map.get(key);
    if (!d) { d = [(r() - 0.5) * 0.35, (r() - 0.5) * 0.3, (r() - 0.5) * 0.35]; map.set(key, d); }
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) * 0.75 + d[1], p.getZ(i) + d[2]);
  }
  g.computeVertexNormals();
  return setMix(g, (v, n) => [smoothstep(0.55, 0.8, n.y) * (v.y > -0.1 ? 1 : 0), 0, 0.6 + 0.4 * n.y]);
}

function logGeo() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 9, 1, false);
  g.rotateZ(Math.PI / 2);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return setMix(ng, (v, n) => [smoothstep(0.45, 0.75, n.y), 1, 0.7]);
}

function slabGeo(seed) {
  const r = mulberry32(seed);
  let g = new THREE.BoxGeometry(1.5, 1, 0.7, 2, 6, 1);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const taper = 1 - y * 0.45;
    p.setX(i, p.getX(i) * taper + (r() - 0.5) * 0.08);
    p.setZ(i, p.getZ(i) * taper + (r() - 0.5) * 0.05);
  }
  g = g.toNonIndexed();
  g.computeVertexNormals();
  return setMix(g, (v, n) => [smoothstep(0.5, 0.8, n.y) + (v.y > 0.97 ? 0.6 : 0), 0, 0.55 + 0.45 * Math.abs(n.x)]);
}

// ---------- manager ----------
export class Flora {
  constructor(scene) {
    this.scene = scene;
    this.sectors = new Map();
    this.queue = [];
    this.mats = {
      crown: makeMixMaterial({ rim: 1 }),
      bark: makeMixMaterial({ map: barkTexture() }),
      spruce: makeMixMaterial({ rim: 0.25 }),
      rock: makeMixMaterial({ flat: true }),
      log: makeMixMaterial({ flat: true }),
    };
    this.geo = {
      furNear: furBall(3, 11),
      furFar: furBall(1, 11),
      trunk: birchTrunk(),
      spruce: [spruceGeo(1), spruceGeo(2), spruceGeo(3)],
      rock: [rockGeo(1, 'big'), rockGeo(2, 'big'), rockGeo(3, 'small'), rockGeo(4, 'shard')],
      log: logGeo(),
      slab: slabGeo(9),
    };
    this.palette = [new THREE.Color('#ff9a52')];
  }

  setMood(m, sunView) {
    const M = this.mats;
    this.palette = m.crown;
    M.crown.userData.uniforms.uSnow.value.copy(m.snow);
    M.crown.userData.uniforms.uSnowAmt.value = m.crownSnow;
    M.crown.userData.uniforms.uRim.value.copy(m.crownRim);
    M.crown.userData.uniforms.uRimAmt.value = 0.9;
    M.bark.color.copy(m.bark);
    M.spruce.color.copy(m.spruce);
    M.spruce.userData.uniforms.uSnow.value.copy(m.spruceSnow);
    M.spruce.userData.uniforms.uTrunk.value.copy(m.rock).multiplyScalar(0.8);
    M.spruce.userData.uniforms.uRim.value.copy(m.crownRim);
    M.rock.color.copy(m.rock);
    M.rock.userData.uniforms.uSnow.value.copy(m.snow);
    M.log.color.copy(m.rock);
    M.log.userData.uniforms.uTrunk.value.copy(m.rock).lerp(new THREE.Color('#6a5a7a'), 0.35);
    M.log.userData.uniforms.uSnow.value.copy(m.snow);
    this.sunViewRefs = Object.values(M).map((x) => x.userData.uniforms.uSunView.value);
    for (const s of this.sectors.values()) this._recolor(s);
  }

  setSunView(v) {
    for (const m of Object.values(this.mats)) m.userData.uniforms.uSunView.value.copy(v);
  }

  _recolor(s) {
    if (!s.crown) return;
    const col = new THREE.Color();
    for (let i = 0; i < s.crownPal.length; i++) {
      col.copy(this.palette[s.crownPal[i] % this.palette.length]);
      col.multiplyScalar(s.crownShade[i]);
      s.crown.setColorAt(i, col);
    }
    s.crown.instanceColor.needsUpdate = true;
  }

  // Build placement for a sector (pure data).
  _layout(sx, sz) {
    const rng = mulberry32(hash2(sx, sz, 99));
    const x0 = sx * SECTOR, z0 = sz * SECTOR;
    const L = {
      trunks: [], crowns: [], crownPal: [], crownShade: [],
      spruce: [[], [], []], rocks: [[], [], [], []], logs: [], slabs: [],
      obstacles: [], gates: [],
    };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const nrm = { x: 0, y: 1, z: 0 };
    const CELL = 5.2;
    const n = Math.floor(SECTOR / CELL);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = x0 + (i + 0.15 + rng() * 0.7) * CELL;
        const z = z0 + (j + 0.15 + rng() * 0.7) * CELL;
        const d = forestDensity(x, z);
        const kind = forestKind(x, z);
        const rk = rockiness(x, z);
        const roll = rng();
        normalAt(x, z, nrm);
        const y = height(x, z);
        // keep cliff lips and their landings open
        const steep = nrm.y < 0.8 || y - height(x, z + 9) > 6 || height(x, z - 9) - y > 7;
        const spruceP = kind > 0.08 ? 1 : kind > -0.12 ? 0.35 : 0;
        if (!steep && roll < d * 0.55 + 0.004) {
          if (rng() < spruceP) {
            // tall snowy spruce
            const hgt = 11 + rng() * 10;
            const wid = hgt * (0.42 + rng() * 0.14);
            e.set(0, rng() * Math.PI * 2, 0);
            q.setFromEuler(e);
            m4.compose(p.set(x, y - 0.6, z), q, s.set(wid, hgt, wid));
            L.spruce[Math.floor(rng() * 3)].push(m4.clone());
            L.obstacles.push({ x, z, r: 0.42, top: y + hgt, kind: 'tree', id: L.obstacles.length });
          } else {
            // fluffy birch: thin trunk, crown of fur balls
            const hgt = 7 + rng() * 6;
            const tr = 0.13 + rng() * 0.08;
            const lx = (rng() - 0.5) * 0.14, lz = (rng() - 0.5) * 0.14;
            e.set(lx, rng() * Math.PI * 2, lz);
            q.setFromEuler(e);
            m4.compose(p.set(x, y - 0.4, z), q, s.set(tr, hgt, tr));
            L.trunks.push(m4.clone());
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
            const top = new THREE.Vector3(x, y - 0.4, z).addScaledVector(up, hgt);
            const nb = 2 + Math.floor(rng() * 4);
            const big = 1.3 + rng() * 1.1;
            const pal = Math.floor(rng() * 8);
            for (let b = 0; b < nb; b++) {
              const rr = b === 0 ? big : big * (0.55 + rng() * 0.35);
              const a = rng() * Math.PI * 2;
              const off = b === 0 ? 0 : big * (0.55 + rng() * 0.5);
              const c = top.clone().add(new THREE.Vector3(Math.cos(a) * off, b === 0 ? 0 : -rng() * big * 1.4, Math.sin(a) * off));
              e.set(rng() * 0.6, rng() * 6.3, rng() * 0.6);
              q.setFromEuler(e);
              m4.compose(c, q, s.set(rr, rr, rr));
              L.crowns.push(m4.clone());
              L.crownPal.push(pal + (rng() < 0.2 ? 1 : 0));
              L.crownShade.push(0.88 + rng() * 0.2);
            }
            L.obstacles.push({ x, z, r: tr + 0.12, top: y + hgt, kind: 'tree', id: L.obstacles.length });
          }
        } else if (roll < d * 0.55 + 0.012 + rk * 0.07) {
          // boulder or shard
          const t = rng() < 0.25 ? 3 : Math.floor(rng() * 3);
          const sc = t === 3 ? 0.8 + rng() * 2.2 : t === 2 ? 0.4 + rng() * 0.6 : 0.8 + rng() * 2.2;
          e.set((rng() - 0.5) * 0.5, rng() * 6.3, (rng() - 0.5) * 0.5);
          q.setFromEuler(e);
          const sy = sc * (0.6 + rng() * 0.6);
          m4.compose(p.set(x, y - sy * 0.25, z), q, s.set(sc * (0.8 + rng() * 0.6), sy, sc * (0.8 + rng() * 0.6)));
          L.rocks[t].push(m4.clone());
          const topH = t === 3 ? sy * 1.3 : sy * 0.55;
          L.obstacles.push({ x, z, r: sc * 0.85, top: y + topH, kind: topH < 0.7 ? 'bump' : 'rock', id: L.obstacles.length });
        } else if (rng() < 0.012 * (0.4 + d + rk)) {
          // fallen log across the slope
          const len = 4 + rng() * 6, rad = 0.25 + rng() * 0.2;
          const yaw = (rng() - 0.5) * 1.2;
          e.set(0, yaw, (rng() - 0.5) * 0.08);
          q.setFromEuler(e);
          m4.compose(p.set(x, y + rad * 0.2, z), q, s.set(len, rad, rad));
          L.logs.push(m4.clone());
          const dx = Math.cos(yaw) * len * 0.5, dz = -Math.sin(yaw) * len * 0.5;
          L.obstacles.push({ x, z, ax: x - dx, az: z - dz, bx: x + dx, bz: z + dz, r: rad, top: y + rad * 1.2, kind: 'log', id: L.obstacles.length });
        }
      }
    }
    // stone gates on open, rocky ground
    const gr = mulberry32(hash2(sx, sz, 7));
    const cxs = x0 + SECTOR * (0.3 + gr() * 0.4), czs = z0 + SECTOR * (0.3 + gr() * 0.4);
    if (gr() < 0.18 + rockiness(cxs, czs) * 0.6 && forestDensity(cxs, czs) < 0.45 && Math.hypot(cxs, czs) > 120) {
      normalAt(cxs, czs, nrm);
      if (nrm.y > 0.85) {
        const yaw = Math.atan2(nrm.x, nrm.z) + (gr() - 0.5) * 0.4; // face down the fall line
        const gap = 4 + gr() * 2.5;
        const hgt = 9 + gr() * 6;
        const ax = Math.cos(yaw), az = -Math.sin(yaw);
        for (const side of [-1, 1]) {
          const px = cxs + ax * side * gap * 0.5, pz = czs + az * side * gap * 0.5;
          const py = height(px, pz) - 1.2;
          e.set(0, yaw, -side * 0.16);
          q.setFromEuler(e);
          m4.compose(p.set(px, py, pz), q, s.set(1.6, hgt, 1.2));
          L.slabs.push(m4.clone());
          L.obstacles.push({ x: px, z: pz, r: 1.0, top: py + hgt, kind: 'rock', id: L.obstacles.length });
        }
        L.gates.push({
          ax: cxs - ax * (gap * 0.5 - 0.9), az: czs - az * (gap * 0.5 - 0.9),
          bx: cxs + ax * (gap * 0.5 - 0.9), bz: czs + az * (gap * 0.5 - 0.9),
          y: height(cxs, czs), h: hgt * 0.8, id: 'g' + sx + ',' + sz,
        });
      }
    }
    return L;
  }

  _inst(geo, mat, list, shadow = true) {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    for (let i = 0; i < list.length; i++) im.setMatrixAt(i, list[i]);
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    this.scene.add(im);
    return im;
  }

  _build(sx, sz) {
    const L = this._layout(sx, sz);
    const s = { sx, sz, meshes: [], obstacles: L.obstacles, gates: L.gates, crownPal: L.crownPal, crownShade: L.crownShade, near: false };
    const G = this.geo, M = this.mats;
    const add = (m) => { if (m) s.meshes.push(m); return m; };
    add(this._inst(G.trunk, M.bark, L.trunks));
    s.crown = add(this._inst(G.furFar, M.crown, L.crowns));
    if (s.crown) {
      s.crown.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(L.crowns.length * 3), 3);
      this._recolor(s);
    }
    for (let k = 0; k < 3; k++) add(this._inst(G.spruce[k], M.spruce, L.spruce[k]));
    for (let k = 0; k < 4; k++) add(this._inst(G.rock[k], M.rock, L.rocks[k]));
    add(this._inst(G.log, M.log, L.logs));
    add(this._inst(G.slab, M.rock, L.slabs));
    return s;
  }

  _dispose(s) {
    for (const m of s.meshes) { this.scene.remove(m); m.dispose(); }
  }

  update(px, pz, sync = false) {
    const psx = Math.floor(px / SECTOR), psz = Math.floor(pz / SECTOR);
    const R = Math.ceil(FLORA_RADIUS / SECTOR);
    const need = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const sx = psx + dx, sz = psz + dz;
      const x0 = sx * SECTOR, z0 = sz * SECTOR;
      const qx = Math.max(x0 - px, 0, px - (x0 + SECTOR)), qz = Math.max(z0 - pz, 0, pz - (z0 + SECTOR));
      const dist = Math.hypot(qx, qz);
      if (dist > FLORA_RADIUS) continue;
      const key = sx + ',' + sz;
      const s = this.sectors.get(key);
      if (s) {
        s.seen = true;
        const near = dist < NEAR_FUR;
        if (s.crown && near !== s.near) { s.crown.geometry = near ? this.geo.furNear : this.geo.furFar; }
        s.near = near;
      } else need.push({ sx, sz, key, dist });
    }
    for (const [key, s] of this.sectors) {
      if (!s.seen) { this._dispose(s); this.sectors.delete(key); } else s.seen = false;
    }
    need.sort((a, b) => a.dist - b.dist);
    const t0 = performance.now();
    for (const n of need) {
      if (!sync && performance.now() - t0 > 4) break;
      const s = this._build(n.sx, n.sz);
      s.seen = false;
      this.sectors.set(n.key, s);
    }
  }

  // obstacles and gates near a point
  nearby(px, pz, out, gates) {
    out.length = 0;
    if (gates) gates.length = 0;
    const sx = Math.floor(px / SECTOR), sz = Math.floor(pz / SECTOR);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const s = this.sectors.get((sx + dx) + ',' + (sz + dz));
      if (!s) continue;
      for (const o of s.obstacles) {
        const ox = o.x - px, oz = o.z - pz;
        if (ox * ox + oz * oz < 400) { o.sector = s; out.push(o); }
      }
      if (gates) for (const g of s.gates) gates.push(g);
    }
    return out;
  }
}
