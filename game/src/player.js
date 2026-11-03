// Rider physics: carving on a height field, natural take-offs from rollers
// and kickers, air tricks, paraglider, log slides, crashes.
import * as THREE from '../vendor/three.module.js';
import { heightAt, normalAt } from './terrain.js';
import { clamp, lerp } from './noise.js';

const G = 11.0;
const STEP = 1 / 120;
const TAU = Math.PI * 2;

const _n = new THREE.Vector3();
const _f = new THREE.Vector3();
const _s = new THREE.Vector3();
const _t = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function wrapPi(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }

export function groundNormal(x, z, out) {
  const n = normalAt(x, z);
  return out.set(n[0], n[1], n[2]);
}

export class Player {
  constructor(world, trail) {
    this.world = world;
    this.trail = trail;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.forward = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.listeners = {};
    this.visited = new Set();
    this.reset(0, 0);
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, ...a) { for (const fn of this.listeners[ev] || []) fn(...a); }

  reset(x, z, yaw) {
    const h = heightAt(x, z);
    this.pos.set(x, h, z);
    groundNormal(x, z, this.normal);
    if (yaw === undefined) {
      const dx = this.normal.x, dz = this.normal.z;
      yaw = Math.atan2(-dx, -dz);
      if (Math.hypot(dx, dz) < 0.05) yaw = 0;
    }
    this.yaw = yaw;
    this.vel.set(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(3);
    this.mode = 'ground';
    this.contact = true;
    this.sinceContact = 0;
    this.gap = 0;
    this.airTime = 0;
    this.inAir = false;
    this.spin = 0; this.spinVel = 0; this.spinAcc = 0;
    this.flip = 0; this.flipVel = 0; this.flipAcc = 0;
    this.roll = 0;
    this.grab = 0; this.grabTime = 0;
    this.crouch = 0; this.charge = 0; this.charging = false;
    this.lean = 0; this.yawRate = 0;
    this.skid = 0; this.carve = 0;
    this.sink = 0.3;
    this.fresh = 1;
    this.crashT = 0; this.invuln = 1;
    this.glide = 0; this.glideT = 0; this.gliding = false; this.bank = 0;
    this.grind = null; this.grindDist = 0;
    this.compress = 0;
    this.takeoffY = h; this.maxAirH = 0;
    this.revert = 0;
    this.pivot = 0;
    this.nearCooldown = new Map();
    this.lastSki = null;
    this.speed = 0;
    this.distance = 0;
    this.topSpeed = 0;
    this.trickInAir = false;
    this.tuck = 0;
    this.brake = 0;
    this.pole = 0; this.poleSide = 1; this.lastTurnSign = 0;
  }

  get grounded() { return this.mode === 'ground' && this.sinceContact < 0.15; }

  update(dt, input) {
    dt = Math.min(dt, 0.05);
    let t = dt;
    this.frameSkid = 0; this.frameImpact = 0;
    const startX = this.pos.x, startZ = this.pos.z, startY = this.pos.y;
    while (t > 1e-6) {
      const h = Math.min(STEP, t);
      this.step(h, input);
      t -= h;
    }
    this.afterFrame(dt, input, startX, startY, startZ);
  }

  // ------------------------------------------------------------------ simulation step
  step(dt, input) {
    if (!this.inAir) { this.lastSteer = input.steer; this.lastPitch = input.pitch; }
    if (this.mode === 'crash') return this.stepCrash(dt);
    if (this.mode === 'grind') return this.stepGrind(dt, input);
    if (this.gliding) return this.stepGlide(dt, input);

    const p = this.pos, v = this.vel;
    groundNormal(p.x, p.z, _n);
    const near = this.sinceContact < 0.12 && this.gap < 0.25;
    const speed = v.length();

    // forward / right on the slope
    _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    if (near) _f.addScaledVector(_n, -_f.dot(_n)).normalize();
    _s.crossVectors(_f, near ? _n : UP).normalize();
    this.forward.copy(_f); this.right.copy(_s); this.normal.copy(_n);

    if (near && !this.inAir) {
      // ---------------- steering & carving
      this.tuck = lerp(this.tuck, input.pitch > 0.3 && !input.brake ? 1 : 0, 1 - Math.exp(-dt * 6));
      this.brake = lerp(this.brake, input.brake ? 1 : 0, 1 - Math.exp(-dt * 8));
      const steer = input.steer;
      let rate = speed < 3 ? 2.6 : lerp(2.5, 1.35, clamp(speed / 32, 0, 1));
      rate *= 1 - this.tuck * 0.45;
      if (this.pivot > 0) {
        // smooth 180 back to riding forward after a switch landing
        const want = Math.atan2(-v.x, -v.z);
        const d = wrapPi(want - this.yaw);
        this.yaw += d * (1 - Math.exp(-dt * 10));
        this.pivot -= dt;
      } else {
        this.yaw -= steer * rate * dt;
      }
      this.yawRate = lerp(this.yawRate, -steer * rate, 1 - Math.exp(-dt * 10));

      let vf = v.dot(_f), vs = v.dot(_s), vn = v.dot(_n);
      // edges bite: lateral speed bleeds off, most of it turns into forward speed (a carve)
      const grip = (this.brake > 0.5 ? 2.2 : 7.5) * (this.fresh > 0.5 ? 0.9 : 1.1);
      const vsNew = vs * Math.exp(-grip * dt);
      const lost = Math.abs(vs - vsNew);
      if (Math.abs(vf) > 1.2) vf += Math.sign(vf) * lost * (0.86 - this.brake * 0.6);
      vs = vsNew;
      this.frameSkid += lost;

      // friction, powder drag, braking
      const mu = 0.045 + (this.fresh > 0.5 ? 0.03 : 0);
      const fr = mu * G * Math.max(_n.y, 0.2) * dt;
      vf = Math.abs(vf) <= fr ? 0 : vf - Math.sign(vf) * fr;
      // deep snow pushes back harder the faster you plough through it
      const pd = (0.05 + this.fresh * 0.1) * (1 - this.tuck * 0.45);
      vf -= vf * pd * dt;
      if (this.brake > 0.05) {
        const b = 9.5 * this.brake * dt;
        vf = Math.abs(vf) <= b ? 0 : vf - Math.sign(vf) * b;
        this.frameSkid += Math.min(Math.abs(vf), 1) * b * 2;
      }
      // pole pushes on the flats
      if (input.pitch > 0.3 && speed < 9 && !input.brake) vf += 4.0 * dt * (vf >= -0.5 ? 1 : -1);
      v.copy(_f).multiplyScalar(vf).addScaledVector(_s, vs).addScaledVector(_n, vn);

      // jump: hold to crouch, release to pop
      if (input.jump) {
        this.charging = true;
        this.charge = Math.min(1, this.charge + dt * 1.6);
      } else if (this.charging) {
        this.charging = false;
        const pop = 3.6 + this.charge * 4.4;
        v.addScaledVector(_n, pop).addScaledVector(UP, 0.8);
        this.charge = 0;
        this.sinceContact = 1;
        this.gap = 0.3;
        this.startAir(true);
        this.emit('jump');
      }
    }

    // air drag (less in a tuck)
    const k = 0.0045 * (1 - this.tuck * 0.4) * (this.grab > 0.5 ? 1.1 : 1);
    v.addScaledVector(v, -k * speed * dt);
    v.y -= G * dt;

    // ---------------- air control
    if (this.inAir) this.airControl(dt, input);

    p.addScaledVector(v, dt);
    this.distance += speed * dt;

    // ---------------- ground contact
    const gh = heightAt(p.x, p.z);
    this.gap = p.y - gh;
    if (this.gap <= 0) {
      groundNormal(p.x, p.z, _n);
      p.y = gh;
      const vn = v.dot(_n);
      if (vn < 0) {
        v.addScaledVector(_n, -vn);
        this.frameImpact = Math.max(this.frameImpact, -vn);
      }
      this.gap = 0;
      if (this.inAir) this.land(-vn, _n);
      this.sinceContact = 0;
      this.contact = true;
    } else if (near && !this.inAir && this.gap < 0.45 && this.stickOk(v)) {
      // legs soak up small bumps: stay glued unless the ground falls away fast
      groundNormal(p.x, p.z, _n);
      p.y = gh;
      const vn = v.dot(_n);
      if (vn > 0) v.addScaledVector(_n, -vn);
      this.gap = 0;
      this.sinceContact = 0;
      this.contact = true;
    } else {
      this.sinceContact += dt;
      this.contact = false;
      if (!this.inAir && (this.gap > 0.45 || this.sinceContact > 0.22)) this.startAir(false);
    }

    this.checkObjects(dt);
  }

  /** Would a ballistic arc stay close to the snow over the next moment? */
  stickOk(v) {
    const p = this.pos;
    const T = 0.36;
    const by = p.y + v.y * T - 0.5 * G * T * T;
    const ahead = by - heightAt(p.x + v.x * T, p.z + v.z * T);
    return ahead < 1.7;
  }

  startAir(jumped) {
    if (this.inAir) return;
    this.inAir = true;
    this.airTime = 0;
    this.spin = 0; this.spinAcc = 0; this.spinVel = this.yawRate * 0.35;
    this.flip = 0; this.flipAcc = 0; this.flipVel = 0;
    this.grabTime = 0;
    this.takeoffY = this.pos.y;
    this.maxAirH = 0;
    this.airYaw0 = this.yaw;
    this.trickInAir = false;
    this.jumped = jumped;
    // keys held through a natural take-off do not start tricks until re-pressed
    this.steerLock = jumped ? 0 : Math.sign(this.lastSteer || 0);
    this.pitchLock = jumped ? 0 : Math.sign(this.lastPitch || 0);
  }

  airControl(dt, input) {
    this.airTime += dt;
    const groundY = this.pos.y - this.gap;
    this.maxAirH = Math.max(this.maxAirH, this.gap);
    // spins (keys held from the ground are ignored until released)
    if (this.steerLock && Math.sign(input.steer) !== this.steerLock) this.steerLock = 0;
    if (this.pitchLock && Math.sign(input.pitch) !== this.pitchLock) this.pitchLock = 0;
    const steerAir = this.steerLock ? 0 : input.steer;
    const pitchAir = this.pitchLock ? 0 : input.pitch;
    const target = -steerAir * 7.2;
    const acc = steerAir !== 0 ? 26 : 14;
    this.spinVel += clamp(target - this.spinVel, -acc * dt, acc * dt);
    this.yaw += this.spinVel * dt;
    this.spinAcc += this.spinVel * dt;
    // flips (forward = positive)
    const ft = pitchAir * 6.0;
    const facc = pitchAir !== 0 ? 20 : 12;
    this.flipVel += clamp(ft - this.flipVel, -facc * dt, facc * dt);
    // self-levelling when no input and nearly upright
    if (pitchAir === 0) {
      const r = wrapPi(this.flip);
      if (Math.abs(r) < 1.2) this.flipVel += -r * 6 * dt;
    }
    this.flip += this.flipVel * dt;
    this.flipAcc += this.flipVel * dt;
    // grabs
    const g = input.grab ? 1 : 0;
    this.grab = lerp(this.grab, g, 1 - Math.exp(-dt * 12));
    if (input.grab) this.grabTime += dt;
    this.grabKind = pitchAir > 0.3 ? 'nose' : pitchAir < -0.3 ? 'tail' : steerAir !== 0 ? 'mute' : 'safety';
    if (Math.abs(this.spinAcc) > 2.5 || Math.abs(this.flipAcc) > 3.5) this.trickInAir = true;
  }

  land(impact, n) {
    this.inAir = false;
    const air = this.airTime;
    // orientation check
    const flipRes = wrapPi(this.flip);
    const vh = Math.atan2(-this.vel.x, -this.vel.z);
    const yawErr = wrapPi(this.yaw - vh);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    let switchLand = false;
    let bad = null;
    const tiny = air < 0.55 && Math.abs(this.spinAcc) < 1.4 && Math.abs(this.flipAcc) < 1.4;
    if (tiny) {
      if (impact > 32) bad = 'Слишком жёстко';
    } else if (Math.abs(flipRes) > 1.1) bad = Math.abs(flipRes) > 2.2 ? 'Через голову' : 'Недокрут';
    else if (sp > 5 && Math.abs(yawErr) > 1.25 && Math.abs(Math.abs(yawErr) - Math.PI) > 1.25) bad = 'Боком';
    else if (impact > 30) bad = 'Слишком жёстко';
    if (!tiny && sp > 4 && Math.abs(Math.abs(yawErr) - Math.PI) <= 1.25) switchLand = true;
    // anything not switch gets swung back in line with the travel direction
    if (!bad && !switchLand && Math.abs(yawErr) > 0.3) this.pivot = 0.3;

    this.compress = clamp(impact / 12, 0.15, 1);
    // heavy landings bleed speed
    if (impact > 16) this.vel.multiplyScalar(clamp(1 - (impact - 16) * 0.03, 0.6, 1));
    this.frameImpact = Math.max(this.frameImpact, impact);
    this.flip = 0; this.flipVel = 0; this.spinVel = 0;
    this.grab = 0;

    if (bad) {
      this.crash(bad);
      return;
    }
    if (switchLand) this.pivot = 0.45;
    const clean = Math.abs(flipRes) < 0.35 && (Math.abs(yawErr) < 0.35 || Math.abs(Math.abs(yawErr) - Math.PI) < 0.35);
    this.emit('land', {
      air, impact,
      spin: Math.abs(this.spinAcc), spinDir: Math.sign(this.spinAcc),
      flip: this.flipAcc, grab: this.grabTime, grabKind: this.grabKind,
      height: this.maxAirH, switchLand, clean, jumped: this.jumped,
      glide: this.glideTime || 0,
    });
    this.glideTime = 0;
    this.stampCrater(0.7 + Math.min(impact, 14) * 0.04, 0.25);
  }

  crash(reason) {
    if (this.invuln > 0 && reason !== 'reset') return;
    this.mode = 'crash';
    this.crashT = 2.4;
    this.inAir = false;
    this.gliding = false;
    this.glide = 0;
    this.grind = null;
    this.tumble = { axis: new THREE.Vector3(this.right.x, 0, this.right.z).normalize(), a: 0, w: 9 + Math.random() * 5 };
    this.emit('crash', reason);
    this.stampCrater(1.3, 0.55);
  }

  stepCrash(dt) {
    const p = this.pos, v = this.vel;
    this.crashT -= dt;
    v.y -= G * dt;
    v.multiplyScalar(Math.exp(-dt * 1.7));
    p.addScaledVector(v, dt);
    const gh = heightAt(p.x, p.z);
    if (p.y < gh) {
      groundNormal(p.x, p.z, _n);
      p.y = gh;
      const vn = v.dot(_n);
      if (vn < 0) v.addScaledVector(_n, -vn * 1.25);
      v.multiplyScalar(Math.exp(-dt * 3.5));
    }
    this.gap = p.y - gh;
    this.tumble.w *= Math.exp(-dt * 1.6);
    this.tumble.a += this.tumble.w * dt;
    if (this.crashT <= 0) this.recover();
  }

  recover() {
    groundNormal(this.pos.x, this.pos.z, _n);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    let yaw = sp > 1 ? Math.atan2(-this.vel.x, -this.vel.z) : Math.atan2(-_n.x, -_n.z);
    this.mode = 'ground';
    this.yaw = yaw;
    this.invuln = 1.2;
    this.flip = 0; this.spin = 0; this.lean = 0;
    this.vel.multiplyScalar(0.4);
    this.inAir = false;
    this.sinceContact = 0;
    this.emit('recover');
  }

  // ------------------------------------------------------------------ paraglider
  toggleGlider() {
    if (this.mode === 'crash') return false;
    if (this.gliding) {
      this.gliding = false;
      this.emit('glider', false);
      return true;
    }
    if (this.inAir && this.gap > 2.5 && this.airTime > 0.25) {
      this.gliding = true;
      this.glideTime = this.glideTime || 0;
      this.flip = 0; this.flipVel = 0; this.spinVel = 0; this.grab = 0;
      this.emit('glider', true);
      return true;
    }
    return false;
  }

  stepGlide(dt, input) {
    const p = this.pos, v = this.vel;
    this.airTime += dt;
    this.glideTime = (this.glideTime || 0) + dt;
    this.yaw -= input.steer * 0.95 * dt;
    this.bank = lerp(this.bank, input.steer * 0.5, 1 - Math.exp(-dt * 3));
    const air = input.pitch > 0.3 ? 18 : input.pitch < -0.3 ? 8 : 12.5;
    const sink = input.pitch > 0.3 ? -4.2 : input.pitch < -0.3 ? -0.9 : -1.7;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const kh = 1 - Math.exp(-dt * 1.3);
    v.x = lerp(v.x, fx * air, kh);
    v.z = lerp(v.z, fz * air, kh);
    v.y = lerp(v.y, sink, 1 - Math.exp(-dt * 1.8));
    p.addScaledVector(v, dt);
    this.distance += v.length() * dt;
    const gh = heightAt(p.x, p.z);
    this.gap = p.y - gh;
    this.maxAirH = Math.max(this.maxAirH, this.gap);
    this.flip = lerp(this.flip, 0, 1 - Math.exp(-dt * 4));
    if (this.gap < 0.9) {
      this.gliding = false;
      this.emit('glider', false);
      if (this.gap < 0) p.y = gh;
    }
    this.checkObjects(dt);
  }

  // ------------------------------------------------------------------ log slides
  tryGrind(log) {
    const p = this.pos, v = this.vel;
    const ax = log.ax, az = log.az, bx = log.bx, bz = log.bz;
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz;
    let t = ((p.x - ax) * dx + (p.z - az) * dz) / L2;
    if (t < 0.02 || t > 0.98) return false;
    const cx = ax + dx * t, cz = az + dz * t;
    const dist = Math.hypot(p.x - cx, p.z - cz);
    if (dist > 0.55) return false;
    const topY = log.ay + (log.by - log.ay) * t + log.r;
    const rel = p.y - topY;
    if (rel < -0.65 || rel > 0.6 || v.y > 2.5) return false;
    const L = Math.sqrt(L2);
    const ux = dx / L, uz = dz / L;
    const vh = Math.hypot(v.x, v.z);
    if (vh < 3) return false;
    const al = (v.x * ux + v.z * uz) / vh;
    if (Math.abs(al) < 0.72) return false;
    this.grind = { log, t: t * L, L, ux, uz, dir: Math.sign(al), speed: Math.abs(v.x * ux + v.z * uz) };
    this.mode = 'grind';
    this.inAir = false;
    this.grindDist = 0;
    this.yaw = Math.atan2(-ux * this.grind.dir, -uz * this.grind.dir);
    this.emit('grindStart');
    return true;
  }

  stepGrind(dt, input) {
    const g = this.grind, log = g.log;
    const slope = (log.by - log.ay) / g.L;
    // gravity along the log axis (direction of travel = dir)
    const a = -G * slope * g.dir / Math.sqrt(1 + slope * slope) - 0.8;
    g.speed = Math.max(1.5, g.speed + a * dt);
    g.t += g.speed * g.dir * dt;
    this.grindDist += g.speed * dt;
    const tt = g.t / g.L;
    const y = log.ay + (log.by - log.ay) * tt + log.r + 0.02;
    this.pos.set(log.ax + g.ux * g.t, y, log.az + g.uz * g.t);
    this.vel.set(g.ux * g.dir * g.speed, slope * g.dir * g.speed, g.uz * g.dir * g.speed);
    this.lean = Math.sin(performance.now() * 0.004) * 0.08;
    const off = tt < 0 || tt > 1;
    if (off || input.jumpPressed) {
      if (input.jumpPressed) this.vel.y += 5.5;
      this.mode = 'ground';
      this.grind = null;
      this.sinceContact = 1;
      this.startAir(!!input.jumpPressed);
      this.emit('grindEnd', this.grindDist);
    }
  }

  // ------------------------------------------------------------------ collisions & pickups
  checkObjects(dt) {
    const p = this.pos, v = this.vel;
    for (const ch of this.world.nearChunks(p.x, p.z, 1)) {
      for (const c of ch.colliders) {
        const dx = p.x - c.x, dz = p.z - c.z;
        if (Math.abs(dx) > 8 || Math.abs(dz) > 8) continue;
        const d = Math.hypot(dx, dz);
        const R = c.r + 0.3;
        if (p.y > c.y + c.h || p.y + 1.7 < c.y - 1) continue;
        if (d < R) {
          const nx = dx / (d || 1), nz = dz / (d || 1);
          const into = -(v.x * nx + v.z * nz);
          if (c.kind === 'rock') {
            // low rocks and stumps are bumps you ride over
            const top = c.y + c.h * (1 - (d / R) ** 2);
            if (c.h < 0.7 || p.y > top - 0.35) {
              if (p.y < top) { p.y = top; if (v.y < 0.5) v.y = 0.5 + c.h; }
              continue;
            }
          }
          if (into > 8.5 && this.mode !== 'crash' && this.invuln <= 0) {
            v.x += nx * into * 0.6; v.z += nz * into * 0.6;
            this.crash(c.kind === 'tree' ? 'Дерево!' : c.kind === 'cabin' ? 'Избушка!' : 'Камень!');
            return;
          }
          p.x = c.x + nx * R; p.z = c.z + nz * R;
          if (into > 0) { v.x += nx * into * 1.3; v.z += nz * into * 1.3; }
        } else if (this.mode !== 'crash' && d < R + 1.3 && c.kind === 'tree') {
          const sp = Math.hypot(v.x, v.z);
          if (sp > 12) {
            const id = c.x * 7.31 + c.z;
            const t = this.nearCooldown.get(id);
            if (!t || performance.now() - t > 4000) {
              this.nearCooldown.set(id, performance.now());
              this.emit('nearMiss', c);
            }
          }
        }
      }
      if (this.mode === 'ground') {
        for (const log of ch.logs) {
          const midx = (log.ax + log.bx) / 2, midz = (log.az + log.bz) / 2;
          if (Math.abs(p.x - midx) > log.len || Math.abs(p.z - midz) > log.len) continue;
          if (this.tryGrind(log)) return;
          // otherwise logs are a bump you ride over
          const dx = log.bx - log.ax, dz = log.bz - log.az;
          const L2 = dx * dx + dz * dz;
          const t = clamp(((p.x - log.ax) * dx + (p.z - log.az) * dz) / L2, 0, 1);
          const cx = log.ax + dx * t, cz = log.az + dz * t;
          const d = Math.hypot(p.x - cx, p.z - cz);
          const top = log.ay + (log.by - log.ay) * t + log.r;
          if (d < log.r + 0.25 && p.y < top && p.y > top - log.r * 2.5) {
            p.y = top;
            if (v.y < 1.5) v.y = 1.5 + Math.hypot(v.x, v.z) * 0.08;
          }
        }
      }
      for (const g of ch.gates) {
        if (this.world.gatesDone.has(g.id)) continue;
        const dx = p.x - g.x, dz = p.z - g.z;
        if (Math.abs(dx) > g.w || Math.abs(dz) > g.w) continue;
        // signed distance across the gate line, and position along it
        const ca = Math.cos(g.a), sa = Math.sin(g.a);
        const along = dx * ca + dz * sa;
        const across = -dx * sa + dz * ca;
        const prevAcross = this._gatePrev?.get(g.id);
        this._gatePrev ||= new Map();
        this._gatePrev.set(g.id, across);
        if (prevAcross !== undefined && Math.sign(prevAcross) !== Math.sign(across) && Math.abs(along) < g.w * 0.5 + 0.3 && p.y < g.y + 5) {
          this.world.markGate(g.id);
          this.emit('gate', g);
        }
      }
      for (const c of ch.crystals) {
        if (this.world.crystalsDone.has(c.id)) continue;
        const d = Math.hypot(p.x - c.x, p.y + 0.9 - c.y, p.z - c.z);
        if (d < 2.2) {
          this.world.markCrystal(c.id);
          this.emit('crystal', c);
        }
      }
    }
  }

  // ------------------------------------------------------------------ per-frame bookkeeping
  afterFrame(dt, input, sx, sy, sz) {
    const v = this.vel;
    this.speed = v.length();
    this.topSpeed = Math.max(this.topSpeed, this.speed);
    this.invuln = Math.max(0, this.invuln - dt);
    if (input.gliderPressed) this.toggleGlider();

    // lean into turns from lateral acceleration
    const grounded = this.grounded && !this.inAir;
    const latAcc = grounded ? this.yawRate * Math.hypot(v.x, v.z) : 0;
    const targetLean = this.mode === 'grind' ? this.lean : this.gliding ? this.bank : clamp(Math.atan(latAcc / G) * 1.05, -0.95, 0.95);
    this.lean = lerp(this.lean, targetLean, 1 - Math.exp(-dt * 7));
    this.skid = lerp(this.skid, this.frameSkid / Math.max(dt, 1e-3), 1 - Math.exp(-dt * 10));
    this.carve = Math.abs(latAcc);
    // crouch: jump charge, landing compression, tuck, carving
    this.compress = Math.max(0, this.compress - dt * 2.2);
    const wantCrouch = this.charging ? 0.35 + this.charge * 0.6 : this.inAir ? (this.grab > 0.3 ? 0.8 : 0.35) : 0.12 + this.tuck * 0.55 + Math.min(0.3, Math.abs(this.lean) * 0.35);
    this.crouch = lerp(this.crouch, Math.max(wantCrouch, this.compress), 1 - Math.exp(-dt * 10));

    // pole plants when the turn direction flips
    const sgn = Math.sign(this.yawRate) * (Math.abs(this.yawRate) > 0.6 ? 1 : 0);
    if (grounded && sgn !== 0 && sgn !== this.lastTurnSign) { this.pole = 1; this.poleSide = sgn > 0 ? -1 : 1; }
    if (sgn !== 0) this.lastTurnSign = sgn;
    this.pole = Math.max(0, this.pole - dt * 2.5);

    // fresh powder & sinking
    const touching = (grounded || this.mode === 'crash') && this.gap < 0.3;
    // fresh powder: cells are marked as tracked a moment after we leave them
    this.trackLog ||= [];
    this.trackT = (this.trackT || 0) + dt;
    if (touching) {
      const cx = Math.floor(this.pos.x), cz = Math.floor(this.pos.z);
      const wasFresh = !this.visited.has(cx * 1000003 + cz);
      this.fresh = lerp(this.fresh, wasFresh ? 1 : 0, 1 - Math.exp(-dt * 6));
      this.trackLog.push(this.trackT, this.pos.x, this.pos.z);
    }
    while (this.trackLog.length && this.trackT - this.trackLog[0] > 0.35) {
      const x = this.trackLog[1], z = this.trackLog[2];
      this.trackLog.splice(0, 3);
      const cx = Math.floor(x), cz = Math.floor(z);
      if (this.visited.size > 400000) this.visited.clear();
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) this.visited.add((cx + a) * 1000003 + (cz + b));
    }
    const sinkT = this.mode === 'grind' ? 0 : touching ? (this.fresh > 0.5 ? lerp(0.5, 0.2, clamp(this.speed / 30, 0, 1)) : 0.08) : 0;
    this.sink = lerp(this.sink, sinkT, 1 - Math.exp(-dt * 5));

    // trail stamps
    if (touching && this.mode !== 'crash') this.stampSkis(dt);
    else this.lastSki = null;
    if (this.mode === 'crash' && this.gap < 0.4) {
      this.trail.stamp(sx, sz, this.pos.x, this.pos.z, 0.9, 0.5, 0.25, 1);
    }
  }

  stampSkis(dt) {
    const f = this.forward, r = this.right, p = this.pos;
    const sep = 0.15;
    const half = 0.55;
    const cur = [
      [p.x - r.x * sep, p.z - r.z * sep],
      [p.x + r.x * sep, p.z + r.z * sep],
    ];
    const deep = this.fresh > 0.5;
    const rad = (deep ? 0.36 : 0.24) + Math.min(this.skid * 0.012, 0.35);
    const depth = deep ? Math.max(this.sink, 0.12) + 0.08 : 0.06;
    const berm = deep ? 0.28 + Math.min(this.skid * 0.01, 0.2) : 0.04;
    if (this.lastSki) {
      for (let i = 0; i < 2; i++) {
        this.trail.stamp(this.lastSki[i][0], this.lastSki[i][1], cur[i][0], cur[i][1], rad, depth, berm, 1);
      }
    } else {
      for (let i = 0; i < 2; i++) {
        this.trail.stamp(cur[i][0] - f.x * half, cur[i][1] - f.z * half, cur[i][0] + f.x * half * 0.3, cur[i][1] + f.z * half * 0.3, rad, depth, berm, 1);
      }
    }
    this.lastSki = cur;
  }

  stampCrater(r, depth) {
    this.trail.stamp(this.pos.x - 0.01, this.pos.z, this.pos.x + 0.01, this.pos.z, r, depth, 0.3, 1);
  }

  /** Downhill-ish yaw for respawn. */
  respawnHere() {
    const p = this.pos;
    // step sideways out of anything solid
    for (let k = 0; k < 20; k++) {
      let blocked = false;
      for (const ch of this.world.nearChunks(p.x, p.z, 1)) for (const c of ch.colliders) {
        if (Math.hypot(p.x - c.x, p.z - c.z) < c.r + 1.5) blocked = true;
      }
      if (!blocked) break;
      p.x += 2.5;
    }
    this.reset(p.x, p.z);
    this.invuln = 1.5;
  }
}
