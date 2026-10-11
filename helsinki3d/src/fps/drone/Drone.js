// Räjähdedrooni: jokaisella pelaajalla yksi per elämä. Aktivoitaessa pelaaja katsoo droonin FPV-kuvaa
// (pelaajan keho jää paikalleen). Drooni lentää koko ajan eteenpäin; nopeus W/S, sivuliuku A/D, nousu E, lasku Q,
// suunta hiirellä. Räjähtää osuessaan (rakennus, maa, vihollinen, ajoneuvo), laukaisunapista tai akun loppuessa.
// Räjähde vastaa käsikranaattia (palvelin: SPLASH.drone). Muut näkevät droonin ja voivat ampua sen alas.
import * as THREE from 'three';
import { DRONE } from '../shared.js';

const R2 = v => Math.round(v * 100) / 100;
const DELAY = 110;

// ohjelmallinen nelikopteri: runko, varret, roottorit, räjähdepanos ja merkkivalo
function droneMesh() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.6, metalness: 0.2 });
  const olive = new THREE.MeshStandardMaterial({ color: 0x4d5a3a, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.24), dark); g.add(body);
  const payload = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10).rotateX(Math.PI / 2), olive); payload.position.set(0, -0.06, 0.02); g.add(payload);
  const rotors = [];
  for (const [x, z] of [[0.17, 0.17], [-0.17, 0.17], [0.17, -0.17], [-0.17, -0.17]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.015, 0.25), dark);
    arm.position.set(x / 2, 0, z / 2); arm.rotation.y = Math.atan2(x, z); g.add(arm);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.035, 8), dark); motor.position.set(x, 0.02, z); g.add(motor);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    disc.position.set(x, 0.042, z); g.add(disc); rotors.push(disc);
  }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3020 })); led.position.set(0, 0.02, -0.12); g.add(led);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.rotation.order = 'YXZ'; g.scale.setScalar(1.4);   // hieman todellista suurempi, jotta sen erottaa ja voi ampua
  return { g, rotors, led };
}

export class DroneSystem {
  constructor({ scene, world, collider, sound, fx, avatars, net, getVehicles }) {
    Object.assign(this, { scene, world, collider, sound, fx, avatars, net, getVehicles });
    this.count = 1; this.active = null; this.remote = new Map(); this.myId = null; this.myColor = null;
    this.onEnd = null; this.sendAcc = 0;
    const b = world.bounds; this.diag = Math.hypot(b.max.x - b.min.x, b.max.z - b.min.z);
  }
  get flying() { return !!this.active; }
  reset() { if (this.active) this.end(false); this.count = 1; }

  // ---------- oma drooni ----------
  launch(player) {
    if (this.count <= 0 || this.active) return false;
    const yaw = player.yaw, fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const pos = player.pos.clone().add(new THREE.Vector3(0, 1.9, 0)).addScaledVector(fwd, 0.6);
    const up = this.collider.raycast(player.pos.clone().setY(player.pos.y + 1.5), new THREE.Vector3(0, 1, 0), 0.6);
    if (up) pos.y = player.pos.y + 1.4;                                      // katon alla: lähtö matalammalta
    this.count--;
    this.active = { pos, yaw, pitch: 0.05, roll: 0, speed: 6, t: 0, home: player.pos.clone(), vel: new THREE.Vector3(), up: 0 };
    this.snd = this.sound.engineLoop('drone');
    this.sound.click(2400, 0.25); this.sound.click(3200, 0.2, 0.06);
    return true;
  }
  // syöte: { fwd, side, up, fire, dx, dy } (dx, dy = katsekulman muutos radiaaneina)
  update(dt, I) {
    const A = this.active; if (!A) return;
    A.t += dt;
    A.yaw -= I.dx; A.pitch = THREE.MathUtils.clamp(A.pitch - I.dy, -1.35, 0.9);
    A.speed = THREE.MathUtils.clamp(A.speed + I.fwd * 14 * dt, DRONE.speedMin, DRONE.speedMax);
    const dir = new THREE.Vector3(-Math.sin(A.yaw) * Math.cos(A.pitch), Math.sin(A.pitch), -Math.cos(A.yaw) * Math.cos(A.pitch));
    const right = new THREE.Vector3(Math.cos(A.yaw), 0, -Math.sin(A.yaw));
    const want = dir.clone().multiplyScalar(A.speed).addScaledVector(right, I.side * 7).add(new THREE.Vector3(0, I.up * DRONE.climb, 0));
    A.vel.lerp(want, Math.min(1, dt * 4));
    A.roll += (-I.side * 0.45 - A.roll) * Math.min(1, dt * 5);
    // törmäys: säde liikkeen suuntaan (rakennukset, maa), viholliset ja ajoneuvot
    const step = A.vel.length() * dt, vdir = A.vel.clone().normalize();
    const hit = step > 1e-4 ? this.collider.raycast(A.pos, vdir, step + DRONE.radius) : null;
    if (hit) return this.boom(hit.point.clone().addScaledVector(hit.normal, 0.25), hit.normal, hit.kind === 'buildings');
    A.pos.addScaledVector(A.vel, dt);
    if (this.avatars.near(A.pos, 0.55)) return this.boom(A.pos.clone(), new THREE.Vector3(0, 1, 0), false);
    const V = this.getVehicles(); if (V && V.near(A.pos, 0.2, V.mine ? V.mine.id : null)) return this.boom(A.pos.clone(), new THREE.Vector3(0, 1, 0), false);
    const g = this.world.heightAt(A.pos.x, A.pos.z);
    if (g !== null && A.pos.y < g + 0.15) return this.boom(new THREE.Vector3(A.pos.x, g + 0.2, A.pos.z), new THREE.Vector3(0, 1, 0), false);
    const b = this.world.bounds;
    if (A.pos.x < b.min.x || A.pos.x > b.max.x || A.pos.z < b.min.z || A.pos.z > b.max.z || A.pos.y > b.max.y + 120) return this.lost('YHTEYS KATKESI');
    if (I.fire) return this.boom(A.pos.clone(), new THREE.Vector3(0, 1, 0), false);
    if (A.t >= DRONE.battery) return this.boom(A.pos.clone(), new THREE.Vector3(0, 1, 0), false);
    if (this.snd) this.snd.set(A.pos, 0.7 + A.speed / DRONE.speedMax * 0.3, A.speed / DRONE.speedMax);
    if ((this.sendAcc += dt) >= 0.05) { this.sendAcc = 0; this.net.volatile('dst', { p: [R2(A.pos.x), R2(A.pos.y), R2(A.pos.z)], y: R2(A.yaw), x: R2(A.pitch) }); }
  }
  // signaalin heikkeneminen: 0 = täysi, 1 = pelialueen toisella puolella
  signal() { const A = this.active; if (!A) return 0; return THREE.MathUtils.clamp(A.pos.distanceTo(A.home) / (this.diag * 0.75), 0, 1); }
  camera(cam) {
    const A = this.active; if (!A) return;
    const sh = (Math.random() - 0.5) * 0.004;
    cam.position.copy(A.pos); cam.rotation.set(A.pitch + sh, A.yaw + sh, A.roll); cam.updateMatrixWorld();
  }
  boom(p, n, wall) {
    // rakennukset suojaavat räjähdykseltä (kuten kranaatissa): näköyhteydettömät pelaajat saavat vain osan
    const occ = [], src = p.clone().addScaledVector(n, 0.3);
    const blocked = q => [1.0, 1.6].every(h => !this.collider.clear(src, new THREE.Vector3(q.x, q.y + h, q.z)));
    for (const a of this.avatars.map.values()) if (a.alive && a.pos.distanceTo(p) < 9 && blocked(a.pos)) occ.push(a.id);
    this.net.emit('boom', { k: 'drone', p: p.toArray().map(R2), n: n.toArray().map(R2), wall: !!wall, n2: 0, occ });
    this.fx.explosion(p, n, 'grenade', p); this.sound.explosion(p, false);
    this.end(true);
  }
  lost(why) { this.lastMsg = why; this.end(false); }
  // ammuttiin alas (palvelimen ilmoitus)
  shotDown() { const A = this.active; if (!A) return; this.fx.miniBlast(A.pos.clone(), new THREE.Vector3(0, 1, 0)); this.lastMsg = 'DROONI AMMUTTIIN ALAS'; this.end(false, true); }
  end(boom, silent = false) {
    if (!this.active) return;
    this.active = null; if (this.snd) { this.snd.stop(); this.snd = null; }
    if (!silent) this.net.emit('dend', { boom });
    if (this.onEnd) this.onEnd(boom);
  }

  // ---------- muiden droonit ----------
  onState(d) {
    let r = this.remote.get(d.id);
    if (!r) { const m = droneMesh(); this.scene.add(m.g); r = { ...m, buf: [], pos: new THREE.Vector3().fromArray(d.p), yaw: d.y, pitch: d.x, snd: null }; this.remote.set(d.id, r); }
    r.buf.push({ t: performance.now(), p: d.p, y: d.y, x: d.x }); if (r.buf.length > 20) r.buf.shift();
  }
  onEndRemote(id, boom) {
    const r = this.remote.get(id); if (!r) return;
    if (!boom) this.fx.miniBlast(r.pos.clone(), new THREE.Vector3(0, 1, 0));
    this.scene.remove(r.g); if (r.snd) r.snd.stop(); this.remote.delete(id);
  }
  // osumatesti muiden drooneihin (pallo); omat tiimiläiset ohitetaan
  raycast(o, d, maxD) {
    let best = null; const oc = new THREE.Vector3();
    for (const [id, r] of this.remote) {
      const a = this.avatars.map.get(id); if (a && a.color === this.myColor) continue;
      oc.copy(r.pos).sub(o); const t = oc.dot(d); if (t < 0 || t > maxD) continue;
      const d2 = oc.lengthSq() - t * t, rr = DRONE.radius * DRONE.radius; if (d2 > rr) continue;
      const th = t - Math.sqrt(rr - d2); if (!best || th < best.dist) best = { id, dist: th, point: o.clone().addScaledVector(d, th) };
    }
    return best;
  }
  updateRemote(dt) {
    const rt = performance.now() - DELAY;
    for (const [id, r] of this.remote) {
      const b = r.buf;
      if (b.length) {
        let i = b.length - 1; while (i > 0 && b[i - 1].t > rt) i--;
        const B = b[i], A = b[Math.max(0, i - 1)], k = A === B || rt >= B.t ? 1 : THREE.MathUtils.clamp((rt - A.t) / Math.max(1, B.t - A.t), 0, 1);
        r.pos.set(A.p[0] + (B.p[0] - A.p[0]) * k, A.p[1] + (B.p[1] - A.p[1]) * k, A.p[2] + (B.p[2] - A.p[2]) * k);
        r.yaw = B.y; r.pitch = B.x;
        if (performance.now() - B.t > 3000) { this.onEndRemote(id, true); continue; }   // yhteys katkesi
      }
      r.g.position.copy(r.pos); r.g.rotation.set(r.pitch * 0.4, r.yaw, 0);
      for (const d of r.rotors) d.rotation.y += dt * 40;
      r.led.visible = (performance.now() % 600) < 300;
      if (this.sound.ok && !r.snd) r.snd = this.sound.engineLoop('drone');
      if (r.snd) r.snd.set(r.pos, 0.8, 0.6);
    }
  }
  clearRemote() { for (const id of [...this.remote.keys()]) this.onEndRemote(id, true); }
}
