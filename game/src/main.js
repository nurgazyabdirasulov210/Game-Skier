import * as THREE from '../vendor/three.module.js';
import { G } from './shaderlib.js';
import { DayCycle, TIME_PRESETS } from './daycycle.js';
import { Terrain } from './terrain.js';
import { Trail } from './trail.js';
import { Shadows } from './shadows.js';
import { Sky } from './sky.js';
import { Post } from './post.js';
import { Props } from './props.js';
import { Particles } from './particles.js';
import { Skier, OUTFITS } from './skier.js';
import { Glider } from './glider.js';
import { Player } from './player.js';
import { CameraRig, CAM_NAMES } from './camera.js';
import { Score } from './score.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { heightAt, normalAt, biomeAt } from './world.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const QUALITY = {
  low: { name: 'Низкая', dpr: 1.0, N: 96, s0: 0.34, levels: 7, sh0: 1536, sh1: 1024, cascades: 1, half0: 34, trailRes: 512, trailSize: 128, msaa: 2, bloom: true, radius: 170, clumps: 800, mist: 160, flakes: 1200 },
  medium: { name: 'Средняя', dpr: 1.5, N: 112, s0: 0.28, levels: 7, sh0: 2048, sh1: 1024, cascades: 2, half0: 26, trailRes: 1024, trailSize: 150, msaa: 4, bloom: true, radius: 210, clumps: 1100, mist: 240, flakes: 2000 },
  high: { name: 'Высокая', dpr: 2.0, N: 128, s0: 0.25, levels: 7, sh0: 2048, sh1: 2048, cascades: 2, half0: 26, trailRes: 1024, trailSize: 160, msaa: 4, bloom: true, radius: 240, clumps: 1400, mist: 300, flakes: 2600 },
};
const TIME_OPTS = [['cycle', 'Цикл'], ['dawn', 'Рассвет'], ['day', 'День'], ['sunset', 'Закат'], ['night', 'Ночь']];

const store = {
  get(k, d) { try { const v = localStorage.getItem('celina.' + k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('celina.' + k, v); } catch (e) { /* нет хранилища */ } },
};

const params = new URLSearchParams(location.search);
const input = new Input();
if (input.isTouch) document.body.classList.add('touch');
let qName = params.get('q') || store.get('quality', input.isTouch ? 'low' : 'high');
if (!QUALITY[qName]) qName = 'high';
const Q = QUALITY[qName];
let outfit = store.get('outfit', 'lilac');
if (!OUTFITS[outfit]) outfit = 'lilac';
let timeOpt = params.get('time') || store.get('time', 'cycle');

async function progress(f, msg) {
  $('loadbar').style.width = Math.round(f * 100) + '%';
  if (msg) $('loadmsg').textContent = msg;
  await sleep(16);
}

function fail(msg) {
  const e = $('err');
  e.style.display = 'grid';
  e.innerHTML = `<div><h2 style="font-family:var(--display)">ЦЕЛИНА</h2><p>${msg}</p></div>`;
}

async function boot() {
  const canvas = $('c');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  } catch (e) { fail('Не удалось запустить WebGL. Попробуйте другой браузер.'); return; }
  if (!renderer.capabilities.isWebGL2) { fail('Нужен браузер с поддержкой WebGL 2.'); return; }
  renderer.autoClear = true;
  renderer.setClearColor(0x000000, 1);
  window.__renderer = renderer;

  const maxDpr = Math.min(window.devicePixelRatio || 1, Q.dpr);
  let dpr = maxDpr;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.15, 4200);

  await progress(0.08, 'Насыпаем снег…');
  const day = new DayCycle();
  const trail = new Trail(renderer, { res: Q.trailRes, size: Q.trailSize });
  const shadows = new Shadows(renderer, { size0: Q.sh0, size1: Q.sh1, half0: Q.half0, cascades: Q.cascades });
  const terrain = new Terrain(scene, { N: Q.N, s0: Q.s0, levels: Q.levels });
  for (const m of terrain.meshes) shadows.add(m, m.userData.shadowLevel <= 2 ? 1 : 2);
  new Sky(scene);
  await progress(0.2, 'Сажаем ели…');
  const props = new Props(scene, shadows, { radius: Q.radius });
  const particles = new Particles(scene, { clumps: Q.clumps, mist: Q.mist, flakes: Q.flakes });
  const skier = new Skier(shadows, outfit);
  scene.add(skier.root);
  const glider = new Glider(skier.root, shadows);
  const post = new Post(renderer, { bloom: Q.bloom, msaa: Q.msaa });
  const hud = new Hud();
  const audio = new Audio();
  const score = new Score(hud, audio);
  const player = new Player({ props, trail, particles, score, audio });
  const rig = new CameraRig(camera, props);

  // старт: на открытом месте, лицом вниз по склону
  function pickSpawn(seedX, seedZ = -40) {
    let best = null;
    const n = new THREE.Vector3();
    for (let i = 0; i < 40; i++) {
      const x = seedX + i * 37, z = seedZ + i * 11;
      const b = biomeAt(x, z);
      // средний наклон по линии спуска на 60 м вперёд
      normalAt(x, z, n, 3);
      const yaw = Math.atan2(n.x, n.z);
      const drop = heightAt(x, z) - heightAt(x + Math.sin(yaw) * 60, z + Math.cos(yaw) * 60);
      const slope = drop / 60;
      const score = Math.abs(b - 0.45) + Math.abs(slope - 0.42) * 2.5;
      if (!best || score < best.s) best = { x, z, s: score };
    }
    return best;
  }
  function spawnAt(x, z) {
    props.setSpawnClear(x, z, 26);
    const n = normalAt(x, z, new THREE.Vector3(), 2);
    const yaw = Math.atan2(n.x, n.z);
    player.reset(x, z, yaw, 0);
    trail.resetAt(x, z);
    props.update(x, z, 0, true);
    rig.init = false; rig.yaw = yaw;
  }
  const sp = pickSpawn(0);
  spawnAt(sp.x, sp.z);
  await progress(0.55, 'Укатываем склон…');

  function applyTime() {
    if (timeOpt === 'cycle') { day.running = true; if (!day._set) day.set(TIME_PRESETS.day - 0.04); }
    else { day.running = false; day.set(TIME_PRESETS[timeOpt]); }
    day._set = true;
  }
  applyTime();

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    post.setSize(Math.floor(w * dpr), Math.floor(h * dpr));
  }
  resize();
  addEventListener('resize', resize);

  // прогрев шейдеров
  await progress(0.7, 'Компилируем шейдеры…');
  day.update(0); G.uCamPos.value.copy(camera.position);
  rig.update(0.016, player, skier, true);
  terrain.update(camera.position);
  try { renderer.compile(scene, camera); } catch (e) { /* не критично */ }
  shadows.render(scene, player.pos, day.lightDir, new THREE.Vector3(0, 0, 1));
  post.begin(); renderer.render(scene, camera); post.end(0);
  await progress(1, 'Готово');
  $('loading').classList.add('gone');

  // ------------------------------------------------------------ меню
  let state = 'title';
  const optRow = (el, items, cur, onPick, swatch) => {
    el.innerHTML = '';
    for (const [k, label, col] of items) {
      const b = document.createElement('button');
      if (swatch) { b.className = 'sw' + (k === cur ? ' sel' : ''); b.title = label; b.innerHTML = `<i style="background:linear-gradient(135deg, ${col[0]} 0 50%, ${col[1]} 50% 100%)"></i>`; }
      else { b.className = 'chip' + (k === cur ? ' sel' : ''); b.textContent = label; }
      b.onclick = (e) => { e.stopPropagation(); onPick(k); };
      el.appendChild(b);
    }
  };
  function buildMenu() {
    optRow($('optOutfit'), Object.entries(OUTFITS).map(([k, o]) => [k, o.name, [o.jacket, o.hat]]), outfit, (k) => {
      outfit = k; store.set('outfit', k); skier.build(k); glider.group.parent || skier.root.add(glider.group); buildMenu();
    }, true);
    optRow($('optTime'), TIME_OPTS, timeOpt, (k) => { timeOpt = k; store.set('time', k); day._set = false; applyTime(); buildMenu(); });
    optRow($('optQuality'), Object.entries(QUALITY).map(([k, q]) => [k, q.name]), qName, (k) => {
      if (k === qName) return; store.set('quality', k); location.href = location.pathname + '?q=' + k;
    });
  }
  buildMenu();

  function startGame() {
    if (state !== 'title') return;
    audio.start();
    state = 'play';
    document.body.classList.add('playing');
    $('title').classList.add('gone');
    hud.show(true);
    input.clearEvents();
    const v = player.vel;
    if (v.length() < 2) { v.set(Math.sin(player.yaw) * 3, 0, Math.cos(player.yaw) * 3); }
    hud.hint(input.isTouch ? 'Стик — поворот. Прыжок: удержи и отпусти. В воздухе стик крутит трюки.' : 'Держи пробел и отпусти — прыжок. В воздухе A/D — винт, W/S — сальто, Shift — граб.', 6);
    hud.setCamName(CAM_NAMES[rig.mode]);
  }
  $('play').onclick = (e) => { e.stopPropagation(); startGame(); };
  if (input.isTouch) input.bindTouchUI($('touch'));

  function setPause(on) {
    if (on && state === 'play') {
      state = 'pause'; $('pause').classList.add('on');
      $('pTimeName').textContent = TIME_OPTS.find((t) => t[0] === timeOpt)[1];
      $('pMute').textContent = 'Звук: ' + (audio.muted ? 'выкл' : 'вкл');
      $('stats').textContent = `Рекорд: ${Math.round(score.best).toLocaleString('ru-RU')} · Лучшее комбо: ${Math.round(score.bestCombo).toLocaleString('ru-RU')} · Пройдено: ${(score.distance / 1000).toFixed(1)} км`;
    } else if (!on && state === 'pause') {
      state = 'play'; $('pause').classList.remove('on'); input.clearEvents();
    }
  }
  $('pResume').onclick = () => setPause(false);
  $('pCam').onclick = () => { hud.setCamName(CAM_NAMES[rig.next()]); skier.setFirstPerson(rig.mode === 'fp'); };
  $('pTime').onclick = () => {
    const i = TIME_OPTS.findIndex((t) => t[0] === timeOpt);
    timeOpt = TIME_OPTS[(i + 1) % TIME_OPTS.length][0]; store.set('time', timeOpt); day._set = false; applyTime();
    $('pTimeName').textContent = TIME_OPTS.find((t) => t[0] === timeOpt)[1];
  };
  $('pRespawn').onclick = () => { newPeak(); setPause(false); };
  $('pMute').onclick = () => { $('pMute').textContent = 'Звук: ' + (audio.toggleMute() ? 'выкл' : 'вкл'); };
  $('pTitle').onclick = () => {
    $('pause').classList.remove('on'); state = 'title'; document.body.classList.remove('playing');
    $('title').classList.remove('gone'); hud.show(false); score.bank();
  };

  function newPeak() {
    score.bank();
    const x = (Math.random() - 0.5) * 6000, z = player.pos.z + 300 + Math.random() * 600;
    const s = pickSpawn(x, z);
    spawnAt(s.x, s.z);
    post.mComp.uniforms.uFade.value = 1;
    player.vel.set(Math.sin(player.yaw) * 3, 0, Math.cos(player.yaw) * 3);
  }

  // ------------------------------------------------------------ цикл
  const STEP = 1 / 120;
  const SIMDT = parseFloat(params.get('simdt') || '0');
  const MAXSTEPS = SIMDT ? Math.ceil(SIMDT / STEP) + 1 : 8;
  let acc = 0, last = performance.now(), time = 0;
  let frameAvg = 16, perfT = 0;
  const tmpUp = new THREE.Vector3(), viewDir = new THREE.Vector3();
  const pin = { steer: 0, up: 0, down: 0, jump: false, grab: false };
  window.__game = { player, day, rig, score, props, hud, input, skier, renderer, spawnAt, trail, setState: (s) => { state = s; }, startGame };

  window.__frames = 0;
  // тестовый хук: детерминированная прокрутка физики
  window.__sim = (seconds, inp = {}) => {
    const n = Math.round(seconds / STEP);
    const I = Object.assign({ steer: 0, up: 0, down: 0, jump: false, grab: false }, inp);
    for (let i = 0; i < n; i++) {
      if (I.glideAt !== undefined && Math.abs(i * STEP - I.glideAt) < STEP / 2) player.wantGlide = true;
      player.update(STEP, I);
      score.update(STEP, player.grounded);
      particles.update(STEP, dpr);
      if (i % 20 === 0) { trail.update(player.pos.x, player.pos.z); props.update(player.pos.x, player.pos.z, 0, true); }
    }
    trail.update(player.pos.x, player.pos.z);
    const P = player;
    return { mode: P.mode, y: +(P.pos.y - heightAt(P.pos.x, P.pos.z)).toFixed(2), speed: +P.speed.toFixed(1), spin: +P.spin.toFixed(2), combo: Math.round(score.combo.pts), mult: score.combo.mult, total: score.total };
  };
  function frame(now) {
    requestAnimationFrame(frame);
    if (window.__hold) { last = now; return; }
    window.__frames++;
    const tStart = performance.now();
    const rdt = SIMDT || Math.min(0.05, Math.max(0.0005, (now - last) / 1000));
    last = now;
    time += rdt;
    frameAvg += ((now - (frame.prev || now)) - frameAvg) * 0.05; frame.prev = now;

    input.update(rdt);
    if (state === 'title' && (input.consume('start'))) startGame();
    if (input.consume('pause')) setPause(state === 'play');
    if (input.consume('camera')) { hud.setCamName(CAM_NAMES[rig.next()]); skier.setFirstPerson(rig.mode === 'fp'); }
    if (input.consume('time')) { day.skipTo(day.t + 0.25); if (timeOpt !== 'cycle') { timeOpt = 'cycle'; day.running = true; } }
    if (input.consume('hud')) hud.toggle();
    if (input.consume('mute')) audio.toggleMute();
    if (input.consume('reset') && state === 'play') {
      if (player.mode !== 'crash') { score.fail('Подъём'); }
      const y = player.fallLine(player.pos.x, player.pos.z);
      player.reset(player.pos.x, player.pos.z, y, 2);
    }
    if (input.consume('glide') && state === 'play') {
      if (player.mode === 'air' || player.mode === 'glide') player.wantGlide = true;
      else hud.hint('Крыло раскрывается в прыжке — оттолкнись с трамплина или сброса', 3);
    }
    input.consume('start');

    if (state === 'play' && !window.__freeze) {
      pin.steer = input.steer; pin.up = input.up; pin.down = input.down; pin.jump = input.jump; pin.grab = input.grab;
      acc += rdt;
      let steps = 0;
      while (acc >= STEP && steps < MAXSTEPS) {
        player.update(STEP, pin);
        for (const e of player.events) {
          if (e.type === 'land') rig.shake(Math.min(1, e.impact * 0.06));
          if (e.type === 'crash') rig.shake(0.9);
        }
        acc -= STEP; steps++;
      }
      if (steps >= MAXSTEPS) acc = 0;
      score.distance += player.speed * rdt;
      score.update(rdt, player.grounded);
      if (player.stillT > 2.5) hud.hint(input.isTouch ? 'Стик вверх — оттолкнуться палками' : 'Держи W — оттолкнуться палками', 2);
    } else if (state === 'title') {
      player.orient(rdt);
    }

    // персонаж
    skier.setFirstPerson(rig.mode === 'fp' && state !== 'title' && player.mode !== 'crash');
    skier.update(rdt, player.animState());
    skier.decayPoles(rdt);
    if (state === 'play' && player.mode === 'ride' && Math.abs(player.yawRate) > 1.0 && Math.random() < rdt * 2) skier.plantPole(player.yawRate > 0 ? 'L' : 'R');
    tmpUp.set(0, 1, 0).applyQuaternion(player.quat);
    skier.root.quaternion.copy(player.quat);
    skier.root.position.copy(player.pos).addScaledVector(tmpUp, 0.85);
    if (player.mode === 'ride' || player.mode === 'crash') skier.root.position.y += 0.06;
    glider.update(rdt, player.mode === 'glide', player.lean);

    // мир
    day.update(state === 'pause' ? 0 : rdt);
    rig.update(rdt, player, skier, state === 'title');
    G.uTime.value = time;
    G.uCamPos.value.copy(camera.position);
    G.uPlayer.value.copy(player.pos);
    G.uWind.value = 0.45 + Math.sin(time * 0.07) * 0.25;
    particles.snowU.uDensity.value = Math.max(0.06, 0.25 + Math.sin(time * 0.013 + 1.3) * 0.35 + G.uNight.value * 0.15);
    terrain.update(camera.position);
    props.update(player.pos.x, player.pos.z, 3);
    trail.update(player.pos.x, player.pos.z);
    particles.update(state === 'pause' ? 0 : rdt, dpr);
    camera.getWorldDirection(viewDir);
    shadows.render(scene, player.pos, day.lightDir, viewDir);

    // пост-эффекты
    const pu = post.mComp.uniforms;
    const spd = player.speed;
    pu.uSpeed.value += ((state === 'play' ? Math.max(0, Math.min(1, (spd - 13) / 22)) * (rig.mode === 'fp' ? 1.2 : 0.85) : 0) - pu.uSpeed.value) * 0.08;
    pu.uFade.value *= Math.exp(-rdt * 3);
    post.begin();
    renderer.render(scene, camera);
    post.end(time);

    hud.update(rdt, camera, innerWidth, innerHeight);
    hud.setSpeed(spd * 3.6);
    hud.setTime(day.name());
    audio.update(rdt, { speed: spd, grounded: player.mode === 'ride', air: player.mode === 'air', glide: player.mode === 'glide', carve: player.carve + player.brake, night: G.uNight.value });

    window.__lastFrameMs = performance.now() - tStart;
    // адаптивное разрешение
    perfT += rdt;
    if (perfT > 2) {
      perfT = 0;
      if (SIMDT) { /* тестовый режим */ } else if (frameAvg > 24 && dpr > 0.6) { dpr = Math.max(0.6, dpr * 0.85); resize(); }
      else if (frameAvg < 14 && dpr < maxDpr) { dpr = Math.min(maxDpr, dpr * 1.1); resize(); }
    }
  }
  requestAnimationFrame(frame);
  if (params.has('autostart')) startGame();
}

boot().catch((e) => { console.error(e); fail('Ошибка запуска: ' + e.message); });
