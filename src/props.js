// Rocks, wedges, fallen logs, stumps, landmarks and the frozen lake.
import * as THREE from 'three';
import { SEED, MAP } from './config.js';
import { mulberry32, makeNoise2D, fbm, smoothstep } from './noise.js';
import { heightAt, slopeAt, centerX, zoneWeight, lakeFactor, LAKE, normalAt } from './terrain.js';
import { prep, merge, limb, rockGeometry } from './geomutil.js';
import { InstancedField } from './field.js';
import { stylize, U, FOG_GLSL } from './shading.js';
import { makeBirchBark } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Places of the big landmarks; trees keep clear of them. */
export function planLandmarks() {
  const gz = 40, bz = 575, tz = -1040;
  return {
    gate: { x: centerX(gz) + 10, z: gz, r: 16 },
    bridge: { x: centerX(bz), z: bz, r: 26 },
    tooth: { x: centerX(tz) + 150, z: tz, r: 14 },
    exclusions() { return [this.gate, this.bridge, this.tooth]; },
  };
}

function logGeometry(rnd, len, r, lo) {
  const g = new THREE.CylinderGeometry(r, r * 0.92, len, lo ? 7 : 12, lo ? 1 : 4, false);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len / 5);
  g.rotateZ(Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getX(i) / len;
    p.setY(i, p.getY(i) + Math.sin(t * 3.1 + rnd()) * 0.0);
  }
  g.computeVertexNormals();
  return prep(g, (ny) => (ny > 0.5 ? 1 : 0));
}

function stumpGeometry(rnd, h, r) {
  const g = new THREE.CylinderGeometry(r * 0.9, r, h, 8, 3, false);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  // jagged broken top
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > h - 0.01) p.setY(i, h + (rnd() - 0.5) * r * 1.6);
    uv.setY(i, uv.getY(i) * h / 5);
  }
  g.computeVertexNormals();
  return prep(g, (ny) => (ny > 0.6 ? 1 : 0));
}

export function buildProps(quality, scene, landmarks) {
  const rnd = mulberry32(SEED + 1300);
  const N = makeNoise2D(SEED + 1301);
  const group = new THREE.Group();

  const rockMat = stylize(new THREE.MeshLambertMaterial({ color: 0x232a55, flatShading: true }), { snow: true, rim: 0.22 });
  const barkMat = stylize(new THREE.MeshLambertMaterial({ map: makeBirchBark(21) }), { snow: true, rim: 0.12 });

  // ---------------- rock variants: boulders and wedges
  const rockV = [];
  for (let i = 0; i < 4; i++) {
    const r = mulberry32(SEED + 1400 + i);
    rockV.push({
      hi: rockGeometry(r, { detail: 1, sx: 1.2, sy: 0.75, sz: 1.0, jag: 0.3 }),
      lo: rockGeometry(mulberry32(SEED + 1400 + i), { detail: 0, sx: 1.2, sy: 0.75, sz: 1.0, jag: 0.3 }),
    });
  }
  for (let i = 0; i < 4; i++) {
    const r = mulberry32(SEED + 1450 + i);
    const g = rockGeometry(r, { detail: 0, sx: 0.55, sy: 1.6, sz: 1.3, jag: 0.22, snowTop: 0.8 });
    rockV.push({ hi: g, lo: g });
  }
  const rocks = new InstancedField('rocks', rockV, rockMat, { loDist: 300 });

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const clearOf = (x, z, r) => landmarks.exclusions().every((ex) => (x - ex.x) ** 2 + (z - ex.z) ** 2 > (ex.r + r) ** 2);
  const colliders = []; // { x, z, r, top, kind }
  const logList = []; // { a: Vector3, b: Vector3, r } axis end points and radius
  const addRock = (x, z, size, wedge, sink = 0.35) => {
    const v = wedge ? 4 + Math.floor(rnd() * 4) : Math.floor(rnd() * 4);
    const n = normalAt(x, z);
    const y = heightAt(x, z) - size * sink;
    if (wedge) e.set((rnd() - 0.5) * 0.9, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.9);
    else e.set((rnd() - 0.5) * 0.4 + n.z * 0.4, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.4 - n.x * 0.4);
    q.setFromEuler(e);
    s.set(size * (0.8 + rnd() * 0.4), size * (0.7 + rnd() * 0.5), size * (0.8 + rnd() * 0.4));
    rocks.add(v, m.compose(p.set(x, y, z), q, s));
    const top = y + s.y * (wedge ? 1.5 : 0.85);
    if (top - heightAt(x, z) > 0.5) {
      colliders.push({ x, z, r: Math.max(s.x, s.z) * (wedge ? 0.75 : 1.05), top, kind: 'rock' });
    }
  };

  // scattered rocks by zone
  const cell = 14;
  for (let z = -MAP.halfZ; z < MAP.halfZ; z += cell) {
    for (let x = -MAP.halfX; x < MAP.halfX; x += cell) {
      const px = x + rnd() * cell, pz = z + rnd() * cell;
      if (lakeFactor(px, pz) < 1.15) continue;
      const cluster = smoothstep(0.15, 0.55, fbm(N, px / 90, pz / 90, 3));
      const zone = zoneWeight('stones', px, pz) * 0.5 + zoneWeight('summit', px, pz) * 0.22 +
        zoneWeight('birches', px, pz) * 0.06 + zoneWeight('spruce', px, pz) * 0.05 + zoneWeight('pines', px, pz) * 0.03;
      const steep = smoothstep(0.45, 0.8, slopeAt(px, pz));
      const lane = smoothstep(6, 30, Math.abs(px - centerX(pz)));
      const d = (zone * cluster + steep * 0.08) * lane;
      if (rnd() > d) continue;
      if (!clearOf(px, pz, 4)) continue;
      const wedge = rnd() < 0.35 + zoneWeight('stones', px, pz) * 0.2;
      const size = wedge ? 2 + rnd() * 4 : 1.3 + Math.pow(rnd(), 2) * 5;
      addRock(px, pz, size, wedge);
      // little satellites
      const k = rnd() < 0.4 ? 1 + Math.floor(rnd() * 2) : 0;
      for (let i = 0; i < k; i++) addRock(px + (rnd() - 0.5) * size * 3, pz + (rnd() - 0.5) * size * 3, size * (0.3 + rnd() * 0.3), false);
    }
  }

  // ---------------- logs and stumps
  const logV = [], stumpV = [];
  for (let i = 0; i < 4; i++) {
    const r = mulberry32(SEED + 1500 + i);
    const len = 7 + r() * 8, rad = 0.45 + r() * 0.4;
    logV.push({ hi: logGeometry(r, len, rad, false), lo: logGeometry(r, len, rad, true), len, rad });
  }
  for (let i = 0; i < 3; i++) {
    const r = mulberry32(SEED + 1550 + i);
    const g = stumpGeometry(r, 1.2 + r() * 3, 0.25 + r() * 0.15);
    stumpV.push({ hi: g, lo: g });
  }
  const logs = new InstancedField('logs', logV, barkMat, { loDist: 250 });
  const stumps = new InstancedField('stumps', stumpV, barkMat, { loDist: 200 });
  for (let i = 0; i < 2600; i++) {
    const x = (rnd() * 2 - 1) * MAP.halfX, z = (rnd() * 2 - 1) * MAP.halfZ;
    if (lakeFactor(x, z) < 1.2 || slopeAt(x, z) > 0.6 || !clearOf(x, z, 8)) continue;
    const w = zoneWeight('stones', x, z) * 0.5 + zoneWeight('birches', x, z) * 0.35 + zoneWeight('spruce', x, z) * 0.18 + zoneWeight('pines', x, z) * 0.18;
    if (rnd() > w * 0.6) continue;
    if (Math.abs(x - centerX(z)) < 10) continue;
    if (rnd() < 0.55) {
      const v = Math.floor(rnd() * logV.length);
      const yaw = rnd() * Math.PI;
      const half = logV[v].len / 2;
      const ax = x - Math.cos(yaw) * half, az = z + Math.sin(yaw) * half;
      const bx = x + Math.cos(yaw) * half, bz = z - Math.sin(yaw) * half;
      const ha = heightAt(ax, az), hb = heightAt(bx, bz);
      const pitch = Math.atan2(hb - ha, logV[v].len);
      e.set(0, yaw, pitch, 'YZX');
      q.setFromEuler(e);
      const y = (ha + hb) / 2 + 0.1;
      logs.add(v, m.compose(p.set(x, y, z), q, s.setScalar(1)));
      const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      logList.push({
        a: new THREE.Vector3(x, y, z).addScaledVector(axis, -half),
        b: new THREE.Vector3(x, y, z).addScaledVector(axis, half),
        r: logV[v].rad,
      });
    } else {
      const v = Math.floor(rnd() * stumpV.length);
      e.set((rnd() - 0.5) * 0.25, rnd() * 6.28, (rnd() - 0.5) * 0.25);
      q.setFromEuler(e);
      const k = 0.9 + rnd() * 0.5;
      stumps.add(v, m.compose(p.set(x, heightAt(x, z) - 0.3, z), q, s.setScalar(k)));
      colliders.push({ x, z, r: 0.3 * k, top: heightAt(x, z) + 1.2 * k, kind: 'stump' });
    }
  }

  // ---------------- landmark 1: two leaning slabs forming a pointed gate
  {
    const { x, z } = landmarks.gate;
    const r = mulberry32(SEED + 1600);
    const slabGeo = rockGeometry(r, { detail: 1, sx: 2.0, sy: 9.5, sz: 0.85, jag: 0.1, snowTop: 0.55 });
    const h = heightAt(x, z);
    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(slabGeo, rockMat);
      mesh.position.set(x + side * 5.4, h + 6.5, z + side * 0.6);
      mesh.rotation.set(0.05 * side, 0.12 * side, side * 0.42);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      for (let k = 0; k < 3; k++) {
        colliders.push({ x: x + side * (7.2 - k * 1.2), z: z + side * 0.6, r: 1.6, top: h + 3 + k * 4, kind: 'rock' });
      }
    }
    // a capstone wedged between the tops
    const cap = new THREE.Mesh(rockGeometry(r, { detail: 0, sx: 2.6, sy: 1.4, sz: 1.6, jag: 0.2 }), rockMat);
    cap.position.set(x, h + 14.6, z + 0.3);
    cap.rotation.set(0.3, 0.6, 0.2);
    cap.castShadow = cap.receiveShadow = true;
    group.add(cap);
    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2, d = 9 + r() * 10;
      addRock(x + Math.cos(a) * d, z + Math.sin(a) * d, 1 + r() * 2.2, r() < 0.5);
    }
  }

  // ---------------- landmark 2: giant fallen trunk resting on two rock piers
  {
    const { x, z } = landmarks.bridge;
    const r = mulberry32(SEED + 1700);
    const span = 36;
    const hl = heightAt(x - span / 2, z), hr = heightAt(x + span / 2, z);
    const pierH = 7.5;
    for (const side of [-1, 1]) {
      const px = x + side * (span / 2 - 3);
      const base = heightAt(px, z);
      colliders.push({ x: px, z, r: 3.2, top: base + pierH + 1, kind: 'rock' });
      for (let k = 0; k < 4; k++) {
        const rk = new THREE.Mesh(rockGeometry(r, { detail: 1, sx: 3.2 - k * 0.4, sy: 2.4, sz: 3.0 - k * 0.3, jag: 0.25 }), rockMat);
        rk.position.set(px + (r() - 0.5) * 1.2, base + 1 + k * 2.1, z + (r() - 0.5) * 1.2);
        rk.rotation.set(r() * 0.5, r() * 6, r() * 0.5);
        rk.castShadow = rk.receiveShadow = true;
        group.add(rk);
      }
    }
    const yl = hl + pierH + 1.4, yr = hr + pierH + 1.4;
    const len = span + 14;
    const g = new THREE.CylinderGeometry(1.25, 1.45, len, 18, 6, false);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len / 7);
    g.rotateZ(Math.PI / 2);
    g.computeVertexNormals();
    const trunk = new THREE.Mesh(prep(g, (ny) => (ny > 0.45 ? 1 : 0)), barkMat);
    trunk.position.set(x + 3, (yl + yr) / 2, z);
    trunk.rotation.set(0, 0.08, Math.atan2(yr - yl, span));
    trunk.castShadow = trunk.receiveShadow = true;
    group.add(trunk);
    {
      const axis = new THREE.Vector3(1, 0, 0).applyEuler(trunk.rotation);
      logList.push({
        a: trunk.position.clone().addScaledVector(axis, -len / 2),
        b: trunk.position.clone().addScaledVector(axis, len / 2),
        r: 1.35,
      });
    }
    // broken crown end: a few snapped branches
    for (let i = 0; i < 4; i++) {
      const a = V(x - len / 2 + 6 + i * 2.5, (yl + yr) / 2 + 0.6, z + (r() - 0.5));
      const b = a.clone().add(V((r() - 0.5) * 2, 2 + r() * 2.5, (r() - 0.5) * 3));
      const br = new THREE.Mesh(prep(limb(a, b, 0.25, 0.1, 6, 0.3), 0), barkMat);
      br.castShadow = true;
      group.add(br);
    }
  }

  // ---------------- landmark 3: lone rock tooth on the summit shoulder
  {
    const { x, z } = landmarks.tooth;
    const r = mulberry32(SEED + 1800);
    const h = heightAt(x, z);
    const tooth = new THREE.Mesh(rockGeometry(r, { detail: 1, sx: 4.5, sy: 16, sz: 4.0, jag: 0.18, snowTop: 0.5 }), rockMat);
    tooth.position.set(x, h + 9, z);
    tooth.rotation.set(0.12, 0.7, -0.18);
    tooth.castShadow = tooth.receiveShadow = true;
    group.add(tooth);
    colliders.push({ x, z, r: 4.5, top: h + 22, kind: 'rock' });
    for (let i = 0; i < 10; i++) {
      const a = r() * Math.PI * 2, d = 7 + r() * 16;
      addRock(x + Math.cos(a) * d, z + Math.sin(a) * d, 1.2 + r() * 3.5, r() < 0.4);
    }
  }

  group.add(rocks.build(), logs.build(), stumps.build());

  // ---------------- frozen lake
  const ice = buildIce();
  group.add(ice.mesh);

  scene.add(group);
  const fields = [rocks, logs, stumps];
  return {
    group, rockMat, barkMat, ice, colliders, logs: logList,
    counts: { rocks: rocks.items.length, logs: logs.items.length, stumps: stumps.items.length },
    update(camPos) { for (const f of fields) f.update(camPos); },
  };
}

function buildIce() {
  const geo = new THREE.CircleGeometry(1, 96);
  geo.rotateX(-Math.PI / 2);
  geo.scale(LAKE.rx * 1.05, 1, LAKE.rz * 1.05);
  geo.translate(LAKE.x, LAKE.level, LAKE.z);
  const uniforms = {
    ...U,
    uIce: { value: new THREE.Color(0x7fb6e8) },
    uIceDeep: { value: new THREE.Color(0x24427a) },
    uSky: { value: new THREE.Color(0x9cc4ff) },
    uLake: { value: new THREE.Vector4(LAKE.x, LAKE.z, LAKE.rx, LAKE.rz) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWP = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uIce;
      uniform vec3 uIceDeep;
      uniform vec3 uSky;
      uniform vec3 uSnowColor;
      uniform vec3 uSunColor;
      uniform float uSunIntensity;
      uniform vec3 uHemiSky;
      uniform float uHemiIntensity;
      uniform vec4 uLake;
      varying vec3 vWP;
      ${FOG_GLSL}
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.07; a *= 0.5; } return s; }
      void main() {
        vec2 q = (vWP.xz - uLake.xy) / uLake.zw;
        float e = length(q);
        vec3 V = normalize(cameraPosition - vWP);
        float fres = pow(1.0 - max(V.y, 0.0), 4.0);
        float depth = smoothstep(1.0, 0.2, e);
        vec3 col = mix(uIce, uIceDeep, depth * 0.8 + fbm(vWP.xz * 0.02) * 0.3);
        // cracks
        float c1 = abs(fbm(vWP.xz * 0.035) - 0.5);
        float c2 = abs(fbm(vWP.xz * 0.11 + 7.0) - 0.5);
        float crack = (1.0 - smoothstep(0.0, 0.012, c1)) * 0.8 + (1.0 - smoothstep(0.0, 0.01, c2)) * 0.45;
        col = mix(col, vec3(1.0), crack * 0.55);
        vec3 lit = (uSunColor * uSunIntensity * max(uSunDir.y, 0.0) + uHemiSky * uHemiIntensity) / 3.14159;
        col *= lit * 1.2;
        // sky reflection and a soft sun streak
        vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
        col = mix(col, fogTint(R) * 1.0, fres * 0.85);
        col += uSunColor * pow(max(dot(R, uSunDir), 0.0), 60.0) * uSunIntensity * 0.25;
        // drifted snow patches and the shore
        float drift = smoothstep(0.58, 0.72, fbm(vWP.xz * 0.012 + vec2(3.0, 1.0)) + smoothstep(0.75, 1.02, e) * 0.6);
        vec3 snow = uSnowColor * (uSunColor * uSunIntensity * max(uSunDir.y, 0.0) + uHemiSky * uHemiIntensity) / 3.14159;
        col = mix(col, snow, drift);
        col = applyFog(col, vWP);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'lake';
  return { mesh, uniforms };
}
