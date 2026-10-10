// Asejärjestelmä: tila (valmis / lataa / lukko / vaihto / heitto), ammukset, tulinopeus, hajonta, rekyyli,
// osumantunnistus (ampujan näkymä ratkaisee), raketit ja kranaatit. Aseet ovat dataa (defs.js), joten uuden aseen
// lisääminen ei vaadi muutoksia tähän tiedostoon, ellei se tuo uutta ammustyyppiä.
import * as THREE from 'three';
import { WEAPONS, GRENADE } from './defs.js';
import { grenadeMesh, rocketMesh } from './WeaponModels.js';

const D2R = Math.PI / 180;
const KIND_CODE = { terrain: 1, buildings: 2 };
const R2 = v => Math.round(v * 100) / 100;

export class WeaponSystem {
  constructor({ vm, sound, fx, collider, avatars, net, world, scene, myId }) {
    Object.assign(this, { vm, sound, fx, collider, avatars, net, world, scene, myId });
    this.defs = WEAPONS;
    this.idx = 2; this.prev = 0;
    this.state = 'ready'; this.timer = 0; this.cooldown = 0; this.bloom = 0;
    this.trigger = false; this.pressed = false; this.adsHeld = false;
    this.zoomIdx = 0; this.breath = 4; this.holding = false; this.swayT = 0;
    this.punch = { p: 0, y: 0, vp: 0, vy: 0 };
    this.recAcc = 0; this.sinceShot = 9;
    this.projectiles = []; this.projSeq = 0;
    this.pendingThrow = -1;
    this.onLocalHit = null;       // (info) => hit marker
    this.onShot = null;           // kameran tärinä tms.
    this.reset();
    this.vm.setWeapon(this.idx);
    this.vm.lift = 1;
  }
  get def() { return this.defs[this.idx]; }
  reset() {
    this.ammo = this.defs.map(d => ({ mag: d.mag, reserve: d.reserve }));
    this.grenades = GRENADE.count; this.state = 'ready'; this.timer = 0; this.bloom = 0;
    this.vm.reload = null; this.vm.cycle = null; this.vm.resetParts?.(); this.vm.setRocketVisible(true);
  }
  // ---------- syöte ----------
  select(i) {
    if (i < 0 || i >= this.defs.length || i === this.idx && this.state !== 'swap') return;
    if (this.state === 'reload') this.vm.endReload();
    if (this.state === 'cycle') this.vm.endCycle();
    this.prev = this.idx; this.idx = i; this.state = 'swap'; this.timer = 0; this.swapPhase = 0;
    this.sound.swap();
  }
  next(dir) { this.select((this.idx + dir + this.defs.length) % this.defs.length); }
  reload() {
    const a = this.ammo[this.idx], d = this.def;
    if (this.state !== 'ready' || a.mag >= d.mag || a.reserve <= 0) return;
    this.state = 'reload'; this.timer = 0; this.vm.startReload(d);
    this.sound.reload(d);
  }
  throwGrenade() {
    if (this.grenades <= 0 || this.state === 'swap' || this.state === 'throw') return;
    if (this.state === 'reload') this.vm.endReload();
    if (this.state === 'cycle') this.vm.endCycle();
    this.state = 'throw'; this.timer = 0; this.pendingThrow = 0.22; this.vm.startThrow(); this.sound.pin();
  }
  wheelZoom(dir) {
    const z = this.def.zoom; if (!z || this.vm.ads < 0.5) return false;
    this.zoomIdx = THREE.MathUtils.clamp(this.zoomIdx + (dir > 0 ? -1 : 1), 0, z.length - 1); this.sound.click(4000, 0.15);
    return true;
  }
  cycleZoom() { const z = this.def.zoom; if (!z) return; this.zoomIdx = (this.zoomIdx + 1) % z.length; this.sound.click(4000, 0.15); }
  get zoom() { const z = this.def.zoom; return z ? z[this.zoomIdx] : 1; }

  // ---------- päivitys ----------
  update(dt, { camera, player, alive }) {
    this.playerRef = player;
    const d = this.def, a = this.ammo[this.idx];
    this.cooldown -= dt; this.sinceShot += dt;
    this.bloom = Math.max(0, this.bloom - dt * (d.auto ? 4 : 6));
    // vaihto: vanha ase alas, uusi ylös
    if (this.state === 'swap') {
      this.timer += dt;
      if (this.swapPhase === 0) { this.vm.lift = Math.max(0, 1 - this.timer / 0.16); if (this.timer >= 0.16) { this.swapPhase = 1; this.timer = 0; this.vm.setWeapon(this.idx); this.vm.setRocketVisible(this.ammo[this.idx].mag > 0); this.zoomIdx = 0; } }
      else { this.vm.lift = Math.min(1, this.timer / (d.swap * 0.7)); if (this.vm.lift >= 1) { this.state = 'ready'; } }
    } else this.vm.lift = Math.min(1, this.vm.lift + dt * 6);
    if (this.state === 'reload') {
      this.timer += dt;
      if (d.reloadMode === 'shell') {
        this.vm.setReloadProgress((this.timer / d.reload) % 1);
        if (this.timer >= d.reload) {
          this.timer -= d.reload; a.mag++; if (a.reserve !== Infinity) a.reserve--;
          this.sound.click(1600, 0.3); this.sound.click(800, 0.2, 0.05);
          if (a.mag >= d.mag || a.reserve <= 0 || (this.trigger && a.mag > 0)) { this.state = 'ready'; this.vm.endReload(); this.cooldown = 0.15; if (this.trigger) this.pressT = 0.25; }
        }
      } else {
        this.vm.setReloadProgress(Math.min(1, this.timer / d.reload));
        if (this.timer >= d.reload) {
          const need = d.mag - a.mag, take = Math.min(need, a.reserve);
          a.mag += take; if (a.reserve !== Infinity) a.reserve -= take;
          this.state = 'ready'; this.vm.endReload();
          if (d.kind === 'rocket') this.vm.setRocketVisible(true);
        }
      }
    }
    if (this.state === 'cycle') {
      this.timer += dt; this.vm.setCycleProgress(Math.min(1, this.timer / d.cycle));
      if (this.timer >= d.cycle) { this.state = 'ready'; this.vm.endCycle(); }
    }
    if (this.state === 'throw') {
      this.timer += dt;
      if (this.pendingThrow >= 0) { this.pendingThrow -= dt; if (this.pendingThrow < 0) { this.spawnGrenade(camera, player); this.pendingThrow = -1; } }
      if (this.timer >= 0.55) this.state = 'ready';
    }
    // laukaisu
    if (this.pressed) { this.pressT = 0.25; this.pressed = false; }      // lyhyt puskuri: painallus ei katoa vaihdon/latauksen lopussa
    this.pressT = (this.pressT || 0) - dt;
    const wantFire = d.auto ? this.trigger : this.pressT > 0;
    if (wantFire && alive) {
      if (player.sprinting) { player.canSprint = false; this.sprintBlock = 0.35; }
      else if (this.state === 'ready' && this.cooldown <= 0 && this.vm.lift > 0.9) {
        if (a.mag > 0) { this.fire(camera, player); this.pressT = 0; }
        else if (this.pressT > 0) { this.pressT = 0; this.sound.dry(); this.reload(); }
      }
    }
    if (this.sprintBlock > 0) { this.sprintBlock -= dt; if (this.sprintBlock <= 0) player.canSprint = true; }
    // tyhjä lipas → automaattinen lataus hetken päästä
    if (this.state === 'ready' && a.mag === 0 && a.reserve > 0 && this.cooldown < -0.25) this.reload();
    // rekyylin palautuminen, kun tuli lakkaa
    if (this.sinceShot > 0.12 && this.recAcc > 0) { const r = Math.min(this.recAcc, dt * 5 * D2R * 4); this.recAcc -= r; player.pitch -= r * 0.85; }
    // näkymän nykäysjousi
    const P = this.punch, k = 140, c = 16;
    P.vp += (-k * P.p - c * P.vp) * dt; P.vy += (-k * P.y - c * P.vy) * dt; P.p += P.vp * dt; P.y += P.vy * dt;
    // kiikarin heilunta ja hengityksen pidätys (Shift tähdätessä)
    this.swayT += dt;
    const scoped = d.sight === 'scope' && this.vm.ads > 0.6;
    if (scoped && this.holding && this.breath > 0) this.breath -= dt; else this.breath = Math.min(4, this.breath + dt * (this.holding ? 0 : 1.2));
    const steady = scoped && this.holding && this.breath > 0 ? 0.12 : 1;
    const amp = (d.sway || 0) * D2R * this.vm.ads * steady * (1 + player.moving * 2.5);
    this.sway = { p: Math.sin(this.swayT * 0.83) * amp * 0.7 + Math.sin(this.swayT * 2.1) * amp * 0.15, y: Math.sin(this.swayT * 0.57 + 1) * amp };
    this.updateProjectiles(dt, camera);
  }

  // efektiivinen hajonta asteina
  spread(player) {
    const d = this.def, A = this.vm.ads;
    let s = d.spread[0] + (d.spread[1] - d.spread[0]) * (A > 0.92 ? 1 : A * 0.7);
    s += d.move * Math.min(1, player.speed / 5.4) * (1 - A * 0.5) + (player.onGround ? 0 : 2.5) + this.bloom;
    return s;
  }
  aimDir(camera, spreadDeg, out) {
    camera.getWorldDirection(out);
    if (spreadDeg <= 0) return out;
    const r = Math.tan(spreadDeg * D2R) * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    return out.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
  }
  muzzleWorld(camera) {
    const m = this.vm.model.muzzle.getWorldPosition(new THREE.Vector3());
    const ndc = m.clone().project(this.vm.camera);
    const p = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(camera);
    return camera.position.clone().add(p.sub(camera.position).normalize().multiplyScalar(0.9));
  }

  fire(camera, player) {
    const d = this.def, a = this.ammo[this.idx];
    a.mag--; this.cooldown = 60 / d.rpm; this.sinceShot = 0;
    const origin = camera.position.clone(), muzzle = this.muzzleWorld(camera);
    const sp = this.spread(player);
    this.vm.fire(d, this.vm.ads);
    this.sound.shot(d);
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    this.fx.muzzle(muzzle, fwd, d.id === 'launcher' ? 2 : d.id === 'shotgun' ? 1.5 : 1);
    if (d.kind === 'rocket') {
      const dir = this.aimDir(camera, sp, new THREE.Vector3());
      const o = origin.clone().addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.12, 0));
      this.spawnProjectile({ k: 'rocket', o: o.toArray(), v: dir.multiplyScalar(d.projSpeed).toArray(), n: ++this.projSeq, owner: this.myId, local: true });
      this.net.emit('proj', { k: 'rocket', o: o.toArray().map(R2), v: dir.toArray().map(R2), n: this.projSeq, fuse: 0 });
      this.vm.setRocketVisible(false);
      for (let i = 0; i < 12; i++) this.fx.particles.emit({ p: camera.position.clone().addScaledVector(fwd, -0.6).toArray(), v: fwd.clone().multiplyScalar(-6 - Math.random() * 6).add(new THREE.Vector3(Math.random() - 0.5, Math.random(), Math.random() - 0.5)).toArray(), life: 1.5 + Math.random(), size: 0.3, size1: 2, color: [0.7, 0.7, 0.7], alpha: 0.4, frame: 0, drag: 2 });
    } else {
      const pellets = d.pellets || 1, S = [this.idx, R2(muzzle.x), R2(muzzle.y), R2(muzzle.z)], hits = new Map();
      for (let i = 0; i < pellets; i++) {
        const dir = this.aimDir(camera, sp, new THREE.Vector3());
        const wh = this.collider.raycast(origin, dir, 350);
        const maxD = wh ? wh.dist : 350;
        const ph = this.avatars.raycast(origin, dir, maxD);
        let end, code = 0;
        if (ph) {
          end = ph.point; code = 3;
          const f = d.falloff, k = ph.dist <= f[0] ? 1 : ph.dist >= f[1] ? f[2] : 1 + (f[2] - 1) * (ph.dist - f[0]) / (f[1] - f[0]);
          const dmg = d.dmg * k * (ph.head ? d.head : 1);
          const h = hits.get(ph.id) || { dmg: 0, head: false, point: ph.point, color: ph.color }; h.dmg += dmg; h.head = h.head || ph.head; hits.set(ph.id, h);
          this.fx.playerHit(ph.point, ph.color);
        } else if (wh) {
          end = wh.point; code = KIND_CODE[wh.kind] || 1;
          this.fx.impact(wh.point, wh.normal, wh.kind, { size: d.id === 'sniper' ? 0.16 : d.id === 'shotgun' ? 0.07 : 0.11 });
        } else end = origin.clone().addScaledVector(dir, 350);
        if (i < 3 || Math.random() < 0.35) this.fx.tracer(muzzle, end);
        S.push(R2(end.x), R2(end.y), R2(end.z), code);
      }
      for (const [id, h] of hits) {
        this.net.emit('hit', { t: id, dmg: Math.round(h.dmg * 10) / 10, head: h.head, w: this.idx });
        if (this.onLocalHit) this.onLocalHit({ id, head: h.head, dmg: h.dmg });
      }
      this.net.emit('fx', { S });
    }
    // rekyyli: osa siirtää tähtäystä pysyvästi (pelaaja kompensoi), osa on palautuvaa nykäystä
    const r = d.recoil, adsK = 1 - this.vm.ads * 0.2;
    const v = r.v * (0.85 + Math.random() * 0.3) * D2R * adsK, h = r.h * (Math.random() * 2 - 0.8) * D2R * adsK;
    player.pitch += v * 0.6; player.yaw -= h * 0.6; this.recAcc += v * 0.6 * 0.5;
    this.punch.vp += v * 0.4 * 18 * (r.punch / Math.max(0.3, r.v)); this.punch.vy -= h * 0.4 * 18;
    this.bloom = Math.min(6, this.bloom + d.bloom);
    if (this.onShot) this.onShot(d);
    if (d.cycle && a.mag > 0) { this.state = 'cycle'; this.timer = -0.12; this.vm.startCycle(); this.sound.cycle(d); }
    else if (d.cycle) this.cooldown = 0.3;
  }

  spawnGrenade(camera, player) {
    if (this.grenades <= 0) return;
    this.grenades--;
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const o = camera.position.clone().addScaledVector(dir, 0.4).add(new THREE.Vector3(0, -0.1, 0));
    const v = dir.clone().multiplyScalar(GRENADE.speed).add(new THREE.Vector3(0, GRENADE.up, 0)).add(new THREE.Vector3(player.vel.x, Math.max(0, player.vel.y), player.vel.z).multiplyScalar(0.6));
    // aloituspiste ei saa olla seinän sisällä
    const back = this.collider.raycast(camera.position, dir, 0.45); if (back) o.copy(camera.position).addScaledVector(dir, Math.max(0, back.dist - 0.12));
    this.spawnProjectile({ k: 'grenade', o: o.toArray(), v: v.toArray(), n: ++this.projSeq, owner: this.myId, local: true, fuse: GRENADE.fuse });
    this.net.emit('proj', { k: 'grenade', o: o.toArray().map(R2), v: v.toArray().map(R2), n: this.projSeq, fuse: GRENADE.fuse });
  }

  // ---------- ammukset ----------
  spawnProjectile({ k, o, v, n, owner, local, fuse = 0 }) {
    const mesh = k === 'rocket' ? rocketMesh() : grenadeMesh();
    mesh.traverse(m => { if (m.isMesh) m.castShadow = true; });
    this.scene.add(mesh);
    const p = { k, pos: new THREE.Vector3().fromArray(o), vel: new THREE.Vector3().fromArray(v), n, owner, local, fuse, age: 0, mesh, acc: 0, rest: false,
      snd: k === 'rocket' ? this.sound.rocketLoop(new THREE.Vector3().fromArray(o)) : null, spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, 0) };
    mesh.position.copy(p.pos);
    if (k === 'rocket' && p.vel.lengthSq() > 0) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), p.vel.clone().normalize());
    this.projectiles.push(p);
    return p;
  }
  remoteProjectile(d) {
    let v = d.v;
    if (d.k === 'rocket') { const s = WEAPONS[6].projSpeed; v = v.map(x => x * s); }
    this.spawnProjectile({ k: d.k, o: d.o, v, n: d.n, owner: d.id, local: false, fuse: d.fuse });
  }
  removeProjectile(owner, n) {
    const i = this.projectiles.findIndex(p => p.owner === owner && p.n === n);
    if (i >= 0) this.dropProjectile(i);
  }
  dropProjectile(i) { const p = this.projectiles[i]; this.scene.remove(p.mesh); if (p.snd) p.snd.stop(); this.projectiles.splice(i, 1); }
  clearProjectiles() { while (this.projectiles.length) this.dropProjectile(0); }

  updateProjectiles(dt, camera) {
    const H = 1 / 120;
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      p.acc += dt; p.age += dt;
      let boom = null;
      while (p.acc >= H && !boom) {
        p.acc -= H;
        if (p.k === 'rocket') {
          p.vel.y -= 1.2 * H;
          const step = p.vel.length() * H, dir = p.vel.clone().normalize();
          const hit = this.collider.raycast(p.pos, dir, step + 0.05);
          if (hit) boom = { p: hit.point.clone().addScaledVector(hit.normal, 0.15), n: hit.normal, wall: hit.kind === 'buildings' };
          else {
            p.pos.addScaledVector(p.vel, H);
            if (p.local) { const a = this.avatars.near(p.pos, 0.25); if (a) boom = { p: p.pos.clone(), n: new THREE.Vector3(0, 1, 0), wall: false, direct: true }; }
          }
          if (!boom && p.age > 6) boom = { p: p.pos.clone(), n: new THREE.Vector3(0, 1, 0), wall: false, air: true };
        } else if (!p.rest) {
          p.vel.y -= 20 * H;
          const step = p.vel.length() * H;
          if (step > 1e-5) {
            const dir = p.vel.clone().divideScalar(step / H);
            const hit = this.collider.raycast(p.pos, dir, step + 0.07);
            if (hit) {
              const vn = p.vel.dot(hit.normal);
              p.vel.addScaledVector(hit.normal, -(1 + 0.35) * vn).multiplyScalar(0.72);
              p.pos.copy(hit.point).addScaledVector(hit.normal, 0.075);
              if (Math.abs(vn) > 2) this.sound.bounce(p.pos);
              if (p.vel.length() < 0.8 && hit.normal.y > 0.6) { p.rest = true; p.vel.set(0, 0, 0); }
            } else p.pos.addScaledVector(p.vel, H);
          }
        }
        if (p.k === 'grenade' && p.age >= p.fuse) boom = { p: p.pos.clone().add(new THREE.Vector3(0, 0.1, 0)), n: new THREE.Vector3(0, 1, 0), wall: false };
      }
      p.mesh.position.copy(p.pos);
      if (p.k === 'rocket') {
        if (p.vel.lengthSq() > 0) p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), p.vel.clone().normalize());
        this.fx.trail(p.pos.clone().addScaledVector(p.vel.clone().normalize(), 0.45), p.vel.clone().normalize(), 'rocket');
        if (p.snd) p.snd.set(p.pos);
      } else if (!p.rest) { p.mesh.rotation.x += p.spin.x * dt; p.mesh.rotation.z += p.spin.y * dt; this.fx.trail(p.pos, p.vel, 'grenade'); }
      const b = this.world.bounds;
      if (!boom && (p.pos.y > b.max.y + 200 || p.pos.x < b.min.x - 50 || p.pos.x > b.max.x + 50 || p.pos.z < b.min.z - 50 || p.pos.z > b.max.z + 50)) { this.dropProjectile(i); i--; continue; }
      if (boom) {
        if (p.local) {
          // maan alla olevan kranaatin räjähdys nostetaan pintaan, ilmaräjähdykselle normaali ylös
          const gy = this.world.heightAt(boom.p.x, boom.p.z); if (gy !== null && boom.p.y < gy + 0.05) boom.p.y = gy + 0.05;
          // rakennukset suojaavat: pelaajat, joihin ei ole näköyhteyttä räjähdyspisteestä, saavat vain pienen osan vahingosta
          const occ = [], src = boom.p.clone().addScaledVector(boom.n, 0.3);
          const blocked = (x, y, z) => [1.0, 1.6].every(h => !this.collider.clear(src, new THREE.Vector3(x, y + h, z)));
          for (const a of this.avatars.map.values()) if (a.alive && a.pos.distanceTo(boom.p) < 9 && blocked(a.pos.x, a.pos.y, a.pos.z)) occ.push(a.id);
          if (this.playerRef && this.playerRef.pos.distanceTo(boom.p) < 9 && blocked(this.playerRef.pos.x, this.playerRef.pos.y, this.playerRef.pos.z)) occ.push(this.myId);
          this.net.emit('boom', { k: p.k, p: boom.p.toArray().map(R2), n: boom.n.toArray().map(R2), wall: !!boom.wall, n2: p.n, occ });
          this.onLocalBoom && this.onLocalBoom(p.k, boom.p, boom.n);
          this.dropProjectile(i); i--; continue;
        }
        // muiden ammus: odotetaan palvelimen räjähdysviestiä, piilotetaan ammus
        p.mesh.visible = false; if (p.snd) { p.snd.stop(); p.snd = null; }
        if (p.age > p.fuse + 3 || p.k === 'rocket') { if (p.age > 8) { this.dropProjectile(i); i--; } }
      }
    }
    void camera;
  }
}
