// Trick scoring, combo multiplier and the HUD.
import { clamp } from './util.js';

const COMBO_TIME = 4.0;
const SPIN_NAMES = { 180: '180', 360: '360', 540: '540', 720: '720', 900: '900', 1080: '1080', 1260: '1260', 1440: '1440' };
const ICON = {
  air: '⌁', spin: '↻', flip: '⟳', grab: '✦', close: '⚡', gate: '⛩', pop: '⤴', glide: '☁', switch: '⇄', clean: '✓', powder: '≈',
};

export class Score {
  constructor(el) {
    this.el = el;
    this.total = 0;
    try { this.best = Number(localStorage.getItem('pukh-best') || 0); } catch { this.best = 0; }
    this.combo = 0;
    this.mult = 1;
    this.tricks = 0;
    this.timer = 0;
    this.active = false;
    this.pops = [];
    this.powderAcc = 0;
    this._renderTotals();
  }

  // a trick: points go into the running combo
  add(kind, pts, label, world) {
    pts = Math.round(pts);
    if (pts <= 0) return;
    this.active = true;
    this.combo += pts;
    this.tricks++;
    this.mult = clamp(1 + Math.floor(this.tricks / 2), 1, 10);
    this.timer = COMBO_TIME;
    this._pop(kind, pts, label, world);
    this._renderCombo(true);
  }

  // keep the combo alive while riding fast in fresh snow
  powder(dt, speed, carve) {
    if (!this.active) return;
    if (speed > 14) {
      this.timer = Math.min(COMBO_TIME, this.timer + dt * 0.35 * carve);
      this.powderAcc += dt * speed * (0.5 + carve) * 0.6;
      if (this.powderAcc > 60) { this.add('powder', this.powderAcc, 'целина', null); this.powderAcc = 0; this.tricks--; }
    }
  }

  bank() {
    if (!this.active) return;
    const gain = this.combo * this.mult;
    this.total += gain;
    this._banner('+' + gain.toLocaleString('ru-RU'), false);
    this._reset();
    if (this.total > this.best) {
      this.best = this.total;
      try { localStorage.setItem('pukh-best', String(this.best)); } catch { /* storage unavailable */ }
    }
    this._renderTotals();
  }

  lose(why) {
    if (this.active) this._banner('комбо сгорело', true);
    this._reset();
  }

  _reset() {
    this.active = false; this.combo = 0; this.mult = 1; this.tricks = 0; this.timer = 0; this.powderAcc = 0;
    this._renderCombo(false);
  }

  newRun() {
    this._reset();
    this.total = 0;
    this._renderTotals();
  }

  update(dt, airborne, project) {
    if (this.active && !airborne) {
      this.timer -= dt;
      if (this.timer <= 0) this.bank();
    }
    const ring = this.el.ring;
    if (ring) {
      const f = this.active ? clamp(this.timer / COMBO_TIME, 0, 1) : 0;
      ring.style.strokeDashoffset = String(176 * (1 - f));
    }
    // floating labels follow the rider on screen
    const now = performance.now();
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      const age = (now - p.t0) / 1000;
      if (age > 1.8) { p.node.remove(); this.pops.splice(i, 1); continue; }
      const s = project(p.anchor);
      if (!s) { p.node.style.opacity = '0'; continue; }
      const x = s.x + p.ox, y = s.y - 70 - age * 38 + p.oy;
      p.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      p.node.style.opacity = String(Math.min(1, (1.8 - age) * 2) * Math.min(1, age * 8));
    }
  }

  _pop(kind, pts, label, world) {
    const node = document.createElement('div');
    node.className = 'pop';
    node.innerHTML = `<i>${ICON[kind] || '✦'}</i>${pts}${label ? `<small>${label}</small>` : ''}`;
    this.el.pops.appendChild(node);
    const k = this.pops.length;
    this.pops.push({ node, t0: performance.now(), anchor: world ? world.clone() : null, ox: (k % 2 ? 50 : -90) + Math.random() * 30, oy: -(k % 3) * 22 });
    if (this.pops.length > 8) { this.pops[0].node.remove(); this.pops.shift(); }
  }

  _banner(text, bad) {
    const b = this.el.banner;
    b.textContent = text;
    b.className = bad ? 'bad' : '';
    void b.offsetWidth;
    b.classList.add('show');
  }

  _renderCombo(bump) {
    const e = this.el;
    e.combo.classList.toggle('on', this.active);
    e.comboNum.textContent = this.combo.toLocaleString('ru-RU');
    e.mult.textContent = this.mult > 1 ? 'x' + this.mult : '';
    if (bump) {
      e.combo.classList.remove('bump');
      void e.combo.offsetWidth;
      e.combo.classList.add('bump');
    }
  }

  _renderTotals() {
    this.el.best.textContent = Math.max(this.best, this.total).toLocaleString('ru-RU');
    this.el.total.textContent = this.total.toLocaleString('ru-RU');
  }

  // translate rider events into points
  attach(events, rider) {
    const at = () => rider.root.position.clone().setY(rider.root.position.y + 1.6);
    events.on('land', (e) => {
      if (e.air > 0.45) this.add('air', 40 + e.air * 90 + e.height * 12, e.height > 6 ? 'полёт' : null, at());
      if (e.spin >= 180) this.add('spin', e.spin * 0.9 + (e.spin / 180) ** 2 * 25, SPIN_NAMES[e.spin] || String(e.spin), at());
      if (e.flips > 0) this.add('flip', 380 * e.flips + 120 * (e.flips - 1), (e.flipDir > 0 ? 'фронт' : 'бэк') + (e.flips > 1 ? ' x' + e.flips : ''), at());
      if (e.grabT > 0.15) this.add('grab', 60 + e.grabT * 220 * (1 + (e.grabKinds - 1) * 0.5), e.grabKinds > 1 ? 'захваты' : 'захват', at());
      if (e.switch) this.add('switch', 90, 'свитч', at());
      if (this.active && e.clean && (e.spin >= 360 || e.flips > 0)) this.add('clean', 75, 'чисто', at());
    });
    events.on('close', (e) => this.add('close', 35 + e.speed * 3 + (1.4 - e.d) * 60, 'впритирку', at()));
    events.on('gate', (e) => this.add('gate', e.air ? 450 : 250, 'ворота', at()));
    events.on('pop', () => this.add('pop', 60, null, at()));
    events.on('glideEnd', (e) => { if (e.t > 1) this.add('glide', e.t * 45, 'параплан', at()); });
    events.on('crash', () => this.lose());
  }
}
