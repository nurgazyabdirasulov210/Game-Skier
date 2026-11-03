import * as THREE from '../vendor/three.module.js';
import { makeMaterial, mergeParts, M4 } from './materials.js';

// Оригинальный персонаж: объёмная куртка, шапка с помпоном, маска, рюкзак.
export const OUTFITS = {
  lilac: { name: 'Сирень', jacket: '#8f74de', jacket2: '#efe9ff', pants: '#25294f', hat: '#ff6b5c', pom: '#ffe1d6', mitt: '#ff6b5c', lens: '#ffb347', ski: '#ff6b5c', ski2: '#f4f1ea', pack: '#3a3f6e', boot: '#20223a' },
  graphite: { name: 'Графит', jacket: '#3b404c', jacket2: '#b6e85a', pants: '#191b22', hat: '#b6e85a', pom: '#2a2e38', mitt: '#2a2e38', lens: '#7fd8ff', ski: '#b6e85a', ski2: '#191b22', pack: '#c96a3a', boot: '#111216' },
  terracotta: { name: 'Терракота', jacket: '#c85a3e', jacket2: '#f1e6cf', pants: '#ece2cc', hat: '#2f5d50', pom: '#f1e6cf', mitt: '#2f5d50', lens: '#ffd75e', ski: '#2f5d50', ski2: '#f1e6cf', pack: '#4a3a30', boot: '#3a2a22' },
};

const SKIN = '#f0b896';
const L_THIGH = 0.45, L_SHIN = 0.46;

function cap(r, len, seg = 7) { return new THREE.CapsuleGeometry(r, len, 3, seg); }

export class Skier {
  constructor(shadows, outfit = 'lilac') {
    this.root = new THREE.Group();
    this.mat = makeMaterial({ wrap: 0.5, rim: 0.55 });
    this.shadows = shadows;
    this.meshes = [];
    this.fpHidden = [];
    this.t = 0;
    this.pom = { y: 0, v: 0 };
    this.pole = { L: 0, R: 0 };
    this.build(outfit);
  }

  part(parent, geoParts, fpHide = false) {
    const mesh = new THREE.Mesh(mergeParts(geoParts), this.mat);
    mesh.userData.depthMat = this.mat.userData.depthMat;
    mesh.frustumCulled = false;
    parent.add(mesh);
    this.shadows.add(mesh, 1);
    this.meshes.push(mesh);
    if (fpHide) this.fpHidden.push(mesh);
    return mesh;
  }

  build(key) {
    const o = OUTFITS[key] || OUTFITS.lilac;
    this.outfit = key;
    for (const m of this.meshes) { this.shadows.remove(m); m.geometry.dispose(); m.parent.remove(m); }
    this.meshes = []; this.fpHidden = [];
    if (this.body) this.root.remove(this.body);

    const B = {};
    this.B = B;
    const body = (this.body = new THREE.Group());
    body.position.y = -0.85;
    this.root.add(body);

    // лыжи
    B.skis = new THREE.Group(); body.add(B.skis);
    for (const s of [-1, 1]) {
      const g = new THREE.Group(); g.position.x = s * 0.13; B.skis.add(g);
      B['ski' + (s < 0 ? 'L' : 'R')] = g;
      this.part(g, [
        { geo: new THREE.BoxGeometry(0.095, 0.03, 1.55), matrix: M4(0, 0.015, -0.05), color: o.ski },
        { geo: new THREE.BoxGeometry(0.097, 0.032, 0.5), matrix: M4(0, 0.016, 0.2), color: o.ski2 },
        { geo: new THREE.BoxGeometry(0.09, 0.028, 0.22), matrix: M4(0, 0.06, 0.8, -0.5, 0, 0), color: o.ski },
        { geo: new THREE.BoxGeometry(0.09, 0.028, 0.16), matrix: M4(0, 0.035, -0.86, 0.35, 0, 0), color: o.ski },
        { geo: new THREE.BoxGeometry(0.1, 0.05, 0.3), matrix: M4(0, 0.05, 0.0), color: '#30323a' },
      ]);
    }

    // таз
    B.hips = new THREE.Group(); body.add(B.hips);
    this.part(B.hips, [
      { geo: new THREE.SphereGeometry(0.17, 8, 6), matrix: M4(0, 0.02, 0, 0, 0, 0, 1.15, 0.8, 0.95), color: o.pants },
    ]);
    // ноги
    for (const s of [-1, 1]) {
      const n = s < 0 ? 'L' : 'R';
      const thigh = new THREE.Group(); thigh.position.set(s * 0.11, 0, 0); B.hips.add(thigh);
      this.part(thigh, [{ geo: cap(0.085, L_THIGH - 0.12), matrix: M4(0, -L_THIGH / 2, 0), color: o.pants }]);
      const shin = new THREE.Group(); shin.position.y = -L_THIGH; thigh.add(shin);
      this.part(shin, [
        { geo: cap(0.078, L_SHIN - 0.16), matrix: M4(0, -L_SHIN / 2 + 0.04, 0), color: o.pants },
        { geo: new THREE.CylinderGeometry(0.1, 0.09, 0.2, 7), matrix: M4(0, -L_SHIN + 0.12, 0.01), color: o.boot },
        { geo: new THREE.BoxGeometry(0.13, 0.08, 0.3), matrix: M4(0, -L_SHIN + 0.03, 0.04), color: o.boot },
      ]);
      B['thigh' + n] = thigh; B['shin' + n] = shin;
    }
    // корпус
    B.torso = new THREE.Group(); B.torso.position.y = 0.06; B.hips.add(B.torso);
    this.part(B.torso, [
      { geo: cap(0.2, 0.26, 9), matrix: M4(0, 0.27, 0, 0, 0, 0, 1.12, 1, 0.86), color: o.jacket },
      { geo: new THREE.CylinderGeometry(0.235, 0.22, 0.07, 9), matrix: M4(0, 0.2, 0, 0, 0, 0, 1.0, 1, 0.82), color: o.jacket2 },
      { geo: new THREE.CylinderGeometry(0.12, 0.14, 0.09, 8), matrix: M4(0, 0.57, 0), color: o.jacket2 },
      // рюкзак
      { geo: new THREE.BoxGeometry(0.3, 0.38, 0.14), matrix: M4(0, 0.3, -0.2), color: o.pack },
      { geo: new THREE.BoxGeometry(0.26, 0.1, 0.06), matrix: M4(0, 0.2, -0.29), color: o.jacket2 },
    ], true);
    // голова
    B.head = new THREE.Group(); B.head.position.y = 0.62; B.torso.add(B.head);
    this.part(B.head, [
      { geo: new THREE.SphereGeometry(0.125, 10, 8), matrix: M4(0, 0.1, 0.0), color: SKIN },
      { geo: new THREE.SphereGeometry(0.135, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), matrix: M4(0, 0.12, -0.005), color: o.hat },
      { geo: new THREE.TorusGeometry(0.125, 0.03, 5, 12), matrix: M4(0, 0.12, 0, Math.PI / 2, 0, 0, 1, 1, 1), color: o.hat },
      { geo: new THREE.BoxGeometry(0.21, 0.075, 0.06), matrix: M4(0, 0.1, 0.105), color: o.lens },
      { geo: new THREE.TorusGeometry(0.128, 0.018, 4, 14), matrix: M4(0, 0.1, 0, Math.PI / 2, 0, 0, 1, 1, 1), color: '#22232c' },
      { geo: new THREE.CylinderGeometry(0.11, 0.12, 0.08, 9), matrix: M4(0, -0.02, 0.0), color: o.jacket2 },
    ], true);
    B.pomp = new THREE.Group(); B.pomp.position.set(0, 0.25, -0.01); B.head.add(B.pomp);
    this.part(B.pomp, [{ geo: new THREE.IcosahedronGeometry(0.06, 1), sphere: true, matrix: M4(0, 0.03, 0), color: o.pom }], true);

    // руки
    for (const s of [-1, 1]) {
      const n = s < 0 ? 'L' : 'R';
      const sh = new THREE.Group(); sh.position.set(s * 0.25, 0.48, 0); B.torso.add(sh);
      this.part(sh, [{ geo: cap(0.075, 0.2), matrix: M4(0, -0.15, 0), color: o.jacket }], true);
      const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
      this.part(el, [
        { geo: cap(0.066, 0.18), matrix: M4(0, -0.13, 0), color: o.jacket },
        { geo: new THREE.CylinderGeometry(0.075, 0.07, 0.05, 7), matrix: M4(0, -0.25, 0), color: o.jacket2 },
      ], true);
      const hand = new THREE.Group(); hand.position.y = -0.3; el.add(hand);
      this.part(hand, [
        { geo: new THREE.IcosahedronGeometry(0.075, 1), sphere: true, matrix: M4(0, -0.02, 0.01, 0, 0, 0, 1, 1.15, 1.1), color: o.mitt },
        { geo: new THREE.IcosahedronGeometry(0.035, 0), matrix: M4(s * -0.05, 0.0, 0.05), color: o.mitt },
      ]);
      const pole = new THREE.Group(); hand.add(pole);
      this.part(pole, [
        { geo: new THREE.CylinderGeometry(0.012, 0.01, 1.2, 5), matrix: M4(0, -0.58, 0), color: '#dfe3ea' },
        { geo: new THREE.CylinderGeometry(0.02, 0.02, 0.14, 6), matrix: M4(0, -0.02, 0), color: '#26282f' },
        { geo: new THREE.CylinderGeometry(0.055, 0.055, 0.012, 8), matrix: M4(0, -1.1, 0), color: '#26282f' },
      ]);
      B['sh' + n] = sh; B['el' + n] = el; B['hand' + n] = hand; B['pole' + n] = pole;
    }
  }

  setFirstPerson(on) {
    for (const m of this.fpHidden) m.visible = !on;
  }

  legIK(n, hipPos, ankle) {
    // плоская задача в сагиттальной плоскости (y, z) в системе таза
    const thigh = this.B['thigh' + n], shin = this.B['shin' + n];
    const dy = ankle.y - hipPos.y, dz = ankle.z - hipPos.z;
    const D = Math.min(Math.hypot(dy, dz), L_THIGH + L_SHIN - 0.002);
    const a = Math.atan2(dz, -dy);
    const cA = (L_THIGH * L_THIGH + D * D - L_SHIN * L_SHIN) / (2 * L_THIGH * D);
    const alpha = Math.acos(Math.max(-1, Math.min(1, cA)));
    const cK = (L_THIGH * L_THIGH + L_SHIN * L_SHIN - D * D) / (2 * L_THIGH * L_SHIN);
    const knee = Math.acos(Math.max(-1, Math.min(1, cK)));
    thigh.rotation.x = -(a + alpha);
    shin.rotation.x = Math.PI - knee;
  }

  // s — состояние анимации от игрока
  update(dt, s) {
    const B = this.B;
    this.t += dt;
    const k = 1 - Math.exp(-dt * 12);
    const sm = this.sm || (this.sm = { crouch: 0.3, lean: 0, counter: 0, armOut: 0.4, grab: 0, tuck: 0, glide: 0, crash: 0, splitL: 0, splitR: 0, brake: 0 });
    for (const key of Object.keys(sm)) {
      const target = s[key] ?? 0;
      const rate = key === 'crash' ? 1 - Math.exp(-dt * 6) : key === 'grab' ? 1 - Math.exp(-dt * 16) : k;
      sm[key] += (target - sm[key]) * rate;
    }
    const crouch = Math.min(1, sm.crouch + sm.tuck * 0.5);
    const hipH = 0.94 - crouch * 0.36 - sm.glide * 0.25;
    B.hips.position.set(Math.sin(this.t * 1.7) * 0.01, hipH, -0.06 - crouch * 0.1);
    // наклон корпуса вперёд и контр-ротация
    B.hips.rotation.set(0.05 + crouch * 0.25 - sm.glide * 0.9, sm.counter * 0.4, 0);
    B.torso.rotation.set(0.18 + crouch * 0.38 + sm.tuck * 0.35 + sm.glide * 0.6, sm.counter * 0.5, -sm.lean * 0.25);
    B.head.rotation.set(-0.25 - crouch * 0.35 - sm.tuck * 0.3 - sm.glide * 0.2 + s.look * 0.2, -sm.counter * 0.7 + (s.lookYaw || 0), 0);

    // помпон на пружинке
    const p = this.pom;
    p.v += (-p.y * 160 - p.v * 7 + (s.bounce || 0) * 40) * dt;
    p.y += p.v * dt;
    B.pomp.position.y = 0.25 + p.y * 0.01;
    B.pomp.rotation.x = p.y * 0.04;

    // ноги: лодыжки на лыжах
    const hp = B.hips.position;
    const tmp = this._a || (this._a = new THREE.Vector3());
    for (const n of ['L', 'R']) {
      const split = n === 'L' ? sm.splitL : sm.splitR;
      const ankle = tmp.set(0, 0.12 + split * 0.2 + sm.glide * 0.35, 0.0 + split * 0.25 + sm.glide * 0.5);
      // в системе таза (учитываем наклон таза грубо)
      const hipLocal = { y: hp.y, z: hp.z };
      const rx = B.hips.rotation.x;
      const ay = ankle.y - hipLocal.y, az = ankle.z - hipLocal.z;
      const ry = ay * Math.cos(-rx) - az * Math.sin(-rx);
      const rz = ay * Math.sin(-rx) + az * Math.cos(-rx);
      this.legIK(n, { y: 0, z: 0 }, { y: ry, z: rz });
    }

    // руки
    const swing = Math.sin(this.t * 2.2) * 0.05;
    for (const n of ['L', 'R']) {
      const side = n === 'L' ? -1 : 1;
      const sh = B['sh' + n], el = B['el' + n], hand = B['hand' + n], pole = B['pole' + n];
      const plant = this.pole[n];
      const grabThis = n === 'R' ? sm.grab : sm.grab * 0.3;
      let ax = -0.55 - sm.armOut * 0.25 + swing * side - plant * 0.5;
      let az = side * (0.28 + sm.armOut * 0.55);
      let ex = -0.9 + plant * 0.3;
      // присед-«яйцо»: руки вперёд
      ax = ax * (1 - sm.tuck) + (-1.3) * sm.tuck;
      az = az * (1 - sm.tuck) + side * 0.12 * sm.tuck;
      ex = ex * (1 - sm.tuck) + (-1.4) * sm.tuck;
      // параплан: руки вверх к стропам
      ax = ax * (1 - sm.glide) + (-2.7) * sm.glide;
      az = az * (1 - sm.glide) + side * 0.35 * sm.glide;
      ex = ex * (1 - sm.glide) + (-0.4) * sm.glide;
      // граб: тянемся к лыже
      ax = ax * (1 - grabThis) + (0.2) * grabThis;
      az = az * (1 - grabThis) + side * 0.05 * grabThis;
      ex = ex * (1 - grabThis) + (-0.2) * grabThis;
      // авария: руки болтаются
      if (sm.crash > 0.01) {
        ax += Math.sin(this.t * 9 + side) * 1.4 * sm.crash;
        az += side * Math.abs(Math.sin(this.t * 7)) * 1.2 * sm.crash;
      }
      sh.rotation.set(ax, 0, az);
      el.rotation.set(ex, 0, 0);
      hand.rotation.set(0, 0, 0);
      // палки назад-вниз
      pole.rotation.set(0.9 - plant * 0.9 + sm.tuck * 0.6 - sm.glide * 0.8, 0, -side * 0.1);
    }
    // лыжи: развал при торможении, «ножницы» в воздухе
    B.skiL.rotation.set(0, sm.brake * 0.35 + (s.skiSplay || 0), 0);
    B.skiR.rotation.set(0, -sm.brake * 0.35 - (s.skiSplay || 0), 0);
    B.skiL.position.set(-0.13 - sm.brake * 0.08, sm.splitL * 0.2 + sm.glide * 0.35, sm.splitL * 0.25 + sm.glide * 0.5);
    B.skiR.position.set(0.13 + sm.brake * 0.08, sm.splitR * 0.2 + sm.glide * 0.35, sm.splitR * 0.25 + sm.glide * 0.5);
    B.skiL.rotation.x = -sm.glide * 0.2;
    B.skiR.rotation.x = -sm.glide * 0.2;
  }

  plantPole(side) { this.pole[side] = 1; }
  decayPoles(dt) { this.pole.L = Math.max(0, this.pole.L - dt * 2.5); this.pole.R = Math.max(0, this.pole.R - dt * 2.5); }
}
