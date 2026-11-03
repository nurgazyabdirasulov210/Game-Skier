import * as THREE from '../vendor/three.module.js';
import { heightAt, normalAt, POWDER } from './world.js';

const GRAV = 9.81;
const V = () => new THREE.Vector3();
const _n = V(), _f = V(), _l = V(), _t = V(), _a = V(), _b = V(), _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);

function wrapPi(a) { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; }

export class Player {
  constructor({ props, trail, particles, score, audio }) {
    this.props = props; this.trail = trail; this.fx = particles; this.score = score; this.audio = audio;
    this.pos = V(); this.vel = V(); this.prev = V();
    this.n = new THREE.Vector3(0, 1, 0);
    this.upSm = new THREE.Vector3(0, 1, 0);
    this.quat = new THREE.Quaternion();
    this.near = [];
    this.passed = new WeakSet();
    this.archSide = new WeakMap();
    this.events = [];
    this.reset(0, 0);
  }

  reset(x, z, yaw = 0, speed = 4) {
    this.pos.set(x, heightAt(x, z), z);
    this.prev.copy(this.pos);
    this.yaw = yaw;
    this.vel.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
    this.mode = 'ride';
    this.spin = 0; this.flip = 0; this.spinVel = 0; this.flipVel = 0; this.roll = 0;
    this.airTime = 0; this.grabTime = 0; this.charge = 0; this.crashT = 0;
    this.glideT = 0; this.grind = null; this.grindDist = 0;
    this.lean = 0; this.carve = 0; this.landT = 0; this.yawRate = 0; this.tuck = 0; this.brake = 0;
    this.stillT = 0; this.tumble = 0; this.tumbleAxis = new THREE.Vector3(1, 0, 0);
    this.airPeak = this.pos.y; this.airStartY = this.pos.y;
    this.upSm.set(0, 1, 0);
    this.passed = new WeakSet();
  }

  get speed() { return this.vel.length(); }
  get grounded() { return this.mode === 'ride' || this.mode === 'grind'; }

  // направление «вниз по склону» в точке
  fallLine(x, z) {
    normalAt(x, z, _n, 1.5);
    const a = Math.atan2(_n.x, _n.z);
    return a;
  }

  update(dt, inp) {
    this.events.length = 0;
    this.prev.copy(this.pos);
    switch (this.mode) {
      case 'ride': this.ride(dt, inp); break;
      case 'air': this.air(dt, inp); break;
      case 'glide': this.glideStep(dt, inp); break;
      case 'grind': this.grindStep(dt, inp); break;
      case 'crash': this.crashStep(dt, inp); break;
    }
    if (this.mode !== 'crash') this.collide(dt);
    this.landT = Math.max(0, this.landT - dt * 2.2);
    this.orient(dt);
  }

  // --------------------------------------------------------- езда
  ride(dt, inp) {
    const p = this.pos, v = this.vel;
    normalAt(p.x, p.z, _n);
    this.n.copy(_n);
    const speed = v.length();

    // рулевое управление
    const turnRate = 2.5 - Math.min(1, speed / 30) * 1.15;
    const targetRate = -inp.steer * turnRate * (inp.down > 0.5 ? 1.25 : 1);
    this.yawRate += (targetRate - this.yawRate) * (1 - Math.exp(-dt * 9));
    this.yaw += this.yawRate * dt;

    _f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _f.addScaledVector(_n, -_f.dot(_n)).normalize();
    _l.crossVectors(_n, _f).normalize();

    // гравитация вдоль склона
    _t.set(0, -GRAV, 0); _t.addScaledVector(_n, -_t.dot(_n));
    v.addScaledVector(_t, dt);

    let vf = v.dot(_f), vl = v.dot(_l);
    // кант: боковая скорость переходит в продольную (карвинг)
    this.tuck += ((inp.up > 0.3 ? 1 : 0) - this.tuck) * (1 - Math.exp(-dt * 6));
    this.brake += ((inp.down > 0.3 ? 1 : 0) - this.brake) * (1 - Math.exp(-dt * 8));
    const grip = 7.5 - this.brake * 4.5;
    const nl = vl * Math.exp(-grip * dt);
    const lost = vl * vl - nl * nl;
    const eff = 0.72 - this.brake * 0.6;
    if (vf >= 0) vf = Math.sqrt(vf * vf + lost * eff); else vf = -Math.sqrt(vf * vf + lost * eff);
    this.carve = Math.min(1.5, Math.abs(vl) * 0.35 + Math.abs(this.yawRate) * speed * 0.03);
    vl = nl;

    // сопротивление: воздух + пухляк + торможение
    const sp = Math.hypot(vf, vl);
    let drag = 0.0034 * (1 - this.tuck * 0.45) * sp * sp + 0.75 + 0.03 * sp + this.brake * 5.5;
    if (sp < 0.4) drag = Math.min(drag, sp / dt);
    // отталкивание палками на малой скорости
    if (inp.up > 0.3 && sp < 7) { vf += 3.2 * dt; if (Math.random() < dt * 3) this.events.push('pole'); }
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), drag * dt);

    v.copy(_f).multiplyScalar(vf).addScaledVector(_l, vl);

    // наклон в повороте
    const latAcc = this.yawRate * sp;
    const targetLean = Math.max(-0.75, Math.min(0.75, Math.atan(-latAcc / GRAV) * 0.9));
    this.lean += (targetLean - this.lean) * (1 - Math.exp(-dt * 7));

    // прыжок: удерживаем — приседаем, отпускаем — толчок
    if (inp.jump) this.charge = Math.min(1, this.charge + dt * 2.2);
    else if (this.charge > 0) {
      const c = this.charge; this.charge = 0;
      v.addScaledVector(_n, 3.2 + c * 4.3);
      v.y += 0.6;
      this.takeoff(true);
      this.audio.pop();
      return;
    }

    // шаг и контакт с землёй
    p.addScaledVector(v, dt);
    const h = heightAt(p.x, p.z);
    const d = p.y - h;
    if (d > 0) {
      const gn = GRAV * _n.y;
      const req = (2 * d) / (dt * dt);
      if (req > gn + 34 && d > 0.004) { this.takeoff(false); return; }
    }
    p.y = h;
    normalAt(p.x, p.z, _n);
    v.addScaledVector(_n, -v.dot(_n));

    // застревание на ровном
    if (sp < 0.6) this.stillT += dt; else this.stillT = 0;

    // след и брызги
    const hw = 0.42 + this.brake * 0.25 + Math.min(0.15, Math.abs(vl) * 0.04);
    this.trail.stamp(this.prev.x, this.prev.z, p.x, p.z, hw, 1, 1);
    this.spray(dt, sp, vl);
    this.score.flowTick(dt, sp, this);
  }

  spray(dt, sp, vl) {
    if (sp < 2) return;
    const fx = this.fx;
    const rate = (sp * 4 + this.carve * 55 + this.brake * 70) * dt;
    let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
    const turnSide = Math.sign(this.yawRate) || 1;
    for (let i = 0; i < n; i++) {
      const back = 0.2 + Math.random() * 0.5;
      _a.copy(this.pos).addScaledVector(_f, -back).addScaledVector(_l, (Math.random() - 0.5) * 0.6);
      _a.y += POWDER * 0.55 + Math.random() * 0.25;
      const out = (1.2 + this.carve * 3 + this.brake * 4) * (0.4 + Math.random());
      _b.copy(this.vel).multiplyScalar(0.25 + Math.random() * 0.3)
        .addScaledVector(_l, turnSide * out * (Math.random() < 0.8 ? 1 : -0.5))
        .addScaledVector(this.n, 1.4 + Math.random() * 3.2 + this.carve * 1.2);
      const size = 0.06 + Math.pow(Math.random(), 2) * (0.28 + this.carve * 0.12);
      fx.clump(_a, _b, size, 0.6 + Math.random() * 0.8, 1.2 + Math.random());
    }
    // «носовая волна»: пухляк переваливается через носки лыж в стороны
    const bow = sp * 1.6 * dt;
    let nb = Math.floor(bow) + (Math.random() < bow % 1 ? 1 : 0);
    for (let i = 0; i < nb; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      _a.copy(this.pos).addScaledVector(_f, 0.5 + Math.random() * 0.4).addScaledVector(_l, side * (0.25 + Math.random() * 0.2));
      _a.y += POWDER * 0.9;
      _b.copy(this.vel).multiplyScalar(0.55 + Math.random() * 0.2).addScaledVector(_l, side * (0.8 + Math.random() * 1.6)).addScaledVector(this.n, 0.8 + Math.random() * 1.6);
      fx.clump(_a, _b, 0.05 + Math.random() * 0.14, 0.45 + Math.random() * 0.4, 2.0);
    }
    const mr = (sp * 0.9 + this.carve * 10 + this.brake * 14) * dt;
    if (Math.random() < mr) {
      _a.copy(this.pos).addScaledVector(_f, -0.4); _a.y += POWDER * 0.8;
      _b.copy(this.vel).multiplyScalar(0.3).addScaledVector(_l, turnSide * 2 * this.carve).addScaledVector(this.n, 1.2);
      fx.puff(_a, _b, 0.8 + Math.random() * 0.9 + this.carve * 0.4, 0.22 + this.carve * 0.1, 1.2 + Math.random());
    }
  }

  takeoff(jumped) {
    this.mode = 'air';
    this.airTime = 0; this.spin = 0; this.flip = 0; this.spinVel = 0; this.flipVel = 0; this.grabTime = 0;
    this.airStartY = this.pos.y; this.airPeak = this.pos.y;
    this.jumped = jumped;
    this.airYaw = this.yaw;
    this.charge = 0;
    // облачко на отрыве
    for (let i = 0; i < 10; i++) {
      _a.copy(this.pos); _a.y += POWDER * 0.6;
      _b.set((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3).addScaledVector(this.vel, 0.4);
      this.fx.clump(_a, _b, 0.05 + Math.random() * 0.12, 0.9, 1.5);
    }
  }

  // --------------------------------------------------------- воздух
  air(dt, inp) {
    const p = this.pos, v = this.vel;
    this.airTime += dt;
    v.y -= GRAV * dt;
    const sp = v.length();
    v.multiplyScalar(1 - 0.0012 * sp * dt);
    // вращения
    // без ввода вращение плавно доводится до ближайшего «чистого» положения
    const qs = this.spin / Math.PI, qf = this.flip / (Math.PI * 2);
    const nearSpin = (Math.abs(this.spinVel) > 1.5 ? (this.spinVel > 0 ? Math.ceil(qs - 0.12) : Math.floor(qs + 0.12)) : Math.round(qs)) * Math.PI;
    const nearFlip = (Math.abs(this.flipVel) > 1.5 ? (this.flipVel > 0 ? Math.ceil(qf - 0.08) : Math.floor(qf + 0.08)) : Math.round(qf)) * Math.PI * 2;
    const spinT = Math.abs(inp.steer) > 0.1 ? -inp.steer * 7.2 : Math.max(-6, Math.min(6, (nearSpin - this.spin) * 5));
    const flipT = Math.abs(inp.down - inp.up) > 0.1 ? (inp.down - inp.up) * -6.4 : Math.max(-5.5, Math.min(5.5, (nearFlip - this.flip) * 4.5));
    this.spinVel += (spinT - this.spinVel) * (1 - Math.exp(-dt * 6));
    this.flipVel += (flipT - this.flipVel) * (1 - Math.exp(-dt * 5));
    if (this.airTime < 0.08) { this.spinVel *= 0.5; this.flipVel *= 0.5; }
    this.spin += this.spinVel * dt;
    this.flip += this.flipVel * dt;
    this.inGrab = inp.grab && this.airTime > 0.12;
    if (this.inGrab) this.grabTime += dt;
    // курс по горизонтальной скорости
    if (Math.hypot(v.x, v.z) > 1) this.yaw = Math.atan2(v.x, v.z);
    this.lean *= Math.exp(-dt * 3);

    p.addScaledVector(v, dt);
    this.airPeak = Math.max(this.airPeak, p.y);

    // параплан
    if (this.wantGlide && p.y - heightAt(p.x, p.z) > 2.0 && this.airTime > 0.15) { this.wantGlide = false; this.startGlide(); return; }
    if (this.tryGrind()) return;
    const h = heightAt(p.x, p.z);
    if (p.y <= h) this.land(h);
  }

  land(h) {
    const p = this.pos, v = this.vel;
    p.y = h;
    this.wantGlide = false;
    normalAt(p.x, p.z, _n);
    this.n.copy(_n);
    const impact = Math.max(0, -v.dot(_n));
    const flipRes = Math.abs(wrapPi(this.flip));
    const spinRes = wrapPi(this.spin);
    const absSpin = Math.abs(spinRes);
    const switchLand = absSpin > Math.PI / 2;
    const spinErr = switchLand ? Math.PI - absSpin : absSpin;
    const ok = flipRes < 0.85 && spinErr < 0.9 && impact < 19;
    if (!ok) {
      this.crash(impact > 19 ? 'Жёсткое приземление' : 'Неудачное приземление');
      return;
    }
    // очки за полёт
    const at = this.airTime;
    const tricks = [];
    const spins = Math.round(Math.abs(this.spin) / Math.PI);
    const flips = Math.round(Math.abs(this.flip) / (Math.PI * 2));
    if (spins >= 1) tricks.push(['spin', spins * 180 === 180 ? '180' : 'Винт ' + spins * 180, 90 * spins * spins + 60]);
    if (flips >= 1) {
      const back = this.flip < 0;
      const name = (flips >= 2 ? (flips === 2 ? 'Двойное ' : 'Тройное ') : '') + (back ? 'сальто назад' : 'сальто');
      tricks.push(['flip', name.charAt(0).toUpperCase() + name.slice(1), 650 * flips * flips]);
    }
    if (this.grabTime > 0.25) tricks.push(['grab', this.grabTime > 1.2 ? 'Длинный граб' : 'Граб', Math.round(80 + this.grabTime * 260)]);
    if (at > 0.5) tricks.push(['air', 'Полёт', Math.round(at * 140)]);
    const drop = this.airPeak - h;
    if (drop > 7) tricks.push(['drop', 'Дроп ' + Math.round(drop) + ' м', Math.round(drop * 22)]);
    if (switchLand && spins >= 1) tricks.push(['switch', 'Свитч', 120]);
    if (tricks.length && (spins >= 1 || flips >= 1) && flipRes < 0.3 && spinErr < 0.3) tricks.push(['clean', 'Чисто', 100]);
    for (const [k, name, pts] of tricks) this.score.add(k, name, pts, this.pos);
    // приземление
    v.addScaledVector(_n, -v.dot(_n));
    v.multiplyScalar(0.94 - Math.min(0.2, impact * 0.012));
    this.yaw = Math.atan2(v.x, v.z);
    this.mode = 'ride';
    this.spin = spinRes;
    this.flip = 0; this.spinVel = 0; this.flipVel = 0;
    this.landT = Math.min(1, 0.35 + impact * 0.07);
    this.events.push({ type: 'land', impact });
    this.audio.land(Math.min(1, impact / 12));
    // кратер и взрыв пухляка
    const r = 0.7 + Math.min(0.9, impact * 0.08);
    this.trail.stamp(p.x - v.x * 0.02, p.z - v.z * 0.02, p.x + v.x * 0.03, p.z + v.z * 0.03, r, 1, 1.3);
    const cnt = 18 + Math.floor(impact * 4);
    for (let i = 0; i < cnt; i++) {
      _a.copy(p); _a.x += (Math.random() - 0.5) * r * 1.5; _a.z += (Math.random() - 0.5) * r * 1.5; _a.y += POWDER * 0.7;
      const ang = Math.random() * Math.PI * 2, out = 1.5 + Math.random() * (2 + impact * 0.35);
      _b.set(Math.cos(ang) * out, 2 + Math.random() * (2 + impact * 0.4), Math.sin(ang) * out).addScaledVector(v, 0.35);
      this.fx.clump(_a, _b, 0.06 + Math.pow(Math.random(), 2) * 0.28, 0.8 + Math.random() * 0.8, 1.4);
    }
    for (let i = 0; i < 4 + impact * 0.4; i++) {
      _a.copy(p); _a.y += POWDER;
      _b.set((Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4).addScaledVector(v, 0.3);
      this.fx.puff(_a, _b, 1.2 + Math.random() * 1.5, 0.3, 1.8);
    }
  }

  // --------------------------------------------------------- параплан
  startGlide() {
    this.mode = 'glide';
    this.glideT = 0;
    this.spin = 0; this.flip = 0;
    this.audio.whoosh();
    this.events.push('glideOpen');
  }
  glideStep(dt, inp) {
    const p = this.pos, v = this.vel;
    this.glideT += dt;
    this.airTime += dt;
    const turn = -inp.steer * 1.25;
    this.yawRate += (turn - this.yawRate) * (1 - Math.exp(-dt * 3));
    this.yaw += this.yawRate * dt;
    const dive = inp.up - inp.down;
    const fwd = 13 + dive * 5;
    // крыло держит недолго: со временем снижение ускоряется
    const sink = 2.4 + Math.max(0, this.glideT - 4) * 1.3 + dive * 2.4 - (inp.down > 0.3 ? 0.5 : 0);
    const k = 1 - Math.exp(-dt * 1.6);
    v.x += (Math.sin(this.yaw) * fwd - v.x) * k;
    v.z += (Math.cos(this.yaw) * fwd - v.z) * k;
    v.y += (-sink - v.y) * (1 - Math.exp(-dt * 2.2));
    this.lean += ((this.yawRate * 0.5) * -1 - this.lean) * (1 - Math.exp(-dt * 4));
    p.addScaledVector(v, dt);
    const h = heightAt(p.x, p.z);
    if (this.wantGlide) { this.wantGlide = false; this.mode = 'air'; this.events.push('glideClose'); return; }
    if (p.y - h < 0.9) {
      this.score.add('glide', 'Полёт на крыле', Math.round(this.glideT * 70), p);
      this.events.push('glideClose');
      this.mode = 'air';
      if (p.y <= h) this.land(h);
    }
  }

  // --------------------------------------------------------- брёвна
  tryGrind() {
    const p = this.pos, v = this.vel;
    if (v.y > 1.5) return false;
    for (const it of this.near) {
      if (it.type !== 'log') continue;
      const r = it.rail;
      const dx = r.bx - r.ax, dz = r.bz - r.az;
      const L2 = dx * dx + dz * dz;
      let t = ((p.x - r.ax) * dx + (p.z - r.az) * dz) / L2;
      if (t < 0.02 || t > 0.98) continue;
      const cx = r.ax + dx * t, cz = r.az + dz * t;
      const lat = Math.hypot(p.x - cx, p.z - cz);
      if (lat > 0.55) continue;
      const ry = r.ay + (r.by - r.ay) * t;
      if (p.y < ry - 0.35 || p.y > ry + 0.6) continue;
      // направление по движению
      const dy = r.by - r.ay;
      const L = Math.sqrt(L2 + dy * dy);
      const dirx = dx / L, dirz = dz / L, diry = dy / L;
      const along = v.x * dirx + v.z * dirz;
      if (Math.abs(along) < 2) continue;
      const s = Math.sign(along);
      this.mode = 'grind';
      this.wantGlide = false;
      this.grind = { it, t, dir: s, L };
      this.grindDist = 0;
      const spd = Math.max(4, Math.abs(along));
      v.set(dirx * s * spd, diry * s * spd, dirz * s * spd);
      p.set(cx, ry, cz);
      this.spin = 0; this.flip = 0;
      this.audio.thump(0.2);
      this.events.push('grind');
      return true;
    }
    return false;
  }
  grindStep(dt, inp) {
    const g = this.grind, r = g.it.rail, p = this.pos, v = this.vel;
    const dx = r.bx - r.ax, dz = r.bz - r.az, dy = r.by - r.ay;
    const L = g.L;
    let spd = v.length();
    const slopeAcc = -GRAV * (dy / L) * g.dir;
    spd += (slopeAcc - 0.8) * dt;
    spd = Math.max(1.5, spd);
    g.t += (spd * dt / L) * g.dir;
    this.grindDist += spd * dt;
    this.lean = Math.sin(performance.now() * 0.006) * 0.12;
    this.yaw = Math.atan2(dx * g.dir, dz * g.dir);
    v.set((dx / L) * g.dir * spd, (dy / L) * g.dir * spd, (dz / L) * g.dir * spd);
    p.set(r.ax + dx * g.t, r.ay + dy * g.t, r.az + dz * g.t);
    this.score.keepAlive();
    if (Math.random() < dt * 30) {
      _a.copy(p); _b.set((Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2);
      this.fx.clump(_a, _b, 0.04 + Math.random() * 0.06, 0.6, 2);
    }
    const end = g.t <= 0 || g.t >= 1;
    if (end || (!inp.jump && this.charge > 0)) {
      const pts = Math.round(80 + this.grindDist * 32);
      this.score.add('grind', 'Бревно ' + this.grindDist.toFixed(0) + ' м', pts, p);
      v.y += end ? 1.2 : 4.5;
      this.mode = 'air';
      this.takeoff(true);
      p.y += 0.05;
      this.grind = null;
    }
    if (inp.jump) this.charge = Math.min(1, this.charge + dt * 2);
  }

  // --------------------------------------------------------- падение
  crash(reason) {
    if (this.mode === 'crash') return;
    this.mode = 'crash';
    this.crashT = 0;
    this.tumble = 0;
    this.tumbleAxis.set(Math.random() - 0.5, 0, 1).normalize();
    this.score.fail(reason);
    this.audio.crash();
    this.events.push({ type: 'crash', reason });
    for (let i = 0; i < 40; i++) {
      _a.copy(this.pos); _a.y += POWDER * 0.8 + Math.random() * 0.5;
      _b.set((Math.random() - 0.5) * 5, 1 + Math.random() * 4, (Math.random() - 0.5) * 5).addScaledVector(this.vel, 0.4);
      this.fx.clump(_a, _b, 0.06 + Math.random() * 0.25, 1 + Math.random(), 1.4);
    }
    for (let i = 0; i < 8; i++) {
      _a.copy(this.pos); _a.y += POWDER;
      _b.set((Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4).addScaledVector(this.vel, 0.3);
      this.fx.puff(_a, _b, 1.5 + Math.random() * 1.5, 0.35, 2.2);
    }
  }
  crashStep(dt) {
    const p = this.pos, v = this.vel;
    this.crashT += dt;
    const h = heightAt(p.x, p.z);
    if (p.y > h + 0.05) { v.y -= GRAV * dt; }
    else {
      p.y = h;
      normalAt(p.x, p.z, _n);
      _t.set(0, -GRAV, 0); _t.addScaledVector(_n, -_t.dot(_n));
      v.addScaledVector(_t, dt * 0.6);
      v.addScaledVector(_n, -v.dot(_n));
      const sp = v.length();
      if (sp > 0) v.multiplyScalar(Math.max(0, sp - 9 * dt) / sp);
      this.trail.stamp(this.prev.x, this.prev.z, p.x, p.z, 0.75, 1, 1.1);
    }
    p.addScaledVector(v, dt);
    if (p.y < heightAt(p.x, p.z)) p.y = heightAt(p.x, p.z);
    this.tumble += dt * Math.max(2, v.length() * 1.2) * Math.max(0, 1 - this.crashT / 1.6);
    if (this.crashT > 2.3) {
      const yaw = this.fallLine(p.x, p.z);
      this.mode = 'ride';
      this.yaw = yaw; this.vel.set(Math.sin(yaw) * 2, 0, Math.cos(yaw) * 2);
      this.spin = 0; this.flip = 0; this.tumble = 0; this.lean = 0; this.yawRate = 0;
      this.events.push('getup');
    }
  }

  // --------------------------------------------------------- столкновения
  collide(dt) {
    const p = this.pos, v = this.vel;
    this.nearCool = (this.nearCool || 0) - dt;
    this.props.near(p.x, p.z, this.near);
    const sp = v.length();
    for (const it of this.near) {
      const dx = p.x - it.x, dz = p.z - it.z;
      if (it.type === 'arch') { this.archCheck(it); continue; }
      if (it.type === 'log') {
        // поперёк бревна по земле — автоподскок
        if (this.mode !== 'ride') continue;
        const r = it.rail, ldx = r.bx - r.ax, ldz = r.bz - r.az, L2 = ldx * ldx + ldz * ldz;
        const t = ((p.x - r.ax) * ldx + (p.z - r.az) * ldz) / L2;
        if (t < 0 || t > 1) continue;
        const cx = r.ax + ldx * t, cz = r.az + ldz * t;
        const lat = Math.hypot(p.x - cx, p.z - cz);
        if (lat < 0.6) {
          const L = Math.sqrt(L2);
          const along = Math.abs((v.x * ldx + v.z * ldz) / L);
          if (along > sp * 0.8 && sp > 3) { p.y = r.ay + (r.by - r.ay) * t; this.tryGrind() || (v.y += 3, this.takeoff(true)); }
          else { v.y = Math.max(v.y, 3.2); this.takeoff(true); }
        }
        continue;
      }
      const rr = it.r + 0.28;
      const d2 = dx * dx + dz * dz;
      if (it.type === 'bush') {
        if (d2 < (it.r + 0.4) ** 2 && p.y < it.y + it.h + 0.6) {
          v.multiplyScalar(1 - dt * 1.5);
          if (Math.random() < dt * 20) { _a.set(it.x, p.y + 0.8, it.z); _b.set((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3); this.fx.clump(_a, _b, 0.08 + Math.random() * 0.1, 0.9, 1.5); }
        }
        continue;
      }
      if (p.y > it.y + it.h) continue;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 0.01;
        const nx = dx / d, nz = dz / d;
        const into = -(v.x * nx + v.z * nz);
        if (into > 7 && this.mode !== 'crash') {
          p.x = it.x + nx * rr; p.z = it.z + nz * rr;
          v.x += nx * into * 1.1; v.z += nz * into * 1.1;
          v.multiplyScalar(0.35);
          this.crash(it.type === 'rock' ? 'Камень!' : 'Дерево!');
          this.events.push({ type: 'hit', it });
          return;
        }
        p.x = it.x + nx * rr; p.z = it.z + nz * rr;
        if (into > 0) { v.x += nx * into; v.z += nz * into; }
      } else if (it.type !== 'rock' && it.type !== 'snag' && sp > 13 && d2 < (it.r + 1.1) ** 2 && !this.passed.has(it) && this.nearCool <= 0) {
        this.passed.add(it);
        this.nearCool = 0.5;
        this.score.add('tree', 'Впритирку', 75, it);
      }
    }
  }

  archCheck(it) {
    const p = this.pos;
    const c = Math.cos(it.ry), s = Math.sin(it.ry);
    const dx = p.x - it.x, dz = p.z - it.z;
    // локальные координаты арки: опоры по ±x
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    const ly = p.y - it.y;
    if (Math.abs(lz) < 1.0 && ly < 7.4) {
      const ax = Math.abs(lx);
      if (ax > 2.25 && ax < 4.0 && this.mode !== 'crash') { this.crash('Скала!'); return; }
      if (ax <= 2.25 && ly > 5.9 && ly < 7.6 && this.mode !== 'crash') { this.crash('Скала!'); return; }
    }
    const side = Math.sign(lz);
    const prevSide = this.archSide.get(it);
    this.archSide.set(it, side);
    if (prevSide !== undefined && side !== prevSide && Math.abs(lx) < 2.3 && ly < 6) {
      this.score.add('arch', 'Арка', 350, it);
    }
  }

  // --------------------------------------------------------- ориентация тела
  orient(dt) {
    const air = this.mode === 'air' || this.mode === 'glide';
    const target = air ? _up : this.n;
    this.upSm.lerp(target, 1 - Math.exp(-dt * (air ? 2.5 : 14))).normalize();
    const up = this.upSm;
    _f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _f.addScaledVector(up, -_f.dot(up)).normalize();
    _l.crossVectors(up, _f).normalize();
    _m.makeBasis(_l, up, _f);
    this.quat.setFromRotationMatrix(_m);
    if (this.mode === 'crash') {
      _q.setFromAxisAngle(this.tumbleAxis, this.tumble);
      this.quat.multiply(_q);
      return;
    }
    // после приземления корпус «докручивается» до курса
    if (!air && this.mode !== 'grind') this.spin *= Math.exp(-dt * 12);
    _q.setFromAxisAngle(AY, this.spin); this.quat.multiply(_q);
    _q.setFromAxisAngle(AX, this.flip); this.quat.multiply(_q);
    _q.setFromAxisAngle(AZ, this.lean); this.quat.multiply(_q);
  }

  // состояние для анимации персонажа
  animState() {
    const air = this.mode === 'air';
    const glide = this.mode === 'glide';
    const crouch = this.mode === 'ride' ? 0.22 + this.charge * 0.55 + this.landT * 0.7 + Math.min(0.25, this.carve * 0.12)
      : air ? 0.35 + Math.min(0.4, this.flipVel * this.flipVel * 0.02 + Math.abs(this.spinVel) * 0.02) + (this.grabTime > 0 ? 0.25 : 0)
        : this.mode === 'grind' ? 0.35 : 0.3;
    return {
      crouch: Math.min(1, crouch),
      tuck: this.mode === 'ride' ? this.tuck * (this.speed > 7 ? 1 : 0) : 0,
      lean: this.lean,
      counter: this.mode === 'ride' ? -this.yawRate * 0.12 : 0,
      armOut: air ? 0.9 : this.mode === 'grind' ? 1 : 0.35 + Math.min(0.4, this.carve * 0.2),
      grab: air && this.grabTime > 0 && this.inGrab ? 1 : 0,
      glide: glide ? 1 : 0,
      crash: this.mode === 'crash' ? 1 : 0,
      brake: this.mode === 'ride' ? this.brake : 0,
      splitL: air ? Math.max(0, Math.sin(this.airTime * 3)) * 0.0 : 0,
      splitR: 0,
      look: 0,
      bounce: this.landT,
      skiSplay: air && this.inGrab ? 0.25 : 0,
    };
  }
}
