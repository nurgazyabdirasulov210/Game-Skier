// Лоупольный фрирайдер с процедурной анимацией.
import * as THREE from 'three';
import { GeoBuilder } from './world.js';

export const OUTFITS = [
  { name: 'Красный', jacket: [0.92, 0.12, 0.14], pants: [0.08, 0.08, 0.1], helmet: [0.92, 0.12, 0.14], ski: [0.95, 0.2, 0.18] },
  { name: 'Неон', jacket: [0.95, 0.88, 0.15], pants: [0.06, 0.06, 0.08], helmet: [0.2, 0.85, 0.85], ski: [0.2, 0.9, 0.9] },
  { name: 'Мята', jacket: [0.12, 0.62, 0.48], pants: [0.08, 0.12, 0.14], helmet: [0.1, 0.1, 0.12], ski: [0.15, 0.8, 0.6] },
  { name: 'Ночь', jacket: [0.2, 0.25, 0.7], pants: [0.9, 0.9, 0.95], helmet: [1.0, 0.5, 0.2], ski: [1.0, 0.5, 0.2] },
];

const box = (w, h, d, y = 0) => new THREE.BoxGeometry(w, h, d).translate(0, y, 0).toNonIndexed();

function part(material, geo, rgb) {
  const b = new GeoBuilder();
  b.add(geo, new THREE.Matrix4(), new THREE.Color(...rgb), 0, 0);
  const m = new THREE.Mesh(b.build(), material);
  m.castShadow = true;
  return m;
}

export class Skier {
  constructor(material) {
    this.mat = material;
    this.root = new THREE.Group(); // на точке контакта со снегом
    this.pivot = new THREE.Group(); // центр масс — вращение в трюках
    this.pivot.position.y = 0.95;
    this.root.add(this.pivot);
    this.body = new THREE.Group();
    this.body.position.y = -0.95;
    this.pivot.add(this.body);
    this.outfit = 0;
    this.build();
  }

  build() {
    this.body.clear();
    const o = OUTFITS[this.outfit];
    const skin = [0.95, 0.75, 0.62];
    const dark = [0.06, 0.06, 0.08];
    const m = this.mat;

    this.skis = [];
    this.legs = [];
    for (const side of [-1, 1]) {
      const ski = new THREE.Group();
      ski.position.set(side * 0.14, 0.03, 0);
      const plank = part(m, box(0.11, 0.035, 1.75), o.ski);
      const tip = part(m, box(0.11, 0.035, 0.22), o.ski);
      tip.position.set(0, 0.04, 0.95);
      tip.rotation.x = -0.45;
      const boot = part(m, box(0.13, 0.18, 0.3, 0.09), dark);
      ski.add(plank, tip, boot);
      this.body.add(ski);
      this.skis.push(ski);

      const hip = new THREE.Group();
      hip.position.set(side * 0.12, 0.92, 0);
      const thigh = part(m, box(0.16, 0.46, 0.18, -0.23), o.pants);
      const knee = new THREE.Group();
      knee.position.y = -0.45;
      const shin = part(m, box(0.14, 0.45, 0.16, -0.22), o.pants);
      knee.add(shin);
      hip.add(thigh, knee);
      this.body.add(hip);
      this.legs.push({ hip, knee, side });
    }

    this.torso = new THREE.Group();
    this.torso.position.y = 0.92;
    const jacket = part(m, box(0.46, 0.55, 0.3, 0.3), o.jacket);
    const collar = part(m, box(0.3, 0.1, 0.24, 0.62), o.jacket);
    this.torso.add(jacket, collar);
    this.headG = new THREE.Group();
    this.headG.position.y = 0.72;
    const face = part(m, box(0.2, 0.2, 0.2, 0.08), skin);
    const helmet = part(m, new THREE.SphereGeometry(0.15, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6).translate(0, 0.12, -0.01), o.helmet);
    const goggles = part(m, box(0.24, 0.08, 0.06, 0.12).translate(0, 0, 0.1), [0.1, 0.12, 0.2]);
    const lens = part(m, box(0.2, 0.05, 0.02, 0.12).translate(0, 0, 0.135), [1.0, 0.6, 0.2]);
    this.headG.add(face, helmet, goggles, lens);
    this.torso.add(this.headG);

    this.arms = [];
    for (const side of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(side * 0.29, 0.5, 0);
      const upper = part(m, box(0.13, 0.34, 0.14, -0.17), o.jacket);
      const elbow = new THREE.Group();
      elbow.position.y = -0.33;
      const lower = part(m, box(0.12, 0.3, 0.12, -0.15), o.jacket);
      const glove = part(m, box(0.12, 0.1, 0.12, -0.33), dark);
      const pole = part(m, new THREE.CylinderGeometry(0.012, 0.012, 1.15, 4).translate(0, -0.58, 0), [0.85, 0.85, 0.9]);
      pole.position.y = -0.33;
      pole.rotation.x = 0.35;
      elbow.add(lower, glove, pole);
      sh.add(upper, elbow);
      this.torso.add(sh);
      this.arms.push({ sh, elbow, pole, side });
    }
    this.body.add(this.torso);
  }

  nextOutfit() {
    this.outfit = (this.outfit + 1) % OUTFITS.length;
    this.build();
    return OUTFITS[this.outfit].name;
  }

  setFirstPerson(fp) {
    this.torso.visible = !fp;
    for (const l of this.legs) l.hip.visible = !fp;
  }

  // s: состояние анимации от игрока
  pose(s, t) {
    const L = 0.45;
    const crouch = THREE.MathUtils.clamp(s.crouch, 0, 1);
    const hipH = 0.97 - crouch * 0.42;
    const ankleY = 0.14;
    const reach = Math.min((hipH - ankleY) / (2 * L), 0.999);
    const a = Math.acos(reach);
    for (const leg of this.legs) {
      const extra = leg.side * s.steer * 0.08;
      leg.hip.position.y = hipH + extra;
      leg.hip.position.z = -crouch * 0.12;
      leg.hip.rotation.x = -a;
      leg.knee.rotation.x = 2 * a;
    }
    this.torso.position.y = hipH;
    this.torso.position.z = -crouch * 0.12;
    this.torso.rotation.x = 0.25 + crouch * 0.55 + (s.tuck ? 0.25 : 0);
    this.torso.rotation.z = -s.steer * 0.15;
    this.torso.rotation.y = s.steer * 0.2;
    this.headG.rotation.x = -this.torso.rotation.x * 0.8;
    // руки
    for (const arm of this.arms) {
      const plant = s.grounded ? Math.max(0, Math.sin(t * 5 + (arm.side > 0 ? 0 : Math.PI))) * 0.25 * s.pumpAmt : 0;
      if (s.tuck) {
        arm.sh.rotation.set(-1.2, 0, arm.side * 0.2);
        arm.elbow.rotation.x = -1.4;
      } else if (s.grab && arm.side === s.grabSide) {
        arm.sh.rotation.set(-0.2, 0, arm.side * 0.15);
        arm.elbow.rotation.x = -0.4;
      } else if (!s.grounded) {
        arm.sh.rotation.set(-0.5 + Math.sin(t * 9 + arm.side) * 0.1, 0, arm.side * (0.7 + s.airArms * 0.6));
        arm.elbow.rotation.x = -0.5;
      } else {
        arm.sh.rotation.set(-0.55 - plant, 0, arm.side * 0.35 + s.steer * 0.25);
        arm.elbow.rotation.x = -0.7;
      }
      arm.pole.rotation.x = s.tuck ? 1.5 : 0.35;
    }
    // лыжи: в воздухе — немного «ножницы», при торможении — плуг
    this.skis[0].rotation.y = s.brake * 0.25 + (s.grab ? 0.1 : 0);
    this.skis[1].rotation.y = -s.brake * 0.25 - (s.grab ? 0.1 : 0);
    this.skis[0].rotation.x = this.skis[1].rotation.x = s.grounded ? 0 : -0.12;
  }
}
