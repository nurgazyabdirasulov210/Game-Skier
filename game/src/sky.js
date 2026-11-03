import * as THREE from '../vendor/three.module.js';
import { G, FRAG_HEAD } from './shaderlib.js';
import { GLSL_WORLD } from './world.js';

const VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
  gl_Position = p.xyww;
}`;

const FRAG = /* glsl */`
${FRAG_HEAD}
${GLSL_WORLD}
varying vec3 vDir;
float ring(float az, float k, float s){ return gnoise(vec2(cos(az), sin(az)) * k + s); }
void main(){
  vec3 v = normalize(vDir);
  vec3 c = skyColor(v);
  float az = atan(v.z, v.x);
  float y = v.y;

  // звёзды
  if (uNight > 0.01 && y > -0.02) {
    vec2 sp = vec2(az * 95.0, asin(clamp(y, -1.0, 1.0)) * 95.0);
    vec2 cell = floor(sp);
    float h = hash01(ivec2(cell) + ivec2(900, 300));
    vec2 jit = vec2(hash01(ivec2(cell) + ivec2(17, 3)), hash01(ivec2(cell) + ivec2(5, 41)));
    float d = length(fract(sp) - jit);
    float star = smoothstep(0.12, 0.0, d) * step(0.986, h);
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 4.0) + h * 40.0);
    float b = mix(0.6, 2.2, fract(h * 91.0));
    c += vec3(0.85, 0.9, 1.0) * star * tw * b * uNight * smoothstep(-0.02, 0.15, y);
    // млечная дымка
    float mw = gnoise(vec2(az * 2.0, y * 5.0) + 3.0) * 0.5 + 0.5;
    c += vec3(0.12, 0.13, 0.3) * smoothstep(0.55, 0.9, mw) * uNight * 0.35 * smoothstep(0.1, 0.6, y);
  }

  // северное сияние
  if (uNight > 0.3 && y > 0.04) {
    float a = 0.0;
    vec3 ac = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float base = 0.22 + fi * 0.09 + ring(az, 1.6, uTime * 0.015 + fi * 3.1) * 0.08;
      float band = smoothstep(base - 0.02, base + 0.02, y) * (1.0 - smoothstep(base + 0.03, base + 0.22, y));
      float streak = gnoise(vec2(az * 36.0 + fi * 7.0, uTime * 0.12 + fi)) * 0.5 + 0.5;
      float fadeAz = smoothstep(-0.2, 0.6, ring(az, 1.1, 11.0 + fi * 2.0));
      float k = band * (0.35 + streak * 0.9) * fadeAz;
      vec3 col = mix(vec3(0.1, 1.0, 0.65), vec3(0.55, 0.25, 1.0), clamp((y - base) / 0.22, 0.0, 1.0));
      ac += col * k;
    }
    c += ac * 0.55 * smoothstep(0.3, 1.0, uNight);
  }

  // облака у горизонта
  float cl = gnoise(vec2(az * 3.0 + uTime * 0.004, y * 9.0)) * 0.6 + gnoise(vec2(az * 9.0 - uTime * 0.006, y * 22.0)) * 0.3;
  float cmask = smoothstep(0.1, 0.75, cl) * smoothstep(0.0, 0.12, y) * (1.0 - smoothstep(0.1, 0.4, y));
  float sunSide = pow(max(dot(v, uSunDisc), 0.0), 3.0);
  vec3 cloudCol = mix(uSkyHor * 1.05, uSkyAmb * 0.9, 0.35) + uGlowCol * sunSide * 0.7;
  c = mix(c, cloudCol, cmask * 0.4);

  // солнце и луна
  float sd = dot(v, uSunDisc);
  c += uGlowCol * smoothstep(0.99955, 0.99985, sd) * 14.0 * (1.0 - uNight * 0.9);
  float md = dot(v, uMoonDir);
  float moon = smoothstep(0.99935, 0.9996, md);
  vec3 mp = v - uMoonDir * md;
  float phase = smoothstep(0.0, 0.02, dot(mp, normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)))) + 0.012);
  c = mix(c, vec3(1.6, 1.65, 1.9) * (0.25 + 0.75 * phase), moon * uNight);

  // дальние хребты
  float r1 = 0.035 + (ring(az, 2.2, 1.0) * 0.5 + 0.5) * 0.06 + ring(az, 7.0, 4.0) * 0.012 + abs(ring(az, 15.0, 9.0)) * 0.006;
  float r2 = 0.012 + (ring(az, 3.5, 21.0) * 0.5 + 0.5) * 0.04 + ring(az, 11.0, 2.0) * 0.008;
  vec3 fogC = skyColor(normalize(vec3(v.x, 0.015, v.z)));
  float lightSide = clamp(dot(normalize(vec3(cos(az + 0.3), 0.0, sin(az + 0.3))), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))) * 0.5 + 0.5, 0.0, 1.0);
  vec3 m1 = mix(fogC, mix(uGndAmb * 1.3, uSunCol * 0.45 + uSkyAmb * 0.4, lightSide * 0.6), 0.28);
  vec3 m2 = mix(fogC, mix(uGndAmb * 1.1, uSunCol * 0.4 + uSkyAmb * 0.35, lightSide * 0.6), 0.42);
  float snowCap1 = smoothstep(r1 - 0.012, r1 - 0.002, y);
  m1 = mix(m1, m1 + uSunCol * 0.08 * lightSide, snowCap1);
  float e1 = smoothstep(r1 + 0.0015, r1 - 0.0015, y);
  float e2 = smoothstep(r2 + 0.0015, r2 - 0.0015, y);
  c = mix(c, m1, e1);
  c = mix(c, m2, e2);

  gl_FragColor = vec4(c, 1.0);
}`;

export class Sky {
  constructor(scene) {
    const geo = new THREE.SphereGeometry(3000, 48, 24);
    this.mat = new THREE.ShaderMaterial({
      uniforms: G, vertexShader: VERT, fragmentShader: FRAG,
      side: THREE.BackSide, depthWrite: false, depthTest: true,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 100;
    scene.add(this.mesh);
  }
}
