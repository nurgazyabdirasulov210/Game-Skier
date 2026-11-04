// Procedural canvas textures: fluffy crown sprite, birch bark, dark bark.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

/**
 * A round tuft of fur. Alpha = silhouette with a ragged, hairy edge.
 * Red channel = strand brightness (tips lighter than roots).
 */
export function makeFurTexture(seed = 3) {
  const S = 256;
  const [c, g] = canvas(S, S);
  const rnd = mulberry32(seed);
  g.clearRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2, R = S * 0.46;
  // dense core
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.62);
  grad.addColorStop(0, 'rgb(150,150,150)');
  grad.addColorStop(1, 'rgb(110,110,110)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, R * 0.6, 0, Math.PI * 2);
  g.fill();
  // strands: from inside outward, slightly curved
  g.lineCap = 'round';
  for (let i = 0; i < 1500; i++) {
    const a = rnd() * Math.PI * 2;
    const r0 = Math.sqrt(rnd()) * R * 0.58;
    const len = R * (0.18 + rnd() * 0.3);
    const r1 = Math.min(R, r0 + len);
    const bend = (rnd() - 0.5) * 0.35;
    const x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0;
    const x1 = cx + Math.cos(a + bend) * r1, y1 = cy + Math.sin(a + bend) * r1;
    const tip = r1 / R;
    const v = Math.floor(90 + 160 * tip * (0.6 + rnd() * 0.4));
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.lineWidth = 1.2 + rnd() * 2.6 * (1 - tip * 0.6);
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo(cx + Math.cos(a) * (r0 + r1) / 2, cy + Math.sin(a) * (r0 + r1) / 2, x1, y1);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/** White birch bark with bold black patches and thin horizontal lenticels. */
export function makeBirchBark(seed = 9) {
  const W = 128, H = 512;
  const [c, g] = canvas(W, H);
  const rnd = mulberry32(seed);
  g.fillStyle = '#f2efe9';
  g.fillRect(0, 0, W, H);
  // faint vertical tone
  for (let x = 0; x < W; x += 2) {
    g.fillStyle = `rgba(200,195,210,${0.08 + rnd() * 0.1})`;
    g.fillRect(x, 0, 2, H);
  }
  // big black patches
  g.fillStyle = '#16161c';
  for (let i = 0; i < 26; i++) {
    const y = rnd() * H, x = rnd() * W;
    const w = 14 + rnd() * 50, h = 6 + rnd() * 22;
    g.beginPath();
    g.moveTo(x - w / 2, y);
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      g.lineTo(x - w / 2 + w * t, y - h * (0.3 + 0.7 * Math.sin(t * Math.PI)) * (0.7 + rnd() * 0.6));
    }
    for (let k = 8; k >= 0; k--) {
      const t = k / 8;
      g.lineTo(x - w / 2 + w * t, y + h * 0.4 * Math.sin(t * Math.PI) * (0.6 + rnd() * 0.6));
    }
    g.closePath();
    g.fill();
    // wrap horizontally
    if (x - w / 2 < 0 || x + w / 2 > W) {
      g.save();
      g.translate(x - w / 2 < 0 ? W : -W, 0);
      g.fillRect(x - w / 3, y - h / 3, w / 1.5, h / 2);
      g.restore();
    }
  }
  // lenticels
  for (let i = 0; i < 220; i++) {
    const y = rnd() * H, x = rnd() * W;
    g.fillStyle = `rgba(30,30,40,${0.35 + rnd() * 0.5})`;
    g.fillRect(x, y, 4 + rnd() * 18, 1 + rnd() * 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Dark, slightly blue conifer bark with vertical furrows. */
export function makeDarkBark(seed = 4) {
  const W = 64, H = 256;
  const [c, g] = canvas(W, H);
  const rnd = mulberry32(seed);
  g.fillStyle = '#3a3240';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {
    const x = rnd() * W;
    g.fillStyle = `rgba(${rnd() < 0.5 ? '20,16,28' : '90,80,96'},${0.3 + rnd() * 0.4})`;
    g.fillRect(x, rnd() * H, 1 + rnd() * 3, 20 + rnd() * 120);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Spruce bough texture: v runs from the trunk (0) to the bough tip (1).
 * Bright strokes = snow-laden needles, dark gaps = shadowed needles.
 */
export function makeBoughTexture(seed = 12) {
  const W = 256, H = 256;
  const [c, g] = canvas(W, H);
  const rnd = mulberry32(seed);
  g.fillStyle = 'rgb(70,70,70)';
  g.fillRect(0, 0, W, H);
  g.lineCap = 'round';
  // boughs: long strokes from the trunk outward with needle ticks
  for (let i = 0; i < 46; i++) {
    const x0 = rnd() * W;
    const x1 = x0 + (rnd() - 0.5) * 50;
    const bright = rnd() < 0.55;
    const v = bright ? 200 + rnd() * 55 : 30 + rnd() * 50;
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.lineWidth = 3 + rnd() * 7;
    g.beginPath();
    g.moveTo(x0, rnd() * H * 0.3);
    g.quadraticCurveTo((x0 + x1) / 2 + (rnd() - 0.5) * 20, H * 0.6, x1, H);
    g.stroke();
    // needle ticks
    for (let k = 0; k < 26; k++) {
      const t = rnd();
      const x = x0 + (x1 - x0) * t, y = H * (0.15 + t * 0.85);
      const side = rnd() < 0.5 ? -1 : 1;
      g.lineWidth = 1 + rnd() * 2;
      const tv = bright ? v - rnd() * 60 : v + rnd() * 30;
      g.strokeStyle = `rgb(${tv},${tv},${tv})`;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + side * (6 + rnd() * 10), y + 4 + rnd() * 8);
      g.stroke();
    }
  }
  // wrap seam
  const img = g.getImageData(0, 0, 24, H);
  g.putImageData(img, W - 24, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
