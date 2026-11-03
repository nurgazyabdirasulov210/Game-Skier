// Camera rig: chase, first person and a cinematic "drone" that leapfrogs ahead.
import * as THREE from '../vendor/three.module.js';
import { heightAt } from './terrain.js';
import { clamp, lerp } from './noise.js';

export const CAM_MODES = ['Сзади', 'От первого лица', 'Дрон'];

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.mode = 0;
    this.dir = new THREE.Vector3(0, 0, -1);
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.fov = 65;
    this.anchor = null;
    this.roll = 0;
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this.first = true;
  }

  /** 0..1: how clear the line of sight from a to b is (terrain and trees). */
  clearance(a, b) {
    let ok = 1;
    for (let i = 1; i < 10; i++) {
      const t = i / 10;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y + 1 - a.y) * t;
      if (heightAt(x, z) > y - 0.3) ok -= 0.25;
      if (this.world) {
        for (const ch of this.world.nearChunks(x, z, 0)) {
          for (const c of ch.colliders) {
            if (c.kind !== 'tree' && c.kind !== 'cabin') continue;
            if (Math.abs(c.x - x) < c.r + 2.2 && Math.abs(c.z - z) < c.r + 2.2 && y < c.y + c.h) { ok -= 0.2; break; }
          }
        }
      }
    }
    return ok;
  }

  /** Penalty for parking the drone inside a tree crown. */
  crowded(a) {
    if (!this.world) return 0;
    let pen = 0;
    for (const ch of this.world.nearChunks(a.x, a.z, 1)) {
      for (const c of ch.colliders) {
        if (c.kind !== 'tree') continue;
        const d = Math.hypot(c.x - a.x, c.z - a.z);
        if (d < c.r + 3.5 && a.y < c.y + c.h + 1) pen += 0.6;
      }
    }
    return pen;
  }

  next() { this.mode = (this.mode + 1) % CAM_MODES.length; this.anchor = null; this.first = true; return CAM_MODES[this.mode]; }
  kick(a) { this.shake = Math.min(1.2, this.shake + a); }

  update(dt, pl, skier) {
    const cam = this.cam;
    const sp = pl.speed;
    // smoothed travel direction (horizontal)
    const hv = this._v.set(pl.vel.x, 0, pl.vel.z);
    if (hv.lengthSq() > 2.5 && pl.mode !== 'crash') {
      hv.normalize();
      const k = pl.inAir ? 1.5 : 3.2;
      this.dir.lerp(hv, 1 - Math.exp(-dt * k)).normalize();
    } else if (pl.mode !== 'crash' && sp < 1.5) {
      const f = this._w.set(-Math.sin(pl.yaw), 0, -Math.cos(pl.yaw));
      this.dir.lerp(f, 1 - Math.exp(-dt * 2)).normalize();
    }
    const fpMode = this.mode === 1;
    skier.setFirstPerson(fpMode && pl.mode !== 'crash');

    let targetFov = 62;
    if (this.mode === 0 || (fpMode && pl.mode === 'crash')) {
      const glide = pl.gliding ? 1 : 0;
      const dist = lerp(4.4 + clamp(sp, 0, 35) * 0.075, 10, glide) + (pl.mode === 'crash' ? 2 : 0);
      const hgt = lerp(1.6 + clamp(sp, 0, 35) * 0.022, 3.8, glide);
      const target = this._w.copy(pl.pos);
      target.y += 1.1 - pl.sink * 0.5;
      const desired = new THREE.Vector3().copy(target).addScaledVector(this.dir, -dist);
      desired.y += hgt;
      const gh = Math.max(heightAt(desired.x, desired.z), heightAt((desired.x + target.x) / 2, (desired.z + target.z) / 2) - 0.3);
      if (desired.y < gh + 1.1) desired.y = gh + 1.1;
      if (this.first) { this.pos.copy(desired); this.first = false; this.snapLook = true; }
      this.pos.lerp(desired, 1 - Math.exp(-dt * (pl.inAir ? 5 : 9)));
      if (this.pos.y < heightAt(this.pos.x, this.pos.z) + 0.8) this.pos.y = heightAt(this.pos.x, this.pos.z) + 0.8;
      const look = this._v.copy(target).addScaledVector(this.dir, 5.5);
      look.y -= 0.9 + (pl.gliding ? 1.5 : 0);
      if (this.snapLook) { this.look.copy(look); this.snapLook = false; }
      this.look.lerp(look, 1 - Math.exp(-dt * 12));
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      this.roll = lerp(this.roll, pl.mode === 'crash' ? 0 : -pl.lean * 0.12, 1 - Math.exp(-dt * 4));
      cam.rotateZ(this.roll);
      targetFov = 60 + clamp(sp - 6, 0, 30) * 0.6;
      cam.near = 0.1;
    } else if (fpMode) {
      const head = skier.headWorld(this._w);
      const q = skier.root.quaternion;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      this.pos.copy(head).addScaledVector(fwd, -0.3).addScaledVector(up, 0.22);
      cam.position.copy(this.pos);
      const look = this._v.copy(this.pos).addScaledVector(fwd, 10).addScaledVector(up, -6.4);
      if (this.first) { this.look.copy(look); this.first = false; }
      this.look.lerp(look, 1 - Math.exp(-dt * 14));
      cam.up.lerp(up, 1 - Math.exp(-dt * 10)).normalize();
      cam.lookAt(this.look);
      targetFov = 78 + clamp(sp - 8, 0, 30) * 0.45;
      cam.near = 0.05;
    } else {
      // drone: park ahead of the rider, track them as they fly past
      const p = pl.pos;
      const needNew = !this.anchor || this.anchor.distanceTo(p) > 95 ||
        this._v.subVectors(p, this.anchor).dot(this.dir) > 22;
      if (needNew) {
        const right = new THREE.Vector3(-this.dir.z, 0, this.dir.x);
        let best = null, bestScore = -1e9;
        for (let tries = 0; tries < 8; tries++) {
          const side = Math.random() < 0.5 ? -1 : 1;
          const ahead = 28 + sp * 1.3 + Math.random() * 10;
          const a = new THREE.Vector3().copy(p).addScaledVector(this.dir, ahead).addScaledVector(right, side * (5 + Math.random() * 11));
          a.y = heightAt(a.x, a.z) + 3 + Math.random() * 6;
          const future = new THREE.Vector3().copy(p).addScaledVector(pl.vel, 1.2);
          future.y = heightAt(future.x, future.z);
          const score = this.clearance(a, p) + this.clearance(a, future) - this.crowded(a);
          if (score > bestScore) { bestScore = score; best = a; }
          if (score > 1.99) break;
        }
        this.anchor = best;
        this.pos.copy(this.anchor);
        this.look.copy(p);
      }
      this.pos.lerp(this.anchor, 1 - Math.exp(-dt * 2));
      const minY = heightAt(this.pos.x, this.pos.z) + 1;
      if (this.pos.y < minY) this.pos.y = minY;
      cam.position.copy(this.pos);
      const tgt = this._v.copy(p); tgt.y += 1;
      this.look.lerp(tgt, 1 - Math.exp(-dt * 8));
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      const d = this.pos.distanceTo(p);
      targetFov = clamp(2000 / (d + 20), 22, 60);
      cam.near = 0.1;
    }
    // shake
    if (this.shake > 0.001) {
      const s = this.shake * 0.08;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.rotateZ((Math.random() - 0.5) * s * 0.3);
      this.shake *= Math.exp(-dt * 5);
    }
    // a constant speed tremble
    if (sp > 18 && !pl.inAir && this.mode !== 2) {
      const s = (sp - 18) * 0.0009;
      cam.position.y += (Math.random() - 0.5) * s;
    }
    this.fov = lerp(this.fov, targetFov, 1 - Math.exp(-dt * 3));
    if (Math.abs(cam.fov - this.fov) > 0.01 || cam.near !== this._near) {
      cam.fov = this.fov;
      this._near = cam.near;
      cam.updateProjectionMatrix();
    }
  }
}
