// Пост-обработка: радиальный блюр скорости, лучи солнца, свечение, грейдинг, виньетка.
import * as THREE from 'three';

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4, depthBuffer: true });
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uSpeed: { value: 0 },
        uTime: { value: 0 },
        uSun: { value: new THREE.Vector2(0.5, 0.5) },
        uSunVis: { value: 0 },
        uGlow: { value: new THREE.Color(1, 0.8, 0.5) },
        uFlash: { value: 0 },
        uAspect: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uSpeed, uTime, uSunVis, uFlash, uAspect;
        uniform vec2 uSun;
        uniform vec3 uGlow;
        varying vec2 vUv;
        float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
        float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 c = vUv - vec2(0.5, 0.55);
          float r = length(c);
          // радиальный блюр от скорости (сильнее к краям)
          float amt = uSpeed * 0.06 * smoothstep(0.1, 0.7, r);
          vec3 col = vec3(0.0);
          for (int i = 0; i < 8; i++) {
            float t = float(i) / 7.0;
            vec2 uv = vec2(0.5, 0.55) + c * (1.0 - amt * t);
            col += texture2D(tDiffuse, uv).rgb;
          }
          col /= 8.0;
          // хроматическая аберрация по краям
          float ca = 0.004 * r * r * (1.0 + uSpeed * 2.0);
          col.r = mix(col.r, texture2D(tDiffuse, vUv + c * ca).r, 0.7);
          col.b = mix(col.b, texture2D(tDiffuse, vUv - c * ca).b, 0.7);
          // мягкое свечение ярких областей
          vec3 bloom = vec3(0.0);
          for (int i = 0; i < 12; i++) {
            float a = float(i) * 2.399;
            float rr = 0.004 + float(i) * 0.0016;
            vec2 o = vec2(cos(a), sin(a) * uAspect) * rr;
            vec3 s = texture2D(tDiffuse, vUv + o).rgb;
            bloom += s * smoothstep(0.85, 1.0, luma(s));
          }
          col += bloom / 12.0 * 0.35;
          // лучи от солнца
          if (uSunVis > 0.01) {
            vec2 d = (uSun - vUv) / 24.0;
            vec2 uv = vUv;
            float ill = 0.0, decay = 1.0;
            for (int i = 0; i < 24; i++) {
              uv += d;
              vec3 s = texture2D(tDiffuse, uv).rgb;
              ill += smoothstep(0.9, 1.0, luma(s)) * decay;
              decay *= 0.94;
            }
            vec2 sd = vUv - uSun; sd.y /= uAspect;
            float halo = exp(-length(sd) * 3.5);
            col += uGlow * (ill / 24.0 * 0.4 + halo * 0.12) * uSunVis;
          }
          // грейдинг: контраст и насыщенность
          col = mix(vec3(luma(col)), col, 1.12);
          col = (col - 0.5) * 1.05 + 0.5;
          // вспышка при падении/трюке
          col = mix(col, vec3(1.0), uFlash * 0.35);
          // виньетка
          vec2 vc = vUv - 0.5;
          col *= 1.0 - dot(vc, vc) * (0.55 + uSpeed * 0.4);
          col += (rnd(vUv * 731.0 + uTime) - 0.5) * 0.025;
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }`,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
  }

  setSize(w, h) {
    this.rt.setSize(w, h);
    this.mat.uniforms.uAspect.value = w / h;
  }

  render(scene, camera) {
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.cam);
  }
}
