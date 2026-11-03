// Очки и комбо. Каждый новый вид трюка в цепочке повышает множитель.
const KEY = 'celina.v1';
// виды трюков, повышающие множитель (мелкие — только очки)
const MAJOR = new Set(['spin', 'flip', 'grab', 'grind', 'arch', 'glide', 'drop', 'tree']);

export class Score {
  constructor(hud, audio) {
    this.hud = hud; this.audio = audio;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
    this.best = saved.best || 0;
    this.bestCombo = saved.bestCombo || 0;
    this.total = 0;
    this.distance = 0;
    this.combo = { pts: 0, mult: 1, kinds: new Set(), timer: 0, active: false, flow: 0 };
    this.flowAcc = 0;
    hud.setTotals(this.total, this.best);
  }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ best: this.best, bestCombo: this.bestCombo })); } catch (e) { /* приватный режим */ }
  }
  add(kind, name, pts, pos) {
    const c = this.combo;
    if (!c.active) { c.active = true; c.pts = 0; c.mult = 1; c.major = 0; c.kinds.clear(); }
    const fresh = !c.kinds.has(kind);
    if (fresh) {
      c.kinds.add(kind);
      if (MAJOR.has(kind)) { c.major = (c.major || 0) + 1; c.mult = Math.min(8, Math.max(1, c.major)); }
    }
    c.pts += pts;
    c.timer = 1;
    this.hud.floatLabel(kind, name, pts, pos);
    if (kind !== 'tree') this.audio.trick(c.kinds.size - 1); else this.audio.trick(0);
  }
  // непрерывные очки за скорость в пухляке
  flowTick(dt, speed, player) {
    if (speed < 9) return;
    const rate = (speed - 6) * 2.4 * (1 + Math.min(1, player.carve) * 0.5);
    const c = this.combo;
    if (!c.active) { c.active = true; c.pts = 0; c.mult = 1; c.major = 0; c.kinds.clear(); c.kinds.add('powder'); c.timer = 1; }
    c.pts += rate * dt;
    c.timer = Math.min(1, c.timer + dt * 0.22);
  }
  keepAlive() { this.combo.timer = 1; }
  fail(reason) {
    const c = this.combo;
    const lost = Math.round(c.pts * c.mult);
    if (c.active && lost > 0) { this.hud.banner(reason, lost > 0 ? `−${lost.toLocaleString('ru-RU')} комбо` : '', 'bad'); this.audio.lose(); }
    else this.hud.banner(reason, '', 'bad');
    c.active = false; c.pts = 0; c.mult = 1; c.kinds.clear(); c.timer = 0;
  }
  bank() {
    const c = this.combo;
    const val = Math.round(c.pts * c.mult);
    if (val > 0) {
      this.total += val;
      if (val > this.bestCombo) this.bestCombo = val;
      if (this.total > this.best) this.best = this.total;
      this.save();
      if (c.mult > 1 || val > 400) { this.hud.banner(`Комбо ×${c.mult}`, `+${val.toLocaleString('ru-RU')}`, c.mult >= 4 ? 'hot' : 'good'); this.audio.bank(c.mult); }
    }
    c.active = false; c.pts = 0; c.mult = 1; c.kinds.clear(); c.timer = 0;
    this.hud.setTotals(this.total, this.best);
  }
  update(dt, grounded) {
    const c = this.combo;
    if (c.active && grounded) {
      c.timer -= dt / 3.0;
      if (c.timer <= 0) this.bank();
    }
    this.hud.setCombo(c.active, Math.round(c.pts), c.mult, Math.max(0, c.timer));
  }
  resetRun() {
    this.total = 0;
    this.combo.active = false; this.combo.pts = 0; this.combo.mult = 1; this.combo.kinds.clear();
    this.hud.setTotals(this.total, this.best);
  }
}
