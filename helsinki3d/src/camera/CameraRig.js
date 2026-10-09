// Kamera ja liikkuminen: karttanäkymä (OrbitControls), FPV-lento ja kävely maanpintaa seuraten.
// Toiminta vastaa v0.1-katselinta; maanpinnan korkeus haetaan maailman korkeusruudukosta (ei raycastia).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const UP = new THREE.Vector3(0, 1, 0);
export const HOME_VIEW = { position: new THREE.Vector3(245, 205, 260), target: new THREE.Vector3(0, 8, 0) };

export class CameraRig extends EventTarget {
  constructor(domElement, { getHeight = () => null } = {}) {
    super();
    this.dom = domElement;
    this.getHeight = getHeight;
    this.camera = new THREE.PerspectiveCamera(61, window.innerWidth / window.innerHeight, 0.08, 6000);
    this.camera.position.copy(HOME_VIEW.position);
    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.target.copy(HOME_VIEW.target);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 5; this.controls.maxDistance = 1800;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.update();
    this.mode = 'orbit'; this.speed = 45; this.yaw = 0; this.pitch = 0; this.eye = 1.75;
    this.keys = new Set();
    this._f = new THREE.Vector3(); this._r = new THREE.Vector3(); this._m = new THREE.Vector3(); this._d = new THREE.Vector3();
    this.bindInput();
  }

  bindInput() {
    window.addEventListener('keydown', e => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && this.mode !== 'orbit') e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'Digit1') this.setMode('orbit');
      if (e.code === 'Digit2') this.setMode('fly');
      if (e.code === 'Digit3') this.setMode('walk');
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.dom.addEventListener('click', () => { if (this.mode !== 'orbit' && document.pointerLockElement !== this.dom) this.dom.requestPointerLock?.(); });
    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== this.dom || this.mode === 'orbit') return;
      this.yaw -= e.movementX * 0.0021;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0021, -Math.PI / 2 + 0.045, Math.PI / 2 - 0.045);
    });
    window.addEventListener('resize', () => { this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix(); });
  }

  setMode(next) {
    this.mode = next;
    this.controls.enabled = next === 'orbit';
    if (next === 'walk') { const h = this.getHeight(this.camera.position.x, this.camera.position.z); this.camera.position.y = h === null ? 9 : h + this.eye; }
    if (next !== 'orbit') {
      this.camera.getWorldDirection(this._d);
      this.yaw = Math.atan2(-this._d.x, -this._d.z);
      this.pitch = Math.asin(THREE.MathUtils.clamp(this._d.y, -1, 1));
    }
    if (next === 'orbit' && document.pointerLockElement === this.dom) document.exitPointerLock();
    this.dispatchEvent(new CustomEvent('mode', { detail: next }));
  }

  // kameran asettaminen suoraan (mittaukset, myöhemmin pelit)
  setPose(position, lookAt) {
    this.camera.position.copy(position);
    if (this.mode === 'orbit') { this.controls.target.copy(lookAt); this.controls.update(); }
    else { this._d.subVectors(lookAt, position).normalize(); this.yaw = Math.atan2(-this._d.x, -this._d.z); this.pitch = Math.asin(this._d.y); }
    this.camera.lookAt(lookAt);
  }

  reset() { this.setMode('orbit'); this.camera.position.copy(HOME_VIEW.position); this.controls.target.copy(HOME_VIEW.target); this.controls.update(); }

  update(dt) {
    if (this.mode === 'orbit') { this.controls.update(); return; }
    const c = this.camera, k = this.keys;
    this._d.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    c.lookAt(this._m.copy(c.position).add(this._d));
    this._f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._r.crossVectors(this._f, UP).normalize();
    this._m.set(0, 0, 0);
    if (k.has('KeyW') || k.has('ArrowUp')) this._m.add(this._f);
    if (k.has('KeyS') || k.has('ArrowDown')) this._m.sub(this._f);
    if (k.has('KeyD') || k.has('ArrowRight')) this._m.add(this._r);
    if (k.has('KeyA') || k.has('ArrowLeft')) this._m.sub(this._r);
    const shift = k.has('ShiftLeft') || k.has('ShiftRight');
    let rate = this.speed * (shift ? 3 : 1);
    if (this.mode === 'walk') rate = Math.min(this.speed, 8) * (shift ? 1.8 : 1);
    if (this._m.lengthSq()) c.position.addScaledVector(this._m.normalize(), dt * rate);
    if (this.mode === 'fly') {
      if (k.has('KeyE') || k.has('Space')) c.position.y += dt * rate;
      if (k.has('KeyQ') || k.has('ControlLeft')) c.position.y -= dt * rate;
    } else {
      const g = this.getHeight(c.position.x, c.position.z);
      if (g !== null) c.position.y = THREE.MathUtils.lerp(c.position.y, g + this.eye, Math.min(1, dt * 12));
    }
  }
}
