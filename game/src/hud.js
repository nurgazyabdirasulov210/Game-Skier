// DOM heads-up display.
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('ru-RU');

export class HUD {
  constructor() {
    this.el = {
      root: $('hud'), total: $('total'), best: $('best'), speed: $('speed'), alt: $('alt'), tod: $('tod'),
      combo: $('combo'), comboPts: $('comboPts'), comboMult: $('comboMult'), ring: $('comboRing'),
      feed: $('feed'), toast: $('toast'), hint: $('hint'), banner: $('banner'),
    };
    this.feedItems = [];
    this.toastT = 0;
    this.hintT = 0;
    this.bannerT = 0;
    this.lastCombo = -1;
    this.hidden = false;
  }

  setScore(total, best) {
    this.el.total.textContent = fmt(total);
    this.el.best.textContent = fmt(best);
  }

  combo(pts, mult, frac, visible) {
    const e = this.el;
    e.combo.classList.toggle('on', visible);
    if (!visible) return;
    if (pts !== this.lastCombo) {
      e.comboPts.textContent = fmt(pts);
      this.lastCombo = pts;
    }
    e.comboMult.textContent = '×' + mult;
    e.comboMult.style.setProperty('--heat', Math.min(1, (mult - 1) / 8));
    e.ring.style.strokeDashoffset = String(126 * (1 - frac));
  }

  popup(name, pts, kind = 'trick') {
    const d = document.createElement('div');
    d.className = 'feed-item ' + kind;
    d.innerHTML = `<span class="n"></span><span class="p">+${fmt(pts)}</span>`;
    d.querySelector('.n').textContent = name;
    this.el.feed.prepend(d);
    this.feedItems.push({ d, t: 0 });
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
  }

  bank(v, mult, record) {
    this.toast(`+${fmt(v)}`, record ? 'record' : 'bank', record ? 'Лучшее комбо!' : mult > 1 ? `комбо ×${mult}` : '');
  }

  lose(v) {
    if (v > 0) this.popup('Комбо сгорело', -v, 'lost');
  }

  toast(text, kind = '', sub = '') {
    const t = this.el.toast;
    t.className = 'show ' + kind;
    t.innerHTML = `<div class="big"></div><div class="sub"></div>`;
    t.querySelector('.big').textContent = text;
    t.querySelector('.sub').textContent = sub;
    this.toastT = 1.8;
  }

  hint(text, time = 2.5) {
    this.el.hint.textContent = text;
    this.el.hint.classList.add('show');
    this.hintT = time;
  }

  banner(text) {
    this.el.banner.textContent = text;
    this.el.banner.classList.add('show');
    this.bannerT = 1.6;
  }

  stats(speedKmh, descent, todName) {
    this.el.speed.textContent = Math.round(speedKmh);
    this.el.alt.textContent = fmt(descent);
    if (this.el.tod.textContent !== todName) this.el.tod.textContent = todName;
  }

  toggle() {
    this.hidden = !this.hidden;
    this.el.root.classList.toggle('hidden', this.hidden);
  }

  update(dt) {
    for (const it of this.feedItems) {
      it.t += dt;
      if (it.t > 2.6) it.d.classList.add('out');
      if (it.t > 3.2) it.d.remove();
    }
    this.feedItems = this.feedItems.filter((i) => i.t <= 3.2);
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.el.toast.classList.remove('show'); }
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.el.hint.classList.remove('show'); }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.el.banner.classList.remove('show'); }
  }
}
