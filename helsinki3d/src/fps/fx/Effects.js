// Visuaaliset tapahtumat: luotien osumat (reiät, pöly, kipinät), valojuovat, räjähdykset (välähdys, tulipallo,
// savu, pöly, kipinät, sirpaleet, paineaalto, kameran tärinä) ja lentävien ammusten savuvana.
// Valot ovat valmiiksi lisättyjä ja uudelleenkäytettäviä, jotta varjostimia ei käännetä uudelleen kesken pelin.
import * as THREE from 'three';
import { Particles } from './Particles.js';
import { FRAME, bulletHoleTexture } from './textures.js';
import { materials } from '../weapons/WeaponModels.js';

const R = (a, b) => a + Math.random() * (b - a);
const SMOKE = [0.42, 0.41, 0.40], DUST = [0.52, 0.47, 0.40], PLASTER = [0.72, 0.68, 0.62];

export class Effects {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.particles = new Particles(scene, { ground: (x, z) => world.heightAt(x, z) });
    this.shake = 0; this.timeScale = 1;
    // valot: suuliekki + kaksi räjähdystä
    this.lights = [];
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffb060, 0, 30, 2); l.castShadow = false; scene.add(l); this.lights.push({ l, t: 0, dur: 1, peak: 0 }); }
    // luodinreiät: instanssoitu taso, rengaspuskuri
    this.holeMax = 500; this.holeI = 0;
    const hm = new THREE.MeshStandardMaterial({ map: bulletHoleTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 1 });
    this.holes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), hm, this.holeMax);
    this.holes.count = 0; this.holes.frustumCulled = false; this.holes.receiveShadow = true; scene.add(this.holes);
    // sirpaleet (lentävät palat räjähdyksessä)
    this.debrisMax = 160; this.debris = [];
    const m = materials();
    this.debrisMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x6d655a, roughness: 0.95 }), this.debrisMax);
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.debrisMesh.count = 0; this.debrisMesh.castShadow = true; this.debrisMesh.frustumCulled = false; scene.add(this.debrisMesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this._z = new THREE.Vector3(0, 0, 1);
    this.trails = [];
    void m;
  }

  flashLight(p, peak, dur, color = 0xffb060, dist = 30) {
    let best = this.lights[0];
    for (const L of this.lights) if (L.t <= 0) { best = L; break; } else if (L.peak * (L.t / L.dur) < best.peak * (best.t / best.dur)) best = L;
    best.l.position.copy(p); best.l.color.set(color); best.l.distance = dist; best.t = best.dur = dur; best.peak = peak; best.l.intensity = peak;
  }

  // ---------- luodit ----------
  tracer(from, to, color = [1, 0.85, 0.55]) {
    const d = new THREE.Vector3().subVectors(to, from), len = d.length(); if (len < 2) return;
    const speed = 420; d.divideScalar(len);
    const start = from.clone().addScaledVector(d, Math.min(3, len * 0.2));
    this.particles.emit({ additive: true, p: start.toArray(), v: d.clone().multiplyScalar(speed).toArray(), life: Math.max(0.03, (len - 3) / speed), size: 0.035, stretch: 0.012, frame: FRAME.DOT, color, alpha: 0.9, alpha1: 0.6, fadeIn: 0 });
  }
  impact(p, n, kind, opts = {}) {
    const P = this.particles, pa = p.toArray();
    const col = kind === 'buildings' ? PLASTER : DUST;
    for (let i = 0; i < 4; i++) {
      const v = n.clone().multiplyScalar(R(0.6, 2.2)).add(new THREE.Vector3(R(-0.6, 0.6), R(0, 0.8), R(-0.6, 0.6)));
      P.emit({ p: pa, v: v.toArray(), life: R(0.6, 1.4), size: R(0.08, 0.16), size1: R(0.5, 0.9), color: col, alpha: 0.55, frame: FRAME.DUST, drag: 2.5, g: -0.4, rotV: R(-1, 1) });
    }
    if (kind === 'buildings' || Math.random() < 0.4) for (let i = 0; i < 5; i++) {
      const v = n.clone().multiplyScalar(R(2, 6)).add(new THREE.Vector3(R(-3, 3), R(-1, 3), R(-3, 3)));
      P.emit({ additive: true, p: pa, v: v.toArray(), life: R(0.1, 0.3), size: 0.025, stretch: 0.02, frame: FRAME.SPARK, color: [1, 0.75, 0.4], g: -9.8, bounce: 0.3 });
    }
    for (let i = 0; i < 3; i++) P.emit({ p: pa, v: n.clone().multiplyScalar(R(1, 3)).add(new THREE.Vector3(R(-1, 1), R(-0.5, 1.5), R(-1, 1))).toArray(), life: R(0.5, 0.9), size: 0.025, size1: 0.02, color: [0.25, 0.22, 0.2], alpha: 1, alpha1: 1, frame: FRAME.DOT, g: -9.8, bounce: 0.2, fadeIn: 0 });
    if (!opts.noHole) this.hole(p, n, opts.size || 0.11);
  }
  hole(p, n, size) {
    const i = this.holeI++ % this.holeMax;
    this._q.setFromUnitVectors(this._z, n);
    const spin = new THREE.Quaternion().setFromAxisAngle(this._z, Math.random() * 6.28); this._q.multiply(spin);
    this._p.copy(p).addScaledVector(n, 0.01); this._s.set(size, size, size);
    this._m.compose(this._p, this._q, this._s); this.holes.setMatrixAt(i, this._m);
    this.holes.count = Math.min(this.holeMax, Math.max(this.holes.count, i + 1)); this.holes.instanceMatrix.needsUpdate = true;
  }
  playerHit(p, color) {
    const c = new THREE.Color(color), col = [c.r, c.g, c.b];
    for (let i = 0; i < 6; i++) this.particles.emit({ additive: true, p: p.toArray(), v: [R(-2, 2), R(-1, 2.5), R(-2, 2)], life: R(0.15, 0.35), size: R(0.05, 0.12), size1: 0.02, color: col, frame: FRAME.DOT });
    this.particles.emit({ p: p.toArray(), v: [0, 0.3, 0], life: 0.5, size: 0.15, size1: 0.6, color: [0.5, 0.45, 0.42], alpha: 0.35, frame: FRAME.SMOKE });
  }
  muzzle(p, dir, big = 1) {
    this.flashLight(p, 6 * big, 0.06, 0xffc070, 12);
    this.particles.emit({ p: p.toArray(), v: dir.clone().multiplyScalar(1.5).toArray(), life: R(0.5, 0.9), size: 0.08 * big, size1: 0.5 * big, color: [0.62, 0.6, 0.58], alpha: 0.18, frame: FRAME.SMOKE, drag: 2, g: 0.3 });
  }
  // muiden pelaajien suuliekki maailmassa
  remoteMuzzle(p, dir) {
    this.particles.emit({ additive: true, p: p.toArray(), life: 0.05, size: 0.45, color: [1, 0.8, 0.5], frame: FRAME.FLASH, fadeIn: 0 });
    this.muzzle(p, dir, 0.8);
  }

  // ---------- räjähdys ----------
  explosion(p, n, kind, listenerPos) {
    const big = kind === 'rocket', S = big ? 1 : 0.85, P = this.particles, pa = p.toArray();
    const up = n.y > 0.5 ? new THREE.Vector3(0, 1, 0) : n.clone();
    this.flashLight(new THREE.Vector3().copy(p).addScaledVector(n, 1.2), 90 * S, 0.45, 0xffa050, 45);
    // välähdys ja tulipallo
    P.emit({ additive: true, p: pa, life: 0.16, size: 10 * S, size1: 13 * S, color: [1, 0.95, 0.8], frame: FRAME.FLASH, fadeIn: 0 });
    P.emit({ additive: true, p: pa, life: 0.3, size: 6 * S, size1: 9 * S, color: [1, 0.85, 0.6], frame: FRAME.DOT, fadeIn: 0 });
    for (let i = 0; i < 34; i++) {
      const d = new THREE.Vector3(R(-1, 1), R(-0.2, 1), R(-1, 1)).normalize().add(up.clone().multiplyScalar(0.7)).normalize();
      P.emit({ additive: true, p: new THREE.Vector3().copy(p).addScaledVector(d, R(0, 0.8)).toArray(), v: d.multiplyScalar(R(3, 12) * S).toArray(), life: R(0.45, 1.05), size: R(1.6, 3) * S, size1: R(3.5, 6) * S,
        color: [1, 0.78, 0.42], color1: [0.65, 0.16, 0.03], frame: FRAME.FIRE, drag: 4, g: 3, rotV: R(-2, 2), fadeIn: 0.02 });
    }
    // nouseva tulipatsas
    for (let i = 0; i < 10; i++) {
      const v = up.clone().multiplyScalar(R(4, 10) * S).add(new THREE.Vector3(R(-1.5, 1.5), 0, R(-1.5, 1.5)));
      P.emit({ additive: true, p: pa, v: v.toArray(), life: R(0.7, 1.3), size: R(1.2, 2) * S, size1: R(2.5, 4) * S, color: [1, 0.7, 0.35], color1: [0.5, 0.1, 0.02], frame: FRAME.FIRE, drag: 2.5, g: 2, rotV: R(-1, 1), fadeIn: 0.05 });
    }
    // savupatsas: tumma ydin, nousee ja laajenee hitaasti
    for (let i = 0; i < 36; i++) {
      const d = new THREE.Vector3(R(-1, 1), R(0, 1), R(-1, 1)).normalize().add(up.clone().multiplyScalar(1.1));
      const dark = R(0.07, 0.2);
      P.emit({ p: new THREE.Vector3().copy(p).addScaledVector(d, R(0.2, 1.5)).toArray(), v: d.multiplyScalar(R(1.5, 6) * S).toArray(), life: R(6, 11), size: R(2, 3.4) * S, size1: R(6, 11) * S,
        color: [dark, dark * 0.95, dark * 0.9], color1: SMOKE, alpha: R(0.6, 0.85), alpha1: 0, frame: Math.random() < 0.5 ? FRAME.SMOKE : FRAME.SMOKE2, drag: 1.4, g: R(0.6, 1.4), rotV: R(-0.3, 0.3), fadeIn: 0.04 });
    }
    // maasta nouseva pölyrengas
    if (n.y > 0.5) for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2 + R(-0.1, 0.1), v = new THREE.Vector3(Math.cos(a), R(0.05, 0.25), Math.sin(a)).multiplyScalar(R(7, 13) * S);
      P.emit({ p: [p.x, p.y + 0.3, p.z], v: v.toArray(), life: R(2.5, 4.5), size: R(1, 1.6) * S, size1: R(3.5, 5.5) * S, color: DUST, color1: [0.6, 0.56, 0.5], alpha: 0.5, frame: FRAME.DUST, drag: 2.8, g: 0.15, rotV: R(-0.4, 0.4) });
    }
    // kipinät ja hehkuvat sirpaleet
    for (let i = 0; i < 90; i++) {
      const v = new THREE.Vector3(R(-1, 1), R(-0.1, 1), R(-1, 1)).normalize().add(up.clone().multiplyScalar(0.3)).multiplyScalar(R(10, 32) * S);
      P.emit({ additive: true, p: pa, v: v.toArray(), life: R(0.4, 1.6), size: R(0.03, 0.06), stretch: 0.025, frame: FRAME.SPARK, color: [1, 0.8, 0.45], color1: [1, 0.35, 0.1], g: -9.8, drag: 0.4, bounce: 0.35, fadeIn: 0 });
    }
    // paineaalto maassa
    if (n.y > 0.5) P.emit({ additive: true, p: [p.x, p.y + 0.4, p.z], life: 0.22, size: 1, size1: 14 * S, color: [0.35, 0.3, 0.26], alpha: 0.3, frame: FRAME.RING, fadeIn: 0 });
    // fyysiset sirpaleet
    const cnt = big ? 34 : 22;
    for (let i = 0; i < cnt; i++) {
      const v = new THREE.Vector3(R(-1, 1), R(0.2, 1), R(-1, 1)).normalize().add(n.clone().multiplyScalar(0.5)).normalize().multiplyScalar(R(5, 15));
      this.addDebris(p.clone().addScaledVector(n, 0.3), v, R(0.04, 0.12));
    }
    // kameran tärinä etäisyyden mukaan
    if (listenerPos) { const d = listenerPos.distanceTo(p); this.shake = Math.max(this.shake, Math.min(1.2, (big ? 14 : 11) / (d + 4))); }
  }
  // konetykin räjähtävä ammus: pieni välähdys, tulipallo, savu ja pöly (kevyt, toistuu tiheään)
  miniBlast(p, n) {
    const P = this.particles, pa = p.toArray(), up = n.y > 0.5 ? new THREE.Vector3(0, 1, 0) : n.clone();
    this.flashLight(new THREE.Vector3().copy(p).addScaledVector(n, 0.6), 30, 0.18, 0xffa050, 18);
    P.emit({ additive: true, p: pa, life: 0.1, size: 3.2, size1: 4.5, color: [1, 0.92, 0.75], frame: FRAME.FLASH, fadeIn: 0 });
    for (let i = 0; i < 8; i++) {
      const d = new THREE.Vector3(R(-1, 1), R(0, 1), R(-1, 1)).normalize().add(up.clone().multiplyScalar(0.6)).normalize();
      P.emit({ additive: true, p: pa, v: d.multiplyScalar(R(2, 6)).toArray(), life: R(0.25, 0.5), size: R(0.6, 1.1), size1: R(1.4, 2.2), color: [1, 0.75, 0.4], color1: [0.5, 0.12, 0.02], frame: FRAME.FIRE, drag: 4, fadeIn: 0 });
    }
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Vector3(R(-1, 1), R(0, 1), R(-1, 1)).normalize().add(up);
      P.emit({ p: pa, v: d.multiplyScalar(R(0.8, 2.5)).toArray(), life: R(2.5, 4.5), size: R(0.8, 1.4), size1: R(2.5, 4), color: [0.2, 0.19, 0.18], color1: SMOKE, alpha: 0.55, alpha1: 0, frame: FRAME.SMOKE, drag: 1.5, g: 0.6, fadeIn: 0.04 });
    }
    for (let i = 0; i < 14; i++) {
      const v = new THREE.Vector3(R(-1, 1), R(0, 1), R(-1, 1)).normalize().add(up.clone().multiplyScalar(0.3)).multiplyScalar(R(6, 18));
      P.emit({ additive: true, p: pa, v: v.toArray(), life: R(0.2, 0.6), size: R(0.025, 0.045), stretch: 0.02, frame: FRAME.SPARK, color: [1, 0.8, 0.45], color1: [1, 0.35, 0.1], g: -9.8, drag: 0.4, fadeIn: 0 });
    }
    for (let i = 0; i < 4; i++) this.addDebris(p.clone().addScaledVector(n, 0.2), new THREE.Vector3(R(-1, 1), R(0.4, 1), R(-1, 1)).normalize().multiplyScalar(R(3, 8)), R(0.03, 0.07));
  }
  // vaurioituneen ajoneuvon savu
  smokePuff(p) {
    this.particles.emit({ p: p.toArray(), v: [R(-0.3, 0.3), R(1.5, 2.5), R(-0.3, 0.3)], life: R(3, 5), size: R(0.8, 1.2), size1: R(3, 4.5), color: [0.12, 0.12, 0.12], color1: SMOKE, alpha: 0.6, alpha1: 0, frame: FRAME.SMOKE, drag: 1.2, g: 0.8, fadeIn: 0.05 });
  }
  addDebris(p, v, s) {
    if (this.debris.length >= this.debrisMax) this.debris.shift();
    this.debris.push({ p, v, s, r: new THREE.Euler(R(0, 6), R(0, 6), 0), w: new THREE.Vector3(R(-12, 12), R(-12, 12), R(-12, 12)), t: R(4, 7), rest: false });
  }
  // lentävän ammuksen savuvana ja liekki
  trail(p, dir, kind) {
    const P = this.particles, pa = p.toArray();
    if (kind === 'rocket') {
      P.emit({ additive: true, p: pa, v: dir.clone().multiplyScalar(-6).toArray(), life: 0.08, size: 0.5, size1: 0.25, color: [1, 0.75, 0.4], frame: FRAME.FIRE, fadeIn: 0 });
      P.emit({ p: pa, v: [R(-0.3, 0.3), R(0, 0.4), R(-0.3, 0.3)], life: R(2, 3.5), size: 0.25, size1: R(1.4, 2.2), color: [0.75, 0.74, 0.72], alpha: 0.42, frame: FRAME.SMOKE, drag: 1.5, g: 0.2, rotV: R(-0.5, 0.5) });
    } else if (Math.random() < 0.3) P.emit({ p: pa, life: 0.6, size: 0.06, size1: 0.25, color: [0.7, 0.7, 0.7], alpha: 0.2, frame: FRAME.SMOKE });
  }
  // jäljen päälle jäävä kytevä savu ja hiillos hetkeksi
  smolder(p, dur = 10) { this.trails.push({ p: p.clone(), t: dur, acc: 0 }); }

  update(dt, camera) {
    dt *= this.timeScale;
    for (const L of this.lights) {
      if (L.t <= 0) continue;
      L.t -= dt; const k = Math.max(0, L.t / L.dur);
      L.l.intensity = L.peak * k * k * (0.85 + Math.random() * 0.15);
      if (L.t <= 0) L.l.intensity = 0;
    }
    // sirpaleet
    let n = 0;
    for (let i = 0; i < this.debris.length; i++) {
      const d = this.debris[i];
      d.t -= dt;
      if (d.t <= 0) { this.debris.splice(i, 1); i--; continue; }
      if (!d.rest) {
        d.v.y -= 20 * dt; d.p.addScaledVector(d.v, dt);
        d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
        const g = this.world.heightAt(d.p.x, d.p.z);
        if (g !== null && d.p.y < g + d.s * 0.6) { d.p.y = g + d.s * 0.6; d.v.y *= -0.3; d.v.x *= 0.5; d.v.z *= 0.5; d.w.multiplyScalar(0.5); if (Math.abs(d.v.y) < 0.8) d.rest = true; }
      }
      const shrink = Math.min(1, d.t / 0.8);
      this._q.setFromEuler(d.r); this._s.setScalar(d.s * shrink);
      this._m.compose(d.p, this._q, this._s); this.debrisMesh.setMatrixAt(n++, this._m);
    }
    this.debrisMesh.count = n; this.debrisMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.trails.length; i++) {
      const s = this.trails[i]; s.t -= dt; s.acc += dt;
      if (s.t <= 0) { this.trails.splice(i, 1); i--; continue; }
      if (s.acc > 0.25) {
        s.acc = 0; const k = s.t / 10;
        this.particles.emit({ p: [s.p.x + R(-0.6, 0.6), s.p.y + 0.2, s.p.z + R(-0.6, 0.6)], v: [R(-0.2, 0.2), R(0.6, 1.2), R(-0.2, 0.2)], life: R(3, 5), size: 0.5, size1: R(2.5, 3.5), color: [0.3, 0.29, 0.28], color1: [0.55, 0.55, 0.55], alpha: 0.35 * k + 0.08, frame: FRAME.SMOKE2, drag: 0.6, g: 0.3, rotV: R(-0.3, 0.3) });
        if (Math.random() < 0.6 * k) this.particles.emit({ additive: true, p: [s.p.x + R(-0.5, 0.5), s.p.y + 0.05, s.p.z + R(-0.5, 0.5)], v: [0, R(0.2, 0.8), 0], life: R(0.4, 0.9), size: R(0.1, 0.25), size1: 0.05, color: [1, 0.45, 0.12], frame: FRAME.FIRE });
      }
    }
    this.particles.update(dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    void camera;
  }
}
