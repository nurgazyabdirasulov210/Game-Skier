import * as THREE from 'three';
import { mulberry32 } from './noise.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function finish(c, { srgb = true, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// «Клочок» пушистой кроны: плотная середина и рваные пушистые края.
export function makeFurTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const rnd = mulberry32(77);
  g.lineCap = 'round';
  const cx = S / 2, cy = S / 2;
  const core = g.createRadialGradient(cx, cy, 0, cx, cy, S * 0.38);
  core.addColorStop(0, 'rgb(255,255,255)');
  core.addColorStop(1, 'rgb(225,225,225)');
  g.fillStyle = core;
  g.beginPath(); g.arc(cx, cy, S * 0.35, 0, Math.PI * 2); g.fill();
  // мелкие «пучки» внутри — лёгкая фактура
  for (let i = 0; i < 160; i++) {
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * S * 0.3;
    const v = 225 + Math.floor(rnd() * 30);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath(); g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, S * (0.015 + rnd() * 0.03), 0, Math.PI * 2); g.fill();
  }
  // короткий мех по краю
  for (let i = 0; i < 900; i++) {
    const a = rnd() * Math.PI * 2;
    const r0 = S * (0.27 + rnd() * 0.08);
    const len = S * (0.03 + rnd() * 0.08);
    const r1 = Math.min(S * 0.485, r0 + len);
    const bend = (rnd() - 0.5) * 0.5;
    const v = 215 + Math.floor(rnd() * 40);
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.lineWidth = 2 + rnd() * 3.5;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.quadraticCurveTo(
      cx + Math.cos(a + bend) * (r0 + r1) * 0.5, cy + Math.sin(a + bend) * (r0 + r1) * 0.5,
      cx + Math.cos(a + bend * 1.6) * r1, cy + Math.sin(a + bend * 1.6) * r1);
    g.stroke();
  }
  return finish(c);
}

// Облачный «барашек»: кучевой край из кружков.
export function makeCloudTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const rnd = mulberry32(91);
  const cx = S / 2, cy = S / 2;
  g.fillStyle = 'rgb(245,245,245)';
  g.beginPath(); g.arc(cx, cy, S * 0.3, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = S * (0.05 + rnd() * 0.09);
    const d = S * 0.3 + (rnd() - 0.3) * S * 0.08;
    const dd = Math.min(d, S * 0.48 - rr);
    const v = 215 + Math.floor(rnd() * 40);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath(); g.arc(cx + Math.cos(a) * dd, cy + Math.sin(a) * dd, rr, 0, Math.PI * 2); g.fill();
  }
  return finish(c);
}

// Кора берёзы: белая с тёмными чечевичками и пятнами.
export function makeBirchBarkTexture() {
  const W = 128, H = 512;
  const [c, g] = canvas(W, H);
  const rnd = mulberry32(5);
  g.fillStyle = '#efeee9';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    const v = 215 + Math.floor(rnd() * 35);
    g.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
    g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 30, 1 + rnd() * 3);
  }
  for (let i = 0; i < 70; i++) {
    const w = 6 + rnd() * 26, h = 1.5 + rnd() * 3.5;
    const x = rnd() * W, y = rnd() * H;
    g.fillStyle = `rgba(28,28,36,${0.65 + rnd() * 0.35})`;
    g.beginPath(); g.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2); g.fill();
    if (x + w / 2 > W) { g.beginPath(); g.ellipse(x - W, y, w / 2, h / 2, 0, 0, Math.PI * 2); g.fill(); }
  }
  for (let i = 0; i < 9; i++) {
    const x = rnd() * W, y = rnd() * H, r = 6 + rnd() * 16;
    g.fillStyle = '#1d1d26';
    g.beginPath();
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2, rr = r * (0.5 + rnd() * 0.7);
      const px = x + Math.cos(a) * rr * 1.6, py = y + Math.sin(a) * rr * 0.7;
      if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath(); g.fill();
  }
  return finish(c, { repeat: true });
}

// Мягкая круглая снежинка для частиц.
export function makeFlakeTexture() {
  const S = 64;
  const [c, g] = canvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return finish(c, { srgb: false });
}
