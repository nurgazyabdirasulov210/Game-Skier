// Stylised materials: soft-toon snow with coloured shadows, sparkles and
// deformable trails; snowy conifers; rocks; props; the rider.
import * as THREE from '../vendor/three.module.js';
import { G, makeUniforms, GLSL_COMMON, GLSL_SHADOW_FRAG } from './shaderlib.js';

// ------------------------------------------------------------------ terrain

export function makeTerrainMaterial(trail) {
  const uniforms = makeUniforms({
    uTrail: { value: trail.texture },
    uTrailP: trail.params,      // vec4: centerX, centerZ, size, res
    uTrailK: { value: new THREE.Vector2(trail.depthScale, trail.bermScale) },
  });
  return new THREE.ShaderMaterial({
    uniforms,
    lights: true,
    vertexShader: /* glsl */`
      #include <common>
      #include <shadowmap_pars_vertex>
      attribute vec4 aData;
      uniform sampler2D uTrail;
      uniform vec4 uTrailP;
      uniform vec2 uTrailK;
      varying vec3 vWPos;
      varying vec3 vNrm;
      varying vec4 vData;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vec2 tuv = (worldPosition.xz - uTrailP.xy) / uTrailP.z + 0.5;
        if (tuv.x > 0.0 && tuv.x < 1.0 && tuv.y > 0.0 && tuv.y < 1.0) {
          vec3 t = textureLod(uTrail, tuv, 0.0).rgb;
          float edge = smoothstep(0.0, 0.05, min(min(tuv.x, 1.0 - tuv.x), min(tuv.y, 1.0 - tuv.y)));
          worldPosition.y += (-t.r * uTrailK.x + t.g * uTrailK.y * (1.0 - t.b)) * edge;
        }
        vWPos = worldPosition.xyz;
        vNrm = normal;
        vData = aData;
        vec3 transformedNormal = normalMatrix * normal;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
        #include <shadowmap_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      ${GLSL_SHADOW_FRAG}
      ${GLSL_COMMON}
      uniform sampler2D uTrail;
      uniform vec4 uTrailP;
      uniform vec2 uTrailK;
      varying vec3 vWPos;
      varying vec3 vNrm;
      varying vec4 vData;

      float tdisp(vec2 uv) {
        vec3 t = texture(uTrail, uv).rgb;
        return -t.r * uTrailK.x + t.g * uTrailK.y * (1.0 - t.b);
      }

      void main() {
        vec3 wp = vWPos;
        vec3 Ng = normalize(vNrm);
        vec3 N = Ng;
        vec3 toCam = cameraPosition - wp;
        float dist = length(toCam);
        vec3 V = toCam / dist;

        // ---- deformable snow (trail render target)
        float depth = 0.0, berm = 0.0, comp = 0.0, wall = 0.0;
        vec2 tuv = (wp.xz - uTrailP.xy) / uTrailP.z + 0.5;
        if (tuv.x > 0.0 && tuv.x < 1.0 && tuv.y > 0.0 && tuv.y < 1.0) {
          float edge = smoothstep(0.0, 0.05, min(min(tuv.x, 1.0 - tuv.x), min(tuv.y, 1.0 - tuv.y)));
          float e = 1.0 / uTrailP.w;
          vec3 c = texture(uTrail, tuv).rgb;
          float hl = tdisp(tuv - vec2(e, 0.0)), hr = tdisp(tuv + vec2(e, 0.0));
          float hd = tdisp(tuv - vec2(0.0, e)), hu = tdisp(tuv + vec2(0.0, e));
          float tm = uTrailP.z / uTrailP.w;
          vec2 g = vec2(hr - hl, hu - hd) / (2.0 * tm) * edge;
          wall = clamp(length(g) * 0.8, 0.0, 1.0);
          // chunky broken powder on the trench walls
          vec2 q = wp.xz * 3.1;
          float n0 = p_vnoise(q), nx = p_vnoise(q + vec2(0.35, 0.0)), nz = p_vnoise(q + vec2(0.0, 0.35));
          vec2 lump = vec2(nx - n0, nz - n0) * 2.2 * (wall + c.g * 1.5) * edge;
          N = normalize(N + vec3(-g.x - lump.x, 0.0, -g.y - lump.y));
          depth = c.r * edge; berm = c.g * edge; comp = c.b * edge;
        }

        // ---- wind-carved ripples in untouched snow
        float near = 1.0 - smoothstep(25.0, 70.0, dist);
        if (near > 0.0) {
          vec2 wdir = normalize(vec2(0.8, 0.6));
          float warp = p_vnoise(wp.xz * 0.35) * 6.0;
          float ph = dot(wp.xz, wdir) * 1.7 + warp;
          float rip = cos(ph) * (0.5 + 0.5 * p_vnoise(wp.xz * 0.6));
          vec2 rg = wdir * rip * 0.09 * near * (1.0 - comp);
          N = normalize(N + vec3(rg.x, 0.0, rg.y));
        }

        // ---- lighting
        // ignore the shadow map where the slope already faces away (avoids acne at the terminator)
        float sh = mix(1.0, keyShadow(), smoothstep(0.04, 0.22, dot(Ng, uKeyDir)));
        float ndl = dot(N, uKeyDir);
        float lit = smoothstep(-0.06, 0.3, ndl) * sh;
        float forest = vData.y;
        float cav = vData.x;

        vec3 lightCol = uSnowLit * uKeyColor;
        vec3 col = mix(uSnowShadow, lightCol, lit);
        // broad, soft albedo variation so open fields never read as flat paper
        col *= 0.93 + 0.07 * p_vnoise(wp.xz * 0.045) + 0.03 * p_vnoise(wp.xz * 0.6);
        // soft sky fill + bounce
        col += ambient(N) * 0.10;
        // translucent glow on shadow side of thin features
        col += uSnowShadow * 0.25 * pow(max(dot(-V, uKeyDir), 0.0), 3.0) * (1.0 - lit);
        // grazing reflection of the sky
        float fr = pow(1.0 - max(dot(N, V), 0.0), 5.0);
        col = mix(col, uHorizon * 1.15, fr * 0.45);

        // trench: compressed, slightly blue, occluded walls
        float dz = depth * uTrailK.x;
        col *= mix(1.0, 0.78, smoothstep(0.02, 0.5, dz));
        col = mix(col, col * vec3(0.86, 0.9, 1.08), comp * 0.6);
        col *= mix(1.0, 1.06, berm);
        // terrain cavity and forest floor shade
        col *= mix(0.84, 1.04, cav);
        col *= 1.0 - forest * 0.14 * (1.0 - lit * 0.5);

        // ---- sparkles
        if (dist < 45.0) {
          vec2 p = wp.xz * 7.0;
          vec2 ip = floor(p);
          vec2 fp = fract(p);
          float h = p_hash12(ip);
          vec2 cpos = vec2(p_hash12(ip + 17.1), p_hash12(ip + 31.7)) * 0.8 + 0.1;
          float glint = smoothstep(0.11, 0.0, length(fp - cpos)) * step(0.955, h);
          float tw = step(0.62, fract(h * 53.0 + dot(V, vec3(9.1, 5.7, 7.3)) * 1.3 + uTime * 0.0));
          float spark = glint * tw * (1.0 - smoothstep(12.0, 45.0, dist)) * (1.0 - comp);
          col += (uKeyColor * 1.6 + vec3(0.4)) * spark * (0.25 + lit);
        }

        // ---- rock where the slope is too steep to hold snow
        float rockN = p_fbm(wp.xz * 0.25 + wp.y * 0.1);
        float steep = 1.0 - Ng.y;
        float rock = smoothstep(0.42, 0.56, steep + (vData.z - 0.5) * 0.12 + (rockN - 0.5) * 0.22);
        if (rock > 0.0) {
          float strata = p_vnoise(vec2(wp.y * 1.3, wp.x * 0.05 + wp.z * 0.05));
          vec3 rc = mix(vec3(0.045, 0.045, 0.06), vec3(0.13, 0.12, 0.14), strata * 0.7 + rockN * 0.3);
          float rl = smoothstep(-0.1, 0.4, dot(N, uKeyDir)) * sh;
          vec3 rcol = rc * (uKeyColor * rl * 1.2 + ambient(N) * 0.55);
          // snow clinging to ledges
          float ledge = smoothstep(0.55, 0.85, N.y + (p_vnoise(wp.xz * 2.0) - 0.5) * 0.4);
          rcol = mix(rcol, col, ledge);
          col = mix(col, rcol, rock);
        }

        col += lampLight(wp, N);
        col = applyFog(col, wp);
        gl_FragColor = vec4(col, 1.0);
        #ifdef DBG_SHADOW
          gl_FragColor = vec4(vec3(sh) * 3.0, 1.0);
        #endif
        #ifdef DBG_TRAIL
          gl_FragColor = vec4(depth * 4.0, berm * 4.0, comp, 1.0);
        #endif
      }
    `,
  });
}

// ------------------------------------------------------------------ foliage / trees
// Geometry carries `aInfo` = (ao 0..1, kind: 0 bark, 1 needles, 2 rime)

export function makeTreeMaterial(opts) {
  const uniforms = makeUniforms({
    uNeedle: { value: new THREE.Color(opts.needle) },
    uNeedle2: { value: new THREE.Color(opts.needle2 || opts.needle) },
    uBark: { value: new THREE.Color(opts.bark || '#4a3426') },
    uSnow: { value: opts.snow ?? 0.6 },
    uTrans: { value: opts.trans ?? 0.3 },
    uWindAmp: { value: opts.windAmp ?? 1 },
  });
  return new THREE.ShaderMaterial({
    uniforms,
    lights: true,
    vertexShader: /* glsl */`
      #include <common>
      #include <shadowmap_pars_vertex>
      uniform float uTime;
      uniform float uWindAmp;
      attribute vec2 aInfo;
      varying vec3 vWPos;
      varying vec3 vNrm;
      varying vec2 vInfo;
      varying float vRand;
      varying float vH;
      void main() {
        vec3 pos = position;
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vec3 ip = im[3].xyz;
        float ph = dot(ip.xz, vec2(0.13, 0.171));
        vRand = fract(sin(ph * 12.9898) * 43758.5453);
        vec4 worldPosition = modelMatrix * im * vec4(pos, 1.0);
        float sway = sin(uTime * 1.1 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.25;
        worldPosition.xz += vec2(0.7, 0.45) * sway * uWindAmp * pos.y * pos.y * 0.0025;
        vec3 n = normalize(mat3(im) * normal);
        vNrm = normalize(mat3(modelMatrix) * n);
        vWPos = worldPosition.xyz;
        vInfo = aInfo;
        vH = pos.y;
        vec3 transformedNormal = normalMatrix * n;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
        #include <shadowmap_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      ${GLSL_SHADOW_FRAG}
      ${GLSL_COMMON}
      uniform vec3 uNeedle;
      uniform vec3 uNeedle2;
      uniform vec3 uBark;
      uniform float uSnow;
      uniform float uTrans;
      varying vec3 vWPos;
      varying vec3 vNrm;
      varying vec2 vInfo;
      varying float vRand;
      varying float vH;
      void main() {
        vec3 N = normalize(vNrm);
        if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vWPos);
        float ao = vInfo.x;
        float kind = vInfo.y;
        float sh = keyShadow();
        float ndl = dot(N, uKeyDir);
        float lit = smoothstep(-0.15, 0.45, ndl) * sh;

        // needle colour with per-tree variation and clumpy noise
        float n = p_vnoise(vWPos.xz * 1.7 + vWPos.y * 1.3);
        vec3 base = mix(uNeedle, uNeedle2, clamp(vRand * 0.8 + n * 0.4, 0.0, 1.0));
        base *= mix(0.55, 1.0, ao);
        if (kind < 0.5) {
          float stripe = p_vnoise(vec2(atan(N.x, N.z) * 3.0, vWPos.y * 4.0));
          base = uBark * mix(0.7, 1.15, stripe);
        }

        // snow sitting on top of every branch tier
        float up = N.y + (n - 0.5) * 0.5 + ao * 0.25 - 0.15;
        float snow = smoothstep(0.42, 0.62, up) * uSnow;
        if (kind > 1.5) snow = 0.85 + n * 0.15;
        if (kind < 0.5) snow *= 0.5;

        vec3 snowCol = mix(uSnowShadow, uSnowLit * uKeyColor, lit);
        snowCol *= mix(0.75, 1.0, ao);
        vec3 lightCol = uKeyColor * lit * 0.95 + ambient(N) * 0.55 + uSnowShadow * 0.25;
        vec3 col = base * lightCol;
        // light glowing through the needles when backlit
        float back = pow(max(dot(-V, uKeyDir), 0.0), 4.0);
        col += base * uKeyColor * back * uTrans * (0.4 + ao);
        col = mix(col, snowCol, snow);
        // rim light
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        col += uHorizon * rim * 0.12 * (0.5 + snow);
        col += lampLight(vWPos, N) * mix(base * 2.0, vec3(1.0), snow);
        col = applyFog(col, vWPos);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
}

// ------------------------------------------------------------------ generic toon (props + rider)
// Uses vertex colours (`color`) and an optional `aEmit` attribute for glowing windows.

export function makeToonMaterial(opts = {}) {
  const uniforms = makeUniforms({
    uColor: { value: new THREE.Color(opts.color || '#ffffff') },
    uSnowTop: { value: opts.snowTop ?? 0 },
    uRim: { value: opts.rim ?? 0.35 },
    uEmit: { value: opts.emit ?? 0 },
    uEmitColor: { value: new THREE.Color(opts.emitColor || '#ffb35c') },
    uFlat: { value: opts.flat ? 1 : 0 },
    uGloss: { value: opts.gloss ?? 0 },
    uAlpha: { value: 1 },
  });
  const m = new THREE.ShaderMaterial({
    uniforms,
    lights: true,
    vertexColors: !!opts.vertexColors,
    transparent: !!opts.transparent,
    vertexShader: /* glsl */`
      #include <common>
      #include <shadowmap_pars_vertex>
      attribute float aEmit;
      varying vec3 vWPos;
      varying vec3 vNrm;
      varying vec3 vCol;
      varying float vEmit;
      void main() {
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vec4 worldPosition = modelMatrix * im * vec4(position, 1.0);
        vec3 n = normalize(mat3(modelMatrix) * (mat3(im) * normal));
        vNrm = n;
        vWPos = worldPosition.xyz;
        vCol = vec3(1.0);
        #ifdef USE_COLOR
          vCol = color;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vCol *= instanceColor;
        #endif
        vEmit = aEmit;
        vec3 transformedNormal = normalMatrix * (mat3(im) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
        #include <shadowmap_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      ${GLSL_SHADOW_FRAG}
      ${GLSL_COMMON}
      uniform vec3 uColor;
      uniform float uSnowTop;
      uniform float uRim;
      uniform float uEmit;
      uniform vec3 uEmitColor;
      uniform float uFlat;
      uniform float uGloss;
      uniform float uAlpha;
      varying vec3 vWPos;
      varying vec3 vNrm;
      varying vec3 vCol;
      varying float vEmit;
      void main() {
        vec3 N = normalize(vNrm);
        if (uFlat > 0.5) N = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
        if (!gl_FrontFacing && uFlat < 0.5) N = -N;
        vec3 V = normalize(cameraPosition - vWPos);
        float sh = keyShadow();
        float ndl = dot(N, uKeyDir);
        // three-band toon ramp, softened
        float l1 = smoothstep(-0.05, 0.12, ndl);
        float l2 = smoothstep(0.45, 0.6, ndl);
        float lit = (l1 * 0.75 + l2 * 0.25) * sh;
        vec3 base = uColor * vCol;
        vec3 col = base * (uKeyColor * lit * 0.9 + ambient(N) * 0.55 + uSnowShadow * 0.18);
        if (uSnowTop > 0.0) {
          float s = smoothstep(0.55, 0.75, N.y + (p_vnoise(vWPos.xz * 2.5 + vWPos.y) - 0.5) * 0.4) * uSnowTop;
          vec3 snowCol = mix(uSnowShadow, uSnowLit * uKeyColor, lit);
          col = mix(col, snowCol, s);
        }
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        col += mix(uHorizon, uKeyColor, 0.5) * rim * uRim * (0.4 + 0.6 * sh);
        if (uGloss > 0.0) {
          vec3 H = normalize(uKeyDir + V);
          col += uKeyColor * pow(max(dot(N, H), 0.0), 60.0) * uGloss * sh;
        }
        col += lampLight(vWPos, N) * base * 1.5;
        col += uEmitColor * (vEmit + uEmit) * (0.6 + uNight * 3.0);
        col = applyFog(col, vWPos);
        gl_FragColor = vec4(col, uAlpha);
      }
    `,
  });
  m.extensions = { derivatives: true };
  return m;
}

// ------------------------------------------------------------------ glowing ice crystals

export function makeCrystalMaterial() {
  const uniforms = makeUniforms({ uGlow: { value: new THREE.Color('#7ff3ff') } });
  return new THREE.ShaderMaterial({
    uniforms,
    lights: true,
    vertexShader: /* glsl */`
      #include <common>
      #include <shadowmap_pars_vertex>
      uniform float uTime;
      varying vec3 vWPos;
      varying vec3 vNrm;
      void main() {
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vec3 ip = im[3].xyz;
        float a = uTime * 1.4 + ip.x * 0.37;
        mat3 r = mat3(cos(a), 0.0, -sin(a), 0.0, 1.0, 0.0, sin(a), 0.0, cos(a));
        vec3 p = r * position;
        vec4 worldPosition = modelMatrix * im * vec4(p, 1.0);
        worldPosition.y += sin(uTime * 2.0 + ip.z * 0.21) * 0.2;
        vNrm = normalize(mat3(im) * (r * normal));
        vWPos = worldPosition.xyz;
        vec3 transformedNormal = normalMatrix * vNrm;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
        #include <shadowmap_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      uniform vec3 uGlow;
      varying vec3 vWPos;
      varying vec3 vNrm;
      void main() {
        vec3 N = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
        vec3 V = normalize(cameraPosition - vWPos);
        float f = pow(1.0 - abs(dot(N, V)), 2.0);
        float facet = 0.5 + 0.5 * dot(N, uKeyDir);
        vec3 col = uGlow * (0.8 + facet * 0.8) + vec3(1.0) * f * 2.5;
        col *= 1.4 + 0.6 * sin(uTime * 3.0 + vWPos.x);
        col = applyFog(col, vWPos);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    extensions: { derivatives: true },
  });
}
