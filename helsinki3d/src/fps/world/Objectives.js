// Kartan kiinteät kohteet: tarkastuspaikat (karttanäyttö, josta näkee kaikkien pelaajien sijainnit) ja
// ammuslaatikot (kranaatit / sinkoammukset). Paikat tulevat shared.js:stä; laatikoiden tila palvelimelta.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CHECKPOINT_RADIUS, CRATE_KINDS } from '../shared.js';

const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

function screenTexture() {
  return canvasTex(256, 160, (g, w, h) => {
    g.fillStyle = '#041204'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(80,255,120,0.35)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = '#6dff8a'; g.lineWidth = 3; g.beginPath(); g.arc(w / 2, h / 2, 46, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 + 40, h / 2 - 22); g.stroke();
    g.fillStyle = '#6dff8a'; g.font = 'bold 18px monospace'; g.fillText('KARTTA', 10, 22); g.fillText('▲ TARKASTUS', 10, h - 12);
    for (const [x, y] of [[70, 50], [190, 110], [160, 40]]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
  });
}
function crateTexture(kind) {
  const k = CRATE_KINDS[kind];
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#4b5638'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 2); }
    g.fillStyle = kind === 'rocket' ? '#d8452b' : '#e8c12a'; g.fillRect(0, 14, w, 14); g.fillRect(0, h - 28, w, 14);
    g.fillStyle = '#f2f0e4'; g.font = 'bold 30px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(k.label, w / 2, h / 2 + 2);
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
  });
}
function iconTexture(kind) {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = 'rgba(10,14,20,0.7)'; g.beginPath(); g.arc(64, 64, 56, 0, 7); g.fill();
    g.strokeStyle = kind === 'rocket' ? '#ff6a3d' : '#ffd61f'; g.lineWidth = 6; g.stroke();
    g.fillStyle = g.strokeStyle;
    if (kind === 'rocket') { g.beginPath(); g.moveTo(64, 24); g.lineTo(78, 50); g.lineTo(78, 92); g.lineTo(50, 92); g.lineTo(50, 50); g.closePath(); g.fill(); g.fillRect(42, 92, 44, 10); }
    else { g.beginPath(); g.ellipse(64, 72, 24, 30, 0, 0, 7); g.fill(); g.fillRect(56, 30, 16, 14); g.fillRect(72, 34, 18, 6); }
  });
}

export class Objectives {
  constructor(scene, world, mapDef) {
    this.scene = scene; this.world = world; this.def = mapDef;
    this.checkpoints = []; this.crates = new Map(); this.time = 0;
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f44, metalness: 0.6, roughness: 0.45 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x8d8a83, roughness: 0.95 });
    const screen = new THREE.MeshBasicMaterial({ map: screenTexture(), toneMapped: false });
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x55ff88, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0x66ff88, toneMapped: false });
    for (const [x, z] of mapDef.checkpoints) {
      const y = world.heightAt(x, z) ?? world.center.y;
      const g = new THREE.Group(); g.position.set(x, y, z); g.name = 'checkpoint';
      const add = (geo, mat, px, py, pz, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.rotation.x = rx; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
      add(new RoundedBoxGeometry(2.4, 0.2, 2.4, 2, 0.05), concrete, 0, 0.05, 0);
      add(new RoundedBoxGeometry(0.22, 1.1, 0.22, 2, 0.04), metal, 0, 0.7, 0);
      add(new RoundedBoxGeometry(0.9, 0.62, 0.16, 2, 0.04), metal, 0, 1.45, 0, -0.45);
      const scr = add(new THREE.PlaneGeometry(0.78, 0.5), screen, 0, 1.45, 0, -0.45); scr.position.add(new THREE.Vector3(0, 0.035, 0.075)); scr.castShadow = false;
      add(new THREE.CylinderGeometry(0.015, 0.015, 1.4), metal, 0.38, 2.3, -0.05);
      const lamp = add(new THREE.SphereGeometry(0.07, 12, 8), this.lampMat, 0.38, 3.02, -0.05); lamp.castShadow = false;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 60, 16, 1, true), beamMat); beam.position.y = 30; beam.renderOrder = 9; g.add(beam);
      scene.add(g);
      this.checkpoints.push({ x, z, y, group: g });
    }
    // laatikot: kaksi mallia (kranaatit / sinko), instanssit luodaan tarpeen mukaan
    const lid = new THREE.MeshStandardMaterial({ color: 0x3c4530, roughness: 0.8 });
    this.crateMats = { grenade: new THREE.MeshStandardMaterial({ map: crateTexture('grenade'), roughness: 0.8 }), rocket: new THREE.MeshStandardMaterial({ map: crateTexture('rocket'), roughness: 0.8 }) };
    this.crateGeo = new RoundedBoxGeometry(0.95, 0.5, 0.62, 2, 0.03); this.lidGeo = new RoundedBoxGeometry(1.0, 0.08, 0.66, 2, 0.02); this.lidMat = lid;
    this.icons = { grenade: iconTexture('grenade'), rocket: iconTexture('rocket') };
  }

  // palvelimen lista: [{ i, kind, p: [x, z], active }]
  setCrates(list) {
    const seen = new Set();
    for (const c of list) {
      seen.add(c.i);
      let o = this.crates.get(c.i);
      if (o && (o.kind !== c.kind || o.x !== c.p[0] || o.z !== c.p[1])) { this.scene.remove(o.group); this.crates.delete(c.i); o = null; }
      if (!o) {
        const [x, z] = c.p, y = this.world.heightAt(x, z) ?? this.world.center.y;
        const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ((x * 7 + z * 13) % 6.28);
        const box = new THREE.Mesh(this.crateGeo, this.crateMats[c.kind]); box.position.y = 0.25; box.castShadow = box.receiveShadow = true; g.add(box);
        const l = new THREE.Mesh(this.lidGeo, this.lidMat); l.position.y = 0.53; l.castShadow = true; g.add(l);
        const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.icons[c.kind], depthTest: true, transparent: true })); icon.scale.set(0.6, 0.6, 1); icon.position.y = 1.4; g.add(icon);
        this.scene.add(g);
        o = { i: c.i, kind: c.kind, x, z, y, group: g, icon, active: c.active, req: 0 };
        this.crates.set(c.i, o);
      }
      o.active = c.active; o.group.visible = c.active;
    }
    for (const [i, o] of this.crates) if (!seen.has(i)) { this.scene.remove(o.group); this.crates.delete(i); }
  }
  // lähellä oleva aktiivinen laatikko (poiminta), palauttaa indeksin tai -1
  nearCrate(pos, r = 2.2) {
    const now = performance.now();
    for (const o of this.crates.values()) if (o.active && Math.hypot(pos.x - o.x, pos.z - o.z) < r && Math.abs(pos.y - o.y) < 2.5 && now - o.req > 1000) { o.req = now; return o.i; }
    return -1;
  }
  atCheckpoint(pos) { return this.checkpoints.find(c => Math.hypot(pos.x - c.x, pos.z - c.z) < CHECKPOINT_RADIUS && Math.abs(pos.y - c.y) < 3) || null; }
  update(dt) {
    this.time += dt;
    this.lampMat.color.setHSL(0.36, 1, (Math.sin(this.time * 4) > 0 ? 0.6 : 0.25));
    for (const o of this.crates.values()) if (o.active) { o.icon.position.y = 1.35 + Math.sin(this.time * 2 + o.i) * 0.08; }
  }
}

// karttanäyttö: yläkuva + pelaajat, laatikot ja tarkastuspaikat
export class MapScreen {
  constructor(el, top) {
    this.el = el; this.top = top; this.canvas = el.querySelector('canvas'); this.g = this.canvas.getContext('2d');
    this.canvas.width = top.canvas.width; this.canvas.height = top.canvas.height; this.visible = false; this.acc = 0;
  }
  show(on) { if (on !== this.visible) { this.visible = on; this.el.classList.toggle('hidden', !on); } }
  draw(me, myColor, players, objectives) {
    const g = this.g, T = this.top, W = this.canvas.width, H = this.canvas.height, s = W / 512;
    g.drawImage(T.canvas, 0, 0);
    g.fillStyle = 'rgba(0,30,10,0.35)'; g.fillRect(0, 0, W, H);
    for (const c of objectives.checkpoints) { const [x, y] = T.toPx(c.x, c.z); g.strokeStyle = '#6dff8a'; g.lineWidth = 3 * s; g.beginPath(); g.arc(x, y, 9 * s, 0, 7); g.stroke(); }
    for (const o of objectives.crates.values()) if (o.active) { const [x, y] = T.toPx(o.x, o.z); g.fillStyle = o.kind === 'rocket' ? '#ff6a3d' : '#ffd61f'; g.fillRect(x - 4 * s, y - 4 * s, 8 * s, 8 * s); }
    g.font = `bold ${Math.round(12 * s)}px monospace`; g.textAlign = 'center';
    for (const p of players) {
      if (!p.alive) continue;
      const [x, y] = T.toPx(p.x, p.z);
      g.fillStyle = p.color; g.strokeStyle = '#000'; g.lineWidth = 2 * s;
      g.beginPath(); g.arc(x, y, 7 * s, 0, 7); g.fill(); g.stroke();
      g.fillStyle = p.color === myColor ? '#e8ffe8' : p.color; g.fillText(p.name + (p.color === myColor ? ' ◆' : ''), x, y - 11 * s);
    }
    // oma paikka ja katsesuunta
    const [mx, my] = T.toPx(me.x, me.z);
    g.save(); g.translate(mx, my); g.rotate(-me.yaw); g.fillStyle = '#ffffff'; g.strokeStyle = '#000'; g.lineWidth = 2 * s;
    g.beginPath(); g.moveTo(0, -14 * s); g.lineTo(9 * s, 9 * s); g.lineTo(0, 4 * s); g.lineTo(-9 * s, 9 * s); g.closePath(); g.fill(); g.stroke(); g.restore();
  }
}
