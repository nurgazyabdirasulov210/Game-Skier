import * as THREE from 'three';
import { QUALITY_PRESETS, pickQuality } from './config.js';
import { heightAt, centerX, LAKE } from './terrain.js';
import { createWorld } from './world.js';
import { FlyControls } from './controls.js';
import { PALETTES, PALETTE_ORDER } from './palettes.js';

const params = new URLSearchParams(location.search);
const qualityName = pickQuality();
const Q = QUALITY_PRESETS[qualityName];

const status = document.getElementById('loading-status');
const step = (msg) => { if (status) status.textContent = msg; return new Promise((r) => setTimeout(r, 0)); };

async function init() {
  const canvas = document.getElementById('c');
  const mood = params.get('mood') && PALETTES[params.get('mood')] ? params.get('mood') : 'day';
  const world = await createWorld({ canvas, quality: Q, mood, step });
  const { renderer, scene, camera, veg, props, landmarks } = world;
  let current = mood;
  function setMood(name, instant = false) {
    if (!PALETTES[name]) return;
    world.setMood(name, instant);
    current = name;
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

  addEventListener('resize', () => world.resize());

  document.getElementById('loading').classList.add('done');

  // ---------------- loop
  const clock = new THREE.Clock();
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
    controls.update(dt);
    world.update(dt, time);
    world.render();

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
