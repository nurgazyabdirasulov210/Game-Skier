import * as THREE from '../vendor/three.module.js';

const S = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const ICONS = {
  spin: S('<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M17 2.5v4h4"/>'),
  flip: S('<path d="M12 20a8 8 0 1 1 6.2-3"/><path d="M21.5 17h-4v4"/>'),
  grab: S('<path d="M7 12V6.5a1.5 1.5 0 0 1 3 0V11M10 10V4.5a1.5 1.5 0 0 1 3 0V11M13 10.5V6a1.5 1.5 0 0 1 3 0v6.5M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-12.6 4.2L4 15a1.6 1.6 0 0 1 2.4-2.1L7 13.5"/>'),
  air: S('<path d="M5 15l7-7 7 7"/><path d="M5 20l7-7 7 7" opacity=".5"/>'),
  drop: S('<path d="M12 3v14"/><path d="M6 12l6 6 6-6"/><path d="M4 21h16"/>'),
  grind: S('<rect x="2.5" y="8" width="19" height="8" rx="4"/><circle cx="18" cy="12" r="1.6"/>'),
  tree: S('<path d="M12 2l5 7h-3l4 6h-3l3 5H6l3-5H6l4-6H7z"/>'),
  arch: S('<path d="M4 21V11a8 8 0 0 1 16 0v10"/><path d="M8.5 21v-9a3.5 3.5 0 0 1 7 0v9"/>'),
  glide: S('<path d="M2 9c5-5 15-5 20 0"/><path d="M5 8l7 9 7-9"/><circle cx="12" cy="18.5" r="1.5"/>'),
  switch: S('<path d="M4 8h14l-3-3M20 16H6l3 3"/>'),
  clean: S('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  powder: S('<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9.5 3.8L12 6l2.5-2.2M9.5 20.2L12 18l2.5 2.2"/>'),
};

const _v = new THREE.Vector3();

export class Hud {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = { hud: $('hud'), total: $('total'), best: $('best'), combo: $('combo'), comboPts: $('comboPts'), comboMult: $('comboMult'), ring: $('comboRing'), speed: $('speed'), tod: $('tod'), labels: $('labels'), banner: $('banner'), bannerA: $('bannerA'), bannerB: $('bannerB'), hint: $('hint'), cam: $('camName') };
    this.labels = [];
    this.lastCombo = -1; this.lastMult = -1;
    this.bannerT = 0;
    this.hintT = 0;
  }
  show(on) { this.el.hud.classList.toggle('on', on); }
  toggle() { this.el.hud.classList.toggle('hidden'); }
  setTotals(total, best) {
    this.el.total.textContent = Math.round(total).toLocaleString('ru-RU');
    this.el.best.textContent = Math.round(best).toLocaleString('ru-RU');
  }
  setCombo(active, pts, mult, timer) {
    this.el.combo.classList.toggle('on', active);
    if (pts !== this.lastCombo) { this.el.comboPts.textContent = pts.toLocaleString('ru-RU'); this.lastCombo = pts; }
    if (mult !== this.lastMult) {
      this.el.comboMult.textContent = '×' + mult;
      this.el.comboMult.style.setProperty('--heat', Math.min(1, (mult - 1) / 6));
      this.el.comboMult.classList.remove('pop'); void this.el.comboMult.offsetWidth; this.el.comboMult.classList.add('pop');
      this.lastMult = mult;
    }
    this.el.ring.style.strokeDashoffset = String(126 * (1 - timer));
  }
  setSpeed(kmh) { this.el.speed.textContent = Math.round(kmh); }
  setTime(name) { if (this.el.tod.textContent !== name) this.el.tod.textContent = name; }
  setCamName(n) { this.el.cam.textContent = n; this.el.cam.classList.remove('flash'); void this.el.cam.offsetWidth; this.el.cam.classList.add('flash'); }
  floatLabel(kind, name, pts, pos) {
    const d = document.createElement('div');
    d.className = 'flt k-' + kind;
    d.innerHTML = `<i>${ICONS[kind] || ''}</i><b>${pts.toLocaleString('ru-RU')}</b><span>${name}</span>`;
    this.el.labels.appendChild(d);
    const ang = Math.random() * Math.PI * 2;
    const lab = { d, pos: new THREE.Vector3(pos.x, (pos.y || 0) + 1.6, pos.z), t: 0, ox: Math.cos(ang) * 70, oy: -30 + Math.sin(ang) * 40 };
    this.labels.push(lab);
    while (this.labels.length > 9) { const o = this.labels.shift(); o.d.remove(); }
  }
  banner(a, b, cls = 'good') {
    const B = this.el.banner;
    this.el.bannerA.textContent = a; this.el.bannerB.textContent = b || '';
    B.className = 'on ' + cls;
    this.bannerT = 2.2;
  }
  hint(text, t = 4) {
    this.el.hint.textContent = text; this.el.hint.classList.add('on'); this.hintT = t;
  }
  update(dt, camera, w, h) {
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const L = this.labels[i];
      L.t += dt;
      _v.copy(L.pos).project(camera);
      const vis = _v.z < 1;
      const x = (_v.x * 0.5 + 0.5) * w + L.ox * Math.min(1, L.t * 3);
      const y = (-_v.y * 0.5 + 0.5) * h + L.oy * Math.min(1, L.t * 3) - L.t * 40;
      const a = L.t < 1.3 ? 1 : Math.max(0, 1 - (L.t - 1.3) / 0.5);
      L.d.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      L.d.style.opacity = vis ? a : 0;
      if (L.t > 1.8) { L.d.remove(); this.labels.splice(i, 1); }
    }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.el.banner.className = ''; }
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.el.hint.classList.remove('on'); }
  }
}
