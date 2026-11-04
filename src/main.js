import * as THREE from 'three';
import { QUALITY_PRESETS, pickQuality, MAP } from './config.js';
import { U } from './shading.js';
import { buildTerrain, heightAt, centerX, LAKE } from './terrain.js';
import { buildVegetation } from './vegetation.js';
import { buildProps, planLandmarks } from './props.js';
import { buildSky, buildSnowfall } from './sky.js';
import { buildPost } from './post.js';
import { FlyControls } from './controls.js';
import { PALETTES, PALETTE_ORDER, resolvePalette, blendPalettes, sunVector } from './palettes.js';

const params = new URLSearchParams(location.search);
const qualityName = pickQuality();
const Q = QUALITY_PRESETS[qualityName];

const status = document.getElementById('loading-status');
const step = (msg) => { if (status) status.textContent = msg; return new Promise((r) => setTimeout(r, 0)); };

async function init() {
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.3, Q.far);

  // lights
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
  const sc = sun.shadow.camera;
  sc.left = -Q.shadowRange; sc.right = Q.shadowRange; sc.top = Q.shadowRange; sc.bottom = -Q.shadowRange;
  sc.near = 1; sc.far = 1600;
  sc.layers.enable(1);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x8899ff, 0xccccff, 1.5);
  scene.add(hemi);

  await step('Рельеф…');
  const terrain = buildTerrain(Q);
  scene.add(terrain.mesh, terrain.outer);

  await step('Камни и брёвна…');
  const landmarks = planLandmarks();
  const props = buildProps(Q, scene, landmarks);

  await step('Лес…');
  const veg = buildVegetation(Q, scene, landmarks.exclusions());

  await step('Небо…');
  const sky = buildSky(Q.far * 0.9);
  scene.add(sky.mesh);
  const snow = buildSnowfall(Q.snowflakes);
  snow.uniforms.uPixel.value = renderer.getPixelRatio();
  scene.add(snow.points);

  const post = buildPost(renderer, scene, camera);
  post.setSize(innerWidth, innerHeight);

  // ---------------- palettes
  const resolved = Object.fromEntries(PALETTE_ORDER.map((k) => [k, resolvePalette(PALETTES[k])]));
  let current = params.get('mood') && PALETTES[params.get('mood')] ? params.get('mood') : 'day';
  let blendFrom = resolved[current], blendTo = resolved[current], blendT = 1;
  let live = blendPalettes(blendFrom, blendTo, 1);
  const sunDir = new THREE.Vector3();

  function applyPalette(p) {
    sunVector(p.sun.az, p.sun.el, sunDir);
    U.uSunDir.value.copy(sunDir);
    U.uSunColor.value.copy(p.sunColor);
    U.uSunIntensity.value = p.sunI;
    U.uHemiSky.value.copy(p.hemiSky);
    U.uHemiGround.value.copy(p.hemiGround);
    U.uHemiIntensity.value = p.hemiI;
    U.uFogColor.value.copy(p.fog);
    U.uFogSunColor.value.copy(p.fogSun);
    U.uFogDensity.value = p.fogDensity;
    U.uFogFalloff.value = p.fogFalloff;
    U.uRimColor.value.copy(p.rim).multiplyScalar(p.rimI);
    U.uSnowColor.value.copy(p.snow);
    U.uSparkle.value = p.sparkle;
    sun.color.copy(p.sunColor);
    sun.intensity = p.sunI;
    hemi.color.copy(p.hemiSky);
    hemi.groundColor.copy(p.hemiGround);
    hemi.intensity = p.hemiI;
    terrain.snowMat.color.copy(p.snow);
    terrain.outerMat.color.copy(p.snow);
    veg.birchCrowns.setColors(p.birchA, p.birchB, p.birchShade);
    veg.birchCrowns.uniforms.uTranslucency.value = p.translucency;
    veg.tuftCrowns.setColors(p.tuftA, p.tuftB, p.tuftShade);
    veg.tuftCrowns.uniforms.uTranslucency.value = p.translucency * 0.8;
    veg.needleMat.color.copy(p.needles);
    veg.birchMat.color.copy(p.bark);
    veg.pineMat.color.copy(p.pineBark);
    veg.spruceTrunkMat.color.copy(p.pineBark).multiplyScalar(0.7);
    props.rockMat.color.copy(p.rock);
    props.barkMat.color.copy(p.bark);
    props.ice.uniforms.uIce.value.copy(p.ice);
    props.ice.uniforms.uIceDeep.value.copy(p.iceDeep);
    const su = sky.uniforms;
    su.uZenith.value.copy(p.zenith);
    su.uHorizon.value.copy(p.horizon);
    su.uGlowColor.value.copy(p.glow);
    su.uGlow.value = p.glowI;
    su.uDiscColor.value.copy(p.disc);
    su.uDisc.value = p.discI;
    su.uDiscSize.value = p.discSize;
    su.uStars.value = p.stars;
    su.uAurora.value = p.aurora;
    su.uClouds.value = p.clouds;
    su.uCloudColor.value.copy(p.cloudColor);
    snow.uniforms.uAmount.value = p.snowfall;
    snow.uniforms.uColor.value.copy(p.flake);
    snow.points.visible = p.snowfall > 0.01;
    renderer.toneMappingExposure = p.exposure;
    post.bloom.strength = p.bloom.strength;
    post.bloom.radius = p.bloom.radius;
    post.bloom.threshold = p.bloom.threshold;
    const g = post.grade.uniforms;
    g.uSat.value = p.grade.sat;
    g.uContrast.value = p.grade.contrast;
    g.uLift.value.copy(p.grade.lift);
    g.uGain.value.copy(p.grade.gain);
    g.uVignette.value = p.grade.vignette;
    g.uStreaks.value = p.grade.streaks;
    g.uStreakColor.value.copy(p.grade.streakColor);
  }
  applyPalette(live);

  function setMood(name, instant = false) {
    if (!PALETTES[name]) return;
    blendFrom = blendPalettes(live, live, 0);
    blendTo = resolved[name];
    blendT = instant ? 1 : 0;
    current = name;
    if (instant) { live = blendPalettes(blendTo, blendTo, 1, live); applyPalette(live); }
    document.querySelectorAll('[data-mood]').forEach((b) => b.classList.toggle('on', b.dataset.mood === name));
  }

  // ---------------- camera, viewpoints
  const controls = new FlyControls(camera, canvas);
  const pt = (x, z, up) => new THREE.Vector3(x, heightAt(x, z) + up, z);
  const VIEWS = {
    summit: { name: 'Вершина', pos: pt(centerX(-1180) - 30, -1180, 6), look: pt(centerX(-900), -900, -40) },
    birches: { name: 'Берёзовая роща', pos: pt(centerX(-520) - 15, -520, 3), look: pt(centerX(-440) + 20, -440, 4) },
    gate: { name: 'Наклонные плиты', pos: pt(landmarks.gate.x - 10, landmarks.gate.z - 60, 4), look: pt(landmarks.gate.x, landmarks.gate.z, 7) },
    cliff: { name: 'Карниз', pos: pt(centerX(196) + 30, 196, 3), look: pt(centerX(360) + 20, 360, -6) },
    bridge: { name: 'Ствол-мост', pos: pt(landmarks.bridge.x - 6, landmarks.bridge.z - 55, 3), look: pt(landmarks.bridge.x, landmarks.bridge.z, 6) },
    spruce: { name: 'Ельник', pos: pt(centerX(700) + 60, 700, 2.5), look: pt(centerX(740) + 70, 740, 4) },
    lake: { name: 'Озеро', pos: pt(centerX(940), 940, 14), look: new THREE.Vector3(LAKE.x, 0, LAKE.z) },
    overview: { name: 'Обзор', pos: new THREE.Vector3(420, 980, -980), look: new THREE.Vector3(-40, 150, 380) },
  };
  const startView = VIEWS[params.get('view')] || VIEWS.birches;
  controls.setPose(startView.pos, startView.look);
  if (params.get('pose')) {
    const [x, y, z, yaw, pitch] = params.get('pose').split(',').map(Number);
    camera.position.set(x, y, z); controls.yaw = yaw; controls.pitch = pitch;
  }

  // ---------------- UI
  const ui = document.getElementById('ui');
  const moodBox = document.getElementById('moods');
  for (const k of PALETTE_ORDER) {
    const b = document.createElement('button');
    b.textContent = PALETTES[k].name;
    b.dataset.mood = k;
    b.onclick = (e) => { e.stopPropagation(); setMood(k); };
    moodBox.appendChild(b);
  }
  const viewBox = document.getElementById('views');
  for (const [k, v] of Object.entries(VIEWS)) {
    const b = document.createElement('button');
    b.textContent = v.name;
    b.onclick = (e) => { e.stopPropagation(); controls.flyTo(v.pos, v.look, k === 'overview' ? 4 : 3); };
    viewBox.appendChild(b);
  }
  const tourBtns = document.querySelectorAll('[data-tour]');
  tourBtns.forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    if (controls.tour?.kind === b.dataset.tour) controls.stopTour();
    else controls.startTour(b.dataset.tour);
    refreshTour();
  }));
  const refreshTour = () => tourBtns.forEach((b) => b.classList.toggle('on', controls.tour?.kind === b.dataset.tour));
  controls.onUserInput = refreshTour;
  document.getElementById('menu-toggle').onclick = (e) => { e.stopPropagation(); ui.classList.toggle('collapsed'); };
  const up = document.getElementById('btn-up'), down = document.getElementById('btn-down');
  for (const [b, v] of [[up, 1], [down, -1]]) {
    b.addEventListener('touchstart', (e) => { controls.touchUpDown = v; e.preventDefault(); e.stopPropagation(); }, { passive: false });
    b.addEventListener('touchend', () => (controls.touchUpDown = 0));
  }
  addEventListener('keydown', (e) => {
    const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
    if (i >= 0) setMood(PALETTE_ORDER[i]);
    if (e.code === 'KeyT') setMood(PALETTE_ORDER[(PALETTE_ORDER.indexOf(current) + 1) % PALETTE_ORDER.length]);
    if (e.code === 'KeyH') document.body.classList.toggle('clean');
    if (e.code === 'KeyR') { controls.tour ? controls.stopTour() : controls.startTour('ride'); refreshTour(); }
  });
  setMood(current, true);
  if (params.get('tour')) { controls.startTour(params.get('tour')); refreshTour(); }
  if (params.has('clean')) document.body.classList.add('clean');

  const info = document.getElementById('info');
  const c = { ...veg.counts, ...props.counts };
  info.dataset.base = `${qualityName} · берёз ${c.birches} · елей ${c.spruces} · сосен ${c.pines} · крон ${c.crowns} · камней ${c.rocks}`;

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    post.setSize(innerWidth, innerHeight);
  });

  document.getElementById('loading').classList.add('done');

  // ---------------- loop
  const clock = new THREE.Clock();
  const fwd = new THREE.Vector3();
  const texel = (Q.shadowRange * 2) / Q.shadowSize;
  let frames = 0, fpsT = 0;
  let time = 0;
  const stillFrames = params.has('still') ? Number(params.get('still') || 2) : 0;
  let frameNo = 0;
  renderer.setAnimationLoop(() => {
    const dt = stillFrames ? 1 / 30 : Math.min(clock.getDelta(), 0.1);
    if (stillFrames && ++frameNo > stillFrames) {
      renderer.setAnimationLoop(null);
      document.body.dataset.ready = '1';
      return;
    }
    time += dt;
    U.uTime.value = time;
    controls.update(dt);

    if (blendT < 1) {
      blendT = Math.min(1, blendT + dt / 2.2);
      const k = blendT * blendT * (3 - 2 * blendT);
      live = blendPalettes(blendFrom, blendTo, k, live);
      applyPalette(live);
    }

    // shadow box follows the camera
    camera.getWorldDirection(fwd);
    fwd.y = 0; fwd.normalize();
    const cx = Math.round((camera.position.x + fwd.x * Q.shadowRange * 0.55) / texel) * texel;
    const cz = Math.round((camera.position.z + fwd.z * Q.shadowRange * 0.55) / texel) * texel;
    const cy = heightAt(cx, cz);
    sun.target.position.set(cx, cy, cz);
    sun.position.set(cx, cy, cz).addScaledVector(sunDir, 700);
    sun.target.updateMatrixWorld();

    veg.update(camera.position);
    props.update(camera.position);
    sky.mesh.position.copy(camera.position);
    post.update(sunDir, time);
    post.render();

    frames++; fpsT += dt;
    if (fpsT > 0.5) {
      info.textContent = `${Math.round(frames / fpsT)} fps · ${info.dataset.base}`;
      frames = 0; fpsT = 0;
    }
  });
  window.__map = { scene, camera, renderer, controls, setMood, VIEWS };
}

init().catch((e) => {
  console.error(e);
  if (status) status.textContent = 'Ошибка: ' + e.message;
});
