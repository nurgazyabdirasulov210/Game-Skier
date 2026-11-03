// Keyboard, gamepad and touch input folded into one control state.
export class Input {
  constructor() {
    this.keys = new Set();
    this.edges = new Set();
    this.touch = { steer: 0, pitch: 0, jump: false, grab: false, brake: false, active: false };
    this.prevJump = false;
    this.prevPad = {};
    this.anyKeyCb = null;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.edges.add(e.code);
      if (this.anyKeyCb) this.anyKeyCb(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.state = { steer: 0, pitch: 0, jump: false, jumpPressed: false, grab: false, brake: false, gliderPressed: false };
  }

  /** Was a key pressed since the last call? */
  pressed(code) {
    if (this.edges.has(code)) { this.edges.delete(code); return true; }
    return false;
  }

  padPressed(btn, pad) {
    const now = !!(pad && pad.buttons[btn] && pad.buttons[btn].pressed);
    const was = !!this.prevPad[btn];
    this.prevPad[btn] = now;
    return now && !was;
  }

  bindTouch(root) {
    const stick = root.querySelector('#stick');
    const knob = root.querySelector('#knob');
    let id = null, ox = 0, oy = 0;
    const R = 60;
    const zone = root.querySelector('#stickZone');
    zone.addEventListener('pointerdown', (e) => {
      id = e.pointerId; ox = e.clientX; oy = e.clientY;
      zone.setPointerCapture(id);
      stick.style.left = ox + 'px'; stick.style.top = oy + 'px';
      stick.classList.add('on');
      this.touch.active = true;
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = (e.clientX - ox) / R, dy = (e.clientY - oy) / R;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
      this.touch.steer = Math.abs(dx) < 0.12 ? 0 : dx;
      this.touch.pitch = Math.abs(dy) < 0.25 ? 0 : -dy;
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.touch.steer = 0; this.touch.pitch = 0;
      knob.style.transform = '';
      stick.classList.remove('on');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    const btn = (sel, prop, edge) => {
      const b = root.querySelector(sel);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.touch[prop] = true; if (edge) this.edges.add(edge); b.classList.add('down'); });
      const up = () => { this.touch[prop] = false; b.classList.remove('down'); };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    };
    btn('#bJump', 'jump', 'Space');
    btn('#bGrab', 'grab');
    btn('#bBrake', 'brake');
    btn('#bGlide', 'glideBtn', 'KeyG');
  }

  read() {
    const k = this.keys;
    const s = this.state;
    let steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let pitch = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let jump = k.has('Space');
    let grab = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyE');
    let brake = k.has('KeyS') || k.has('ArrowDown');
    let glider = this.pressed('KeyG') || this.pressed('KeyQ');

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && [...pads].find((p) => p && p.connected);
    if (pad) {
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      if (Math.abs(ax) > 0.15) steer = ax;
      if (Math.abs(ay) > 0.3) pitch = -ay;
      if (ay > 0.5 || (pad.buttons[6] && pad.buttons[6].value > 0.3)) brake = true;
      if (pad.buttons[0]?.pressed) jump = true;
      if (pad.buttons[2]?.pressed || pad.buttons[7]?.pressed) grab = true;
      if (this.padPressed(3, pad)) glider = true;
      if (this.padPressed(5, pad)) this.edges.add('KeyC');
      if (this.padPressed(4, pad)) this.edges.add('KeyT');
      if (this.padPressed(9, pad)) this.edges.add('Escape');
      if (this.padPressed(1, pad)) this.edges.add('KeyR');
    }
    const t = this.touch;
    if (t.steer) steer = t.steer;
    if (t.pitch) pitch = t.pitch;
    if (t.pitch < -0.5) brake = true;
    if (t.jump) jump = true;
    if (t.grab) grab = true;
    if (t.brake) brake = true;

    s.steer = Math.max(-1, Math.min(1, steer));
    s.pitch = Math.max(-1, Math.min(1, pitch));
    s.jumpPressed = jump && !this.prevJump;
    this.prevJump = jump;
    s.jump = jump;
    s.grab = grab;
    s.brake = brake;
    s.gliderPressed = glider;
    return s;
  }
}
