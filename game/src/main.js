import * as THREE from 'three';
import { shared, tod, updatePalette, nextPreset } from './palette.js';
import { skyMaterial, makeObjectMaterial, particleMaterial, snowfallMaterial } from './shaders.js';
import { height } from './terrain.js';
import { World } from './world.js';
import { Skier } from './skier.js';
import { Player } from './player.js';
import { Powder, Trails, Snowfall } from './fx.js';
import { Post } from './post.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Sound } from './audio.js';

THREE.ColorManagement.enabled = false;

// ---------- рендер ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
let pixelRatio = Math.min(devicePixelRatio, 1.5);
renderer.setPixelRatio(pixelRatio);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1500);
const post = new Post(renderer);

const sky = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), skyMaterial);
sky.frustumCulled = false;
sky.renderOrder = -1;
scene.add(sky);

const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 260 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 3;
scene.add(sun, sun.target);

// ---------- мир и игрок ----------
const world = new World(scene);
const hud = new Hud();
const input = new Input();
const sound = new Sound();
const powder = new Powder(scene);
const trails = new Trails(scene);
const snowfall = new Snowfall(scene);
const skier = new Skier(makeObjectMaterial());
scene.add(skier.root);

let flash = 0, shake = 0;
const player = new Player({
  trick(name, pts, pos, icon) { hud.trick(name, pts, pos, icon); sound.chime(); flash = Math.max(flash, 0.15); },
  nearMiss(pts, pos) { hud.trick('Впритирку', pts, pos, '⚡'); },
  crash(reason) {
    hud.lose(reason);
    sound.thump(0.9);
    flash = 0.6; shake = 1;
    const p = player.pos;
    powder.emit(p.x, p.y + 0.5, p.z, player.vel.x * 0.3, 3, player.vel.z * 0.3, 7, 0.7, 1.6, 140);
  },
  recover() { hud.message('Снова в деле!'); },
  land(impact, quality, air) {
    shake = Math.min(1, impact / 20);
    sound.thump(Math.min(0.8, impact / 25));
    const p = player.pos;
    powder.emit(p.x, p.y + 0.1, p.z, player.vel.x * 0.4, 2, player.vel.z * 0.4, 4 + impact * 0.2, 0.45, 1.1, Math.min(120, 20 + impact * 5));
    if (quality === 'sloppy') hud.message('Неровно...', 'bad');
  },
  shard(mesh) {
    world.collectShard(mesh);
    hud.shards++;
    hud.add(150);
    hud.popup(mesh.position, '✦ 150', 'Кристалл');
    sound.chime();
  },
});

// стартуем на склоне
world.radius = 2;
while (world.update(0, 0, 50) > 0);
world.radius = 3;
player.reset(0, 0, 0);
const startY = player.pos.y;

// ---------- камера ----------
let camMode = 0;
const CAM_NAMES = ['Камера: сзади', 'Камера: кино', 'Камера: от первого лица'];
let camYaw = 0;
const camPos = new THREE.Vector3(0, startY + 5, -8);
const lookAt = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function updateCamera(dt, t, title) {
  const p = player.pos;
  const vh = Math.hypot(player.vel.x, player.vel.z);
  const targetYaw = vh > 2.5 && !player.crashed ? Math.atan2(player.vel.x, player.vel.z) : player.heading;
  let dy = targetYaw - camYaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  camYaw += dy * Math.min(1, dt * (player.inAir ? 1.2 : 3.2));
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  const sp = player.speed;
  let desired, look;
  if (title) {
    const a = t * 0.12;
    desired = new THREE.Vector3(p.x + Math.sin(a) * 9, p.y + 3.2, p.z + Math.cos(a) * 9);
    look = new THREE.Vector3(p.x, p.y + 1.1, p.z);
  } else if (camMode === 2 && !player.crashed) {
    const head = new THREE.Vector3(0, 1.62, 0.1).applyMatrix4(skier.root.matrixWorld);
    desired = head;
    const yaw = player.heading + player.spin;
    look = head.clone().add(new THREE.Vector3(Math.sin(yaw) * 10, -3.2, Math.cos(yaw) * 10));
  } else {
    const dist = camMode === 1 ? 4.2 + sp * 0.03 : 6.2 + sp * 0.06;
    const hgt = camMode === 1 ? 1.1 : 2.5 + sp * 0.02;
    desired = new THREE.Vector3(p.x - fx * dist, p.y + hgt, p.z - fz * dist);
    look = new THREE.Vector3(p.x + fx * 5, p.y + 1.0, p.z + fz * 5);
  }
  // не залезаем камерой в кроны деревьев
  if (!title && camMode !== 2) {
    const trees = world.nearby(p.x, p.z).colliders;
    for (let it = 0; it < 4; it++) {
      const hit = trees.some((c) => c.kind === 'tree' && Math.hypot(desired.x - c.x, desired.z - c.z) < 2.8 && desired.y > c.y + 1.2 && desired.y < c.top + 1);
      if (!hit) break;
      desired.lerp(new THREE.Vector3(p.x, p.y + 1.6, p.z), 0.4);
    }
  }
  const ch = height(desired.x, desired.z) + 0.7;
  if (desired.y < ch) desired.y = ch;
  const k = camMode === 2 && !title ? 1 : Math.min(1, dt * 6);
  camPos.lerp(desired, k);
  lookAt.lerp(look, camMode === 2 && !title ? 1 : Math.min(1, dt * 10));
  camera.position.copy(camPos);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.25;
    camera.position.y += (Math.random() - 0.5) * shake * 0.25;
    shake = Math.max(0, shake - dt * 2.5);
  }
  camera.up.copy(UP);
  camera.lookAt(lookAt);
  if (camMode !== 2 && !title) camera.rotateZ(-player.steer * Math.min(sp / 30, 1) * 0.06);
  camera.fov += ((title ? 55 : 62 + Math.min(sp, 40) * 0.65) - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();
}

// ---------- поза персонажа ----------
const qUp = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), qRoll = new THREE.Quaternion();
const smoothN = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
let roll = 0, pump = 0;

function updateSkier(dt, t, inp) {
  const p = player.pos;
  const air = player.inAir;
  smoothN.lerp(player.contact ? player.normal : UP, Math.min(1, dt * (player.contact ? 10 : 3))).normalize();
  const sink = player.contact ? 0.1 : 0;
  skier.root.position.set(p.x, p.y - sink, p.z);
  const sp = player.speed;
  const targetRoll = player.contact && !player.crashed ? player.steer * Math.min(sp / 14, 1) * 0.55 : 0;
  roll += (targetRoll - roll) * Math.min(1, dt * 8);
  qUp.setFromUnitVectors(UP, smoothN);
  qYaw.setFromAxisAngle(UP, player.heading + player.spin);
  qRoll.setFromAxisAngle(Z, roll);
  skier.root.quaternion.copy(qUp).multiply(qYaw).multiply(qRoll);
  if (player.crashed) skier.pivot.rotation.copy(player.crashSpin);
  else skier.pivot.rotation.set(player.flip, 0, 0);
  pump += (Math.abs(player.steer) > 0.3 && player.contact ? 1 : 0 - pump) * dt * 2;
  pump = Math.max(0, Math.min(1, pump));
  const grab = air && inp.grab;
  skier.pose({
    crouch: player.crashed ? 0.8 : air ? (grab ? 0.95 : 0.55 + Math.abs(player.flipVel) * 0.05)
      : 0.22 + Math.min(player.carve, 1) * 0.25 + player.charge * 0.6 + (inp.tuck ? 0.55 : 0) + (inp.brake ? 0.15 : 0),
    steer: player.crashed ? 0 : player.steer,
    tuck: inp.tuck && player.contact && !player.crashed,
    brake: inp.brake && player.contact ? 1 : 0,
    grounded: player.contact,
    grab,
    grabSide: 1,
    airArms: Math.min(1, Math.abs(player.spinVel) / 6),
    pumpAmt: pump,
  }, t);
}

// ---------- эффекты от катания ----------
let emitAcc = 0;
function updateFx(dt) {
  const p = player.pos, v = player.vel;
  const sp = player.speed;
  if (player.contact && !player.crashed && sp > 3) {
    emitAcc += dt * (20 + sp * 3 + player.carve * 60);
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    while (emitAcc > 1) {
      emitAcc--;
      const side = Math.random() < 0.5 ? -1 : 1;
      const tx = p.x - fx * 0.8 + fz * 0.15 * side, tz = p.z - fz * 0.8 - fx * 0.15 * side;
      const sideKick = player.steer * sp * 0.25;
      powder.emit(tx, p.y, tz, v.x * 0.35 - fz * sideKick, 1 + sp * 0.06 + player.carve * 0.6, v.z * 0.35 + fx * sideKick,
        1.2 + sp * 0.05, 0.22 + player.carve * 0.12, 0.7 + Math.random() * 0.6);
    }
  }
  powder.update(dt);
  trails.update(p.x, p.z, player.heading, player.contact && !player.crashed);
  snowfall.update(camera.position, tod.snowfall);
}

// ---------- состояние игры ----------
let state = 'title';
let distAcc = 0;
const titleEl = document.getElementById('title');
const pauseEl = document.getElementById('pause');
const hudEl = document.getElementById('hud');

function startGame() {
  state = 'play';
  titleEl.classList.add('hidden');
  pauseEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  sound.start();
  if (sound.ctx && sound.ctx.state === 'suspended') sound.ctx.resume();
}
document.getElementById('play').addEventListener('click', startGame);
document.getElementById('resume').addEventListener('click', startGame);
addEventListener('keydown', (e) => {
  if (state === 'title' && (e.code === 'Enter' || e.code === 'Space')) startGame();
  else if (e.code === 'Escape' || e.code === 'KeyP') {
    if (state === 'play') { state = 'pause'; pauseEl.classList.remove('hidden'); }
    else if (state === 'pause') startGame();
  }
});
document.getElementById('btn-pause')?.addEventListener('click', () => { state = 'pause'; pauseEl.classList.remove('hidden'); });

function handleKeys() {
  if (input.hit('KeyC')) { camMode = (camMode + 1) % 3; skier.setFirstPerson(camMode === 2); hud.message(CAM_NAMES[camMode]); }
  if (input.hit('KeyT')) { nextPreset(); updatePalette(0); hud.message(tod.name); }
  if (input.hit('KeyO')) hud.message('Костюм: ' + skier.nextOutfit());
  if (input.hit('KeyM')) { sound.muted = !sound.muted; hud.message(sound.muted ? 'Звук выкл' : 'Звук вкл'); }
  if (input.hit('KeyR')) { player.reset(player.pos.x, player.pos.z, player.heading); hud.message('Респаун'); }
}

// ---------- размер и качество ----------
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  post.setSize(s.x, s.y);
}
addEventListener('resize', resize);
resize();

let perfT = 0, perfFrames = 0;
function adapt(dt) {
  perfT += dt; perfFrames++;
  if (perfT > 2.5) {
    const fps = perfFrames / perfT;
    if (fps < 40 && pixelRatio > 0.6) { pixelRatio = Math.max(0.6, pixelRatio - 0.15); resize(); }
    else if (fps > 58 && pixelRatio < Math.min(devicePixelRatio, 1.5)) { pixelRatio = Math.min(pixelRatio + 0.1, devicePixelRatio, 1.5); resize(); }
    perfT = 0; perfFrames = 0;
  }
}

// ---------- цикл ----------
const clock = new THREE.Clock();
const STEP = 1 / 120;
let acc = 0, time = 0;
const sunScreen = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  time += dt;
  shared.uTime.value = time;
  updatePalette(state === 'play' ? dt : dt * 0.5);

  const inp = input.state();
  if (state === 'play') {
    handleKeys();
    acc += dt;
    const near = world.nearby(player.pos.x, player.pos.z);
    while (acc >= STEP) {
      const px = player.pos.x, pz = player.pos.z;
      player.step(STEP, inp, near);
      if (player.contact && !player.crashed) {
        distAcc += Math.hypot(player.pos.x - px, player.pos.z - pz);
        if (distAcc > 2) { hud.add(Math.floor(distAcc / 2)); distAcc %= 2; }
      }
      acc -= STEP;
    }
  }
  input.endFrame();
  world.update(player.pos.x, player.pos.z, 1);
  world.animate(time);

  updateSkier(dt, time, state === 'play' ? inp : { steer: 0 });
  skier.root.updateMatrixWorld(true);
  updateCamera(dt, time, state === 'title');
  updateFx(dt);
  sky.position.copy(camera.position);

  // солнце и тени следуют за игроком
  const sd = shared.uSunDir.value;
  sun.target.position.copy(player.pos);
  sun.position.copy(player.pos).addScaledVector(sd, 120);

  // точка размера частиц зависит от высоты экрана и FOV
  const bh = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
  const scale = bh / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  particleMaterial.uniforms.uScale.value = scale;
  snowfallMaterial.uniforms.uScale.value = scale;

  // пост-эффекты
  const u = post.mat.uniforms;
  u.uTime.value = time;
  u.uSpeed.value += (THREE.MathUtils.clamp((player.speed - 12) / 28, 0, 1) * (state === 'play' ? 1 : 0) - u.uSpeed.value) * Math.min(1, dt * 3);
  sunScreen.copy(camera.position).addScaledVector(sd, 500).project(camera);
  const onScreen = sunScreen.z < 1 && Math.abs(sunScreen.x) < 1.4 && Math.abs(sunScreen.y) < 1.4;
  u.uSun.value.set(sunScreen.x * 0.5 + 0.5, sunScreen.y * 0.5 + 0.5);
  const lowSun = 1 - THREE.MathUtils.smoothstep(sd.y, 0.25, 0.7) * 0.6;
  u.uSunVis.value += ((onScreen ? lowSun * shared.uSunDisk.value : 0) - u.uSunVis.value) * Math.min(1, dt * 4);
  u.uGlow.value.copy(shared.uGlowColor.value);
  flash = Math.max(0, flash - dt * 2.5);
  u.uFlash.value = flash;

  sound.update(player.speed, player.carve, player.contact, player.inAir);
  if (state !== 'title') hud.update(dt, camera, { inAir: player.inAir, speed: player.speed, drop: startY - player.pos.y, tod: tod.name });

  post.render(scene, camera);
  adapt(dt);
}
updatePalette(0);
frame();
window.__game = { player, world, hud, camera, tod, startGame };
