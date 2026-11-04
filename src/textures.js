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

// Пушистый «клочок» для спрайта кроны: плотный диск и густой мех по краю.
export function makeFurTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const rnd = mulberry32(77);
  g.lineCap = 'round';
  const cx = S / 2, cy = S / 2;
  g.fillStyle = 'rgb(250,250,250)';
  g.beginPath(); g.arc(cx, cy, S * 0.3, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 1100; i++) {
    const a = rnd() * Math.PI * 2;
    const r0 = S * (0.22 + rnd() * 0.08);
    const len = S * (0.04 + Math.pow(rnd(), 1.5) * 0.11);
    const r1 = Math.min(S * 0.49, r0 + len);
    const bend = (rnd() - 0.5) * 0.25;
    const v = 232 + Math.floor(rnd() * 23);
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.lineWidth = 1.5 + rnd() * 2.5;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.quadraticCurveTo(
      cx + Math.cos(a + bend) * (r0 + r1) * 0.5, cy + Math.sin(a + bend) * (r0 + r1) * 0.5,
      cx + Math.cos(a + bend * 1.8) * r1, cy + Math.sin(a + bend * 1.8) * r1);
    g.stroke();
  }
  return finish(c);
}

// Кора берёзы: белая, с крупными чёрными пятнами и короткими чёрточками.
export function makeBirchBarkTexture() {
  const W = 128, H = 512;
  const [c, g] = canvas(W, H);
  const rnd = mulberry32(5);
  g.fillStyle = '#f2f1ec';
  g.fillRect(0, 0, W, H);
  const blob = (x, y, rx, ry) => {
    g.beginPath();
    const n = 10;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2, rr = 0.6 + rnd() * 0.55;
      const px = x + Math.cos(a) * rx * rr, py = y + Math.sin(a) * ry * rr;
      if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath(); g.fill();
  };
  g.fillStyle = '#16161c';
  for (let i = 0; i < 16; i++) {
    const x = rnd() * W, y = rnd() * H, rx = 10 + rnd() * 26, ry = 6 + rnd() * 16;
    blob(x, y, rx, ry);
    if (x + rx > W) blob(x - W, y, rx, ry);
    if (x - rx < 0) blob(x + W, y, rx, ry);
  }
  for (let i = 0; i < 40; i++) {
    const x = rnd() * W, y = rnd() * H;
    g.fillRect(x, y, 6 + rnd() * 16, 1.5 + rnd() * 2);
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
