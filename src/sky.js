import * as THREE from 'three';
import { makeFlakeTexture } from './textures.js';

export function createSky(quality) {
  const uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uSunGlow: { value: 1 },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uStars: { value: 0 },
    uAurora: { value: 0 },
    uCirrus: { value: 0.5 },
    uTime: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    defines: { AURORA_STEPS: quality.auroraSteps },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor, uMoonDir;
      uniform float uSunGlow, uStars, uAurora, uCirrus, uTime;
      varying vec3 vDir;

      float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      float vn2(vec2 p){
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm2(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += vn2(p) * a; p *= 2.07; a *= 0.5; } return s; }

      // Северное сияние: вертикальные «занавесы» вдоль извилистых лент.
      float ribbon(float x, float k){
        return sin(x * 0.045 + uTime * 0.03 + k) * 22.0 + sin(x * 0.017 - uTime * 0.02 + k * 2.0) * 40.0 + (vn2(vec2(x * 0.02, uTime * 0.04 + k)) - 0.5) * 30.0;
      }
      vec3 aurora(vec3 d){
        if (d.y < 0.015) return vec3(0.0);
        vec3 acc = vec3(0.0);
        float jitter = h12(gl_FragCoord.xy) * 0.6;
        for (int i = 0; i < AURORA_STEPS; i++){
          float f = (float(i) + jitter) / float(AURORA_STEPS);
          float alt = 60.0 + f * 90.0;
          vec2 q = d.xz * (alt / d.y);
          float tw = 0.0;
          // лента 1 — на юге (вниз по склону), лента 2 — на востоке
          float d1 = q.y - (380.0 + ribbon(q.x, 0.0));
          float d2 = q.x - (420.0 + ribbon(q.y, 3.7));
          float b1 = exp(-d1 * d1 * 0.0009);
          float b2 = exp(-d2 * d2 * 0.0012) * 0.7;
          float s1 = 0.45 + 0.55 * vn2(vec2(q.x * 0.09, uTime * 0.25));
          s1 *= 0.55 + 0.45 * vn2(vec2(q.x * 0.35, uTime * 0.5));
          float s2 = 0.45 + 0.55 * vn2(vec2(q.y * 0.09 + 50.0, uTime * 0.25));
          s2 *= 0.55 + 0.45 * vn2(vec2(q.y * 0.35, uTime * 0.5 + 7.0));
          tw = b1 * s1 + b2 * s2;
          vec3 c = mix(vec3(0.15, 1.0, 0.6), vec3(0.15, 0.75, 1.0), smoothstep(0.2, 0.55, f));
          c = mix(c, vec3(0.65, 0.3, 1.0), smoothstep(0.55, 1.0, f));
          acc += c * tw * pow(1.0 - f, 1.4);
        }
        return acc * (3.2 / float(AURORA_STEPS)) * smoothstep(0.015, 0.12, d.y);
      }

      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        float up = max(y, 0.0);
        vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 1.0, up), 0.55));
        col = mix(col, uGround, smoothstep(0.0, -0.18, y));

        // солнце: ореол + диск
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.55 + pow(sd, 600.0) * 1.5) * uSunGlow;
        col += uSunColor * smoothstep(0.99935, 0.99965, sd) * 9.0 * uSunGlow;

        // перистые облака
        if (y > 0.0 && uCirrus > 0.0) {
          vec2 q = d.xz / (y + 0.12) * 1.2;
          float c = fbm2(q * vec2(1.0, 3.2) + vec2(uTime * 0.004, 0.0));
          c = smoothstep(0.52, 0.85, c) * smoothstep(0.0, 0.25, y);
          vec3 cc = mix(uHorizon * 1.15, uSunColor * 0.9 + uHorizon * 0.4, pow(sd, 4.0));
          col = mix(col, cc, c * uCirrus * 0.55);
        }

        // звёзды
        if (uStars > 0.01 && y > -0.02) {
          vec3 p = d * 260.0;
          vec3 cell = floor(p);
          float hsh = h13(cell);
          vec3 off = vec3(h13(cell + 1.7), h13(cell + 5.3), h13(cell + 9.1));
          float dd = length(fract(p) - off);
          float tw = 0.65 + 0.35 * sin(uTime * (1.5 + hsh * 3.0) + hsh * 80.0);
          float star = step(0.955, hsh) * smoothstep(0.09, 0.0, dd) * tw;
          float big = step(0.996, hsh) * smoothstep(0.2, 0.0, dd);
          vec3 sc = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), h13(cell + 3.3));
          col += sc * (star * 1.6 + big * 3.0) * uStars * smoothstep(-0.02, 0.15, y);
          // Млечный путь
          float band = exp(-pow(dot(d, normalize(vec3(0.4, 0.3, -0.85))) * 3.2, 2.0));
          col += vec3(0.25, 0.3, 0.55) * band * fbm2(d.xz * 9.0 + d.y * 4.0) * 0.35 * uStars;
        }
        // луна
        float md = dot(d, uMoonDir);
        col += vec3(0.85, 0.9, 1.0) * smoothstep(0.99955, 0.99972, md) * 6.0 * uStars;
        col += vec3(0.4, 0.5, 0.9) * pow(max(md, 0.0), 300.0) * 0.6 * uStars;

        if (uAurora > 0.01) col += aurora(d) * uAurora;

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(8000, 64, 32), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';
  return { mesh, uniforms };
}

// Снегопад вокруг камеры: точки бесшовно «заворачиваются» в кубе.
export function createSnowfall(count) {
  const BOX = 140;
  const pos = new Float32Array(count * 3);
  const rnd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = Math.random() * BOX;
    pos[i * 3 + 1] = Math.random() * BOX;
    pos[i * 3 + 2] = Math.random() * BOX;
    rnd[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  const uniforms = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uBox: { value: BOX },
    uOpacity: { value: 0 },
    uColor: { value: new THREE.Color(1, 1, 1) },
    uMap: { value: makeFlakeTexture() },
    uScale: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      attribute float aRnd;
      uniform float uTime, uBox, uScale; uniform vec3 uCam;
      varying float vA;
      void main(){
        vec3 drift = vec3(sin(uTime * 0.3 + aRnd * 6.28) * 1.5 + 2.0, -(1.2 + aRnd * 1.6), cos(uTime * 0.25 + aRnd * 9.0) * 1.2);
        vec3 p = position + drift * uTime;
        vec3 origin = uCam - uBox * 0.5;
        p = origin + mod(p - origin, uBox);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        vA = smoothstep(uBox * 0.5, uBox * 0.25, length(p - uCam)) * smoothstep(0.5, 2.0, dist);
        gl_PointSize = (0.9 + aRnd * 1.4) * uScale * 60.0 / max(dist, 0.5);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform float uOpacity; uniform vec3 uColor;
      varying float vA;
      void main(){
        float a = texture2D(uMap, gl_PointCoord).a * vA * uOpacity;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  points.name = 'snowfall';
  return { points, uniforms };
}
