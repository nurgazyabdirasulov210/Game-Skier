// Procedural sound: wind, the hiss of skis in powder, landing thumps.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = b * 6 + w * 0.15; }
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(ctx.destination);

    // wind
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 400; this.windF.Q.value = 0.6;
    this.windG = ctx.createGain(); this.windG.gain.value = 0.05;
    noise().connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.master);
    // skis in snow
    this.hissF = ctx.createBiquadFilter(); this.hissF.type = 'highpass'; this.hissF.frequency.value = 1200;
    this.hissG = ctx.createGain(); this.hissG.gain.value = 0;
    const white = ctx.createBufferSource();
    const wb = ctx.createBuffer(1, len, ctx.sampleRate);
    const wd = wb.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    white.buffer = wb; white.loop = true; white.start();
    white.connect(this.hissF); this.hissF.connect(this.hissG); this.hissG.connect(this.master);
    this.white = wb;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  update(speed, onGround, carve, gliding) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.min(1, speed / 35);
    this.windG.gain.setTargetAtTime(0.03 + s * s * 0.35 + (gliding ? 0.15 : 0), t, 0.15);
    this.windF.frequency.setTargetAtTime(250 + s * 900, t, 0.2);
    this.hissG.gain.setTargetAtTime(onGround ? (0.02 + s * 0.12 + carve * 0.12) : 0, t, 0.06);
    this.hissF.frequency.setTargetAtTime(900 + carve * 1500, t, 0.1);
  }

  thump(power) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500 + power * 400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 + power * 0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35 + power * 0.2);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.7);
  }
}
