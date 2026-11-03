// Points, combos and multipliers. Tricks chain into a combo while you keep
// doing things; land it safely to bank it, crash and it is gone.
const LS_KEY = 'porosha.best.v1';

export class Score {
  constructor(hud, audio) {
    this.hud = hud;
    this.audio = audio;
    this.total = 0;
    this.best = 0;
    this.bestCombo = 0;
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      this.best = s.best || 0;
      this.bestCombo = s.bestCombo || 0;
    } catch { /* storage unavailable */ }
    this.combo = null;
    this.powderAcc = 0; this.powderT = 0;
    this.speedAcc = 0; this.speedT = 0;
    this.hud.setScore(this.total, this.best);
  }

  save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ best: this.best, bestCombo: this.bestCombo })); } catch { /* ignore */ }
  }

  add(name, pts, inc = 1, kind = 'trick') {
    pts = Math.round(pts);
    if (!this.combo) this.combo = { pts: 0, mult: 1, timer: 0, n: 0 };
    const c = this.combo;
    c.pts += pts;
    c.mult = Math.min(15, c.mult + inc);
    c.timer = 3.2;
    c.n++;
    this.hud.popup(name, pts, kind);
    if (inc > 0) this.audio.trick(Math.floor(c.mult));
  }

  bank() {
    const c = this.combo;
    if (!c) return;
    const mult = Math.floor(c.mult);
    const v = c.pts * mult;
    this.total += v;
    this.combo = null;
    let record = false;
    if (v > this.bestCombo && c.n > 1) { this.bestCombo = v; record = c.pts > 300; }
    if (this.total > this.best) this.best = this.total;
    this.save();
    this.hud.bank(v, mult, record);
    this.hud.setScore(this.total, this.best);
    this.audio.bank(mult);
  }

  fail() {
    if (this.combo) {
      this.hud.lose(this.combo.pts * Math.floor(this.combo.mult));
      this.combo = null;
    }
    this.powderAcc = 0; this.speedAcc = 0;
  }

  update(dt, pl) {
    // continuous sources
    const grounded = pl.grounded && !pl.inAir && pl.mode === 'ground';
    if (grounded && pl.fresh > 0.6 && pl.speed > 11) {
      this.powderAcc += dt * (pl.speed * 1.2 + pl.carve * 2);
      this.powderT += dt;
      if (this.powderT > 1.8 && this.powderAcc > 30) {
        this.add('Свежая пудра', this.powderAcc, 0, 'flow');
        this.powderAcc = 0; this.powderT = 0;
      }
    } else { this.powderT = 0; }
    if (pl.speed > 23 && pl.mode !== 'crash') {
      this.speedAcc += dt * (pl.speed - 20) * 6;
      this.speedT += dt;
      if (this.speedT > 2.2) {
        this.add('Скорость', this.speedAcc, 0, 'flow');
        this.speedAcc = 0; this.speedT = 0;
      }
    } else { this.speedT = 0; }

    const c = this.combo;
    if (c) {
      const busy = pl.inAir || pl.gliding || pl.mode === 'grind' || pl.mode === 'crash';
      if (!busy) c.timer -= dt;
      if (c.timer <= 0) this.bank();
    }
    this.hud.combo(c ? c.pts : 0, c ? Math.floor(c.mult) : 1, c ? Math.max(0, c.timer / 3.2) : 0, !!c);
  }

  resetRun() {
    this.combo = null;
    this.total = 0;
    this.hud.setScore(this.total, this.best);
  }
}

const SPIN_NAMES = { 180: '180', 360: '360', 540: '540', 720: '720', 900: '900', 1080: '1080', 1260: '1260', 1440: '1440' };
const GRAB_NAMES = { safety: 'Сейфти', nose: 'Ноуз-грэб', tail: 'Тейл-грэб', mute: 'Мьют' };

/** Turn a landing report into a list of [name, points, multiplierStep]. */
export function judgeLanding(info) {
  const out = [];
  const air = info.air;
  if (air < 0.5 && info.spin < 2.6 && Math.abs(info.flip) < 4) return out;
  // spins: nearest multiple of 180 that we are close enough to
  const halfTurns = Math.round(info.spin / Math.PI);
  if (halfTurns >= 1 && Math.abs(info.spin - halfTurns * Math.PI) < 0.75) {
    const deg = halfTurns * 180;
    out.push([(SPIN_NAMES[deg] || String(deg)) + '°', 90 * Math.pow(halfTurns, 1.35), 1]);
  }
  const flips = Math.round(Math.abs(info.flip) / (Math.PI * 2));
  if (flips >= 1) {
    const pre = flips === 2 ? 'Дабл-' : flips === 3 ? 'Трипл-' : flips > 3 ? flips + 'x ' : '';
    const nm = info.flip > 0 ? 'фронтфлип' : 'бэкфлип';
    const n = pre ? pre + nm : nm[0].toUpperCase() + nm.slice(1);
    out.push([n, 450 * Math.pow(flips, 1.5), 1]);
  }
  if (info.grab > 0.25) out.push([GRAB_NAMES[info.grabKind] || 'Грэб', 90 + info.grab * 260, 1]);
  if (info.glide > 1) out.push([`Парение ${info.glide.toFixed(0)} с`, info.glide * 30, 0]);
  else if (air > 0.6) {
    const big = info.height > 7;
    out.push([`${big ? 'Большой полёт' : 'Полёт'} ${air.toFixed(1)} с`, air * 55 + info.height * 14, big ? 1 : 0]);
  }
  if (info.switchLand) out.push(['Свитч', 140, 1]);
  if (out.length && info.clean) out.push(['Чисто', 80, 0]);
  return out;
}
