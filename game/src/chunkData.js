// Vertex data for one square terrain chunk. The grid carries an extra ring
// of "skirt" vertices pushed below the surface, hiding cracks between chunks
// of different detail.
import { height } from './world.js';

export function buildChunkData(x0, z0, size, seg) {
  const step = size / seg;
  const N = seg + 1;          // surface vertices per side
  const G = N + 2;            // height samples incl. one border sample
  const hs = new Float32Array(G * G);
  let minY = Infinity, maxY = -Infinity;
  for (let j = 0; j < G; j++) {
    const z = z0 + (j - 1) * step;
    for (let i = 0; i < G; i++) {
      const y = height(x0 + (i - 1) * step, z);
      hs[j * G + i] = y;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const V = N + 2;            // with skirt ring
  const positions = new Float32Array(V * V * 3);
  const normals = new Float32Array(V * V * 3);
  const skirt = Math.max(1.5, step * 3);
  let k = 0;
  for (let vj = 0; vj < V; vj++) {
    const j = Math.min(N - 1, Math.max(0, vj - 1));
    const edgeJ = vj === 0 || vj === V - 1;
    for (let vi = 0; vi < V; vi++) {
      const i = Math.min(N - 1, Math.max(0, vi - 1));
      const edge = edgeJ || vi === 0 || vi === V - 1;
      const gi = i + 1, gj = j + 1;
      const y = hs[gj * G + gi];
      positions[k] = x0 + i * step;
      positions[k + 1] = edge ? y - skirt : y;
      positions[k + 2] = z0 + j * step;
      const hx = (hs[gj * G + gi + 1] - hs[gj * G + gi - 1]) / (2 * step);
      const hz = (hs[(gj + 1) * G + gi] - hs[(gj - 1) * G + gi]) / (2 * step);
      const l = Math.hypot(hx, 1, hz);
      normals[k] = -hx / l;
      normals[k + 1] = 1 / l;
      normals[k + 2] = -hz / l;
      k += 3;
    }
  }
  return { positions, normals, minY: minY - skirt, maxY };
}
