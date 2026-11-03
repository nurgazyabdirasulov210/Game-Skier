import * as THREE from '../vendor/three.module.js';
import { makeMaterial, mergeParts, M4 } from './materials.js';

// Параплан: дуга крыла над лыжником + стропы.
export class Glider {
  constructor(parent, shadows) {
    this.group = new THREE.Group();
    this.group.visible = false;
    parent.add(this.group);
    const mat = makeMaterial({ wrap: 0.6, rim: 0.4, double: true });
    const cells = 11, span = 8.4, R = 5.2;
    const parts = [];
    for (let i = 0; i < cells; i++) {
      const a0 = -0.85 + (i / cells) * 1.7, a1 = -0.85 + ((i + 1) / cells) * 1.7;
      const am = (a0 + a1) / 2;
      const w = R * (a1 - a0) * 1.02;
      const chord = 2.1 * Math.cos(am * 0.9);
      const c = i % 2 === 0 ? '#ff6b5c' : '#fff3e6';
      const g = new THREE.BoxGeometry(w, 0.16, chord, 1, 1, 3);
      // профиль: передняя кромка толще
      const P = g.attributes.position;
      for (let k = 0; k < P.count; k++) {
        const z = P.getZ(k), y = P.getY(k);
        const t = z / chord + 0.5;
        P.setY(k, y * (0.4 + t * 1.4) + Math.sin(t * Math.PI) * 0.12);
      }
      parts.push({ geo: g, color: c, matrix: M4(Math.sin(am) * R, Math.cos(am) * R - R + 5.4, 0, 0, 0, -am) });
    }
    this.wing = new THREE.Mesh(mergeParts(parts), mat);
    this.wing.userData.depthMat = mat.userData.depthMat;
    this.wing.frustumCulled = false;
    this.group.add(this.wing);
    shadows.add(this.wing, 3);
    // стропы
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const a = -0.8 + (i / 8) * 1.6;
      const top = new THREE.Vector3(Math.sin(a) * R, Math.cos(a) * R - R + 5.3, 0.2);
      pts.push(new THREE.Vector3(i < 4 ? -0.25 : 0.25, 1.35, -0.1), top);
    }
    const lg = new THREE.BufferGeometry().setFromPoints(pts);
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a2c3a, transparent: true, opacity: 0.75 }));
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
    this.open = 0;
    this.target = 0;
  }
  update(dt, on, lean) {
    this.target = on ? 1 : 0;
    this.open += (this.target - this.open) * (1 - Math.exp(-dt * (on ? 4 : 8)));
    this.group.visible = this.open > 0.02;
    const s = this.open;
    this.group.scale.set(0.3 + 0.7 * s, s, 0.6 + 0.4 * s);
    this.group.rotation.z = -lean * 0.6;
  }
}
