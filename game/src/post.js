// Post-processing: bloom, speed blur, vignette, light grading.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSpeed: { value: 0 },
    uVignette: { value: 0.35 },
    uSat: { value: 1.18 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uSpeed, uVignette, uSat, uTime;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c);
      vec4 col = texture2D(tDiffuse, vUv);
      // radial speed blur toward the edges
      float amt = uSpeed * smoothstep(0.15, 0.65, r) * 0.06;
      if (amt > 0.0005) {
        vec3 acc = col.rgb;
        for (int i = 1; i < 8; i++) acc += texture2D(tDiffuse, vUv - c * amt * float(i) / 7.0).rgb;
        col.rgb = acc / 8.0;
      }
      float l = dot(col.rgb, vec3(0.299, 0.587, 0.114));
      col.rgb = mix(vec3(l), col.rgb, uSat);
      col.rgb *= 1.0 - uVignette * smoothstep(0.35, 0.85, r);
      gl_FragColor = col;
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.3, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
  }
  setSize(w, h) { this.composer.setSize(w, h); }
  render(speed) {
    this.final.uniforms.uSpeed.value = speed;
    this.composer.render();
  }
}
