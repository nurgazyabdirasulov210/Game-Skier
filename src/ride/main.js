import * as THREE from 'three';
import { QUALITY_PRESETS, pickQuality } from '../config.js';
import { createWorld } from '../world.js';
import { heightAt, centerX } from '../terrain.js';
import { PALETTES, PALETTE_ORDER } from '../palettes.js';
import { Rider, OUTFITS } from './rider.js';
import { Trail } from './trail.js';
import { Spray } from './spray.js';
import { Score } from './score.js';
import { RideAudio } from './audio.js';
import { Skier } from './skier.js';

const params = new URLSearchParams(location.search);
const qualityName = pickQuality();
const Q = { ...QUALITY_PRESETS[qualityName] };
Q.terrainRes = qualityName === 'low' ? [220, 320] : qualityName === 'medium' ? [340, 490] : [440, 640];
Q.shadowRange = Math.min(Q.shadowRange, 120);

const status = document.getElementById('loading-status');
const step = (msg) => { if (status) status.textContent = msg; return new Promise((r) => setTimeout(r, 0)); };
const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const clamp = THREE.MathUtils.clamp;

const STARTS = {
  summit: { name: 'Вершина', z: -1150 },
  birches: { name: 'Роща', z: -700 },
  stones: { name: 'Плато', z: -170 },
  spruce: { name: 'Ельник', z: 330 },
};
const CAM_MODES = ['chase', 'far', 'side', 'fpv'];
const CAM_NAMES = { chase: 'За спиной', far: 'Дальняя', side: 'Сбоку', fpv: 'От первого лица' };

async function init() {
  const canvas = document.getElementById('c');
  const mood = PALETTES[params.get('mood')] ? params.get('mood') : 'day';
  const world = await createWorld({ canvas, quality: Q, mood, step });
  const { renderer, scene, camera } = world;
  camera.near = 0.15;
  camera.updateProjectionMatrix();

  await step('Лыжник…');
  const rider = new Rider();
  scene.add(rider.root);
  const trail = new Trail(qualityName === 'low' ? 5000 : 9000);
  scene.add(trail.mesh);
  const spray = new Spray(world.terrain.surfaceAt, qualityName === 'low' ? 500 : 900, qualityName === 'low' ? 800 : 1400);
  spray.dustUniforms.uPixel.value = renderer.getPixelRatio();
  scene.add(spray.group);
  world.onMood((p) => spray.snowMat.color.copy(p.snow));
  const score = new Score(camera);
  const audio = new RideAudio();
  const skier = new Skier({ world, rider, trail, spray, score, audio });

  // ---------------- state & menu
  let startKey = STARTS[params.get('start')] ? params.get('start') : 'summit';
  let outfit = 0;
  let playing = false;
  let runTime = 0;
  let camMode = CAM_MODES.includes(params.get('cam')) ? params.get('cam') : 'chase';
  const menu = document.getElementById('menu');
  const finish = document.getElementById('finish');

  function startRun() {
    const s = STARTS[startKey];
    skier.spawn(centerX(s.z), s.z, 7);
    trail.reset();
    score.resetRun();
    runTime = 0;
    cam.yaw = skier.heading;
    cam.init = false;
  }
  function setPlaying(on) {
    playing = on;
    menu.classList.toggle('show', !on);
    if (on) { finish.classList.remove('show'); audio.start(); }
  }
  skier.onFinish = () => {
    score.bank();
    document.getElementById('fin-score').textContent = score.total.toLocaleString('ru-RU');
    document.getElementById('fin-best').textContent = score.best.toLocaleString('ru-RU');
    document.getElementById('fin-time').textContent = fmtTime(runTime);
    finish.classList.add('show');
  };

  const fill = (id, entries, cur, onPick) => {
    const box = document.getElementById(id);
    box.innerHTML = '';
    for (const [k, label] of entries) {
      const b = document.createElement('button');
      b.textContent = label;
      b.classList.toggle('on', k === cur);
      b.onclick = (e) => {
        e.stopPropagation();
        onPick(k);
        box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      };
      box.appendChild(b);
    }
  };
  fill('starts', Object.entries(STARTS).map(([k, v]) => [k, v.name]), startKey, (k) => { startKey = k; startRun(); });
  const moodButtons = () => fill('moods', PALETTE_ORDER.map((k) => [k, PALETTES[k].name]), world.mood, (k) => world.setMood(k));
  moodButtons();
  fill('outfits', OUTFITS.map((o, i) => [i, o.name]), outfit, (i) => { outfit = i; rider.setOutfit(i); });
  fill('cams', CAM_MODES.map((k) => [k, CAM_NAMES[k]]), camMode, (k) => setCam(k));
  document.getElementById('go').onclick = (e) => { e.stopPropagation(); setPlaying(true); };
  document.getElementById('again').onclick = (e) => { e.stopPropagation(); startRun(); setPlaying(true); };
  document.getElementById('free').onclick = (e) => { e.stopPropagation(); finish.classList.remove('show'); };
  document.getElementById('menu-btn').onclick = (e) => { e.stopPropagation(); setPlaying(!playing); };

  function setCam(k) {
    camMode = k;
    rider.setFirstPerson(k === 'fpv');
    skier.sinkDepth = k === 'fpv' ? 0.02 : 0.12;
    document.querySelectorAll('#cams button').forEach((b, i) => b.classList.toggle('on', CAM_MODES[i] === k));
    document.getElementById('cam-name').textContent = CAM_NAMES[k];
    document.getElementById('cam-name').classList.remove('show');
    void document.getElementById('cam-name').offsetWidth;
    document.getElementById('cam-name').classList.add('show');
  }

  // ---------------- input
  const keys = new Set();
  const touch = { steer: 0, lean: 0, jump: false, grab: false };
  addEventListener('keydown', (e) => {
    if (e.repeat) { keys.add(e.code); return; }
    keys.add(e.code);
    audio.start();
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    const mi = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
    if (mi >= 0) { world.setMood(PALETTE_ORDER[mi]); moodButtons(); }
    if (e.code === 'Escape' || e.code === 'KeyP') setPlaying(!playing);
    if (e.code === 'Enter' && !playing) setPlaying(true);
    if (!playing) return;
    if (e.code === 'KeyG' || e.code === 'KeyE') skier.toggleWing();
    if (e.code === 'KeyC') setCam(CAM_MODES[(CAM_MODES.indexOf(camMode) + 1) % CAM_MODES.length]);
    if (e.code === 'KeyV') setCam(camMode === 'fpv' ? 'chase' : 'fpv');
    if (e.code === 'KeyR') startRun();
    if (e.code === 'KeyT') skier.respawn();
    if (e.code === 'KeyO') { outfit = (outfit + 1) % OUTFITS.length; rider.setOutfit(outfit); }
    if (e.code === 'KeyM') { audio.setMuted(!audio.muted); score.flash(audio.muted ? 'Звук выключен' : 'Звук включён'); }
    if (e.code === 'KeyH') document.body.classList.toggle('clean');
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  // touch buttons
  document.querySelectorAll('[data-t]').forEach((b) => {
    const [k, v] = b.dataset.t.split(':');
    const down = (e) => {
      e.preventDefault(); e.stopPropagation();
      audio.start();
      if (k === 'wing') return skier.toggleWing();
      if (k === 'cam') return setCam(CAM_MODES[(CAM_MODES.indexOf(camMode) + 1) % CAM_MODES.length]);
      touch[k] = v === undefined ? true : Number(v);
      b.classList.add('down');
    };
    const up = (e) => {
      e.preventDefault();
      if (k === 'steer' || k === 'lean') { if (touch[k] === Number(v)) touch[k] = 0; } else if (k in touch) touch[k] = false;
      b.classList.remove('down');
    };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('pointercancel', up);
  });

  // camera orbit with mouse/touch drag on the canvas, wheel = distance
  const cam = { yaw: 0, orbitYaw: 0, orbitPitch: 0, idle: 9, zoom: 1, target: new THREE.Vector3(), init: false, shake: 0 };
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    cam.orbitYaw -= (e.clientX - drag.x) * 0.006;
    cam.orbitPitch = clamp(cam.orbitPitch + (e.clientY - drag.y) * 0.004, -0.3, 1.2);
    drag.x = e.clientX; drag.y = e.clientY;
    cam.idle = 0;
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => { cam.zoom = clamp(cam.zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.5, 3); e.preventDefault(); }, { passive: false });

  function readInput() {
    const k = keys;
    const steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + touch.steer;
    const lean = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + touch.lean;
    skier.input.steer = clamp(steer, -1, 1);
    skier.input.lean = clamp(lean, -1, 1);
    skier.input.jump = k.has('Space') || touch.jump;
    skier.input.grab = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyF') || touch.grab;
  }

  // ---------------- camera
  const tmp = new THREE.Vector3(), look = new THREE.Vector3(), headPos = new THREE.Vector3();
  const qTmp = new THREE.Quaternion(), qFix = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.78, Math.PI, 0, 'YXZ'));
  function updateCamera(dt) {
    const sp = skier.speed;
    const target = tmp.copy(skier.pos);
    target.y += 1.1;
    if (!cam.init) { cam.target.copy(target); cam.init = true; cam.yaw = skier.heading; }
    cam.target.lerp(target, 1 - Math.exp(-dt * 18));
    if (skier.shake) cam.shake = Math.max(cam.shake, skier.shake);
    cam.shake = Math.max(cam.shake * Math.exp(-dt * 5), skier.impact * 0.5);

    if (camMode === 'fpv') {
      rider.head.getWorldPosition(headPos);
      camera.position.copy(headPos);
      rider.pivot.getWorldQuaternion(qTmp);
      camera.quaternion.copy(qTmp).multiply(qFix);
      camera.position.addScaledVector(tmp.set(0, 0, -1).applyQuaternion(camera.quaternion), 0.3);
    } else {
      const hv = Math.hypot(skier.vel.x, skier.vel.z);
      const travel = hv > 1.5 ? Math.atan2(skier.vel.x, skier.vel.z) : skier.heading;
      const follow = skier.mode === 'air' ? 1.6 : skier.mode === 'crash' ? 0.8 : 3.2;
      cam.yaw += wrap(travel - cam.yaw) * (1 - Math.exp(-dt * follow));
      cam.idle += dt;
      if (cam.idle > 2.5) {
        cam.orbitYaw *= Math.exp(-dt * 1.5);
        cam.orbitPitch *= Math.exp(-dt * 1.5);
      }
      let dist = 4.6 + sp * 0.045, height = 1.25;
      let yaw = cam.yaw + cam.orbitYaw;
      if (camMode === 'far') { dist = 12 + sp * 0.08; height = 4.5; }
      if (camMode === 'side') { dist = 7; height = 0.9; yaw += 1.35; }
      if (skier.mode === 'glide') { dist = 10; height = 2.5; }
      dist *= cam.zoom;
      const dir = look.set(Math.sin(yaw), 0, Math.cos(yaw));
      camera.position.copy(cam.target).addScaledVector(dir, -dist);
      camera.position.y += height + cam.orbitPitch * dist;
      const gy = heightAt(camera.position.x, camera.position.z) + 0.9;
      if (camera.position.y < gy) camera.position.y = gy;
      const aim = tmp.copy(cam.target).addScaledVector(dir, camMode === 'side' ? 0.5 : 2.5);
      aim.y += camMode === 'far' ? -0.5 : 0.1;
      camera.lookAt(aim);
    }
    if (cam.shake > 0.01) {
      camera.position.x += (Math.random() - 0.5) * cam.shake * 0.25;
      camera.position.y += (Math.random() - 0.5) * cam.shake * 0.25;
    }
    const fov = (camMode === 'fpv' ? 74 : 62) + clamp((sp - 10) * 0.65, 0, 20);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 3)); camera.updateProjectionMatrix(); }
    world.post.grade.uniforms.uBlur.value = clamp((sp - 13) / 22, 0, 1) * (camMode === 'fpv' ? 1.3 : 0.85);
  }

  // ---------------- HUD
  const speedEl = document.getElementById('speed');
  const timeEl = document.getElementById('time');
  const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const anchor = new THREE.Vector3();

  addEventListener('resize', () => world.resize());
  startRun();
  setCam(camMode);
  if (params.has('clean')) document.body.classList.add('clean');
  if (params.has('autoplay')) setPlaying(true);
  else menu.classList.add('show');
  document.getElementById('loading').classList.add('done');

  // ---------------- loop
  const clock = new THREE.Clock();
  let time = 0;
  const stillFrames = params.has('still') ? Number(params.get('still') || 2) : 0;
  let frameNo = 0;
  renderer.setAnimationLoop(() => {
    const dt = stillFrames ? 1 / 30 : Math.min(clock.getDelta(), 1 / 20);
    if (stillFrames && ++frameNo > stillFrames) {
      renderer.setAnimationLoop(null);
      document.body.dataset.ready = '1';
      return;
    }
    time += dt;
    readInput();
    if (playing) {
      skier.update(dt);
      runTime += dt;
    } else {
      rider.update(dt);
    }
    spray.update(dt);
    updateCamera(dt);
    anchor.copy(skier.pos);
    anchor.y += 1.6;
    score.update(dt, anchor, skier.mode === 'air' || skier.mode === 'grind' || skier.mode === 'glide');
    world.update(dt, time, skier.pos);
    world.render();
    speedEl.textContent = Math.round(skier.speed * 3.6);
    timeEl.textContent = fmtTime(runTime);
  });

  function renderOnce() {
    rider.update(1 / 60);
    updateCamera(1 / 60);
    score.update(1 / 60, anchor.copy(skier.pos).setY(skier.pos.y + 1.6), true);
    world.update(1 / 60, time, skier.pos);
    world.render();
  }
  window.__ride = { world, skier, rider, score, trail, spray, keys, setCam, startRun, setPlaying, STARTS, simulate, renderOnce };

  /** Test helper: runs the simulation offline for `seconds` with given input. */
  function simulate(seconds, input = {}) {
    setPlaying(true);
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) {
      Object.assign(skier.input, { steer: 0, lean: 0, jump: false, grab: false }, typeof input === 'function' ? input(t) : input);
      skier.update(dt);
      spray.update(dt);
      runTime += dt;
      score.update(dt, anchor.copy(skier.pos), skier.mode !== 'ground');
    }
    updateCamera(1 / 60);
    for (let i = 0; i < 40; i++) updateCamera(1 / 60);
    return { mode: skier.mode, speed: skier.speed, pos: skier.pos.toArray(), total: score.total, pending: score.pending };
  }
}

init().catch((e) => {
  console.error(e);
  if (status) status.textContent = 'Ошибка: ' + e.message;
});
