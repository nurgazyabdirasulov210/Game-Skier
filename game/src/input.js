// Ввод: клавиатура, геймпад, сенсорный экран.
export class Input {
  constructor() {
    this.keys = new Set();
    this.events = new Set();
    this.steer = 0; this.up = 0; this.down = 0;
    this.jump = false; this.grab = false;
    this.touch = { active: false, id: null, x0: 0, y0: 0, dx: 0, dy: 0, jump: false, grab: false };
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.lastPad = {};
    this.enabled = true;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const map = { KeyC: 'camera', KeyT: 'time', KeyH: 'hud', KeyR: 'reset', Escape: 'pause', KeyP: 'pause', KeyM: 'mute', KeyF: 'glide', KeyG: 'glide', Enter: 'start', Space: 'start' };
      if (map[e.code]) this.events.add(map[e.code]);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  bindTouchUI(root) {
    const stick = root.querySelector('#stick');
    const knob = root.querySelector('#knob');
    const zone = root.querySelector('#stickzone');
    const T = this.touch;
    zone.addEventListener('pointerdown', (e) => {
      if (T.active) return;
      T.active = true; T.id = e.pointerId; T.x0 = e.clientX; T.y0 = e.clientY; T.dx = 0; T.dy = 0;
      stick.style.left = e.clientX + 'px'; stick.style.top = e.clientY + 'px';
      stick.classList.add('on');
      zone.setPointerCapture(e.pointerId);
    });
    const move = (e) => {
      if (!T.active || e.pointerId !== T.id) return;
      const R = 60;
      let dx = e.clientX - T.x0, dy = e.clientY - T.y0;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      T.dx = dx / R; T.dy = dy / R;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const end = (e) => {
      if (e.pointerId !== T.id) return;
      T.active = false; T.dx = 0; T.dy = 0; T.id = null;
      knob.style.transform = '';
      stick.classList.remove('on');
    };
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    const btn = (sel, down, up) => {
      const el = root.querySelector(sel);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.classList.add('down'); down(); el.setPointerCapture(e.pointerId); });
      const u = () => { el.classList.remove('down'); up && up(); };
      el.addEventListener('pointerup', u); el.addEventListener('pointercancel', u);
    };
    btn('#bJump', () => (T.jump = true), () => (T.jump = false));
    btn('#bGrab', () => (T.grab = true), () => (T.grab = false));
    btn('#bGlide', () => this.events.add('glide'));
    btn('#bCam', () => this.events.add('camera'));
    btn('#bPause', () => this.events.add('pause'));
  }

  consume(name) {
    if (this.events.has(name)) { this.events.delete(name); return true; }
    return false;
  }
  clearEvents() { this.events.clear(); }

  update(dt) {
    const K = this.keys;
    let steer = 0, up = 0, down = 0, jump = false, grab = false;
    if (K.has('KeyA') || K.has('ArrowLeft')) steer -= 1;
    if (K.has('KeyD') || K.has('ArrowRight')) steer += 1;
    if (K.has('KeyW') || K.has('ArrowUp')) up = 1;
    if (K.has('KeyS') || K.has('ArrowDown')) down = 1;
    if (K.has('Space')) jump = true;
    if (K.has('ShiftLeft') || K.has('ShiftRight') || K.has('KeyJ') || K.has('KeyE')) grab = true;

    const T = this.touch;
    if (T.active) {
      steer += Math.abs(T.dx) > 0.12 ? T.dx : 0;
      if (T.dy < -0.3) up = Math.max(up, Math.min(1, (-T.dy - 0.3) / 0.5));
      if (T.dy > 0.3) down = Math.max(down, Math.min(1, (T.dy - 0.3) / 0.5));
    }
    jump = jump || T.jump; grab = grab || T.grab;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (Math.abs(ax) > 0.15) steer += ax;
      if (ay < -0.25) up = Math.max(up, -ay);
      if (ay > 0.25) down = Math.max(down, ay);
      const b = (i) => p.buttons[i] && p.buttons[i].pressed;
      if (b(7)) up = Math.max(up, p.buttons[7].value || 1);
      if (b(6)) down = Math.max(down, p.buttons[6].value || 1);
      if (b(0)) jump = true;
      if (b(2) || b(5) || b(4)) grab = true;
      const edge = (i, ev) => { const v = b(i); if (v && !this.lastPad[i]) this.events.add(ev); this.lastPad[i] = v; };
      edge(1, 'glide'); edge(3, 'camera'); edge(9, 'pause'); edge(8, 'time'); edge(0, 'start');
    }
    steer = Math.max(-1, Math.min(1, steer));
    this.steer = steer; this.up = up; this.down = down;
    this.jump = jump; this.grab = grab;
  }
}
