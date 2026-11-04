import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { CONFIG, QUALITY_PRESETS, pickQuality } from './config.js';
import { TerrainGrid, buildFarTerrain, heightAt, insideMap, PEAK_UV } from './terrain.js';
import { makeTerrainMaterial, SHARED } from './materials.js';
import { buildWorld, buildClouds, makeSampler, makeViewpoints } from './world.js';
import { createSky, createSnowfall } from './sky.js';
import { TimeOfDay } from './timeOfDay.js';
import { FlyControls, Tour } from './controls.js';

const qualityKey = pickQuality();
const Q = QUALITY_PRESETS[qualityKey];
const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function status(text) {
  $('loadText').textContent = text;
  await nextFrame();
}

async function init() {
  await status('Подготовка…');
  const renderer = new THREE.WebGLRenderer({ antialias: !Q.bloom, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.maxPixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xffffff, 0.0002);
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 16000);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
  const sc = sun.shadow.camera;
  sc.left = -Q.shadowRange; sc.right = Q.shadowRange; sc.top = Q.shadowRange; sc.bottom = -Q.shadowRange;
  sc.near = 1; sc.far = 4000;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.35;
  scene.add(sun, sun.target);

  const sky = createSky(Q);
  scene.add(sky.mesh);

  await status('Лепим гору…');
  const grid = new TerrainGrid(Q.terrainSeg);
  grid.computeCavityAO();

  await status('Сажаем лес, раскладываем камни…');
  const world = buildWorld(scene, grid, Q);

  await status('Снег и рельеф…');
  const terrainMat = makeTerrainMaterial(Q);
  scene.add(grid.buildChunks(terrainMat));
  scene.add(buildFarTerrain(terrainMat));
  buildClouds(scene, world.cloudMat);

  const snowfall = createSnowfall(Q.snowflakes);
  scene.add(snowfall.points);

  const { sample } = makeSampler(grid);
  const groundAt = (x, z) => (insideMap(x, z, 2) ? sample(x, z) : heightAt(x, z));

  const tod = new TimeOfDay({ renderer, scene, sun, hemi, sky, shared: SHARED, snowfall, cloudMat: world.cloudMat });

  // ---------- постобработка
  let composer = null, bloom = null;
  if (Q.bloom) {
    const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(innerWidth, innerHeight);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.55, 0.92);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  // ---------- камера и управление
  const controls = new FlyControls(camera, renderer.domElement, groundAt);
  const viewpoints = makeViewpoints(world, sample);
  const start = viewpoints.find((v) => v.name === 'Склон') || viewpoints[0];
  camera.position.copy(start.pos);
  controls.lookAt(start.look);
  const peak = new THREE.Vector3(PEAK_UV.u * CONFIG.MAP_SIZE / 2, 0, PEAK_UV.v * CONFIG.MAP_SIZE / 2);
  const tour = new Tour(controls, groundAt, peak);

  // ---------- интерфейс
  const ui = setupUI({ tod, controls, tour, viewpoints, world });
  tod.set(ui.hour);

  await status('Компиляция шейдеров…');
  renderer.compile(scene, camera);
  $('loading').classList.add('done');
  setTimeout(() => $('loading').remove(), 900);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    if (composer) composer.setSize(innerWidth, innerHeight);
  });

  // ---------- тени следуют за камерой (с привязкой к текселю, чтобы не мерцали)
  const L = new THREE.Vector3(), R = new THREE.Vector3(), U = new THREE.Vector3(), c = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  function updateShadow() {
    L.copy(tod.lightDir);
    R.crossVectors(UP, L).normalize();
    U.crossVectors(L, R);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    fwd.y = 0; fwd.normalize();
    c.copy(camera.position).addScaledVector(fwd, Q.shadowRange * 0.45);
    c.y = groundAt(c.x, c.z);
    const texel = (2 * Q.shadowRange) / Q.shadowSize;
    const cx = Math.round(c.dot(R) / texel) * texel;
    const cy = Math.round(c.dot(U) / texel) * texel;
    const cz = c.dot(L);
    c.copy(R).multiplyScalar(cx).addScaledVector(U, cy).addScaledVector(L, cz);
    sun.target.position.copy(c);
    sun.position.copy(c).addScaledVector(L, 2000);
    sun.target.updateMatrixWorld();
  }

  // ---------- цикл
  const clock = new THREE.Clock();
  let time = 0, lodTimer = 0, flakes = 0;
  const lastLodPos = new THREE.Vector3(1e9, 0, 0);
  let fpsAcc = 0, fpsN = 0;
  function frame(dt) {
    time += dt;
    if (ui.autoTime()) {
      ui.hour = (ui.hour + dt * ui.timeSpeed) % 24;
      tod.set(ui.hour);
      ui.syncTime();
    }
    SHARED.uTime.value = time;
    sky.uniforms.uTime.value = time;
    snowfall.uniforms.uTime.value = time;

    tour.update(dt);
    controls.enabled = !tour.active;
    controls.update(dt);
    sky.mesh.position.copy(camera.position);
    snowfall.uniforms.uCam.value.copy(camera.position);
    snowfall.uniforms.uScale.value = renderer.getPixelRatio() * innerHeight / 900;
    const flakeTarget = ui.snowMode() === 'on' ? 1 : ui.snowMode() === 'off' ? 0 : tod.flakesAuto || 0;
    flakes += (flakeTarget - flakes) * (1 - Math.exp(-dt * 1.5));
    snowfall.uniforms.uOpacity.value = flakes;
    snowfall.points.visible = flakes > 0.01;

    lodTimer -= dt;
    if (lodTimer <= 0 || camera.position.distanceToSquared(lastLodPos) > 400) {
      for (const s of world.scatters) s.update(camera.position);
      lastLodPos.copy(camera.position);
      lodTimer = 0.25;
    }
    updateShadow();
    if (bloom) bloom.strength = tod.state.stars > 0.5 ? 0.42 : 0.26;

    if (composer) composer.render(); else renderer.render(scene, camera);

    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { ui.setFps(Math.round(fpsN / fpsAcc), renderer.info.render.calls); fpsAcc = 0; fpsN = 0; }
  }
  renderer.setAnimationLoop(() => frame(Math.min(clock.getDelta(), 0.05)));

  // для отладки и скриншотов
  window.__map = {
    renderer, scene, camera, controls, tod, world, viewpoints, tour, ui, groundAt,
    // один кадр без цикла (для скриншотов в медленном программном рендере)
    still(w = 960, h = 540) {
      renderer.setAnimationLoop(null);
      renderer.setPixelRatio(1);
      renderer.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      if (composer) { composer.setPixelRatio(1); composer.setSize(w, h); }
      lastLodPos.set(1e9, 0, 0);
      renderer.info.autoReset = false;
      renderer.info.reset();
      frame(0.016);
      this.lastInfo = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
      renderer.info.autoReset = true;
      return renderer.domElement.toDataURL('image/jpeg', 0.9);
    },
  };
}

function setupUI({ tod, controls, tour, viewpoints, world }) {
  const params = new URLSearchParams(location.search);
  const state = {
    hour: params.has('t') ? parseFloat(params.get('t')) : 13,
    timeSpeed: 0.12,
  };
  const slider = $('time'), label = $('timeLabel'), auto = $('autoTime'), snowSel = $('snow');
  slider.value = state.hour;
  const syncTime = () => { slider.value = state.hour.toFixed(2); label.textContent = TimeOfDay.label(state.hour); };
  slider.addEventListener('input', () => { state.hour = parseFloat(slider.value); tod.set(state.hour); syncTime(); });
  document.querySelectorAll('[data-hour]').forEach((b) => b.addEventListener('click', () => {
    state.hour = parseFloat(b.dataset.hour); tod.set(state.hour); syncTime();
  }));
  syncTime();

  const vpBox = $('viewpoints');
  viewpoints.forEach((vp) => {
    const b = document.createElement('button');
    b.textContent = vp.name;
    b.addEventListener('click', () => { tour.stop(); tourBtn.classList.remove('on'); controls.flyTo(vp.pos, vp.look); });
    vpBox.appendChild(b);
  });
  const tourBtn = $('tour');
  tourBtn.addEventListener('click', () => {
    if (tour.active) { tour.stop(); tourBtn.classList.remove('on'); }
    else { tour.start(); tourBtn.classList.add('on'); }
  });
  controls.onUserInput = () => { if (tour.active && !controls.isTouch) { tour.stop(); tourBtn.classList.remove('on'); } };

  const qSel = $('quality');
  Object.entries(QUALITY_PRESETS).forEach(([k, v]) => {
    const o = document.createElement('option'); o.value = k; o.textContent = v.label;
    if (k === qualityKey) o.selected = true;
    qSel.appendChild(o);
  });
  qSel.addEventListener('change', () => {
    try { localStorage.setItem('mapQuality', qSel.value); } catch (e) { /* нет хранилища */ }
    const u = new URL(location.href); u.searchParams.set('q', qSel.value); u.searchParams.set('t', state.hour.toFixed(2));
    location.href = u.toString();
  });

  const speed = $('speed');
  const showSpeed = (s) => { speed.textContent = Math.round(s) + ' м/с'; };
  controls.onSpeed = showSpeed; showSpeed(controls.speed);

  const panel = $('panel');
  $('togglePanel').addEventListener('click', () => panel.classList.toggle('hidden'));
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyH') document.body.classList.toggle('noui');
    if (e.code === 'KeyT') { state.hour = (state.hour + 0.5) % 24; tod.set(state.hour); syncTime(); }
  });

  // кнопки вверх/вниз для сенсорного экрана
  const hold = (el, v) => {
    if (!el) return;
    el.addEventListener('touchstart', (e) => { controls.vertical = v; e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', () => { controls.vertical = 0; });
    el.addEventListener('touchcancel', () => { controls.vertical = 0; });
  };
  hold($('btnUp'), 1); hold($('btnDown'), -1);
  if (controls.isTouch) {
    document.body.classList.add('touch');
    panel.classList.add('hidden'); // на телефоне меню свёрнуто, чтобы не закрывать гору
  }

  const st = world.stats;
  $('stats').textContent =
    `Ели ${st.spruce || 0} · Берёзы ${st.birch || 0} · Сосны ${st.pine || 0} · Сухостой ${st.snag || 0} · ` +
    `Скалы ${(st.cliff || 0)} · Валуны ${(st.boulder || 0)} · Камни ${(st.rock || 0)} · Брёвна ${(st.log || 0)} · ` +
    `Пни ${(st.stump || 0)} · Кусты ${(st.bush || 0)} · Арки ${st.arch}`;

  const fpsEl = $('fps');
  return {
    get hour() { return state.hour; },
    set hour(v) { state.hour = v; },
    timeSpeed: state.timeSpeed,
    autoTime: () => auto.checked,
    snowMode: () => snowSel.value,
    syncTime,
    setFps: (f, calls) => { fpsEl.textContent = `${f} FPS · ${calls} вызовов`; },
  };
}

init().catch((err) => {
  console.error(err);
  $('loadText').textContent = 'Ошибка: ' + (err && err.message ? err.message : err);
});
