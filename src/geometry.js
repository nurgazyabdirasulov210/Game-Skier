import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise2D, smoothstep } from './noise.js';

const V3 = THREE.Vector3;

// Простой сборщик геометрии с произвольными атрибутами.
class Builder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.fol = []; this.col = []; this.corner = []; this.idx = []; this.count = 0; this.pad = 0; }
  vert(p, n, uv = [0, 0], fol = [1, 0], col = [1, 1, 1], corner = [0, 0]) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(uv[0], uv[1]);
    this.fol.push(fol[0], fol[1]);
    this.col.push(col[0], col[1], col[2]);
    this.corner.push(corner[0], corner[1]);
    return this.count++;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  build({ uv = true, fol = true, color = false, corner = false } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (fol) g.setAttribute('aFol', new THREE.Float32BufferAttribute(this.fol, 2));
    if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (corner) g.setAttribute('aCorner', new THREE.Float32BufferAttribute(this.corner, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.boundingSphere.radius += this.pad; // спрайты больше своих центров
    return g;
  }
}

// --------------------------------------------------------------- трубка (ствол)
// Протягивает сечение (эллипс) вдоль ломаной с переменным радиусом.
export function makeTube(pts, radii, radial, { capStart = false, capEnd = false, ellipse = [1, 1], uvV = 1 } = {}) {
  const n = pts.length;
  const T = [], N = [], B = [];
  for (let i = 0; i < n; i++) {
    T.push(new V3().subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize());
  }
  let n0 = new V3(0, 0, 1);
  if (Math.abs(T[0].dot(n0)) > 0.9) n0.set(1, 0, 0);
  n0.sub(T[0].clone().multiplyScalar(T[0].dot(n0))).normalize();
  N.push(n0); B.push(new V3().crossVectors(T[0], n0));
  for (let i = 1; i < n; i++) {
    const nn = N[i - 1].clone().sub(T[i].clone().multiplyScalar(T[i].dot(N[i - 1]))).normalize();
    N.push(nn); B.push(new V3().crossVectors(T[i], nn));
  }
  const b = new Builder();
  let len = 0;
  const p = new V3(), nr = new V3();
  for (let i = 0; i < n; i++) {
    if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      p.copy(pts[i]).addScaledVector(N[i], c * radii[i] * ellipse[0]).addScaledVector(B[i], s * radii[i] * ellipse[1]);
      nr.copy(N[i]).multiplyScalar(c / ellipse[0]).addScaledVector(B[i], s / ellipse[1]).normalize();
      b.vert(p, nr, [j / radial, len * uvV]);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, c = a + radial + 1;
      b.tri(a, c, a + 1); b.tri(a + 1, c, c + 1);
    }
  }
  const cap = (i, dir) => {
    const nn = T[i].clone().multiplyScalar(dir);
    const center = b.vert(pts[i], nn, [0.5, 0.5]);
    const start = b.count;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      p.copy(pts[i]).addScaledVector(N[i], Math.cos(a) * radii[i] * ellipse[0]).addScaledVector(B[i], Math.sin(a) * radii[i] * ellipse[1]);
      b.vert(p, nn, [0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5]);
    }
    for (let j = 0; j < radial; j++) {
      if (dir > 0) b.tri(center, start + j, start + j + 1); else b.tri(center, start + j + 1, start + j);
    }
  };
  if (capStart) cap(0, -1);
  if (capEnd) cap(n - 1, 1);
  return b.build({ fol: false });
}

function curvePoints(base, top, segs, wobble, rng) {
  const pts = [];
  const bx = (rng() - 0.5) * wobble, bz = (rng() - 0.5) * wobble;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = new V3().lerpVectors(base, top, t);
    const s = Math.sin(t * Math.PI);
    p.x += bx * s + (rng() - 0.5) * wobble * 0.15;
    p.z += bz * s + (rng() - 0.5) * wobble * 0.15;
    pts.push(p);
  }
  return pts;
}

// ---------------------------------------------------------------- пушистый шар
// Шар-крона из спрайтов, развёрнутых к камере (см. makeFoliageMaterial).
// Центры спрайтов лежат внутри шара, ближе к поверхности; нормали сферические.
function addFluffyBall(b, center, r, cards, rng, { snow = 1, cardScale = 1, flatten = 0.9, aoMin = 0.5 } = {}) {
  const dir = new V3();
  const offs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let c = 0; c < cards; c++) {
    // равномерно по сфере (спираль Фибоначчи) + немного случайности
    const y = 1 - (2 * (c + 0.5)) / cards;
    const rr = Math.sqrt(1 - y * y);
    const ang = golden * c + rng() * 0.6;
    dir.set(Math.cos(ang) * rr, y, Math.sin(ang) * rr);
    dir.x += (rng() - 0.5) * 0.25; dir.y += (rng() - 0.5) * 0.25; dir.z += (rng() - 0.5) * 0.25;
    dir.normalize();
    const dist = r * (0.42 + 0.3 * rng());
    const p = new V3(center.x + dir.x * dist, center.y + dir.y * dist * flatten, center.z + dir.z * dist);
    const size = r * (0.62 + 0.3 * rng()) * cardScale;
    b.pad = Math.max(b.pad, size * 1.42);
    const snowW = snow * smoothstep(0.35, 0.8, dir.y + (rng() - 0.5) * 0.3);
    const ao = aoMin + (1 - aoMin) * (0.45 + 0.55 * (dir.y * 0.5 + 0.5));
    const rot = rng() * Math.PI * 2, cr = Math.cos(rot), sr = Math.sin(rot);
    const ids = [];
    for (let k = 0; k < 4; k++) {
      const ox = offs[k][0] * size, oy = offs[k][1] * size;
      ids.push(b.vert(p, dir, uvs[k], [Math.min(1, ao), snowW], [1, 1, 1], [ox * cr - oy * sr, ox * sr + oy * cr]));
    }
    b.tri(ids[0], ids[1], ids[2]); b.tri(ids[0], ids[2], ids[3]);
  }
}

function buildBalls(balls, rng, lod, opts = {}) {
  const b = new Builder();
  for (const ball of balls) {
    const cards = lod === 0 ? Math.round(18 + ball.r * 9) : Math.round(6 + ball.r * 2);
    addFluffyBall(b, ball.c, ball.r, cards, rng, { ...opts, cardScale: lod === 0 ? 1 : 1.3 });
  }
  return b.build({ corner: true });
}

// ------------------------------------------------------------------- берёза
// Тонкий белый ствол с чёрными пятнами и 1–3 пушистых шара на верхушке.
export function makeBirch(rng, lod) {
  const height = 8.5 + rng() * 4;
  const radial = lod === 0 ? 7 : 4;
  const segs = lod === 0 ? 6 : 3;
  const top = new V3((rng() - 0.5) * 1.2, height, (rng() - 0.5) * 1.2);
  const pts = curvePoints(new V3(0, -1.2, 0), top, segs, 0.6, rng);
  const radii = pts.map((_, i) => 0.2 * (1 - (i / segs) * 0.6));
  const parts = [makeTube(pts, radii, radial, { uvV: 0.35 })];
  const balls = [];
  const n = 1 + Math.floor(rng() * 3);
  const main = 1.9 + rng() * 0.8;
  balls.push({ c: new V3(top.x, height + main * 0.35, top.z), r: main });
  for (let k = 1; k < n; k++) {
    const a = rng() * Math.PI * 2;
    const rr = main * (0.55 + rng() * 0.25);
    const y = height - main * (0.3 + rng() * 0.9);
    const c = new V3(top.x * (y / height) + Math.cos(a) * main * 0.9, y, top.z * (y / height) + Math.sin(a) * main * 0.9);
    balls.push({ c, r: rr });
    if (lod === 0) {
      const from = pts[Math.min(segs, Math.round(segs * (y / height)) - 1)].clone();
      parts.push(makeTube([from, c.clone().lerp(from, 0.35)], [0.07, 0.04], 4));
    }
  }
  return { trunk: mergeGeometries(parts), crown: buildBalls(balls, rng, lod) };
}

// --------------------------------------------- высокая сосна с шапками на ветках
export function makePine(rng, lod) {
  const height = 14 + rng() * 7;
  const segs = lod === 0 ? 7 : 3;
  const lean = 0.06 * height;
  const top = new V3((rng() - 0.5) * lean * 2, height, (rng() - 0.5) * lean * 2);
  const pts = curvePoints(new V3(0, -1.2, 0), top, segs, 0.8, rng);
  const radii = pts.map((_, i) => 0.32 * (1 - (i / segs) * 0.7));
  const parts = [makeTube(pts, radii, lod === 0 ? 7 : 4, { uvV: 0.5 })];
  const balls = [{ c: new V3(top.x, height + 0.6, top.z), r: 1.4 + rng() * 0.6 }];
  const side = 2 + Math.floor(rng() * 3);
  for (let k = 0; k < side; k++) {
    const y = height * (0.62 + rng() * 0.3);
    const a = rng() * Math.PI * 2, L = 1.8 + rng() * 2.2;
    const tp = pts[Math.min(segs, Math.max(1, Math.round(segs * (y / height))))];
    const c = new V3(tp.x + Math.cos(a) * L, y + 0.6 + rng() * 0.8, tp.z + Math.sin(a) * L);
    balls.push({ c, r: 0.9 + rng() * 0.6 });
    if (lod === 0) parts.push(makeTube([tp.clone(), c.clone().add(new V3(0, -0.4, 0))], [0.09, 0.05], 4));
  }
  return { trunk: mergeGeometries(parts), crown: buildBalls(balls, rng, lod, { aoMin: 0.55 }) };
}

// ------------------------------------------------------------- ель под снегом
// Вблизи (lod 0) ель собирается из отдельных свисающих лап со снегом сверху.
export function makeSpruce(rng, lod) {
  if (lod === 0) return makeSpruceSimple(rng, 13, 12);
  return lod === 1 ? makeSpruceSimple(rng, 8, 9) : makeSpruceSimple(rng, 4, 6);
}

function addTrunkTo(b, height, rTop, rBase, color) {
  const trunkGeo = makeTube([new V3(0, -1.2, 0), new V3(0, height, 0)], [rBase, rTop], 6);
  const tp = trunkGeo.attributes.position, tn = trunkGeo.attributes.normal;
  const base = b.count;
  for (let i = 0; i < tp.count; i++) {
    b.vert(new V3().fromBufferAttribute(tp, i), new V3().fromBufferAttribute(tn, i), [0, 0], [0.55, 0], color);
  }
  const ti = trunkGeo.index.array;
  for (let i = 0; i < ti.length; i += 3) b.tri(base + ti[i], base + ti[i + 1], base + ti[i + 2]);
}

const SPRUCE_NEEDLE = [0.07, 0.19, 0.2];
const SPRUCE_DARK = [0.03, 0.085, 0.1];
const SPRUCE_BARK = [0.2, 0.14, 0.12];

function sprucePlan(rng) {
  const height = 9 + rng() * 10;
  return { height, maxR: height * (0.24 + rng() * 0.07), y0: 0.8 + rng() * 0.8 };
}

function makeSpruceDetailed(rng) {
  const { height, maxR, y0 } = sprucePlan(rng);
  const b = new Builder();
  addTrunkTo(b, height * 0.85, 0.04, 0.24, SPRUCE_BARK);
  const whorls = 15 + Math.floor(rng() * 5);
  const UP = new V3(0, 1, 0);
  const pos = (i) => new V3(b.pos[i * 3], b.pos[i * 3 + 1], b.pos[i * 3 + 2]);
  const triFacing = (i0, i1, i2, wantUp) => {
    const a = pos(i0), c1 = pos(i1).sub(a), c2 = pos(i2).sub(a);
    const ny = c1.z * c2.x - c1.x * c2.z; // y-компонента векторного произведения
    if ((ny > 0) === wantUp) b.tri(i0, i1, i2); else b.tri(i0, i2, i1);
  };
  for (let w = 0; w < whorls; w++) {
    const f = w / whorls;
    const by = y0 + (height - y0) * f * 0.94;
    const L0 = maxR * Math.pow(1 - f, 0.9) * (0.9 + rng() * 0.2) + 0.5;
    const K = Math.max(6, Math.round(9 - f * 2 + rng() * 2));
    const rot = rng() * Math.PI * 2;
    const droopK = 0.55 + (1 - f) * 0.5;
    for (let k = 0; k < K; k++) {
      const a = rot + (k / K) * Math.PI * 2 + (rng() - 0.5) * 0.5;
      const L = L0 * (0.8 + rng() * 0.35);
      const dir = new V3(Math.cos(a), 0, Math.sin(a));
      const side = new V3(-dir.z, 0, dir.x);
      const rows = [];
      const steps = [0, 0.45, 1];
      for (const t of steps) {
        const c = new V3(0, by + (rng() - 0.5) * 0.15, 0).addScaledVector(dir, 0.12 + L * t)
          .addScaledVector(UP, L * (0.16 * t - 0.42 * droopK * t * t));
        const hw = L * 0.3 * (1 - t * 0.82) + 0.06;
        const sag = hw * 0.45;
        const left = c.clone().addScaledVector(side, -hw).addScaledVector(UP, -sag);
        const right = c.clone().addScaledVector(side, hw).addScaledVector(UP, -sag);
        const nC = new V3().copy(UP).addScaledVector(dir, 0.25).normalize();
        const nL = new V3().copy(UP).addScaledVector(side, -0.55).addScaledVector(dir, 0.2).normalize();
        const nR = new V3().copy(UP).addScaledVector(side, 0.55).addScaledVector(dir, 0.2).normalize();
        const snowC = 0.55 + rng() * 0.35 - t * 0.15;
        const snowE = 0.15 + rng() * 0.3;
        const ao = 0.6 + 0.4 * t;
        const top = [
          b.vert(left, nL, [0, 0], [ao, snowE], SPRUCE_DARK),
          b.vert(c, nC, [0, 0], [ao, snowC], SPRUCE_NEEDLE),
          b.vert(right, nR, [0, 0], [ao, snowE], SPRUCE_DARK),
        ];
        const off = -0.07 * L - 0.04;
        const dn = new V3(0, -1, 0).addScaledVector(dir, 0.3).normalize();
        const under = [
          b.vert(left.clone().addScaledVector(UP, off * 0.3), dn, [0, 0], [0.4, 0], SPRUCE_DARK),
          b.vert(c.clone().addScaledVector(UP, off), dn, [0, 0], [0.35, 0], SPRUCE_DARK),
          b.vert(right.clone().addScaledVector(UP, off * 0.3), dn, [0, 0], [0.4, 0], SPRUCE_DARK),
        ];
        rows.push({ top, under });
      }
      for (let r = 0; r < rows.length - 1; r++) {
        const A = rows[r], B = rows[r + 1];
        for (const [x0, x1] of [[0, 1], [1, 2]]) {
          triFacing(A.top[x0], A.top[x1], B.top[x0], true);
          triFacing(A.top[x1], B.top[x1], B.top[x0], true);
          triFacing(A.under[x0], A.under[x1], B.under[x0], false);
          triFacing(A.under[x1], B.under[x1], B.under[x0], false);
        }
      }
    }
  }
  // верхушка
  const tipBase = height * 0.9, tipTop = height + 0.6;
  const tip = b.vert(new V3(0, tipTop, 0), new V3(0, 1, 0), [0, 0], [1, 0.7], SPRUCE_NEEDLE);
  const ring = [];
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    ring.push(b.vert(new V3(Math.cos(a) * 0.45, tipBase, Math.sin(a) * 0.45), new V3(Math.cos(a), 0.5, Math.sin(a)).normalize(), [0, 0], [0.8, 0.3], SPRUCE_DARK));
  }
  for (let k = 0; k < 6; k++) b.tri(tip, ring[k + 1], ring[k]);
  return b.build({ uv: false, color: true });
}

function makeSpruceSimple(rng, tiers, K) {
  const { height, maxR, y0 } = sprucePlan(rng);
  const b = new Builder();
  const needle = SPRUCE_NEEDLE, needleDark = SPRUCE_DARK;
  addTrunkTo(b, height * 0.5, 0.18, 0.32, SPRUCE_BARK);
  const span = height - y0;
  const n = new V3(), p = new V3();
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const by = y0 + span * f * 0.93;
    const th = (span / tiers) * 1.9;
    const R = maxR * (1 - f * 0.92) * (0.9 + rng() * 0.2);
    const tip = b.vert(new V3(0, Math.min(height, by + th), 0), new V3(0, 1, 0), [0, 0], [1, 0.62], needle);
    const rot = rng() * Math.PI * 2;
    const rim = [], under = [];
    for (let k = 0; k <= K * 2; k++) {
      const kk = k % (K * 2);
      const a = rot + (kk / (K * 2)) * Math.PI * 2;
      const spike = kk % 2 === 0;
      const rr = R * (spike ? 0.92 + rng() * 0.22 : 0.62 + rng() * 0.12);
      const droop = spike ? -th * (0.18 + rng() * 0.2) : th * 0.02;
      p.set(Math.cos(a) * rr, by + droop, Math.sin(a) * rr);
      n.set(Math.cos(a) * 0.75, 0.9, Math.sin(a) * 0.75).normalize();
      const snow = spike ? 0.2 + rng() * 0.4 : 0.45 + rng() * 0.35;
      rim.push(b.vert(p.clone(), n.clone(), [0, 0], [spike ? 0.85 : 0.95, snow], spike ? needleDark : needle));
      n.set(Math.cos(a) * 0.5, -1, Math.sin(a) * 0.5).normalize();
      under.push(b.vert(p.clone(), n.clone(), [0, 0], [0.45, 0], needleDark));
    }
    const inner = b.vert(new V3(0, by + th * 0.22, 0), new V3(0, -1, 0), [0, 0], [0.25, 0], needleDark);
    for (let k = 0; k < K * 2; k++) {
      b.tri(tip, rim[k + 1], rim[k]);
      b.tri(inner, under[k], under[k + 1]);
    }
  }
  return b.build({ uv: false, color: true });
}

// ---------------------------------------------------------------- сухостой
export function makeSnag(rng) {
  const height = 6 + rng() * 7;
  const pts = curvePoints(new V3(0, -1, 0), new V3((rng() - 0.5) * 1.2, height, (rng() - 0.5) * 1.2), 6, 0.9, rng);
  const radii = pts.map((_, i) => 0.26 * (1 - (i / 6) * 0.85));
  const parts = [makeTube(pts, radii, 6, { capEnd: true })];
  const branches = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < branches; i++) {
    const from = pts[2 + Math.floor(rng() * 4)].clone();
    const a = rng() * Math.PI * 2, L = 1 + rng() * 2.5;
    const to = from.clone().add(new V3(Math.cos(a) * L, L * (0.2 + rng() * 0.8), Math.sin(a) * L));
    parts.push(makeTube([from, to], [0.07, 0.02], 4));
  }
  return mergeGeometries(parts);
}

// ------------------------------------------------------- поваленное бревно, пень
export function makeLog(rng) {
  const L = 5 + rng() * 5, r = 0.45 + rng() * 0.25;
  const pts = [];
  for (let i = 0; i <= 6; i++) pts.push(new V3(-L / 2 + (L * i) / 6, Math.sin(i * 0.9) * 0.08, (rng() - 0.5) * 0.15));
  const radii = pts.map((_, i) => r * (1 - i * 0.04));
  const parts = [makeTube(pts, radii, 9, { capStart: true, capEnd: true, uvV: 0.35 })];
  const stubs = Math.floor(rng() * 2);
  for (let i = 0; i < stubs; i++) {
    const from = pts[1 + Math.floor(rng() * 5)].clone();
    const a = rng() * Math.PI * 2;
    const to = from.clone().add(new V3((rng() - 0.5) * 0.6, Math.cos(a) * 1.2 + 0.3, Math.sin(a) * 1.2));
    parts.push(makeTube([from, to], [0.09, 0.03], 4));
  }
  return mergeGeometries(parts);
}

export function makeStump(rng) {
  const h = 0.5 + rng() * 0.7, r = 0.3 + rng() * 0.25;
  return makeTube([new V3(0, -0.8, 0), new V3(0, h * 0.6, 0), new V3(0.03, h, 0)], [r * 1.25, r, r * 0.95], 9, { capEnd: true });
}

// ------------------------------------------------------- камни и скалы (грани)
function cutShape(geo, rng, planes, minD, maxD, wobble = 0.25) {
  const pos = geo.attributes.position;
  const v = new V3();
  const cuts = [];
  for (let i = 0; i < planes; i++) {
    const n = new V3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    cuts.push([n, minD + rng() * (maxD - minD)]);
  }
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.multiplyScalar(1 + (rng() - 0.5) * wobble);
    for (const [n, d] of cuts) {
      const k = v.dot(n);
      if (k > d) v.addScaledVector(n, d - k);
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  return geo;
}

export function makeRock(rng) {
  let g = new THREE.IcosahedronGeometry(1, 0);
  g = mergeVerticesSimple(g);
  cutShape(g, rng, 4, 0.45, 0.7, 0.35);
  g.scale(1 + rng() * 0.6, 0.55 + rng() * 0.4, 0.9 + rng() * 0.5);
  g.translate(0, 0.2, 0);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  flat.computeBoundingSphere();
  return flat;
}

// Тёмная плита/клин — как крупные скалы в видео.
export function makeCliff(rng) {
  let g = new THREE.BoxGeometry(2, 2, 2, 1, 1, 1);
  g.deleteAttribute('uv');
  g = mergeVerticesSimple(g);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = y > 0 ? 0.35 + rng() * 0.5 : 1; // верх сужается — получается клин
    pos.setXYZ(i, pos.getX(i) * (y > 0 ? 0.6 + rng() * 0.5 : 1) + (rng() - 0.5) * 0.3, y, pos.getZ(i) * k);
  }
  cutShape(g, rng, 2, 0.75, 0.95, 0.05);
  g.translate(0, 0.3, 0);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  flat.computeBoundingSphere();
  return flat;
}

// Икосаэдр из three неиндексированный; склеиваем вершины, чтобы смещение не рвало сетку.
function mergeVerticesSimple(geo) {
  const pos = geo.attributes.position;
  const map = new Map();
  const verts = [];
  const idx = [];
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let id = map.get(key);
    if (id === undefined) { id = verts.length / 3; map.set(key, id); verts.push(pos.getX(i), pos.getY(i), pos.getZ(i)); }
    idx.push(id);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------- каменные ворота
// Высокие ворота из тёмного камня с овальным проёмом, слегка перекошенные.
export function makeArch(rng, { width = 7, height = 12, depth = 1.6 } = {}) {
  const W = width / 2;
  const lean = (rng() - 0.5) * 1.2;
  const shape = new THREE.Shape();
  shape.moveTo(-W - 0.8, -3);
  shape.lineTo(W + 0.6, -3);
  shape.lineTo(W + 0.1, height * 0.45);
  shape.lineTo(W * 0.55 + lean, height * 0.9);
  shape.lineTo(W * 0.15 + lean, height);
  shape.lineTo(-W * 0.35 + lean, height * 0.97);
  shape.lineTo(-W * 0.75 + lean * 0.5, height * 0.7);
  shape.lineTo(-W - 0.3, height * 0.35);
  shape.closePath();
  const hole = new THREE.Path();
  const hx = lean * 0.35, hy = height * 0.42, rx = W * 0.5, ry = height * 0.3;
  hole.absellipse(hx, hy, rx, ry, 0, Math.PI * 2, false, 0);
  shape.holes.push(hole);
  let g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.3, bevelSegments: 1, curveSegments: 14 });
  g.translate(0, 0, -depth / 2);
  g.deleteAttribute('uv');
  if (g.index) g = g.toNonIndexed();
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------ куст
export function makeBush(rng) {
  const balls = [];
  const n = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const r = 0.8 + rng() * 0.6;
    balls.push({ c: new V3((rng() - 0.5) * 1.4, r * 0.6, (rng() - 0.5) * 1.4), r });
  }
  return buildBalls(balls, rng, 0);
}
