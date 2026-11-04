// Powder spray: chunky lit snow clumps (instanced low-poly balls) and soft
// dust puffs. Emitted from the skis, on landings and on crashes.
import * as THREE from 'three';
import { U, FOG_GLSL, stylize } from '../shading.js';

export class Spray {
  constructor(surfaceAt, maxClumps = 900, maxDust = 1400) {
    this.surfaceAt = surfaceAt;
    // clumps
    this.n = maxClumps;
    this.cp = new Float32Array(maxClumps * 3);
    this.cv = new Float32Array(maxClumps * 3);
    this.cl = new Float32Array(maxClumps);      // life left
    this.cL = new Float32Array(maxClumps).fill(1);
    this.cs = new Float32Array(maxClumps);      // size
    this.cr = new Float32Array(maxClumps * 3);  // rotation
    this.ci = 0;
    this.snowMat = stylize(new THREE.MeshLambertMaterial({ color: 0xffffff }), { rim: 0.4 });
    this.clumps = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.snowMat, maxClumps);
    this.clumps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.clumps.frustumCulled = false;
    this.clumps.castShadow = true;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < maxClumps; i++) this.clumps.setMatrixAt(i, zero);

    // dust
    this.d = maxDust;
    this.dp = new Float32Array(maxDust * 3);
    this.dv = new Float32Array(maxDust * 3);
    this.dlife = new Float32Array(maxDust);
    this.dmax = new Float32Array(maxDust).fill(1);
    this.dsize = new Float32Array(maxDust);
    this.di = 0;
    const g = new THREE.BufferGeometry();
    this.aDP = new THREE.BufferAttribute(this.dp, 3).setUsage(THREE.DynamicDrawUsage);
    this.aDL = new THREE.BufferAttribute(new Float32Array(maxDust * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aDP);
    g.setAttribute('aLife', this.aDL);
    this.dustUniforms = { ...U, uPixel: { value: 1 } };
    this.dust = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.dustUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec2 aLife; // x: age 0..1, y: size
        uniform float uPixel;
        varying float vA;
        varying vec3 vWP;
        void main() {
          vec4 mv = viewMatrix * vec4(position, 1.0);
          vWP = position;
          gl_Position = projectionMatrix * mv;
          float age = aLife.x;
          gl_PointSize = uPixel * aLife.y * (0.5 + age * 1.4) * 380.0 / max(-mv.z, 0.6);
          vA = (aLife.y > 0.0 ? 1.0 : 0.0) * smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.35, 1.0, age));
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunColor;
        uniform float uSunIntensity;
        uniform vec3 uHemiSky;
        uniform float uHemiIntensity;
        uniform vec3 uSnowColor;
        varying float vA;
        varying vec3 vWP;
        ${FOG_GLSL}
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.1, d) * vA * 0.42;
          if (a < 0.01) discard;
          float shade = 0.75 + 0.35 * (0.5 - c.y);
          vec3 col = uSnowColor * (uSunColor * uSunIntensity * 0.75 * shade + uHemiSky * uHemiIntensity) / 3.14159;
          col = applyFog(col, vWP);
          gl_FragColor = vec4(col, a);
        }`,
    }));
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 3;
    this.group = new THREE.Group();
    this.group.add(this.clumps, this.dust);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.s = new THREE.Vector3();
    this.p = new THREE.Vector3();
  }

  clump(x, y, z, vx, vy, vz, size, life) {
    const i = this.ci;
    this.ci = (this.ci + 1) % this.n;
    this.cp.set([x, y, z], i * 3);
    this.cv.set([vx, vy, vz], i * 3);
    this.cl[i] = this.cL[i] = life;
    this.cs[i] = size;
    this.cr.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
  }

  puff(x, y, z, vx, vy, vz, size, life) {
    const i = this.di;
    this.di = (this.di + 1) % this.d;
    this.dp.set([x, y, z], i * 3);
    this.dv.set([vx, vy, vz], i * 3);
    this.dlife[i] = 0;
    this.dmax[i] = life;
    this.dsize[i] = size;
  }

  /** Burst of snow around a point (landings, crashes). */
  burst(p, vel, strength) {
    const n = Math.floor(14 + strength * 26);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 3.5 * strength;
      this.clump(p.x + Math.cos(a) * 0.4, p.y + 0.2, p.z + Math.sin(a) * 0.4,
        Math.cos(a) * r + vel.x * 0.35, 2 + Math.random() * 4 * strength, Math.sin(a) * r + vel.z * 0.35,
        0.12 + Math.random() * 0.3 * (0.6 + strength), 0.9 + Math.random() * 0.8);
    }
    for (let i = 0; i < n * 1.2; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * 3;
      this.puff(p.x, p.y + 0.3, p.z, Math.cos(a) * r + vel.x * 0.3, 0.8 + Math.random() * 2.5, Math.sin(a) * r + vel.z * 0.3,
        0.6 + Math.random() * 0.9 * (0.5 + strength), 1.2 + Math.random() * 1.2);
    }
  }

  update(dt) {
    const G = 9.8;
    for (let i = 0; i < this.n; i++) {
      if (this.cl[i] <= 0) continue;
      this.cl[i] -= dt;
      const k = i * 3;
      const drag = Math.exp(-dt * 1.4);
      this.cv[k] *= drag; this.cv[k + 2] *= drag;
      this.cv[k + 1] = this.cv[k + 1] * drag - G * dt * 0.75;
      this.cp[k] += this.cv[k] * dt; this.cp[k + 1] += this.cv[k + 1] * dt; this.cp[k + 2] += this.cv[k + 2] * dt;
      const ground = this.surfaceAt(this.cp[k], this.cp[k + 2]) + this.cs[i] * 0.3;
      if (this.cp[k + 1] < ground) {
        this.cp[k + 1] = ground;
        this.cv[k] *= 0.4; this.cv[k + 2] *= 0.4; this.cv[k + 1] = 0;
        this.cl[i] = Math.min(this.cl[i], 0.35);
      }
      const t = this.cl[i] / this.cL[i];
      const sc = this.cs[i] * Math.min(1, t * 3) * (t > 0 ? 1 : 0);
      this.cr[k] += dt * 2;
      this.e.set(this.cr[k], this.cr[k + 1], this.cr[k + 2]);
      this.q.setFromEuler(this.e);
      this.s.set(sc, sc * 0.8, sc);
      this.m.compose(this.p.set(this.cp[k], this.cp[k + 1], this.cp[k + 2]), this.q, this.s);
      this.clumps.setMatrixAt(i, this.m);
    }
    this.clumps.instanceMatrix.needsUpdate = true;

    const life = this.aDL.array;
    for (let i = 0; i < this.d; i++) {
      if (this.dsize[i] <= 0) { life[i * 2 + 1] = 0; continue; }
      this.dlife[i] += dt / this.dmax[i];
      if (this.dlife[i] >= 1) { this.dsize[i] = 0; life[i * 2 + 1] = 0; continue; }
      const k = i * 3;
      const drag = Math.exp(-dt * 2.2);
      this.dv[k] *= drag; this.dv[k + 1] = this.dv[k + 1] * drag - 0.6 * dt; this.dv[k + 2] *= drag;
      this.dp[k] += this.dv[k] * dt; this.dp[k + 1] += this.dv[k + 1] * dt; this.dp[k + 2] += this.dv[k + 2] * dt;
      life[i * 2] = this.dlife[i];
      life[i * 2 + 1] = this.dsize[i];
    }
    this.aDP.needsUpdate = true;
    this.aDL.needsUpdate = true;
  }
}
