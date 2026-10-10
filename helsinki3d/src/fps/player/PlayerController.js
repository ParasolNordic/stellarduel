// Pelaajan liike: kävely, juoksu, hyppy ja tähtäyksen hidastus. Törmäykset kapselilla BVH-geometriaa vasten,
// joten seinät, katot ja maaston muodot ovat tarkkoja. Ei kyykkyä, nojaamista eikä kiipeilyä (tarkoituksella).
import * as THREE from 'three';

export const EYE = 1.62, HEIGHT = 1.8, RADIUS = 0.34;
const WALK = 5.4, SPRINT = 8.4, ADS = 3.1, GRAV = 22, JUMP = 7.2, ACC_G = 70, ACC_A = 14;

// etumerkillinen etäisyys monikulmion reunaan: positiivinen sisällä, negatiivinen ulkona
function polyDist(P, x, z) {
  let inside = false, dmin = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    const dx = xj - xi, dz = zj - zi, t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / (dx * dx + dz * dz || 1)));
    dmin = Math.min(dmin, Math.hypot(x - (xi + dx * t), z - (zi + dz * t)));
  }
  return inside ? dmin : -dmin;
}

export class PlayerController {
  constructor(collider, world) {
    this.collider = collider; this.world = world;
    this.pos = new THREE.Vector3();          // jalat
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false; this.sprinting = false; this.moving = 0;
    this.keys = new Set();
    this.analog = null; this.sprintTouch = false;     // kosketusohjaus: { x: sivulle, y: eteen } −1..1
    this.speedMul = 1; this.ads = 0; this.canSprint = true;
    this.bob = 0; this.landKick = 0; this.airTime = 0;
    this.onLand = null; this.onStep = null;
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._wish = new THREE.Vector3(); this._dl = new THREE.Vector3();
    const b = world.bounds;
    this.lim = { x0: b.min.x + 3, x1: b.max.x - 3, z0: b.min.z + 3, z1: b.max.z - 3 };
    // vientialueen monikulmio (jos manifestissa): maastoa on vain sen sisällä, joten liike rajataan 3 m reunasta
    this.poly = world.manifest && world.manifest.area_polygon_local_xz || null;
    this.water = world.manifest && world.manifest.water_polygons_local_xz || [];   // meri: ei kävelyä veden päällä
    this.lastGround = new THREE.Vector3();
  }
  // onko vaakapiste pelialueella (monikulmion sisällä vähintään margin metrin päässä reunasta)
  validXZ(x, z, margin = 3, waterMargin = margin > 3 ? 3 : 0.4) {
    for (const W of this.water) if (polyDist(W, x, z) > -waterMargin) return false;   // veden päällä tai rannan rajalla
    const P = this.poly; if (!P) return true;
    let inside = false, dmin = Infinity;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [xi, zi] = P[i], [xj, zj] = P[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
      const dx = xj - xi, dz = zj - zi, t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / (dx * dx + dz * dz || 1)));
      dmin = Math.min(dmin, Math.hypot(x - (xi + dx * t), z - (zi + dz * t)));
    }
    return inside && dmin >= margin;
  }
  teleport(p, yaw = this.yaw) { this.pos.copy(p); this.vel.set(0, 0, 0); this.yaw = yaw; this.pitch = 0; this.onGround = false; }
  look(dx, dy) { this.yaw -= dx; this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -1.5, 1.5); }
  jump() { if (this.onGround) { this.vel.y = JUMP; this.onGround = false; } }

  update(dt, active = true) {
    const k = this.keys;
    let f = 0, s = 0;
    if (active) { if (k.has('KeyW') || k.has('ArrowUp')) f++; if (k.has('KeyS') || k.has('ArrowDown')) f--; if (k.has('KeyD') || k.has('ArrowRight')) s++; if (k.has('KeyA') || k.has('ArrowLeft')) s--; }
    let mag = 1;
    if (active && this.analog) { f = this.analog.y; s = this.analog.x; mag = Math.min(1, Math.hypot(f, s)); }
    const wantSprint = active && (k.has('ShiftLeft') || k.has('ShiftRight') || this.sprintTouch) && f > 0 && this.canSprint && this.ads < 0.3;
    this.sprinting = wantSprint && this.onGround ? true : (this.sprinting && wantSprint);
    const target = (this.sprinting ? SPRINT : THREE.MathUtils.lerp(WALK, ADS, this.ads)) * this.speedMul;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const w = this._wish.set(-sy * f + cy * s, 0, -cy * f - sy * s);
    if (w.lengthSq() > 0) w.normalize().multiplyScalar(target * mag);
    const acc = (this.onGround ? ACC_G : ACC_A) * dt;
    const dx = w.x - this.vel.x, dz = w.z - this.vel.z, dl = Math.hypot(dx, dz);
    if (dl > 0) { const m = Math.min(1, acc / dl); this.vel.x += dx * m; this.vel.z += dz * m; }

    // painovoima ja liike muutamassa alivaiheessa (nopeat putoamiset eivät läpäise pintoja)
    const steps = 2, h = dt / steps;
    let grounded = false;
    for (let i = 0; i < steps; i++) {
      this.vel.y -= GRAV * h;
      const px = this.pos.x, pz = this.pos.z;
      this.pos.addScaledVector(this.vel, h);
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, this.lim.x0, this.lim.x1);
      this.pos.z = THREE.MathUtils.clamp(this.pos.z, this.lim.z0, this.lim.z1);
      if (this.poly && !this.validXZ(this.pos.x, this.pos.z)) {      // alueen reuna: liu'utaan reunaa pitkin
        if (this.validXZ(this.pos.x, pz)) { this.pos.z = pz; this.vel.z = 0; }
        else if (this.validXZ(px, this.pos.z)) { this.pos.x = px; this.vel.x = 0; }
        else { this.pos.x = px; this.pos.z = pz; this.vel.x = this.vel.z = 0; }
      }
      const a = this._a.copy(this.pos).setY(this.pos.y + RADIUS), b = this._b.copy(this.pos).setY(this.pos.y + HEIGHT - RADIUS);
      const d = this.collider.collideCapsule(a, b, RADIUS, this._dl);
      this.pos.add(d);
      if (d.y > Math.abs(h * this.vel.y * 0.25) && d.y > 1e-5) grounded = true;
      // työntö ylöspäin = maa, alaspäin = katto; pystysuora nopeus nollataan vastaavasti
      if (d.lengthSq() > 1e-10) {
        const n = d.clone().normalize();
        const vn = this.vel.dot(n); if (vn < 0) this.vel.addScaledVector(n, -vn);
      }
    }
    // varmistus: jos jalat painuvat maaston alle (rako mallissa), nostetaan pintaan
    const gy = this.world.heightAt(this.pos.x, this.pos.z);
    if (gy !== null && this.pos.y < gy - 0.5) { this.pos.y = gy; this.vel.y = Math.max(0, this.vel.y); grounded = true; }

    if (grounded && !this.onGround && this.airTime > 0.25 && this.onLand) this.onLand(Math.min(1, this.airTime / 1.0));
    if (grounded) { this.airTime = 0; if (this.vel.y < 0) this.vel.y = 0; this.lastGround.copy(this.pos); } else this.airTime += dt;
    // turvaverkko: jos pelaaja putoaa mallin aukosta maailman alle, palautetaan viimeiseen maakohtaan
    if (this.pos.y < this.world.bounds.min.y - 30 && this.lastGround.lengthSq() > 0) { this.pos.copy(this.lastGround); this.vel.set(0, 0, 0); }
    this.onGround = grounded || (this.onGround && this.airTime < 0.08);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.moving = this.onGround ? Math.min(1, sp / WALK) : 0;
    const prev = this.bob;
    this.bob += sp * dt * (this.sprinting ? 1.25 : 1.6);
    if (this.onStep && this.onGround && sp > 1 && Math.floor(prev / Math.PI) !== Math.floor(this.bob / Math.PI)) this.onStep(this.sprinting);
  }
  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z); }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
}
