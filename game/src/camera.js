// Camera rigs: chase (default), wide, first person.
import * as THREE from 'three';
import { height } from './world.js';
import { clamp, damp, lerp } from './util.js';

export const CAM_MODES = ['Сзади', 'Издалека', 'От первого лица'];

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.dir = new THREE.Vector3(0, 0, 1);
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.fov = 62;
    this.orbit = 0;
    this.first = true;
  }

  next() { this.mode = (this.mode + 1) % CAM_MODES.length; this.first = true; return CAM_MODES[this.mode]; }

  update(dt, player) {
    const cam = this.camera;
    const p = player.pos;
    const v = player.vel;
    const hs = Math.hypot(v.x, v.z);
    // travel direction, smoothed; heading when slow
    const want = hs > 2 ? new THREE.Vector3(v.x / hs, 0, v.z / hs) : new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
    const k = player.state === 'crash' ? 0.3 : player.state === 'ground' ? 3.2 : 1.5;
    this.dir.lerp(want, 1 - Math.exp(-k * dt)).normalize();
    const speedK = clamp(player.speed / 30, 0, 1);

    if (this.mode === 2 && player.state !== 'crash') {
      // first person: eyes above the skis, looking down the track
      const R = player.rider;
      const head = new THREE.Vector3(0, 1.5 - R.pose.crouch * 0.3, 0.05);
      R.root.localToWorld(head);
      if (player.state !== 'ground') head.copy(p).add(new THREE.Vector3(0, 1.35, 0));
      cam.position.copy(head);
      const fwd = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
      const n = player.normal;
      fwd.addScaledVector(n, -fwd.dot(n)).normalize();
      if (player.state !== 'ground' && hs > 2) fwd.copy(v).normalize().lerp(this.dir, 0.5);
      const target = head.clone().addScaledVector(fwd, 8).addScaledVector(n, -2.1);
      if (this.first) this.look.copy(target);
      this.look.lerp(target, 1 - Math.exp(-10 * dt));
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      cam.rotateZ(player.lean * 0.35);
      this.fov = damp(this.fov, 84 + speedK * 8, 3, dt);
    } else {
      const far = this.mode === 1;
      const back = (far ? 10.5 : 4.6) + speedK * (far ? 2 : 1.2);
      const up = (far ? 4.6 : 2.0) + speedK * 0.4;
      const target = new THREE.Vector3().copy(p).addScaledVector(this.dir, -back);
      target.y = p.y + up;
      // keep above the snow behind the rider
      const g = height(target.x, target.z) + 1.1;
      if (target.y < g) target.y = g;
      if (this.first) { this.pos.copy(target); this.first = false; }
      const follow = player.state === 'ground' ? 9 : 5;
      this.pos.x = damp(this.pos.x, target.x, follow, dt);
      this.pos.z = damp(this.pos.z, target.z, follow, dt);
      this.pos.y = damp(this.pos.y, target.y, player.state === 'ground' ? 7 : 3, dt);
      const gy = height(this.pos.x, this.pos.z) + 0.8;
      if (this.pos.y < gy) this.pos.y = gy;
      cam.position.copy(this.pos);
      const lookT = new THREE.Vector3().copy(p).addScaledVector(this.dir, far ? 5 : 3.5);
      lookT.y += far ? 0.2 : 0.55;
      if (this.first) this.look.copy(lookT);
      this.look.lerp(lookT, 1 - Math.exp(-14 * dt));
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      this.fov = damp(this.fov, (far ? 55 : 64) + speedK * 12, 3, dt);
    }
    this.first = false;
    // shake
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * this.shake * 0.12;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
    }
    const jitter = player.state === 'ground' ? speedK * speedK * 0.012 : 0;
    cam.position.y += (Math.random() - 0.5) * jitter;
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }
}
