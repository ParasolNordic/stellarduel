// Muiden pelaajien hahmot: perusmuodoista koottu sotilas (kypärä, suojalasit, taisteluliivi pelaajan värissä),
// kädessä pelaajan valitsema ase. Sijainti interpoloidaan palvelimen tilannekuvista ~110 ms viiveellä,
// jalat ja ylävartalo animoidaan liikkeen ja tähtäyskulman mukaan. Osumalaatikot: pää (pallo) ja vartalo (kapseli).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { nameTexture } from '../fx/textures.js';
import { buildWeaponModel, mergeStatic } from '../weapons/WeaponModels.js';
import { WEAPONS } from '../weapons/defs.js';

const DELAY = 110;          // ms
export const HEAD_Y = 1.64, HEAD_R = 0.2, BODY_R = 0.34, BODY_Y0 = 0.15, BODY_Y1 = 1.42;

const RB = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 2, r);
function mesh(parent, geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; }

function buildSoldier(color) {
  const c = new THREE.Color(color);
  const M = {
    cloth: new THREE.MeshStandardMaterial({ color: 0x4d5444, roughness: 0.92 }),
    cloth2: new THREE.MeshStandardMaterial({ color: 0x3b4136, roughness: 0.92 }),
    // liivi täysin pelaajan värissä ja kevyesti itsevalaiseva: erottuu yhtä hyvin varjossa kaikilla väreillä
    vest: new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, emissive: c, emissiveIntensity: 0.35 }),
    helmet: new THREE.MeshStandardMaterial({ color: 0x3e4535, roughness: 0.75 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.7 }),
    face: new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.85 }),
    goggle: new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.15, emissive: c, emissiveIntensity: 0.25 }),
    stripe: new THREE.MeshBasicMaterial({ color: c }),
  };
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.92; root.add(hips);
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(0.11 * s, 0, 0); hips.add(leg);
    mesh(leg, RB(0.16, 0.46, 0.18, 0.05), M.cloth, 0, -0.22, 0);
    const shin = new THREE.Group(); shin.position.y = -0.45; leg.add(shin);
    mesh(shin, RB(0.14, 0.42, 0.15, 0.05), M.cloth, 0, -0.2, 0);
    mesh(shin, RB(0.15, 0.12, 0.26, 0.04), M.dark, 0, -0.42, -0.05);
    mesh(leg, RB(0.15, 0.12, 0.16, 0.04), M.dark, 0, -0.45, -0.05);    // polvisuoja
    legs.push({ leg, shin });
  }
  const torso = new THREE.Group(); torso.position.y = 0.0; hips.add(torso);
  mesh(torso, RB(0.38, 0.2, 0.22, 0.06), M.cloth2, 0, 0.06, 0);
  mesh(torso, RB(0.42, 0.5, 0.26, 0.07), M.cloth, 0, 0.38, 0);
  mesh(torso, RB(0.45, 0.4, 0.3, 0.06), M.vest, 0, 0.42, 0);
  for (let i = 0; i < 3; i++) mesh(torso, RB(0.1, 0.12, 0.06, 0.02), M.vest, -0.13 + i * 0.13, 0.3, -0.17);
  mesh(torso, new THREE.BoxGeometry(0.46, 0.04, 0.31), M.stripe, 0, 0.58, 0);
  mesh(torso, RB(0.3, 0.32, 0.12, 0.04), M.cloth2, 0, 0.42, 0.2);      // reppu
  const neck = new THREE.Group(); neck.position.y = 0.68; torso.add(neck);
  const head = new THREE.Group(); head.position.y = 0.06; neck.add(head);
  mesh(head, new THREE.SphereGeometry(0.115, 16, 12).scale(1, 1.08, 1.05), M.face, 0, 0.0, 0);
  mesh(head, new THREE.SphereGeometry(0.14, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), M.helmet, 0, 0.03, 0.01);
  mesh(head, new THREE.TorusGeometry(0.135, 0.012, 6, 24), M.helmet, 0, 0.0, 0.01).rotation.x = Math.PI / 2;
  mesh(head, RB(0.19, 0.06, 0.06, 0.02), M.goggle, 0, 0.02, -0.1);
  mesh(head, new THREE.BoxGeometry(0.2, 0.025, 0.02), M.stripe, 0, 0.07, -0.12);
  // kädet aseen ympärillä
  const arms = new THREE.Group(); arms.position.set(0, 0.55, 0); torso.add(arms);
  const armGeo = RB(0.1, 0.1, 0.32, 0.04);
  const ra = mesh(arms, armGeo, M.cloth, 0.2, -0.08, -0.12); ra.rotation.set(0.3, 0.25, 0);
  const la = mesh(arms, armGeo, M.cloth, -0.16, -0.08, -0.22); la.rotation.set(0.25, -0.6, 0);
  const fa = mesh(arms, RB(0.09, 0.09, 0.3, 0.035), M.cloth, -0.05, -0.12, -0.42); fa.rotation.set(0.1, -0.2, 0);
  const gunHolder = new THREE.Group(); gunHolder.position.set(0.12, -0.08, -0.32); arms.add(gunHolder);
  // staattiset osat yhdistetään materiaaleittain liikkuvien osien sisällä (~40 → ~12 piirtokutsua per hahmo)
  const special = new Set([hips, torso, neck, head, arms, gunHolder, ...legs.flatMap(l => [l.leg, l.shin])]);
  for (const cnt of [root, hips, torso, neck, head, arms, ...legs.flatMap(l => [l.leg, l.shin])]) mergeStatic(cnt, special);
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { root, hips, legs, torso, neck, head, arms, gunHolder, mats: M };
}

// säde–pallo ja säde–kapseli -osumat
function rayCapsule(o, d, a, b, r) {
  const ab = new THREE.Vector3().subVectors(b, a), ao = new THREE.Vector3().subVectors(o, a);
  const abab = ab.dot(ab), abd = ab.dot(d), abao = ab.dot(ao), dao = d.dot(ao), aoao = ao.dot(ao);
  const A = abab - abd * abd, B = abab * dao - abao * abd, C = abab * aoao - abao * abao - r * r * abab;
  const h = B * B - A * C;
  if (h >= 0 && A > 1e-8) {
    const t = (-B - Math.sqrt(h)) / A, y = abao + t * abd;
    if (y > 0 && y < abab && t > 0) return t;
  }
  for (const c of [a, b]) { const t = raySphere(o, d, c, r); if (t !== null) return t; }
  return null;
}
function raySphere(o, d, c, r) {
  const oc = new THREE.Vector3().subVectors(o, c), b = oc.dot(d), cc = oc.dot(oc) - r * r, h = b * b - cc;
  if (h < 0) return null; const t = -b - Math.sqrt(h); return t > 0 ? t : null;
}

export class Avatars {
  constructor(scene) {
    this.scene = scene; this.map = new Map(); this.myColor = null;
  }
  // omien tiimiläisten nimikyltit näkyvät seinien läpi
  setMyColor(c) { this.myColor = c; for (const a of this.map.values()) this.styleTag(a); }
  styleTag(a) { const team = a.color === this.myColor; a.tag.material.depthTest = !team; a.tag.renderOrder = team ? 20 : 0; a.tag.material.needsUpdate = true; }
  ensure(p) {
    let a = this.map.get(p.id);
    if (a) { if (a.name !== p.name || a.color !== p.color) { this.remove(p.id); a = null; } else return a; }
    const s = buildSoldier(p.color);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(p.name, p.color), depthTest: true, transparent: true, sizeAttenuation: true }));
    tag.scale.set(1.0, 0.25, 1); tag.position.y = 2.15; s.root.add(tag);
    s.root.visible = false;
    this.scene.add(s.root);
    a = { id: p.id, name: p.name, color: p.color, s, tag, buf: [], pos: new THREE.Vector3(), yaw: 0, pitch: 0, w: -1, alive: false, prot: false,
      phase: 0, speed: 0, deadT: 0, guns: new Map(), hp: 100, last: new THREE.Vector3(), lastShot: 0 };
    this.map.set(p.id, a); this.styleTag(a);
    return a;
  }
  remove(id) { const a = this.map.get(id); if (!a) return; this.scene.remove(a.s.root); this.map.delete(id); }
  // tilannekuva palvelimelta
  push(id, pos, yaw, pitch, w, alive, prot, hp) {
    const a = this.map.get(id); if (!a) return;
    const now = performance.now();
    if (alive && !a.alive) { a.buf.length = 0; a.pos.fromArray(pos); a.deadT = 0; }   // syntyi uudelleen: ei interpolointia vanhasta paikasta
    a.buf.push({ t: now, p: pos, yaw, pitch }); if (a.buf.length > 30) a.buf.shift();
    a.alive = !!alive; a.prot = !!prot; a.hp = hp;
    if (w !== a.w) this.setGun(a, w);
  }
  setGun(a, w) {
    a.w = w;
    for (const g of a.guns.values()) g.visible = false;
    if (!WEAPONS[w]) return;
    let g = a.guns.get(w);
    if (!g) {
      const m = buildWeaponModel(WEAPONS[w]); g = m.root;
      m.hands.left.visible = m.hands.right.visible = false;
      g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = true; } });
      g.userData.muzzle = m.muzzle;
      a.s.gunHolder.add(g); a.guns.set(w, g);
    }
    g.visible = true;
  }
  muzzleWorld(id, out) { const a = this.map.get(id); if (!a) return null; const g = a.guns.get(a.w); if (!g) return null; return g.userData.muzzle.getWorldPosition(out); }

  update(dt) {
    const rt = performance.now() - DELAY;
    for (const a of this.map.values()) {
      const s = a.s;
      // interpolointi kahden tilannekuvan välillä
      const b = a.buf;
      if (b.length) {
        let i = b.length - 1; while (i > 0 && b[i - 1].t > rt) i--;
        const B = b[i], A = b[Math.max(0, i - 1)];
        if (A === B || rt >= B.t) { a.pos.fromArray(B.p); a.yaw = B.yaw; a.pitch = B.pitch; }
        else {
          const k = THREE.MathUtils.clamp((rt - A.t) / Math.max(1, B.t - A.t), 0, 1);
          a.pos.set(A.p[0] + (B.p[0] - A.p[0]) * k, A.p[1] + (B.p[1] - A.p[1]) * k, A.p[2] + (B.p[2] - A.p[2]) * k);
          let dy = B.yaw - A.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); a.yaw = A.yaw + dy * k; a.pitch = A.pitch + (B.pitch - A.pitch) * k;
        }
      }
      const vel = Math.hypot(a.pos.x - a.last.x, a.pos.z - a.last.z) / Math.max(dt, 1e-3); a.last.copy(a.pos);
      a.speed += (Math.min(9, vel) - a.speed) * Math.min(1, dt * 10);
      s.root.position.copy(a.pos);
      if (a.alive) {
        s.root.visible = true; s.root.rotation.set(0, a.yaw, 0);
        a.phase += a.speed * dt * 1.5;
        const sw = Math.min(1, a.speed / 5) * 0.6;
        s.legs[0].leg.rotation.x = Math.sin(a.phase) * sw; s.legs[1].leg.rotation.x = -Math.sin(a.phase) * sw;
        s.legs[0].shin.rotation.x = Math.max(0, -Math.sin(a.phase)) * sw * 1.2; s.legs[1].shin.rotation.x = Math.max(0, Math.sin(a.phase)) * sw * 1.2;
        s.hips.position.y = 0.92 + Math.abs(Math.cos(a.phase)) * 0.03 * sw;
        s.torso.rotation.x = -a.pitch * 0.35; s.arms.rotation.x = a.pitch * 0.65; s.neck.rotation.x = a.pitch * 0.3;
        s.root.rotation.z = 0; s.root.rotation.x = 0;
        // syntymäsuoja: vilkkuva näkyvyys
        s.root.visible = !a.prot || (performance.now() % 300) < 200;
        a.tag.visible = true;
      } else if (s.root.visible) {
        // kaatuminen
        a.deadT += dt;
        const k = Math.min(1, a.deadT / 0.6);
        s.root.rotation.x = -k * k * Math.PI / 2 * 0.95; s.hips.position.y = 0.92 - k * 0.6;
        a.tag.visible = false;
        if (a.deadT > 4) s.root.visible = false;
      }
    }
  }
  // osumatesti: lähin elävä pelaaja säteellä (ampujan näkymän mukaan)
  raycast(o, d, maxDist) {
    let best = null;
    const a0 = new THREE.Vector3(), a1 = new THREE.Vector3(), hc = new THREE.Vector3();
    for (const a of this.map.values()) {
      if (!a.alive || !a.s.root.visible && !a.prot) continue;
      const p = a.pos;
      hc.set(p.x, p.y + HEAD_Y, p.z);
      const th = raySphere(o, d, hc, HEAD_R);
      a0.set(p.x, p.y + BODY_Y0 + BODY_R, p.z); a1.set(p.x, p.y + BODY_Y1 - BODY_R * 0.6, p.z);
      const tb = rayCapsule(o, d, a0, a1, BODY_R);
      let t = null, head = false;
      if (th !== null && (tb === null || th <= tb + 0.15)) { t = th; head = true; } else if (tb !== null) t = tb;
      if (t !== null && t < maxDist && (!best || t < best.dist)) best = { id: a.id, dist: t, head, point: new THREE.Vector3().copy(o).addScaledVector(d, t), color: a.color };
    }
    return best;
  }
  // kapselitesti ammuksille (raketin suora osuma)
  near(p, r) {
    for (const a of this.map.values()) {
      if (!a.alive || a.color === this.myColor) continue;
      const dy = THREE.MathUtils.clamp(p.y - a.pos.y, 0.2, 1.7);
      if (Math.hypot(p.x - a.pos.x, p.y - (a.pos.y + dy), p.z - a.pos.z) < r + BODY_R) return a;
    }
    return null;
  }
}
