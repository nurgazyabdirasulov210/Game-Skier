// Snow effects: chunky clumps kicked out by the skis (they land and stay
// along the trench for a while) and a soft powder cloud.
import * as THREE from 'three';
import { height } from './world.js';
import { mulberry32 } from './util.js';

const MAX_CLUMPS = 2400;
const MAX_DUST = 2600;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();

function clumpGeo() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const r = mulberry32(3);
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = Math.round(p.getX(i) * 100) + ',' + Math.round(p.getY(i) * 100) + ',' + Math.round(p.getZ(i) * 100);
    let f = seen.get(k);
    if (!f) { f = 0.75 + r() * 0.45; seen.set(k, f); }
    p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.8, p.getZ(i) * f);
  }
  g.computeVertexNormals();
  return g;
}

export class SnowFX {
  constructor(scene) {
    this.rng = mulberry32(17);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    this.clumps = new THREE.InstancedMesh(clumpGeo(), this.mat, MAX_CLUMPS);
    this.clumps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.clumps.castShadow = true;
    this.clumps.receiveShadow = true;
    this.clumps.frustumCulled = false;
    this.clumps.count = 0;
    scene.add(this.clumps);
    this.c = [];
    for (let i = 0; i < MAX_CLUMPS; i++) this.c.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0, life: 0, max: 0, rest: false, rx: 0, ry: 0, rz: 0, spin: 0 });
    this.ci = 0;

    // powder cloud
    const g = new THREE.BufferGeometry();
    this.dPos = new Float32Array(MAX_DUST * 3);
    this.dDat = new Float32Array(MAX_DUST * 2);   // size, alpha
    g.setAttribute('position', new THREE.BufferAttribute(this.dPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aDat', new THREE.BufferAttribute(this.dDat, 2).setUsage(THREE.DynamicDrawUsage));
    this.dustUniforms = {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uShade: { value: new THREE.Color(0.6, 0.7, 1) },
      uScale: { value: 260 },
    };
    const dm = new THREE.ShaderMaterial({
      uniforms: this.dustUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */`
        attribute vec2 aDat; uniform float uScale; varying float vA; varying float vS;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(aDat.x * uScale / max(-mv.z, 0.5), 140.0);
          vA = aDat.y; vS = fract(position.x * 3.17 + position.z * 1.31);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform vec3 uShade; varying float vA; varying float vS;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.15, d) * vA;
          if (a < 0.01) discard;
          vec3 col = mix(uShade, uColor, clamp(0.55 - c.y * 1.2 + vS * 0.2, 0.0, 1.0));
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dust = new THREE.Points(g, dm);
    this.dust.frustumCulled = false;
    scene.add(this.dust);
    this.d = [];
    for (let i = 0; i < MAX_DUST; i++) this.d.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0, life: 0, max: 1, a: 0 });
    this.di = 0;
  }

  setMood(m) {
    this.mat.color.copy(m.snow);
    this.dustUniforms.uColor.value.copy(m.snow).multiplyScalar(m === undefined ? 1 : 1.0);
    this.dustUniforms.uShade.value.copy(m.hemiSky).lerp(m.snow, 0.45);
  }

  clump(x, y, z, vx, vy, vz, size, life = 3) {
    const c = this.c[this.ci];
    this.ci = (this.ci + 1) % MAX_CLUMPS;
    const r = this.rng;
    c.alive = true; c.rest = false;
    c.x = x; c.y = y; c.z = z; c.vx = vx; c.vy = vy; c.vz = vz;
    c.s = size; c.life = 0; c.max = life * (0.7 + r() * 0.6);
    c.rx = r() * 6; c.ry = r() * 6; c.rz = r() * 6; c.spin = (r() - 0.5) * 10;
  }

  puff(x, y, z, vx, vy, vz, size, life = 1.2, alpha = 0.6) {
    const d = this.d[this.di];
    this.di = (this.di + 1) % MAX_DUST;
    d.alive = true;
    d.x = x; d.y = y; d.z = z; d.vx = vx; d.vy = vy; d.vz = vz;
    d.s = size; d.life = 0; d.max = life; d.a = alpha;
  }

  // a burst (landing, crash, hitting a tree)
  burst(x, y, z, power, vx = 0, vz = 0) {
    const r = this.rng;
    const n = Math.floor(20 + power * 25);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, s = (0.4 + r()) * (2 + power * 3);
      this.clump(x + Math.cos(a) * 0.4, y + 0.1, z + Math.sin(a) * 0.4,
        Math.cos(a) * s + vx * 0.4, 2 + r() * (3 + power * 4), Math.sin(a) * s + vz * 0.4,
        0.05 + r() * 0.15 * (0.6 + power * 0.5), 4);
    }
    for (let i = 0; i < n * 0.8; i++) {
      const a = r() * Math.PI * 2, s = (0.3 + r()) * (1.5 + power * 2);
      this.puff(x, y + 0.3, z, Math.cos(a) * s + vx * 0.3, 1 + r() * 2.5, Math.sin(a) * s + vz * 0.3, 1.2 + r() * 1.6 * (0.5 + power), 1.4 + r(), 0.5);
    }
  }

  update(dt, camPos) {
    const r = this.rng;
    // clumps
    let n = 0;
    const im = this.clumps;
    for (let i = 0; i < MAX_CLUMPS; i++) {
      const c = this.c[i];
      if (!c.alive) continue;
      c.life += dt;
      if (c.life > c.max) { c.alive = false; continue; }
      if (!c.rest) {
        c.vy -= 9.8 * dt;
        const drag = Math.exp(-1.6 * dt);
        c.vx *= drag; c.vz *= drag;
        c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        c.rx += c.spin * dt; c.rz += c.spin * 0.7 * dt;
        const g = height(c.x, c.z) - c.s * 0.25;
        if (c.y < g) {
          c.y = g;
          if (Math.abs(c.vy) > 3 && r() < 0.3) { c.vy *= -0.25; c.vx *= 0.5; c.vz *= 0.5; }
          else { c.rest = true; c.max = Math.max(c.max, c.life + 4 + r() * 6); }
        }
      }
      // shrink at the end of life
      const k = Math.min(1, (c.max - c.life) / 0.8);
      const s = c.s * k;
      _e.set(c.rx, c.ry, c.rz);
      _q.setFromEuler(_e);
      _m.compose(_p.set(c.x, c.y, c.z), _q, _s.set(s, s, s));
      im.setMatrixAt(n++, _m);
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;

    // dust
    let m = 0;
    const P = this.dPos, D = this.dDat;
    for (let i = 0; i < MAX_DUST; i++) {
      const d = this.d[i];
      if (!d.alive) continue;
      d.life += dt;
      if (d.life > d.max) { d.alive = false; continue; }
      const drag = Math.exp(-2.2 * dt);
      d.vx *= drag; d.vz *= drag; d.vy = d.vy * drag - 0.6 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const t = d.life / d.max;
      P[m * 3] = d.x; P[m * 3 + 1] = d.y; P[m * 3 + 2] = d.z;
      D[m * 2] = d.s * (0.5 + t * 1.2);
      D[m * 2 + 1] = d.a * Math.min(1, t * 8) * (1 - t) * (1 - t);
      m++;
    }
    const g = this.dust.geometry;
    g.setDrawRange(0, m);
    g.attributes.position.needsUpdate = true;
    g.attributes.aDat.needsUpdate = true;
  }
}

// Glittering ice crystals drifting around the camera.
export class DiamondDust {
  constructor(scene) {
    const N = 900;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(N * 3);
    const r = mulberry32(8);
    for (let i = 0; i < N * 3; i++) p[i] = (r() - 0.5) * 50;
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.u = { uOff: { value: new THREE.Vector3() }, uTime: { value: 0 }, uAmt: { value: 1 }, uColor: { value: new THREE.Color(1, 1, 1) } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        uniform vec3 uOff; uniform float uTime; varying float vT;
        void main() {
          vec3 p = position;
          p.y -= uTime * 0.4; p.x += sin(uTime * 0.3 + position.z) * 0.6;
          p = mod(p - uOff + 25.0, 50.0) - 25.0 + uOff;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          vT = 0.5 + 0.5 * sin(uTime * 6.0 + position.x * 9.0 + position.y * 3.0);
          gl_PointSize = 26.0 / max(-mv.z, 1.0) * (0.5 + vT);
        }`,
      fragmentShader: /* glsl */`
        uniform float uAmt; uniform vec3 uColor; varying float vT;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(c)) * vT * uAmt;
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  update(t, camPos) {
    this.u.uTime.value = t;
    this.u.uOff.value.copy(camPos);
  }
}
