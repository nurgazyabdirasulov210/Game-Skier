// Small helpers for building merged low-poly geometry.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Makes sure the geometry is non-indexed and has normal, uv and aSnow. */
export function prep(geo, snow = 0) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.aSnow) {
    const s = new Float32Array(n);
    if (typeof snow === 'function') {
      const nr = g.attributes.normal, p = g.attributes.position;
      for (let i = 0; i < n; i++) s[i] = snow(nr.getY(i), p.getY(i), i);
    } else s.fill(snow);
    g.setAttribute('aSnow', new THREE.Float32BufferAttribute(s, 1));
  }
  for (const k of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'uv', 'aSnow'].includes(k)) g.deleteAttribute(k);
  }
  return g;
}

export function merge(list) {
  return mergeGeometries(list, false);
}

/** Cylinder (tube) between two points. */
export function limb(a, b, r0, r1, seg = 6, uvScale = 1) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true);
  g.translate(0, len / 2, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len * uvScale);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

/** Flat-shaded faceted lump (rock). */
export function rockGeometry(rnd, { detail = 1, sx = 1, sy = 1, sz = 1, jag = 0.28, snowTop = 0.72 } = {}) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  if (g.index) g = g.toNonIndexed();
  const p = g.attributes.position;
  // displace shared corners consistently
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!cache.has(k)) cache.set(k, 1 + (rnd() * 2 - 1) * jag);
    const f = cache.get(k);
    p.setXYZ(i, p.getX(i) * f * sx, p.getY(i) * f * sy, p.getZ(i) * f * sz);
  }
  g.computeVertexNormals();
  const nr = g.attributes.normal;
  const s = new Float32Array(p.count);
  for (let i = 0; i < p.count; i += 3) {
    const ny = nr.getY(i);
    const v = ny > snowTop + (rnd() - 0.5) * 0.3 ? 1 : (ny > 0.35 && rnd() < 0.25 ? 1 : 0);
    s[i] = s[i + 1] = s[i + 2] = v;
  }
  g.setAttribute('aSnow', new THREE.Float32BufferAttribute(s, 1));
  return prep(g);
}
