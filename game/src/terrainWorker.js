// Builds terrain chunk geometry and object lists off the main thread.
import { setWorldSeed, heightAt, chunkObjects, forestDensity, rockiness, CHUNK } from './terrain.js';

export function buildChunk(cx, cz, segs) {
  const size = CHUNK;
  const step = size / segs;
  const N = segs + 1;
  const G = segs + 3; // grid with a 1-sample border for normals
  const x0 = cx * size, z0 = cz * size;

  const hs = new Float32Array(G * G);
  for (let j = 0; j < G; j++) {
    const z = z0 + (j - 1) * step;
    for (let i = 0; i < G; i++) {
      hs[j * G + i] = heightAt(x0 + (i - 1) * step, z);
    }
  }

  const skirt = N * 4;
  const vcount = N * N + skirt;
  const pos = new Float32Array(vcount * 3);
  const nrm = new Int8Array(vcount * 4);
  const dat = new Uint8Array(vcount * 4); // ao, forest, rock, unused
  let ymin = 1e9, ymax = -1e9;

  // coarse forest shade sampled sparsely and bilinearly expanded
  const FS = 9;
  const fgrid = new Float32Array(FS * FS);
  const rgrid = new Float32Array(FS * FS);
  for (let j = 0; j < FS; j++) for (let i = 0; i < FS; i++) {
    const x = x0 + (i / (FS - 1)) * size, z = z0 + (j / (FS - 1)) * size;
    fgrid[j * FS + i] = forestDensity(x, z);
    rgrid[j * FS + i] = rockiness(x, z);
  }
  const bil = (g, u, v) => {
    const fx = u * (FS - 1), fz = v * (FS - 1);
    const i = Math.min(FS - 2, Math.floor(fx)), j = Math.min(FS - 2, Math.floor(fz));
    const tx = fx - i, tz = fz - j;
    const a = g[j * FS + i], b = g[j * FS + i + 1], c = g[(j + 1) * FS + i], d = g[(j + 1) * FS + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const gi = (j + 1) * G + (i + 1);
      const h = hs[gi];
      const hl = hs[gi - 1], hr = hs[gi + 1], hd = hs[gi - G], hu = hs[gi + G];
      let nx = -(hr - hl), ny = 2 * step, nz = -(hu - hd);
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const v = j * N + i;
      pos[v * 3] = i * step;
      pos[v * 3 + 1] = h;
      pos[v * 3 + 2] = j * step;
      nrm[v * 4] = Math.round(nx * 127);
      nrm[v * 4 + 1] = Math.round(ny * 127);
      nrm[v * 4 + 2] = Math.round(nz * 127);
      // cavity term: concave spots collect shade, convex ridges catch light
      const lap = (hl + hr + hd + hu - 4 * h) / (step * step);
      const ao = Math.max(0, Math.min(1, 0.5 - lap * 0.9));
      const u = i / segs, w = j / segs;
      dat[v * 4] = Math.round(ao * 255);
      dat[v * 4 + 1] = Math.round(bil(fgrid, u, w) * 255);
      dat[v * 4 + 2] = Math.round(bil(rgrid, u, w) * 255);
      if (h < ymin) ymin = h;
      if (h > ymax) ymax = h;
    }
  }

  // skirts hide cracks between neighbouring LODs
  const drop = 1.5 + step * 1.5;
  let s = N * N;
  const edges = [
    (k) => k,                     // z = 0 row
    (k) => (N - 1) * N + k,       // z = max row
    (k) => k * N,                 // x = 0 column
    (k) => k * N + (N - 1),       // x = max column
  ];
  for (let e = 0; e < 4; e++) {
    for (let k = 0; k < N; k++) {
      const src = edges[e](k);
      pos[s * 3] = pos[src * 3];
      pos[s * 3 + 1] = pos[src * 3 + 1] - drop;
      pos[s * 3 + 2] = pos[src * 3 + 2];
      nrm[s * 4] = nrm[src * 4]; nrm[s * 4 + 1] = nrm[src * 4 + 1]; nrm[s * 4 + 2] = nrm[src * 4 + 2];
      dat[s * 4] = dat[src * 4]; dat[s * 4 + 1] = dat[src * 4 + 1]; dat[s * 4 + 2] = dat[src * 4 + 2];
      s++;
    }
  }
  return { pos, nrm, dat, ymin: ymin - drop, ymax };
}

// Only act as a worker when actually running inside one.
const isWorker = typeof self !== 'undefined' && typeof window === 'undefined' && typeof self.postMessage === 'function';
if (isWorker) {
  self.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'seed') {
      setWorldSeed(m.seed);
      return;
    }
    if (m.type === 'chunk') {
      const r = buildChunk(m.cx, m.cz, m.segs);
      self.postMessage({ type: 'chunk', id: m.id, cx: m.cx, cz: m.cz, segs: m.segs, ...r },
        [r.pos.buffer, r.nrm.buffer, r.dat.buffer]);
    } else if (m.type === 'objects') {
      const objs = chunkObjects(m.cx, m.cz);
      self.postMessage({ type: 'objects', id: m.id, cx: m.cx, cz: m.cz, objs }, [objs.buffer]);
    }
  };
}
