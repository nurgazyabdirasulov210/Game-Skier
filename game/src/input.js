// Клавиатура + сенсорное управление.
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.touch = { steer: 0, jump: false, tuck: false, brake: false, grab: false };
    addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.setupTouch();
  }

  setupTouch() {
    const pad = document.getElementById('steerpad');
    if (!pad) return;
    let id = null, x0 = 0;
    pad.addEventListener('pointerdown', (e) => { id = e.pointerId; x0 = e.clientX; pad.setPointerCapture(id); });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      this.touch.steer = Math.max(-1, Math.min(1, (e.clientX - x0) / 70));
    });
    const end = (e) => { if (e.pointerId === id) { id = null; this.touch.steer = 0; } };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    for (const [elId, key] of [['btn-jump', 'jump'], ['btn-tuck', 'tuck'], ['btn-brake', 'brake'], ['btn-grab', 'grab']]) {
      const b = document.getElementById(elId);
      if (!b) continue;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.touch[key] = true; });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => (this.touch[key] = false));
    }
  }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(code) { const h = this.pressed.has(code); return h; }
  endFrame() { this.pressed.clear(); }

  state() {
    const steer = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0) + this.touch.steer;
    return {
      steer: Math.max(-1, Math.min(1, steer)),
      tuck: this.down('KeyW', 'ArrowUp') || this.touch.tuck,
      brake: this.down('KeyS', 'ArrowDown') || this.touch.brake,
      jump: this.down('Space') || this.touch.jump,
      grab: this.down('ShiftLeft', 'ShiftRight', 'KeyE') || this.touch.grab,
    };
  }
}
