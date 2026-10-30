// Физика фрирайда: карвинг, прыжки, вращения, падения.
import * as THREE from 'three';
import { height, normalAt } from './terrain.js';

const G = 21;
const TAU = Math.PI * 2;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (a, b, d) => (a < b ? Math.min(b, a + d) : Math.max(b, a - d));

const n = new THREE.Vector3();
const F = new THREE.Vector3();
const R = new THREE.Vector3();
const tmp = new THREE.Vector3();

export class Player {
  constructor(events) {
    this.ev = events; // { trick(name, pts, pos, icon), crash(reason), land(impact), nearMiss(pts,pos), gate(pos), shard(mesh) }
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.reset(0, 0);
  }

  reset(x, z, heading = 0) {
    this.pos.set(x, height(x, z), z);
    this.vel.set(Math.sin(heading) * 4, 0, Math.cos(heading) * 4);
    this.heading = heading;
    this.contact = true;
    this.airTime = 0;
    this.spin = 0; this.spinVel = 0;
    this.flip = 0; this.flipVel = 0;
    this.grabTime = 0; this.grabSide = 1;
    this.charge = 0;
    this.crashT = 0;
    this.tumble = new THREE.Vector3();
    this.steer = 0;
    this.carve = 0;
    this.nearSet = new Set();
    this.lastCollide = null;
    this.prevJump = false;
  }

  get speed() { return this.vel.length(); }
  get inAir() { return !this.contact && (this.pos.y - height(this.pos.x, this.pos.z) > 0.35 || this.airTime > 0.3); }
  get crashed() { return this.crashT > 0; }

  step(dt, inp, near) {
    const p = this.pos, v = this.vel;
    // плавное рулевое
    this.steer += (inp.steer - this.steer) * Math.min(1, dt * 10);

    if (this.crashT > 0) return this.crashStep(dt);

    const h = height(p.x, p.z);
    normalAt(p.x, p.z, n);
    this.normal.lerp(n, Math.min(1, dt * 12));

    if (this.contact) {
      // --- на снегу ---
      this.airTime = 0;
      const sp = v.length();
      const turnRate = (inp.brake ? 2.6 : 2.1) / (1 + sp * 0.02);
      this.heading -= this.steer * turnRate * dt;
      F.set(Math.sin(this.heading), 0, Math.cos(this.heading));
      F.addScaledVector(n, -F.dot(n)).normalize();
      R.crossVectors(F, n).normalize();

      let vf = v.dot(F), vl = v.dot(R);
      // кант держит — боковая скорость гасится, часть уходит вперёд
      const grip = inp.brake ? 2.2 : 7 + Math.abs(this.steer) * 3;
      const vl2 = vl * Math.exp(-grip * dt);
      const lost = Math.abs(vl - vl2);
      this.carve = lost / Math.max(dt, 1e-4) * 0.02;
      vf += Math.sign(vf || 1) * lost * (inp.brake ? 0 : 0.55);
      vl = vl2;
      // назад ехать нельзя — разворачиваем лыжи по скорости
      if (vf < -1) { this.heading += Math.PI; vf = -vf; F.negate(); R.negate(); vl = -vl; }
      v.copy(F).multiplyScalar(vf).addScaledVector(R, vl);
      // гравитация (полная — так рельеф сам подбрасывает на буграх)
      v.y -= G * dt;
      // сопротивление
      const s = v.length();
      const cd = inp.tuck ? 0.0045 : 0.0075;
      let decel = cd * s * s + 1.0;
      if (inp.brake) decel += 6 + s * 0.35;
      if (s > 0.01) v.multiplyScalar(Math.max(0, s - decel * dt) / s);
      // разгон коньковым ходом на пологом
      if (inp.tuck && s < 9) v.addScaledVector(F, 5 * dt);
      // прыжок: держим — приседаем, отпускаем — отрыв
      if (inp.jump) this.charge = Math.min(1, this.charge + dt * 1.8);
      if (!inp.jump && this.prevJump) {
        const pw = 4.5 + this.charge * 5;
        v.addScaledVector(n, pw * 0.75).y += pw * 0.35;
        this.contact = false;
        this.jumped = true;
        this.charge = 0;
      }
      this.prevJump = inp.jump;
    } else {
      // --- в воздухе ---
      this.airTime += dt;
      v.y -= G * dt;
      v.multiplyScalar(1 - 0.0006 * v.length() * dt);
      const targetSpin = -inp.steer * 7.5;
      const targetFlip = (inp.tuck ? 1 : 0) * 6.5 - (inp.brake ? 1 : 0) * 6.5;
      this.spinVel += (targetSpin - this.spinVel) * Math.min(1, dt * 7);
      this.flipVel += (targetFlip - this.flipVel) * Math.min(1, dt * 7);
      if (this.airTime > 0.15) {
        this.spin += this.spinVel * dt;
        this.flip += this.flipVel * dt;
        // без ввода тело само доворачивается к ближайшему «приземляемому» углу
        if (Math.abs(inp.steer) < 0.1) this.spin = approach(this.spin, Math.round(this.spin / Math.PI) * Math.PI, 3.2 * dt);
        if (!inp.tuck && !inp.brake) this.flip = approach(this.flip, Math.round(this.flip / TAU) * TAU, 2.6 * dt);
      }
      if (inp.grab && this.airTime > 0.15) this.grabTime += dt;
      this.prevJump = inp.jump;
      this.charge = 0;
    }

    const prevX = p.x, prevZ = p.z;
    p.addScaledVector(v, dt);
    const hNew = height(p.x, p.z);
    if (p.y <= hNew) {
      normalAt(p.x, p.z, n);
      const vn = v.dot(n);
      p.y = hNew;
      if (!this.contact) this.landing(-vn);
      if (vn < 0) v.addScaledVector(n, -vn);
      this.contact = true;
    } else if (this.contact && p.y > hNew + 0.02) {
      this.contact = false;
    }
    if (this.crashT > 0) return;
    this.checkWorld(near, prevX, prevZ);
  }

  landing(impact) {
    const air = this.airTime;
    const spin = this.spin, flip = this.flip;
    const grab = this.grabTime;
    this.spin = this.flip = this.spinVel = this.flipVel = this.grabTime = 0;
    this.jumped = false;
    if (air < 0.25 && Math.abs(spin) < 1 && Math.abs(flip) < 1) return;

    const flipRes = Math.abs(wrap(flip));
    const vh = Math.hypot(this.vel.x, this.vel.z);
    const velYaw = Math.atan2(this.vel.x, this.vel.z);
    const body = this.heading + spin;
    const d = Math.abs(wrap(body - velYaw));
    if (flipRes > 1.1) return this.crash('Упал на голову!');
    if (impact > 26) return this.crash('Жёсткое приземление');
    let quality = 'clean';
    if (vh < 3) { this.heading = body; }
    else if (d < 0.9) { this.heading = body; }
    else if (d > Math.PI - 0.9) { this.heading = velYaw; quality = 'switch'; }
    else if (d < 1.5) { this.heading = velYaw; quality = 'sloppy'; this.vel.multiplyScalar(0.6); }
    else return this.crash('Не докрутил');

    const pos = this.pos.clone();
    const spins = Math.round(Math.abs(spin) / Math.PI) * 180;
    const flips = Math.round(Math.abs(flip) / TAU);
    if (spins >= 180) this.ev.trick(`${spins}°`, spins * 1.1, pos, '↻');
    if (flips >= 1) this.ev.trick(flip > 0 ? (flips > 1 ? `${flips}× фронтфлип` : 'Фронтфлип') : (flips > 1 ? `${flips}× бэкфлип` : 'Бэкфлип'), flips * 700, pos, '⟲');
    if (grab > 0.3) this.ev.trick('Грэб', Math.round(grab * 260), pos, '✋');
    if (air > 0.7) this.ev.trick('Полёт', Math.round(air * 140), pos, '☁');
    if (quality === 'switch') this.ev.trick('Свитч', 250, pos, '⇅');
    this.ev.land(impact, quality, air);
  }

  crash(reason) {
    this.crashT = 2.4;
    this.tumble.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 14);
    this.crashSpin = new THREE.Euler();
    this.ev.crash(reason);
  }

  crashStep(dt) {
    const p = this.pos, v = this.vel;
    this.crashT -= dt;
    v.y -= G * dt;
    p.addScaledVector(v, dt);
    const h = height(p.x, p.z);
    if (p.y < h) {
      p.y = h;
      normalAt(p.x, p.z, n);
      const vn = v.dot(n);
      if (vn < 0) v.addScaledVector(n, -vn * 1.25);
      v.multiplyScalar(Math.exp(-2.5 * dt));
    }
    this.crashSpin.x += this.tumble.x * dt;
    this.crashSpin.y += this.tumble.y * dt;
    this.crashSpin.z += this.tumble.z * dt;
    this.tumble.multiplyScalar(Math.exp(-1.6 * dt));
    if (this.crashT <= 0) {
      // встаём и едем дальше
      const sp = Math.atan2(v.x, v.z);
      this.reset(p.x, p.z, isFinite(sp) && v.length() > 1 ? sp : this.heading);
      this.ev.recover();
    }
  }

  checkWorld(near, prevX, prevZ) {
    const p = this.pos;
    const sp = this.speed;
    for (const c of near.colliders) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      if (p.y > c.top) continue;
      if (d < c.r + 0.35) {
        // упругий отскок на малой скорости, падение на большой
        if (sp > 9 || this.inAir) {
          this.vel.set(dx / d * 3, 2, dz / d * 3);
          return this.crash(c.kind === 'tree' ? 'Поцеловал дерево' : c.kind === 'log' ? 'Зацепил бревно' : 'Врезался в камень');
        }
        p.x = c.x + dx / d * (c.r + 0.36);
        p.z = c.z + dz / d * (c.r + 0.36);
        this.vel.multiplyScalar(0.5);
      } else if (d < c.r + 1.9 && sp > 13 && !this.nearSet.has(c.id) && c.kind === 'tree') {
        this.nearSet.add(c.id);
        this.ev.nearMiss(Math.round(sp * 9), new THREE.Vector3(c.x, p.y + 1.2, c.z));
      }
    }
    for (const g of near.gates) {
      if (this.nearSet.has(g.id)) continue;
      if (segCross(prevX, prevZ, p.x, p.z, g.ax, g.az, g.bx, g.bz)) {
        this.nearSet.add(g.id);
        this.ev.trick('Ворота', 300, p.clone().setY(p.y + 1.5), '⛩');
      }
    }
    for (const s of near.shards) {
      if (s.position.distanceToSquared(tmp.copy(p).setY(p.y + 1)) < 2.6) this.ev.shard(s);
    }
    if (this.nearSet.size > 400) this.nearSet.clear();
  }
}

function segCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
