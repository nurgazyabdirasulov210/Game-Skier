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
    const grey = this._mat('grey', '#8a90a8');
    grey.metalness = 0.5; grey.roughness = 0.4;
    const white = this._mat('white', '#eef0f6');
    const base = this._mat('base', '#101118');
    const goggle = new THREE.MeshStandardMaterial({ color: '#ffb02e', roughness: 0.12, metalness: 0.7, emissive: '#4a2200' });
    this.mats.goggle = goggle;
    const pole = this._mat('pole', '#d8dbe6');
    pole.metalness = 0.6; pole.roughness = 0.35;
    const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // ---- skis: sidecut, rocker tips, topsheet stripe, bindings ----
    this.feet = new THREE.Group();
    B.add(this.feet);
    const skiShape = (w, h, y0) => {
      const g = new THREE.BoxGeometry(1, h, 1.74, 1, 1, 28);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i);
        const t = z / 0.87;
        // waist narrower than tip and tail
        const width = w * (0.82 + 0.22 * t * t) * (z > 0.8 ? 1 - (z - 0.8) * 4 : 1);
        p.setX(i, p.getX(i) * width);
        let y = p.getY(i) + y0;
        if (z > 0.55) { const k = (z - 0.55) / 0.32; y += k * k * 0.13; }
        if (z < -0.7) { const k = (-z - 0.7) / 0.17; y += k * k * 0.05; }
        p.setY(i, y);
      }
      g.computeVertexNormals();
      return g;
    };
    const skiGeo = skiShape(0.11, 0.02, 0);
    const baseGeo = skiShape(0.112, 0.006, -0.012);
    const stripeGeo = skiShape(0.03, 0.004, 0.012);
    this.skis = [];
    for (const sx of [-0.11, 0.11]) {
      const ski = new THREE.Group();
      ski.position.set(sx, 0.014, 0.06);
      this.feet.add(ski);
      add(ski, skiGeo, skiM);
      add(ski, baseGeo, base);
      add(ski, stripeGeo, white);
      // bindings
      add(ski, new THREE.BoxGeometry(0.085, 0.045, 0.1), grey, 0, 0.032, 0.17);
      add(ski, new THREE.BoxGeometry(0.085, 0.06, 0.12), grey, 0, 0.04, -0.17);
      add(ski, new THREE.BoxGeometry(0.02, 0.02, 0.09), dark, 0, 0.075, -0.2, 0.5);
      add(ski, new THREE.BoxGeometry(0.1, 0.012, 0.42), dark, 0, 0.016, 0);
      this.skis.push(ski);
      // boot: shell, cuff, buckles, sole
      add(this.feet, new THREE.BoxGeometry(0.115, 0.03, 0.31), dark, sx, 0.045, 0.02);
      const shell = add(this.feet, new THREE.CapsuleGeometry(0.06, 0.16, 4, 10), white, sx, 0.11, 0.04, Math.PI / 2, 0, 0, 0.95, 1, 0.8);
      shell.material = this.mats.helmet;
      add(this.feet, new THREE.CylinderGeometry(0.068, 0.072, 0.16, 12), dark, sx, 0.2, -0.01);
      for (let b = 0; b < 3; b++) add(this.feet, new THREE.BoxGeometry(0.012, 0.018, 0.05), grey, sx + (sx > 0 ? 0.07 : -0.07), 0.12 + b * 0.05, 0.05 - b * 0.03);
    }

    // ---- hips, belt ----
    this.hips = new THREE.Group();
    B.add(this.hips);
    add(this.hips, new THREE.SphereGeometry(0.17, 16, 12), pants, 0, 0, 0, 0, 0, 0, 1.12, 0.85, 0.95);
    add(this.hips, new THREE.TorusGeometry(0.175, 0.022, 6, 22), dark, 0, 0.09, 0, Math.PI / 2, 0, 0, 1.08, 0.92, 1);
    add(this.hips, new THREE.BoxGeometry(0.06, 0.04, 0.02), grey, 0, 0.09, 0.165);

    // ---- torso: puffy quilted jacket ----
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    add(this.torso, new THREE.CapsuleGeometry(0.2, 0.26, 8, 18), jacket, 0, 0.27, 0, 0, 0, 0, 1.12, 1, 0.92);
    // hem and quilt baffles
    add(this.torso, new THREE.TorusGeometry(0.21, 0.035, 8, 22), jacket2, 0, 0.06, 0, Math.PI / 2, 0, 0, 1.12, 0.92, 1);
    for (let i = 0; i < 4; i++) {
      add(this.torso, new THREE.TorusGeometry(0.207 - Math.abs(i - 1.5) * 0.004, 0.024, 6, 22), jacket, 0, 0.14 + i * 0.1, 0, Math.PI / 2, 0, 0, 1.13, 0.93, 1);
    }
    // shoulder yoke
    add(this.torso, new THREE.SphereGeometry(0.21, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), jacket2, 0, 0.41, 0, 0, 0, 0, 1.15, 0.7, 0.95);
    // zip, pocket, logo patch
    add(this.torso, new THREE.BoxGeometry(0.014, 0.42, 0.012), dark, 0, 0.3, 0.188);
    add(this.torso, new THREE.BoxGeometry(0.008, 0.03, 0.02), grey, 0, 0.47, 0.196);
    add(this.torso, new THREE.BoxGeometry(0.1, 0.08, 0.012), jacket2, 0.1, 0.36, 0.18, 0, 0.35);
    add(this.torso, new THREE.BoxGeometry(0.08, 0.004, 0.014), dark, 0.1, 0.395, 0.186, 0, 0.35);
    add(this.torso, new THREE.CircleGeometry(0.022, 10), white, -0.11, 0.37, 0.188, 0, -0.4);
    // collar and hood bunched behind the neck
    add(this.torso, new THREE.CylinderGeometry(0.1, 0.13, 0.1, 16, 1, true), jacket2, 0, 0.56, 0);
    add(this.torso, new THREE.TorusGeometry(0.11, 0.055, 8, 16, Math.PI), jacket, 0, 0.56, -0.03, Math.PI / 2 + 0.3, 0, Math.PI);
    // backpack with straps, side pocket and rolled top
    const bag = add(this.torso, new THREE.CapsuleGeometry(0.13, 0.2, 4, 12), pack, 0, 0.3, -0.21, 0, 0, 0, 1.15, 1, 0.55);
    this.bag = bag;
    add(this.torso, new THREE.CylinderGeometry(0.06, 0.06, 0.3, 12), pack, 0, 0.5, -0.22, 0, 0, Math.PI / 2);
    add(this.torso, new THREE.BoxGeometry(0.2, 0.012, 0.03), dark, 0, 0.27, -0.29);
    add(this.torso, new THREE.BoxGeometry(0.2, 0.012, 0.03), dark, 0, 0.36, -0.29);
    add(this.torso, new THREE.BoxGeometry(0.05, 0.12, 0.06), dark, 0.15, 0.24, -0.22);
    for (const s of [-1, 1]) {
      add(this.torso, new THREE.TorusGeometry(0.17, 0.016, 5, 14, Math.PI * 0.9), dark, s * 0.11, 0.33, -0.01, 0, Math.PI / 2, Math.PI / 2 + 0.25, 1, 1.25, 1.2);
    }
    add(this.torso, new THREE.BoxGeometry(0.2, 0.018, 0.012), dark, 0, 0.3, 0.19);

    // ---- head: helmet, vents, goggles, gaiter ----
    this.head = new THREE.Group();
    this.head.position.y = 0.6;
    this.torso.add(this.head);
    add(this.head, new THREE.CylinderGeometry(0.075, 0.09, 0.09, 14), jacket2, 0, 0.0, 0.01);
    add(this.head, new THREE.SphereGeometry(0.115, 14, 12), dark, 0, 0.08, 0.04);
    add(this.head, new THREE.SphereGeometry(0.14, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), helmet, 0, 0.09, -0.005, -0.15, 0, 0, 1, 1.08, 1.12);
    for (let v = 0; v < 3; v++) add(this.head, new THREE.BoxGeometry(0.018, 0.012, 0.09), dark, (v - 1) * 0.045, 0.235, -0.01, -0.15);
    add(this.head, new THREE.BoxGeometry(0.2, 0.012, 0.05), helmet, 0, 0.17, 0.15, 0.25);
    add(this.head, new THREE.TorusGeometry(0.145, 0.014, 6, 24), dark, 0, 0.115, 0, Math.PI / 2 + 0.12, 0, 0, 1, 1.15, 1);
    add(this.head, new THREE.TorusGeometry(0.05, 0.012, 6, 14), dark, -0.05, 0.115, 0.135, 0, 0, 0, 1.2, 0.85, 1);
    add(this.head, new THREE.TorusGeometry(0.05, 0.012, 6, 14), dark, 0.05, 0.115, 0.135, 0, 0, 0, 1.2, 0.85, 1);
    add(this.head, new THREE.CapsuleGeometry(0.045, 0.1, 4, 12), goggle, 0, 0.115, 0.128, 0, 0, Math.PI / 2, 1, 1, 0.55);

    // ---- arms: puffy sleeves, cuffs, mitts with thumbs ----
    this.arms = [];
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.25, 0.43, 0);
      this.torso.add(shoulder);
      const upper = new THREE.Group();
      shoulder.add(upper);
      upper.add(capsule(0.08, 0.22, jacket));
      add(upper, new THREE.TorusGeometry(0.078, 0.016, 6, 14), jacket2, 0, -0.14, 0, Math.PI / 2);
      const lower = new THREE.Group();
      lower.position.y = -0.3;
      upper.add(lower);
      lower.add(capsule(0.07, 0.2, jacket));
      add(lower, new THREE.CylinderGeometry(0.072, 0.064, 0.06, 12), jacket2, 0, -0.25, 0);
      const mitt = new THREE.Group();
      mitt.position.y = -0.31;
      lower.add(mitt);
      add(mitt, new THREE.SphereGeometry(0.068, 12, 10), mitts, 0, 0, 0, 0, 0, 0, 0.85, 1.25, 0.95);
      add(mitt, new THREE.CapsuleGeometry(0.022, 0.05, 4, 8), mitts, -s * 0.045, 0.01, 0.04, 0.6, 0, s * 0.5);
      add(mitt, new THREE.CylinderGeometry(0.07, 0.07, 0.04, 12), mitts, 0, 0.07, 0);
      const poleMesh = new THREE.Group();
      add(poleMesh, new THREE.CylinderGeometry(0.01, 0.008, 1.12, 6), pole, 0, -0.56, 0);
      add(poleMesh, new THREE.CylinderGeometry(0.02, 0.017, 0.14, 8), dark, 0, 0.0, 0);
      add(poleMesh, new THREE.TorusGeometry(0.035, 0.005, 4, 10), dark, 0, 0.08, 0, 0, Math.PI / 2);
      add(poleMesh, new THREE.CylinderGeometry(0.055, 0.055, 0.008, 12), dark, 0, -1.0, 0);
      add(poleMesh, new THREE.ConeGeometry(0.008, 0.06, 5), grey, 0, -1.14, 0, Math.PI);
      B.add(poleMesh);
      this.arms.push({ s, shoulder, upper, lower, mitt, pole: poleMesh });
    }

    // ---- legs: baggy pants, knee patches, cuffs over boots ----
    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.1, -0.03, 0);
      this.hips.add(hip);
      const upper = new THREE.Group();
      hip.add(upper);
      upper.add(capsule(0.092, 0.34, pants));
      add(upper, new THREE.BoxGeometry(0.07, 0.1, 0.03), pants, s * 0.085, -0.2, 0.01, 0, 0, 0, 1, 1, 1);
      add(upper, new THREE.BoxGeometry(0.004, 0.08, 0.04), dark, s * 0.1, -0.2, 0.01);
      const lower = new THREE.Group();
      lower.position.y = -0.45;
      upper.add(lower);
      lower.add(capsule(0.082, 0.34, pants));
      add(lower, new THREE.SphereGeometry(0.06, 10, 8), jacket2, 0, -0.01, 0.06, 0, 0, 0, 1, 1, 0.45);
      add(lower, new THREE.CylinderGeometry(0.088, 0.105, 0.14, 14), pants, 0, -0.38, 0);
      this.legs.push({ s, hip, upper, lower });
    }

    // ---- paraglider: curved canopy with airfoil cells, cascade lines, risers ----
    this.wing = new THREE.Group();
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
    this.mats.wing = wingMat;
    const SPAN = 64, CH = 10, R = 4.6, ARC = 2.2;
    const wpos = [], widx = [];
    this.wingCells = [];
    // upper and lower skin
    for (const skin of [1, -1]) {
      const off = wpos.length / 3;
      for (let i = 0; i <= SPAN; i++) {
        const u = i / SPAN;
        const a = (u - 0.5) * ARC;
        const chordK = Math.sqrt(1 - Math.pow((u - 0.5) * 2, 2) * 0.75);
        const cellBulge = Math.abs(Math.sin(u * Math.PI * 16)) * 0.035;
        for (let j = 0; j <= CH; j++) {
          const v = j / CH;
          const chord = 2.5 * chordK;
          const z = 1.1 * chordK - v * chord + 0.3;
          const thick = (skin > 0 ? 0.13 + cellBulge : -0.05) * Math.sin(Math.PI * Math.pow(v, 0.7)) * chordK;
          const r = R + thick;
          wpos.push(Math.sin(a) * r, Math.cos(a) * r - R + 6.3 - v * 0.15, z);
          this.wingCells.push(Math.floor(u * 16) % 2, u, v);
        }
      }
      for (let i = 0; i < SPAN; i++) for (let j = 0; j < CH; j++) {
        const a = off + i * (CH + 1) + j, b = a + CH + 1;
        widx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
    wg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(wpos.length), 3));
    wg.setIndex(widx);
    wg.computeVertexNormals();
    this.wingGeo = wg;
    add(this.wing, wg, wingMat);
    // lines: canopy -> cascades -> risers at the shoulders
    const lines = [];
    const riser = (s) => [s * 0.22, 1.3, 0.02];
    for (const s of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const mid = [s * (0.6 + k * 0.7), 3.6 + k * 0.1, 0.4 - k * 0.15];
        lines.push(...riser(s), ...mid);
        for (let m = 0; m < 3; m++) {
          const u = 0.5 + s * (0.06 + (k * 3 + m) * 0.035);
          const a = (u - 0.5) * ARC;
          const zz = 0.7 - m * 0.6;
          lines.push(...mid, Math.sin(a) * (R - 0.05), Math.cos(a) * (R - 0.05) - R + 6.25, zz);
        }
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.wing.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#e8e8f0', transparent: true, opacity: 0.55 })));
    for (const s of [-1, 1]) add(this.wing, new THREE.BoxGeometry(0.03, 0.4, 0.02), dark, s * 0.22, 1.12, 0.02);
    this.wing.visible = false;
    this.wing.scale.setScalar(0.01);
    this.root.add(this.wing);

    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  setOutfit(o) {
    for (const k of ['jacket', 'jacket2', 'pants', 'helmet', 'skis', 'mitts', 'pack']) this.mats[k].color.set(o[k]);
    // canopy: two-tone cells with a light leading edge band
    const c1 = new THREE.Color(o.jacket), c2 = new THREE.Color(o.jacket2), lite = new THREE.Color('#f2f2f6');
    const col = this.wingGeo.attributes.color;
    const tmp = new THREE.Color();
    for (let i = 0; i < col.count; i++) {
      const cell = this.wingCells[i * 3], u = this.wingCells[i * 3 + 1], v = this.wingCells[i * 3 + 2];
      tmp.copy(cell ? c1 : c2);
      if (v < 0.12) tmp.lerp(lite, 0.6);
      if (Math.abs(u - 0.5) > 0.44) tmp.copy(c2).multiplyScalar(0.7);
      col.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    col.needsUpdate = true;
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
