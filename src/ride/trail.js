// Ski tracks: a trench ribbon pressed into the snow behind the skier.
// Segments live in a ring buffer, so old tracks stay until overwritten.
// The shader fakes depth: lit and shaded walls, two ski grooves, bright lips.
import * as THREE from 'three';
import { U, FOG_GLSL } from '../shading.js';

export class Trail {
  constructor(maxSegments = 9000) {
    this.max = maxSegments;
    const nv = maxSegments * 4;
    this.pos = new Float32Array(nv * 3);
    this.nrm = new Float32Array(nv * 3);
    this.right = new Float32Array(nv * 3);
    this.across = new Float32Array(nv);
    this.depth = new Float32Array(nv);
    const idx = new Uint32Array(maxSegments * 6);
    for (let s = 0; s < maxSegments; s++) {
      const b = s * 4;
      idx.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], s * 6);
    }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aNrm = new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage);
    this.aRight = new THREE.BufferAttribute(this.right, 3).setUsage(THREE.DynamicDrawUsage);
    this.aAcross = new THREE.BufferAttribute(this.across, 1).setUsage(THREE.DynamicDrawUsage);
    this.aDepth = new THREE.BufferAttribute(this.depth, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aNormal', this.aNrm);
    g.setAttribute('aRight', this.aRight);
    g.setAttribute('aAcross', this.aAcross);
    g.setAttribute('aDepth', this.aDepth);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = g;
    this.head = 0;
    this.count = 0;
    this.last = null;

    this.material = new THREE.ShaderMaterial({
      uniforms: { ...U },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
      vertexShader: /* glsl */ `
        attribute vec3 aNormal;
        attribute vec3 aRight;
        attribute float aAcross;
        attribute float aDepth;
        varying vec3 vN;
        varying vec3 vR;
        varying float vS;
        varying float vD;
        varying vec3 vWP;
        void main() {
          vN = aNormal; vR = aRight; vS = aAcross; vD = aDepth;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWP = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunColor;
        uniform float uSunIntensity;
        uniform vec3 uHemiSky;
        uniform vec3 uHemiGround;
        uniform float uHemiIntensity;
        uniform vec3 uSnowColor;
        varying vec3 vN;
        varying vec3 vR;
        varying float vS;
        varying float vD;
        varying vec3 vWP;
        ${FOG_GLSL}
        vec3 snowLight(vec3 n, float occ) {
          vec3 hemi = mix(uHemiGround, uHemiSky, n.y * 0.5 + 0.5) * uHemiIntensity * occ;
          return uSnowColor * (uSunColor * uSunIntensity * max(dot(n, uSunDir), 0.0) + hemi) / 3.14159;
        }
        void main() {
          float s = vS;
          float as = abs(s);
          // trench profile: walls tilt the normal toward the centre
          float wall = smoothstep(0.25, 0.85, as) * (1.0 - smoothstep(0.85, 1.0, as));
          vec3 n = normalize(vN - vR * sign(s) * wall * 1.3 * vD);
          float occ = mix(1.0, 0.72, (1.0 - smoothstep(0.0, 0.8, as)) * vD);
          vec3 col = snowLight(n, occ);
          vec3 flatCol = snowLight(normalize(vN), 1.0);
          // two ski grooves
          float groove = exp(-pow((as - 0.28) / 0.06, 2.0)) * 0.3 * vD;
          col *= 1.0 - groove;
          // bright lips of pushed-up snow at the edges
          float lip = exp(-pow((as - 0.9) / 0.07, 2.0));
          col = mix(col, flatCol * 1.12, lip * 0.8);
          float alpha = (1.0 - smoothstep(0.92, 1.0, as)) * clamp(vD * 1.5, 0.0, 1.0);
          col = applyFog(col, vWP);
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = false;
  }

  /** Ends the current stroke (skier left the snow). */
  break() { this.last = null; }

  reset() {
    this.pos.fill(0);
    this.depth.fill(0);
    this.head = 0;
    this.last = null;
    for (const a of [this.aPos, this.aDepth]) a.needsUpdate = true;
  }

  /**
   * Adds a point of the current stroke.
   * p: centre on the snow surface, n: surface normal, dir: travel direction,
   * width: half width in metres, depth: 0..1 trench strength.
   */
  add(p, n, dir, width, depth) {
    const right = new THREE.Vector3().crossVectors(n, dir).normalize();
    const cur = { p: p.clone(), n: n.clone(), right, width, depth };
    const last = this.last;
    if (!last) { this.last = cur; return; }
    if (last.p.distanceToSquared(p) < 0.35 * 0.35) return;
    const s = this.head;
    const b = s * 4;
    const put = (vi, pt, side) => {
      const P = pt.p, R = pt.right;
      this.pos.set([P.x + R.x * side * pt.width, P.y + R.y * side * pt.width + 0.05, P.z + R.z * side * pt.width], vi * 3);
      this.nrm.set([pt.n.x, pt.n.y, pt.n.z], vi * 3);
      this.right.set([R.x, R.y, R.z], vi * 3);
      this.across[vi] = side;
      this.depth[vi] = pt.depth;
    };
    put(b, last, -1);
    put(b + 1, last, 1);
    put(b + 2, cur, -1);
    put(b + 3, cur, 1);
    for (const [a, size] of [[this.aPos, 3], [this.aNrm, 3], [this.aRight, 3], [this.aAcross, 1], [this.aDepth, 1]]) {
      a.addUpdateRange(b * size, 4 * size);
      a.needsUpdate = true;
    }
    this.head = (this.head + 1) % this.max;
    this.last = cur;
  }
}
