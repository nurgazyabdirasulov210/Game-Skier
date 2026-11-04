// The skier: a puffy-jacket rider built from primitives, posed every frame
// with two-bone IK for arms and legs. Local space: +z forward, +y up,
// origin under the boots.
import * as THREE from 'three';
import { clamp, lerp } from './util.js';

export const OUTFITS = [
  { name: 'Рябина', jacket: '#e8242c', jacket2: '#b5131c', pants: '#1a1c2c', helmet: '#e8242c', skis: '#e8242c', mitts: '#15161f', pack: '#2b2f52' },
  { name: 'Лимонник', jacket: '#ffd21f', jacket2: '#1bb7b0', pants: '#151826', helmet: '#18c7c0', skis: '#21d4c8', mitts: '#0f1220', pack: '#151826' },
  { name: 'Пингвин', jacket: '#f4f4f8', jacket2: '#20222e', pants: '#20222e', helmet: '#f4f4f8', skis: '#e5355a', mitts: '#20222e', pack: '#e5355a' },
  { name: 'Хвоя', jacket: '#1fa58a', jacket2: '#0f3c3a', pants: '#0f2c2f', helmet: '#0f3c3a', skis: '#1fa58a', mitts: '#0b1717', pack: '#1fa58a' },
];

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();

function capsule(r, len, mat) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  g.translate(0, -len / 2, 0); // hangs down from its joint
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

// Solve a two-bone chain in the parent's space. `upper` sits at the root
// joint, `lower` is its child at distance l1 along -y.
function solveIK(upper, lower, root, target, pole, l1, l2) {
  const toT = _a.subVectors(target, root);
  let d = toT.length();
  d = clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  toT.normalize();
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const angA = Math.acos(cosA);
  // bend plane
  const side = _b.copy(pole).sub(root);
  side.addScaledVector(toT, -side.dot(toT)).normalize();
  if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
  const elbowDir = _c.copy(toT).multiplyScalar(Math.cos(angA)).addScaledVector(side, Math.sin(angA)).normalize();
  upper.quaternion.setFromUnitVectors(DOWN, elbowDir);
  // lower bone: direction from elbow to target, expressed in upper space
  const elbow = _d.copy(root).addScaledVector(elbowDir, l1);
  const dir2 = _b.subVectors(_a.copy(toT).multiplyScalar(d).add(root), elbow).normalize();
  _q.copy(upper.quaternion).invert();
  dir2.applyQuaternion(_q);
  lower.quaternion.setFromUnitVectors(DOWN, dir2);
}

export class Rider {
  constructor(outfit = OUTFITS[0]) {
    this.root = new THREE.Group();          // world placement
    this.body = new THREE.Group();          // lean / spin / flip
    this.root.add(this.body);
    this.mats = {};
    this._build();
    this.setOutfit(outfit);
    this.pose = {
      crouch: 0.2, lean: 0, tuck: 0, armsUp: 0, grab: 0, grabKind: 0, legLift: 0,
      brake: 0, glide: 0, flail: 0, polePlant: 0, t: 0,
    };
    this.firstPerson = false;
  }

  _mat(key, color) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0 });
    this.mats[key] = m;
    return m;
  }

  _build() {
    const B = this.body;
    const jacket = this._mat('jacket', '#e8242c');
    const jacket2 = this._mat('jacket2', '#b5131c');
    const pants = this._mat('pants', '#1a1c2c');
    const helmet = this._mat('helmet', '#e8242c');
    const skiM = this._mat('skis', '#e8242c');
    const mitts = this._mat('mitts', '#15161f');
    const pack = this._mat('pack', '#2b2f52');
    const dark = this._mat('dark', '#14151f');
    const goggle = new THREE.MeshStandardMaterial({ color: '#ffb02e', roughness: 0.2, metalness: 0.4, emissive: '#5a2a00' });
    const pole = this._mat('pole', '#d8dbe6');

    // feet group carries boots and skis (lifted when tucking in the air)
    this.feet = new THREE.Group();
    B.add(this.feet);
    const skiGeo = new THREE.BoxGeometry(0.095, 0.022, 1.72, 1, 1, 14);
    const sp = skiGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const z = sp.getZ(i);
      if (z > 0.62) { const t = (z - 0.62) / 0.24; sp.setY(i, sp.getY(i) + t * t * 0.1); }
      if (z < -0.78) { const t = (-z - 0.78) / 0.08; sp.setY(i, sp.getY(i) + t * t * 0.02); }
    }
    skiGeo.computeVertexNormals();
    this.skis = [];
    for (const sx of [-0.11, 0.11]) {
      const ski = new THREE.Mesh(skiGeo, skiM);
      ski.position.set(sx, 0.012, 0.06);
      ski.castShadow = true;
      this.feet.add(ski);
      this.skis.push(ski);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.3), dark);
      boot.position.set(sx, 0.1, 0.02);
      boot.castShadow = true;
      this.feet.add(boot);
    }

    // hips
    this.hips = new THREE.Group();
    B.add(this.hips);
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), pants);
    pelvis.scale.set(1.1, 0.8, 0.9);
    pelvis.castShadow = true;
    this.hips.add(pelvis);

    // torso: puffy jacket
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.26, 6, 14), jacket);
    chest.position.y = 0.27;
    chest.scale.set(1.12, 1, 0.92);
    chest.castShadow = true;
    this.torso.add(chest);
    for (let i = 0; i < 3; i++) {   // quilted bands
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.028, 6, 18), i === 1 ? jacket2 : jacket);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.13 + i * 0.13;
      band.scale.set(1.12, 0.92, 1);
      this.torso.add(band);
    }
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.05, 8, 16), jacket2);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.53;
    this.torso.add(collar);
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.38, 0.14), pack);
    bag.position.set(0, 0.3, -0.22);
    bag.castShadow = true;
    this.torso.add(bag);
    this.bag = bag;

    // head
    this.head = new THREE.Group();
    this.head.position.y = 0.6;
    this.torso.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12), helmet);
    skull.position.y = 0.1;
    skull.scale.set(1, 1.05, 1.08);
    skull.castShadow = true;
    this.head.add(skull);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), dark);
    face.position.set(0, 0.07, 0.035);
    this.head.add(face);
    const gog = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.12, 4, 10), goggle);
    gog.rotation.z = Math.PI / 2;
    gog.position.set(0, 0.11, 0.12);
    this.head.add(gog);

    // arms
    this.arms = [];
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.25, 0.43, 0);
      this.torso.add(shoulder);
      const upper = new THREE.Group();
      shoulder.add(upper);
      upper.add(capsule(0.075, 0.24, jacket));
      const lower = new THREE.Group();
      lower.position.y = -0.3;
      upper.add(lower);
      lower.add(capsule(0.065, 0.22, jacket));
      const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mitts);
      mitt.position.y = -0.31;
      mitt.scale.set(0.9, 1.2, 0.9);
      lower.add(mitt);
      const poleMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 1.15, 5), pole);
      poleMesh.geometry.translate(0, -0.55, 0);
      const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 8), dark);
      basket.position.y = -1.0;
      poleMesh.add(basket);
      poleMesh.castShadow = true;
      B.add(poleMesh);
      this.arms.push({ s, shoulder, upper, lower, mitt, pole: poleMesh });
    }

    // legs
    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.1, -0.03, 0);
      this.hips.add(hip);
      const upper = new THREE.Group();
      hip.add(upper);
      upper.add(capsule(0.085, 0.36, pants));
      const lower = new THREE.Group();
      lower.position.y = -0.45;
      upper.add(lower);
      lower.add(capsule(0.075, 0.36, pants));
      this.legs.push({ s, hip, upper, lower });
    }

    // paraglider wing
    this.wing = new THREE.Group();
    const wingMat = this._mat('wing', '#1f5f63');
    const cells = 11;
    for (let i = 0; i < cells; i++) {
      const a = (i / (cells - 1) - 0.5) * 2.1;
      const cell = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.22, 2.1), wingMat);
      cell.position.set(Math.sin(a) * 4.5, Math.cos(a) * 4.5 - 4.5 + 6.2, 0.3);
      cell.rotation.z = -a;
      cell.castShadow = true;
      this.wing.add(cell);
    }
    const lines = [];
    for (let i = 0; i < cells; i += 2) {
      const a = (i / (cells - 1) - 0.5) * 2.1;
      const tip = [Math.sin(a) * 4.4, Math.cos(a) * 4.4 - 4.5 + 6.1, 0.3];
      for (const s of [-1, 1]) lines.push(...tip, s * 0.22, 1.25, 0);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.wing.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#e8e8f0', transparent: true, opacity: 0.6 })));
    this.wing.visible = false;
    this.wing.scale.setScalar(0.01);
    this.root.add(this.wing);

    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  setOutfit(o) {
    for (const k of ['jacket', 'jacket2', 'pants', 'helmet', 'skis', 'mitts', 'pack']) this.mats[k].color.set(o[k]);
    this.mats.wing.color.set(o.jacket2).lerp(new THREE.Color('#1f5f63'), 0.5);
  }

  setFirstPerson(fp) {
    this.firstPerson = fp;
    this.torso.visible = !fp;
    this.hips.children.forEach((c) => { if (c !== this.torso) c.visible = !fp; });
    for (const l of this.legs) l.hip.visible = !fp;
  }

  // p: pose targets (already smoothed by the caller)
  update(dt) {
    const p = this.pose;
    p.t += dt;
    const crouch = clamp(p.crouch, 0, 1);

    // feet lift (air tuck / grabs)
    this.feet.position.y = p.legLift;
    this.feet.position.z = p.legLift * 0.15;
    this.feet.rotation.x = -p.legLift * 0.25;

    // hips: height from crouch, slightly back
    const hipH = lerp(0.98, 0.6, crouch) + p.legLift * 0.25 + p.glide * 0.05;
    this.hips.position.set(p.lean * 0.12, hipH, lerp(-0.05, -0.16, crouch) - p.brake * 0.06);
    this.hips.rotation.set(0, p.brake * 0.6, 0);
    // torso pitch forward when crouched, upright gliding
    this.torso.rotation.set(lerp(0.15, 0.55, crouch) + p.tuck * 0.35 - p.glide * 0.3 + p.flail * Math.sin(p.t * 13) * 0.4,
      -p.brake * 0.4 + p.flail * Math.sin(p.t * 9) * 0.3, p.lean * 0.25);
    this.head.rotation.set(-lerp(0.1, 0.45, crouch) - p.tuck * 0.3, 0, -p.lean * 0.15);

    // legs: ankles above the boots
    this.body.updateMatrixWorld(true);
    for (const L of this.legs) {
      const root = _a.set(0, 0, 0);
      L.hip.updateMatrixWorld(true);
      // work in the hip's parent (hips) space
      const inv = _m.copy(this.hips.matrix).invert();
      const ankle = new THREE.Vector3(L.s * 0.11, 0.17, 0.02);
      ankle.add(this.feet.position).applyMatrix4(inv);
      root.copy(L.hip.position);
      const pole = new THREE.Vector3(L.s * 0.05, 0, 1.0).add(root);
      solveIK(L.upper, L.lower, root, ankle, pole, 0.45, 0.45);
      L.upper.quaternion.premultiply(_q2.identity());
    }

    // arms
    const torsoM = new THREE.Matrix4();
    for (const A of this.arms) {
      const s = A.s;
      // default hand target in body space
      let tx = s * 0.36, ty = hipH + 0.15, tz = 0.32;
      // pole plant on the inside of the turn
      const inside = (s > 0 && p.lean > 0) || (s < 0 && p.lean < 0);
      if (inside) { ty -= Math.abs(p.lean) * 0.25 * p.polePlant; tx += s * 0.05; }
      // tuck: hands forward and low
      tx = lerp(tx, s * 0.18, p.tuck); ty = lerp(ty, hipH + 0.05, p.tuck); tz = lerp(tz, 0.55, p.tuck);
      // air balance: arms out
      tx = lerp(tx, s * 0.75, p.armsUp); ty = lerp(ty, hipH + 0.75, p.armsUp); tz = lerp(tz, 0.1, p.armsUp);
      // glide: hold the brakes up high
      tx = lerp(tx, s * 0.32, p.glide); ty = lerp(ty, hipH + 1.05, p.glide); tz = lerp(tz, 0.05, p.glide);
      // flail when crashing
      if (p.flail > 0) {
        tx += p.flail * Math.sin(p.t * 17 + s) * 0.35 * s;
        ty += p.flail * (0.4 + Math.cos(p.t * 15 + s) * 0.35);
      }
      // grabs: reach a point on the skis
      if (p.grab > 0) {
        const gk = p.grabKind;
        const reachSide = gk === 1 ? -1 : 1;  // which hand grabs
        if (s === reachSide || gk === 2) {
          let gx = s * 0.11, gz = 0.0;
          if (gk === 0) gz = -0.55;        // tail
          if (gk === 1) gz = 0.6;          // nose
          if (gk === 2) { gz = 0.12; gx = -s * 0.04; }  // mute, both hands
          const gy = p.legLift + 0.09;
          tx = lerp(tx, gx, p.grab); ty = lerp(ty, gy, p.grab); tz = lerp(tz, gz + 0.06, p.grab);
        } else {
          tx = lerp(tx, s * 0.8, p.grab); ty = lerp(ty, hipH + 0.7, p.grab); tz = lerp(tz, -0.1, p.grab);
        }
      }
      // body space -> shoulder parent (torso) space
      this.hips.updateMatrixWorld(true);
      torsoM.copy(this.body.matrixWorld).invert().multiply(this.torso.matrixWorld).invert();
      const target = new THREE.Vector3(tx, ty, tz).applyMatrix4(torsoM);
      const pole = new THREE.Vector3(s * 0.8, -0.6, -0.8).add(A.shoulder.position);
      solveIK(A.upper, A.lower, A.shoulder.position, target, pole, 0.3, 0.32);

      // pole follows the hand, pointing back and down
      A.lower.updateMatrixWorld(true);
      const hand = A.mitt.getWorldPosition(new THREE.Vector3());
      this.body.worldToLocal(hand);
      A.pole.position.copy(hand);
      const swing = p.glide > 0.5 ? 1 : 0;
      const dir = new THREE.Vector3(s * 0.15, -0.75, -0.6 - p.tuck * 0.4);
      if (inside) dir.lerp(new THREE.Vector3(s * 0.2, -1, 0.2), Math.abs(p.lean) * p.polePlant * 0.8);
      if (p.armsUp > 0.3) dir.lerp(new THREE.Vector3(s * 0.6, -0.5, -0.6), p.armsUp);
      if (swing) dir.set(0, -1, -0.4);
      dir.normalize();
      A.pole.quaternion.setFromUnitVectors(DOWN, dir);
      A.pole.visible = !this.firstPerson;
    }
  }
}
