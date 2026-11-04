import * as THREE from 'three';

// Свободный полёт камеры: ПК (мышь + клавиатура) и сенсорный экран.
export class FlyControls {
  constructor(camera, dom, groundAt) {
    this.camera = camera;
    this.dom = dom;
    this.groundAt = groundAt;
    this.yaw = 0;
    this.pitch = -0.15;
    this.speed = 30;
    this.vel = new THREE.Vector3();
    this.keys = new Set();
    this.move = { x: 0, y: 0 };      // джойстик
    this.vertical = 0;               // кнопки вверх/вниз
    this.enabled = true;
    this.limit = 6500;
    this.transition = null;
    this.onUserInput = () => {};
    this._bind();
  }

  lookAt(target) {
    const d = new THREE.Vector3().subVectors(target, this.camera.position).normalize();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  }

  flyTo(pos, look, duration = 2.2) {
    const d = new THREE.Vector3().subVectors(look, pos).normalize();
    this.transition = {
      t: 0, duration,
      fromPos: this.camera.position.clone(), toPos: pos.clone(),
      fromYaw: this.yaw, fromPitch: this.pitch,
      toYaw: Math.atan2(-d.x, -d.z), toPitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)),
    };
    let dy = this.transition.toYaw - this.transition.fromYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.transition.toYaw = this.transition.fromYaw + dy;
  }

  _bind() {
    const dom = this.dom;
    const isTouch = matchMedia('(pointer: coarse)').matches;
    this.isTouch = isTouch;

    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.onUserInput();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    // мышь: клик — захват курсора; без захвата можно тянуть зажатой кнопкой
    let dragging = false, lx = 0, ly = 0;
    dom.addEventListener('mousedown', (e) => {
      if (isTouch) return;
      if (dom.requestPointerLock && document.pointerLockElement !== dom) {
        dom.requestPointerLock();
      }
      dragging = true; lx = e.clientX; ly = e.clientY;
    });
    addEventListener('mouseup', () => { dragging = false; });
    addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      let dx = 0, dy = 0;
      if (document.pointerLockElement === dom) { dx = e.movementX; dy = e.movementY; }
      else if (dragging) { dx = e.clientX - lx; dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; }
      else return;
      this.yaw -= dx * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0022, -1.5, 1.5);
      this.transition = null;
      this.onUserInput();
    });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.speed = THREE.MathUtils.clamp(this.speed * (e.deltaY > 0 ? 0.85 : 1.18), 3, 400);
      this.onSpeed && this.onSpeed(this.speed);
    }, { passive: false });

    // сенсор: левая половина — джойстик, правая — обзор
    const joy = document.getElementById('joy');
    const knob = document.getElementById('joyKnob');
    let joyId = null, lookId = null, jx = 0, jy = 0, tx = 0, ty = 0;
    dom.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.45 && joyId === null) {
          joyId = t.identifier; jx = t.clientX; jy = t.clientY;
          if (joy) { joy.style.left = (jx - 60) + 'px'; joy.style.top = (jy - 60) + 'px'; joy.classList.add('on'); }
        } else if (lookId === null) {
          lookId = t.identifier; tx = t.clientX; ty = t.clientY;
        }
      }
      this.onUserInput();
      e.preventDefault();
    }, { passive: false });
    dom.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) {
          let dx = t.clientX - jx, dy = t.clientY - jy;
          const l = Math.hypot(dx, dy), max = 55;
          if (l > max) { dx *= max / l; dy *= max / l; }
          this.move.x = dx / max; this.move.y = -dy / max;
          if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
        } else if (t.identifier === lookId) {
          this.yaw -= (t.clientX - tx) * 0.005;
          this.pitch = THREE.MathUtils.clamp(this.pitch - (t.clientY - ty) * 0.005, -1.5, 1.5);
          tx = t.clientX; ty = t.clientY;
          this.transition = null;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) {
          joyId = null; this.move.x = 0; this.move.y = 0;
          if (knob) knob.style.transform = '';
          if (joy) joy.classList.remove('on');
        }
        if (t.identifier === lookId) lookId = null;
      }
    };
    dom.addEventListener('touchend', end);
    dom.addEventListener('touchcancel', end);
  }

  update(dt) {
    const cam = this.camera;
    if (this.transition) {
      const tr = this.transition;
      tr.t += dt / tr.duration;
      const k = THREE.MathUtils.smootherstep(Math.min(1, tr.t), 0, 1);
      cam.position.lerpVectors(tr.fromPos, tr.toPos, k);
      // дуга вверх, чтобы не пролетать сквозь гору
      const lift = Math.sin(k * Math.PI) * Math.min(250, tr.fromPos.distanceTo(tr.toPos) * 0.25);
      cam.position.y += lift;
      this.yaw = THREE.MathUtils.lerp(tr.fromYaw, tr.toYaw, k);
      this.pitch = THREE.MathUtils.lerp(tr.fromPitch, tr.toPitch, k);
      if (tr.t >= 1) this.transition = null;
    } else if (this.enabled) {
      const k = this.keys;
      const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + this.move.y;
      const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.move.x;
      const u = (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') || k.has('KeyC') || k.has('ControlLeft') ? 1 : 0) + this.vertical;
      const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1;
      const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const target = new THREE.Vector3()
        .addScaledVector(fwd, f).addScaledVector(right, r).addScaledVector(new THREE.Vector3(0, 1, 0), u);
      if (target.lengthSq() > 1) target.normalize();
      target.multiplyScalar(this.speed * boost);
      this.vel.lerp(target, 1 - Math.exp(-dt * 6));
      cam.position.addScaledVector(this.vel, dt);
    }
    // не уходим под снег и за пределы мира
    const g = this.groundAt(cam.position.x, cam.position.z) + 1.6;
    if (cam.position.y < g) { cam.position.y = g; if (this.vel.y < 0) this.vel.y = 0; }
    cam.position.x = THREE.MathUtils.clamp(cam.position.x, -this.limit, this.limit);
    cam.position.z = THREE.MathUtils.clamp(cam.position.z, -this.limit, this.limit);
    cam.position.y = Math.min(cam.position.y, 3500);
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }
}

// Автоматический облёт по кругу вокруг горы с плавными изменениями высоты.
export class Tour {
  constructor(controls, groundAt, center) {
    this.c = controls; this.groundAt = groundAt; this.center = center;
    this.active = false; this.t = 0;
  }
  start() { this.active = true; this.t = 0; this.c.transition = null; }
  stop() { this.active = false; }
  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const a = this.t * 0.035 + 1.2;
    const R = 520 + Math.sin(this.t * 0.07) * 260;
    const x = this.center.x + Math.cos(a) * R;
    const z = this.center.z + 380 + Math.sin(a) * R * 0.95;
    const y = Math.max(this.groundAt(x, z) + 35 + Math.sin(this.t * 0.11) * 25, 0);
    const cam = this.c.camera;
    const target = new THREE.Vector3(x, y, z);
    cam.position.lerp(target, 1 - Math.exp(-dt * 1.5));
    const look = new THREE.Vector3(this.center.x + Math.cos(a + 0.5) * R * 0.3, this.groundAt(this.center.x, this.center.z + 300) + 60, this.center.z + 300);
    const d = look.sub(cam.position).normalize();
    const yaw = Math.atan2(-d.x, -d.z), pitch = Math.asin(d.y);
    let dy = yaw - this.c.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const k = 1 - Math.exp(-dt * 1.2);
    this.c.yaw += dy * k;
    this.c.pitch += (pitch - this.c.pitch) * k;
  }
}
