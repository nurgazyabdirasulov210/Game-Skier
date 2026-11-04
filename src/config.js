// Map layout and quality presets.

export const SEED = 7319;

// The run goes downhill along +Z. X is across the slope.
export const MAP = {
  halfX: 900,        // map is 1800 m wide
  halfZ: 1300,       // and 2600 m long
  top: 640,          // height of the summit area above the frozen lake
};

// Zones from top to bottom (Z ranges), used by terrain and scatter.
export const ZONES = {
  summit:   [-1300, -720],  // open wind-blown bowl, few gnarled birches
  birches:  [-720, -180],   // fluffy-crowned birch glades
  stones:   [-180, 260],    // plateau with dark slabs, logs, the leaning gate
  spruce:   [260, 820],     // dense dark spruce forest
  pines:    [820, 1300],    // tall pines with tufts, frozen lake at the bottom
};

export const QUALITY_PRESETS = {
  low: {
    terrainRes: [180, 260], treeDensity: 0.45, crownQuads: 14,
    shadowSize: 1024, shadowRange: 140, pixelRatio: 1, bloom: true, snowflakes: 1500, far: 3200,
  },
  medium: {
    terrainRes: [300, 430], treeDensity: 0.75, crownQuads: 20,
    shadowSize: 2048, shadowRange: 190, pixelRatio: 1.5, bloom: true, snowflakes: 3500, far: 4200,
  },
  high: {
    terrainRes: [420, 600], treeDensity: 1.0, crownQuads: 26,
    shadowSize: 4096, shadowRange: 240, pixelRatio: 2, bloom: true, snowflakes: 6000, far: 5200,
  },
};

export function pickQuality() {
  const q = new URLSearchParams(location.search).get('q');
  if (q && QUALITY_PRESETS[q]) return q;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return mobile ? 'low' : 'medium';
}
