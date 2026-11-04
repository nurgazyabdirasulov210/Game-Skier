// Главные настройки карты. Размер горы меняется здесь.
export const CONFIG = {
  MAP_SIZE: 2000,      // сторона квадрата карты, метров (2 × 2 км)
  PEAK_HEIGHT: 720,    // высота вершины над подножием, метров
  SEED: 20261030,      // зерно генерации: другое число → другая гора
  CELL_SIZE: 250,      // размер ячейки для отсечения объектов, метров
};

// Пресеты качества графики (переключаются в меню, страница перезагружается).
export const QUALITY_PRESETS = {
  low: {
    label: 'Низкое',
    terrainSeg: 448,
    density: 0.45,
    shadowSize: 1024,
    shadowRange: 140,
    bloom: false,
    maxPixelRatio: 1,
    detail: false,
    lodNear: 260,
    lodFar: 1400,
    snowflakes: 2500,
    auroraSteps: 18,
  },
  medium: {
    label: 'Среднее',
    terrainSeg: 704,
    density: 0.75,
    shadowSize: 2048,
    shadowRange: 200,
    bloom: true,
    maxPixelRatio: 1.5,
    detail: true,
    lodNear: 420,
    lodFar: 2200,
    snowflakes: 5000,
    auroraSteps: 26,
  },
  high: {
    label: 'Высокое',
    terrainSeg: 1024,
    density: 1.0,
    shadowSize: 4096,
    shadowRange: 260,
    bloom: true,
    maxPixelRatio: 2,
    detail: true,
    lodNear: 600,
    lodFar: 3000,
    snowflakes: 8000,
    auroraSteps: 34,
  },
};

export function pickQuality() {
  const fromUrl = new URLSearchParams(location.search).get('q');
  if (fromUrl && QUALITY_PRESETS[fromUrl]) return fromUrl;
  try {
    const saved = localStorage.getItem('mapQuality');
    if (saved && QUALITY_PRESETS[saved]) return saved;
  } catch (e) { /* хранилище недоступно */ }
  const mobile = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700;
  return mobile ? 'low' : 'medium';
}
