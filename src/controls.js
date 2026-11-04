// Free-flight camera (mouse + keyboard, or touch), smooth fly-to for
// viewpoints, and a low "ride" tour down the valley.
import * as THREE from 'three';
import { heightAt, centerX } from './terrain.js';
import { MAP } from './config.js';

export class FlyControls {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.yaw = 0;
    this.pitch = -0.15;
    this.speed = 30;
    this.keys = new Set();
    this.move = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.lookDelta = new THREE.Vector2();
    this.touchMove = new THREE.Vector2();
    this.touchUpDown = 0;
    this.tour = null;
    this.flight = null;
    this.onUserInput = null;
    this._bind();
  }

  _bind() {
    const d = this.dom;
    d.addEventListener('click', () => {
      if (!this.isTouch && document.pointerLockElement !== d) d.requestPointerLock?.();
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === d) {
        this.lookDelta.x += e.movementX;
        this.lookDelta.y += e.movementY;
        this._user();
      }
    });
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyQ', 'KeyE', 'KeyC'].includes(e.code)) this._user();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    d.addEventListener('wheel', (e) => {
      this.speed = THREE.MathUtils.clamp(this.speed * (e.deltaY > 0 ? 0.85 : 1.18), 3, 400);
      e.preventDefault();
    }, { passive: false });

    // touch: left half = move stick, right half = look
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    const touches = new Map();
    d.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        touches.set(t.identifier, { x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, left: t.clientX < innerWidth / 2 });
      }
      this._user();
      e.preventDefault();
    }, { passive: false });
    d.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        const s = touches.get(t.identifier);
        if (!s) continue;
        if (s.left) {
          this.touchMove.set((t.clientX - s.x0) / 60, (t.clientY - s.y0) / 60).clampLength(0, 1);
        } else {
          this.lookDelta.x += (t.clientX - s.x) * 2.2;
          this.lookDelta.y += (t.clientY - s.y) * 2.2;
        }
        s.x = t.clientX; s.y = t.clientY;
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        const s = touches.get(t.identifier);
        if (s?.left) this.touchMove.set(0, 0);
        touches.delete(t.identifier);
      }
    };
    d.addEventListener('touchend', end);
    d.addEventListener('touchcancel', end);
  }

  _user() {
    if (this.tour) this.stopTour();
    this.flight = null;
    this.onUserInput?.();
  }

  setPose(pos, target) {
    this.camera.position.copy(pos);
    const dir = new THREE.Vector3().subVectors(target, pos).normalize();
    this.yaw = Math.atan2(dir.x, dir.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
  }

  flyTo(pos, target, duration = 3) {
    this.stopTour();
    const dir = new THREE.Vector3().subVectors(target, pos).normalize();
    this.flight = {
      t: 0, duration,
      p0: this.camera.position.clone(), p1: pos.clone(),
      y0: this.yaw, y1: this.yaw + wrapAngle(Math.atan2(dir.x, dir.z) - this.yaw),
      a0: this.pitch, a1: Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)),
    };
  }

  startTour(kind = 'ride') {
    this.flight = null;
    const pts = [];
    const ride = kind === 'ride';
    for (let z = -MAP.halfZ + 90; z <= 1120; z += 30) {
      const x = centerX(z) + (ride ? 22 * Math.sin(z * 0.017) + 10 * Math.sin(z * 0.043) : 60 * Math.sin(z * 0.004));
      pts.push(new THREE.Vector3(x, 0, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    this.tour = { curve, u: 0, kind, len: curve.getLength(), speed: ride ? 19 : 45, height: ride ? 2.4 : 70, bank: 0 };
  }

  stopTour() { this.tour = null; }

  update(dt) {
    const cam = this.camera;
    if (this.tour) return this._updateTour(dt);

    if (this.flight) {
      const f = this.flight;
      f.t += dt / f.duration;
      const k = easeInOut(Math.min(1, f.t));
      cam.position.lerpVectors(f.p0, f.p1, k);
      cam.position.y += Math.sin(k * Math.PI) * f.p0.distanceTo(f.p1) * 0.12;
      this.yaw = f.y0 + (f.y1 - f.y0) * k;
      this.pitch = f.a0 + (f.a1 - f.a0) * k;
      if (f.t >= 1) this.flight = null;
    } else {
      this.yaw -= this.lookDelta.x * 0.0022;
      this.pitch -= this.lookDelta.y * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.5);
      const k = this.keys;
      const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - this.touchMove.y;
      const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.touchMove.x;
      const u = (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') || k.has('KeyC') ? 1 : 0) + this.touchUpDown;
      const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1;
      const fwd = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
      const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
      this.move.set(0, 0, 0).addScaledVector(fwd, f).addScaledVector(right, s).addScaledVector(new THREE.Vector3(0, 1, 0), u);
      if (this.move.lengthSq() > 1) this.move.normalize();
      this.vel.lerp(this.move.multiplyScalar(this.speed * boost), 1 - Math.exp(-dt * 6));
      cam.position.addScaledVector(this.vel, dt);
    }
    this.lookDelta.set(0, 0);
    const ground = heightAt(cam.position.x, cam.position.z) + 1.4;
    if (cam.position.y < ground) cam.position.y = ground;
    this._applyRotation(0);
  }

  _updateTour(dt) {
    const t = this.tour;
    t.u += (t.speed * dt) / t.len;
    if (t.u >= 1) t.u = 0;
    const p = t.curve.getPointAt(t.u);
    const ahead = t.curve.getPointAt(Math.min(1, t.u + 28 / t.len));
    const ahead2 = t.curve.getPointAt(Math.min(1, t.u + 8 / t.len));
    const cam = this.camera;
    const gy = heightAt(p.x, p.z);
    const target = cam.position.clone();
    target.set(p.x, gy + t.height, p.z);
    if (t.kind === 'ride') cam.position.copy(target);
    else cam.position.lerp(target, 1 - Math.exp(-dt * 2));
    const ay = heightAt(ahead.x, ahead.z) + (t.kind === 'ride' ? 0.5 : t.height * 0.4);
    const dir = new THREE.Vector3(ahead.x - cam.position.x, ay - cam.position.y, ahead.z - cam.position.z).normalize();
    const yaw = Math.atan2(dir.x, dir.z);
    const turn = wrapAngle(Math.atan2(ahead2.x - p.x, ahead2.z - p.z) - yaw);
    this.yaw += wrapAngle(yaw - this.yaw) * (1 - Math.exp(-dt * 3));
    this.pitch += (Math.asin(dir.y) - this.pitch) * (1 - Math.exp(-dt * 3));
    t.bank += (THREE.MathUtils.clamp(turn * 2.5, -0.3, 0.3) - t.bank) * (1 - Math.exp(-dt * 2));
    this._applyRotation(t.kind === 'ride' ? t.bank : 0);
  }

  _applyRotation(roll) {
    const e = new THREE.Euler(this.pitch, this.yaw + Math.PI, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(e);
    if (roll) this.camera.rotateZ(roll);
  }
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
