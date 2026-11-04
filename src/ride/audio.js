// Procedural sound: wind that grows with speed, powder hiss while carving,
// and a soft thump on landings. Starts after the first user gesture.
export class RideAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 4; }
    this.noise = buf;
    const loop = (freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(ctx.destination);
      src.start();
      return { f, g };
    };
    this.wind = loop(400, 0.6);
    this.hiss = loop(2400, 0.8);
    this.master = 1;
  }

  setMuted(m) { this.muted = m; }

  update(speed, carving, grounded) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.muted ? 0 : 1;
    const s = Math.min(1, speed / 35);
    this.wind.g.gain.setTargetAtTime(m * (0.02 + s * s * 0.25), t, 0.15);
    this.wind.f.frequency.setTargetAtTime(250 + s * 900, t, 0.2);
    this.hiss.g.gain.setTargetAtTime(m * (grounded ? 0.03 + carving * 0.12 * s : 0), t, 0.08);
  }

  thump(strength) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(Math.min(0.8, 0.15 + strength * 0.5), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t, Math.random());
    src.stop(t + 0.4);
  }
}
