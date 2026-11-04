// Light and colour presets ("moods") for a run.
import * as THREE from 'three';

const c = (h) => new THREE.Color(h);

export const MOODS = {
  day: {
    name: 'Ясный день',
    skyTop: c('#1546d0'), skyHorizon: c('#a9c6ff'), skyBottom: c('#c9d8ff'),
    sunColor: c('#fff1e0'), sunIntensity: 3.9, sunElevation: 0.6, sunAzimuth: -0.55,
    sunDisk: c('#fff6e8'), sunGlow: 0.35,
    hemiSky: c('#3d62ff'), hemiGround: c('#b9c8ff'), hemiIntensity: 1.05,
    fog: c('#b7cdfa'), fogNear: 90, fogFar: 560,
    snow: c('#ffffff'),
    crown: [c('#ff7a2a'), c('#ff9447'), c('#ff6a1f'), c('#ffa060')],
    crownRim: c('#ffc890'), crownSnow: 0.3,
    spruce: c('#13213f'), spruceSnow: c('#f2f6ff'),
    rock: c('#1a2045'), bark: c('#eeeaf2'),
    mountains: c('#e8eeff'), mountainShade: c('#6f8cff'),
    exposure: 1.0, aurora: 0, stars: 0, dust: 1,
    bloom: 0.28,
  },
  night: {
    name: 'Полярная ночь',
    skyTop: c('#030828'), skyHorizon: c('#14308e'), skyBottom: c('#1b3aa3'),
    sunColor: c('#a8bcff'), sunIntensity: 1.65, sunElevation: 0.55, sunAzimuth: 0.7,
    sunDisk: c('#dfe6ff'), sunGlow: 0.12,
    hemiSky: c('#1f3fd9'), hemiGround: c('#2b48c8'), hemiIntensity: 1.55,
    fog: c('#1a3394'), fogNear: 60, fogFar: 430,
    snow: c('#f4f6ff'),
    crown: [c('#ffb48e'), c('#ffc6a4'), c('#ff9f78'), c('#ffd3bb')],
    crownRim: c('#9fd6ff'), crownSnow: 0.55,
    spruce: c('#101a3e'), spruceSnow: c('#c6d3ff'),
    rock: c('#0e1438'), bark: c('#c9cff0'),
    mountains: c('#3a59c8'), mountainShade: c('#13246e'),
    exposure: 1.0, aurora: 1, stars: 1, dust: 0.4,
    bloom: 0.45,
  },
  sunset: {
    name: 'Закат',
    skyTop: c('#123f3c'), skyHorizon: c('#ffbf52'), skyBottom: c('#ff9c6a'),
    sunColor: c('#ffb36b'), sunIntensity: 3.4, sunElevation: 0.11, sunAzimuth: 0.15,
    sunDisk: c('#fff2c2'), sunGlow: 1.0,
    hemiSky: c('#6b46d6'), hemiGround: c('#ff9a84'), hemiIntensity: 1.2,
    fog: c('#e7907a'), fogNear: 70, fogFar: 480,
    snow: c('#ffe6e0'),
    crown: [c('#ff6a3d'), c('#ff8250'), c('#f2553a'), c('#ff9a66')],
    crownRim: c('#ffd27a'), crownSnow: 0.15,
    spruce: c('#2a1d4a'), spruceSnow: c('#ffd5c8'),
    rock: c('#2a1f4f'), bark: c('#f3d9d0'),
    mountains: c('#ff9f86'), mountainShade: c('#5b3aa8'),
    exposure: 0.9, aurora: 0, stars: 0, dust: 1.4,
    bloom: 0.55,
  },
};

export function sunDirection(mood, out = new THREE.Vector3()) {
  const el = mood.sunElevation, az = mood.sunAzimuth;
  // azimuth 0 = straight down the fall line (+z): sun ahead of the rider
  out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  return out.normalize();
}
