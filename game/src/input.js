// Keyboard, gamepad and touch input merged into one state object.
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.touch = { x: 0, jump: false, tuck: false, grab: false, glider: false, back: false };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.state = { x: 0, y: 0, jump: false, tuck: false, brake: false, grab: false, grabKind: undefined, gliderPressed: false, anyPressed: false };
    this.padPrev = {};
  }

  has(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }

  poll() {
    const s = this.state;
    const left = this.has('KeyA', 'ArrowLeft'), right = this.has('KeyD', 'ArrowRight');
    const up = this.has('KeyW', 'ArrowUp'), down = this.has('KeyS', 'ArrowDown');
    s.x = (left ? 1 : 0) - (right ? 1 : 0);
    s.y = (up ? 1 : 0) - (down ? 1 : 0);
    s.tuck = up;
    s.brake = down;
    s.jump = this.has('Space');
    s.grab = this.has('ShiftLeft', 'ShiftRight', 'KeyJ', 'KeyK', 'KeyL');
    s.grabKind = this.has('KeyJ') ? 0 : this.has('KeyK') ? 1 : this.has('KeyL') ? 2 : undefined;
    s.gliderPressed = this.hit('KeyF', 'KeyE');
    s.anyPressed = this.pressed.size > 0;
    s.camera = this.hit('KeyC');
    s.respawn = this.hit('KeyR');
    s.pause = this.hit('Escape', 'KeyP');
    s.mute = this.hit('KeyM');
    s.help = this.hit('KeyH');

    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p);
    if (gp) {
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (Math.abs(ax) > 0.15) s.x = -ax;
      if (Math.abs(ay) > 0.2) { s.y = -ay; s.tuck = ay < -0.5; s.brake = ay > 0.5; }
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      const edge = (i) => { const now = b(i); const was = this.padPrev[i]; this.padPrev[i] = now; return now && !was; };
      if (b(0)) s.jump = true;
      if (b(2) || b(6) || b(7)) s.grab = true;
      if (edge(3)) s.gliderPressed = true;
      if (edge(5)) s.camera = true;
      if (edge(9)) s.pause = true;
      if (edge(8)) s.respawn = true;
      if (gp.buttons.some((x) => x.pressed)) s.anyPressed = true;
    }

    // touch
    const t = this.touch;
    if (t.x) s.x = t.x;
    if (t.jump) s.jump = true;
    if (t.tuck) { s.tuck = true; s.y = 1; }
    if (t.back) { s.brake = true; s.y = -1; }
    if (t.grab) s.grab = true;
    if (t.glider) { s.gliderPressed = true; t.glider = false; }
    if (t.tap) { s.anyPressed = true; t.tap = false; }

    this.pressed.clear();
    return s;
  }
}
