// ПУХ: open-world powder skiing. Entry point: wiring, game loop, menus.
import * as THREE from 'three';
import { MOODS, sunDirection } from './moods.js';
import { SnowTrail } from './trail.js';
import { Terrain, makeSnowMaterial } from './terrain.js';
import { Flora } from './flora.js';
import { Sky } from './sky.js';
import { SnowFX, DiamondDust } from './fx.js';
import { Rider, OUTFITS } from './rider.js';
import { Player } from './player.js';
import { Score } from './score.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { Post } from './post.js';
import { Audio } from './audio.js';
import { START, fallLineYaw } from './world.js';
const START_YAW = fallLineYaw(START.x, START.z + 4);

class Events {
  constructor() { this.h = {}; }
  on(k, f) { (this.h[k] ||= []).push(f); }
  emit(k, e) { (this.h[k] || []).forEach((f) => f(e)); }
}

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const params = new URLSearchParams(location.search);
const QUALITY = params.get('q') || 'high';
const DPR = QUALITY === 'low' ? 0.6 : Math.min(window.devicePixelRatio || 1, QUALITY === 'mid' ? 1 : 1.75);
renderer.setPixelRatio(DPR);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb7cdfa, 90, 560);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 6000);

const hemi = new THREE.HemisphereLight(0x5c7cff, 0xdfe7ff, 1.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
const SHADOW_RES = QUALITY === 'low' ? 1024 : 2048;
sun.shadow.mapSize.set(SHADOW_RES, SHADOW_RES);
const SH = 48;
Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 500 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

const trail = new SnowTrail(renderer);
const snowMat = makeSnowMaterial(trail);
const terrain = new Terrain(scene, snowMat);
const flora = new Flora(scene);
const sky = new Sky(scene);
const fx = new SnowFX(scene);
const dust = new DiamondDust(scene);
const events = new Events();
const audio = new Audio();
const rider = new Rider(OUTFITS[0]);
scene.add(rider.root);
const player = new Player({ rider, trail, fx, flora, events, audio });
const input = new Input();
const rig = new CameraRig(camera);
const post = new Post(renderer, scene, camera);
const score = new Score({
  best: $('best'), total: $('total'), combo: $('combo'), comboNum: $('combo-num'), mult: $('combo-mult'),
  pops: $('pops'), banner: $('banner'), ring: $('ring'),
});
score.attach(events, rider);

events.on('land', (e) => { rig.shake = Math.min(1, Math.max(rig.shake, e.impact / 14)); });
events.on('crash', () => { rig.shake = 1; });
events.on('hit', () => { rig.shake = 1; });

// ---------- moods ----------
let mood = MOODS.day;
const sunDir = new THREE.Vector3();
function applyMood(key) {
  mood = MOODS[key];
  sunDirection(mood, sunDir);
  scene.fog.color.copy(mood.fog);
  scene.fog.near = mood.fogNear;
  scene.fog.far = mood.fogFar;
  hemi.color.copy(mood.hemiSky);
  hemi.groundColor.copy(mood.hemiGround);
  hemi.intensity = mood.hemiIntensity;
  sun.color.copy(mood.sunColor);
  sun.intensity = mood.sunIntensity;
  renderer.toneMappingExposure = mood.exposure;
  snowMat.color.copy(mood.snow);
  snowMat.userData.uniforms.uSparkle.value = key === 'night' ? 0.6 : 1;
  snowMat.userData.uniforms.uTrenchTint.value.copy(mood.hemiSky).lerp(new THREE.Color(1, 1, 1), 0.72);
  sky.setMood(mood, sunDir);
  flora.setMood(mood);
  fx.setMood(mood);
  dust.u.uAmt.value = mood.dust;
  dust.u.uColor.value.copy(mood.sunColor);
  post.bloom.strength = mood.bloom;
  document.body.dataset.mood = key;
  try { localStorage.setItem('pukh-mood', key); } catch { /* ignore */ }
}

// ---------- loading ----------
let moodKey = 'day';
let outfit = 0;
try {
  moodKey = localStorage.getItem('pukh-mood') || 'day';
  outfit = Number(localStorage.getItem('pukh-outfit') || 0) % OUTFITS.length;
} catch { /* ignore */ }
if (!MOODS[moodKey]) moodKey = 'day';
applyMood(moodKey);
rider.setOutfit(OUTFITS[outfit]);

player.reset(START.x, START.z + 4, START_YAW, 10);
terrain.update(player.pos.x, player.pos.z, false);
// make the ground under the rider right away
terrain.update(player.pos.x, player.pos.z, true);
flora.update(player.pos.x, player.pos.z, true);

// ---------- menu ----------
let state = 'menu';
const menu = $('menu');
function buildMenu() {
  const moods = $('moods');
  moods.innerHTML = '';
  for (const [k, m] of Object.entries(MOODS)) {
    const b = document.createElement('button');
    b.textContent = m.name;
    b.className = k === moodKey ? 'on' : '';
    b.onclick = () => { moodKey = k; applyMood(k); buildMenu(); };
    moods.appendChild(b);
  }
  const outs = $('outfits');
  outs.innerHTML = '';
  OUTFITS.forEach((o, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<span class="sw" style="background:linear-gradient(135deg, ${o.jacket} 50%, ${o.jacket2} 50%)"></span>${o.name}`;
    b.className = i === outfit ? 'on' : '';
    b.onclick = () => {
      outfit = i; rider.setOutfit(o); buildMenu();
      try { localStorage.setItem('pukh-outfit', String(i)); } catch { /* ignore */ }
    };
    outs.appendChild(b);
  });
  $('go').textContent = state === 'paused' ? 'Продолжить' : 'Поехали';
  $('restart').style.display = state === 'paused' ? '' : 'none';
}
function startGame() {
  audio.start();
  menu.classList.remove('show');
  state = 'playing';
  input.pressed.clear();
  last = performance.now();
}
$('go').onclick = startGame;
$('restart').onclick = () => {
  player.reset(START.x, START.z + 4, START_YAW, 10);
  score.newRun();
  trail.clearAll();
  rig.first = true;
  startGame();
};
function pause() {
  state = 'paused';
  buildMenu();
  menu.classList.add('show');
}
buildMenu();
menu.classList.add('show');

// touch controls
window.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });
function bindHold(id, key) {
  const el = $(id);
  if (!el) return;
  const on = (e) => { e.preventDefault(); input.touch[key] = true; input.touch.tap = true; };
  const off = (e) => { e.preventDefault(); input.touch[key] = false; };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
}
bindHold('t-jump', 'jump');
bindHold('t-grab', 'grab');
bindHold('t-tuck', 'tuck');
bindHold('t-back', 'back');
$('t-glider')?.addEventListener('pointerdown', (e) => { e.preventDefault(); input.touch.glider = true; });
$('t-pause')?.addEventListener('pointerdown', (e) => { e.preventDefault(); pause(); });
const steerZone = $('t-steer');
if (steerZone) {
  let sid = null, sx = 0;
  steerZone.addEventListener('pointerdown', (e) => { sid = e.pointerId; sx = e.clientX; input.touch.tap = true; steerZone.setPointerCapture(sid); });
  steerZone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== sid) return;
    input.touch.x = Math.max(-1, Math.min(1, -(e.clientX - sx) / 60));
  });
  const end = (e) => { if (e.pointerId === sid) { sid = null; input.touch.x = 0; } };
  steerZone.addEventListener('pointerup', end);
  steerZone.addEventListener('pointercancel', end);
}

// ---------- helpers ----------
const _proj = new THREE.Vector3();
function project(v) {
  if (!v) return null;
  _proj.copy(v).project(camera);
  if (_proj.z > 1) return null;
  return { x: (_proj.x * 0.5 + 0.5) * window.innerWidth, y: (-_proj.y * 0.5 + 0.5) * window.innerHeight };
}
function flash(id, text) {
  const el = $(id);
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});

// ---------- loop ----------
let last = performance.now();
let time = 0;
const sunView = new THREE.Vector3();
const speedEl = $('speed');
const loadEl = $('loading');
let loaded = false;
let fpsAcc = 0, fpsN = 0;
const idle = { x: 0, y: 0, jump: false, tuck: false, brake: false, grab: false, gliderPressed: false, anyPressed: false };

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;

  const inp = input.poll();
  if (state === 'playing') {
    if (inp.pause) pause();
    if (inp.camera) {
      const name = rig.next();
      rider.setFirstPerson(rig.mode === 2);
      flash('cam-name', name);
    }
    if (inp.mute) { audio.setMuted(!audio.muted); flash('cam-name', audio.muted ? 'Звук выкл.' : 'Звук вкл.'); }
    if (inp.respawn && player.state !== 'crash') { score.lose(); player.respawn(); }
    if (inp.help) $('help').classList.toggle('show');
  } else if (state === 'paused' && inp.pause) startGame();

  const playing = state === 'playing';
  // fixed sub-steps keep the physics stable at low frame rates
  const steps = Math.ceil(dt / (1 / 90));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    player.update(playing ? h : 0, playing ? inp : idle);
    if (i === 0) { inp.gliderPressed = false; inp.anyPressed = false; }
  }
  if (playing) {
    score.update(dt, player.state === 'air' || player.state === 'glide', project);
    if (player.state === 'ground') score.powder(dt, player.speed, player.carve);
  } else {
    score.update(0, true, project);
  }

  terrain.update(player.pos.x, player.pos.z);
  flora.update(player.pos.x, player.pos.z);
  trail.update(player.pos.x, player.pos.z);
  fx.update(playing ? dt : 0, camera.position);

  rig.update(playing ? dt : dt * 0.3, player);
  if (state === 'menu') {
    // slow orbit around the rider on the title screen
    const a = time * 0.12;
    camera.position.set(player.pos.x + Math.sin(a) * 4.5, player.pos.y + 2.0, player.pos.z + Math.cos(a) * 4.5);
    camera.lookAt(player.pos.x, player.pos.y + 1, player.pos.z);
  }
  sky.update(camera, time);
  dust.update(time, camera.position);

  // sun follows the rider, snapped to shadow texels to avoid shimmer
  const texel = (SH * 2) / SHADOW_RES;
  const cx = Math.round(player.pos.x / texel) * texel, cz = Math.round(player.pos.z / texel) * texel;
  sun.target.position.set(cx, player.pos.y, cz);
  sun.position.copy(sun.target.position).addScaledVector(sunDir, 250);
  sunView.copy(sunDir).transformDirection(camera.matrixWorldInverse);
  snowMat.userData.uniforms.uSunView.value.copy(sunView);
  flora.setSunView(sunView);

  audio.update(player.speed, player.state === 'ground', player.carve, player.state === 'glide');
  speedEl.textContent = Math.round(player.speed * 3.6);

  if (QUALITY === 'low') renderer.render(scene, camera);
  else post.render(playing ? Math.max(0, (player.speed - 16) / 22) : 0);
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) { window.__fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }

  if (!loaded && terrain.pendingCount() < 40) {
    loaded = true;
    loadEl.classList.add('done');
  }
}
requestAnimationFrame(frame);

// debug hooks for automated checks
window.__game = {
  player, terrain, flora, score, rig, applyMood, startGame, events, renderer,
  // advance the simulation without drawing (used by automated checks)
  sim(seconds, inputAt) {
    const h = 1 / 60;
    for (let t = 0; t < seconds; t += h) {
      const inp = Object.assign({}, idle, inputAt ? inputAt(t) : {});
      player.update(h, inp);
      score.update(h, player.state !== 'ground', project);
      trail.update(player.pos.x, player.pos.z);
      fx.update(h, camera.position);
      rig.update(h, player);
      terrain.update(player.pos.x, player.pos.z, true);
      flora.update(player.pos.x, player.pos.z, true);
    }
  },
};
