import * as THREE from '../vendor/three.module.js';
import { G } from './shaderlib.js';

// Два каскада теней: ближний (резкие тени лыжника и колеи) и дальний (деревья, холмы).
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

export class Shadows {
  constructor(renderer, { size0 = 2048, size1 = 2048, half0 = 26, half1 = 200, cascades = 2 } = {}) {
    this.renderer = renderer;
    this.casters = [];
    this.cascades = [];
    const defs = [[size0, half0, 260], [size1, half1, 700]];
    for (let i = 0; i < cascades; i++) {
      const [size, half, depth] = defs[i];
      const dt = new THREE.DepthTexture(size, size);
      dt.type = THREE.UnsignedIntType;
      dt.compareFunction = THREE.LessEqualCompare;
      dt.minFilter = THREE.LinearFilter; dt.magFilter = THREE.LinearFilter;
      const rt = new THREE.WebGLRenderTarget(size, size, {
        format: THREE.RedFormat, type: THREE.UnsignedByteType,
        depthBuffer: true, depthTexture: dt, generateMipmaps: false,
      });
      const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.5, depth * 2);
      cam.layers.set(2 + i);
      this.cascades.push({ rt, cam, half, size, depth, matrix: i === 0 ? G.uShadowM0.value : G.uShadowM1.value });
    }
    G.uShadow0.value = this.cascades[0].rt.depthTexture;
    G.uShadow1.value = cascades > 1 ? this.cascades[1].rt.depthTexture : this.cascades[0].rt.depthTexture;
    if (cascades < 2) G.uShadowM1.value.makeScale(0, 0, 0).setPosition(0.5, 0.5, 2.0);
    G.uShadowInfo.value.set(1 / size0, 1 / size1, 1, 0);
    this.rot = new THREE.Matrix4();
    this.inv = new THREE.Matrix4();
    this.tmp = new THREE.Vector3();
    this.frame = 0;
  }
  // mask: битовая маска каскадов (1 — ближний, 2 — дальний)
  add(mesh, mask = 3) {
    if (!mesh.userData.depthMat) return;
    for (let i = 0; i < this.cascades.length; i++) if (mask & (1 << i)) mesh.layers.enable(2 + i);
    this.casters.push(mesh);
  }
  remove(mesh) {
    const i = this.casters.indexOf(mesh);
    if (i >= 0) this.casters.splice(i, 1);
  }
  render(scene, center, lightDir, viewDir) {
    const r = this.renderer;
    this.frame++;
    const up = Math.abs(lightDir.y) > 0.98 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    this.rot.lookAt(lightDir, new THREE.Vector3(0, 0, 0), up); // ось Z смотрит на свет
    this.inv.copy(this.rot).invert();

    const prevRT = r.getRenderTarget();
    const saved = this.casters.map((m) => m.material);
    for (const m of this.casters) m.material = m.userData.depthMat;
    const bg = scene.background; scene.background = null;

    for (let i = 0; i < this.cascades.length; i++) {
      const c = this.cascades[i];
      if (i === 1 && this.frame % 2 === 0) continue; // дальний каскад — через кадр
      // смещаем окно вперёд по взгляду, чтобы меньше тратить текселей позади
      const off = i === 0 ? c.half * 0.35 : c.half * 0.45;
      const p = this.tmp.set(center.x + viewDir.x * off, center.y, center.z + viewDir.z * off);
      // стабилизация: квантуем центр в пространстве света
      p.applyMatrix4(this.inv);
      const texel = (c.half * 2) / c.size;
      p.x = Math.floor(p.x / texel) * texel;
      p.y = Math.floor(p.y / texel) * texel;
      p.applyMatrix4(this.rot);
      c.cam.position.copy(p).addScaledVector(lightDir, c.depth);
      c.cam.quaternion.setFromRotationMatrix(this.rot);
      c.cam.updateMatrixWorld(true);
      c.matrix.copy(BIAS).multiply(c.cam.projectionMatrix).multiply(c.cam.matrixWorldInverse);
      const range = c.cam.far - c.cam.near;
      if (i === 0) G.uShadowBias.value.x = 0.06 / range; else G.uShadowBias.value.y = 0.35 / range;
      r.setRenderTarget(c.rt);
      r.clear(true, true, false);
      r.render(scene, c.cam);
    }
    for (let i = 0; i < this.casters.length; i++) this.casters[i].material = saved[i];
    scene.background = bg;
    r.setRenderTarget(prevRT);
  }
}
