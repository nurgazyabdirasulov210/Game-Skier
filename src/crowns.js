// Fluffy tree crowns: every crown is a ball of camera-facing fur sprites,
// lit as a sphere (warm lit side, cool shaded side, snow cap on top,
// glowing edges when the sun is behind it). Instanced and split into chunks.
import * as THREE from 'three';
import { U, FOG_GLSL } from './shading.js';
import { mulberry32 } from './noise.js';

const VERT = /* glsl */ `
attribute vec2 aCorner;
attribute vec3 aOffset;
attribute float aSize;
attribute float aRot;
attribute vec4 iPos;
attribute vec4 iMisc;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWP;
varying float vVar;
varying float vSnow;
varying float vDepth;
void main() {
  float R = iPos.w;
  vec3 off = aOffset;
  off.y *= iMisc.x;
  vec3 center = iPos.xyz + off * R;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 fwd = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  float c = cos(aRot + iMisc.y * 6.0), s = sin(aRot + iMisc.y * 6.0);
  vec2 cr = vec2(c * aCorner.x - s * aCorner.y, s * aCorner.x + c * aCorner.y) * aSize * R;
  vec3 wp = center + right * cr.x + up * cr.y;
  vec3 bulge = right * aCorner.x + up * aCorner.y;
  vN = normalize(off / max(length(aOffset), 0.001) * 1.1 + bulge * 0.55 + fwd * 0.25);
  vUv = aCorner * 0.5 + 0.5;
  vWP = wp;
  vVar = iMisc.y;
  vSnow = iMisc.z;
  vDepth = clamp(length(aOffset) / 0.65, 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uFur;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uShade;
uniform vec3 uSnowColor;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uHemiSky;
uniform vec3 uHemiGround;
uniform float uHemiIntensity;
uniform float uTranslucency;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWP;
varying float vVar;
varying float vSnow;
varying float vDepth;
${FOG_GLSL}
void main() {
  vec4 t = texture2D(uFur, vUv);
  if (t.a < 0.5) discard;
  vec3 n = normalize(vN);
  float strand = t.r;
  vec3 alb = mix(uColA, uColB, vVar);
  float cap = smoothstep(0.42, 0.7, n.y + (strand - 0.55) * 0.55);
  alb = mix(alb, uSnowColor * 0.92, cap * vSnow);
  float ndl = dot(n, uSunDir);
  float diff = smoothstep(-0.3, 0.75, ndl);
  alb = mix(alb, uShade, (1.0 - diff) * 0.75 * (1.0 - cap * vSnow));
  float occ = mix(0.35, 1.0, strand) * mix(0.6, 1.0, vDepth);
  vec3 hemi = mix(uHemiGround, uHemiSky, n.y * 0.5 + 0.5) * uHemiIntensity;
  vec3 light = uSunColor * uSunIntensity * diff * occ + hemi * mix(0.55, 1.0, occ);
  vec3 col = alb * light / 3.14159;
  vec3 vd = normalize(vWP - cameraPosition);
  float back = pow(max(dot(vd, uSunDir), 0.0), 3.0);
  float edge = 1.0 - abs(dot(n, vd));
  col += alb * uSunColor * uSunIntensity * back * (0.15 + edge * edge) * uTranslucency * strand / 3.14159;
  col = applyFog(col, vWP);
  gl_FragColor = vec4(col, 1.0);
}`;

function makeBase(quads, seed) {
  const rnd = mulberry32(seed);
  const corners = [], offsets = [], sizes = [], rots = [], index = [], pos = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const outer = quads - 3;
  const push = (o, s) => {
    const base = corners.length / 2;
    const r = rnd() * Math.PI * 2;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      corners.push(cx, cy);
      offsets.push(o[0], o[1], o[2]);
      sizes.push(s);
      rots.push(r);
      pos.push(0, 0, 0);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let i = 0; i < 3; i++) {
    push([(rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3], 0.95);
  }
  for (let i = 0; i < outer; i++) {
    const y = 1 - (i / (outer - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i + rnd() * 0.4;
    const rad = 0.52 + rnd() * 0.16;
    push([Math.cos(th) * r * rad, y * rad * 0.92, Math.sin(th) * r * rad], 0.5 + rnd() * 0.18);
  }
  return {
    position: new THREE.Float32BufferAttribute(pos, 3),
    aCorner: new THREE.Float32BufferAttribute(corners, 2),
    aOffset: new THREE.Float32BufferAttribute(offsets, 3),
    aSize: new THREE.Float32BufferAttribute(sizes, 1),
    aRot: new THREE.Float32BufferAttribute(rots, 1),
    index,
  };
}

export class CrownSpecies {
  constructor({ furTexture, colA, colB, translucency = 1.0, quads = 20, seed = 1 }) {
    this.uniforms = {
      ...U,
      uFur: { value: furTexture },
      uColA: { value: new THREE.Color(colA) },
      uColB: { value: new THREE.Color(colB) },
      uShade: { value: new THREE.Color(colB) },
      uTranslucency: { value: translucency },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    this.base = makeBase(quads, seed);
    this.proxyMat = new THREE.MeshBasicMaterial();
    this.proxyGeo = new THREE.IcosahedronGeometry(1, 1);
  }

  setColors(a, b, shade) {
    this.uniforms.uColA.value.copy(a);
    this.uniforms.uColB.value.copy(b);
    if (shade) this.uniforms.uShade.value.copy(shade);
  }

  /** items: {x,y,z,r,squash,var,snow}. Returns a Group of chunk meshes. */
  build(items, chunkSize = 380) {
    const group = new THREE.Group();
    const chunks = new Map();
    for (const it of items) {
      const k = `${Math.floor(it.x / chunkSize)},${Math.floor(it.z / chunkSize)}`;
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k).push(it);
    }
    const m = new THREE.Matrix4();
    for (const list of chunks.values()) {
      const geo = new THREE.InstancedBufferGeometry();
      for (const name of ['position', 'aCorner', 'aOffset', 'aSize', 'aRot']) geo.setAttribute(name, this.base[name]);
      geo.setIndex(this.base.index);
      const ip = new Float32Array(list.length * 4);
      const im = new Float32Array(list.length * 4);
      const box = new THREE.Box3();
      list.forEach((it, i) => {
        ip.set([it.x, it.y, it.z, it.r], i * 4);
        im.set([it.squash ?? 1, it.var ?? 0, it.snow ?? 1, 0], i * 4);
        box.expandByPoint(new THREE.Vector3(it.x, it.y, it.z));
      });
      geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(ip, 4));
      geo.setAttribute('iMisc', new THREE.InstancedBufferAttribute(im, 4));
      geo.instanceCount = list.length;
      geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      geo.boundingSphere.radius += 6;
      const mesh = new THREE.Mesh(geo, this.material);
      group.add(mesh);

      // invisible lumpy proxies that only render into the shadow map (layer 1)
      const proxy = new THREE.InstancedMesh(this.proxyGeo, this.proxyMat, list.length);
      list.forEach((it, i) => {
        const r = it.r * 0.78;
        m.makeScale(r, r * (it.squash ?? 1), r).setPosition(it.x, it.y, it.z);
        proxy.setMatrixAt(i, m);
      });
      proxy.castShadow = true;
      proxy.layers.set(1);
      proxy.computeBoundingSphere();
      group.add(proxy);
    }
    return group;
  }
}
