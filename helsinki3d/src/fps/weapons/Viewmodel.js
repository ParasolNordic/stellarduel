// Asekuva (viewmodel): piirretään omana näkymänään kaupungin päälle, joten ase ei koskaan leikkaudu seiniin.
// Hoitaa tähtäyksen (ADS) siirtymän, rekyylijouset, heilunnan, kävelykeinunnan, juoksuasennon, aseen vaihdon,
// lataus- ja lukkoanimaatiot, suuliekin, hylsyt ja kiikarin kuvan suurennoksen (picture-in-picture).
import * as THREE from 'three';
import { buildWeaponModel, materials } from './WeaponModels.js';
import { particleAtlas } from '../fx/textures.js';

const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
const seg = (t, a, b) => ease((t - a) / (b - a));           // 0→1 välillä a..b
const bump = (t, a, b, c, d) => seg(t, a, b) * (1 - seg(t, c, d)); // nousee a..b, laskee c..d
const VM_FOV = 52;

class Spring {
  constructor(k = 160, c = 18) { this.x = new THREE.Vector3(); this.v = new THREE.Vector3(); this.k = k; this.c = c; }
  impulse(x, y, z) { this.v.x += x; this.v.y += y; this.v.z += z; }
  update(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
    for (let i = 0; i < n; i++) { this.v.addScaledVector(this.x, -this.k * h).multiplyScalar(Math.max(0, 1 - this.c * h)); this.x.addScaledVector(this.v, h); }
  }
}

// kiikarin linssin varjostin: suurennettu kuva, ristikko millipisteineen ja silmäetäisyyden mukaan siirtyvä varjoreuna
const LENS_FRAG = /* glsl */`
uniform sampler2D tMap; uniform vec2 uShift; uniform float uDark; uniform float uLit;
varying vec2 vUv;
float line(float d, float w){ float f = fwidth(d); return 1.0 - smoothstep(w - f, w + f, abs(d)); }
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  vec3 col = texture2D(tMap, vUv).rgb;
  float a = 0.0;
  float ax = abs(p.x), ay = abs(p.y);
  a = max(a, line(p.y, 0.004) * step(ax, 0.98));
  a = max(a, line(p.x, 0.004) * step(ay, 0.98));
  a = max(a, line(p.y, 0.018) * step(0.42, ax));                     // paksut reunatolpat
  a = max(a, line(p.x, 0.018) * step(0.42, p.y) );
  a = max(a, line(p.x, 0.018) * step(p.y, -0.42));
  for (int i = 1; i <= 4; i++) {                                     // millipisteet
    float o = float(i) * 0.085;
    a = max(a, 1.0 - smoothstep(0.008, 0.013, length(vec2(ax - o, p.y))));
    a = max(a, 1.0 - smoothstep(0.008, 0.013, length(vec2(p.x, ay - o))));
  }
  col = mix(col, vec3(0.0), a * 0.92);
  float dot = 1.0 - smoothstep(0.006, 0.011, length(p));
  col = mix(col, vec3(4.0, 0.25, 0.15), dot * uLit);
  float r = length(p - uShift);
  col *= smoothstep(1.0, 0.82, r) * (1.0 - uDark);
  col *= smoothstep(1.0, 0.93, length(p));
  col += vec3(0.02, 0.03, 0.05) * pow(1.0 - length(p), 3.0) * 0.4;   // linssin heijaste
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const LENS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

export class Viewmodel {
  constructor(renderer, defs) {
    this.renderer = renderer; this.defs = defs;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(VM_FOV, innerWidth / innerHeight, 0.01, 5);
    this.sun = new THREE.DirectionalLight(0xffffff, 2); this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xdcebf7, 0x6b675a, 0.5); this.scene.add(this.hemi);
    this.holder = new THREE.Group(); this.scene.add(this.holder);
    this.models = defs.map(d => { const w = buildWeaponModel(d); w.root.visible = false; this.holder.add(w.root); return w; });
    this.cur = 0; this.models[0].root.visible = true;
    this.posS = new Spring(170, 16); this.rotS = new Spring(150, 14); this.swayS = new Spring(90, 12);
    this.ads = 0; this.sprint = 0; this.time = 0; this.flashT = 0; this.slideT = 1;
    this.lift = 1;            // 1 = ase ylhäällä, 0 = laskettu (vaihto)
    this.reload = null;       // { t: 0..1, kind }
    this.cycle = null;        // { t: 0..1 }
    this.throwT = -1;
    this.shadow = 1;
    this.lensScreen = { x: 0, y: 0, r: 0, visible: false };
    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
    this.buildFlash(); this.buildCasings(); this.buildScope();
  }

  buildFlash() {
    const tex = particleAtlas();
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, color: 0xffd9a0 });
    const plane = (w, h) => { const g = new THREE.PlaneGeometry(w, h); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.25 + uv.getX(i) * 0.25, uv.getY(i) * 0.5); return g; };
    this.flash = new THREE.Group();
    const front = new THREE.Mesh(plane(0.12, 0.12), mat); this.flash.add(front);
    for (const r of [0, Math.PI / 2]) { const g = new THREE.Group(); g.rotation.z = r; const s = new THREE.Mesh(plane(0.07, 0.2), mat); s.rotation.x = Math.PI / 2; s.position.z = -0.08; g.add(s); this.flash.add(g); }
    this.flash.visible = false; this.flash.renderOrder = 6;
    this.flash.traverse(o => { o.renderOrder = 6; o.frustumCulled = false; });
  }
  buildCasings() {
    const m = materials();
    this.casings = [];
    const geos = {
      short: new THREE.CylinderGeometry(0.0045, 0.0045, 0.019, 8).rotateZ(Math.PI / 2),
      rifle: new THREE.CylinderGeometry(0.005, 0.0055, 0.045, 8).rotateZ(Math.PI / 2),
      long: new THREE.CylinderGeometry(0.0065, 0.007, 0.065, 8).rotateZ(Math.PI / 2),
      shell: new THREE.CylinderGeometry(0.01, 0.01, 0.065, 10).rotateZ(Math.PI / 2),
    };
    for (let i = 0; i < 24; i++) {
      const g = new THREE.Group();
      const meshes = {};
      for (const [k, geo] of Object.entries(geos)) { const mm = new THREE.Mesh(geo, k === 'shell' ? m.red : m.brass); mm.visible = false; g.add(mm); meshes[k] = mm; }
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.016, 10).rotateZ(Math.PI / 2), m.brass); base.position.x = -0.025; base.visible = false; g.add(base); meshes.shellBase = base;
      g.visible = false; this.scene.add(g);
      this.casings.push({ g, meshes, v: new THREE.Vector3(), w: new THREE.Vector3(), t: 0 });
    }
    this.casingI = 0;
  }
  buildScope() {
    this.scopeRT = new THREE.WebGLRenderTarget(768, 768, { type: THREE.HalfFloatType, samples: 4 });
    this.scopeCam = new THREE.PerspectiveCamera(10, 1, 0.5, 3000);
    this.lensMat = new THREE.ShaderMaterial({ vertexShader: LENS_VERT, fragmentShader: LENS_FRAG,
      uniforms: { tMap: { value: this.scopeRT.texture }, uShift: { value: new THREE.Vector2() }, uDark: { value: 0 }, uLit: { value: 1 } } });
    for (const w of this.models) if (w.lens) w.lens.material = this.lensMat;
  }

  get model() { return this.models[this.cur]; }
  setWeapon(i) {
    this.models[this.cur].root.visible = false; this.cur = i; this.models[i].root.visible = true;
    this.reload = null; this.cycle = null; this.resetParts();
    if (this.flash.parent) this.flash.parent.remove(this.flash);
    this.model.muzzle.add(this.flash);
  }
  resetParts() {
    const w = this.model, p = w.parts;
    if (p.mag) { p.mag.position.set(0, 0, 0); p.mag.rotation.set(0, 0, 0); p.mag.visible = true; }
    if (p.slide) p.slide.position.z = 0;
    if (p.bolt) { p.bolt.position.z = p.bolt.userData.z0 ?? (p.bolt.userData.z0 = p.bolt.position.z); p.bolt.rotation.z = 0; }
    if (p.pump) p.pump.position.z = 0;
    if (p.cover) p.cover.rotation.x = 0;
    w.hands.left.position.copy(w.hands.leftHome);
  }
  setRocketVisible(v) { const r = this.model.parts.rocket; if (r) { r.visible = v; r.position.z = -0.6; } }

  // laukaus: rekyylijouset, suuliekki, lukon liike, hylsy
  fire(def, adsAmount) {
    const r = def.recoil, a = 1 - adsAmount * 0.45;
    const ra = 1 - adsAmount * 0.6;
    this.posS.impulse((Math.random() - 0.5) * 0.1 * a, r.kick * 6 * a, r.kick * 15);
    this.rotS.impulse(r.kick * 30 * (0.8 + Math.random() * 0.4) * ra, (Math.random() - 0.5) * r.kick * 12 * ra, (Math.random() - 0.5) * r.roll * 0.12 * ra);
    this.flashT = 0.05; this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    const s = def.id === 'shotgun' ? 1.6 : def.id === 'launcher' ? 2.4 : def.id === 'smg' || def.id === 'pistol' ? 0.8 : 1.1;
    this.flash.scale.setScalar(s * (0.8 + Math.random() * 0.4));
    this.slideT = 0;
    if (!def.cycle && this.model.casing) this.ejectCasing(this.model.casing);
  }
  ejectCasing(kind) {
    const c = this.casings[this.casingI++ % this.casings.length], w = this.model;
    for (const m of Object.values(c.meshes)) m.visible = false;
    c.meshes[kind].visible = true; if (kind === 'shell') c.meshes.shellBase.visible = true;
    w.eject.getWorldPosition(c.g.position);
    w.root.getWorldQuaternion(this._q);
    c.g.quaternion.copy(this._q);
    c.v.set(1.1 + Math.random() * 0.5, 0.9 + Math.random() * 0.5, 0.15 + Math.random() * 0.2).applyQuaternion(this._q);
    c.w.set(Math.random() * 20, Math.random() * 30, 10 + Math.random() * 20);
    c.t = 0.8; c.g.visible = true;
  }
  startReload(def) { this.reload = { t: 0, kind: def.reloadMode === 'shell' ? 'shell' : def.id }; this.cycle = null; }
  setReloadProgress(t) { if (this.reload) this.reload.t = t; }
  endReload() { this.reload = null; this.resetParts(); }
  startCycle() { this.cycle = { t: 0, ejected: false }; }
  setCycleProgress(t) { if (this.cycle) this.cycle.t = t; }
  endCycle() { this.cycle = null; const p = this.model.parts; if (p.bolt) { p.bolt.position.z = p.bolt.userData.z0 ?? p.bolt.position.z; p.bolt.rotation.z = 0; } if (p.pump) p.pump.position.z = 0; }
  startThrow() { this.throwT = 0; }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }

  // s: { ads, sprint, moving, bob, onGround, dx, dy, breath, landKick, def }
  update(dt, s) {
    this.time += dt;
    const w = this.model, def = s.def, p = w.parts;
    this.ads += ((s.ads ? 1 : 0) - this.ads) * Math.min(1, dt / Math.max(0.05, def.adsTime) * 2.6);
    if (Math.abs(this.ads - (s.ads ? 1 : 0)) < 0.002) this.ads = s.ads ? 1 : 0;
    this.sprint += ((s.sprint ? 1 : 0) - this.sprint) * Math.min(1, dt * 9);
    const A = ease(this.ads), SP = this.sprint * (1 - A);

    // heilunta hiiren liikkeestä (tähdätessä hyvin vähän)
    const swayK = 0.9 * (1 - A * 0.85);
    this.swayS.impulse(-s.dy * swayK * 3, -s.dx * swayK * 3, -s.dx * swayK * 2);
    this.posS.update(dt); this.rotS.update(dt); this.swayS.update(dt);

    // perusasento: tähtäyspiste lonkalta → silmän eteen
    const target = this._v.copy(w.hip).lerp(new THREE.Vector3(0, 0, -w.eye), A);
    let rx = 0, ry = 0.035 * (1 - A), rz = 0.03 * (1 - A);
    // kävely ja juoksu
    const mv = s.moving * (s.onGround ? 1 : 0.2), bobA = (1 - A * 0.88) * mv;
    target.x += Math.sin(s.bob) * 0.011 * bobA * (1 + SP * 0.8);
    target.y += -Math.abs(Math.cos(s.bob)) * 0.009 * bobA * (1 + SP * 1.4) + Math.sin(this.time * 1.7) * 0.0018 * (1 - A * 0.8);
    rz += Math.sin(s.bob) * 0.02 * bobA;
    // juoksuasento: ase kallistuu alas ja sivulle
    target.x += -0.03 * SP; target.y += -0.05 * SP; target.z += 0.03 * SP;
    rx += -0.32 * SP; ry += 0.65 * SP; rz += 0.25 * SP;
    // laskeutumisen notkahdus
    target.y -= s.landKick * 0.04;
    // vaihto: ase laskeutuu ruudun alle
    const L = ease(this.lift);
    target.y -= (1 - L) * 0.32; rx -= (1 - L) * 0.9;
    // heitto: ase painuu alas hetkeksi
    if (this.throwT >= 0) { this.throwT += dt / 0.55; const b = bump(this.throwT, 0, 0.2, 0.6, 1); target.y -= b * 0.25; rx -= b * 0.7; if (this.throwT >= 1) this.throwT = -1; }

    // lataus
    const R = this.reload;
    if (R) {
      const t = R.t, tilt = bump(t, 0, 0.15, 0.85, 1);
      if (R.kind === 'shell') { rz += 0.35 * tilt + Math.sin(t * Math.PI * 2) * 0.03; rx += 0.12 * tilt; target.y -= 0.02 * tilt; }
      else {
        rz += 0.4 * tilt; rx += 0.18 * tilt; target.x -= 0.02 * tilt; target.y -= 0.025 * tilt;
        if (R.kind === 'launcher') {
          const rk = p.rocket; if (rk) { rk.visible = t > 0.35; rk.position.z = -0.6 - (1 - seg(t, 0.4, 0.78)) * 0.5; }
          w.hands.left.position.copy(w.hands.leftHome).add(new THREE.Vector3(0, 0.06, -0.3 * bump(t, 0.25, 0.4, 0.8, 0.9)));
        } else if (p.mag) {
          const out = seg(t, 0.12, 0.35), back = seg(t, 0.55, 0.82);
          const d = out * (1 - back);
          p.mag.position.set(-0.02 * d, -0.3 * d, 0.05 * d); p.mag.rotation.set(0.4 * d, 0, -0.3 * d);
          p.mag.visible = !(t > 0.38 && t < 0.52);
          const hand = new THREE.Vector3(0, -0.04, -0.12).add(p.mag.position);
          const hb = bump(t, 0.05, 0.14, 0.82, 0.95);
          w.hands.left.position.copy(w.hands.leftHome).lerp(hand.add(new THREE.Vector3(-0.01, -0.02, 0.0)), hb);
          if (R.kind === 'lmg' && p.cover) p.cover.rotation.x = -1.1 * bump(t, 0.05, 0.15, 0.85, 0.95);
          if (R.kind === 'sniper' && p.bolt) { const b = bump(t, 0.02, 0.1, 0.88, 0.97); p.bolt.rotation.z = 1.1 * b; p.bolt.position.z = (p.bolt.userData.z0 ?? 0.04) + 0.06 * bump(t, 0.08, 0.14, 0.82, 0.9); }
          if ((R.kind === 'smg' || R.kind === 'rifle') && p.bolt) p.bolt.position.z = 0.04 * bump(t, 0.86, 0.9, 0.93, 0.97);
          if (R.kind === 'pistol' && p.slide) p.slide.position.z = 0.025 * bump(t, 0.84, 0.88, 0.92, 0.96);
        }
      }
    }
    // lukon / pumpun käyttö laukausten välissä
    const C = this.cycle;
    if (C) {
      const t = C.t;
      if (p.pump) { p.pump.position.z = 0.085 * bump(t, 0.05, 0.4, 0.5, 0.85); rx += 0.05 * bump(t, 0, 0.3, 0.6, 1); }
      if (p.bolt && def.id === 'sniper') {
        const z0 = p.bolt.userData.z0 ?? (p.bolt.userData.z0 = p.bolt.position.z);
        p.bolt.rotation.z = 1.1 * bump(t, 0.02, 0.2, 0.8, 0.96);
        p.bolt.position.z = z0 + 0.07 * bump(t, 0.2, 0.42, 0.55, 0.78);
        rz += 0.12 * bump(t, 0, 0.2, 0.8, 1); target.y -= 0.012 * bump(t, 0, 0.2, 0.8, 1);
      }
      if (!C.ejected && t > 0.42 && w.casing) { C.ejected = true; this.ejectCasing(w.casing); }
    }
    // pistoolin luisti / konepistoolin lukko laukauksessa
    if (this.slideT < 1) { this.slideT = Math.min(1, this.slideT + dt / 0.07); const k = Math.sin(this.slideT * Math.PI); if (p.slide) p.slide.position.z = 0.026 * k; }

    // hengitys / kiikarin heilunta näkyy asekuvassa vain vähän (itse tähtäys heiluu kamerassa)
    w.root.position.copy(target).sub(w.sight).add(this.posS.x);
    // pyöritys tähtäyspisteen ympäri, jotta tähtäin pysyy linjassa
    this._e.set(rx + this.rotS.x.x + this.swayS.x.x * 0.6, ry + this.rotS.x.y + this.swayS.x.y * 0.6, rz + this.rotS.x.z + this.swayS.x.z * 0.5, 'YXZ');
    w.root.quaternion.setFromEuler(this._e);
    const pivot = target.clone().add(this.posS.x);
    w.root.position.copy(w.sight).negate().applyQuaternion(w.root.quaternion).add(pivot);

    // suuliekki
    if (this.flashT > 0) { this.flashT -= dt; this.flash.visible = this.flashT > 0; }
    // hylsyt
    for (const c of this.casings) {
      if (c.t <= 0) continue;
      c.t -= dt; if (c.t <= 0) { c.g.visible = false; continue; }
      c.v.y -= 9.5 * dt; c.g.position.addScaledVector(c.v, dt);
      c.g.rotation.x += c.w.x * dt; c.g.rotation.y += c.w.y * dt; c.g.rotation.z += c.w.z * dt;
    }
    this.camera.fov = VM_FOV; this.camera.updateProjectionMatrix();
  }

  // valaistus seuraa kaupungin aurinkoa; varjossa (rakennuksen takana) asekuva tummuu
  syncLights(lighting, scene, shadowed) {
    this.shadow += ((shadowed ? 0.18 : 1) - this.shadow) * 0.15;
    this.sun.position.copy(lighting.sunDir).multiplyScalar(5);
    this.sun.target.position.set(0, 0, 0);
    this.sun.color.copy(lighting.sun.color); this.sun.intensity = lighting.sun.intensity * this.shadow;
    this.hemi.color.copy(lighting.hemi.color); this.hemi.groundColor.copy(lighting.hemi.groundColor); this.hemi.intensity = lighting.hemi.intensity * 1.2;
    this.scene.environment = scene.environment; this.scene.environmentIntensity = (scene.environmentIntensity ?? 0.5) * (0.55 + 0.45 * this.shadow);
  }
  // kameran suunnan muutos maailmassa → valo asekuvan avaruuteen (asekuva on kameran koordinaatistossa)
  setWorldToView(camera) {
    this._q.copy(camera.quaternion).invert();
    this.sun.position.applyQuaternion(this._q);
  }

  // kiikarin kuva: lasketaan linssin koko ruudulla ja valitaan kameran näkökenttä niin, että suurennos on
  // todellinen suhteessa normaaliin 75° näkymään
  renderScope(renderer, scene, mainCam, zoom, baseFov) {
    const w = this.model;
    if (!w.lens || this.ads < 0.15) { this.lensScreen.visible = false; return false; }
    const c = w.lens.getWorldPosition(this._v);
    const H = renderer.domElement.clientHeight || innerHeight, W = renderer.domElement.clientWidth || innerWidth;
    const f = (H / 2) / Math.tan(THREE.MathUtils.degToRad(VM_FOV / 2));
    const rpx = w.lensRadius / -c.z * f;
    this.lensScreen = { x: W / 2 + c.x / -c.z * f, y: H / 2 - c.y / -c.z * f, r: rpx, visible: true };
    const tanBase = Math.tan(THREE.MathUtils.degToRad(baseFov / 2));
    const tanHalf = (2 * rpx) * tanBase / (H * zoom);
    this.scopeCam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanHalf));
    this.scopeCam.position.copy(mainCam.position); this.scopeCam.quaternion.copy(mainCam.quaternion);
    this.scopeCam.updateProjectionMatrix(); this.scopeCam.updateMatrixWorld();
    const sh = new THREE.Vector2((this.lensScreen.x - W / 2) / rpx, -(this.lensScreen.y - H / 2) / rpx);
    this.lensMat.uniforms.uShift.value.copy(sh).multiplyScalar(0.7);
    this.lensMat.uniforms.uDark.value = (1 - ease(this.ads)) * 0.7;
    const au = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.scopeRT); renderer.clear(); renderer.render(scene, this.scopeCam); renderer.setRenderTarget(null);
    renderer.shadowMap.autoUpdate = au;
    return true;
  }
  render(renderer) { renderer.clearDepth(); renderer.render(this.scene, this.camera); }
}
