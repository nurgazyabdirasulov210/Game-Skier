// Процедурный звук: ветер и шуршание снега под лыжами.
export class Sound {
  constructor() { this.ctx = null; this.muted = false; }
  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = b * 3.5; }
    const mk = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(ctx.destination);
      src.start();
      return { f, g };
    };
    this.wind = mk('lowpass', 500, 0.7);
    this.hiss = mk('bandpass', 2500, 0.8);
    const white = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = white.getChannelData(0);
    for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;
    this.whiteBuf = white;
  }
  update(speed, carve, contact, air) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.muted ? 0 : 1;
    this.wind.g.gain.setTargetAtTime(m * Math.min(0.5, 0.04 + speed * 0.012), t, 0.1);
    this.wind.f.frequency.setTargetAtTime(300 + speed * 25, t, 0.2);
    this.hiss.g.gain.setTargetAtTime(m * (contact && !air ? Math.min(0.35, speed * 0.008 + carve * 0.06) : 0), t, 0.05);
    this.hiss.f.frequency.setTargetAtTime(1800 + carve * 400, t, 0.1);
  }
  thump(v = 0.5) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.whiteBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(); src.stop(ctx.currentTime + 0.4);
  }
  chime() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    [880, 1320, 1760].forEach((fr, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      const g = ctx.createGain();
      const t0 = ctx.currentTime + i * 0.06;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.12, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
      o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + 0.55);
    });
  }
}
