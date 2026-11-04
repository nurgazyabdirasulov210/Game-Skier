// Skier physics and game logic: carving on the slope, jumps, spins and
// flips in the air, landings, log slides, collisions, crashes, paraglider.
import * as THREE from 'three';
import { heightAt, normalAt, LAKE } from '../terrain.js';
import { MAP } from '../config.js';

const G = 11;
const UP = new THREE.Vector3(0, 1, 0);
const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const clamp = THREE.MathUtils.clamp;

class Grid {
  constructor(items, cell = 16) {
    this.cell = cell;
    this.map = new Map();
    for (const it of items) {
      const k = `${Math.floor(it.x / cell)},${Math.floor(it.z / cell)}`;
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(it);
    }
  }
  near(x, z, out) {
    out.length = 0;
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const l = this.map.get(`${cx + a},${cz + b}`);
      if (l) for (const it of l) out.push(it);
    }
    return out;
  }
}

export class Skier {
  constructor({ world, rider, trail, spray, score, audio }) {
    this.world = world;
    this.rider = rider;
    this.trail = trail;
    this.spray = spray;
    this.score = score;
    this.audio = audio;
    this.surfaceAt = world.terrain.surfaceAt;
    const cols = [...world.veg.colliders, ...world.props.colliders];
    this.grid = new Grid(cols);
    this.logs = world.props.logs.map((l) => ({ ...l, x: (l.a.x + l.b.x) / 2, z: (l.a.z + l.b.z) / 2 }));
    this.logGrid = new Grid(this.logs, 30);
    this.tmp = [];

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.n = new THREE.Vector3(0, 1, 0);
    this.heading = 0;
    this.mode = 'ground';
    this.contact = true;
    this.offTime = 0;
    this.input = { steer: 0, lean: 0, jump: false, grab: false };
    this.jumpCharge = 0;
    this.air = null;
    this.grind = null;
    this.crashT = 0;
    this.safe = [];
    this.safeT = 0;
    this.nearMissed = new Set();
    this.speedAcc = 0;
    this.speedT = 0;
    this.carve = 0;
    this.impact = 0;
    this.trailT = 0;
    this.distance = 0;
    this.finished = false;
    this.onFinish = null;

    this.v1 = new THREE.Vector3();
    this.v2 = new THREE.Vector3();
    this.f = new THREE.Vector3();
    this.r = new THREE.Vector3();
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
  }

  get speed() { return this.vel.length(); }
  get grounded() { return this.mode === 'ground' || this.mode === 'grind'; }

  spawn(x, z, speed = 6) {
    const n = normalAt(x, z);
    this.heading = Math.atan2(n.x, n.z);
    this.pos.set(x, heightAt(x, z), z);
    this.vel.set(Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(speed);
    this.mode = 'ground';
    this.contact = true;
    this.air = null;
    this.grind = null;
    this.crashT = 0;
    this.safe = [];
    this.finished = false;
    this.trail.break();
    this.rider.target.tumble = 0;
    this.rider.pivot.rotation.set(0, 0, 0);
    this.rider.target.wing = 0;
  }

  /** Ski direction on the slope and its right vector. */
  frame(n) {
    this.f.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.f.addScaledVector(n, -this.f.dot(n)).normalize();
    this.r.crossVectors(n, this.f).normalize();
  }

  // ------------------------------------------------------------------ step
  update(dt) {
    const sub = Math.ceil(dt / (1 / 120));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) this.step(h);
    this.effects(dt);
    this.pose(dt);
  }

  step(dt) {
    const inp = this.input;
    if (this.mode === 'crash') return this.stepCrash(dt);
    if (this.mode === 'grind') return this.stepGrind(dt);
    if (this.mode === 'glide') return this.stepGlide(dt);

    // gravity + ballistic motion
    this.vel.y -= G * dt;
    const ground = heightAt(this.pos.x, this.pos.z);
    const n = normalAt(this.pos.x, this.pos.z, this.n);

    if (this.contact) {
      this.frame(n);
      // keep velocity in the tangent plane while in contact
      const vn = this.vel.dot(n);
      if (vn < 0) this.vel.addScaledVector(n, -vn);
      let vf = this.vel.dot(this.f), vs = this.vel.dot(this.r);
      const speed = Math.hypot(vf, vs);
      const speed0 = speed;
      const brake = inp.lean < -0.3;
      const tuck = inp.lean > 0.3;

      // riding switch for a while: pivot back to forward (velocity is kept)
      if (vf < -0.5 && speed > 3) this.switchT = (this.switchT || 0) + dt; else this.switchT = 0;
      if (this.switchT > 0.9 || this.reverting) {
        this.reverting = true;
        const target = Math.atan2(this.vel.x, this.vel.z);
        const diff = ((target - this.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        this.heading += Math.sign(diff) * Math.min(Math.abs(diff), 7 * dt);
        if (Math.abs(diff) < 0.05) { this.reverting = false; this.switchT = 0; }
        this.backwards = false;
        return this.integrate(dt, n);
      }
      // steering
      const turn = inp.steer * THREE.MathUtils.lerp(2.6, 1.35, clamp(speed / 30, 0, 1)) * (brake ? 1.4 : 1);
      this.heading += turn * dt * (this.backwards ? -1 : 1) * (this.jumpCharge > 0 ? 0.6 : 1);

      // edge grip turns sideways motion into forward motion (carving)
      const grip = brake ? 2.2 : 7.5;
      const newVs = vs * Math.exp(-grip * dt);
      const lost = Math.abs(vs - newVs);
      const dirSign = vf >= 0 ? 1 : -1;
      vf += dirSign * lost * (brake ? 0.15 : 0.62);
      this.carve = clamp(lost / Math.max(dt, 1e-4) / 18, 0, 1.5);

      // drag: air + powder + braking
      const k = tuck ? 0.0024 : 0.0042;
      let drag = k * vf * vf + 0.45 + (brake ? 6 + 0.02 * vf * vf : 0);
      if (this.jumpCharge > 0) drag += 0.4;
      const nvf = vf - dirSign * drag * dt;
      vf = Math.sign(nvf) === dirSign ? nvf : 0;

      const tangent = this.v1.copy(this.f).multiplyScalar(vf).addScaledVector(this.r, newVs);
      // carving never adds energy: it only redirects (and slightly scrubs) speed
      const maxMag = speed0 * (1 - Math.min(0.5, lost * 0.012));
      if (tangent.length() > maxMag) tangent.setLength(maxMag);
      // keep gravity's pull (already in vel.y) by re-adding the normal-free remainder
      this.vel.copy(tangent);
      this.backwards = vf < -0.5;
    }
    this.integrate(dt, n);
  }

  integrate(dt, n) {
    const inp = this.input;
    if (this.contact && this.reverting) {
      const vn = this.vel.dot(n);
      if (vn < 0) this.vel.addScaledVector(n, -vn);
      this.vel.multiplyScalar(1 - 0.15 * dt);
    }
    if (this.vel.lengthSq() > 48 * 48) this.vel.setLength(48);
    this.pos.addScaledVector(this.vel, dt);
    this.bounds();

    // contact with the snow
    const g2 = heightAt(this.pos.x, this.pos.z);
    const gap = this.pos.y - g2;
    const stick = this.contact ? 0.04 + 0.0025 * this.speed : 0;
    if (gap <= stick) {
      const n2 = normalAt(this.pos.x, this.pos.z, this.n);
      const into = -this.vel.dot(n2);
      this.pos.y = g2;
      if (into > 0) this.vel.addScaledVector(n2, into);
      if (this.mode === 'air') this.land(into, n2);
      this.contact = true;
      this.offTime = 0;
    } else {
      this.contact = false;
      this.offTime += dt;
      if (this.mode === 'ground' && (gap > 0.45 || this.offTime > 0.18)) this.takeOff(false);
    }

    // jump: hold to crouch, release to pop
    if (this.mode === 'ground') {
      if (inp.jump) this.jumpCharge = Math.min(1, this.jumpCharge + dt * 2.2);
      else if (this.jumpCharge > 0) {
        const pop = 4.2 + this.jumpCharge * 3.8;
        this.vel.addScaledVector(this.n, pop).addScaledVector(UP, pop * 0.25);
        this.pos.addScaledVector(this.n, 0.08);
        this.jumpCharge = 0;
        this.contact = false;
        this.takeOff(true);
      }
    }

    if (this.mode === 'air') this.stepAir(dt);
    this.collide();
    this.checkLogs();
  }

  bounds() {
    const mx = MAP.halfX - 6, mz = MAP.halfZ - 6;
    if (Math.abs(this.pos.x) > mx) { this.pos.x = Math.sign(this.pos.x) * mx; this.vel.x *= -0.3; }
    if (this.pos.z < -mz) { this.pos.z = -mz; this.vel.z = Math.abs(this.vel.z) * 0.3; }
    if (this.pos.z > mz) { this.pos.z = mz; this.vel.z *= -0.3; }
  }

  takeOff(jumped) {
    this.mode = 'air';
    this.contact = false;
    this.air = {
      t: 0, spin: 0, flip: 0, spinVel: 0, flipVel: 0, grab: 0, jumped,
      startH: this.pos.y, maxGap: 0, baseHeading: this.heading, glided: false,
    };
    this.trail.break();
  }

  stepAir(dt) {
    const a = this.air;
    const inp = this.input;
    a.t += dt;
    this.vel.multiplyScalar(Math.exp(-dt * 0.04));
    const gap = this.pos.y - heightAt(this.pos.x, this.pos.z);
    a.maxGap = Math.max(a.maxGap, gap);
    // spins (A/D) and flips (W/S); without input they ease toward a clean landing angle
    if (Math.abs(inp.steer) > 0.5 && (gap > 0.5 || a.t > 0.3)) {
      a.spinVel += (inp.steer * 8 - a.spinVel) * (1 - Math.exp(-dt * 6));
      a.spinTarget = null;
    } else {
      // finish the half turn you are in, lined up with the direction of flight
      if (a.spinTarget == null) {
        const velYaw = Math.atan2(this.vel.x, this.vel.z);
        const rel = a.baseHeading + a.spin - velYaw;
        a.spinTarget = Math.round(rel / Math.PI + 0.3 * Math.sign(a.spinVel)) * Math.PI - a.baseHeading + velYaw;
      }
      a.spinVel += ((a.spinTarget - a.spin) * 6 - a.spinVel) * (1 - Math.exp(-dt * 5));
    }
    if (Math.abs(inp.lean) > 0.3 && gap > 0.8) a.flipVel += (inp.lean * 7 - a.flipVel) * (1 - Math.exp(-dt * 5));
    else {
      const target = Math.round(a.flip / (Math.PI * 2) + 0.25 * Math.sign(a.flipVel)) * Math.PI * 2;
      a.flipVel += ((target - a.flip) * 5 - a.flipVel) * (1 - Math.exp(-dt * 5));
    }
    a.spin += a.spinVel * dt;
    a.flip += a.flipVel * dt;
    if (inp.grab) a.grab += dt;
  }

  land(into, n) {
    const a = this.air;
    this.mode = 'ground';
    this.air = null;
    if (!a) return;
    const velYaw = Math.atan2(this.vel.x, this.vel.z);
    const yaw = a.baseHeading + a.spin;
    const off = wrap(yaw - velYaw);
    const flipOff = wrap(a.flip);
    const slow = Math.hypot(this.vel.x, this.vel.z) < 5;
    const forward = Math.abs(off) < 1.1 || slow;
    const sw = !slow && Math.abs(off) > Math.PI - 1.1;
    const hard = into > 19;
    this.lastLand = { off: +off.toFixed(2), flip: +flipOff.toFixed(2), into: +into.toFixed(1), t: +a.t.toFixed(2), spin: +a.spin.toFixed(2) };
    if ((!forward && !sw) || Math.abs(flipOff) > 0.95 || hard) {
      this.heading = yaw;
      this.crash(hard ? 'Жёсткое приземление' : 'Падение');
      return;
    }
    this.heading = slow ? yaw : sw ? velYaw + Math.PI : velYaw;
    this.impact = clamp(into / 12, 0, 1.4);
    this.spray.burst(this.pos, this.vel, 0.35 + this.impact);
    this.audio.thump(this.impact);
    // score
    const s = this.score;
    let tricks = 0;
    const spins = Math.round(Math.abs(a.spin) / Math.PI);
    if (spins >= 1) { s.add('spin', spins * 180 * 1.2, `${spins * 180}`); tricks++; }
    const flips = Math.round(Math.abs(a.flip) / (Math.PI * 2));
    if (flips >= 1) { s.add('flip', flips * 650, flips > 1 ? `сальто ×${flips}` : (a.flip > 0 ? 'сальто вперёд' : 'сальто назад')); tricks++; }
    if (a.grab > 0.25) { s.add('grab', 120 + a.grab * 220, `захват ${a.grab.toFixed(1)} с`); tricks++; }
    if (a.t > 0.7) { s.add('air', a.t * 110, `${a.t.toFixed(1)} с`, tricks === 0); }
    if (a.glided) s.add('glide', a.t * 40, `полёт ${Math.round(a.t)} с`, false);
    if (sw && tricks) s.add('switch', 150, 'свитч');
    if (tricks && Math.abs(off) < 0.25 && Math.abs(flipOff) < 0.25) s.add('clean', 80, 'чисто', false);
  }

  crash(reason) {
    if (this.mode === 'crash') return;
    this.lastCrash = reason;
    this.mode = 'crash';
    this.crashT = 0;
    this.air = null;
    this.grind = null;
    this.rider.target.tumble = 1;
    this.rider.target.wing = 0;
    this.tumbleSpin = new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 9);
    this.spray.burst(this.pos, this.vel, 1.2);
    this.audio.thump(1);
    this.score.lose(reason);
    this.trail.break();
    this.shake = 1;
  }

  stepCrash(dt) {
    this.crashT += dt;
    this.vel.y -= G * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.bounds();
    const g = heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < g) {
      this.pos.y = g;
      const n = normalAt(this.pos.x, this.pos.z, this.n);
      const into = -this.vel.dot(n);
      if (into > 0) this.vel.addScaledVector(n, into * 1.3);
      this.vel.multiplyScalar(Math.exp(-dt * 2.2));
      if (Math.random() < dt * 25 && this.vel.length() > 2) this.spray.burst(this.pos, this.vel, 0.15);
    }
    const p = this.rider.pivot.rotation;
    const k = Math.exp(-this.crashT * 1.2);
    p.x += this.tumbleSpin.x * dt * k;
    p.y += this.tumbleSpin.y * dt * k;
    p.z += this.tumbleSpin.z * dt * k;
    if (this.crashT > 2.3) this.respawn();
  }

  respawn() {
    const s = this.safe.length ? this.safe[0] : { x: this.pos.x, z: this.pos.z };
    this.spawn(s.x, s.z, 8);
    this.score.flash('Снова в путь');
  }

  // ------------------------------------------------------------ obstacles
  collide() {
    const list = this.grid.near(this.pos.x, this.pos.z, this.tmp);
    const sp = this.speed;
    for (const c of list) {
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const R = c.r + 0.35;
      if (c.top !== undefined && this.pos.y > c.top - 0.15) continue;
      if (c.kind === 'tree' && this.pos.y > heightAt(c.x, c.z) + 14) continue;
      if (d < R) {
        if (sp > 9.5 && this.mode !== 'crash') {
          this.crash(c.kind === 'tree' ? 'Дерево!' : 'Камень!');
          this.vel.set(dx / (d || 1), 0.4, dz / (d || 1)).multiplyScalar(sp * 0.25);
          return;
        }
        // slow bump: push out and bounce off
        const nx = dx / (d || 1), nz = dz / (d || 1);
        this.pos.x = c.x + nx * R;
        this.pos.z = c.z + nz * R;
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) { this.vel.x -= nx * vn * 1.4; this.vel.z -= nz * vn * 1.4; }
      } else if (c.kind === 'tree' && d < R + 1.4 && sp > 13 && this.mode !== 'crash' && !this.nearMissed.has(c)) {
        this.nearMissed.add(c);
        this.score.add('near', 40 + sp * 2, `${Math.round(40 + sp * 2)}`);
        if (this.nearMissed.size > 200) this.nearMissed.clear();
      }
    }
  }

  /** Logs: slide along them, or bump off them like a small kicker. */
  checkLogs() {
    if (this.mode !== 'ground' && this.mode !== 'air') return;
    const list = this.logGrid.near(this.pos.x, this.pos.z, this.tmp);
    for (const L of list) {
      const ab = this.v1.subVectors(L.b, L.a);
      const len = ab.length();
      const dir = ab.divideScalar(len);
      const ap = this.v2.subVectors(this.pos, L.a);
      const t = ap.dot(dir);
      if (t < 0.3 || t > len - 0.3) continue;
      const cx = L.a.x + dir.x * t, cz = L.a.z + dir.z * t;
      const lateral = Math.hypot(this.pos.x - cx, this.pos.z - cz);
      if (lateral > L.r + 0.35) continue;
      const top = L.a.y + dir.y * t + L.r;
      const dy = this.pos.y - top;
      const hv = Math.hypot(this.vel.x, this.vel.z);
      const align = hv > 0.1 ? Math.abs((this.vel.x * dir.x + this.vel.z * dir.z) / hv) : 0;
      if (dy > -0.6 && dy < 0.9 && this.vel.y < 2.5 && (align > 0.8 || this.mode === 'air') && align > 0.55) {
        this.startGrind(L, t, dir);
        return;
      }
      if (this.mode === 'ground' && dy < 0 && dy > -L.r * 2.2 && hv > 5) {
        // hit the log across: it throws you up
        this.vel.y = Math.max(this.vel.y, 2.5 + hv * 0.12);
        this.pos.y = top + 0.05;
        this.contact = false;
        this.takeOff(false);
        return;
      }
    }
  }

  startGrind(L, t, dir) {
    const vAlong = this.vel.dot(dir);
    const sign = vAlong >= 0 ? 1 : -1;
    const wasAir = this.mode === 'air';
    this.grind = { L, t, sign, speed: Math.max(4, Math.abs(vAlong)), dist: 0, len: L.a.distanceTo(L.b) };
    this.mode = 'grind';
    this.air = null;
    this.heading = Math.atan2(dir.x * sign, dir.z * sign) + (wasAir ? 0 : 0);
    this.trail.break();
    this.spray.burst(this.pos, this.vel, 0.2);
    this.audio.thump(0.3);
  }

  stepGrind(dt) {
    const g = this.grind;
    const L = g.L;
    const dir = this.v1.subVectors(L.b, L.a).normalize();
    // gravity along the log and a little friction
    g.speed += -G * dir.y * g.sign * dt - 0.8 * dt;
    g.t += g.sign * g.speed * dt;
    g.dist += g.speed * dt;
    const r = L.r;
    this.pos.copy(L.a).addScaledVector(dir, g.t);
    this.pos.y += r + 0.02;
    this.vel.copy(dir).multiplyScalar(g.speed * g.sign);
    const off = g.t < 0 || g.t > g.len || g.speed < 1 || this.input.jump;
    if (off) {
      const pts = Math.round(g.dist * 28);
      if (pts > 20) this.score.add('grind', pts, `бревно ${g.dist.toFixed(0)} м`);
      this.grind = null;
      this.vel.y += this.input.jump ? 5.5 : 1.5;
      this.jumpCharge = 0;
      this.pos.y += 0.1;
      this.contact = false;
      this.takeOff(true);
    }
  }

  // ------------------------------------------------------------ paraglider
  toggleWing() {
    if (this.mode === 'glide') {
      this.mode = 'air';
      this.rider.target.wing = 0;
      return;
    }
    if (this.mode !== 'air') return;
    const gap = this.pos.y - heightAt(this.pos.x, this.pos.z);
    if (gap < 3) return;
    this.mode = 'glide';
    this.air.glided = true;
    this.air.spin = Math.round(this.air.spin / (Math.PI * 2)) * Math.PI * 2;
    this.air.flip = Math.round(this.air.flip / (Math.PI * 2)) * Math.PI * 2;
    this.heading = Math.atan2(this.vel.x, this.vel.z);
    this.air.baseHeading = this.heading;
    this.air.spin = 0; this.air.flip = 0; this.air.spinVel = 0; this.air.flipVel = 0;
    this.rider.target.wing = 1;
  }

  stepGlide(dt) {
    const inp = this.input;
    const a = this.air;
    a.t += dt;
    this.heading += inp.steer * 0.95 * dt;
    a.baseHeading = this.heading;
    const fwdSpeed = 13 + inp.lean * 5;
    const sink = inp.lean > 0.3 ? -4.5 : inp.lean < -0.3 ? -0.7 : -1.6;
    const tx = Math.sin(this.heading) * fwdSpeed, tz = Math.cos(this.heading) * fwdSpeed;
    const k = 1 - Math.exp(-dt * 1.2);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;
    this.vel.y += (sink - this.vel.y) * (1 - Math.exp(-dt * 1.5));
    this.pos.addScaledVector(this.vel, dt);
    this.bounds();
    const g = heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= g + 0.05) {
      this.pos.y = g;
      this.rider.target.wing = 0;
      this.mode = 'air';
      const n = normalAt(this.pos.x, this.pos.z, this.n);
      const into = Math.max(0, -this.vel.dot(n));
      this.vel.addScaledVector(n, into);
      this.land(into * 0.5, n);
      this.contact = true;
    }
    this.collide();
  }

  // ------------------------------------------------------------ effects
  effects(dt) {
    const sp = this.speed;
    const inp = this.input;
    // safe points for respawn
    this.safeT += dt;
    if (this.mode === 'ground' && sp > 3 && this.safeT > 0.5) {
      this.safeT = 0;
      this.safe.push({ x: this.pos.x, z: this.pos.z });
      if (this.safe.length > 5) this.safe.shift();
    }
    if (this.mode === 'ground') {
      this.distance += sp * dt;
      const n = this.n;
      this.frame(n);
      const sy = this.surfaceAt(this.pos.x, this.pos.z);
      // trench behind the skis
      const travel = this.v2.copy(this.vel).addScaledVector(n, -this.vel.dot(n));
      if (travel.lengthSq() > 0.25) {
        travel.normalize();
        const brake = inp.lean < -0.3 ? 1 : 0;
        const width = 0.5 + Math.min(0.35, this.carve * 0.25) + brake * 0.25;
        this.trail.add(new THREE.Vector3(this.pos.x, sy, this.pos.z), n, travel, width, 0.75 + Math.min(0.25, sp / 60));
      }
      // spray: chunky rooster tail from the skis, more when carving or braking
      const brake = inp.lean < -0.3 ? 1 : 0;
      const rate = sp * (0.6 + this.carve * 2.2 + brake * 3) + (this.jumpCharge > 0 ? 4 : 0);
      let count = rate * dt;
      const side = Math.sign(this.vel.dot(this.r)) || (inp.steer >= 0 ? -1 : 1);
      while (count > 0) {
        if (Math.random() > count) break;
        count -= 1;
        const back = 0.4 + Math.random() * 0.6;
        const px = this.pos.x - this.f.x * back + this.r.x * (Math.random() - 0.5) * 0.6;
        const pz = this.pos.z - this.f.z * back + this.r.z * (Math.random() - 0.5) * 0.6;
        const up = 1.5 + Math.random() * (2 + sp * 0.12) + this.carve * 2;
        const kick = (this.carve * 0.35 + brake * 0.4) * sp;
        const vx = this.vel.x * 0.55 - this.r.x * side * kick * (0.5 + Math.random()) + (Math.random() - 0.5) * 2;
        const vz = this.vel.z * 0.55 - this.r.z * side * kick * (0.5 + Math.random()) + (Math.random() - 0.5) * 2;
        if (Math.random() < 0.85) {
          this.spray.clump(px, sy + 0.15, pz, vx, up, vz, 0.1 + Math.random() * (0.16 + this.carve * 0.14 + brake * 0.12), 0.6 + Math.random() * 0.8);
        }
        if (Math.random() < 0.6) this.spray.puff(px, sy + 0.25, pz, vx * 0.7, up * 0.5, vz * 0.7, 0.3 + Math.random() * 0.4, 0.7 + Math.random() * 0.8);
      }
      // continuous speed points
      if (sp > 20) {
        this.speedAcc += (sp - 20) * 9 * dt;
        this.speedT += dt;
        if (this.speedT > 1.4) {
          this.score.add('speed', this.speedAcc, `${Math.round(this.speedAcc)}`, false);
          this.speedAcc = 0;
          this.speedT = 0;
        }
      } else { this.speedT = 0; this.speedAcc = 0; }
    } else if (this.mode === 'grind') {
      if (Math.random() < dt * 30) {
        this.spray.puff(this.pos.x, this.pos.y, this.pos.z, (Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2, 0.3, 0.6);
        this.spray.clump(this.pos.x, this.pos.y, this.pos.z, (Math.random() - 0.5) * 3, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.06 + Math.random() * 0.08, 0.7);
      }
    } else if (this.mode === 'air' && this.air && this.air.t < 0.4 && Math.random() < dt * 20) {
      this.spray.puff(this.pos.x, this.pos.y, this.pos.z, this.vel.x * 0.6, this.vel.y * 0.4, this.vel.z * 0.6, 0.4, 0.8);
    }
    this.audio.update(sp, this.carve, this.mode === 'ground');
    this.impact *= Math.exp(-dt * 6);
    if (this.shake) this.shake *= Math.exp(-dt * 4);

    if (!this.finished && this.pos.z > LAKE.z - LAKE.rz - 60 && this.mode !== 'crash') {
      this.finished = true;
      this.onFinish?.();
    }
  }

  // ------------------------------------------------------------ rider pose
  pose(dt) {
    const R = this.rider;
    const T = R.target;
    const inp = this.input;
    const sink = this.mode === 'ground' ? (this.sinkDepth ?? 0.12) : 0;
    R.root.position.set(this.pos.x, this.pos.y - sink, this.pos.z);

    // up vector: slope normal on the ground, world up in the air
    const up = this.mode === 'ground' || this.mode === 'grind' ? this.n : UP;
    this.smoothUp = this.smoothUp || new THREE.Vector3(0, 1, 0);
    this.smoothUp.lerp(up, 1 - Math.exp(-dt * 12)).normalize();
    let yaw = this.heading;
    if (this.air && this.mode !== 'glide') yaw = this.air.baseHeading + this.air.spin;
    const f = this.v1.set(Math.sin(yaw), 0, Math.cos(yaw));
    f.addScaledVector(this.smoothUp, -f.dot(this.smoothUp)).normalize();
    const r = this.v2.crossVectors(this.smoothUp, f).normalize();
    this.m.makeBasis(r, this.smoothUp, f);
    R.root.quaternion.setFromRotationMatrix(this.m);

    if (this.mode !== 'crash') {
      R.pivot.rotation.set(this.air && this.mode !== 'glide' ? this.air.flip : 0, 0, 0);
      T.tumble = 0;
    }
    const sp = this.speed;
    if (this.mode === 'ground') {
      T.crouch = 0.25 + (inp.lean > 0.3 ? 0.45 : 0) + this.jumpCharge * 0.45 + this.impact * 0.5 + (inp.lean < -0.3 ? 0.15 : 0);
      T.lean = clamp(inp.steer * clamp(sp / 18, 0.2, 1.1) * (this.backwards ? -1 : 1), -1, 1);
      T.arms = inp.lean > 0.3 ? 0 : 0.15;
      T.grab = 0;
      T.skiSpread = 0;
    } else if (this.mode === 'air') {
      T.crouch = inp.grab ? 0.7 : 0.35;
      T.lean = 0;
      T.arms = 1;
      T.grab = inp.grab ? 1 : 0;
      T.skiSpread = 0.4;
    } else if (this.mode === 'grind') {
      T.crouch = 0.45;
      T.lean = Math.sin(performance.now() / 180) * 0.25;
      T.arms = 0.8;
      T.grab = 0;
    } else if (this.mode === 'glide') {
      T.crouch = 0.6;
      T.lean = inp.steer * 0.6;
      T.arms = 0.2;
      T.grab = 0;
    }
    R.update(dt);
  }
}
