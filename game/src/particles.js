// Powder: soft dust clouds (billboards), chunky snow clumps that bounce and
// settle, falling snow, chimney smoke and pickup sparkles.
import * as THREE from '../vendor/three.module.js';
import { G, GLSL_COMMON } from './shaderlib.js';
import { heightAt } from './terrain.js';

const rand = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ dust billboards
class Dust {
  constructor(scene, cap) {
    this.cap = cap;
    this.n = 0;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.s0 = new Float32Array(cap);
    this.s1 = new Float32Array(cap);
    this.a0 = new Float32Array(cap);
    this.kind = new Float32Array(cap);
    this.rot = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iData = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.iPos);
    geo.setAttribute('iData', this.iData);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...G },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */`
        attribute vec3 iPos;
        attribute vec4 iData;
        varying vec2 vUv;
        varying float vA;
        varying float vKind;
        varying vec3 vWPos;
        varying float vCamFade;
        void main() {
          vec4 mv = viewMatrix * vec4(iPos, 1.0);
          vCamFade = smoothstep(0.6, 4.0, -mv.z) * (1.0 - smoothstep(60.0, 140.0, -mv.z));
          float r = iData.z;
          vec2 c = mat2(cos(r), -sin(r), sin(r), cos(r)) * position.xy;
          mv.xy += c * iData.x;
          gl_Position = projectionMatrix * mv;
          vUv = position.xy + 0.5;
          vA = iData.y;
          vKind = iData.w;
          vWPos = iPos;
        }
      `,
      fragmentShader: /* glsl */`
        ${GLSL_COMMON}
        varying vec2 vUv;
        varying float vA;
        varying float vKind;
        varying vec3 vWPos;
        varying float vCamFade;
        void main() {
          vec2 p = vUv - 0.5;
          float d = length(p) * 2.0;
          float n = p_vnoise(vUv * 5.0 + vWPos.xz * 0.7);
          float a = smoothstep(1.0, 0.25, d + (n - 0.5) * 0.5);
          a *= vA * vCamFade;
          if (a < 0.004) discard;
          vec3 V = normalize(cameraPosition - vWPos);
          float back = pow(max(dot(-V, uKeyDir), 0.0), 3.0);
          vec3 col;
          if (vKind < 0.5) {
            col = mix(uSnowShadow * 1.15, uSnowLit * uKeyColor * 0.85, 0.62) + ambient(vec3(0.0, 1.0, 0.0)) * 0.15;
            col += uKeyColor * back * 0.8;
          } else if (vKind < 1.5) {
            col = vec3(0.6, 1.6, 1.8) * 1.5; a *= 1.3;
          } else if (vKind < 2.5) {
            col = vec3(2.2, 1.7, 0.8); a *= 1.3;
          } else {
            col = mix(vec3(0.35, 0.36, 0.42), uAmbTop * 0.6, 0.4) + uKeyColor * back * 0.3;
            a *= 0.55;
          }
          col = applyFog(col, vWPos);
          gl_FragColor = vec4(col, a);
        }
      `,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  spawn(x, y, z, vx, vy, vz, life, s0, s1, a0, kind = 0, drag = 1.2, grav = 1.2) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else i = Math.floor(Math.random() * this.cap);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = 0; this.max[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.kind[i] = kind; this.rot[i] = Math.random() * 6.28;
    this.drag[i] = drag; this.grav[i] = grav;
  }

  update(dt) {
    let n = this.n;
    const P = this.pos, V = this.vel;
    for (let i = 0; i < n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.max[i]) {
        // swap-remove
        n--;
        const j = n;
        P[i * 3] = P[j * 3]; P[i * 3 + 1] = P[j * 3 + 1]; P[i * 3 + 2] = P[j * 3 + 2];
        V[i * 3] = V[j * 3]; V[i * 3 + 1] = V[j * 3 + 1]; V[i * 3 + 2] = V[j * 3 + 2];
        this.life[i] = this.life[j]; this.max[i] = this.max[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
        this.a0[i] = this.a0[j]; this.kind[i] = this.kind[j]; this.rot[i] = this.rot[j];
        this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j];
        i--;
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      V[i * 3] *= k; V[i * 3 + 1] = V[i * 3 + 1] * k - this.grav[i] * dt; V[i * 3 + 2] *= k;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
    }
    this.n = n;
    const ip = this.iPos.array, id = this.iData.array;
    for (let i = 0; i < n; i++) {
      const t = this.life[i] / this.max[i];
      ip[i * 3] = P[i * 3]; ip[i * 3 + 1] = P[i * 3 + 1]; ip[i * 3 + 2] = P[i * 3 + 2];
      id[i * 4] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
      id[i * 4 + 1] = this.a0[i] * Math.min(1, t * 8) * (1 - t) * (1 - t);
      id[i * 4 + 2] = this.rot[i] + t * 0.8;
      id[i * 4 + 3] = this.kind[i];
    }
    this.geo.instanceCount = n;
    this.iPos.needsUpdate = true;
    this.iData.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ snow clumps
class Clumps {
  constructor(scene, cap, dust) {
    this.cap = cap;
    this.dust = dust;
    this.n = 0;
    this.p = new Float32Array(cap * 3);
    this.v = new Float32Array(cap * 3);
    this.r = new Float32Array(cap * 3);
    this.w = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.rest = new Uint8Array(cap);
    const g = new THREE.IcosahedronGeometry(1, 0);
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const k = 1 + Math.sin(x * 5.1 + y * 3.3) * 0.18;
      pa.setXYZ(i, x * k, y * k * 0.8, z * k);
    }
    g.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...G },
      vertexShader: /* glsl */`
        varying vec3 vN;
        varying vec3 vWPos;
        void main() {
          // shrink clumps that fly right past the lens
          vec3 org = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float near = smoothstep(0.9, 3.0, distance(org, cameraPosition));
          vec4 wp = modelMatrix * instanceMatrix * vec4(position * near, 1.0);
          vN = normalize(mat3(instanceMatrix) * normal);
          vWPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */`
        ${GLSL_COMMON}
        varying vec3 vN;
        varying vec3 vWPos;
        void main() {
          vec3 N = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
          float lit = smoothstep(-0.1, 0.35, dot(N, uKeyDir));
          vec3 col = mix(uSnowShadow, uSnowLit * uKeyColor, lit) + ambient(N) * 0.08;
          vec3 V = normalize(cameraPosition - vWPos);
          col += uSnowShadow * 0.3 * pow(1.0 - max(dot(N, V), 0.0), 2.0);
          col = applyFog(col, vWPos);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      extensions: { derivatives: true },
    });
    this.mesh = new THREE.InstancedMesh(g, mat, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  spawn(x, y, z, vx, vy, vz, size, life) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else i = Math.floor(Math.random() * this.cap);
    this.p.set([x, y, z], i * 3);
    this.v.set([vx, vy, vz], i * 3);
    this.r.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
    this.w.set([rand(-9, 9), rand(-9, 9), rand(-9, 9)], i * 3);
    this.size[i] = size; this.life[i] = 0; this.max[i] = life; this.rest[i] = 0;
  }

  update(dt) {
    let n = this.n;
    const p = this.p, v = this.v, r = this.r, w = this.w;
    for (let i = 0; i < n; i++) {
      this.life[i] += dt;
      if (this.life[i] > this.max[i]) {
        n--;
        p.copyWithin(i * 3, n * 3, n * 3 + 3); v.copyWithin(i * 3, n * 3, n * 3 + 3);
        r.copyWithin(i * 3, n * 3, n * 3 + 3); w.copyWithin(i * 3, n * 3, n * 3 + 3);
        this.size[i] = this.size[n]; this.life[i] = this.life[n]; this.max[i] = this.max[n]; this.rest[i] = this.rest[n];
        i--;
        continue;
      }
      if (this.rest[i]) continue;
      const k = Math.exp(-0.6 * dt);
      v[i * 3] *= k; v[i * 3 + 2] *= k;
      v[i * 3 + 1] = v[i * 3 + 1] * k - 11 * dt;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      r[i * 3] += w[i * 3] * dt; r[i * 3 + 1] += w[i * 3 + 1] * dt; r[i * 3 + 2] += w[i * 3 + 2] * dt;
      if (v[i * 3 + 1] < 0) {
        const gh = heightAt(p[i * 3], p[i * 3 + 2]);
        if (p[i * 3 + 1] < gh + this.size[i] * 0.3) {
          p[i * 3 + 1] = gh + this.size[i] * 0.2;
          const sp = Math.hypot(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
          if (sp > 6 && this.size[i] > 0.12 && Math.random() < 0.6) {
            // break on impact: bounce and puff
            v[i * 3] *= 0.35; v[i * 3 + 2] *= 0.35; v[i * 3 + 1] = sp * 0.15;
            this.size[i] *= 0.7;
            this.dust.spawn(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], v[i * 3] * 0.5, 0.6, v[i * 3 + 2] * 0.5, 1.4, this.size[i] * 2, this.size[i] * 6, 0.35);
          } else {
            this.rest[i] = 1;
            this.max[i] = Math.min(this.max[i], this.life[i] + rand(1.5, 4));
          }
        }
      }
    }
    this.n = n;
    const m = this._m, q = this._q, e = this._e, pv = this._v, s = this._s;
    for (let i = 0; i < n; i++) {
      const t = this.life[i] / this.max[i];
      const shrink = this.rest[i] ? Math.min(1, (1 - t) * 3) : Math.min(1, this.life[i] * 12);
      const sz = this.size[i] * shrink;
      e.set(r[i * 3], r[i * 3 + 1], r[i * 3 + 2]);
      q.setFromEuler(e);
      pv.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      s.set(sz, sz, sz);
      m.compose(pv, q, s);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ falling snow
class Snowfall {
  constructor(scene, count) {
    const pos = new Float32Array(count * 3);
    const rnd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random();
      rnd[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...G, uBox: { value: 70 }, uAmount: { value: 0 }, uCam: { value: new THREE.Vector3() }, uPix: { value: 1 } },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */`
        uniform float uTime;
        uniform float uBox;
        uniform vec3 uCam;
        uniform float uAmount;
        uniform float uPix;
        attribute float aRnd;
        varying float vA;
        void main() {
          vec3 p = position * uBox;
          p.y -= uTime * (1.2 + aRnd * 1.3);
          p.x += uTime * 0.8 + sin(uTime * 0.7 + aRnd * 40.0) * 1.5;
          p.z += sin(uTime * 0.5 + aRnd * 17.0) * 1.2;
          p = mod(p - uCam + uBox * 0.5, uBox) + uCam - uBox * 0.5;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          gl_PointSize = clamp(uPix * (0.06 + aRnd * 0.05) * 600.0 / d, 1.0, 24.0);
          vA = uAmount * smoothstep(uBox * 0.5, uBox * 0.2, d) * step(aRnd, uAmount + 0.05);
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uSnowLit;
        uniform vec3 uKeyColor;
        uniform vec3 uAmbTop;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.2, d) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uSnowLit * (uKeyColor * 0.4 + uAmbTop * 0.8) + 0.3, a * 0.9);
        }
      `,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }
}

// ------------------------------------------------------------------ facade
export class Particles {
  constructor(scene, q) {
    this.dust = new Dust(scene, q.dust);
    this.clumps = new Clumps(scene, q.clumps, this.dust);
    this.snow = new Snowfall(scene, q.snowflakes);
    this.acc = 0;
    this.accC = 0;
    this.smokeAcc = 0;
  }

  /** Continuous spray from the skis. */
  spray(pl, dt) {
    if (pl.mode === 'crash') {
      if (pl.gap < 0.5 && pl.speed > 2) {
        this.acc += dt * pl.speed * 6;
        while (this.acc > 1) { this.acc--; this.puff(pl.pos, pl.vel, 1.0, 0.4); }
        this.accC += dt * pl.speed * 2;
        while (this.accC > 1) { this.accC--; this.clump(pl.pos, pl.vel, 0.25, 5); }
      }
      return;
    }
    if (!pl.grounded || pl.inAir || pl.gap > 0.3 || pl.mode === 'grind') return;
    const sp = pl.speed;
    if (sp < 2) return;
    const fresh = 0.35 + pl.fresh * 0.65;
    const skid = Math.min(pl.skid, 40);
    const carve = Math.min(pl.carve, 25);
    const rate = (sp * 1.6 + skid * 3.5 + carve * 2.2) * fresh;
    const crate = (sp * 0.35 + skid * 1.4 + carve * 0.8) * fresh;
    // spray leaves the outside of the turn
    const outSide = -Math.sign(pl.yawRate || 0.0001);
    const r = pl.right, f = pl.forward;
    const tailX = pl.pos.x - f.x * 0.5, tailZ = pl.pos.z - f.z * 0.5;
    this.acc += dt * rate;
    while (this.acc > 1) {
      this.acc--;
      const side = (Math.random() < 0.75 ? outSide : -outSide) * rand(0.6, 1.6) * (1 + skid * 0.04 + carve * 0.05);
      const vx = pl.vel.x * rand(0.15, 0.55) + r.x * side * rand(1, 3.5) + rand(-0.6, 0.6);
      const vz = pl.vel.z * rand(0.15, 0.55) + r.z * side * rand(1, 3.5) + rand(-0.6, 0.6);
      const vy = rand(0.8, 2.6) + skid * 0.05 + carve * 0.06;
      this.dust.spawn(tailX + rand(-0.3, 0.3), pl.pos.y + rand(-0.1, 0.25), tailZ + rand(-0.3, 0.3), vx, vy, vz,
        rand(0.7, 1.8), rand(0.25, 0.5), rand(1.0, 2.4) * (0.6 + fresh * 0.5), rand(0.16, 0.34) * fresh, 0, 1.6, 0.6);
    }
    this.accC += dt * crate;
    while (this.accC > 1) {
      this.accC--;
      const side = outSide * rand(0.5, 1.4) * (1 + skid * 0.05 + carve * 0.06);
      const vx = pl.vel.x * rand(0.35, 0.75) + r.x * side * rand(1.5, 4.5);
      const vz = pl.vel.z * rand(0.35, 0.75) + r.z * side * rand(1.5, 4.5);
      const vy = rand(1.5, 4.5) + carve * 0.08;
      this.clumps.spawn(tailX + rand(-0.25, 0.25), pl.pos.y + 0.05, tailZ + rand(-0.25, 0.25), vx, vy, vz, rand(0.05, 0.22) * (0.6 + fresh * 0.6), rand(2, 5));
    }
  }

  puff(p, v, power, a = 0.45) {
    this.dust.spawn(p.x + rand(-0.5, 0.5), p.y + rand(0, 0.5), p.z + rand(-0.5, 0.5),
      v.x * 0.3 + rand(-2, 2) * power, rand(0.5, 2.5) * power, v.z * 0.3 + rand(-2, 2) * power,
      rand(1.0, 2.2), rand(0.4, 0.8), rand(1.8, 3.6) * power, a * 0.7, 0, 1.6, 0.5);
  }

  clump(p, v, size, spread) {
    this.clumps.spawn(p.x + rand(-0.4, 0.4), p.y + 0.2, p.z + rand(-0.4, 0.4),
      v.x * 0.3 + rand(-spread, spread), rand(2, spread + 2), v.z * 0.3 + rand(-spread, spread), rand(0.06, size), rand(2, 5));
  }

  burst(p, v, power) {
    const n = Math.floor(10 + power * 20);
    for (let i = 0; i < n; i++) this.puff(p, v, 0.6 + power * 0.5, 0.5);
    for (let i = 0; i < n * 0.8; i++) this.clump(p, v, 0.12 + power * 0.12, 2 + power * 4);
  }

  sparkle(p, kind = 1) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.28, b = rand(-1, 1);
      const s = rand(3, 9);
      this.dust.spawn(p.x, p.y, p.z, Math.cos(a) * s * Math.sqrt(1 - b * b), b * s + 2, Math.sin(a) * s * Math.sqrt(1 - b * b),
        rand(0.6, 1.4), rand(0.15, 0.3), 0.02, 1, kind, 2.5, 3);
    }
  }

  smoke(cabins, dt, px, pz) {
    if (!cabins) return;
    this.smokeAcc += dt * 3;
    while (this.smokeAcc > 1) {
      this.smokeAcc--;
      for (const c of cabins) {
        if (Math.abs(c.x - px) > 250 || Math.abs(c.z - pz) > 250) continue;
        // chimney sits at local (W*0.25, H+3.3, -D*0.2), rotated with the cabin
        const yaw = -c.rot + Math.PI;
        const lx = 1.6, lz = -1.08;
        const x = c.x + Math.cos(yaw) * lx + Math.sin(yaw) * lz;
        const z = c.z - Math.sin(yaw) * lx + Math.cos(yaw) * lz;
        this.dust.spawn(x + rand(-0.1, 0.1), c.y + 6.4, z + rand(-0.1, 0.1), rand(0.3, 0.8), rand(0.8, 1.4), rand(-0.2, 0.2),
          rand(4, 7), 0.5, rand(3, 5), 0.5, 3, 0.3, -0.05);
      }
    }
  }

  update(dt, camPos, pal, pixelRatio) {
    this.dust.update(dt);
    this.clumps.update(dt);
    const u = this.snow.mat.uniforms;
    u.uCam.value.copy(camPos);
    u.uAmount.value = pal.snowfall;
    u.uPix.value = pixelRatio;
    this.snow.points.visible = pal.snowfall > 0.01;
  }
}
