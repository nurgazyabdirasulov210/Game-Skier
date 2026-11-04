// Rider physics: carving in deep powder, take-offs, spins, flips, grabs,
// paraglider, obstacles, crashes. Emits trick events for scoring.
import * as THREE from 'three';
import { height, normalAt } from './world.js';
import { clamp, lerp, damp, wrapAngle } from './util.js';

const G = 9.81;
const TAU = Math.PI * 2;
const _n = { x: 0, y: 1, z: 0 };
const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _s = new THREE.Vector3(), _nv = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);

export class Player {
  static H = height;
  constructor({ rider, trail, fx, flora, events, audio }) {
    this.rider = rider; this.trail = trail; this.fx = fx; this.flora = flora; this.events = events; this.audio = audio;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.yaw = 0;              // ski heading
    this.state = 'ground';
    this.obstacles = [];
    this.gates = [];
    this.history = [];
    this.reset(0, 2, 0);
  }

  reset(x, z, yaw, speed = 6) {
    this.pos.set(x, height(x, z), z);
    this.yaw = yaw;
    this.vel.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
    this.state = 'ground';
    this.air = null;
    this.steer = 0; this.pitchIn = 0;
    this.charge = 0;
    this.sink = 0.25;
    this.bodyYaw = 0;   // visual offset (switch revert)
    this.crashT = 0;
    this.grounded = 0;
    this.lastStamp = null;
    this.lean = 0;
    this.carve = 0;
    this.closeCalls = new Set();
    this.gateSide = new Map();
    this.glideT = 0;
    this.history.length = 0;
    this.speed = speed;
    this.airTime = 0;
    this.qBody = new THREE.Quaternion();
    this.normalAt(this.pos.x, this.pos.z);
  }

  normalAt(x, z) {
    normalAt(x, z, _n);
    this.normal.set(_n.x, _n.y, _n.z);
    return this.normal;
  }

  // ---------------------------------------------------------------
  update(dt, input) {
    this.inputX = input.x; this.inputY = input.y;
    this.steer = damp(this.steer, input.x, 10, dt);
    this.pitchIn = damp(this.pitchIn, input.y, 10, dt);
    if (this.state === 'crash') this._crash(dt, input);
    else if (this.state === 'ground') this._ground(dt, input);
    else if (this.state === 'glide') this._glide(dt, input);
    else this._air(dt, input);
    this.speed = this.vel.length();
    this._pose(dt, input);
  }

  // ---------------------------------------------------------------
  _ground(dt, input) {
    const n = this.normalAt(this.pos.x, this.pos.z);
    const speed = this.vel.length();
    const brake = input.brake ? 1 : 0;
    const tuck = input.tuck ? 1 : 0;

    // steering
    const turn = lerp(2.5, 1.35, clamp(speed / 32, 0, 1)) * (1 + brake * 0.6);
    this.yaw += this.steer * turn * dt;

    _f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _f.addScaledVector(n, -_f.dot(n)).normalize();
    _s.crossVectors(n, _f).normalize();

    // gravity along the slope
    _v.set(0, -G, 0);
    _v.addScaledVector(n, -_v.dot(n));
    this.vel.addScaledVector(_v, dt);

    let vf = this.vel.dot(_f);
    let vs = this.vel.dot(_s);
    // edge grip: sideways speed is carved into forward speed
    const grip = brake ? 2.8 : 7.5;
    const k = 1 - Math.exp(-grip * dt);
    const dv = vs * k;
    const vs2 = vs - dv;
    // part of the sideways energy goes into forward speed, never more
    const lost = vs * vs - vs2 * vs2;
    vf = (vf >= 0 ? 1 : -1) * Math.sqrt(vf * vf + lost * (brake ? 0.05 : 0.8));
    vs = vs2;
    // powder drag
    const lin = brake ? 0.9 : 0.035 - tuck * 0.015;
    const quad = brake ? 0.03 : 0.0046 - tuck * 0.0016;
    const drop = (lin * Math.abs(vf) + quad * vf * vf) * dt;
    vf = Math.sign(vf) * Math.max(0, Math.abs(vf) - drop);
    // going backwards on the slope: dig in and swing round
    if (vf < 0) vf *= Math.exp(-3 * dt);
    this.vel.copy(_f).multiplyScalar(vf).addScaledVector(_s, vs);
    // never fully stall on a hill
    if (this.vel.lengthSq() < 1.5 && !brake) this.vel.addScaledVector(_f, 2 * dt);

    this.carve = clamp(Math.abs(dv) / Math.max(dt, 1e-3) / 25 + Math.abs(this.steer) * clamp(speed / 20, 0, 1) * 0.6, 0, 1);

    // charge a jump
    if (input.jump) this.charge = Math.min(1, this.charge + dt * 2.2);

    // move and follow the ground
    const ox = this.pos.x, oz = this.pos.z;
    const nx = ox + this.vel.x * dt, nz = oz + this.vel.z * dt;
    const ny = this.pos.y + this.vel.y * dt;
    const hg = height(nx, nz);
    const gap = ny - hg;
    const stick = 0.5 * G * n.y * dt * dt * 2.2 + 0.004;
    this.pos.set(nx, ny, nz);

    const released = !input.jump && this.charge > 0;
    if (released && this.charge > 0.08) {
      const c = this.charge;
      this.charge = 0;
      this.pos.y = Math.max(hg, ny);
      this.vel.addScaledVector(n, 3.2 + c * 4.2);
      this._takeoff(true);
      this.events.emit('jump', { charge: c });
      return;
    }
    if (released) this.charge = 0;

    if (gap > stick && this.grounded > 0.05) {
      // ground fell away: natural air
      this._takeoff(false);
      return;
    }
    this.pos.y = hg;
    this.grounded += dt;
    // re-project onto the new surface, keeping most of the energy
    const n2 = this.normalAt(nx, nz);
    const sp = this.vel.length();
    this.vel.addScaledVector(n2, -this.vel.dot(n2));
    const sp2 = this.vel.length();
    if (sp2 > 1e-4) this.vel.multiplyScalar(lerp(sp2, sp, 0.85) / sp2);
    if (this.vel.length() > 42) this.vel.setLength(42);

    // remember safe spots for respawn
    this.history.push([nx, nz, this.yaw]);
    if (this.history.length > 240) this.history.shift();

    this._stampTrail(ox, oz, nx, nz, sp);
    this._spray(dt, sp, n2);
    this._collide(dt, true);
    this._gates();
    this.sink = damp(this.sink, lerp(0.34, 0.2, clamp(sp / 25, 0, 1)), 6, dt);
  }

  _takeoff(jumped) {
    this.state = 'air';
    this.grounded = 0;
    this.air = {
      t: 0, spin: 0, flip: 0, spinV: 0, flipV: 0, grab: 0, grabT: 0, grabKind: 0,
      maxH: 0, startY: this.pos.y, jumped, roll: 0, grabbed: false, kinds: new Set(),
      lastX: this.inputX || 0, lastY: this.inputY || 0, freshX: false, freshY: false,
    };
    this.lastStamp = null;
    this.events.emit('takeoff', {});
  }

  _air(dt, input) {
    const a = this.air;
    a.t += dt;
    this.vel.y -= G * dt;
    const sp = this.vel.length();
    this.vel.multiplyScalar(1 - 0.0025 * sp * dt);
    this.pos.addScaledVector(this.vel, dt);
    const hg = height(this.pos.x, this.pos.z);
    const hAbove = this.pos.y - hg;
    a.maxH = Math.max(a.maxH, hAbove);

    // rotation control: small natural hops don't spin unless you ask
    // for it after leaving the ground
    if (input.x !== a.lastX) a.freshX = true;
    if (input.y !== a.lastY) a.freshY = true;
    a.lastX = input.x; a.lastY = input.y;
    const canSpin = a.jumped || a.t > 0.22 || a.freshX;
    const canFlip = (a.jumped || a.t > 0.3 || a.freshY) && hAbove > 0.6;
    const spinTarget = canSpin ? this.steer * 9.5 : 0;
    const flipTarget = canFlip ? this.pitchIn * 7.5 : 0;
    const tLand = this.vel.y < -0.5 ? hAbove / -this.vel.y : 1;
    const nearSpin = Math.abs(wrapAngle(a.spin - Math.round(a.spin / Math.PI) * Math.PI)) < 1.1;
    const assist = (input.x === 0 && input.y === 0 && tLand < 0.45) || (tLand < 0.18 && nearSpin);
    if (assist) {
      // finish the rotation toward a clean landing
      const ts = Math.round(a.spin / Math.PI) * Math.PI;
      const tf = Math.round(a.flip / TAU) * TAU;
      a.spinV = clamp((ts - a.spin) / Math.max(tLand, 0.08), -11, 11);
      a.flipV = clamp((tf - a.flip) / Math.max(tLand, 0.08), -9, 9);
    } else {
      a.spinV = damp(a.spinV, spinTarget, input.x !== 0 ? 7 : 3, dt);
      a.flipV = damp(a.flipV, flipTarget, input.y !== 0 ? 6 : 3, dt);
    }
    a.spin += a.spinV * dt;
    a.flip += a.flipV * dt;
    // steer the flight a little
    this.yaw += this.steer * 0.25 * dt;

    // grabs
    if (input.grab && a.t > 0.12) {
      if (a.grab < 0.05) { a.grabKind = input.grabKind ?? ((a.kinds.size) % 3); }
      a.grab = Math.min(1, a.grab + dt * 6);
      a.grabT += dt;
      a.kinds.add(a.grabKind);
    } else a.grab = Math.max(0, a.grab - dt * 5);

    // paraglider
    if (input.gliderPressed && a.t > 0.15 && hAbove > 2.0) {
      this._startGlide();
      return;
    }

    this._collide(dt, false);
    this._gates();

    if (hAbove <= 0) this._land(hg);
  }

  _land(hg) {
    const a = this.air;
    const n = this.normalAt(this.pos.x, this.pos.z);
    this.pos.y = hg;
    const spinErr = Math.abs(wrapAngle(a.spin - Math.round(a.spin / Math.PI) * Math.PI));
    const flipErr = Math.abs(wrapAngle(a.flip));
    const grabbing = a.grab > 0.6;
    const impact = -this.vel.dot(n);
    const halfTurns = Math.round(Math.abs(a.spin) / Math.PI);
    const fullFlips = Math.round(Math.abs(a.flip) / TAU);
    const ok = spinErr < 0.95 && flipErr < 0.95 && !grabbing;

    // landing into the slope
    this.vel.addScaledVector(n, -this.vel.dot(n));
    this.vel.multiplyScalar(clamp(1 - impact * 0.012, 0.6, 1));
    this.state = 'ground';
    this.grounded = 0;
    this.trail.stamp(this.pos.x, this.pos.z, this.pos.x + this.vel.x * 0.05, this.pos.z + this.vel.z * 0.05, 0.75 + Math.min(impact, 15) * 0.04, 1, 0.9, 0.9);
    const power = clamp(impact / 10, 0.2, 1.6);
    this.fx.burst(this.pos.x, this.pos.y, this.pos.z, power, this.vel.x, this.vel.z);
    this.audio?.thump(power);

    if (!ok) {
      this._startCrash(spinErr >= 0.95 ? 'spin' : flipErr >= 0.95 ? 'flip' : 'grab');
      return;
    }
    // heading follows the velocity; switch landings revert visually
    const sw = halfTurns % 2 === 1;
    const vy = Math.atan2(this.vel.x, this.vel.z);
    if (this.vel.lengthSq() > 1) this.yaw = vy;
    this.bodyYaw = sw ? Math.PI : 0;
    this.events.emit('land', {
      air: a.t, height: a.maxH, spin: halfTurns * 180, flips: fullFlips, flipDir: Math.sign(a.flip),
      grabT: a.grabT, grabKinds: a.kinds.size, switch: sw, jumped: a.jumped, clean: spinErr < 0.25 && flipErr < 0.3,
      impact,
    });
    this.air = null;
  }

  _startGlide() {
    this.state = 'glide';
    this.glideT = 0;
    this.rider.wing.visible = true;
    this.air.flip = 0; this.air.spin = 0;
    this.events.emit('glide', {});
  }

  _glide(dt, input) {
    this.glideT += dt;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.yaw += this.steer * 0.9 * dt;
    const fwd = 12.5 + this.pitchIn * 4;
    const sink = -2.0 - Math.max(0, this.pitchIn) * 3 + Math.max(0, -this.pitchIn) * 0.8;
    const tx = Math.sin(this.yaw) * fwd, tz = Math.cos(this.yaw) * fwd;
    this.vel.x = damp(this.vel.x, tx, 1.6, dt);
    this.vel.z = damp(this.vel.z, tz, 1.6, dt);
    this.vel.y = damp(this.vel.y, sink, 2.2, dt);
    this.pos.addScaledVector(this.vel, dt);
    const hg = height(this.pos.x, this.pos.z);
    this.air.t += dt;
    this.air.maxH = Math.max(this.air.maxH, this.pos.y - hg);
    this._collide(dt, false);
    this._gates();
    if (input.gliderPressed || this.pos.y - hg < 0.05) {
      // let go of the wing
      this.state = 'air';
      this.events.emit('glideEnd', { t: this.glideT });
      if (this.pos.y - hg < 0.05) this._land(hg);
    }
  }

  _startCrash(why) {
    this.state = 'crash';
    this.crashT = 0;
    this.air = null;
    this.events.emit('crash', { why });
    this.fx.burst(this.pos.x, this.pos.y, this.pos.z, 0.9, this.vel.x * 0.5, this.vel.z * 0.5);
    this.tumble = new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 12);
    this.tumbleQ = new THREE.Quaternion();
  }

  _crash(dt, input) {
    this.crashT += dt;
    const hg = height(this.pos.x, this.pos.z);
    this.vel.y -= G * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y < hg) {
      this.pos.y = hg;
      const n = this.normalAt(this.pos.x, this.pos.z);
      this.vel.addScaledVector(n, -Math.min(0, this.vel.dot(n)));
      this.vel.multiplyScalar(Math.exp(-2.2 * dt));
      if (Math.random() < 0.5) this.fx.puff(this.pos.x, this.pos.y + 0.3, this.pos.z, this.vel.x * 0.3, 1, this.vel.z * 0.3, 1.5, 1.2, 0.5);
      this.trail.stamp(this.pos.x, this.pos.z, this.pos.x + this.vel.x * dt * 2, this.pos.z + this.vel.z * dt * 2, 0.7, 0.9, 0.6, 0.6);
    }
    this.tumble.multiplyScalar(Math.exp(-1.2 * dt));
    _q.setFromEuler(new THREE.Euler(this.tumble.x * dt, this.tumble.y * dt, this.tumble.z * dt));
    this.tumbleQ.multiply(_q);
    if (this.crashT > 2.0 || (this.crashT > 0.6 && input.anyPressed)) this.respawn();
  }

  respawn() {
    // a little way back up the run, facing down the trail
    const h = this.history;
    let pick = h.length ? h[Math.max(0, h.length - 150)] : [this.pos.x, this.pos.z - 10, 0];
    const yaw = pick[2];
    this.reset(pick[0], pick[1], yaw, 8);
    this.events.emit('respawn', {});
  }

  _collide(dt, onGround) {
    const obs = this.flora.nearby(this.pos.x, this.pos.z, this.obstacles, this.gates);
    const speed = this.vel.length();
    for (const o of obs) {
      let dx, dz, d;
      if (o.kind === 'log') {
        const abx = o.bx - o.ax, abz = o.bz - o.az;
        const t = clamp(((this.pos.x - o.ax) * abx + (this.pos.z - o.az) * abz) / (abx * abx + abz * abz), 0, 1);
        dx = this.pos.x - (o.ax + abx * t); dz = this.pos.z - (o.az + abz * t);
      } else { dx = this.pos.x - o.x; dz = this.pos.z - o.z; }
      d = Math.hypot(dx, dz);
      const reach = o.r + 0.3;
      // near misses
      if (o.kind === 'tree' && d < reach + 1.4 && d > reach && speed > 11 && !this.closeCalls.has(o)) {
        this.closeCalls.add(o);
        this.events.emit('close', { d: d - reach, speed });
      }
      if (d >= reach || this.pos.y > o.top) continue;
      if (o.kind === 'log' || o.kind === 'bump') {
        if (onGround && speed > 5) {
          // pop over it
          this.pos.y += 0.05;
          this.vel.y = Math.max(this.vel.y, 3.2 + speed * 0.12);
          this._takeoff(false);
          this.events.emit('pop', { kind: o.kind });
          return;
        }
      }
      if (speed > 10 && this.state !== 'crash') {
        this.events.emit('hit', { kind: o.kind });
        this.pos.x = (o.kind === 'log' ? this.pos.x : o.x) + (dx / (d || 1)) * reach;
        this.pos.z = (o.kind === 'log' ? this.pos.z : o.z) + (dz / (d || 1)) * reach;
        this.vel.multiplyScalar(0.25);
        this._startCrash('tree');
        return;
      }
      // soft push out
      const nx = dx / (d || 1), nz = dz / (d || 1);
      this.pos.x += nx * (reach - d);
      this.pos.z += nz * (reach - d);
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn < 0) { this.vel.x -= vn * nx; this.vel.z -= vn * nz; }
    }
  }

  _gates() {
    for (const g of this.gates) {
      const abx = g.bx - g.ax, abz = g.bz - g.az;
      const side = Math.sign(abx * (this.pos.z - g.az) - abz * (this.pos.x - g.ax));
      const prev = this.gateSide.get(g.id);
      this.gateSide.set(g.id, side);
      if (prev !== undefined && prev !== side) {
        const t = ((this.pos.x - g.ax) * abx + (this.pos.z - g.az) * abz) / (abx * abx + abz * abz);
        if (t > 0 && t < 1 && this.pos.y < g.y + g.h) this.events.emit('gate', { air: this.state !== 'ground' });
      }
    }
  }

  _stampTrail(ox, oz, nx, nz, speed) {
    const t = this.trail;
    const dig = lerp(0.95, 0.72, clamp(speed / 30, 0, 1));
    const wide = 0.42 + this.carve * 0.12;
    t.stamp(ox, oz, nx, nz, wide, dig, 0.75, 0.75);
    // ski grooves at the bottom of the trench
    const sx = Math.cos(this.yaw) * 0.12, sz = -Math.sin(this.yaw) * 0.12;
    t.stamp(ox + sx, oz + sz, nx + sx, nz + sz, 0.075, Math.min(1, dig + 0.12), 0, 0.1);
    t.stamp(ox - sx, oz - sz, nx - sx, nz - sz, 0.075, Math.min(1, dig + 0.12), 0, 0.1);
  }

  _spray(dt, speed, n) {
    const fx = this.fx;
    const r = Math.random;
    const turnSide = Math.sign(this.steer) || 1;
    // clumps fly to the outside of the turn and up behind the rider
    const rate = (speed * 1.8 + this.carve * speed * 4) * dt;
    let count = Math.floor(rate) + (r() < rate % 1 ? 1 : 0);
    const sideX = Math.cos(this.yaw), sideZ = -Math.sin(this.yaw);  // rider's left
    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
    for (let i = 0; i < count; i++) {
      const out = -turnSide * (0.3 + this.carve) * (0.5 + r());
      const back = -(0.3 + r() * 0.5);
      const up = 1.2 + r() * (1.5 + speed * 0.12) + this.carve * 2;
      const sz = 0.035 + r() * r() * (0.1 + this.carve * 0.12 + speed * 0.003);
      const lat = (r() - 0.5) * 0.8 - turnSide * 0.3;
      fx.clump(
        this.pos.x + sideX * lat - fwdX * 0.4, this.pos.y + 0.05, this.pos.z + sideZ * lat - fwdZ * 0.4,
        this.vel.x * (0.35 + r() * 0.3) + sideX * out * speed * 0.18 + fwdX * back,
        up,
        this.vel.z * (0.35 + r() * 0.3) + sideZ * out * speed * 0.18 + fwdZ * back,
        sz, 1.5 + r() * 2.5);
    }
    const prate = (speed * 0.9 + this.carve * 10) * dt;
    count = Math.floor(prate) + (r() < prate % 1 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      fx.puff(this.pos.x - fwdX * 0.6 + (r() - 0.5), this.pos.y + 0.25 + r() * 0.4, this.pos.z - fwdZ * 0.6 + (r() - 0.5),
        this.vel.x * 0.35 + (r() - 0.5) * 2 - turnSide * sideX * this.carve * 3, 0.8 + r() * 1.6 + this.carve,
        this.vel.z * 0.35 + (r() - 0.5) * 2 - turnSide * sideZ * this.carve * 3,
        0.6 + r() * 0.9 + speed * 0.02, 0.8 + r() * 0.7, 0.22 + this.carve * 0.2);
    }
    // occasional chunk of the trench wall left on the side
    if (r() < speed * dt * 0.9) {
      const s = r() < 0.5 ? -1 : 1;
      fx.clump(this.pos.x + sideX * s * 0.65, this.pos.y + 0.1, this.pos.z + sideZ * s * 0.65,
        sideX * s * 0.8, 0.5, sideZ * s * 0.8, 0.08 + r() * 0.13, 8 + r() * 6);
    }
  }

  // ---------------------------------------------------------------
  _pose(dt, input) {
    const R = this.rider, P = R.pose;
    const speedK = clamp(this.speed / 20, 0, 1);
    const st = this.state;
    const air = this.air;
    this.bodyYaw = damp(this.bodyYaw, 0, 4, dt);
    this.lean = damp(this.lean, st === 'ground' ? -this.steer * (0.25 + speedK * 0.45) : 0, 8, dt);

    P.crouch = damp(P.crouch, st === 'ground' ? 0.25 + this.charge * 0.6 + (input.tuck ? 0.45 : 0) + this.carve * 0.25 : st === 'air' ? 0.45 : 0.1, 10, dt);
    P.tuck = damp(P.tuck, st === 'ground' && input.tuck ? 1 : 0, 8, dt);
    P.lean = this.lean / 0.7;
    P.polePlant = damp(P.polePlant, st === 'ground' ? 1 : 0, 6, dt);
    P.brake = damp(P.brake, st === 'ground' && input.brake ? 1 : 0, 8, dt);
    const flipping = air && Math.abs(air.flipV) > 1;
    P.armsUp = damp(P.armsUp, st === 'air' && air && air.grab < 0.3 ? (flipping ? 0.2 : 0.65) : 0, 7, dt);
    P.grab = air ? air.grab : damp(P.grab, 0, 10, dt);
    P.grabKind = air ? air.grabKind : P.grabKind;
    P.legLift = damp(P.legLift, st === 'air' ? (air && air.grab > 0 ? 0.42 * air.grab : flipping ? 0.3 : 0.12) : 0, 10, dt);
    P.glide = damp(P.glide, st === 'glide' ? 1 : 0, 5, dt);
    P.flail = damp(P.flail, st === 'crash' ? 1 : 0, 6, dt);

    // world orientation
    const root = R.root;
    const sink = st === 'ground' ? (R.firstPerson ? 0.04 : this.sink) : 0;
    root.position.set(this.pos.x, this.pos.y - sink, this.pos.z);

    // align to the slope on the ground, upright in the air
    const n = st === 'ground' ? this.normal : _nv.set(0, 1, 0);
    _q.setFromUnitVectors(Y, _nv.copy(n).lerp(Y, st === 'ground' ? 0.25 : 1).normalize());
    _q2.setFromAxisAngle(Y, this.yaw + this.bodyYaw);
    const target = _q3.copy(_q).multiply(_q2);
    if (st === 'crash') {
      target.multiply(this.tumbleQ);
      _q.setFromAxisAngle(X, -1.2 * Math.min(1, this.crashT * 3));
      target.multiply(_q);
    }
    // smooth the base orientation, then add tricks on top (unsmoothed)
    this.qBody.slerp(target, 1 - Math.exp(-14 * dt));
    root.quaternion.copy(this.qBody);

    const body = R.body;
    body.quaternion.identity();
    if (air && (st === 'air')) {
      _q.setFromAxisAngle(Y, air.spin);
      body.quaternion.multiply(_q);
      // flips rotate around the hips
      _q.setFromAxisAngle(X, air.flip);
      body.quaternion.multiply(_q);
    }
    _q.setFromAxisAngle(Z, this.lean);
    body.quaternion.multiply(_q);
    // lift the pivot to the hips while flipping
    if (air && st === 'air' && Math.abs(air.flip) > 0.01) {
      const pivot = new THREE.Vector3(0, 0.8, 0);
      const rotated = pivot.clone().applyQuaternion(body.quaternion);
      body.position.copy(pivot).sub(rotated);
    } else body.position.set(0, 0, 0);

    // wing
    const w = R.wing;
    if (st === 'glide') {
      w.visible = true;
      w.scale.setScalar(damp(w.scale.x, 1, 4, dt));
      w.rotation.set(-this.pitchIn * 0.15, 0, this.steer * 0.25);
    } else if (w.visible) {
      const s = damp(w.scale.x, 0.01, 6, dt);
      w.scale.setScalar(s);
      if (s < 0.05) w.visible = false;
    }
    R.update(dt);
  }

  get onGround() { return this.state === 'ground'; }
}
