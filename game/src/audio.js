// Procedural sound: wind, carving hiss, powder, impacts, trick chimes and a
// soft generative ambient pad. Everything is synthesised with WebAudio.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    // shared noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.97 * b0 + 0.03 * w; d[i] = w * 0.6 + b0 * 3; }
    this.noiseBuf = buf;
    const loop = (filterType, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      src.playbackRate.value = 0.7 + Math.random() * 0.6;
      const f = ctx.createBiquadFilter();
      f.type = filterType; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { src, f, g };
    };
    this.wind = loop('lowpass', 400, 0.7);
    this.whistle = loop('bandpass', 900, 8);
    this.carve = loop('bandpass', 2200, 1.2);
    this.powder = loop('lowpass', 700, 0.8);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicOn ? 0.22 : 0;
    this.music.connect(this.master);
    this.reverb = this.makeReverb();
    this.reverb.connect(this.music);
    this.nextChord = ctx.currentTime + 0.5;
    this.chordIdx = 0;
    this.nextBell = ctx.currentTime + 2;
  }

  makeReverb() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 3.5;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const inp = ctx.createGain();
    const dry = ctx.createGain(); dry.gain.value = 0.5;
    inp.connect(conv);
    inp.connect(dry);
    const out = ctx.createGain();
    conv.connect(out); dry.connect(out);
    this.revIn = inp;
    return out;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.music) this.music.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.3);
  }

  update(pl, dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const sp = Math.min(pl.speed, 40);
    const ground = pl.grounded && !pl.inAir && pl.gap < 0.3 && pl.mode !== 'grind';
    const wind = (sp / 30) ** 2 * 0.5 + (pl.inAir ? 0.08 : 0) + (pl.gliding ? 0.15 : 0);
    this.wind.g.gain.setTargetAtTime(Math.min(0.7, wind), t, 0.1);
    this.wind.f.frequency.setTargetAtTime(250 + sp * 35, t, 0.1);
    this.whistle.g.gain.setTargetAtTime(Math.max(0, sp - 18) * 0.004, t, 0.2);
    this.whistle.f.frequency.setTargetAtTime(700 + sp * 25, t, 0.2);
    const carve = ground ? Math.min(1, sp / 25) * (0.25 + Math.min(1, pl.carve / 15 + pl.skid / 20) * 0.75) : 0;
    this.carve.g.gain.setTargetAtTime(carve * (pl.fresh > 0.5 ? 0.18 : 0.32), t, 0.05);
    this.carve.f.frequency.setTargetAtTime(pl.fresh > 0.5 ? 1500 : 2800, t, 0.1);
    const powder = ground ? pl.fresh * Math.min(1, sp / 20) * 0.35 : 0;
    this.powder.g.gain.setTargetAtTime(powder, t, 0.08);
    this.updateMusic(t);
  }

  updateMusic(t) {
    if (!this.musicOn) return;
    const chords = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]];
    if (t > this.nextChord) {
      const ch = chords[this.chordIdx++ % chords.length];
      for (const n of ch) this.pad(n, t, 9);
      this.nextChord = t + 8;
    }
    if (t > this.nextBell) {
      const root = 69;
      const n = root + SCALE[Math.floor(Math.random() * 8)];
      this.bell(n, t, 0.05, this.revIn);
      this.nextBell = t + 1.5 + Math.random() * 4;
    }
  }

  hz(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  pad(note, t, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 2.5);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    for (const det of [-6, 5]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = this.hz(note);
      o.detune.value = det;
      o.connect(f);
      o.start(t); o.stop(t + dur + 0.1);
    }
    f.connect(g).connect(this.revIn);
  }

  bell(note, t, vol, dest) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
    o.type = 'sine'; m.type = 'sine';
    const f = this.hz(note);
    o.frequency.value = f; m.frequency.value = f * 3.5;
    mg.gain.setValueAtTime(f * 1.2, t);
    mg.gain.exponentialRampToValueAtTime(1, t + 1.2);
    m.connect(mg).connect(o.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(g).connect(dest || this.master);
    o.start(t); m.start(t); o.stop(t + 2); m.stop(t + 2);
  }

  thump(vol, freq = 90, noise = 0.5) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.25);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.4);
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vol * noise, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    s.connect(f).connect(ng).connect(this.master);
    s.start(t, Math.random()); s.stop(t + 0.55);
  }

  whoosh(vol = 0.3, dur = 0.6, from = 300, to = 1800) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.5;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  land(impact) { this.thump(Math.min(0.9, 0.15 + impact * 0.05), 80, 0.9); }
  jump() { this.whoosh(0.18, 0.35, 400, 1400); }
  crash() { this.thump(1, 60, 1.4); setTimeout(() => this.thump(0.5, 50, 1.2), 180); }
  glider(on) { this.whoosh(0.35, on ? 1.0 : 0.5, on ? 200 : 1500, on ? 1200 : 300); }

  trick(mult) {
    if (!this.ctx) return;
    const n = 72 + SCALE[Math.min(SCALE.length - 1, mult)];
    this.bell(n, this.ctx.currentTime, 0.12);
  }

  bank(mult) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [0, 4, 7, 12].forEach((s, i) => this.bell(72 + s + Math.min(mult, 5), t + i * 0.07, 0.09));
  }

  gate() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.bell(79, t, 0.12); this.bell(84, t + 0.08, 0.1);
  }

  crystal() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [0, 7, 12, 19].forEach((s, i) => this.bell(84 + s, t + i * 0.05, 0.07));
  }
}
