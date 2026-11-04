// The skier: a small hierarchical rig built from primitives, posed
// procedurally (crouch, lean, arms, grab, tumble) plus a paraglider wing.
import * as THREE from 'three';
import { stylize } from '../shading.js';

export const OUTFITS = [
  { name: 'Красный', jacket: '#e8382a', stripe: '#ffffff', pants: '#1b1d2e', helmet: '#f4f4f8', goggles: '#ffb03a', skis: '#e8382a', pack: '#2a2c40', wing: '#1f7a74' },
  { name: 'Лазурь', jacket: '#22c7d8', stripe: '#f6e23a', pants: '#14162a', helmet: '#f6e23a', goggles: '#3a5cff', skis: '#22c7d8', pack: '#14162a', wing: '#f6a23a' },
  { name: 'Панда', jacket: '#f2f2f4', stripe: '#121218', pants: '#121218', helmet: '#121218', goggles: '#ff3a8a', skis: '#ff3a8a', pack: '#121218', wing: '#2a2a3a' },
  { name: 'Хвоя', jacket: '#1ea86a', stripe: '#0e1a16', pants: '#0e1a16', helmet: '#0e1a16', goggles: '#ffcf3a', skis: '#0e1a16', pack: '#0e1a16', wing: '#1ea86a' },
];

const L1 = 0.46; // thigh
const L2 = 0.46; // shin

function mat(color, opts = {}) {
  return stylize(new THREE.MeshLambertMaterial({ color, ...opts }), { rim: 0.35 });
}
function mesh(geo, material, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function capsule(r, len) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 8);
  g.translate(0, -len / 2 - r * 0.3, 0); // hangs down from its pivot
  return g;
}

function skiGeometry() {
  const g = new THREE.BoxGeometry(0.11, 0.03, 1.8, 1, 1, 12);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    if (z > 0.6) p.setY(i, p.getY(i) + Math.pow((z - 0.6) / 0.3, 2) * 0.09); // tip
    if (z < -0.75) p.setY(i, p.getY(i) + Math.pow((-z - 0.75) / 0.15, 2) * 0.02); // tail
  }
  g.computeVertexNormals();
  return g;
}

export class Rider {
  constructor() {
    this.mats = {
      jacket: mat('#e8382a'), stripe: mat('#ffffff'), pants: mat('#1b1d2e'), helmet: mat('#ffffff'),
      goggles: mat('#ffb03a', { emissive: new THREE.Color('#ff8a1a'), emissiveIntensity: 0.25 }),
      skis: mat('#e8382a'), pack: mat('#2a2c40'), glove: mat('#14141c'), boot: mat('#20222e'),
      pole: mat('#c8ccd8'), wing: stylize(new THREE.MeshLambertMaterial({ color: '#1f7a74', side: THREE.DoubleSide }), { rim: 0.2 }),
      line: new THREE.LineBasicMaterial({ color: '#202030', transparent: true, opacity: 0.55 }),
    };
    const M = this.mats;

    this.root = new THREE.Group();     // feet on the ground, oriented to slope + heading
    this.lean = new THREE.Group();     // turn lean (roll)
    this.pivot = new THREE.Group();    // centre of mass for spins and flips
    this.pivot.position.y = 0.9;
    this.body = new THREE.Group();
    this.body.position.y = -0.9;
    this.root.add(this.lean);
    this.lean.add(this.pivot);
    this.pivot.add(this.body);

    // skis + boots
    this.skis = new THREE.Group();
    this.body.add(this.skis);
    const sg = skiGeometry();
    this.skiL = mesh(sg, M.skis, this.skis, -0.14, 0.02, 0.05);
    this.skiR = mesh(sg, M.skis, this.skis, 0.14, 0.02, 0.05);

    // pelvis (moves down when crouching)
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = 0.92;
    this.body.add(this.pelvis);
    mesh(new THREE.BoxGeometry(0.34, 0.2, 0.22), M.pants, this.pelvis, 0, 0, 0);

    // legs: hip → knee → ankle
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.12, -0.04, 0);
      this.pelvis.add(hip);
      mesh(capsule(0.085, L1 - 0.1), M.pants, hip);
      const knee = new THREE.Group();
      knee.position.y = -L1;
      hip.add(knee);
      mesh(capsule(0.075, L2 - 0.12), M.pants, knee);
      const boot = mesh(new THREE.BoxGeometry(0.15, 0.16, 0.3), M.boot, knee, 0, -L2 + 0.04, 0.03);
      this.legs.push({ hip, knee, boot, side });
    }

    // torso
    this.torso = new THREE.Group();
    this.torso.position.y = 0.06;
    this.pelvis.add(this.torso);
    const chest = mesh(new THREE.CapsuleGeometry(0.19, 0.32, 4, 10), M.jacket, this.torso, 0, 0.3, 0);
    chest.scale.set(1, 1, 0.78);
    mesh(new THREE.BoxGeometry(0.4, 0.06, 0.32), M.stripe, this.torso, 0, 0.3, 0).scale.set(1, 1, 0.92);
    mesh(new THREE.BoxGeometry(0.3, 0.36, 0.14), M.pack, this.torso, 0, 0.36, -0.2);
    // head
    this.head = new THREE.Group();
    this.head.position.y = 0.68;
    this.torso.add(this.head);
    mesh(new THREE.SphereGeometry(0.16, 14, 10), M.helmet, this.head, 0, 0.06, 0).scale.set(1, 1.02, 1.08);
    mesh(new THREE.BoxGeometry(0.24, 0.08, 0.08), M.goggles, this.head, 0, 0.03, 0.14);

    // arms: shoulder → elbow → hand (+ pole)
    this.arms = [];
    for (const side of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(side * 0.24, 0.5, 0);
      this.torso.add(sh);
      mesh(capsule(0.07, 0.22), M.jacket, sh);
      const el = new THREE.Group();
      el.position.y = -0.32;
      sh.add(el);
      mesh(capsule(0.06, 0.2), M.jacket, el);
      const hand = mesh(new THREE.SphereGeometry(0.07, 8, 6), M.glove, el, 0, -0.32, 0);
      const pole = new THREE.Group();
      pole.position.y = -0.32;
      el.add(pole);
      mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.25, 5).translate(0, -0.55, 0), M.pole, pole);
      mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 8).translate(0, -1.08, 0), M.pole, pole);
      this.arms.push({ sh, el, hand, pole, side });
    }

    // paraglider wing (hidden until deployed)
    this.wing = new THREE.Group();
    this.wing.visible = false;
    this.pivot.add(this.wing);
    const wg = new THREE.PlaneGeometry(9, 2.4, 24, 2);
    const wp = wg.attributes.position;
    for (let i = 0; i < wp.count; i++) {
      const x = wp.getX(i), y = wp.getY(i);
      const a = (x / 9) * 1.9;
      wp.setXYZ(i, Math.sin(a) * 4.6, Math.cos(a) * 4.6 - 4.6 + 0.25 * (1 - Math.abs(y) / 1.2), y);
    }
    wg.computeVertexNormals();
    const wingMesh = mesh(wg, M.wing, this.wing, 0, 0, 0);
    wingMesh.position.set(0, 4.4, 0.4);
    const lineGeo = new THREE.BufferGeometry();
    const lp = [];
    for (let i = 0; i <= 8; i++) {
      const a = ((i / 8) - 0.5) * 1.9;
      for (const z of [-0.8, 0.9]) lp.push(0, 0.6, 0, Math.sin(a) * 4.6, 4.4 + Math.cos(a) * 4.6 - 4.6, 0.4 + z);
    }
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    this.wing.add(new THREE.LineSegments(lineGeo, M.line));
    this.wingOpen = 0;

    // pose state (smoothed)
    this.pose = { crouch: 0.2, lean: 0, arms: 0, grab: 0, tumble: 0, skiSpread: 0, look: 0, wing: 0 };
    this.target = { ...this.pose };
    this.time = 0;
    this.setOutfit(0);
  }

  setOutfit(i) {
    const o = OUTFITS[((i % OUTFITS.length) + OUTFITS.length) % OUTFITS.length];
    const M = this.mats;
    M.jacket.color.set(o.jacket);
    M.stripe.color.set(o.stripe);
    M.pants.color.set(o.pants);
    M.helmet.color.set(o.helmet);
    M.goggles.color.set(o.goggles);
    M.goggles.emissive.set(o.goggles);
    M.skis.color.set(o.skis);
    M.pack.color.set(o.pack);
    M.wing.color.set(o.wing);
    return o;
  }

  /** First-person: hide everything but skis, arms and poles. */
  setFirstPerson(on) {
    this.pelvis.children[0].visible = !on;
    for (const l of this.legs) l.hip.visible = !on;
    this.torso.children.forEach((c) => { if (c !== this.head) c.visible = !on; });
    this.head.visible = !on;
    for (const a of this.arms) a.sh.children[0].visible = !on;
  }

  update(dt) {
    this.time += dt;
    const p = this.pose, t = this.target;
    const k = 1 - Math.exp(-dt * 10);
    for (const key of Object.keys(p)) p[key] += (t[key] - p[key]) * (key === 'tumble' ? 1 - Math.exp(-dt * 4) : k);

    // legs: two-bone IK for a hip height that drops with crouch
    const H = THREE.MathUtils.lerp(0.9, 0.52, THREE.MathUtils.clamp(p.crouch, 0, 1));
    this.pelvis.position.y = H + 0.04;
    this.pelvis.position.z = -0.06 * p.crouch;
    for (const l of this.legs) {
      const D = Math.min(H - 0.02 + (l.side * p.skiSpread * 0.05), L1 + L2 - 0.001);
      const a1 = Math.acos(THREE.MathUtils.clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
      const a2 = Math.acos(THREE.MathUtils.clamp((L2 * L2 + D * D - L1 * L1) / (2 * L2 * D), -1, 1));
      l.hip.rotation.x = -a1 + p.grab * 0.6;
      l.knee.rotation.x = a1 + a2 - p.grab * 0.4;
      l.boot.rotation.x = -a2 + 0.15;
      l.hip.rotation.z = l.side * 0.04;
    }
    // skis pulled up when grabbing
    this.skis.position.y = p.grab * 0.35;
    this.skis.position.z = p.grab * 0.05;
    this.skiL.position.x = -0.14 - p.skiSpread * 0.08;
    this.skiR.position.x = 0.14 + p.skiSpread * 0.08;

    // torso leans forward when crouching, a little into the turn
    this.torso.rotation.x = 0.15 + p.crouch * 0.55 + p.grab * 0.5;
    this.torso.rotation.z = -p.lean * 0.25;
    this.head.rotation.x = -this.torso.rotation.x * 0.7;
    this.head.rotation.y = p.look * 0.5;

    // arms: forward with poles while riding, spread in the air, down to the skis on a grab
    for (const a of this.arms) {
      const s = a.side;
      const flail = Math.sin(this.time * 9 + s) * p.tumble;
      a.sh.rotation.x = THREE.MathUtils.lerp(-0.55, -0.2, p.arms) - p.grab * 0.7 + flail;
      a.sh.rotation.z = s * THREE.MathUtils.lerp(0.25, 1.2, p.arms) + s * p.tumble * 0.8;
      a.el.rotation.x = THREE.MathUtils.lerp(-0.9, -0.25, p.arms) + p.grab * 0.3;
      a.pole.rotation.x = THREE.MathUtils.lerp(-0.35, 0.9, p.arms * 0.6 + p.grab * 0.4);
      a.pole.rotation.z = -s * 0.1;
      if (p.wing > 0.5) { a.sh.rotation.x = -2.6; a.sh.rotation.z = s * 0.35; a.el.rotation.x = -0.2; }
    }
    this.lean.rotation.z = -p.lean * 0.55;
    this.wing.visible = p.wing > 0.05;
    this.wing.scale.setScalar(Math.max(0.05, p.wing));
  }
}
