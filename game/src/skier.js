// The rider: an original character built from primitives, posed every frame
// with two-bone IK (legs, arms), a simulated scarf and a paraglider.
import * as THREE from '../vendor/three.module.js';
import { makeToonMaterial } from './materials.js';
import { lerp, clamp } from './noise.js';

export const OUTFITS = [
  { name: 'Горчица', jacket: '#e2a93b', pants: '#243457', hat: '#c8423a', scarf: '#2f8f83', ski: '#ff5b3d', mitt: '#2a2d36', pack: '#3e4b3a' },
  { name: 'Бирюза', jacket: '#2a9d8f', pants: '#2d2f36', hat: '#f08a3c', scarf: '#f2d46b', ski: '#f2f2f2', mitt: '#f08a3c', pack: '#22313f' },
  { name: 'Сирень', jacket: '#f2f0fa', pants: '#6b5ca5', hat: '#6b5ca5', scarf: '#e86a92', ski: '#4a63d8', mitt: '#6b5ca5', pack: '#e86a92' },
  { name: 'Коралл', jacket: '#ef6f5e', pants: '#4b5a3a', hat: '#f4e6c8', scarf: '#2d3e70', ski: '#f2c14e', mitt: '#2d3e70', pack: '#f4e6c8' },
  { name: 'Ночь', jacket: '#1f2333', pants: '#1f2333', hat: '#57d0c4', scarf: '#57d0c4', ski: '#57d0c4', mitt: '#57d0c4', pack: '#3a3f55' },
];

const Y = new THREE.Vector3(0, 1, 0);

function limbGeo(r0, r1, segs = 7) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, segs, 1, false);
  g.translate(0, 0.5, 0);
  return g;
}

export class Skier {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'rider';
    scene.add(this.root);
    this.mats = {
      jacket: makeToonMaterial({ rim: 0.45 }),
      pants: makeToonMaterial({ rim: 0.35 }),
      hat: makeToonMaterial({ rim: 0.4 }),
      scarf: makeToonMaterial({ rim: 0.35 }),
      ski: makeToonMaterial({ rim: 0.3, gloss: 0.6 }),
      mitt: makeToonMaterial({ rim: 0.3 }),
      pack: makeToonMaterial({ rim: 0.3 }),
      skin: makeToonMaterial({ color: '#e9b48f', rim: 0.25 }),
      dark: makeToonMaterial({ color: '#23252d', rim: 0.25 }),
      goggle: makeToonMaterial({ color: '#ffb347', rim: 0.8, gloss: 2.5 }),
      pole: makeToonMaterial({ color: '#c9ccd6', rim: 0.3, gloss: 0.8 }),
    };
    this.mats.scarf.side = THREE.DoubleSide;
    const m = this.mats;
    const add = (geo, mat, parent = this.root) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // --- skis (local: forward = -Z)
    const skiGeo = new THREE.BoxGeometry(0.11, 0.03, 1.78, 1, 1, 12);
    const sp = skiGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const z = sp.getZ(i);
      if (z < -0.6) sp.setY(i, sp.getY(i) + (z + 0.6) * (z + 0.6) * 0.42);
      if (z > 0.8) sp.setY(i, sp.getY(i) + (z - 0.8) * (z - 0.8) * 0.5);
    }
    skiGeo.computeVertexNormals();
    this.skis = [];
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 0.13, 0.03, 0.05);
      add(skiGeo, m.ski, g);
      const binding = add(new THREE.BoxGeometry(0.1, 0.06, 0.32), m.dark, g);
      binding.position.set(0, 0.04, 0.05);
      this.root.add(g);
      this.skis.push(g);
    }
    // boots
    const bootGeo = new THREE.BoxGeometry(0.14, 0.2, 0.3);
    bootGeo.translate(0, 0.1, -0.02);
    this.boots = [-1, 1].map(() => add(bootGeo, m.dark));

    // --- legs and arms (unit-length limbs, stretched between joints)
    this.thighs = [0, 1].map(() => add(limbGeo(0.085, 0.075), m.pants));
    this.shins = [0, 1].map(() => add(limbGeo(0.07, 0.06), m.pants));
    this.knees = [0, 1].map(() => add(new THREE.SphereGeometry(0.078, 8, 6), m.pants));
    this.uArms = [0, 1].map(() => add(limbGeo(0.06, 0.055), m.jacket));
    this.fArms = [0, 1].map(() => add(limbGeo(0.055, 0.05), m.jacket));
    this.elbows = [0, 1].map(() => add(new THREE.SphereGeometry(0.06, 8, 6), m.jacket));
    this.mitts = [0, 1].map(() => add(new THREE.SphereGeometry(0.065, 8, 6), m.mitt));
    this.poles = [0, 1].map(() => {
      const g = new THREE.Group();
      const shaft = add(limbGeo(0.011, 0.011, 5), m.pole, g);
      shaft.scale.y = 1.18;
      const basket = add(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 8), m.dark, g);
      basket.position.y = 1.05;
      this.root.add(g);
      return g;
    });

    // --- torso, head
    this.pelvis = add(new THREE.SphereGeometry(0.15, 10, 8), m.pants);
    this.pelvis.scale.set(1.15, 0.8, 0.9);
    this.chest = new THREE.Group();
    this.root.add(this.chest);
    const torso = add(new THREE.CapsuleGeometry(0.17, 0.28, 4, 10), m.jacket, this.chest);
    torso.position.y = 0.24;
    torso.scale.set(1.12, 1, 0.82);
    const collar = add(new THREE.TorusGeometry(0.1, 0.045, 6, 12), m.scarf, this.chest);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.5;
    const pack = add(new THREE.BoxGeometry(0.28, 0.36, 0.14), m.pack, this.chest);
    pack.position.set(0, 0.28, 0.17);
    const packTop = add(new THREE.CapsuleGeometry(0.07, 0.18, 3, 8), m.pack, this.chest);
    packTop.rotation.z = Math.PI / 2;
    packTop.position.set(0, 0.47, 0.17);
    const strapGeo = new THREE.BoxGeometry(0.035, 0.36, 0.02);
    const straps = [];
    for (const s of [-1, 1]) {
      const st = add(strapGeo, m.dark, this.chest);
      st.position.set(s * 0.09, 0.3, -0.15);
      straps.push(st);
    }
    this.head = new THREE.Group();
    this.chest.add(this.head);
    this.head.position.y = 0.62;
    const face = add(new THREE.SphereGeometry(0.12, 12, 10), m.skin, this.head);
    face.scale.set(0.95, 1.05, 1);
    const hat = add(new THREE.SphereGeometry(0.128, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), m.hat, this.head);
    hat.position.y = 0.012;
    const cuff = add(new THREE.TorusGeometry(0.118, 0.03, 6, 14), m.hat, this.head);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = 0.02;
    this.pompom = add(new THREE.IcosahedronGeometry(0.055, 1), m.hat, this.head);
    this.pompom.position.y = 0.16;
    const strap = add(new THREE.TorusGeometry(0.122, 0.022, 5, 16), m.dark, this.head);
    strap.rotation.x = Math.PI / 2 - 0.15;
    strap.position.y = 0.0;
    const lens = add(new THREE.SphereGeometry(0.075, 12, 6, -0.9, 1.8, 1.05, 0.65), m.goggle, this.head);
    lens.rotation.y = Math.PI;
    lens.scale.set(1.35, 1.0, 1.0);
    lens.position.set(0, 0.04, -0.06);
    this.firstPersonHidden = [torso, collar, pack, packTop, face, hat, cuff, this.pompom, strap, lens, this.pelvis, ...straps];

    // --- scarf (verlet ribbon)
    this.scarfN = 9;
    this.scarfPts = Array.from({ length: this.scarfN }, () => new THREE.Vector3());
    this.scarfPrev = Array.from({ length: this.scarfN }, () => new THREE.Vector3());
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.scarfN * 2 * 3), 3));
    sg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.scarfN * 2 * 3), 3));
    const idx = [];
    for (let i = 0; i < this.scarfN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    sg.setIndex(idx);
    this.scarf = new THREE.Mesh(sg, m.scarf);
    this.scarf.frustumCulled = false;
    this.scarf.castShadow = true;
    scene.add(this.scarf);
    this.scarfInit = false;

    // --- paraglider
    this.glider = this.makeGlider();
    this.root.add(this.glider);
    this.gliderAmt = 0;

    this.setOutfit(0);
    this.tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4() };
    this.pomVel = new THREE.Vector3();
    this.pomOff = new THREE.Vector3();
    this.flail = 0;
    this.time = 0;
  }

  makeGlider() {
    const g = new THREE.Group();
    const span = 9, chord = 2.4, segs = 18;
    const pos = [], col = [], idx = [];
    const cA = new THREE.Color('#ff6a3d'), cB = new THREE.Color('#fff4e0'), cC = new THREE.Color('#2b4c9a');
    for (let i = 0; i <= segs; i++) {
      const u = i / segs - 0.5;
      const ang = u * 2.1;
      const r = 5.2;
      const x = Math.sin(ang) * r, y = Math.cos(ang) * r;
      const c = i % 6 < 2 ? cA : i % 6 < 4 ? cB : cC;
      for (let j = 0; j <= 4; j++) {
        const v = j / 4;
        const ch = chord * (1 - Math.abs(u) * 0.6);
        const z = -ch * 0.6 + v * ch;
        const thick = Math.sin(v * Math.PI) * 0.18 * (1 - Math.abs(u));
        pos.push(x * (1 + thick * 0.1), y + thick, z);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < segs; i++) for (let j = 0; j < 4; j++) {
      const a = i * 5 + j, b = a + 1, c = a + 5, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = makeToonMaterial({ vertexColors: true, rim: 0.5 });
    mat.side = THREE.DoubleSide;
    const wing = new THREE.Mesh(geo, mat);
    wing.castShadow = true;
    wing.position.y = 1.4;
    g.add(wing);
    // lines
    const lp = [];
    for (let i = 0; i <= segs; i += 2) {
      const u = i / segs - 0.5, ang = u * 2.1;
      const x = Math.sin(ang) * 5.2, y = Math.cos(ang) * 5.2 + 1.4;
      lp.push(x, y, 0, Math.sign(x) * 0.18, 1.35, 0.05);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x222233, transparent: true, opacity: 0.6 }));
    g.add(lines);
    g.visible = false;
    g.scale.setScalar(0.01);
    return g;
  }

  setOutfit(i) {
    const o = OUTFITS[i % OUTFITS.length];
    this.outfit = i % OUTFITS.length;
    this.mats.jacket.uniforms.uColor.value.set(o.jacket);
    this.mats.pants.uniforms.uColor.value.set(o.pants);
    this.mats.hat.uniforms.uColor.value.set(o.hat);
    this.mats.scarf.uniforms.uColor.value.set(o.scarf);
    this.mats.ski.uniforms.uColor.value.set(o.ski);
    this.mats.mitt.uniforms.uColor.value.set(o.mitt);
    this.mats.pack.uniforms.uColor.value.set(o.pack);
    return o.name;
  }

  setFirstPerson(fp) {
    if (this.fp === fp) return;
    for (const o of this.firstPersonHidden) o.visible = !fp;
    for (const o of [...this.thighs, ...this.shins, ...this.knees, ...this.uArms, ...this.elbows, ...this.poles]) o.visible = !fp;
    this.scarf.visible = !fp;
    this.fp = fp;
  }

  /** Place a unit limb mesh from a to b (root-local). */
  limb(mesh, a, b, rScale = 1) {
    const d = this.tmp.d.subVectors(b, a);
    const len = d.length();
    mesh.position.copy(a);
    mesh.quaternion.setFromUnitVectors(Y, d.multiplyScalar(1 / (len || 1)));
    mesh.scale.set(rScale, len, rScale);
  }

  /** Two-bone IK. Writes the middle joint into `out`. */
  ik(a, c, l1, l2, bendHint, out) {
    const d = this.tmp.c.subVectors(c, a);
    let D = d.length();
    D = clamp(D, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    d.normalize();
    const x = (l1 * l1 - l2 * l2 + D * D) / (2 * D);
    const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    const bend = this.tmp.b.copy(bendHint).addScaledVector(d, -bendHint.dot(d)).normalize();
    return out.copy(a).addScaledVector(d, x).addScaledVector(bend, h);
  }

  update(dt, pl, cam) {
    this.time += dt;
    const root = this.root;
    const crash = pl.mode === 'crash';
    // ---------------------------------------------------------- root transform
    const fwd = new THREE.Vector3(-Math.sin(pl.yaw), 0, -Math.cos(pl.yaw));
    let up = new THREE.Vector3(0, 1, 0);
    if (!pl.inAir && !pl.gliding && pl.mode !== 'grind') up.copy(pl.normal).lerp(Y, 0.25).normalize();
    // forward projected on the up plane
    const f = fwd.clone().addScaledVector(up, -fwd.dot(up)).normalize();
    const right = new THREE.Vector3().crossVectors(f, up).normalize();
    const basis = new THREE.Matrix4().makeBasis(right, up, f.clone().negate());
    const q = new THREE.Quaternion().setFromRotationMatrix(basis);
    // lean into the carve (roll around the travel axis)
    const leanQ = new THREE.Quaternion().setFromAxisAngle(f, -pl.lean);
    q.premultiply(leanQ);
    // flips around the rider's right axis
    if (pl.inAir || pl.gliding) {
      const flipQ = new THREE.Quaternion().setFromAxisAngle(right, -pl.flip);
      q.premultiply(flipQ);
    }
    if (crash && pl.tumble) {
      const tq = new THREE.Quaternion().setFromAxisAngle(pl.tumble.axis, pl.tumble.a);
      q.premultiply(tq);
    }
    root.quaternion.slerp(q, crash ? 1 : 1 - Math.exp(-dt * 30));
    root.position.copy(pl.pos);
    const sink = crash ? 0.2 : pl.sink * (this.fp ? 0.15 : 1);
    root.position.addScaledVector(up, -sink * 0.85);
    if (pl.inAir && !pl.gliding) root.position.y += 0.05;
    root.updateMatrixWorld();

    // ---------------------------------------------------------- pose (root-local, forward = -Z)
    const c = pl.crouch;
    const grab = pl.grab;
    const t = this.time;
    this.flail = crash ? 1 : Math.max(0, this.flail - dt * 2);
    const hipY = 0.98 - c * 0.43;
    const hipZ = 0.1 * c + 0.03;
    const pelvis = new THREE.Vector3(0, hipY, hipZ);
    // grabs tuck the knees up
    const kneeLift = grab * 0.25;
    const ank = [new THREE.Vector3(-0.13, 0.13, 0.03), new THREE.Vector3(0.13, 0.13, 0.03)];
    if (pl.inAir) {
      // pull skis up under the body in the air
      for (const a of ank) { a.y += 0.12 + kneeLift; }
    }
    // skis follow the ankles
    for (let i = 0; i < 2; i++) {
      const s = this.skis[i];
      s.position.set(ank[i].x, ank[i].y - 0.1, ank[i].z + 0.02);
      s.rotation.set(0, 0, 0);
      if (pl.inAir && grab > 0.1) {
        if (pl.grabKind === 'nose') s.rotation.x = -0.35 * grab;
        if (pl.grabKind === 'tail') s.rotation.x = 0.35 * grab;
        if (pl.grabKind === 'mute') s.rotation.y = (i ? -1 : 1) * 0.25 * grab;
      }
      if (crash) { s.rotation.y = Math.sin(t * 7 + i) * 0.6; s.rotation.x = Math.cos(t * 5 + i) * 0.4; }
      this.boots[i].position.set(ank[i].x, ank[i].y - 0.1, ank[i].z);
      this.boots[i].rotation.copy(s.rotation);
    }
    // legs
    const fwdHint = new THREE.Vector3(0, 0.15, -1);
    for (let i = 0; i < 2; i++) {
      const hip = new THREE.Vector3((i ? 1 : -1) * 0.1, hipY, hipZ);
      const knee = this.ik(hip, ank[i], 0.47, 0.47, fwdHint, new THREE.Vector3());
      if (crash) knee.x += Math.sin(t * 9 + i * 2) * 0.12;
      this.limb(this.thighs[i], hip, knee);
      this.limb(this.shins[i], knee, ank[i]);
      this.knees[i].position.copy(knee);
    }
    this.pelvis.position.copy(pelvis);

    // torso: lean forward with crouch, counter-rotate against the turn
    const pitch = 0.22 + c * 0.55 + (pl.tuck || 0) * 0.25;
    const twist = clamp(-pl.yawRate * 0.12, -0.35, 0.35) + (pl.inAir ? clamp(pl.spinVel * 0.04, -0.3, 0.3) : 0);
    const side = clamp(pl.lean * 0.3, -0.3, 0.3);
    this.chest.position.copy(pelvis).add(new THREE.Vector3(0, 0.05, -0.02));
    this.chest.rotation.set(-pitch, twist, side, 'YXZ');
    if (crash) this.chest.rotation.x += Math.sin(t * 6) * 0.5;
    this.chest.updateMatrix();
    // head looks along the travel direction
    this.head.rotation.set(pitch * 0.75 - 0.1, -twist * 0.6, 0);

    // shoulders in root space
    const cm = this.chest.matrix;
    const sh = [new THREE.Vector3(-0.21, 0.44, 0.0).applyMatrix4(cm), new THREE.Vector3(0.21, 0.44, 0.0).applyMatrix4(cm)];
    // hand targets
    const hands = [];
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      const h = new THREE.Vector3(s * 0.36, hipY + 0.12 - c * 0.05, -0.32 - c * 0.12);
      if (pl.pole > 0 && pl.poleSide === s) h.add(new THREE.Vector3(0, -0.08, -0.22).multiplyScalar(Math.sin(pl.pole * Math.PI)));
      if (pl.inAir && grab > 0.05) {
        let g;
        if (pl.grabKind === 'nose') g = new THREE.Vector3(s * 0.05, 0.25, -0.55);
        else if (pl.grabKind === 'tail') g = new THREE.Vector3(s * 0.12, 0.25, 0.5);
        else if (pl.grabKind === 'mute') g = new THREE.Vector3(-s * 0.1, 0.24, -0.15);
        else g = new THREE.Vector3(s * 0.16, 0.24, -0.05);
        if (i === 1 || pl.grabKind === 'nose' || pl.grabKind === 'tail') h.lerp(g, grab);
        else h.lerp(new THREE.Vector3(-0.45, hipY + 0.45, 0), grab * 0.8);
      }
      if (pl.gliding) h.set(s * 0.32, hipY + 0.75, -0.05);
      if (crash || this.flail > 0) h.add(new THREE.Vector3(Math.sin(t * 11 + i) * 0.3, Math.cos(t * 13 + i) * 0.3, Math.sin(t * 7 + i) * 0.2).multiplyScalar(this.flail));
      if (pl.inAir && !pl.gliding && grab < 0.05) h.y += 0.15 + Math.sin(t * 3 + i) * 0.02; // arms out for balance
      hands.push(h);
    }
    const elbowHint = new THREE.Vector3(0, -0.6, 0.6);
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      elbowHint.x = s * 0.8;
      const el = this.ik(sh[i], hands[i], 0.29, 0.29, elbowHint, new THREE.Vector3());
      this.limb(this.uArms[i], sh[i], el);
      this.limb(this.fArms[i], el, hands[i]);
      this.elbows[i].position.copy(el);
      this.mitts[i].position.copy(hands[i]);
      // poles trail back-down, or plant forward
      const pole = this.poles[i];
      pole.position.copy(hands[i]);
      const dir = new THREE.Vector3(s * 0.12, -1, 0.75);
      if (pl.pole > 0 && pl.poleSide === s) dir.lerp(new THREE.Vector3(s * 0.05, -1, -0.15), Math.sin(pl.pole * Math.PI));
      if (pl.inAir) dir.set(s * 0.35, -0.6, 0.9);
      if (pl.gliding) dir.set(s * 0.15, -0.5, 1.0);
      pole.quaternion.setFromUnitVectors(Y, dir.normalize().negate());
      pole.rotateX(Math.PI);
    }

    // pompom spring
    const pomTarget = new THREE.Vector3(0, 0.16, 0);
    const acc = new THREE.Vector3().copy(pl.vel).multiplyScalar(-0.002);
    this.pomVel.addScaledVector(this.pomOff, -120 * dt).addScaledVector(acc, 1).multiplyScalar(Math.exp(-dt * 6));
    this.pomOff.addScaledVector(this.pomVel, dt);
    this.pomOff.clampLength(0, 0.05);
    this.pompom.position.copy(pomTarget).add(this.pomOff);

    // glider deploy/stow
    this.gliderAmt = lerp(this.gliderAmt, pl.gliding ? 1 : 0, 1 - Math.exp(-dt * (pl.gliding ? 4 : 8)));
    this.glider.visible = this.gliderAmt > 0.02;
    this.glider.scale.setScalar(Math.max(0.01, this.gliderAmt));
    this.glider.rotation.z = -pl.bank * 0.3;

    root.updateMatrixWorld(true);
    this.updateScarf(dt, pl);
  }

  /** World-space position of the head (for the first-person camera). */
  headWorld(out) { return this.head.getWorldPosition(out); }

  updateScarf(dt, pl) {
    const n = this.scarfN;
    const anchor = this.tmp.a.set(0, 0.52, 0.12).applyMatrix4(this.chest.matrixWorld);
    const P = this.scarfPts, Q = this.scarfPrev;
    if (!this.scarfInit || dt > 0.2 || anchor.distanceTo(P[0]) > 3) {
      for (let i = 0; i < n; i++) { P[i].copy(anchor); P[i].z += i * 0.08; Q[i].copy(P[i]); }
      this.scarfInit = true;
    }
    const seg = 0.085;
    const side = this.tmp.d.set(1, 0, 0).applyQuaternion(this.root.quaternion);
    const spd = Math.min(pl.vel.length(), 30);
    const sub = 3;
    const h = Math.min(dt, 0.033) / sub;
    for (let s = 0; s < sub; s++) {
      P[0].copy(anchor);
      const damp = 1 - 2.5 * h;
      for (let i = 1; i < n; i++) {
        const p = P[i], q = Q[i];
        const vx = (p.x - q.x) * damp, vy = (p.y - q.y) * damp, vz = (p.z - q.z) * damp;
        q.copy(p);
        const fl = Math.sin(this.time * 23 + i * 1.3) * spd * 2.5 * (i / n);
        p.x += vx + side.x * fl * h * h;
        p.y += vy - 9.8 * h * h + fl * 0.3 * h * h;
        p.z += vz + side.z * fl * h * h;
      }
      for (let it = 0; it < 3; it++) {
        P[0].copy(anchor);
        for (let i = 1; i < n; i++) {
          const a = P[i - 1], b = P[i];
          const d = this.tmp.c.subVectors(b, a);
          const l = d.length() || 1e-4;
          const corr = (l - seg) / l;
          if (i === 1) b.addScaledVector(d, -corr);
          else { a.addScaledVector(d, corr * 0.5); b.addScaledVector(d, -corr * 0.5); }
        }
      }
    }
    // ribbon
    const pos = this.scarf.geometry.attributes.position;
    const nor = this.scarf.geometry.attributes.normal;
    for (let i = 0; i < n; i++) {
      const w = 0.06 * (1 - i / n * 0.3);
      const p = P[i];
      pos.setXYZ(i * 2, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
      pos.setXYZ(i * 2 + 1, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      nor.setXYZ(i * 2, 0, 1, 0); nor.setXYZ(i * 2 + 1, 0, 1, 0);
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    this.scarf.geometry.computeVertexNormals();
  }
}
