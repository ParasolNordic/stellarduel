// Ajoneuvot: NC-4 panssariajoneuvo (konetykki katolla), NC-H6 kevyt helikopteri (konetykit + raketit) ja moottoripyörä.
// Kuljettajan selain simuloi liikkeen ja lähettää tilan palvelimelle 20 Hz; muut näkevät ajoneuvon interpoloituna.
// Palvelin päättää, kuka ajaa, laskee kestävyyden ja tuhoaa ajoneuvon. Mallit: public/vehicles/*.glb (+manifest).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { VEHICLES, VEHICLE_WEAPONS, HELI_ROCKETS } from '../shared.js';

const DELAY = 110, D2R = Math.PI / 180;
const APC = { acc: 7, brake: 14, rev: 5, max: 17, maxRev: 6, steer: 30 * D2R, wheelbase: 3.5, track: 2.0, wheelR: 0.625 };
const HELI = { acc: 16, maxH: 44, vAcc: 7, vMax: 9, turn: 2.4, ceiling: 140 };
const MOTO = { acc: 9, brake: 16, rev: 2.5, max: 30, maxRev: 3, steer: 32 * D2R, wheelbase: 1.74, rF: 0.386, rR: 0.392, steerAxis: new THREE.Vector3(0, -0.832, 0.555).normalize() };
// törmäyslaatikot (ajoneuvon omat koordinaatit, manifestien mukaan)
const BOXES = {
  apc: [[[-1.2, 0.48, -3.1], [1.2, 2.45, 1.8]], [[-1.18, 0.78, 1.8], [1.18, 1.62, 3.13]], [[-0.45, 2.45, 0], [0.45, 3.36, 0.9]]],
  moto: [[[-0.45, 0.1, -1.0], [0.45, 1.15, 1.5]]],
  heli: [[[-0.72, 0.5, -1.9], [0.72, 2.55, 1.95]], [[-0.45, 1.0, -4.85], [0.45, 2.75, -1.9]], [[-1.0, 0, -0.4], [1.0, 0.9, 2.3]], [[-1.83, 0.42, 0], [1.83, 1.05, 1.62]]],
};
const fwdOf = h => new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// läpikuultava roottorikiekko nopeaan pyörimiseen (lapojen välkynnän sijaan)
function rotorDisc(radius) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  gr.addColorStop(0, 'rgba(30,30,30,0.0)'); gr.addColorStop(0.15, 'rgba(30,30,30,0.35)'); gr.addColorStop(0.92, 'rgba(30,30,30,0.22)'); gr.addColorStop(1, 'rgba(30,30,30,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = 8; return m;
}

export class Vehicles {
  constructor({ scene, world, collider, sound, fx, player, weapons, avatars, net }) {
    Object.assign(this, { scene, world, collider, sound, fx, player, weapons, avatars, net });
    this.templates = {}; this.list = new Map(); this.myId = null; this.myColor = null;
    this.mine = null;                     // ajoneuvo, jota tämä selain ohjaa
    this.aim = new THREE.Vector3(); this.fireAcc = 0; this.rockets = HELI_ROCKETS.count; this.rocketCd = 0; this.reloadT = 0; this.rocketReloadT = 0;
    this.stAcc = 0; this.side = 0; this.ammo = { 8: VEHICLE_WEAPONS[8].mag, 9: VEHICLE_WEAPONS[9].mag };
    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._m = new THREE.Matrix4();
  }
  async load() {
    const loader = new GLTFLoader();
    for (const [type, def] of Object.entries(VEHICLES)) {
      const gltf = await loader.loadAsync(def.file);
      gltf.scene.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        const mn = o.material && o.material.name || '';
        if (mn.endsWith('INVISIBLE')) { o.visible = false; return; }                     // moottoripyörän näkymätön apuverkko
        if (mn.endsWith('rayon')) { o.material.alphaTest = 0.5; o.material.transparent = false; }   // pinnat
        else if (o.material && o.material.transparent) { o.material.forceSinglePass = true; o.castShadow = false; }
        if (o.isSkinnedMesh) o.frustumCulled = false;
      });
      this.templates[type] = gltf.scene;
    }
  }
  // palvelimen lista: [{ id, type, p: [x, y|null, z], h, driver, hp, alive }]
  setList(list) {
    for (const d of list) {
      let v = this.list.get(d.id);
      if (!v) v = this.create(d);
      v.driver = d.driver; v.hp = d.hp; v.dis = !!d.dis;
      if (v.alive !== d.alive) { v.alive = d.alive; v.obj.visible = d.alive; if (d.alive) { this.place(v, d); v.buf.length = 0; } }
      if (!d.driver && v.buf.length === 0) this.place(v, d);
    }
    // oma ajoneuvo: aloitetaan palvelimen tilasta
    const m = [...this.list.values()].find(v => v.driver === this.myId && v.alive) || null;
    if (m !== this.mine) {
      if (this.mine) { this.mine.local = false; this.mine.buf.length = 0; }
      this.mine = m;
      if (m) { m.local = true; m.vel.set(0, 0, 0); m.speed = 0; this.aim.copy(m.pos).add(fwdOf(m.h).multiplyScalar(30)); }
    }
  }
  create(d) {
    const tpl = this.templates[d.type], obj = VEHICLES[d.type].skinned ? cloneSkinned(tpl) : tpl.clone(true);
    obj.rotation.order = 'YXZ';
    const n = name => obj.getObjectByName(name);
    const v = { id: d.id, type: d.type, obj, buf: [], pos: new THREE.Vector3(), h: d.h || 0, pi: 0, ro: 0, ty: 0, tp: 0, vel: new THREE.Vector3(), speed: 0, steer: 0, rpm: 0,
      driver: d.driver, hp: d.hp, alive: d.alive, local: false, wheelRot: 0, snd: null };
    if (d.type === 'apc') {
      v.nodes = { turret: n('Turret'), cradle: n('Cradle'), muzzle: n('Muzzle'), steer: [n('Steer_FL'), n('Steer_FR')], wheels: ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'].map(n) };
    } else if (d.type === 'moto') {
      v.nodes = { front: n('FRONT-TIRE_07'), rear: n('REAR-TIRE_09'), fork: n('Fouche_06') };
    } else {
      v.nodes = { rotor: n('MainRotor'), tail: n('TailRotor'), guns: [n('Muzzle_Gun_L'), n('Muzzle_Gun_R')], pods: [n('Rocket_L'), n('Rocket_R')] };
      v.disc = rotorDisc(4.04); v.disc.position.set(0, 2.67, 0); v.disc.visible = false; obj.add(v.disc);
    }
    this.scene.add(obj); this.list.set(d.id, v);
    this.place(v, d);
    return v;
  }
  place(v, d) {
    const x = d.p[0], z = d.p[2];
    const y = d.p[1] !== null && d.p[1] !== undefined ? d.p[1] : (this.groundAt(x, z, 60) ?? this.world.heightAt(x, z) ?? 0);
    let yy = y;
    if (v.type === 'heli' && !d.driver && d.p[1] !== null && d.p[1] !== undefined) yy = this.groundAt(x, z, 3, y) ?? y;   // ilmaan jäänyt kuljettajaton kopteri maahan
    v.pos.set(x, yy, z); v.h = d.h || 0; v.fallY = Infinity; v.crashed = false; v.pi = v.ro = 0; this.applyTransform(v);
  }
  groundAt(x, z, from = 6, y0 = null) {
    const top = (y0 ?? this.world.heightAt(x, z) ?? 0) + from;
    const hit = this.collider.raycast(this._v.set(x, top, z), new THREE.Vector3(0, -1, 0), from + 80);
    return hit ? hit.point.y : null;
  }
  // tilannekuva: [id, pos, h, pi, ro, ty, tp, driver, hp, alive, s, r]
  push(V) {
    const now = performance.now();
    for (const [id, p, h, pi, ro, ty, tp, driver, hp, alive, s, r, dis] of V) {
      const v = this.list.get(id); if (!v) continue;
      v.hp = hp; v.dis = !!dis;
      if (v.local || !alive || p[1] === null) continue;
      if (!driver && v.buf.length && v.buf[v.buf.length - 1].p[0] === p[0] && v.buf[v.buf.length - 1].p[2] === p[2]) { v.buf[v.buf.length - 1].t = now; continue; }
      v.buf.push({ t: now, p, h, pi, ro, ty, tp, s, r }); if (v.buf.length > 30) v.buf.shift();
    }
  }
  nearestFree(pos) {
    let best = null, bd = Infinity;
    for (const v of this.list.values()) {
      if (!v.alive || v.driver) continue;
      const d = Math.hypot(pos.x - v.pos.x, pos.z - v.pos.z);
      if (d < VEHICLES[v.type].enterRadius && Math.abs(pos.y - v.pos.y) < 4 && d < bd) { bd = d; best = v; }
    }
    return best;
  }
  // paikka, johon kuljettaja jää ulos noustessa (kylki, ei seinän sisällä eikä vedessä)
  exitSpot(v) {
    const right = new THREE.Vector3(-Math.cos(v.h), 0, Math.sin(v.h)), f = fwdOf(v.h);
    const [sd, fb] = v.type === 'moto' ? [1.3, 1.9] : [2.8, 4.5];
    for (const off of [right.clone().multiplyScalar(-sd), right.clone().multiplyScalar(sd), f.clone().multiplyScalar(-fb), f.clone().multiplyScalar(fb)]) {
      const p = v.pos.clone().add(off);
      if (!this.player.validXZ(p.x, p.z, 1.5)) continue;
      const g = this.groundAt(p.x, p.z, Math.max(6, v.pos.y - (this.world.heightAt(p.x, p.z) ?? 0) + 3));
      if (g === null) continue;
      if (this.collider.clear(v.pos.clone().setY(v.pos.y + 1.5), new THREE.Vector3(p.x, g + 1.2, p.z))) return new THREE.Vector3(p.x, g + 0.1, p.z);
    }
    return v.pos.clone().add(new THREE.Vector3(0, v.type === 'apc' ? 2.6 : v.type === 'moto' ? 1.2 : 0.2, 0));   // katolle / paikalleen
  }

  // ---------- osumat ----------
  raycast(o, d, maxD, excludeId = null) {
    let best = null;
    const inv = new THREE.Matrix4(), lo = new THREE.Vector3(), ld = new THREE.Vector3();
    for (const v of this.list.values()) {
      if (!v.alive || v.id === excludeId || !v.obj.visible) continue;
      if (v.pos.distanceTo(o) > maxD + 10) continue;
      v.obj.updateMatrixWorld(); inv.copy(v.obj.matrixWorld).invert();
      lo.copy(o).applyMatrix4(inv); ld.copy(d).transformDirection(inv);
      for (const [mn, mx] of BOXES[v.type]) {
        let t0 = 0, t1 = maxD, ok = true;
        for (let k = 0; k < 3 && ok; k++) {
          const oo = lo.getComponent(k), dd = ld.getComponent(k);
          if (Math.abs(dd) < 1e-9) { if (oo < mn[k] || oo > mx[k]) ok = false; continue; }
          let a = (mn[k] - oo) / dd, b = (mx[k] - oo) / dd; if (a > b) [a, b] = [b, a];
          t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) ok = false;
        }
        if (ok && (!best || t0 < best.dist)) best = { id: v.id, v, dist: t0, point: o.clone().addScaledVector(d, t0) };
      }
    }
    return best;
  }
  near(p, r, excludeId = null) {   // raketin lähiosuma
    for (const v of this.list.values()) if (v.alive && v.id !== excludeId && v.pos.distanceTo(p) < r + (v.type === 'apc' ? 3.2 : v.type === 'moto' ? 1.3 : 3.5) && p.y > v.pos.y - 0.5 && p.y < v.pos.y + 3.5) return v;
    return null;
  }
  // jalankulkija ei kävele ajoneuvon läpi
  pushOut(pos, radius) {
    for (const v of this.list.values()) {
      if (!v.alive || v.local) continue;
      const dx = pos.x - v.pos.x, dz = pos.z - v.pos.z;
      const lxx = dx * Math.cos(v.h) - dz * Math.sin(v.h), lzz = dx * Math.sin(v.h) + dz * Math.cos(v.h);   // ajoneuvon omat koordinaatit
      if (v.type === 'moto' && v.driver) continue;
      const [hx, hz] = v.type === 'apc' ? [1.3, 3.2] : v.type === 'moto' ? [0.4, 1.2] : [1.0, 2.2];
      if (pos.y > v.pos.y + (v.type === 'apc' ? 2.4 : 2.6) || pos.y < v.pos.y - 1.5) continue;
      const ox = hx + radius - Math.abs(lxx), oz = hz + radius - Math.abs(lzz);
      if (ox > 0 && oz > 0) {
        let px = 0, pz = 0; if (ox < oz) px = Math.sign(lxx) * ox; else pz = Math.sign(lzz) * oz;
        // takaisin maailmaan (käänteinen kierto)
        pos.x += px * Math.cos(v.h) + pz * Math.sin(v.h); pos.z += -px * Math.sin(v.h) + pz * Math.cos(v.h);
      }
    }
  }

  // ---------- oma ajoneuvo ----------
  // input: { fwd, side, up, fire, alt, look: Vector3 (katsesuunta), camPos }
  simulate(dt, input) {
    const v = this.mine; if (!v || !v.alive) return;
    if (v.type === 'apc') this.simApc(v, dt, input); else if (v.type === 'moto') this.simMoto(v, dt, input); else this.simHeli(v, dt, input);
    if (v.type !== 'moto') this.weaponsUpdate(v, dt, input);          // moottoripyörällä ajaja käyttää omia aseitaan
  }
  simApc(v, dt, I) {
    const A = APC;
    const thr = v.dis ? 0 : I.fwd;                                      // sinko-osuma: liikuntakyvytön, torni toimii yhä
    if (v.dis) v.speed = 0;
    if (thr > 0) v.speed += (v.speed < 0 ? A.brake : A.acc) * thr * dt;
    else if (thr < 0) v.speed += (v.speed > 0 ? A.brake : A.rev) * thr * dt;
    else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 3 * dt);
    v.speed = THREE.MathUtils.clamp(v.speed, -A.maxRev, A.max);
    const steerTarget = -(v.dis ? 0 : I.side) * A.steer * (1 - Math.min(0.6, Math.abs(v.speed) / A.max * 0.6));
    v.steer += (steerTarget - v.steer) * Math.min(1, dt * 5);
    v.h += v.speed * Math.tan(v.steer) / A.wheelbase * dt;
    const f = fwdOf(v.h), old = v.pos.clone();
    v.pos.addScaledVector(f, v.speed * dt);
    // rakennukset: vaakasuora kapseli ajoneuvon pituussuunnassa
    const a = v.pos.clone().addScaledVector(f, -2.3).setY(v.pos.y + 1.3), b = v.pos.clone().addScaledVector(f, 2.3).setY(v.pos.y + 1.3);
    const push = this.collider.collideCapsule(a, b, 1.15, new THREE.Vector3());
    push.y = 0;
    if (push.lengthSq() > 1e-4) v.pos.add(push);                       // raskas ajoneuvo: este pysäyttää liikkeen, ei vaurioita eikä vauhdin menetystä
    if (!this.player.validXZ(v.pos.x, v.pos.z, 4, 2)) { v.pos.copy(old); }
    // pyörät maahan: korkeus, nyökkäys ja kallistus neljästä pisteestä
    const r = new THREE.Vector3(-Math.cos(v.h), 0, Math.sin(v.h));   // oikea kylki
    const hgt = (lx, lz) => { const p = v.pos.clone().addScaledVector(f, lz).addScaledVector(r, -lx); return this.groundAt(p.x, p.z, 3, v.pos.y) ?? v.pos.y; };
    const fl = hgt(1, 1.75), fr = hgt(-1, 1.75), rl = hgt(1, -1.75), rr = hgt(-1, -1.75);
    const gy = (fl + fr + rl + rr) / 4;
    if (gy > v.pos.y + 1.2) { v.pos.copy(old); }                         // liian korkea este (seinä, porras)
    else { const k = gy < v.pos.y ? Math.min(1, dt * 6) : Math.min(1, dt * 12); v.pos.y += (gy - v.pos.y) * k; }
    v.pi += (Math.atan2(rl + rr - fl - fr, 2 * A.wheelbase) - v.pi) * Math.min(1, dt * 8);
    v.ro += (Math.atan2(fr + rr - fl - rl, 2 * A.track) - v.ro) * Math.min(1, dt * 8);
    v.wheelRot += v.speed * dt / A.wheelR;
    v.rpm = Math.min(1, 0.25 + Math.abs(v.speed) / A.max * 0.75 + Math.abs(thr) * 0.15);
    // torni ja ase kohti tähtäyspistettä
    v.obj.updateMatrixWorld();
    const tp = v.nodes.turret.getWorldPosition(new THREE.Vector3());
    const local = this.aim.clone().sub(tp).applyQuaternion(v.obj.getWorldQuaternion(new THREE.Quaternion()).invert());
    const wantYaw = Math.atan2(local.x, local.z), wantPitch = THREE.MathUtils.clamp(Math.atan2(local.y - 0.66, Math.hypot(local.x, local.z)), -15 * D2R, 50 * D2R);
    v.ty += THREE.MathUtils.clamp(angDiff(wantYaw, v.ty), -2.6 * dt, 2.6 * dt);
    v.tp += THREE.MathUtils.clamp(wantPitch - v.tp, -1.6 * dt, 1.6 * dt);
  }
  // Helikopteri: hiiri antaa suunnan, A/D kääntää (poljin, main.js kääntää katsetta), W/S kallistaa eteen/taakse,
  // E/Q nousu/lasku. Kallistus käännön suuntaan ja vauhti seuraa nokkaa kuten Helsinkikopterissa.
  simHeli(v, dt, I) {
    const H = HELI;
    const wantH = Math.atan2(-I.look.x, -I.look.z) + Math.PI;                // nokka katseen suuntaan
    const h0 = v.h;
    v.h += THREE.MathUtils.clamp(angDiff(wantH, v.h), -H.turn * dt, H.turn * dt);
    const dh = angDiff(v.h, h0), yawRate = dh / Math.max(dt, 1e-4);
    const f = fwdOf(v.h);
    const g0 = this.groundAt(v.pos.x, v.pos.z, 3, v.pos.y) ?? this.world.heightAt(v.pos.x, v.pos.z) ?? 0;
    const landed = v.pos.y - g0 < 0.15;
    const lift = landed && I.up <= 0 ? 0 : 1;                               // maassa: ei liukumista ilman nousua
    // vauhti kääntyy nokan mukana (koordinoitu kaarto)
    if (!landed) { const c = Math.cos(dh * 0.9), sn = Math.sin(dh * 0.9), vx = v.vel.x, vz = v.vel.z; v.vel.x = vx * c + vz * sn; v.vel.z = -vx * sn + vz * c; }
    v.vel.x += f.x * I.fwd * H.acc * lift * dt; v.vel.z += f.z * I.fwd * H.acc * lift * dt;
    const drag = Math.max(0, 1 - (landed ? 4 : 0.7) * dt); v.vel.x *= drag; v.vel.z *= drag;
    const hs = Math.hypot(v.vel.x, v.vel.z); if (hs > H.maxH) { v.vel.x *= H.maxH / hs; v.vel.z *= H.maxH / hs; }
    v.vel.y += THREE.MathUtils.clamp(I.up * H.vMax - v.vel.y, -H.vAcc * dt, H.vAcc * dt);
    const old = v.pos.clone();
    v.pos.addScaledVector(v.vel, dt);
    // rakennukseen osuminen tuhoaa kopterin (runko tai roottori), hiljainen kosketus maahan ei
    const a = v.pos.clone().setY(v.pos.y + 0.9), b = v.pos.clone().setY(v.pos.y + 2.3);
    const push = this.collider.collideCapsule(a, b, 1.6, new THREE.Vector3());
    const sp = v.vel.length(), agl = v.pos.y - g0;
    if (push.lengthSq() > 1e-4) {
      const n = push.clone().normalize();
      if (n.y < 0.6 && sp > 3 && !v.crashed) { v.crashed = true; this.net.emit('vcrash', { kill: true }); }
      v.pos.add(push); const vn = v.vel.dot(n); if (vn < 0) v.vel.addScaledVector(n, -vn * 1.3);
    }
    if (agl > 0.4 && v.rpm > 0.5 && !v.crashed) {
      const hub = v.pos.clone().setY(v.pos.y + 2.67);
      for (let k = 0; k < 8; k++) { const ang = k / 8 * Math.PI * 2, d = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)); const hit = this.collider.raycast(hub, d, 3.9);
        if (hit && hit.kind === 'buildings') { v.crashed = true; this.net.emit('vcrash', { kill: true }); break; } }
    }
    // maa ja katot
    const g = this.groundAt(v.pos.x, v.pos.z, 3, v.pos.y);
    if (g !== null && v.pos.y < g) { if (v.vel.y < -7) this.net.emit('vcrash', { dmg: (-v.vel.y - 7) * 15 }); v.pos.y = g; v.vel.y = Math.max(0, v.vel.y); }
    const gb = this.world.heightAt(v.pos.x, v.pos.z) ?? g0; if (v.pos.y > gb + H.ceiling) { v.pos.y = gb + H.ceiling; v.vel.y = Math.min(0, v.vel.y); }
    if (!this.player.validXZ(v.pos.x, v.pos.z, 3, -Infinity)) { v.pos.x = old.x; v.pos.z = old.z; v.vel.x = v.vel.z = 0; }   // alueen reuna (meri sallittu)
    // asento: nokka alas kiihdytettäessä, kallistus käännön suuntaan (oikea kaarto = oikea kylki alas = +ro)
    const bankK = 0.25 + 0.75 * Math.min(1, hs / 18);
    v.pi += ((I.fwd * 0.22 + Math.min(0.12, hs / 300)) * lift - v.pi) * Math.min(1, dt * 3);
    v.ro += (THREE.MathUtils.clamp(-yawRate * 0.3 * bankK, -0.5, 0.5) * lift - v.ro) * Math.min(1, dt * 3);
    v.rpm += (1 - v.rpm) * Math.min(1, dt * 0.8);
    v.speed = hs; v.agl = Math.max(0, v.pos.y - (this.groundAt(v.pos.x, v.pos.z, 3, v.pos.y) ?? v.pos.y));
  }
  // Moottoripyörä: kevyt ja nopea, kallistuu kaarteeseen. Ajaja ampuu omilla aseillaan.
  simMoto(v, dt, I) {
    const M = MOTO, thr = I.fwd;
    if (thr > 0) v.speed += (v.speed < 0 ? M.brake : M.acc * (1 - 0.5 * Math.max(0, v.speed) / M.max)) * thr * dt;
    else if (thr < 0) v.speed += (v.speed > 0.5 ? M.brake : M.rev) * thr * dt;
    else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 2 * dt);
    v.speed = THREE.MathUtils.clamp(v.speed, -M.maxRev, M.max);
    const steerTarget = -I.side * M.steer * (1 - Math.min(0.75, Math.abs(v.speed) / M.max * 0.85));
    v.steer += (steerTarget - v.steer) * Math.min(1, dt * 6);
    const h0 = v.h;
    v.h += v.speed * Math.tan(v.steer) / M.wheelbase * dt;
    const f = fwdOf(v.h), old = v.pos.clone();
    v.pos.addScaledVector(f, v.speed * dt);
    const a = v.pos.clone().addScaledVector(f, -0.8).setY(v.pos.y + 0.6), b = v.pos.clone().addScaledVector(f, 1.1).setY(v.pos.y + 0.6);
    const push = this.collider.collideCapsule(a, b, 0.42, new THREE.Vector3()); push.y = 0;
    if (push.lengthSq() > 1e-4) {
      v.pos.add(push);
      if (Math.abs(v.speed) > 8) this.net.emit('vcrash', { dmg: (Math.abs(v.speed) - 8) * 5 });
      v.speed *= 0.35;
    }
    if (!this.player.validXZ(v.pos.x, v.pos.z, 3, 0.6)) { v.pos.copy(old); v.speed = 0; }
    const hgt = lz => { const p = v.pos.clone().addScaledVector(f, lz); return this.groundAt(p.x, p.z, 2, v.pos.y) ?? v.pos.y; };
    const fy = hgt(1.15), ry = hgt(-0.58), gy = (fy + ry) / 2;
    if (gy > v.pos.y + 0.45) { v.pos.copy(old); v.speed = 0; }                     // reunakivi tai porras on liian korkea
    else { const k = gy < v.pos.y ? Math.min(1, dt * 8) : Math.min(1, dt * 16); v.pos.y += (gy - v.pos.y) * k; }
    v.pi += (Math.atan2(ry - fy, M.wheelbase) - v.pi) * Math.min(1, dt * 10);
    const yawRate = angDiff(v.h, h0) / Math.max(dt, 1e-4);
    v.ro += (THREE.MathUtils.clamp(Math.atan(-yawRate * v.speed / 9.8), -0.6, 0.6) - v.ro) * Math.min(1, dt * 6);
    v.wheelRot += v.speed * dt;
    v.ty = v.steer;                                                          // ohjauskulma muille (torniarvon paikalla)
    v.rpm = Math.min(1, 0.2 + Math.abs(v.speed) / M.max * 0.8 + Math.abs(thr) * 0.2);
  }
  // irrallaan oleva helikopteri putoaa maahan, roottori hidastuu
  idle(v, dt) {
    if (v.type !== 'heli') return;
    v.rpm = Math.max(0, v.rpm - dt * 0.15);
  }

  // ---------- ajoneuvoaseet ----------
  weaponsUpdate(v, dt, I) {
    const w = v.type === 'apc' ? 8 : 9, def = VEHICLE_WEAPONS[w];
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.ammo[w] = def.mag; }
    this.fireAcc = Math.min(this.fireAcc + dt, 0.2);
    const interval = 60 / def.rpm;
    while (I.fire && this.reloadT <= 0 && this.fireAcc >= interval) {
      this.fireAcc -= interval;
      if (this.ammo[w] <= 0) { this.reloadT = def.reload; this.sound.click(900, 0.3); break; }
      this.ammo[w]--;
      this.shoot(v, w, def);
      if (this.ammo[w] <= 0) { this.reloadT = def.reload; this.sound.click(900, 0.3); }
    }
    if (!I.fire) this.fireAcc = Math.min(this.fireAcc, interval);
    // helikopterin raketit
    if (v.type === 'heli') {
      this.rocketCd -= dt;
      if (this.rocketReloadT > 0) { this.rocketReloadT -= dt; if (this.rocketReloadT <= 0) this.rockets = HELI_ROCKETS.count; }
      if (I.alt && this.rocketCd <= 0 && this.rockets > 0) {
        this.rocketCd = HELI_ROCKETS.cooldown; this.rockets--;
        const pod = v.nodes.pods[this.rockets % 2].getWorldPosition(new THREE.Vector3());
        const dir = this.aim.clone().sub(pod).normalize();
        this.weapons.fireRocketFrom(pod.addScaledVector(dir, 1.2), dir, v.id);
        if (this.rockets <= 0) this.rocketReloadT = HELI_ROCKETS.reload;
      }
    }
  }
  shoot(v, w, def) {
    const muzzle = (v.type === 'apc' ? v.nodes.muzzle : v.nodes.guns[(this.side = 1 - this.side)]).getWorldPosition(new THREE.Vector3());
    // panssariajoneuvo ampuu sinne, mihin torni oikeasti osoittaa (kääntyy kohti tähtäystä); helikopteri tähtäyspisteeseen
    const dir = v.type === 'apc' ? v.nodes.muzzle.getWorldDirection(new THREE.Vector3()) : this.aim.clone().sub(muzzle).normalize();
    const sp = Math.tan(def.spread * D2R) * Math.sqrt(Math.random()), a = Math.random() * 6.283;
    const u = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(u, dir);
    dir.addScaledVector(u, Math.cos(a) * sp).addScaledVector(up, Math.sin(a) * sp).normalize();
    const res = this.weapons.hitscanFrom(muzzle, dir, def.dmg, w, { excludeVehicle: v.id, head: 1.5 });
    this.fx.remoteMuzzle(muzzle, dir); this.fx.tracer(muzzle, res.end, [1, 0.8, 0.45]);
    if (def.he && res.code) {                                               // räjähtävä ammus: pieni räjähdys ja alueosuma
      this.fx.miniBlast(res.end, dir.clone().negate()); this.sound.explosion(res.end, false, 0.45);
      this.net.emit('he', { p: [+res.end.x.toFixed(2), +res.end.y.toFixed(2), +res.end.z.toFixed(2)] });
      this.fx.shake = Math.max(this.fx.shake, 0.06);
    }
    this.sound.shot(def, null);
    this.net.emit('fx', { S: [w, +muzzle.x.toFixed(2), +muzzle.y.toFixed(2), +muzzle.z.toFixed(2), +res.end.x.toFixed(2), +res.end.y.toFixed(2), +res.end.z.toFixed(2), res.code] });
  }

  // ---------- päivitys ----------
  update(dt, listenerPos) {
    const rt = performance.now() - DELAY;
    for (const v of this.list.values()) {
      if (!v.alive) { if (v.snd) { v.snd.stop(); v.snd = null; } continue; }
      if (!v.local) {
        const b = v.buf;
        if (b.length) {
          let i = b.length - 1; while (i > 0 && b[i - 1].t > rt) i--;
          const B = b[i], A = b[Math.max(0, i - 1)], k = A === B || rt >= B.t ? 1 : THREE.MathUtils.clamp((rt - A.t) / Math.max(1, B.t - A.t), 0, 1);
          const lerp = (x, y) => x + (y - x) * k, alerp = (x, y) => x + angDiff(y, x) * k;
          const prev = v.pos.clone();
          v.pos.set(lerp(A.p[0], B.p[0]), lerp(A.p[1], B.p[1]), lerp(A.p[2], B.p[2]));
          v.h = alerp(A.h, B.h); v.pi = lerp(A.pi, B.pi); v.ro = lerp(A.ro, B.ro); v.ty = alerp(A.ty, B.ty); v.tp = lerp(A.tp, B.tp);
          v.rpm = lerp(A.r, B.r);
          const moved = prev.distanceTo(v.pos); v.wheelRot += (B.s >= 0 ? 1 : -1) * (v.type === 'moto' ? moved : moved / APC.wheelR); v.speed = moved / Math.max(dt, 1e-3);
          if (v.type === 'moto') v.steer = v.ty;
        }
        if (!v.driver) this.idle(v, dt);
        // kuljettajaton helikopteri (lentäjä kaatui ilmassa) putoaa maahan; kaikki selaimet laskevat saman maanpinnan
        if (!v.driver && v.type === 'heli') {
          const g = this.groundAt(v.pos.x, v.pos.z, 3, Math.min(v.pos.y, v.fallY ?? Infinity));
          if (v.fallY === undefined || v.fallY === Infinity) { v.fallY = v.pos.y; v.fallV = 0; }
          if (g !== null && v.fallY > g + 0.02) { v.fallV += 9.8 * dt; v.fallY = Math.max(g, v.fallY - v.fallV * dt); }
          v.pos.y = Math.min(v.pos.y, v.fallY);
        } else v.fallY = Infinity;
      }
      this.applyTransform(v);
      // moottorin ääni
      if (this.sound.ok) {
        const level = v.type === 'heli' ? v.rpm : (v.driver ? v.rpm || 0.3 : 0);
        if (v.dis && v.type === 'apc' && Math.random() < dt * 6) this.fx.smokePuff?.(v.pos.clone().add(new THREE.Vector3(0, 2.2, 0)));
        if (level > 0.02 && !v.snd) v.snd = this.sound.engineLoop(v.type);
        if (v.snd) { if (level <= 0.02) { v.snd.stop(); v.snd = null; } else v.snd.set(v.pos, level, Math.min(1, v.speed / (v.type === 'heli' ? 40 : v.type === 'moto' ? 28 : 16))); }
      }
    }
    // tila palvelimelle 20 Hz
    const m = this.mine;
    if (m && m.alive && (this.stAcc += dt) >= 0.05) {
      this.stAcc = 0;
      const r = x => +x.toFixed(3);
      this.net.volatile('vst', { v: m.id, p: [r(m.pos.x), r(m.pos.y), r(m.pos.z)], h: r(m.h), pi: r(m.pi), ro: r(m.ro), ty: r(m.ty), tp: r(m.tp), s: r(m.speed), r: r(m.rpm), g: r(m.agl || 0) });
    }
    void listenerPos;
  }
  applyTransform(v) {
    v.obj.position.copy(v.pos); v.obj.rotation.set(v.pi, v.h, v.ro);
    const N = v.nodes;
    if (v.type === 'apc') {
      N.turret.rotation.y = v.ty; N.cradle.rotation.x = -v.tp;
      for (const s of N.steer) s.rotation.y = v.steer;
      for (const w of N.wheels) w.rotation.x = v.wheelRot;
    } else if (v.type === 'moto') {
      N.front.rotation.x = v.wheelRot / MOTO.rF; N.rear.rotation.x = v.wheelRot / MOTO.rR;
      N.fork.quaternion.setFromAxisAngle(MOTO.steerAxis, -v.steer);          // + = oikealle
    } else {
      // roottori: nopeassa pyörimisessä läpikuultava kiekko, lavat pyörivät näkyvästi hitaammin (ei välkyntää)
      const spin = v.rpm * 490 / 60 * 2 * Math.PI;
      N.rotor.rotation.y += Math.min(spin, 9) * 0.016 * (v.rpm > 0.6 ? 0.35 : 1);
      N.tail.rotation.x += Math.min(spin * 5.9, 12) * 0.016;
      v.disc.visible = v.rpm > 0.45; v.disc.material.opacity = Math.min(1, (v.rpm - 0.45) * 2);
    }
  }
  remove(v) { this.scene.remove(v.obj); if (v.snd) v.snd.stop(); this.list.delete(v.id); }
}
