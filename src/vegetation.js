// Trees: lollipop birches with fluffy crowns, tiered snowy spruces and tall
// pines with tufts. Geometry variants + scatter over the map by zone.
import * as THREE from 'three';
import { SEED, MAP } from './config.js';
import { mulberry32, makeNoise2D, fbm, smoothstep } from './noise.js';
import { heightAt, slopeAt, centerX, zoneWeight, lakeFactor } from './terrain.js';
import { prep, merge, limb } from './geomutil.js';
import { InstancedField } from './field.js';
import { stylize } from './shading.js';
import { CrownSpecies } from './crowns.js';
import { makeBirchBark, makeDarkBark, makeFurTexture, makeBoughTexture } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- birch -----
function bentTrunk(rnd, H, r0, seg, rings) {
  const g = new THREE.CylinderGeometry(r0 * 0.5, r0, H, seg, rings, true);
  g.translate(0, H / 2, 0);
  const bendA = rnd() * Math.PI * 2, bend = 0.3 + rnd() * 0.9;
  const wob = rnd() * 6;
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / H;
    const off = bend * t * t + 0.12 * Math.sin(t * 7 + wob) * t;
    p.setX(i, p.getX(i) + Math.cos(bendA) * off);
    p.setZ(i, p.getZ(i) + Math.sin(bendA) * off);
    uv.setY(i, uv.getY(i) * H / 5);
  }
  g.computeVertexNormals();
  const at = (t) => {
    const off = bend * t * t + 0.12 * Math.sin(t * 7 + wob) * t;
    return V(Math.cos(bendA) * off, t * H, Math.sin(bendA) * off);
  };
  return { g, at };
}

function birchVariant(rnd, lo) {
  const H = 10 + rnd() * 8;
  const r0 = 0.22 + rnd() * 0.1;
  const { g, at } = bentTrunk(rnd, H, r0, lo ? 5 : 8, lo ? 2 : 8);
  const parts = [prep(g, 0)];
  const crowns = [];
  const top = at(1);
  crowns.push({ p: top.clone().add(V(0, 1.4, 0)), r: 2.6 + rnd() * 1.1 });
  const nb = 3 + Math.floor(rnd() * 4);
  for (let i = 0; i < nb; i++) {
    const t = 0.38 + (i / nb) * 0.45 + rnd() * 0.08;
    const a = at(t);
    const az = rnd() * Math.PI * 2 + i * 2.2;
    const el = 0.5 + rnd() * 0.6;
    const len = 2.0 + rnd() * 2.8 * (1 - t * 0.5);
    const b = a.clone().add(V(Math.cos(az) * Math.cos(el) * len, Math.sin(el) * len, Math.sin(az) * Math.cos(el) * len));
    if (!lo) parts.push(prep(limb(a, b, 0.09, 0.05, 5, 0.2), 0));
    crowns.push({ p: b, r: 1.7 + rnd() * 1.2 });
  }
  return { geo: merge(parts), crowns };
}

// --------------------------------------------------------------- spruce -----
function spruceVariant(rnd, lo) {
  const H = 17 + rnd() * 11;
  const maxR = 2.3 + rnd() * 1.3;
  const tiers = lo ? 6 : 11 + Math.floor(rnd() * 4);
  const rimN = lo ? 7 : 11;
  const bare = H * (0.18 + rnd() * 0.2); // mature spruces: bare lower trunk
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.42, H, lo ? 5 : 7, 1, true);
  trunk.translate(0, H / 2, 0);
  const tuv = trunk.attributes.uv;
  for (let i = 0; i < tuv.count; i++) tuv.setY(i, tuv.getY(i) * H / 6);
  parts.push(prep(trunk, 0));

  const pos = [], snow = [], uvs = [], nrm = [];
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const y = bare + (H - bare - 0.6) * Math.pow(t, 0.9);
    const R = 0.5 + maxR * Math.pow(1 - t, 0.85) * (0.8 + rnd() * 0.35);
    const tierH = (0.9 + R * 0.32) * (0.85 + rnd() * 0.3);
    const apex = V((rnd() - 0.5) * 0.15, y + tierH * 0.45, (rnd() - 0.5) * 0.15);
    const under = V(0, y - tierH * 0.05, 0);
    const rim = [];
    const rot = rnd() * Math.PI;
    for (let i = 0; i < rimN * 2; i++) {
      const a = rot + ((i + (rnd() - 0.5) * 0.5) / (rimN * 2)) * Math.PI * 2;
      const bough = i % 2 === 0;
      const rr = R * (bough ? 0.95 + rnd() * 0.25 : 0.55 + rnd() * 0.12);
      const dy = bough ? -tierH * (0.45 + rnd() * 0.35) : -tierH * 0.05;
      rim.push(V(Math.cos(a) * rr, y + dy, Math.sin(a) * rr));
    }
    const n = rim.length;
    const reps = Math.max(2, Math.round(R * 1.2));
    for (let i = 0; i < n; i++) {
      const a = rim[i], b = rim[(i + 1) % n];
      const ua = (i / n) * reps, ub = ((i + 1) / n) * reps;
      const s = rnd() < 0.78 ? 1 : 0;
      // top face: snowy boughs
      pos.push(apex.x, apex.y, apex.z, b.x, b.y, b.z, a.x, a.y, a.z);
      uvs.push((ua + ub) / 2, 0, ub, 1, ua, 1);
      for (const p of [apex, b, a]) {
        const rx = p.x - apex.x, rz = p.z - apex.z;
        const l = Math.hypot(rx, rz) || 1;
        const nn = V((rx / l) * 0.55, 1, (rz / l) * 0.55).normalize();
        if (p === apex) nn.set(0, 1, 0);
        nrm.push(nn.x, nn.y, nn.z);
      }
      snow.push(s, s, s);
      // underside: dark needles
      pos.push(under.x, under.y, under.z, a.x, a.y, a.z, b.x, b.y, b.z);
      uvs.push((ua + ub) / 2, 0, ua, 1, ub, 1);
      for (const p of [under, a, b]) {
        const rx = p.x, rz = p.z;
        const l = Math.hypot(rx, rz) || 1;
        const nn = V((rx / l) * 0.8, -0.6, (rz / l) * 0.8).normalize();
        nrm.push(nn.x, nn.y, nn.z);
      }
      snow.push(0, 0, 0);
    }
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  tg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  tg.setAttribute('aSnow', new THREE.Float32BufferAttribute(snow, 1));
  return { trunk: parts[0], needles: prep(tg) };
}

// ----------------------------------------------------------------- pine -----
function pineVariant(rnd, lo) {
  const H = 16 + rnd() * 10;
  const { g, at } = bentTrunk(rnd, H, 0.26 + rnd() * 0.08, lo ? 5 : 7, lo ? 2 : 6);
  const parts = [prep(g, 0)];
  const crowns = [{ p: at(1).add(V(0, 0.6, 0)), r: 1.3 + rnd() * 0.5, squash: 0.7 }];
  const nb = 4 + Math.floor(rnd() * 5);
  for (let i = 0; i < nb; i++) {
    const t = 0.55 + (i / nb) * 0.42 + rnd() * 0.04;
    const a = at(t);
    const az = rnd() * Math.PI * 2 + i * 2.4;
    const len = 1.0 + rnd() * 2.2 * (1.1 - t);
    const el = 0.25 + rnd() * 0.35;
    const b = a.clone().add(V(Math.cos(az) * len, Math.sin(el) * len, Math.sin(az) * len));
    if (!lo) parts.push(prep(limb(a, b, 0.08, 0.04, 4, 0.2), 0));
    crowns.push({ p: b, r: 0.9 + rnd() * 0.7, squash: 0.62 });
  }
  return { geo: merge(parts), crowns };
}

// ------------------------------------------------------------- scatter ------
function scatterGrid(rnd, cell, density, cb) {
  for (let z = -MAP.halfZ + cell / 2; z < MAP.halfZ; z += cell) {
    for (let x = -MAP.halfX + cell / 2; x < MAP.halfX; x += cell) {
      const px = x + (rnd() - 0.5) * cell * 0.95;
      const pz = z + (rnd() - 0.5) * cell * 0.95;
      const d = density(px, pz);
      if (d > 0 && rnd() < d) cb(px, pz);
    }
  }
}

export function buildVegetation(quality, scene, exclusions) {
  const rnd = mulberry32(SEED + 500);
  const N = makeNoise2D(SEED + 77);
  const N2 = makeNoise2D(SEED + 78);
  const fur = makeFurTexture(5);

  const birchMat = stylize(new THREE.MeshLambertMaterial({ map: makeBirchBark(9) }), { rim: 0.15 });
  const darkBark = makeDarkBark(4);
  const pineMat = stylize(new THREE.MeshLambertMaterial({ map: darkBark, color: 0xb9a9b8 }), { rim: 0.15 });
  const spruceTrunkMat = stylize(new THREE.MeshLambertMaterial({ map: darkBark, color: 0x8a8090 }), { rim: 0.1 });
  const needleMat = stylize(new THREE.MeshLambertMaterial({ color: 0x1d3b4a, map: makeBoughTexture(12) }), { snow: true, snowFromMap: true, rim: 0.2 });

  const birchCrowns = new CrownSpecies({ furTexture: fur, colA: 0xff8a3d, colB: 0xffb35c, translucency: 1.4, quads: quality.crownQuads, seed: 1 });
  const tuftCrowns = new CrownSpecies({ furTexture: fur, colA: 0x9fbf6a, colB: 0xd6d98a, translucency: 1.0, quads: Math.max(10, quality.crownQuads - 6), seed: 2 });

  // variants
  const birchV = [], pineV = [], spruceV = [];
  for (let i = 0; i < 6; i++) {
    const s = SEED + 900 + i;
    const hi = birchVariant(mulberry32(s), false);
    const lo = birchVariant(mulberry32(s), true);
    birchV.push({ hi: hi.geo, lo: lo.geo, crowns: hi.crowns });
  }
  for (let i = 0; i < 5; i++) {
    const s = SEED + 950 + i;
    const hi = pineVariant(mulberry32(s), false);
    const lo = pineVariant(mulberry32(s), true);
    pineV.push({ hi: hi.geo, lo: lo.geo, crowns: hi.crowns });
  }
  for (let i = 0; i < 4; i++) {
    const s = SEED + 990 + i;
    spruceV.push({ hi: spruceVariant(mulberry32(s), false), lo: spruceVariant(mulberry32(s), true) });
  }

  const birches = new InstancedField('birches', birchV, birchMat, { loDist: 260 });
  const pines = new InstancedField('pines', pineV, pineMat, { loDist: 260 });
  const spruceTrunks = new InstancedField('spruce-trunks', spruceV.map((v) => ({ hi: v.hi.trunk, lo: v.lo.trunk })), spruceTrunkMat, { loDist: 200 });
  const spruceNeedles = new InstancedField('spruce', spruceV.map((v) => ({ hi: v.hi.needles, lo: v.lo.needles })), needleMat, { loDist: 330 });

  const birchCrownItems = [], tuftItems = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), tp = new THREE.Vector3();
  const td = quality.treeDensity;

  const blocked = (x, z, r) => exclusions.some((ex) => (x - ex.x) ** 2 + (z - ex.z) ** 2 < (ex.r + r) ** 2);
  const common = (x, z) => {
    if (lakeFactor(x, z) < 1.18) return 0;
    const sl = slopeAt(x, z);
    if (sl > 0.75) return 0;
    const lane = 0.25 + 0.75 * smoothstep(12, 60, Math.abs(x - centerX(z)));
    return lane * (1 - smoothstep(0.55, 0.75, sl));
  };

  const place = (x, z, tilt, scale) => {
    const y = heightAt(x, z) - 0.4;
    e.set((rnd() - 0.5) * tilt, rnd() * Math.PI * 2, (rnd() - 0.5) * tilt);
    q.setFromEuler(e);
    sc.setScalar(scale);
    m.compose(tp.set(x, y, z), q, sc);
    return m;
  };

  // birches: groves with glades
  scatterGrid(rnd, 9, (x, z) => {
    const zone = zoneWeight('birches', x, z) * 0.95 + zoneWeight('summit', x, z) * 0.18 +
      zoneWeight('stones', x, z) * 0.16 + zoneWeight('spruce', x, z) * 0.07 + zoneWeight('pines', x, z) * 0.06;
    const grove = smoothstep(-0.25, 0.25, fbm(N, x / 150, z / 150, 3));
    return zone * grove * common(x, z) * td;
  }, (x, z) => {
    if (blocked(x, z, 4)) return;
    const v = Math.floor(rnd() * birchV.length);
    const summit = zoneWeight('summit', x, z);
    const scale = (0.8 + rnd() * 0.45) * (1 - summit * 0.25);
    const mm = place(x, z, 0.12 + summit * 0.2, scale);
    birches.add(v, mm);
    const tint = rnd();
    for (const c of birchV[v].crowns) {
      const wp = c.p.clone().applyMatrix4(mm);
      birchCrownItems.push({ x: wp.x, y: wp.y, z: wp.z, r: c.r * scale, squash: 0.95, var: tint * 0.8 + rnd() * 0.2, snow: 0.55 + rnd() * 0.45 });
    }
  });

  // spruces: dense forest with lanes and clearings
  scatterGrid(rnd, 8.5, (x, z) => {
    const zone = zoneWeight('spruce', x, z) * 0.95 + zoneWeight('pines', x, z) * 0.12 +
      zoneWeight('stones', x, z) * 0.06 + zoneWeight('birches', x, z) * 0.07 + zoneWeight('summit', x, z) * 0.03;
    const clear = smoothstep(-0.35, 0.15, fbm(N2, x / 120, z / 120, 3));
    return zone * clear * common(x, z) * td;
  }, (x, z) => {
    if (blocked(x, z, 4)) return;
    const v = Math.floor(rnd() * spruceV.length);
    const mm = place(x, z, 0.06, 0.7 + rnd() * 0.6);
    spruceTrunks.add(v, mm);
    spruceNeedles.add(v, mm);
  });

  // pines: tall, sparse
  scatterGrid(rnd, 12, (x, z) => {
    const zone = zoneWeight('pines', x, z) * 0.85 + zoneWeight('spruce', x, z) * 0.1 + zoneWeight('stones', x, z) * 0.05;
    const grove = smoothstep(-0.3, 0.3, fbm(N, x / 110 + 40, z / 110, 3));
    return zone * grove * common(x, z) * td;
  }, (x, z) => {
    if (blocked(x, z, 4)) return;
    const v = Math.floor(rnd() * pineV.length);
    const scale = 0.85 + rnd() * 0.35;
    const mm = place(x, z, 0.16, scale);
    pines.add(v, mm);
    const tint = rnd();
    for (const c of pineV[v].crowns) {
      const wp = c.p.clone().applyMatrix4(mm);
      tuftItems.push({ x: wp.x, y: wp.y, z: wp.z, r: c.r * scale, squash: c.squash, var: tint, snow: 0.6 + rnd() * 0.4 });
    }
  });

  const group = new THREE.Group();
  group.add(birches.build(), pines.build(), spruceTrunks.build(), spruceNeedles.build());
  group.add(birchCrowns.build(birchCrownItems), tuftCrowns.build(tuftItems));
  scene.add(group);

  const fields = [birches, pines, spruceTrunks, spruceNeedles];
  return {
    group,
    birchCrowns,
    tuftCrowns,
    needleMat,
    birchMat,
    pineMat,
    spruceTrunkMat,
    counts: {
      birches: birches.items.length, spruces: spruceNeedles.items.length, pines: pines.items.length,
      crowns: birchCrownItems.length + tuftItems.length,
    },
    update(camPos) { for (const f of fields) f.update(camPos); },
  };
}
