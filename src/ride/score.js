// Trick scoring: points go into a combo with a multiplier and a ring timer;
// when the timer runs out the combo is banked. Small popups float next to
// the skier for every trick.
import * as THREE from 'three';

export const ICONS = {
  spin: '↻', flip: '⟲', air: '☁', speed: '⚡', near: '✦', grind: '═', grab: '✋', clean: '✓', switch: '⇄', glide: '◠',
};

const COMBO_TIME = 3.6;

export class Score {
  constructor(camera) {
    this.camera = camera;
    this.total = 0;
    this.best = 0;
    try { this.best = Number(localStorage.getItem('dolina-best') || 0); } catch (e) { /* storage blocked */ }
    this.pending = 0;
    this.mult = 1;
    this.chain = 0;
    this.timer = 0;
    this.hold = false;
    this.el = {
      total: document.getElementById('total'),
      best: document.getElementById('best'),
      combo: document.getElementById('combo'),
      comboNum: document.getElementById('combo-num'),
      mult: document.getElementById('combo-mult'),
      ring: document.getElementById('combo-ring'),
      pops: document.getElementById('pops'),
      banner: document.getElementById('banner'),
    };
    this.pops = [];
    this.anchor = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.refresh();
  }

  /** A trick or event. kind: key of ICONS. */
  add(kind, points, label, extendChain = true) {
    points = Math.round(points);
    if (points <= 0) return;
    this.pending += points * this.mult;
    this.timer = COMBO_TIME;
    if (extendChain) {
      this.chain++;
      this.mult = Math.min(5, 1 + Math.floor(this.chain / 3));
    }
    this.popup(`${ICONS[kind] || ''} ${label ?? points}`);
    this.refresh(true);
  }

  popup(text) {
    const d = document.createElement('div');
    d.className = 'pop';
    d.textContent = text;
    this.el.pops.appendChild(d);
    const a = Math.random() * Math.PI * 2;
    this.pops.push({ d, t: 0, ox: Math.cos(a) * (40 + Math.random() * 70), oy: -40 + Math.sin(a) * 50 });
    if (this.pops.length > 14) { const p = this.pops.shift(); p.d.remove(); }
  }

  bank() {
    if (this.pending <= 0) return;
    this.total += this.pending;
    this.flash(`+${this.pending.toLocaleString('ru-RU')}`);
    this.pending = 0;
    this.chain = 0;
    this.mult = 1;
    if (this.total > this.best) {
      this.best = this.total;
      try { localStorage.setItem('dolina-best', String(this.best)); } catch (e) { /* ignore */ }
    }
    this.refresh();
  }

  lose(text = 'Падение') {
    if (this.pending > 0) this.flash(`${text}: −${this.pending.toLocaleString('ru-RU')}`, true);
    else this.flash(text, true);
    this.pending = 0;
    this.chain = 0;
    this.mult = 1;
    this.timer = 0;
    this.refresh();
  }

  flash(text, bad = false) {
    const b = this.el.banner;
    b.textContent = text;
    b.classList.toggle('bad', bad);
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  resetRun() {
    this.total = 0;
    this.pending = 0;
    this.chain = 0;
    this.mult = 1;
    this.timer = 0;
    this.refresh();
  }

  refresh(bump = false) {
    this.el.total.textContent = this.total.toLocaleString('ru-RU');
    this.el.best.textContent = this.best.toLocaleString('ru-RU');
    this.el.comboNum.textContent = this.pending.toLocaleString('ru-RU');
    this.el.mult.textContent = this.mult > 1 ? `×${this.mult}` : '';
    this.el.combo.classList.toggle('on', this.pending > 0);
    if (bump) {
      this.el.combo.classList.remove('bump');
      void this.el.combo.offsetWidth;
      this.el.combo.classList.add('bump');
    }
  }

  /** hold: true while airborne/grinding (the combo timer waits). */
  update(dt, anchorWorld, hold) {
    if (this.pending > 0 && !hold) {
      this.timer -= dt;
      if (this.timer <= 0) this.bank();
    }
    const frac = this.pending > 0 ? Math.max(0, this.timer / COMBO_TIME) : 0;
    this.el.ring.style.strokeDashoffset = String(176 * (1 - frac));

    this.v.copy(anchorWorld).project(this.camera);
    const sx = (this.v.x * 0.5 + 0.5) * innerWidth;
    const sy = (-this.v.y * 0.5 + 0.5) * innerHeight;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      const k = p.t / 1.6;
      if (k >= 1) { p.d.remove(); this.pops.splice(i, 1); continue; }
      const x = sx + p.ox * (0.6 + k * 0.5);
      const y = sy + p.oy - k * 60;
      p.d.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${0.8 + Math.min(1, k * 6) * 0.25})`;
      p.d.style.opacity = String(k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
    }
  }
}
