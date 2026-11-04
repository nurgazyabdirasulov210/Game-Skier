// Builds the whole valley scene (terrain, forest, props, sky, post, moods)
// and keeps it updated. Shared by the map viewer and the ride mode.
import * as THREE from 'three';
import { U } from './shading.js';
import { buildTerrain, heightAt } from './terrain.js';
import { buildVegetation } from './vegetation.js';
import { buildProps, planLandmarks } from './props.js';
import { buildSky, buildSnowfall } from './sky.js';
import { buildPost } from './post.js';
import { PALETTES, PALETTE_ORDER, resolvePalette, blendPalettes, sunVector } from './palettes.js';

export async function createWorld({ canvas, quality: Q, mood = 'day', step = async () => {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.2, Q.far);

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

  // ---------------- moods
  const resolved = Object.fromEntries(PALETTE_ORDER.map((k) => [k, resolvePalette(PALETTES[k])]));
  let current = PALETTES[mood] ? mood : 'day';
  let blendFrom = resolved[current], blendTo = resolved[current], blendT = 1;
  let live = blendPalettes(blendFrom, blendTo, 1);
  const sunDir = new THREE.Vector3();
  const moodListeners = [];

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
    for (const fn of moodListeners) fn(p);
  }
  applyPalette(live);

  function setMood(name, instant = false) {
    if (!PALETTES[name]) return;
    blendFrom = blendPalettes(live, live, 0);
    blendTo = resolved[name];
    blendT = instant ? 1 : 0;
    current = name;
    if (instant) { live = blendPalettes(blendTo, blendTo, 1, live); applyPalette(live); }
  }

  const texel = (Q.shadowRange * 2) / Q.shadowSize;
  const fwd = new THREE.Vector3();

  return {
    renderer, scene, camera, sun, hemi, terrain, props, veg, sky, snow, post, landmarks, sunDir,
    get mood() { return current; },
    get palette() { return live; },
    setMood,
    onMood(fn) { moodListeners.push(fn); fn(live); },
    resize() {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
      post.setSize(innerWidth, innerHeight);
    },
    /** focus: point the shadow box should cover (defaults to the camera). */
    update(dt, time, focus) {
      U.uTime.value = time;
      if (blendT < 1) {
        blendT = Math.min(1, blendT + dt / 2.2);
        const k = blendT * blendT * (3 - 2 * blendT);
        live = blendPalettes(blendFrom, blendTo, k, live);
        applyPalette(live);
      }
      const f = focus || camera.position;
      camera.getWorldDirection(fwd);
      fwd.y = 0; fwd.normalize();
      const lead = focus ? 0.3 : 0.55;
      const cx = Math.round((f.x + fwd.x * Q.shadowRange * lead) / texel) * texel;
      const cz = Math.round((f.z + fwd.z * Q.shadowRange * lead) / texel) * texel;
      const cy = heightAt(cx, cz);
      sun.target.position.set(cx, cy, cz);
      sun.position.set(cx, cy, cz).addScaledVector(sunDir, 700);
      sun.target.updateMatrixWorld();
      veg.update(camera.position);
      props.update(camera.position);
      sky.mesh.position.copy(camera.position);
      post.update(sunDir, time);
    },
    render() { post.render(); },
  };
}
