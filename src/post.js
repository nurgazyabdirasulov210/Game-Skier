// Post-processing: bloom, tone mapping and a colour grade with vignette,
// saturation, split toning and thin light streaks from the sun.
import * as THREE from 'three';
import { EffectComposer } from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from '../vendor/three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 1.15 },
    uContrast: { value: 1.05 },
    uLift: { value: new THREE.Color(0, 0, 0) },
    uGain: { value: new THREE.Color(1, 1, 1) },
    uVignette: { value: 0.35 },
    uSun: { value: new THREE.Vector3(0.5, 0.5, 0) },
    uStreaks: { value: 0 },
    uStreakColor: { value: new THREE.Color(1, 0.9, 0.7) },
    uAspect: { value: 1.6 },
    uTime: { value: 0 },
    uBlur: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSat;
    uniform float uContrast;
    uniform vec3 uLift;
    uniform vec3 uGain;
    uniform float uVignette;
    uniform vec3 uSun;
    uniform float uStreaks;
    uniform vec3 uStreakColor;
    uniform float uAspect;
    uniform float uTime;
    uniform float uBlur;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // radial speed blur toward the screen edges
      if (uBlur > 0.001) {
        vec2 dir = vUv - 0.5;
        float w = smoothstep(0.08, 0.55, length(dir * vec2(uAspect * 0.6, 1.0)));
        vec3 acc = c;
        for (int i = 1; i < 8; i++) acc += texture2D(tDiffuse, vUv - dir * float(i) * 0.011 * uBlur * w).rgb;
        c = acc / 8.0;
      }
      // thin streaks radiating from the sun (screen space)
      if (uStreaks > 0.0 && uSun.z > 0.0) {
        vec2 v = (vUv - uSun.xy) * vec2(uAspect, 1.0);
        float r = length(v);
        float s = 0.0;
        for (int k = 0; k < 5; k++) {
          float a = 0.55 + float(k) * 1.27 + sin(float(k) * 3.1) * 0.3;
          vec2 dir = vec2(cos(a), sin(a));
          float along = dot(v, dir);
          float dist = abs(dot(v, vec2(-dir.y, dir.x)));
          float w = 0.0012 + max(along, 0.0) * 0.004;
          s += step(0.0, along) * exp(-dist / w) * exp(-along * (1.6 + float(k) * 0.3)) * (0.6 + 0.4 * sin(float(k) * 7.0));
        }
        s += exp(-r * 6.0) * 0.25;
        c += uStreakColor * s * uStreaks * uSun.z;
        c = max(c, vec3(0.0));
      }
      c = c * uGain + uLift * (1.0 - c);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c = (c - 0.5) * uContrast + 0.5;
      vec2 q = vUv - 0.5;
      q.x *= uAspect * 0.75;
      float vig = smoothstep(0.95, 0.25, length(q));
      c *= mix(1.0 - uVignette, 1.0, vig);
      c += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.012;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export function buildPost(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.4, 0.6, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  const sunNdc = new THREE.Vector3();
  return {
    composer, bloom, grade,
    setSize(w, h) {
      composer.setSize(w, h);
      grade.uniforms.uAspect.value = w / h;
    },
    update(sunDir, time) {
      grade.uniforms.uTime.value = time % 100;
      sunNdc.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
      const camDir = camera.getWorldDirection(new THREE.Vector3());
      const facing = camDir.dot(sunDir);
      const onScreen = Math.max(0, 1 - Math.max(Math.abs(sunNdc.x), Math.abs(sunNdc.y)) * 0.6);
      grade.uniforms.uSun.value.set(sunNdc.x * 0.5 + 0.5, sunNdc.y * 0.5 + 0.5, facing > 0 ? onScreen * Math.min(1, facing * 2) : 0);
    },
    render() { composer.render(); },
  };
}
