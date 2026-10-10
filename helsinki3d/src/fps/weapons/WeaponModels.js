// Aseiden 3D-mallit rakennetaan ohjelmallisesti perusmuodoista (pyöristetyt laatikot, sylinterit, toorukset).
// Mitat ovat todellisen kokoisia metreinä; piippu osoittaa −z-suuntaan. Jokainen malli palauttaa:
//   root            Group
//   sight, eye      tähtäyspiste aseen koordinaateissa ja silmän etäisyys siitä tähdätessä
//   hip             aseen paikka lonkalta suhteessa kameraan (tähtäyspisteen sijainti)
//   muzzle, eject   Object3D:t suuliekille ja hylsyn heitolle
//   parts           animoitavat osat: mag, slide, bolt, pump, rocket, ...
//   lens / reticle  kiikarin linssi (render target) tai heijastetähtäimen kuvio
//   hands           { right, left } kädet, leftHome = vasemman käden lepopaikka
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { reticleTexture, rng } from '../fx/textures.js';

// ---------- materiaalit ----------
function woodTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d'), r = rng(77);
  g.fillStyle = '#7a4a26'; g.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(${40 + r() * 30 | 0},${20 + r() * 15 | 0},${8},${0.15 + r() * 0.35})`; g.lineWidth = 0.5 + r() * 1.5; g.beginPath(); const y = r() * 64; g.moveTo(0, y); for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3 + (r() - 0.5) * 2); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
let M = null;
export function materials() {
  if (M) return M;
  const std = (color, metalness, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
  M = {
    metal: std(0x3b3f45, 0.8, 0.36),
    dark: std(0x1e2024, 0.85, 0.32),
    poly: std(0x2a2c30, 0.08, 0.6),
    poly2: std(0x34373b, 0.1, 0.55),
    tan: std(0x8f7b5c, 0.05, 0.72),
    olive: std(0x47503a, 0.1, 0.68),
    wood: std(0xffffff, 0.0, 0.48, { map: woodTexture() }),
    brass: std(0xc9a24c, 1.0, 0.28),
    red: std(0x9b1d18, 0.1, 0.5),
    rubber: std(0x0e0e0f, 0.0, 0.92),
    glove: std(0x2b2a28, 0.0, 0.85),
    sleeve: std(0x4a5040, 0.0, 0.92),
    glass: new THREE.MeshStandardMaterial({ color: 0x5a7a95, metalness: 0.9, roughness: 0.04, transparent: true, opacity: 0.18, depthWrite: false }),
    glassRed: new THREE.MeshStandardMaterial({ color: 0xc89060, metalness: 0.9, roughness: 0.04, transparent: true, opacity: 0.16, depthWrite: false }),
    tritium: new THREE.MeshBasicMaterial({ color: 0x9dff7a }),
    white: new THREE.MeshBasicMaterial({ color: 0xf2f2e8 }),
    insideTube: std(0x050505, 0.2, 0.9, { side: THREE.DoubleSide }),
    warhead: std(0x55613f, 0.3, 0.5),
  };
  return M;
}

// ---------- apufunktiot ----------
const RB = (w, h, d, r = 0.004, s = 2) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
const cylZ = (r1, r2, len, seg = 20, open = false) => new THREE.CylinderGeometry(r2, r1, len, seg, 1, open).rotateX(Math.PI / 2); // r1 edessä (−z), r2 takana
const cylX = (r, len, seg = 14) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2);
const cylY = (r, len, seg = 14) => new THREE.CylinderGeometry(r, r, len, seg);
function P(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
}
const node = (parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; };
function group(parent, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
// toistuvat urat / kiskon lovet
function slots(parent, mat, n, x, y, z0, z1, w, h, d) { for (let i = 0; i < n; i++) P(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z0 + (z1 - z0) * (i + 0.5) / n); }
// liipaisin ja liipaisinkaari
function trigger(parent, m, z = -0.02, y = 0.0) {
  P(parent, new THREE.TorusGeometry(0.022, 0.0035, 6, 16, Math.PI), m.poly, 0, y, z, 0, Math.PI / 2, Math.PI);
  P(parent, RB(0.006, 0.022, 0.008, 0.002), m.dark, 0, y - 0.006, z + 0.004, -0.25);
}

// ---------- kädet ----------
function hand(m, side) {
  const g = new THREE.Group();
  const s = side === 'right' ? 1 : -1;
  P(g, RB(0.05, 0.085, 0.075, 0.018, 3), m.glove, 0.004 * s, 0, 0);                     // kämmen ja sormet nyrkissä
  P(g, RB(0.022, 0.05, 0.024, 0.009, 2), m.glove, -0.028 * s, 0.03, -0.012, 0, 0, 0.5 * s); // peukalo
  for (let i = 0; i < 4; i++) P(g, RB(0.012, 0.016, 0.03, 0.005), m.glove, 0.03 * s, 0.028 - i * 0.019, -0.03 - Math.abs(i - 1.5) * 0.003); // rystyset
  const arm = new THREE.Group(); g.add(arm);
  P(arm, cylZ(0.036, 0.045, 0.16, 14), m.glove, 0, -0.01, 0.1);                          // ranne ja hanska
  P(arm, cylZ(0.047, 0.056, 0.42, 14), m.sleeve, 0, -0.01, 0.37);                        // hiha
  P(arm, cylZ(0.05, 0.05, 0.02, 14), m.olive, 0, -0.01, 0.17);
  arm.rotation.set(0.55, -0.6 * s, 0);
  g.userData.arm = arm;
  return g;
}

// ---------- tähtäimet ----------
function reflexDot(parent, kind, x, y, z, size) {
  const mat = new THREE.MeshBasicMaterial({ map: reticleTexture(kind), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const q = P(parent, new THREE.PlaneGeometry(size, size), mat, x, y, z); q.renderOrder = 5; return q;
}

// ---------- mallit ----------
const BUILDERS = {
  pistol(m) {
    const root = new THREE.Group(), parts = {};
    const slide = parts.slide = group(root, 0, 0, 0);
    P(slide, RB(0.03, 0.033, 0.2, 0.005), m.metal, 0, 0.046, -0.062);
    for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) P(slide, new THREE.BoxGeometry(0.002, 0.024, 0.003), m.dark, sx * 0.0152, 0.046, 0.02 + i * 0.006);
    P(slide, new THREE.BoxGeometry(0.003, 0.012, 0.04), m.dark, 0.0145, 0.052, -0.04);       // poistoaukko
    P(slide, RB(0.012, 0.007, 0.008, 0.002), m.dark, -0.004, 0.066, 0.03); P(slide, RB(0.012, 0.007, 0.008, 0.002), m.dark, 0.004 + 0.004, 0.066, 0.03);
    P(slide, new THREE.BoxGeometry(0.004, 0.009, 0.006), m.dark, 0, 0.066, -0.152);              // jyvä
    P(slide, new THREE.SphereGeometry(0.0016, 8, 6), m.tritium, 0, 0.0675, -0.149);
    P(slide, new THREE.SphereGeometry(0.0014, 8, 6), m.tritium, -0.006, 0.066, 0.034); P(slide, new THREE.SphereGeometry(0.0014, 8, 6), m.tritium, 0.006, 0.066, 0.034);
    P(root, cylZ(0.0075, 0.0075, 0.012), m.dark, 0, 0.05, -0.166);
    P(root, RB(0.028, 0.024, 0.165, 0.005), m.poly, 0, 0.019, -0.055);
    slots(root, m.dark, 3, 0, 0.006, -0.12, -0.08, 0.029, 0.003, 0.004);
    P(root, RB(0.029, 0.112, 0.052, 0.009), m.poly, 0, -0.04, 0.03, -0.24);
    for (let i = 0; i < 5; i++) P(root, new THREE.BoxGeometry(0.03, 0.003, 0.04), m.poly2, 0, -0.01 - i * 0.017, 0.03 + i * 0.004, -0.24);
    const mag = parts.mag = group(root, 0, 0, 0);
    P(mag, RB(0.03, 0.01, 0.054, 0.003), m.dark, 0, -0.098, 0.044, -0.24);
    trigger(root, m, -0.025, 0.004);
    return { root, parts, sight: new THREE.Vector3(0, 0.0695, 0.032), eye: 0.30, hip: new THREE.Vector3(0.105, -0.095, -0.34),
      muzzle: node(root, 0, 0.05, -0.175), eject: node(root, 0.018, 0.055, -0.035), rightGrip: [0, -0.035, 0.032, -0.24], leftGrip: [-0.03, -0.045, 0.018, -0.24], casing: 'short' };
  },

  smg(m) {
    const root = new THREE.Group(), parts = {};
    P(root, RB(0.04, 0.055, 0.3, 0.006), m.metal, 0, 0.042, -0.07);
    P(root, cylZ(0.012, 0.012, 0.21), m.metal, 0, 0.074, -0.17);
    const bolt = parts.bolt = group(root);
    P(bolt, RB(0.016, 0.008, 0.02, 0.003), m.dark, -0.026, 0.07, -0.2);
    P(root, RB(0.048, 0.05, 0.13, 0.012), m.poly, 0, 0.03, -0.25);
    slots(root, m.dark, 5, 0, 0.012, -0.3, -0.2, 0.049, 0.004, 0.006);
    P(root, cylZ(0.01, 0.01, 0.07), m.dark, 0, 0.046, -0.345); P(root, cylZ(0.014, 0.014, 0.025, 6), m.dark, 0, 0.046, -0.38);
    P(root, new THREE.BoxGeometry(0.003, 0.014, 0.05), m.dark, 0.0205, 0.05, -0.03);
    const mag = parts.mag = group(root, 0, 0.012, -0.11);
    for (let i = 0; i < 4; i++) P(mag, RB(0.022, 0.04, 0.034, 0.004), m.dark, 0, -0.02 - i * 0.036, -0.006 - i * i * 0.0035, 0.07 + i * 0.06);
    P(root, RB(0.032, 0.095, 0.046, 0.01), m.poly, 0, -0.03, 0.03, -0.25);
    trigger(root, m, -0.012, -0.002);
    for (const sx of [-1, 1]) P(root, cylZ(0.005, 0.005, 0.15), m.dark, sx * 0.016, 0.04, 0.15);
    P(root, RB(0.036, 0.085, 0.022, 0.006), m.rubber, 0, 0.03, 0.235);
    // punapistetähtäin (avoin heijastin)
    P(root, RB(0.026, 0.008, 0.12, 0.002), m.dark, 0, 0.074, 0.0); slots(root, m.metal, 8, 0, 0.078, -0.05, 0.05, 0.027, 0.003, 0.004);
    P(root, RB(0.032, 0.012, 0.055, 0.003), m.poly, 0, 0.085, 0.005);
    const S = group(root, 0, 0.104, -0.012);
    P(S, RB(0.004, 0.03, 0.012, 0.0015), m.poly, -0.017, 0, 0); P(S, RB(0.004, 0.03, 0.012, 0.0015), m.poly, 0.017, 0, 0);
    P(S, RB(0.038, 0.004, 0.016, 0.0015), m.poly, 0, 0.016, -0.002); P(S, RB(0.008, 0.008, 0.008, 0.002), m.poly2, 0.022, -0.008, 0.012);
    P(S, new THREE.PlaneGeometry(0.031, 0.028), m.glassRed, 0, 0, 0);
    const reticle = reflexDot(S, 'dot', 0, 0, 0.0008, 0.008);
    return { root, parts, reticle, sight: new THREE.Vector3(0, 0.104, 0.02), eye: 0.25, hip: new THREE.Vector3(0.11, -0.1, -0.33),
      muzzle: node(root, 0, 0.046, -0.395), eject: node(root, 0.022, 0.055, -0.04), rightGrip: [0, -0.028, 0.035, -0.25], leftGrip: [0, 0.005, -0.25, 0], casing: 'short' };
  },

  rifle(m) {
    const root = new THREE.Group(), parts = {};
    P(root, RB(0.038, 0.045, 0.24, 0.005), m.metal, 0, 0.024, -0.05);
    P(root, RB(0.042, 0.042, 0.27, 0.005), m.metal, 0, 0.066, -0.065);
    P(root, RB(0.026, 0.01, 0.26, 0.002), m.dark, 0, 0.091, -0.06); slots(root, m.metal, 14, 0, 0.096, -0.18, 0.06, 0.027, 0.003, 0.005);
    P(root, new THREE.BoxGeometry(0.003, 0.016, 0.055), m.dark, 0.0215, 0.068, -0.03);
    P(root, cylX(0.006, 0.012), m.metal, 0.024, 0.06, 0.01);
    const bolt = parts.bolt = group(root);
    P(bolt, RB(0.03, 0.008, 0.012, 0.002), m.dark, 0, 0.083, 0.07);
    const hg = new THREE.CylinderGeometry(0.027, 0.027, 0.28, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8);
    P(root, hg, m.poly, 0, 0.062, -0.335);
    for (const a of [0, Math.PI / 2, -Math.PI / 2]) { const g = group(root, 0, 0.062, -0.335); g.rotation.z = a; slots(g, m.dark, 7, 0, 0.026, -0.12, 0.12, 0.012, 0.003, 0.014); }
    P(root, cylZ(0.009, 0.009, 0.13), m.dark, 0, 0.062, -0.53);
    const mb = P(root, cylZ(0.0145, 0.0145, 0.055, 12), m.dark, 0, 0.062, -0.615);
    for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) P(root, new THREE.BoxGeometry(0.004, 0.012, 0.008), m.rubber, sx * 0.013, 0.062, -0.6 - i * 0.014);
    const mag = parts.mag = group(root, 0, 0.004, -0.1);
    for (let i = 0; i < 4; i++) P(mag, RB(0.024, 0.04, 0.06, 0.004), m.tan, 0, -0.02 - i * 0.036, -0.004 - i * i * 0.005, 0.1 + i * 0.08);
    P(root, RB(0.032, 0.1, 0.048, 0.01), m.poly, 0, -0.04, 0.045, -0.32);
    trigger(root, m, 0.0, -0.004);
    P(root, cylZ(0.016, 0.016, 0.2), m.dark, 0, 0.055, 0.17);
    P(root, RB(0.042, 0.075, 0.17, 0.012), m.poly, 0, 0.04, 0.22); P(root, RB(0.044, 0.1, 0.025, 0.008), m.rubber, 0, 0.03, 0.31);
    // putkipunapiste
    P(root, RB(0.022, 0.03, 0.04, 0.004), m.dark, 0, 0.109, -0.02);
    const tube = group(root, 0, 0.134, -0.02);
    P(tube, cylZ(0.0205, 0.0205, 0.11, 28, true), m.metal); P(tube, cylZ(0.019, 0.019, 0.108, 28, true), m.insideTube);
    P(tube, cylZ(0.023, 0.023, 0.016, 28, true), m.dark, 0, 0, -0.052); P(tube, cylZ(0.023, 0.023, 0.016, 28, true), m.dark, 0, 0, 0.052);
    P(tube, cylY(0.008, 0.016), m.dark, 0, 0.026, 0); P(tube, cylX(0.008, 0.016), m.dark, 0.026, 0, 0);
    P(tube, new THREE.CircleGeometry(0.019, 28), m.glassRed, 0, 0, -0.055, 0, 0, 0);
    const reticle = reflexDot(tube, 'dot', 0, 0, -0.054 + 0.001, 0.006);
    return { root, parts, reticle, sight: new THREE.Vector3(0, 0.134, 0.035), eye: 0.21, hip: new THREE.Vector3(0.12, -0.115, -0.33),
      muzzle: node(root, 0, 0.062, -0.65), eject: node(root, 0.022, 0.07, -0.03), rightGrip: [0, -0.032, 0.05, -0.32], leftGrip: [0, 0.03, -0.33, 0], casing: 'rifle' };
  },

  shotgun(m) {
    const root = new THREE.Group(), parts = {};
    P(root, RB(0.044, 0.06, 0.2, 0.008), m.dark, 0, 0.042, -0.02);
    P(root, new THREE.BoxGeometry(0.003, 0.02, 0.06), m.rubber, 0.0225, 0.045, -0.04);
    P(root, cylZ(0.0125, 0.0125, 0.55, 20), m.metal, 0, 0.062, -0.39);
    P(root, RB(0.008, 0.004, 0.53, 0.0015), m.dark, 0, 0.0755, -0.39);
    P(root, cylZ(0.013, 0.013, 0.46, 18), m.metal, 0, 0.032, -0.35); P(root, cylZ(0.0145, 0.0145, 0.02, 18), m.dark, 0, 0.032, -0.585);
    P(root, new THREE.SphereGeometry(0.0028, 10, 8), m.brass, 0, 0.0795, -0.65);
    P(root, RB(0.004, 0.007, 0.01, 0.0015), m.dark, -0.005, 0.0755, 0.075); P(root, RB(0.004, 0.007, 0.01, 0.0015), m.dark, 0.005, 0.0755, 0.075);
    const pump = parts.pump = group(root, 0, 0, 0);
    P(pump, RB(0.052, 0.046, 0.17, 0.014), m.wood, 0, 0.03, -0.31);
    for (let i = 0; i < 6; i++) P(pump, new THREE.BoxGeometry(0.053, 0.003, 0.006), m.dark, 0, 0.012, -0.37 + i * 0.024);
    P(root, RB(0.036, 0.062, 0.11, 0.012), m.wood, 0, 0.006, 0.105, -0.5);
    P(root, RB(0.042, 0.085, 0.24, 0.014), m.wood, 0, -0.012, 0.25, 0.1);
    P(root, RB(0.044, 0.09, 0.02, 0.008), m.rubber, 0, -0.024, 0.37, 0.1);
    trigger(root, m, 0.035, 0.008);
    parts.mag = group(root);
    return { root, parts, sight: new THREE.Vector3(0, 0.0795, 0.075), eye: 0.15, hip: new THREE.Vector3(0.115, -0.11, -0.3),
      muzzle: node(root, 0, 0.062, -0.67), eject: node(root, 0.024, 0.05, -0.04), rightGrip: [0, -0.01, 0.1, -0.5], leftGrip: [0, 0.0, -0.31, 0], leftOnPump: true, casing: 'shell' };
  },

  sniper(m) {
    const root = new THREE.Group(), parts = {};
    P(root, cylZ(0.019, 0.019, 0.24, 20), m.metal, 0, 0.052, -0.04);
    const bolt = parts.bolt = group(root, 0, 0.052, 0.04);
    P(bolt, cylZ(0.0125, 0.0125, 0.07, 16), m.dark, 0, 0, 0.02);
    const handle = group(bolt); P(handle, cylX(0.004, 0.045), m.dark, 0.024, 0, 0.03); P(handle, new THREE.SphereGeometry(0.009, 12, 10), m.dark, 0.048, -0.006, 0.03);
    parts.boltHandle = handle;
    P(root, cylZ(0.0115, 0.0165, 0.64, 20), m.dark, 0, 0.052, -0.48);
    P(root, cylZ(0.017, 0.017, 0.06, 10), m.dark, 0, 0.052, -0.82); for (const sx of [-1, 1]) P(root, new THREE.BoxGeometry(0.004, 0.02, 0.012), m.rubber, sx * 0.016, 0.052, -0.82);
    P(root, RB(0.052, 0.052, 0.4, 0.012), m.olive, 0, 0.022, -0.27);
    P(root, RB(0.052, 0.055, 0.22, 0.01), m.olive, 0, 0.02, -0.02);
    P(root, RB(0.036, 0.095, 0.05, 0.011), m.olive, 0, -0.036, 0.085, -0.35);
    P(root, RB(0.046, 0.11, 0.25, 0.014), m.olive, 0, -0.005, 0.29);
    P(root, RB(0.038, 0.03, 0.13, 0.008), m.olive, 0, 0.062, 0.26);
    P(root, RB(0.048, 0.12, 0.022, 0.008), m.rubber, 0, -0.008, 0.425);
    parts.mag = group(root); P(parts.mag, RB(0.03, 0.05, 0.07, 0.004), m.dark, 0, -0.012, -0.05);
    for (const sx of [-1, 1]) P(root, cylZ(0.004, 0.004, 0.18), m.dark, sx * 0.012, -0.006, -0.36);
    trigger(root, m, 0.04, 0.0);
    // kiikari
    for (const z of [-0.06, 0.06]) { P(root, RB(0.016, 0.022, 0.018, 0.003), m.dark, 0, 0.085, z); P(root, new THREE.TorusGeometry(0.0165, 0.0035, 8, 24), m.dark, 0, 0.11, z); }
    const sc = group(root, 0, 0.11, 0);
    P(sc, cylZ(0.015, 0.015, 0.25, 28), m.dark, 0, 0, -0.01);
    P(sc, cylZ(0.026, 0.015, 0.06, 28), m.dark, 0, 0, -0.165); P(sc, cylZ(0.026, 0.026, 0.03, 28), m.dark, 0, 0, -0.21);
    P(sc, new THREE.CircleGeometry(0.023, 28), m.glass, 0, 0, -0.2255, Math.PI, 0, 0);
    P(sc, cylZ(0.016, 0.02, 0.05, 28), m.dark, 0, 0, 0.14); P(sc, cylZ(0.02, 0.02, 0.035, 28, true), m.rubber, 0, 0, 0.18); P(sc, cylZ(0.0195, 0.0195, 0.035, 28, true), m.insideTube, 0, 0, 0.18);
    P(sc, cylY(0.011, 0.022, 18), m.dark, 0, 0.022, 0); P(sc, cylX(0.011, 0.022, 18), m.dark, 0.022, 0, 0); P(sc, cylX(0.009, 0.016, 18), m.dark, -0.019, 0, 0);
    const lens = P(sc, new THREE.CircleGeometry(0.0172, 48), new THREE.MeshBasicMaterial({ color: 0x000000 }), 0, 0, 0.168);
    return { root, parts, lens, lensRadius: 0.0172, sight: new THREE.Vector3(0, 0.11, 0.168), eye: 0.062, hip: new THREE.Vector3(0.12, -0.13, -0.4),
      muzzle: node(root, 0, 0.052, -0.86), eject: node(root, 0.024, 0.06, 0.0), rightGrip: [0, -0.028, 0.09, -0.35], leftGrip: [0, -0.0, -0.3, 0], casing: 'long' };
  },

  lmg(m) {
    const root = new THREE.Group(), parts = {};
    P(root, RB(0.058, 0.075, 0.3, 0.008), m.metal, 0, 0.04, -0.05);
    const cover = parts.cover = group(root, 0, 0.088, 0.09);
    P(cover, RB(0.062, 0.02, 0.19, 0.006), m.dark, 0, 0, -0.1);
    P(root, cylZ(0.024, 0.024, 0.3, 20), m.dark, 0, 0.05, -0.36);
    for (let i = 0; i < 8; i++) for (const sx of [-1, 1]) P(root, new THREE.CircleGeometry(0.006, 10), m.rubber, sx * 0.0243, 0.05, -0.25 - i * 0.03, 0, sx * Math.PI / 2, 0);
    P(root, cylZ(0.012, 0.012, 0.2), m.dark, 0, 0.05, -0.6); P(root, cylZ(0.016, 0.016, 0.06, 6), m.dark, 0, 0.05, -0.72);
    const ch = group(root, 0, 0.08, -0.3); P(ch, RB(0.01, 0.04, 0.012, 0.003), m.dark, 0, 0.0, -0.05); P(ch, RB(0.01, 0.04, 0.012, 0.003), m.dark, 0, 0.0, 0.05); P(ch, RB(0.016, 0.012, 0.13, 0.005), m.poly, 0, 0.024, 0);
    for (const sx of [-1, 1]) { P(root, cylZ(0.005, 0.005, 0.26), m.dark, sx * 0.014, 0.02, -0.48); P(root, RB(0.012, 0.008, 0.03, 0.003), m.rubber, sx * 0.014, 0.02, -0.62); }
    const mag = parts.mag = group(root, 0, 0, 0);
    P(mag, RB(0.075, 0.095, 0.115, 0.01), m.olive, -0.01, -0.035, -0.08);
    P(mag, RB(0.078, 0.006, 0.118, 0.002), m.dark, -0.01, 0.0135, -0.08);
    for (let i = 0; i < 6; i++) { const c = P(mag, cylX(0.0045, 0.05, 8), m.brass, -0.05 + i * 0.006, 0.012 + i * 0.008, -0.075); c.rotation.y = 0.1; }
    P(root, RB(0.034, 0.095, 0.048, 0.01), m.poly, 0, -0.035, 0.07, -0.25);
    trigger(root, m, 0.035, -0.0);
    P(root, RB(0.044, 0.04, 0.22, 0.01), m.poly, 0, 0.05, 0.2); P(root, RB(0.03, 0.06, 0.03, 0.008), m.poly, 0, 0.0, 0.29); P(root, RB(0.046, 0.11, 0.022, 0.008), m.rubber, 0, 0.03, 0.32);
    // holografinen tähtäin
    P(root, RB(0.044, 0.012, 0.085, 0.003), m.dark, 0, 0.104, 0.03);
    const H = group(root, 0, 0.134, 0.02);
    P(H, RB(0.052, 0.018, 0.085, 0.004), m.poly, 0, -0.02, 0.0);
    P(H, RB(0.007, 0.044, 0.06, 0.002), m.poly, -0.0225, 0.004, 0); P(H, RB(0.007, 0.044, 0.06, 0.002), m.poly, 0.0225, 0.004, 0);
    P(H, RB(0.052, 0.006, 0.066, 0.002), m.poly, 0, 0.027, 0);
    for (const bx of [-0.012, 0, 0.012]) P(H, RB(0.007, 0.004, 0.007, 0.0015), m.rubber, bx, -0.01, 0.036);
    P(H, new THREE.PlaneGeometry(0.038, 0.04), m.glass, 0, 0.004, -0.028);
    const reticle = reflexDot(H, 'holo', 0, 0.004, -0.027, 0.02);
    return { root, parts, reticle, sight: new THREE.Vector3(0, 0.138, 0.03), eye: 0.25, hip: new THREE.Vector3(0.125, -0.125, -0.33),
      muzzle: node(root, 0, 0.05, -0.76), eject: node(root, 0.03, 0.03, -0.06), rightGrip: [0, -0.03, 0.072, -0.25], leftGrip: [0, 0.015, -0.27, 0], casing: 'rifle' };
  },

  launcher(m) {
    const root = new THREE.Group(), parts = {};
    P(root, cylZ(0.052, 0.052, 0.95, 32, true), m.olive, 0, 0.065, -0.12);
    P(root, cylZ(0.049, 0.049, 0.95, 32, true), m.insideTube, 0, 0.065, -0.12);
    P(root, cylZ(0.058, 0.058, 0.05, 32, true), m.dark, 0, 0.065, -0.58); P(root, cylZ(0.058, 0.058, 0.04, 32, true), m.dark, 0, 0.065, 0.08);
    P(root, cylZ(0.055, 0.075, 0.09, 32, true), m.dark, 0, 0.065, 0.39);
    P(root, RB(0.05, 0.025, 0.2, 0.008), m.rubber, 0, 0.005, 0.2);
    const rocket = parts.rocket = group(root, 0, 0.065, -0.6);
    P(rocket, cylZ(0.0, 0.045, 0.16, 24), m.warhead, 0, 0, -0.07); P(rocket, cylZ(0.045, 0.045, 0.05, 24), m.warhead, 0, 0, 0.03); P(rocket, new THREE.SphereGeometry(0.009, 10, 8), m.brass, 0, 0, -0.152);
    P(root, RB(0.03, 0.03, 0.08, 0.006), m.poly, 0, 0.0, 0.0);
    P(root, RB(0.032, 0.1, 0.048, 0.01), m.poly, 0, -0.05, 0.02, -0.2); trigger(root, m, -0.035, -0.02);
    P(root, RB(0.032, 0.1, 0.04, 0.01), m.poly, 0, -0.04, -0.3, -0.1);
    // tähtäimet: takana diopteri, edessä jyvä suojakorvilla
    P(root, RB(0.012, 0.03, 0.012, 0.003), m.dark, 0, 0.128, 0.06); P(root, new THREE.TorusGeometry(0.008, 0.0025, 8, 20), m.dark, 0, 0.148, 0.06);
    P(root, RB(0.03, 0.012, 0.012, 0.003), m.dark, 0, 0.123, -0.4);
    P(root, new THREE.BoxGeometry(0.0035, 0.024, 0.004), m.dark, 0, 0.136, -0.4); P(root, new THREE.SphereGeometry(0.0018, 8, 6), m.tritium, 0, 0.148, -0.398);
    P(root, RB(0.004, 0.032, 0.01, 0.0015), m.dark, -0.014, 0.137, -0.4); P(root, RB(0.004, 0.032, 0.01, 0.0015), m.dark, 0.014, 0.137, -0.4);
    parts.mag = group(root);
    return { root, parts, sight: new THREE.Vector3(0, 0.148, 0.06), eye: 0.2, hip: new THREE.Vector3(0.14, -0.14, -0.34),
      muzzle: node(root, 0, 0.065, -0.62), eject: node(root, 0, 0.065, 0.45), rightGrip: [0, -0.045, 0.025, -0.2], leftGrip: [0, -0.04, -0.3, -0.1], casing: null };
  },
};

export function buildWeaponModel(def) {
  const m = materials();
  const w = BUILDERS[def.id](m);
  w.root.name = 'weapon-' + def.id;
  w.hip.set(w.hip.x * 0.85, w.hip.y + 0.024, w.hip.z + 0.02);     // lonkka-asento hieman ylemmäs ja keskemmälle
  // kädet: oikea kahvalle, vasen etutukeen (tai lippaalle latauksessa)
  const right = hand(m, 'right'), left = hand(m, 'left');
  const [rx, ry, rz, rr] = w.rightGrip; right.position.set(rx + 0.004, ry, rz); right.rotation.x = rr; w.root.add(right);
  const [lx, ly, lz, lr] = w.leftGrip;
  if (w.leftOnPump) { w.parts.pump.add(left); } else w.root.add(left);
  left.position.set(lx - (def.id === 'pistol' ? 0 : 0.006), ly - (def.id === 'pistol' ? 0 : 0.03), lz); left.rotation.x = lr;
  if (def.id !== 'pistol') { left.rotation.z = -0.25; left.userData.arm.rotation.set(0.7, 0.75, 0); }
  w.hands = { right, left, leftHome: left.position.clone() };
  // staattiset osat yhdistetään materiaaleittain: ~80 piirtokutsua → ~15 per ase
  const special = new Set([...Object.values(w.parts), right, left, w.lens, w.reticle].filter(Boolean));
  for (const c of [w.root, ...Object.values(w.parts), right, left]) mergeStatic(c, special);
  w.root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  return w;
}

export function mergeStatic(container, special) {
  container.updateWorldMatrix(true, true);
  const inv = container.matrixWorld.clone().invert(), groups = new Map(), victims = [];
  const walk = o => {
    for (const ch of o.children) {
      if (special.has(ch) && ch !== container) continue;
      if (ch.isMesh && !ch.renderOrder) {
        const g = ch.geometry.index ? ch.geometry.toNonIndexed() : ch.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, ch.matrixWorld));
        if (!groups.has(ch.material)) groups.set(ch.material, []);
        groups.get(ch.material).push(g); victims.push(ch);
      }
      walk(ch);
    }
  };
  walk(container);
  for (const v of victims) v.parent.remove(v);
  for (const [mat, geos] of groups) { const merged = mergeGeometries(geos, false); if (merged) container.add(new THREE.Mesh(merged, mat)); }
}

// pieni kranaattimalli (heittoon ja lentäväksi ammukseksi)
export function grenadeMesh() {
  const m = materials(), g = new THREE.Group();
  P(g, new THREE.SphereGeometry(0.034, 16, 12).scale(1, 1.2, 1), m.olive);
  for (let i = 0; i < 4; i++) P(g, new THREE.TorusGeometry(0.034, 0.002, 4, 18), m.dark, 0, -0.024 + i * 0.016, 0, Math.PI / 2, 0, 0);
  P(g, cylY(0.012, 0.02), m.dark, 0, 0.046, 0); P(g, RB(0.008, 0.05, 0.012, 0.002), m.metal, 0.018, 0.03, 0, 0, 0, -0.25);
  P(g, new THREE.TorusGeometry(0.008, 0.0015, 6, 12), m.metal, -0.014, 0.052, 0);
  return g;
}
// raketti lennossa
export function rocketMesh() {
  const m = materials(), g = new THREE.Group();
  P(g, cylZ(0.0, 0.045, 0.16, 16), m.warhead, 0, 0, -0.08); P(g, cylZ(0.045, 0.03, 0.3, 16), m.olive, 0, 0, 0.15);
  for (let i = 0; i < 4; i++) { const f = P(g, RB(0.002, 0.05, 0.08, 0.001), m.dark, 0, 0, 0.27); f.rotation.z = i * Math.PI / 2; f.position.set(Math.sin(i * Math.PI / 2) * 0.03, Math.cos(i * Math.PI / 2) * 0.03, 0.27); }
  return g;
}
