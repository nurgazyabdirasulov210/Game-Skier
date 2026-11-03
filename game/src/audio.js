// Процедурный звук: ветер, шуршание пухляка, приземления, трюки, тихий эмбиент.
export class Audio {
  constructor() {
    this.ctx = null; this.muted = false; this.music = true;
  }
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(ctx.destination);
    // белый шум
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const loop = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 2); return s; };
    // ветер
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 400; this.windF.Q.value = 0.7;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    loop().connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.master);
    // снег под лыжами
    this.snowF = ctx.createBiquadFilter(); this.snowF.type = 'bandpass'; this.snowF.frequency.value = 1400; this.snowF.Q.value = 0.6;
    this.snowF2 = ctx.createBiquadFilter(); this.snowF2.type = 'highshelf'; this.snowF2.frequency.value = 3000; this.snowF2.gain.value = -8;
    this.snowG = ctx.createGain(); this.snowG.gain.value = 0;
    loop().connect(this.snowF); this.snowF.connect(this.snowF2); this.snowF2.connect(this.snowG); this.snowG.connect(this.master);
    // эмбиент
    this.musicG = ctx.createGain(); this.musicG.gain.value = 0.0; this.musicG.connect(this.master);
    this.musicF = ctx.createBiquadFilter(); this.musicF.type = 'lowpass'; this.musicF.frequency.value = 1200; this.musicF.connect(this.musicG);
    this.delay = ctx.createDelay(1.5); this.delay.delayTime.value = 0.62;
    this.fb = ctx.createGain(); this.fb.gain.value = 0.42;
    this.delay.connect(this.fb); this.fb.connect(this.delay); this.delay.connect(this.musicF);
    this.musicG.gain.setTargetAtTime(this.music ? 0.22 : 0, ctx.currentTime, 2);
    this.nextNote = ctx.currentTime + 0.5; this.chord = 0;
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1); }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  update(dt, s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const sp = Math.min(1, s.speed / 30);
    this.windG.gain.setTargetAtTime(0.03 + sp * sp * 0.35 + (s.air ? 0.08 : 0) + (s.glide ? 0.12 : 0), t, 0.15);
    this.windF.frequency.setTargetAtTime(250 + sp * 1300 + (s.glide ? 300 : 0), t, 0.2);
    const carve = s.grounded ? Math.min(1, s.speed / 18) * (0.45 + Math.min(1, s.carve) * 0.75) : 0;
    const flutter = 0.85 + 0.15 * Math.sin(t * 31) * Math.sin(t * 17.3);
    this.snowG.gain.setTargetAtTime(carve * 0.32 * flutter, t, 0.06);
    this.snowF.frequency.setTargetAtTime(900 + Math.min(1, s.carve) * 900 + sp * 500, t, 0.1);
    this.ambient(t, s.night || 0);
  }

  ambient(t, night) {
    if (!this.music || t < this.nextNote) return;
    // мягкие колокольчики по пентатонике, аккорды меняются медленно
    const chords = [[0, 4, 7, 11], [-3, 0, 4, 7], [-7, -3, 0, 5], [-5, -1, 2, 7]];
    const ch = chords[this.chord % chords.length];
    const base = night > 0.5 ? 220 : 261.6;
    const n = ch[Math.floor(Math.random() * ch.length)] + (Math.random() < 0.3 ? 12 : 0);
    this.bell(base * Math.pow(2, n / 12), 0.05 + Math.random() * 0.04, 2.8);
    if (Math.random() < 0.18) this.chord++;
    this.nextNote = t + 0.9 + Math.random() * 1.6;
  }
  bell(f, vol, dur, dest) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f; o2.type = 'triangle'; o2.frequency.value = f * 2.001;
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2); g2.connect(g);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    g.connect(dest || this.delay); if (!dest) g.connect(this.musicF);
    o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  }
  burst(vol, freq, dur, type = 'lowpass') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  thump(vol) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.35);
  }
  land(power) { this.burst(0.25 + power * 0.4, 700 + power * 600, 0.35 + power * 0.25); this.thump(0.25 + power * 0.35); }
  pop() { this.burst(0.15, 1600, 0.12, 'bandpass'); }
  crash() { this.burst(0.7, 500, 0.9); this.thump(0.6); }
  trick(level = 0) {
    if (!this.ctx) return;
    const notes = [0, 4, 7, 12, 16, 19, 24];
    const n = notes[Math.min(level, notes.length - 1)];
    this.bell(523.25 * Math.pow(2, n / 12), 0.09, 0.9, this.master);
  }
  bank(mult) {
    if (!this.ctx) return;
    [0, 4, 7, 12].forEach((n, i) => setTimeout(() => this.bell(392 * Math.pow(2, (n + Math.min(mult, 6)) / 12), 0.08, 1.4, this.master), i * 70));
  }
  lose() {
    if (!this.ctx) return;
    [7, 3, 0].forEach((n, i) => setTimeout(() => this.bell(330 * Math.pow(2, n / 12), 0.06, 0.8, this.master), i * 110));
  }
  whoosh() { this.burst(0.18, 900, 0.5, 'bandpass'); }
}
