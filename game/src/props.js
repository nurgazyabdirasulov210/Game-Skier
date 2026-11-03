// Procedural geometry for everything that stands on the snow.
import * as THREE from '../vendor/three.module.js';
import { mulberry32 } from './noise.js';

// ------------------------------------------------------------------ builder

class Builder {
  constructor(attrs) {
    this.attrs = attrs; // { name: itemSize }
    this.data = { position: [], normal: [] };
    for (const k in attrs) this.data[k] = [];
  }
  /** Append geometry (indexed or not) transformed by matrix; `vals` gives per-vertex extra attributes. */
  add(geo, matrix, vals = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      nn.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.data.position.push(v.x, v.y, v.z);
      this.data.normal.push(nn.x, nn.y, nn.z);
      for (const k in this.attrs) {
        const src = g.attributes[k];
        let val = vals[k];
        if (typeof val === 'function') val = val(i, v, nn, g);
        else if (val === undefined && src) val = Array.from({ length: this.attrs[k] }, (_, c) => src.getComponent(i, c));
        if (val === undefined) val = new Array(this.attrs[k]).fill(0);
        if (typeof val === 'number') val = [val];
        if (val.isColor) val = [val.r, val.g, val.b];
        for (let c = 0; c < this.attrs[k]; c++) this.data[k].push(val[c] ?? 0);
      }
    }
    return this;
  }
  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.data.position, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.data.normal, 3));
    for (const k in this.attrs) geo.setAttribute(k, new THREE.Float32BufferAttribute(this.data[k], this.attrs[k]));
    geo.computeBoundingSphere();
    return geo;
  }
}

const M = () => new THREE.Matrix4();
const TRS = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

// ------------------------------------------------------------------ conifers

/** One drooping, star-shaped branch tier. Indexed so normals stay smooth. */
function tierGeometry(radius, height, segs, rnd, droop, spike) {
  const pos = [], info = [], idx = [];
  const rot = rnd() * Math.PI * 2;
  pos.push(0, height, 0); info.push(1, 1);                    // 0 apex
  for (let k = 0; k < segs; k++) {                            // mid ring
    const a = rot + (k / segs) * Math.PI * 2;
    const r = radius * 0.5 * (0.9 + rnd() * 0.2);
    pos.push(Math.cos(a) * r, height * 0.45 - droop * 0.1, Math.sin(a) * r); info.push(0.95, 1);
  }
  for (let k = 0; k < segs; k++) {                            // rim ring, alternating tips
    const a = rot + (k / segs) * Math.PI * 2 + (rnd() - 0.5) * 0.12;
    const tip = k % 2 === 0;
    const r = radius * (tip ? 1.0 + rnd() * 0.15 : 1 - spike) ;
    const y = tip ? -droop * (0.7 + rnd() * 0.5) : -droop * 0.2 + height * 0.08;
    pos.push(Math.cos(a) * r, y, Math.sin(a) * r); info.push(tip ? 0.7 : 0.62, 1);
  }
  pos.push(0, height * 0.22, 0); info.push(0.12, 1);          // under-centre
  const U = 1 + segs * 2;
  for (let k = 0; k < segs; k++) {
    const a = 1 + k, b = 1 + ((k + 1) % segs);
    const c = 1 + segs + k, d = 1 + segs + ((k + 1) % segs);
    idx.push(0, b, a);
    idx.push(a, b, d, a, d, c);
    idx.push(c, d, U);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function trunkGeometry(r0, r1, h, segs) {
  const g = new THREE.CylinderGeometry(r1, r0, h, segs, 1, true);
  g.translate(0, h / 2, 0);
  return g;
}

export function makeConifer({ seed = 1, height = 9, radius = 2.7, tiers = 6, segs = 12, droop = 0.5, spike = 0.32, trunk = true, narrow = 1 } = {}) {
  const rnd = mulberry32(seed);
  const b = new Builder({ aInfo: 2 });
  if (trunk) b.add(trunkGeometry(0.24, 0.1, height * 0.6, 6), M(), { aInfo: [0.6, 0] });
  const start = height * 0.12;
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const y = start + (height - start - 1.2) * Math.pow(f, 0.92);
    const r = (radius * Math.pow(1 - f, 0.95) + 0.35) * narrow;
    const h = 1.5 + (1 - f) * 1.2;
    const g = tierGeometry(r, h, segs, rnd, droop * (1 - f * 0.5), spike);
    b.add(g, TRS(0, y, 0));
  }
  // top spike
  const top = new THREE.ConeGeometry(0.3 * narrow, 1.5, Math.max(4, segs / 2), 1);
  top.translate(0, height - 0.6, 0);
  b.add(top, M(), { aInfo: [1, 1] });
  return b.build();
}

export function makeConiferLow({ height = 9, radius = 2.7, tiers = 3, segs = 6, narrow = 1 } = {}) {
  const b = new Builder({ aInfo: 2 });
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const y = height * 0.15 + (height * 0.85 - 1) * f;
    const r = (radius * (1 - f * 0.85) + 0.3) * narrow;
    const h = (height * 0.85) / tiers + 1.4;
    const c = new THREE.ConeGeometry(r, h, segs, 1, true);
    c.translate(0, y + h / 2 - 0.3, 0);
    b.add(c, M(), { aInfo: (i, v) => [v.y > y + h * 0.4 ? 1 : 0.55, 1] });
  }
  return b.build();
}

export function makeConiferFar({ height = 9, radius = 2.7, narrow = 1 } = {}) {
  const b = new Builder({ aInfo: 2 });
  const c = new THREE.ConeGeometry(radius * 0.9 * narrow, height * 0.95, 5, 1, true);
  c.translate(0, height * 0.5, 0);
  b.add(c, M(), { aInfo: (i, v) => [v.y > height * 0.9 ? 1 : 0.6, 1] });
  return b.build();
}

/** "Snow ghost": a fir buried under thick rime, a stack of soft lumps. */
export function makeGhost({ seed = 3, detail = 1, height = 7.5 } = {}) {
  const rnd = mulberry32(seed);
  const b = new Builder({ aInfo: 2 });
  const blobs = detail ? 6 : 3;
  for (let i = 0; i < blobs; i++) {
    const f = i / blobs;
    const r = (1.9 * (1 - f) + 0.55) * (0.85 + rnd() * 0.3);
    const y = 0.9 + f * (height - 1.6);
    const s = new THREE.IcosahedronGeometry(1, detail);
    const p = s.attributes.position;
    const v = new THREE.Vector3();
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k);
      const n = Math.sin(v.x * 3.1 + seed + i) * Math.sin(v.y * 2.7 + i * 1.3) * Math.sin(v.z * 3.3 + seed * 0.7);
      v.multiplyScalar(1 + n * 0.22);
      p.setXYZ(k, v.x, v.y, v.z);
    }
    s.computeVertexNormals();
    const ox = (rnd() - 0.5) * 0.5, oz = (rnd() - 0.5) * 0.5;
    b.add(s, TRS(ox, y, oz, 0, rnd() * 6, 0, r, r * 1.05, r), {
      aInfo: (k, vv) => [Math.max(0.2, Math.min(1, (vv.y - y + r) / (2 * r) + 0.15)), 2],
    });
  }
  return b.build();
}

/** Dead silver snag with a few broken branches. */
export function makeSnag({ seed = 5 } = {}) {
  const rnd = mulberry32(seed);
  const b = new Builder({ aInfo: 2 });
  b.add(trunkGeometry(0.22, 0.05, 8, 6), M(), { aInfo: [0.8, 0] });
  for (let i = 0; i < 6; i++) {
    const y = 2.5 + i * 0.9 + rnd() * 0.4;
    const len = 1.6 * (1 - i / 7) + 0.4;
    const br = new THREE.CylinderGeometry(0.02, 0.06, len, 4, 1, true);
    br.translate(0, len / 2, 0);
    b.add(br, TRS(0, y, 0, 0, rnd() * 6.28, -1.1 - rnd() * 0.5), { aInfo: [0.8, 0] });
  }
  return b.build();
}

// ------------------------------------------------------------------ rocks, logs, stumps

export function makeRock(seed = 9, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let k = 0; k < p.count; k++) {
    v.fromBufferAttribute(p, k);
    const n = Math.sin(v.x * 2.3 + seed) * Math.cos(v.z * 2.9 - seed) + Math.sin(v.y * 4.1 + seed * 2) * 0.5;
    v.multiplyScalar(1 + n * 0.2);
    v.y *= 0.75;
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.3;
    p.setXYZ(k, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function makeLog() {
  const b = new Builder({ aInfo: 2 });
  const c = new THREE.CylinderGeometry(1, 1, 1, 9, 1, false);
  b.add(c, TRS(0, 0, 0, 0, 0, Math.PI / 2), { aInfo: [1, 0] });
  // a couple of broken branch stubs
  const s1 = new THREE.CylinderGeometry(0.15, 0.25, 0.8, 5);
  s1.translate(0, 0.4, 0);
  b.add(s1, TRS(0.2, 0.6, 0.2, 0.4, 0, 0.3, 1, 1, 1), { aInfo: [1, 0] });
  b.add(s1, TRS(-0.3, -0.5, -0.3, -2.2, 0, 0.2, 1, 1, 1), { aInfo: [1, 0] });
  return b.build();
}

export function makeStump() {
  const g = new THREE.CylinderGeometry(0.32, 0.4, 0.9, 8);
  g.translate(0, 0.45, 0);
  return g;
}

// ------------------------------------------------------------------ cabin, chairlift, gates

function colored(geo, color, emit = 0) {
  const c = new THREE.Color(color);
  return { geo, color: c, emit };
}

export function makeCabin() {
  const b = new Builder({ color: 3, aEmit: 1 });
  const add = (geo, m, color, emit = 0) => b.add(geo, m, { color: new THREE.Color(color), aEmit: emit });
  const W = 6.4, D = 5.4, H = 2.8;
  // stacked log walls
  const logs = 7;
  for (let i = 0; i < logs; i++) {
    const y = 0.2 + i * (H / logs);
    const r = H / logs / 2;
    const tone = i % 2 ? '#7a5236' : '#6b4630';
    const lx = new THREE.CylinderGeometry(r, r, W + 0.6, 7);
    add(lx, TRS(0, y + r, D / 2, 0, 0, Math.PI / 2), tone);
    add(lx, TRS(0, y + r, -D / 2, 0, 0, Math.PI / 2), tone);
    const lz = new THREE.CylinderGeometry(r, r, D + 0.6, 7);
    add(lz, TRS(W / 2, y + r, 0, Math.PI / 2, 0, 0), tone);
    add(lz, TRS(-W / 2, y + r, 0, Math.PI / 2, 0, 0), tone);
  }
  // gables
  const gable = new THREE.BufferGeometry();
  gable.setAttribute('position', new THREE.Float32BufferAttribute([-W / 2, 0, 0, W / 2, 0, 0, 0, 2.1, 0], 3));
  gable.computeVertexNormals();
  const gb = new THREE.BufferGeometry();
  gb.setAttribute('position', new THREE.Float32BufferAttribute([W / 2, 0, 0, -W / 2, 0, 0, 0, 2.1, 0], 3));
  gb.computeVertexNormals();
  add(gable, TRS(0, H + 0.2, D / 2), '#6b4630');
  add(gb, TRS(0, H + 0.2, -D / 2), '#6b4630');
  // roof + thick snow blanket
  const pitch = Math.atan2(2.1, W / 2);
  const slope = Math.hypot(2.1, W / 2) + 0.7;
  const roof = new THREE.BoxGeometry(slope, 0.18, D + 1.2);
  const snow = new THREE.BoxGeometry(slope + 0.1, 0.55, D + 1.3, 3, 1, 3);
  const sp = snow.attributes.position;
  for (let k = 0; k < sp.count; k++) if (sp.getY(k) > 0) sp.setY(k, sp.getY(k) + Math.sin(sp.getX(k) * 3 + sp.getZ(k) * 2) * 0.08);
  snow.computeVertexNormals();
  for (const s of [-1, 1]) {
    const cx = s * (W / 4 + 0.15), cy = H + 0.2 + 1.05;
    add(roof, TRS(cx, cy, 0, 0, 0, -s * pitch), '#3b2a22');
    add(snow, TRS(cx + s * Math.sin(pitch) * -0.3, cy + 0.33, 0, 0, 0, -s * pitch), '#f4f7ff');
  }
  // chimney
  add(new THREE.BoxGeometry(0.7, 2.0, 0.7), TRS(W * 0.25, H + 2.2, -D * 0.2), '#5b5a63');
  add(new THREE.BoxGeometry(0.85, 0.25, 0.85), TRS(W * 0.25, H + 3.3, -D * 0.2), '#f4f7ff');
  // windows (glow at night) and door
  const win = new THREE.BoxGeometry(0.9, 0.8, 0.12);
  add(win, TRS(-1.6, 1.5, D / 2 + 0.3), '#ffcf7a', 1);
  add(win, TRS(1.6, 1.5, D / 2 + 0.3), '#ffcf7a', 1);
  add(new THREE.BoxGeometry(0.12, 0.8, 0.9), TRS(W / 2 + 0.32, 1.5, 0), '#ffcf7a', 1);
  add(new THREE.BoxGeometry(1.0, 1.9, 0.14), TRS(0, 1.05, D / 2 + 0.32), '#3a2418');
  // snowdrift around the base
  const drift = new THREE.CylinderGeometry(W * 0.62, W * 0.75, 0.8, 14);
  add(drift, TRS(0, 0.1, 0, 0, 0, 0, 1, 1, 0.9), '#eef2ff');
  return b.build();
}

export function makeTower() {
  const b = new Builder({ color: 3, aEmit: 1 });
  const add = (geo, m, color) => b.add(geo, m, { color: new THREE.Color(color), aEmit: 0 });
  add(new THREE.CylinderGeometry(0.24, 0.34, 11, 8), TRS(0, 5.5, 0), '#c8a23a');
  add(new THREE.CylinderGeometry(0.75, 0.9, 0.6, 8), TRS(0, 0.3, 0), '#8b8d96');
  add(new THREE.BoxGeometry(4.6, 0.35, 0.4), TRS(0, 11, 0), '#c8a23a');
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.5, 0.35, 1.8), TRS(s * 2.1, 10.7, 0), '#3c3f4a');
    for (let w = -2; w <= 2; w++) add(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 8), TRS(s * 2.1, 10.5, w * 0.35, Math.PI / 2, 0, 0), '#1d1f26');
  }
  // ladder rungs
  for (let i = 0; i < 14; i++) add(new THREE.BoxGeometry(0.5, 0.04, 0.04), TRS(0, 1 + i * 0.7, 0.32), '#3c3f4a');
  return b.build();
}

export function makeChair() {
  const b = new Builder({ color: 3, aEmit: 1 });
  const add = (geo, m, color) => b.add(geo, m, { color: new THREE.Color(color), aEmit: 0 });
  add(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 5), TRS(0, -1.15, 0), '#2a2c33');
  add(new THREE.BoxGeometry(0.2, 0.15, 0.2), TRS(0, 0, 0), '#2a2c33');
  add(new THREE.BoxGeometry(1.5, 0.1, 0.55), TRS(0, -2.3, 0.1), '#b8433a');
  add(new THREE.BoxGeometry(1.5, 0.6, 0.08), TRS(0, -2.0, -0.18, -0.2, 0, 0), '#b8433a');
  add(new THREE.BoxGeometry(1.6, 0.05, 0.05), TRS(0, -1.6, 0.5), '#2a2c33');
  // snow on the seat
  add(new THREE.BoxGeometry(1.45, 0.08, 0.5), TRS(0, -2.21, 0.1), '#f4f7ff');
  return b.build();
}

export function makeCable() {
  const g = new THREE.CylinderGeometry(0.035, 0.035, 1, 4, 1, true);
  g.translate(0, 0.5, 0);
  return g;
}

export function makeGatePole() {
  const b = new Builder({ color: 3, aEmit: 1 });
  const add = (geo, m, color, e = 0) => b.add(geo, m, { color: new THREE.Color(color), aEmit: e });
  add(new THREE.CylinderGeometry(0.08, 0.11, 4.6, 6), TRS(0, 2.3, 0), '#5a3b26');
  add(new THREE.SphereGeometry(0.16, 8, 6), TRS(0, 4.68, 0), '#ffd27a', 0.8);
  add(new THREE.CylinderGeometry(0.3, 0.42, 0.35, 8), TRS(0, 0.1, 0), '#f2f5ff');
  return b.build();
}

export function makeFlag() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.22, 0, 0, 0.22, 0, 0, 0, -0.55, 0.02], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  return g;
}

export function makeCrystal() {
  const g = new THREE.OctahedronGeometry(0.42, 0);
  g.scale(1, 1.9, 1);
  return g;
}
