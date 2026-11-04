// The mountain: an endless powder slope that falls toward +z.
// Pure functions (no three.js) shared by the game and the terrain worker.

import { makeNoise2D, smoothstep, clamp } from './util.js';

const nA = makeNoise2D(1301);
const nB = makeNoise2D(2203);
const nC = makeNoise2D(3307);
const nD = makeNoise2D(4409);
const nE = makeNoise2D(5501);
const nF = makeNoise2D(6607);

export const SLOPE = 0.34;     // base gradient: ~17 degrees
export const START = { x: 0, z: 0 };

// Ledge bands: every LEDGE_PERIOD metres downhill the slope eases off and
// then breaks over a short steep drop, only where the ledge mask is on.
const LEDGE_PERIOD = 240;

export function ledgeMask(x, z) {
  const m = nC(x * 0.0017 - 20, z * 0.0017 + 11);
  // keep the very first stretch friendly
  const startFade = smoothstep(150, 320, z);
  return smoothstep(0.05, 0.4, m) * startFade;
}

export function height(x, z) {
  // domain warp gives the hills a wind-sculpted, non-grid look
  const wx = x + 45 * nE(x * 0.0021, z * 0.0021);
  const wz = z + 45 * nE(x * 0.0021 + 40, z * 0.0021 - 25);

  let h = -SLOPE * z;

  // ridges and gullies running down the fall line, steeper and flatter pitches
  h += 38 * nA(wx * 0.0011, wz * 0.00045);
  h += 10 * nA(wx * 0.0032 + 7.1, wz * 0.0016 - 3.3);
  h += 26 * nB(0.37, z * 0.0009);

  // a soft channel that wanders down the hill keeps the start inviting
  const channel = x - 140 * nB(z * 0.0012, 0.5);
  h += 8 * smoothstep(0, 200, Math.abs(channel)) - 4;

  // rollers stretched across the fall line: natural kickers
  const r1 = nB(wx * 0.0075, wz * 0.0155);
  h += 5.2 * r1;
  h += 2.0 * nB(wx * 0.021 + 3.7, wz * 0.034 + 9.1);

  // wind lips and pillows
  const p = nD(x * 0.06, z * 0.06);
  h += 0.55 * p * Math.abs(p) + 0.35 * nD(x * 0.15 + 4, z * 0.15 - 2);

  // ledges
  const lm = ledgeMask(x, z);
  if (lm > 0) {
    const t = (wz + 30 * nF(x * 0.004, 2.5)) / LEDGE_PERIOD;
    const f = t - Math.floor(t);
    const s = smoothstep(0.968, 1.0, f);
    const amp = 17 * lm;
    h += amp * (f - s);
    // cornice lip just before the drop
    h += 1.4 * lm * smoothstep(0.90, 0.962, f) * (1 - smoothstep(0.962, 0.975, f));
  }
  return h;
}

export function normalAt(x, z, out) {
  const e = 0.35;
  const hx = (height(x + e, z) - height(x - e, z)) / (2 * e);
  const hz = (height(x, z + e) - height(x, z - e)) / (2 * e);
  const l = Math.hypot(hx, 1, hz);
  out.x = -hx / l; out.y = 1 / l; out.z = -hz / l;
  return out;
}

// Forest cover 0..1: groves separated by glades.
export function forestDensity(x, z) {
  const big = nA(x * 0.0035 + 91, z * 0.0035 - 17);
  const mid = nD(x * 0.013 + 5, z * 0.013 + 8);
  let d = smoothstep(-0.25, 0.45, big * 0.75 + mid * 0.45);
  // open start area
  const r = Math.hypot(x - START.x, (z - START.z) * 0.6);
  d *= smoothstep(25, 70, r);
  return clamp(d, 0, 1);
}

// Which kind of forest: <0 fluffy birches, >0 tall spruces.
export function forestKind(x, z) {
  return nF(x * 0.0019 - 33, z * 0.0019 + 71) + 0.25 * nE(x * 0.01, z * 0.01);
}

// Rocky open ground with boulders and stone gates.
export function rockiness(x, z) {
  return smoothstep(0.1, 0.55, nC(x * 0.003 + 55, z * 0.003 - 81));
}

// Direction of the fall line (yaw, 0 = +z), averaged over a few metres.
export function fallLineYaw(x, z) {
  const e = 6;
  const hx = height(x + e, z) - height(x - e, z);
  const hz = height(x, z + e) - height(x, z - e);
  return Math.atan2(-hx, -hz);
}
