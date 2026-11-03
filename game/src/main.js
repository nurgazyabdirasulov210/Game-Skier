// ПОРОША — freeride in an endless procedural mountain.
import * as THREE from '../vendor/three.module.js';
import { G } from './shaderlib.js';
import { makePalette, samplePalette, KEYS, keyIndexAt } from './palette.js';
import { SnowTrail } from './trail.js';
import { World } from './world.js';
import { Sky } from './sky.js';
import { Player } from './player.js';
import { Skier, OUTFITS } from './skier.js';
import { Particles } from './particles.js';
import { Post } from './post.js';
import { CameraRig, CAM_MODES } from './camera.js';
import { Score, judgeLanding } from './score.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { CHUNK, heightAt, findSpawn } from './terrain.js';
import { clamp, lerp } from './noise.js';

// ------------------------------------------------------------------ quality
const QUALITY = {
  low: {
    label: 'Низкое', pixel: 0.7, maxPixel: 1, shadow: 1024, shadowRange: 42, trailRes: 512, trailSize: 96, msaa: 0, bloom: 0.8,
    lod: [[1, 64], [2, 32], [4, 16], [6, 8]], viewChunks: 6, objChunks: 3,
    treeHi: 40, treeMid: 130, treeHiCap: 700, treeMidCap: 3000, treeFarCap: 3000, midShadows: false,
    dust: 1200, clumps: 260, snowflakes: 2500,
  },
  medium: {
    label: 'Среднее', pixel: 1, maxPixel: 1.25, shadow: 2048, shadowRange: 55, trailRes: 1024, trailSize: 128, msaa: 2, bloom: 1,
    lod: [[1, 128], [2, 64], [4, 32], [6, 16], [8, 8]], viewChunks: 8, objChunks: 4,
    treeHi: 60, treeMid: 190, treeHiCap: 1400, treeMidCap: 5000, treeFarCap: 6000, midShadows: false,
    dust: 2500, clumps: 600, snowflakes: 5000,
  },
  high: {
    label: 'Высокое', pixel: 1.25, maxPixel: 2, shadow: 4096, shadowRange: 70, trailRes: 2048, trailSize: 160, msaa: 4, bloom: 1,
    lod: [[1, 128], [2, 64], [4, 32], [7, 16], [10, 8]], viewChunks: 10, objChunks: 5,
    treeHi: 85, treeMid: 260, treeHiCap: 2600, treeMidCap: 8000, treeFarCap: 9000, midShadows: true,
    dust: 4000, clumps: 1000, snowflakes: 8000,
  },
};

function pickQuality() {
  const saved = (() => { try { return localStorage.getItem('porosha.quality'); } catch { return null; } })();
  const url = new URLSearchParams(location.search).get('q');
  if (url && QUALITY[url]) return url;
  if (saved && QUALITY[saved]) return saved;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 1100);
  if (mobile) return 'low';
  return (navigator.hardwareConcurrency || 4) >= 8 ? 'high' : 'medium';
}

const qName = pickQuality();
const Q = QUALITY[qName];

// ------------------------------------------------------------------ renderer & scene
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
if (!renderer.capabilities.isWebGL2) {
  document.getElementById('loadmsg').textContent = 'Нужен браузер с поддержкой WebGL 2';
  throw new Error('WebGL2 required');
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = true;
let pixelRatio = Math.min(window.devicePixelRatio || 1, Q.maxPixel) * (Q.pixel / Math.max(1, Q.pixel));
pixelRatio = Math.min(window.devicePixelRatio || 1, Q.maxPixel);
if (qName === 'low') pixelRatio = Math.min(pixelRatio, 0.85);
let dynScale = 1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 3200);

const light = new THREE.DirectionalLight(0xffffff, 1);
light.castShadow = true;
light.shadow.mapSize.set(Q.shadow, Q.shadow);
const SR = Q.shadowRange;
Object.assign(light.shadow.camera, { left: -SR, right: SR, top: SR, bottom: -SR, near: 1, far: 600 });
light.shadow.camera.updateProjectionMatrix();
light.shadow.bias = -0.0004;
light.shadow.normalBias = 0.1;
scene.add(light);
scene.add(light.target);

// ------------------------------------------------------------------ systems
const hud = new HUD();
const audio = new Audio();
const input = new Input();
input.bindTouch(document.getElementById('touch'));
const trail = new SnowTrail(renderer, { size: Q.trailSize, res: Q.trailRes });
let seed = 1;
try { seed = parseInt(localStorage.getItem('porosha.seed') || '1', 10) || 1; } catch { /* ignore */ }
const urlSeed = new URLSearchParams(location.search).get('seed');
if (urlSeed) seed = parseInt(urlSeed, 10) || 1;
let world = new World(scene, trail, Q, seed);
if (new URLSearchParams(location.search).has('dbgshadow')) { world.terrainMat.defines.DBG_SHADOW = 1; world.terrainMat.needsUpdate = true; }
if (new URLSearchParams(location.search).has('dbgtrail')) { world.terrainMat.defines.DBG_TRAIL = 1; world.terrainMat.needsUpdate = true; }
const sky = new Sky(scene);
const player = new Player(world, trail);
{ const sp = findSpawn(); player.reset(sp.x, sp.z); }
const skier = new Skier(scene);
const particles = new Particles(scene, Q);
const post = new Post(renderer, Q);
const rig = new CameraRig(camera);
rig.world = world;
const score = new Score(hud, audio);
const pal = makePalette();

let outfit = 0;
try { outfit = parseInt(localStorage.getItem('porosha.outfit') || '0', 10) || 0; } catch { /* ignore */ }
skier.setOutfit(outfit);

// ------------------------------------------------------------------ time of day
let tod = 0.36;
{
  const t = parseFloat(new URLSearchParams(location.search).get('tod'));
  if (!Number.isNaN(t)) tod = t;
}
const FIXED_DT = new URLSearchParams(location.search).has('fixed');
const DAY_LENGTH = 720; // seconds for a full cycle
let todTarget = null;
function jumpTimeOfDay() {
  const i = (keyIndexAt(tod) + 1) % KEYS.length;
  let t = KEYS[i].t;
  if (t < tod) t += 1;
  todTarget = t;
  hud.banner(KEYS[i].name);
}

// ------------------------------------------------------------------ events
player.on('land', (info) => {
  const tricks = judgeLanding(info);
  for (const [name, pts, inc] of tricks) score.add(name, pts, inc);
  audio.land(info.impact);
  if (info.impact > 3) {
    particles.burst(player.pos, player.vel, Math.min(1.5, info.impact / 10));
    rig.kick(Math.min(0.6, info.impact * 0.03));
  }
});
player.on('crash', (reason) => {
  score.fail();
  hud.toast(reason, 'crash', 'R — встать сразу');
  audio.crash();
  particles.burst(player.pos, player.vel, 2);
  rig.kick(1);
  post.flash = 0.25;
  post.flashColor = 'white';
});
player.on('gate', () => { score.add('Ворота', 250, 1, 'gate'); audio.gate(); });
player.on('crystal', (c) => {
  score.add('Кристалл', 200, 1, 'gate');
  audio.crystal();
  particles.sparkle(new THREE.Vector3(c.x, c.y, c.z), 1);
});
player.on('nearMiss', () => score.add('Впритирку', 90, 1));
player.on('grindEnd', (d) => { if (d > 1.5) score.add(`Слайд по бревну ${d.toFixed(0)} м`, 60 + d * 28, 1); });
player.on('jump', () => audio.jump());
player.on('glider', (on) => {
  audio.glider(on);
  if (on) hud.hint('Параплан: A/D — повороты, W — разгон, S — зависнуть, G — сложить', 3.5);
});

// ------------------------------------------------------------------ UI state
let state = 'loading'; // loading -> title -> play <-> pause
const ui = {
  loading: document.getElementById('loading'),
  bar: document.getElementById('loadbar'),
  title: document.getElementById('title'),
  pause: document.getElementById('pause'),
  hud: document.getElementById('hud'),
  touch: document.getElementById('touch'),
};
const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
document.body.classList.toggle('touch', isTouch);

function startGame() {
  if (state !== 'title') return;
  audio.init();
  state = 'play';
  ui.title.classList.add('gone');
  ui.hud.classList.add('on');
  player.vel.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)).multiplyScalar(6);
  rig.first = true;
  hud.hint(isTouch ? 'Тяни джойстик — повороты. Прыжок — держи и отпусти.' : 'A/D — повороты · Пробел — прыжок · в воздухе: стрелки — вращения и сальто, Shift — грэб, G — параплан', 6);
}

function setPause(p) {
  if (p && state === 'play') { state = 'pause'; ui.pause.classList.add('on'); refreshMenu(); }
  else if (!p && state === 'pause') { state = 'play'; ui.pause.classList.remove('on'); }
}

function refreshMenu() {
  const set = (a, t) => { const b = ui.pause.querySelector(`[data-a="${a}"] .v`); if (b) b.textContent = t; };
  set('cam', CAM_MODES[rig.mode]);
  set('tod', pal.name);
  set('outfit', OUTFITS[skier.outfit].name);
  set('quality', Q.label);
  set('sound', audio.muted ? 'выкл' : 'вкл');
  set('music', audio.musicOn ? 'вкл' : 'выкл');
}

function newMountain() {
  seed = Math.floor(Math.random() * 1e6) + 2;
  try { localStorage.setItem('porosha.seed', String(seed)); } catch { /* ignore */ }
  world.dispose();
  world = new World(scene, trail, Q, seed);
  player.world = world;
  rig.world = world;
  trail.reset();
  player.visited.clear();
  { const sp = findSpawn(); player.reset(sp.x, sp.z); }
  score.resetRun();
  rig.first = true;
  loadStart = performance.now();
  state = 'loading';
  ui.loading.classList.remove('gone');
  ui.pause.classList.remove('on');
}

ui.pause.addEventListener('click', (e) => {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const a = b.dataset.a;
  if (a === 'resume') setPause(false);
  if (a === 'cam') hud.banner(rig.next());
  if (a === 'tod') jumpTimeOfDay();
  if (a === 'outfit') { outfit = (skier.outfit + 1) % OUTFITS.length; skier.setOutfit(outfit); try { localStorage.setItem('porosha.outfit', String(outfit)); } catch { /* ignore */ } }
  if (a === 'quality') {
    const order = ['low', 'medium', 'high'];
    const next = order[(order.indexOf(qName) + 1) % 3];
    try { localStorage.setItem('porosha.quality', next); } catch { /* ignore */ }
    location.reload();
  }
  if (a === 'sound') audio.setMuted(!audio.muted);
  if (a === 'music') audio.setMusic(!audio.musicOn);
  if (a === 'new') { newMountain(); return; }
  if (a === 'respawn') { player.respawnHere(); setPause(false); }
  refreshMenu();
});
document.getElementById('pauseBtn')?.addEventListener('click', () => setPause(state === 'play'));
document.getElementById('camBtn')?.addEventListener('click', () => hud.banner(rig.next()));

ui.title.addEventListener('pointerdown', () => startGame());
input.anyKeyCb = (code) => {
  if (state === 'title') { if (code !== 'Escape') startGame(); }
};

function handleKeys() {
  if (input.pressed('Escape') || input.pressed('KeyP')) setPause(state === 'play');
  if (state !== 'play') return;
  if (input.pressed('KeyC')) hud.banner(rig.next());
  if (input.pressed('KeyT')) jumpTimeOfDay();
  if (input.pressed('KeyO')) { outfit = (skier.outfit + 1) % OUTFITS.length; hud.banner(skier.setOutfit(outfit)); }
  if (input.pressed('KeyR')) player.respawnHere();
  if (input.pressed('KeyM')) { audio.setMuted(!audio.muted); hud.banner(audio.muted ? 'Звук выключен' : 'Звук включён'); }
  if (input.pressed('KeyH')) hud.toggle();
}

// ------------------------------------------------------------------ resize
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(pixelRatio * dynScale);
  renderer.setSize(w, h, false);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const pr = renderer.getPixelRatio();
  post.setSize(Math.max(1, Math.floor(w * pr)), Math.max(1, Math.floor(h * pr)));
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ per-frame helpers
const _v = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3();
const sunScreen = { uv: new THREE.Vector2(), on: 0 };

function updateLight() {
  const k = pal.keyDir;
  const center = _v.copy(player.pos).addScaledVector(rig.dir, SR * 0.45);
  // snap the shadow frustum to texels so shadows do not shimmer
  _x.crossVectors(new THREE.Vector3(0, 1, 0), k).normalize();
  if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
  _y.crossVectors(k, _x).normalize();
  const texel = (2 * SR) / Q.shadow;
  const cx = center.dot(_x), cy = center.dot(_y);
  center.addScaledVector(_x, Math.round(cx / texel) * texel - cx).addScaledVector(_y, Math.round(cy / texel) * texel - cy);
  light.target.position.copy(center);
  light.position.copy(center).addScaledVector(k, 250);
  light.target.updateMatrixWorld();
  light.updateMatrixWorld();
}

function updateUniforms(t) {
  G.uTime.value = t;
  G.uKeyDir.value.copy(pal.keyDir);
  const keyInt = pal.keyIntensity * (1 - pal.night) + 0.55 * pal.night;
  G.uKeyColor.value.copy(pal.sun).multiplyScalar(keyInt);
  if (pal.night > 0) G.uKeyColor.value.lerp(new THREE.Color('#8fb0ff').multiplyScalar(0.55), pal.night);
  G.uSunDir.value.copy(pal.sunDir);
  G.uMoonDir.value.copy(pal.moonDir);
  G.uAmbTop.value.copy(pal.ambTop);
  G.uAmbBottom.value.copy(pal.ambBottom);
  G.uSnowLit.value.copy(pal.snowLit);
  G.uSnowShadow.value.copy(pal.snowShadow);
  G.uFogColor.value.copy(pal.fog);
  G.uFogSun.value.copy(pal.fogSun);
  G.uHorizon.value.copy(pal.horizon);
  G.uZenith.value.copy(pal.zenith);
  G.uNight.value = pal.night;
  G.uStars.value = pal.stars;
  G.uAurora.value = pal.aurora;
  G.uClouds.value = pal.clouds;
  G.uFogDist.value = Q.viewChunks * CHUNK * 0.52 * pal.fogDist;
  // head torch at dusk and night
  const head = skier.headWorld(_v);
  const fwd = new THREE.Vector3(-Math.sin(player.yaw), -0.35, -Math.cos(player.yaw)).normalize();
  G.uLampPos.value.set(head.x, head.y + 0.1, head.z, pal.lamp);
  G.uLampDir.value.copy(fwd);
}

function updateSunScreen() {
  const p = _v.copy(camera.position).addScaledVector(pal.sunDir, 1000).project(camera);
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  const facing = fwd.dot(pal.sunDir);
  sunScreen.uv.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
  const edge = clamp(1.6 - Math.max(Math.abs(p.x), Math.abs(p.y)), 0, 1);
  sunScreen.on = facing > 0 ? edge * clamp(facing * 2, 0, 1) * clamp((pal.sunEl + 4) / 8, 0, 1) : 0;
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
let elapsed = 0;
let loadStart = performance.now();
let frameAvg = 16;
let resizeCooldown = 0;
let orbitT = 0;
let startY = player.pos.y;

function frame(now) {
  window.porosha.dbgTrail = () => {
  const t = trail, n = t.res, buf = new Uint8Array(n * n * 4);
  renderer.readRenderTargetPixels(t.rtA, 0, 0, n, n, buf);
  let cnt = 0, minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
  for (let i = 0; i < n * n; i++) if (buf[i * 4] > 5) { cnt++; const x = i % n, y = (i / n) | 0; minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  return JSON.stringify({ cnt, minx, maxx, miny, maxy, c: [t.cx, t.cz], p: player.pos });
};
requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0)) dt = 0.016;
  dt = Math.min(dt, 0.05);
  if (FIXED_DT) dt = 1 / 30;
  elapsed += dt;

  handleKeys();
  const inp = input.read();

  // time of day
  if (todTarget !== null) {
    const step = dt * 0.25;
    if (todTarget - tod <= step) { tod = todTarget % 1; todTarget = null; }
    else tod += step;
  } else if (state === 'play') {
    tod = (tod + dt / DAY_LENGTH) % 1;
  }
  samplePalette(tod, pal);

  if (state === 'play') {
    player.update(dt, inp);
    score.update(dt, player);
  }

  world.update(player.pos.x, player.pos.z, dt);

  if (state === 'loading') {
    const r = world.readiness(player.pos.x, player.pos.z, 1);
    ui.bar.style.width = Math.round(r * 100) + '%';
    if (r >= 1 && performance.now() - loadStart > 400) {
      state = 'title';
      startY = player.pos.y;
      ui.loading.classList.add('gone');
      ui.title.classList.remove('gone');
      player.reset(player.pos.x, player.pos.z);
    }
  }

  skier.update(dt, player, camera);
  if (state === 'play') particles.spray(player, dt);
  particles.smoke(world.cabinList, dt, player.pos.x, player.pos.z);
  trail.update(player.pos.x, player.pos.z);

  if (state === 'title' || state === 'loading') {
    orbitT += dt;
    const a = orbitT * 0.12 + 0.6;
    const p = player.pos;
    camera.position.set(p.x + Math.sin(a) * 8.5, p.y + 2.6, p.z + Math.cos(a) * 8.5);
    const gh = heightAt(camera.position.x, camera.position.z) + 1.2;
    if (camera.position.y < gh) camera.position.y = gh;
    camera.up.set(0, 1, 0);
    camera.lookAt(p.x, p.y + 1.1, p.z);
    camera.fov = 55; camera.updateProjectionMatrix();
    rig.first = true;
  } else {
    rig.update(dt, player, skier);
  }

  updateLight();
  updateUniforms(elapsed);
  sky.update(camera, pal);
  particles.update(dt, camera.position, pal, renderer.getPixelRatio());
  updateSunScreen();

  // speed-driven blur, crash flash decay
  const speedBlur = state === 'play' && rig.mode !== 2 ? clamp((player.speed - 14) / 26, 0, 1) * 0.9 : 0;
  post.flash = Math.max(0, post.flash - dt * 1.5);
  post.fade = state === 'loading' ? 0.0 : Math.min(1, post.fade + dt * 1.5);
  post.render(scene, camera, pal, { sunScreen, speedBlur, time: elapsed });

  // HUD
  hud.update(dt);
  if (state === 'play') hud.stats(player.speed * 3.6, Math.max(0, startY - player.pos.y), pal.name);
  audio.update(player, dt);

  // dynamic resolution
  frameAvg = lerp(frameAvg, dt * 1000, 0.05);
  resizeCooldown -= dt;
  if (state === 'play' && resizeCooldown <= 0) {
    if (frameAvg > 24 && dynScale > 0.55) { dynScale = Math.max(0.55, dynScale - 0.1); resize(); resizeCooldown = 2; }
    else if (frameAvg < 14 && dynScale < 1) { dynScale = Math.min(1, dynScale + 0.1); resize(); resizeCooldown = 3; }
  }
}

// expose a tiny debug handle
window.porosha = { skier, trail, light, camera, player, world: () => world, rig, score, pal, renderer, input, setTod: (t) => { tod = t; } };
requestAnimationFrame(frame);
