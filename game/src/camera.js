import * as THREE from '../vendor/three.module.js';
import { heightAt, POWDER } from './world.js';

export const CAM_MODES = ['chase', 'low', 'fp', 'drone'];
export const CAM_NAMES = { chase: 'Камера: сзади', low: 'Камера: низкая', fp: 'Камера: от первого лица', drone: 'Камера: дрон' };

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const snowH = (x, z) => heightAt(x, z) + POWDER;

export class CameraRig {
  constructor(camera, props) {
    this.cam = camera;
    this.props = props;
    this.near = [];
    this.distScale = 1;
    this.mode = 'chase';
    this.yaw = 0;
    this.pitchOfs = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shakeAmt = 0;
    this.fov = 64;
    this.drone = new THREE.Vector3();
    this.droneT = 0;
    this.orbitA = 0;
    this.roll = 0;
    this.init = false;
  }
  next() {
    const i = CAM_MODES.indexOf(this.mode);
    this.mode = CAM_MODES[(i + 1) % CAM_MODES.length];
    this.droneT = 0;
    return this.mode;
  }
  shake(a) { this.shakeAmt = Math.min(1.2, this.shakeAmt + a); }

  update(dt, P, skier, menu) {
    const cam = this.cam;
    const p = P.pos, v = P.vel;
    const sp = v.length();
    const hv = Math.hypot(v.x, v.z);
    const k = (r) => 1 - Math.exp(-dt * r);
    let targetFov = 64;

    // курс камеры — по горизонтальной скорости, на малой — по лыжам
    const want = hv > 2.5 ? Math.atan2(v.x, v.z) : P.yaw;
    let dy = want - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * k(P.mode === 'crash' ? 1.2 : 3.2);
    if (!this.init) { this.yaw = want; }

    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    if (menu) {
      this.orbitA += dt * 0.12;
      const a = this.yaw + 2.6 + Math.sin(this.orbitA) * 0.5;
      _a.set(p.x + Math.sin(a) * 5.2, 0, p.z + Math.cos(a) * 5.2);
      _a.y = Math.max(p.y + 1.6, snowH(_a.x, _a.z) + 0.8);
      this.pos.lerp(_a, this.init ? k(2) : 1);
      _b.set(p.x, p.y + 0.35, p.z);
      this.look.lerp(_b, this.init ? k(4) : 1);
      targetFov = 50;
    } else if (this.mode === 'chase' || this.mode === 'low') {
      const low = this.mode === 'low';
      const air = P.mode === 'air' || P.mode === 'glide';
      let dist = (low ? 3.3 : 4.4) + Math.min(2.2, sp * 0.05) + (air ? 1.0 : 0) + (P.mode === 'glide' ? 3 : 0);
      // не заезжаем камерой в кроны: укорачиваем дистанцию
      let lim = dist;
      if (this.props) {
        for (const it of this.props.near(p.x - fx * dist * 0.5, p.z - fz * dist * 0.5, this.near)) {
          if (!it.solid && it.type !== 'bush') continue;
          const cr = it.type === 'spruce' ? 1.9 * it.s : it.type === 'bush' ? 1.0 * it.s : it.type === 'rock' ? it.r : 0.55;
          const rx = it.x - p.x, rz = it.z - p.z;
          const along = -(rx * fx + rz * fz);
          if (along < 0.3 || along > dist + cr) continue;
          const lat = Math.abs(rx * fz - rz * fx);
          if (lat < cr + 0.35) lim = Math.min(lim, Math.max(1.6, along - cr * 0.6 - 0.4));
        }
      }
      this.distScale += (lim / dist - this.distScale) * k(lim < dist * this.distScale ? 10 : 2);
      dist *= this.distScale;
      const hgt = (low ? 1.0 : 1.75) + (P.mode === 'glide' ? 1.5 : 0);
      _a.set(p.x - fx * dist, 0, p.z - fz * dist);
      const ground = snowH(_a.x, _a.z);
      // камера держится над землёй и чуть выше игрока на склоне
      _a.y = Math.max(p.y + POWDER + hgt + (ground - p.y - POWDER) * 0.35, ground + 0.7);
      if (!this.init) this.pos.copy(_a);
      // плавно по высоте, жёстче по горизонтали
      this.pos.x += (_a.x - this.pos.x) * k(14);
      this.pos.z += (_a.z - this.pos.z) * k(14);
      this.pos.y += (_a.y - this.pos.y) * k(air ? 3 : 7);
      this.pos.y = Math.max(this.pos.y, snowH(this.pos.x, this.pos.z) + 0.6);
      _b.set(p.x + fx * 3.0, p.y + POWDER + (low ? 0.6 : 0.85), p.z + fz * 3.0);
      if (air) _b.y = p.y + 0.7;
      this.look.lerp(_b, this.init ? k(10) : 1);
      targetFov = 62 + Math.min(18, sp * 0.55) + (low ? 4 : 0);
      this.roll += (-P.lean * 0.12 - this.roll) * k(4);
    } else if (this.mode === 'fp' && P.mode === 'crash') {
      _a.set(p.x - fx * 4, 0, p.z - fz * 4); _a.y = Math.max(p.y + 2.5, snowH(_a.x, _a.z) + 1);
      this.pos.lerp(_a, k(4));
      _b.set(p.x, p.y + 0.6, p.z); this.look.lerp(_b, k(6));
      targetFov = 64;
    } else if (this.mode === 'fp') {
      skier.B.head.getWorldPosition(_a);
      _b.set(0, 0.16, -0.34).applyQuaternion(P.quat);
      this.pos.copy(_a).add(_b);
      // стабилизированный взгляд: курс тела, наклон склона по курсу, чуть вниз — видны лыжи
      const flipping = (P.mode === 'air' && (Math.abs(P.flip) > 0.25)) ;
      if (flipping) {
        _c.set(0, -0.3, 1).normalize().applyQuaternion(P.quat);
        this.fpUp = (this.fpUp || new THREE.Vector3()).set(0, 1, 0).applyQuaternion(P.quat);
      } else {
        const by = P.yaw + P.spin;
        const sx = Math.sin(by), sz = Math.cos(by);
        const ahead = snowH(p.x + sx * 6, p.z + sz * 6) - snowH(p.x, p.z);
        const pitch = Math.atan2(ahead, 6) * (P.mode === 'ride' ? 0.8 : 0.3) - 0.6;
        _c.set(sx * Math.cos(pitch), Math.sin(pitch), sz * Math.cos(pitch));
        this.fpUp = (this.fpUp || new THREE.Vector3()).set(0, 1, 0);
      }
      this.fpDir = (this.fpDir || _c.clone()).lerp(_c, k(10)).normalize();
      this.look.copy(this.pos).addScaledVector(this.fpDir, 10);
      targetFov = 80 + Math.min(14, sp * 0.4);
      this.roll += (-P.lean * 0.3 - this.roll) * k(8);
    } else if (this.mode === 'drone') {
      this.droneT -= dt;
      const rel = _a.copy(this.drone).sub(p);
      const ahead = rel.x * fx + rel.z * fz;
      if (this.droneT <= 0 || rel.length() > 45 || ahead < -18) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const lead = 1.6 + Math.random() * 1.2;
        this.drone.set(p.x + v.x * lead + fz * side * (7 + Math.random() * 6), 0, p.z + v.z * lead - fx * side * (7 + Math.random() * 6));
        this.drone.y = snowH(this.drone.x, this.drone.z) + 2.5 + Math.random() * 4;
        this.droneT = 3.5 + Math.random() * 2;
        this.pos.copy(this.drone);
      }
      this.drone.y = Math.max(this.drone.y, snowH(this.drone.x, this.drone.z) + 1.5);
      this.pos.lerp(this.drone, k(2));
      _b.set(p.x, p.y + 1.0, p.z);
      this.look.lerp(_b, this.init ? k(8) : 1);
      targetFov = 46;
      this.roll *= 0.9;
    }
    this.init = true;

    cam.position.copy(this.pos);
    cam.up.set(0, 1, 0);
    if (this.mode === 'fp' && !menu && P.mode !== 'crash' && this.fpUp) cam.up.copy(this.fpUp);
    cam.lookAt(this.look);
    cam.rotateZ(this.roll);
    // тряска
    if (this.shakeAmt > 0.001) {
      const t = performance.now() * 0.001;
      const s = this.shakeAmt * 0.02;
      cam.rotateX(Math.sin(t * 47) * s); cam.rotateY(Math.sin(t * 39 + 1) * s);
      this.shakeAmt *= Math.exp(-dt * 6);
    }
    // лёгкая вибрация в пухляке на скорости
    if (P.mode === 'ride' && !menu) {
      const t = performance.now() * 0.001, s = Math.min(1, sp / 30) * 0.0025;
      cam.rotateX(Math.sin(t * 23) * s); cam.rotateZ(Math.sin(t * 17) * s);
    }
    this.fov += (targetFov - this.fov) * k(3);
    const near = this.mode === 'fp' && !menu ? 0.05 : 0.15;
    if (Math.abs(cam.fov - this.fov) > 0.01 || cam.near !== near) { cam.fov = this.fov; cam.near = near; cam.updateProjectionMatrix(); }
  }
}
