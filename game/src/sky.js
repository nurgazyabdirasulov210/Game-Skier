// Sky dome (gradient, sun, moon, clouds, stars, aurora) and a ring of distant
// peaks that always sits on the horizon.
import * as THREE from '../vendor/three.module.js';
import { G, GLSL_COMMON } from './shaderlib.js';
import { noise2 } from './noise.js';

export class Sky {
  constructor(scene) {
    const geo = new THREE.SphereGeometry(2400, 48, 24);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...G, uSunCol: { value: new THREE.Color() }, uStarsAmt: G.uStars, uAuroraAmt: G.uAurora, uCloudAmt: G.uClouds },
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */`
        varying vec3 vWPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
          gl_Position.z = gl_Position.w * 0.99999;
        }
      `,
      fragmentShader: /* glsl */`
        ${GLSL_COMMON}
        uniform vec3 uSunCol;
        uniform float uStarsAmt;
        uniform float uAuroraAmt;
        uniform float uCloudAmt;
        varying vec3 vWPos;
        void main() {
          vec3 dir = normalize(vWPos - cameraPosition);
          float y = dir.y;
          float hz = pow(1.0 - clamp(y, 0.0, 1.0), 4.0);
          vec3 col = mix(uZenith, uHorizon, hz);
          float sd = dot(dir, uSunDir);
          // atmospheric glow around the sun, stronger near the horizon
          float glow = pow(max(sd, 0.0), 6.0) * 0.45 + pow(max(sd, 0.0), 48.0) * 0.9;
          col += uSunCol * glow * (0.35 + hz * 0.8);
          // below the horizon fades into the valley haze
          col = mix(col, uFogColor, smoothstep(0.02, -0.12, y));

          // stars
          if (uStarsAmt > 0.01 && y > -0.05) {
            vec3 sp = dir * 160.0;
            vec3 cell = floor(sp);
            float h = p_hash13(cell);
            vec3 c = cell + 0.5 + (vec3(p_hash13(cell + 7.1), p_hash13(cell + 3.3), p_hash13(cell + 9.7)) - 0.5) * 0.6;
            float d = length(sp - c);
            float star = smoothstep(0.16, 0.0, d) * step(0.986, h);
            float tw = 0.6 + 0.4 * sin(uTime * (2.0 + h * 5.0) + h * 80.0);
            vec3 sc = mix(vec3(0.8, 0.9, 1.2), vec3(1.2, 1.0, 0.8), fract(h * 13.0));
            col += sc * star * tw * uStarsAmt * 2.5 * smoothstep(-0.05, 0.2, y);
            // milky band
            float band = exp(-pow(dot(dir, normalize(vec3(0.6, 0.5, -0.62))) * 3.0, 2.0));
            col += vec3(0.25, 0.3, 0.5) * band * p_fbm(dir.xz * 6.0 / (abs(dir.y) + 0.3)) * 0.18 * uStarsAmt;
          }

          // aurora curtains
          if (uAuroraAmt > 0.01 && y > 0.0) {
            vec3 acc = vec3(0.0);
            for (int i = 0; i < 6; i++) {
              float fi = float(i);
              float hgt = 0.35 + fi * 0.05;
              vec2 uv = dir.xz / (y + 0.08) * hgt;
              uv.x += uTime * 0.01;
              float n = p_fbm(vec2(uv.x * 0.9, uv.y * 0.25) + fi * 0.13 + uTime * 0.015);
              float curtain = smoothstep(0.035, 0.0, abs(n - 0.55 + sin(uv.x * 1.3 + uTime * 0.05) * 0.06));
              vec3 ac = mix(vec3(0.15, 1.6, 0.8), vec3(0.9, 0.3, 1.4), fi / 6.0);
              acc += ac * curtain * (1.0 - fi / 7.0);
            }
            col += acc * uAuroraAmt * 0.45 * smoothstep(0.0, 0.25, y) * (1.0 - smoothstep(0.6, 1.0, y));
          }

          // sun and moon discs
          float sunDisc = smoothstep(0.99935, 0.99965, sd);
          col += uSunCol * sunDisc * 30.0 * smoothstep(-0.03, 0.01, y);
          float md = dot(dir, uMoonDir);
          float moon = smoothstep(0.99955, 0.9998, md);
          float crater = p_vnoise(dir.xy * 900.0) * 0.25;
          col += vec3(1.6, 1.7, 2.0) * moon * (0.8 - crater) * uNight * 3.0;
          col += vec3(0.4, 0.5, 0.9) * pow(max(md, 0.0), 300.0) * uNight * 0.6;

          // drifting clouds
          if (y > 0.0 && uCloudAmt > 0.0) {
            vec2 uv = dir.xz / (y + 0.12) * 0.55 + vec2(uTime * 0.004, uTime * 0.002);
            float d = p_fbm(uv * 1.6);
            d = smoothstep(1.0 - uCloudAmt * 0.95, 1.0, d + 0.15);
            float lightSide = p_fbm(uv * 1.6 - uSunDir.xz * 0.15);
            vec3 cl = mix(mix(uZenith, uHorizon, 0.6) * 0.9, uSunCol * 1.3 + uHorizon * 0.5, clamp(d - lightSide + 0.6, 0.0, 1.0));
            cl += uSunCol * pow(max(sd, 0.0), 10.0) * 1.5;
            col = mix(col, cl, d * smoothstep(0.0, 0.18, y) * 0.85);
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);

    this.mountains = this.makeMountains();
    scene.add(this.mountains);
  }

  makeMountains() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...G },
      depthWrite: true,
      vertexShader: /* glsl */`
        attribute float aT;
        varying vec3 vWPos;
        varying vec3 vN;
        varying float vT;
        varying float vH;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWPos = wp.xyz;
          vN = normal;
          vT = aT;
          vH = position.y;
          gl_Position = projectionMatrix * viewMatrix * wp;
          gl_Position.z = gl_Position.w * (0.99990 + aT * 0.00008);
        }
      `,
      fragmentShader: /* glsl */`
        ${GLSL_COMMON}
        varying vec3 vWPos;
        varying vec3 vN;
        varying float vT;
        varying float vH;
        void main() {
          vec3 N = normalize(vN);
          float ndl = dot(N, uKeyDir);
          float lit = smoothstep(-0.05, 0.35, ndl);
          float n = p_vnoise(vWPos.xz * 0.012) * 0.6 + p_vnoise(vWPos.xz * 0.05) * 0.4;
          float snow = smoothstep(0.5, 0.72, N.y + (n - 0.5) * 0.35) * smoothstep(-60.0, 40.0, vH + n * 60.0);
          vec3 rock = mix(vec3(0.05, 0.055, 0.08), vec3(0.14, 0.13, 0.16), n);
          vec3 sn = mix(uSnowShadow, uSnowLit * uKeyColor, lit);
          vec3 base = mix(rock * (uKeyColor * lit * 0.8 + ambient(N) * 0.5), sn, snow);
          vec3 dir = normalize(vWPos - cameraPosition);
          float s = pow(max(dot(dir, uSunDir), 0.0), 5.0);
          vec3 fc = mix(uFogColor, uFogSun, s * 0.85);
          // aerial perspective: further rows and lower slopes sink into the haze
          float haze = 0.38 + vT * 0.34 + (1.0 - smoothstep(-120.0, 200.0, vH)) * 0.3;
          gl_FragColor = vec4(mix(base, fc, clamp(haze, 0.0, 0.94)), 1.0);
        }
      `,
    });
    const NA = 288, NR = 16;
    const R0 = 1250, R1 = 2350;
    const pos = [], tA = [], idx = [];
    const ridged = (x, z) => {
      let s = 0, a = 1, f = 1, w = 0;
      for (let o = 0; o < 4; o++) {
        const v = 1 - Math.abs(noise2(x * f + o * 17.3, z * f - o * 9.1));
        s += v * v * a; w += a;
        a *= 0.5; f *= 2.1;
      }
      return s / w;
    };
    for (let j = 0; j <= NR; j++) {
      const t = j / NR;
      const r = R0 + (R1 - R0) * t;
      for (let i = 0; i <= NA; i++) {
        const a = (i / NA) * Math.PI * 2;
        const x = Math.sin(a) * r, z = -Math.cos(a) * r;
        const h = ridged(x * 0.0011 + 40, z * 0.0011 - 25);
        const env = THREE.MathUtils.smoothstep(t, 0.0, 0.4) * (1 - 0.35 * THREE.MathUtils.smoothstep(t, 0.75, 1.0));
        // keep the downhill view a little more open
        const front = Math.max(0, -Math.cos(a));
        const H = (90 + 620 * Math.pow(h, 1.6)) * env * (1 - front * 0.35);
        pos.push(x, H - 170, z);
        tA.push(t);
      }
    }
    const W = NA + 1;
    for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) {
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aT', new THREE.Float32BufferAttribute(tA, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -9;
    return mesh;
  }

  update(camera, pal) {
    this.mesh.position.copy(camera.position);
    this.mountains.position.set(camera.position.x, camera.position.y - 60, camera.position.z);
    this.mat.uniforms.uSunCol.value.copy(pal.sun).multiplyScalar(1.2 * (1 - pal.night * 0.9));
  }
}
