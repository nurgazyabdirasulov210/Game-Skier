// Очки, комбо, всплывающие подписи в мире.
import * as THREE from 'three';

const COMBO_WINDOW = 3.0;

export class Hud {
  constructor() {
    this.el = {
      score: document.getElementById('score'),
      mult: document.getElementById('mult'),
      ring: document.getElementById('ring-fg'),
      best: document.getElementById('best'),
      shards: document.getElementById('shards'),
      speed: document.getElementById('speed'),
      drop: document.getElementById('drop'),
      tod: document.getElementById('tod'),
      pops: document.getElementById('pops'),
      msg: document.getElementById('msg'),
      pot: document.getElementById('pot'),
    };
    this.score = 0;
    this.shards = 0;
    try { this.best = +localStorage.getItem('pudra.best') || 0; } catch { this.best = 0; }
    this.pot = 0;
    this.events = 0;
    this.comboT = 0;
    this.shown = 0;
    this.pops = [];
    this.v = new THREE.Vector3();
  }

  get mult() { return Math.min(8, 1 + Math.floor(this.events / 2)); }

  trick(name, pts, pos, icon) {
    pts = Math.round(pts);
    this.pot += pts;
    this.events++;
    this.comboT = COMBO_WINDOW;
    this.popup(pos, `${icon} ${pts}`, name);
  }

  add(pts) { this.score += pts; }

  bank() {
    if (this.pot > 0) {
      const total = this.pot * this.mult;
      this.score += total;
      if (this.mult > 1) this.message(`Комбо ×${this.mult}  +${total}`, 'good');
    }
    this.pot = 0; this.events = 0; this.comboT = 0;
  }

  lose(reason) {
    this.message(reason + (this.pot > 0 ? '  — комбо потеряно' : ''), 'bad');
    this.pot = 0; this.events = 0; this.comboT = 0;
  }

  popup(pos, big, small) {
    const d = document.createElement('div');
    d.className = 'pop';
    d.innerHTML = `<b>${big}</b>${small ? `<span>${small}</span>` : ''}`;
    this.el.pops.appendChild(d);
    this.pops.push({ d, pos: pos.clone(), t: 0 });
  }

  message(text, cls = '') {
    const m = this.el.msg;
    m.textContent = text;
    m.className = 'show ' + cls;
    clearTimeout(this._mt);
    this._mt = setTimeout(() => (m.className = ''), 1800);
  }

  update(dt, camera, info) {
    if (this.comboT > 0 && !info.inAir) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.bank();
    }
    if (this.score > this.best) {
      this.best = Math.floor(this.score);
      try { localStorage.setItem('pudra.best', this.best); } catch {}
    }
    this.shown += (this.score - this.shown) * Math.min(1, dt * 8);
    this.el.score.textContent = Math.round(this.shown);
    this.el.best.textContent = this.best;
    this.el.shards.textContent = this.shards;
    this.el.mult.textContent = this.events > 0 ? `×${this.mult}` : '';
    this.el.pot.textContent = this.pot > 0 ? `+${this.pot}` : '';
    const frac = this.events > 0 ? Math.max(0, this.comboT / COMBO_WINDOW) : 0;
    this.el.ring.style.strokeDashoffset = String(151 * (1 - frac));
    this.el.speed.textContent = Math.round(info.speed * 3.6);
    this.el.drop.textContent = Math.max(0, Math.round(info.drop));
    this.el.tod.textContent = info.tod;

    const w = innerWidth, h = innerHeight;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      this.v.copy(p.pos).project(camera);
      const vis = this.v.z < 1;
      const x = (this.v.x * 0.5 + 0.5) * w, y = (-this.v.y * 0.5 + 0.5) * h - p.t * 40;
      p.d.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${0.8 + Math.min(p.t * 4, 0.3)})`;
      p.d.style.opacity = vis ? String(Math.min(1, (1.6 - p.t) * 2)) : '0';
      if (p.t > 1.6) { p.d.remove(); this.pops.splice(i, 1); }
    }
  }
}
