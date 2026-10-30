// Снежная пыль, следы лыж, снегопад.
import * as THREE from 'three';
import { particleMaterial, trailMaterial, snowfallMaterial } from './shaders.js';
import { meshHeight } from './terrain.js';

export class Powder {
  constructor(scene, max = 3500) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aLife = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aLife', this.aLife);
    g.setAttribute('aSize', this.aSize);
    this.points = new THREE.Points(g, particleMaterial);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, spread, size, life, n = 1) {
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.3;
      this.pos[i * 3 + 1] = y + Math.random() * 0.15;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
      this.vel[i * 3] = vx + (Math.random() - 0.5) * spread;
      this.vel[i * 3 + 1] = vy + Math.random() * spread * 0.8;
      this.vel[i * 3 + 2] = vz + (Math.random() - 0.5) * spread;
      this.maxLife[i] = this.life[i] = life * (0.6 + Math.random() * 0.8);
      this.size[i] = size * (0.5 + Math.random());
    }
  }

  update(dt) {
    const L = this.aLife.array;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { L[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3;
      const drag = Math.exp(-2.2 * dt);
      this.vel[k] *= drag; this.vel[k + 2] *= drag;
      this.vel[k + 1] = this.vel[k + 1] * drag - 3.5 * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] += dt * 0.9; // облачко расширяется
      L[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    this.aPos.needsUpdate = this.aLife.needsUpdate = this.aSize.needsUpdate = true;
  }
}

class Ribbon {
  constructor(scene, n = 700, width = 0.16) {
    this.n = n;
    this.width = width;
    this.count = 0;
    this.pos = new Float32Array(n * 2 * 3);
    this.alpha = new Float32Array(n * 2);
    const side = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aAlpha', this.aAlpha);
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, trailMaterial);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.last = null;
  }

  push(x, z, dirx, dirz, on) {
    // сдвигаем буфер на одну точку
    this.pos.copyWithin(0, 6);
    this.alpha.copyWithin(0, 2);
    const i = this.n - 1;
    const px = -dirz * this.width, pz = dirx * this.width;
    const y0 = meshHeight(x - px, z - pz) + 0.035, y1 = meshHeight(x + px, z + pz) + 0.035;
    this.pos.set([x - px, y0, z - pz, x + px, y1, z + pz], i * 6);
    const a = on ? 1 : 0;
    this.alpha[i * 2] = this.alpha[i * 2 + 1] = a;
    if (!on) { this.alpha[(i - 1) * 2] = this.alpha[(i - 1) * 2 + 1] = 0; }
    // плавное затухание хвоста
    for (let k = 0; k < 40; k++) { this.alpha[k * 2] *= k / 40; this.alpha[k * 2 + 1] *= k / 40; }
    this.aPos.needsUpdate = this.aAlpha.needsUpdate = true;
  }

  reset() { this.alpha.fill(0); this.aAlpha.needsUpdate = true; this.last = null; }
}

export class Trails {
  constructor(scene) {
    this.r = [new Ribbon(scene), new Ribbon(scene)];
    this.lastX = null; this.lastZ = null;
    this.wasOn = false;
  }
  update(x, z, heading, on) {
    if (this.lastX !== null && Math.hypot(x - this.lastX, z - this.lastZ) < 0.45 && on === this.wasOn) return;
    const dx = Math.sin(heading), dz = Math.cos(heading);
    const rx = -dz * 0.15, rz = dx * 0.15;
    this.r[0].push(x + rx, z + rz, dx, dz, on && this.wasOn);
    this.r[1].push(x - rx, z - rz, dx, dz, on && this.wasOn);
    this.lastX = x; this.lastZ = z; this.wasOn = on;
  }
  reset() { this.r.forEach((r) => r.reset()); this.lastX = null; }
}

export class Snowfall {
  constructor(scene, n = 5000) {
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = Math.random() * 50; pos[i * 3 + 1] = Math.random() * 50; pos[i * 3 + 2] = Math.random() * 50;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.points = new THREE.Points(g, snowfallMaterial);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }
  update(center, amount) {
    snowfallMaterial.uniforms.uCenter.value.copy(center);
    snowfallMaterial.uniforms.uAmount.value = amount;
    this.points.visible = amount > 0.01;
  }
}
