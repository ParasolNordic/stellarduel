// Ohjelmallisesti piirretyt tekstuurit (ei ladattavia kuvatiedostoja): partikkeliatlas, kraatterit,
// seinävauriot, luodinreiät ja tähtäinten heijasteet. Kaikki deterministisiä siemenluvun perusteella.
import * as THREE from 'three';

export function rng(seed) {             // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const canvas = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ---------- partikkeliatlas 4 × 2 ruutua à 128 px ----------
// 0 savu A, 1 savu B, 2 tuli, 3 kipinä, 4 pöly, 5 suuliekki, 6 paineaaltorengas, 7 pehmeä piste
export const FRAME = { SMOKE: 0, SMOKE2: 1, FIRE: 2, SPARK: 3, DUST: 4, FLASH: 5, RING: 6, DOT: 7 };
let atlas = null;
export function particleAtlas() {
  if (atlas) return atlas;
  const S = 128, c = canvas(S * 4, S * 2), g = c.getContext('2d');
  const cell = i => [(i % 4) * S, Math.floor(i / 4) * S];
  const puff = (i, seed, blobs, soft) => {
    const [ox, oy] = cell(i), r = rng(seed);
    g.save(); g.beginPath(); g.rect(ox, oy, S, S); g.clip();
    for (let k = 0; k < blobs; k++) {
      const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * S * 0.24, rad = S * (0.12 + r() * 0.16);
      const x = ox + S / 2 + Math.cos(a) * d, y = oy + S / 2 + Math.sin(a) * d;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      const v = 200 + r() * 55 | 0;
      gr.addColorStop(0, `rgba(${v},${v},${v},${soft})`); gr.addColorStop(0.6, `rgba(${v},${v},${v},${soft * 0.45})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(ox, oy, S, S);
    }
    g.restore();
  };
  puff(0, 11, 26, 0.32); puff(1, 29, 22, 0.36); puff(4, 47, 34, 0.2);
  { // tuli: kuuma ydin, rosoinen reuna
    const [ox, oy] = cell(2), r = rng(5);
    g.save(); g.beginPath(); g.rect(ox, oy, S, S); g.clip(); g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 30; k++) {
      const a = r() * Math.PI * 2, d = Math.pow(r(), 1.3) * S * 0.26, rad = S * (0.08 + r() * 0.14);
      const x = ox + S / 2 + Math.cos(a) * d, y = oy + S / 2 + Math.sin(a) * d;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,240,200,0.5)'); gr.addColorStop(0.5, 'rgba(255,150,40,0.25)'); gr.addColorStop(1, 'rgba(120,30,0,0)');
      g.fillStyle = gr; g.fillRect(ox, oy, S, S);
    }
    g.restore();
  }
  const glow = (i, stops) => { const [ox, oy] = cell(i), gr = g.createRadialGradient(ox + S / 2, oy + S / 2, 0, ox + S / 2, oy + S / 2, S / 2); stops.forEach(([o, c2]) => gr.addColorStop(o, c2)); g.fillStyle = gr; g.fillRect(ox, oy, S, S); };
  glow(3, [[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,230,170,0.9)'], [0.45, 'rgba(255,150,50,0.25)'], [1, 'rgba(255,100,0,0)']]);
  glow(7, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
  { // suuliekki: tähtimäiset piikit
    const [ox, oy] = cell(5), cx = ox + S / 2, cy = oy + S / 2, r = rng(9);
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * Math.PI * 2 + r() * 0.4, len = S * (0.3 + r() * 0.18), w = 0.18 + r() * 0.12;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a - w) * len * 0.35, cy + Math.sin(a - w) * len * 0.35); g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); g.lineTo(cx + Math.cos(a + w) * len * 0.35, cy + Math.sin(a + w) * len * 0.35); g.closePath();
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, len); gr.addColorStop(0, 'rgba(255,250,220,0.95)'); gr.addColorStop(0.5, 'rgba(255,180,70,0.6)'); gr.addColorStop(1, 'rgba(255,90,10,0)');
      g.fillStyle = gr; g.fill();
    }
    g.restore();
    glow(5, [[0, 'rgba(255,255,240,1)'], [0.2, 'rgba(255,220,140,0.7)'], [0.5, 'rgba(255,140,40,0)'], [1, 'rgba(0,0,0,0)']]);
  }
  { // paineaaltorengas
    const [ox, oy] = cell(6), gr = g.createRadialGradient(ox + S / 2, oy + S / 2, S * 0.3, ox + S / 2, oy + S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(ox, oy, S, S);
  }
  atlas = new THREE.CanvasTexture(c); atlas.colorSpace = THREE.SRGBColorSpace; atlas.generateMipmaps = true;
  return atlas;
}

// ---------- kraatteriatlas 2 × 2 (väri + korkeus kohoumakarttaa varten) ----------
// Sisäosa: tumma, palanut, halkeillut kuoppa; reuna: kohonnut maa ja sirpaleet; ulko-osa: nokiviuhka.
function drawCrater(g, h, ox, oy, S, seed) {
  const r = rng(seed), cx = ox + S / 2, cy = oy + S / 2, R = S * 0.3;
  g.save(); g.beginPath(); g.rect(ox, oy, S, S); g.clip();
  h.save(); h.beginPath(); h.rect(ox, oy, S, S); h.clip();
  h.fillStyle = 'rgb(128,128,128)'; h.fillRect(ox, oy, S, S);
  // nokiviuhka säteittäisinä juovina
  for (let k = 0; k < 70; k++) {
    const a = r() * Math.PI * 2, l = R * (1.05 + r() * 0.5), w = 0.04 + r() * 0.12;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a - w) * l, cy + Math.sin(a - w) * l); g.lineTo(cx + Math.cos(a + w) * l, cy + Math.sin(a + w) * l); g.closePath();
    const gr = g.createRadialGradient(cx, cy, R * 0.5, cx, cy, l); gr.addColorStop(0, 'rgba(18,15,12,0.55)'); gr.addColorStop(1, 'rgba(18,15,12,0)');
    g.fillStyle = gr; g.fill();
  }
  let gr = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, S * 0.5); gr.addColorStop(0, 'rgba(25,20,16,0.75)'); gr.addColorStop(1, 'rgba(25,20,16,0)'); g.fillStyle = gr; g.fillRect(ox, oy, S, S);
  // reunavalli: vaaleampi möyhentynyt maa, epäsäännöllinen
  for (let k = 0; k < 140; k++) {
    const a = r() * Math.PI * 2, d = R * (0.85 + r() * 0.35), x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, s = S * (0.012 + r() * 0.03);
    const v = 70 + r() * 60 | 0; g.fillStyle = `rgba(${v + 18},${v + 8},${v - 6},0.85)`;
    g.beginPath(); g.ellipse(x, y, s, s * (0.5 + r() * 0.5), r() * 3, 0, Math.PI * 2); g.fill();
    h.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.5})`; h.beginPath(); h.ellipse(x, y, s, s * 0.7, r() * 3, 0, Math.PI * 2); h.fill();
  }
  // kuoppa: tummuu keskelle
  gr = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.95); gr.addColorStop(0, 'rgba(8,6,5,0.98)'); gr.addColorStop(0.55, 'rgba(30,24,19,0.95)'); gr.addColorStop(0.85, 'rgba(58,46,36,0.9)'); gr.addColorStop(1, 'rgba(58,46,36,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R * 0.98, 0, Math.PI * 2); g.fill();
  gr = h.createRadialGradient(cx, cy, 0, cx, cy, R); gr.addColorStop(0, 'rgb(10,10,10)'); gr.addColorStop(0.75, 'rgb(70,70,70)'); gr.addColorStop(1, 'rgba(128,128,128,0)');
  h.fillStyle = gr; h.beginPath(); h.arc(cx, cy, R, 0, Math.PI * 2); h.fill();
  // halkeamat ja sirpaleet kuopassa
  g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = Math.max(1, S / 300);
  for (let k = 0; k < 14; k++) {
    let a = r() * Math.PI * 2, x = cx + Math.cos(a) * R * 0.2, y = cy + Math.sin(a) * R * 0.2;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 6; s++) { a += (r() - 0.5) * 0.9; x += Math.cos(a) * R * 0.14; y += Math.sin(a) * R * 0.14; g.lineTo(x, y); }
    g.stroke();
  }
  for (let k = 0; k < 60; k++) {
    const a = r() * Math.PI * 2, d = R * Math.pow(r(), 0.6) * 0.9, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, s = S * (0.004 + r() * 0.01);
    const v = 40 + r() * 70 | 0; g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.9)`; g.fillRect(x, y, s, s);
  }
  // hehkuvat hiillokset
  for (let k = 0; k < 10; k++) { const a = r() * 6.28, d = R * r() * 0.5; g.fillStyle = 'rgba(120,40,10,0.6)'; g.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2, 2); }
  g.restore(); h.restore();
}
// Seinävaurio: rapautunut, lohjennut pinta (vaaleampi paljastunut kiviaines), musta nokikehä ja halkeamat
function drawScorch(g, h, ox, oy, S, seed) {
  const r = rng(seed), cx = ox + S / 2, cy = oy + S / 2, R = S * 0.22;
  g.save(); g.beginPath(); g.rect(ox, oy, S, S); g.clip();
  h.save(); h.beginPath(); h.rect(ox, oy, S, S); h.clip();
  h.fillStyle = 'rgb(128,128,128)'; h.fillRect(ox, oy, S, S);
  let gr = g.createRadialGradient(cx, cy, 0, cx, cy, S * 0.5); gr.addColorStop(0, 'rgba(10,8,7,0.95)'); gr.addColorStop(0.45, 'rgba(18,15,13,0.7)'); gr.addColorStop(1, 'rgba(20,16,14,0)');
  g.fillStyle = gr; g.fillRect(ox, oy, S, S);
  for (let k = 0; k < 50; k++) {
    const a = r() * Math.PI * 2, l = R * (1.2 + r() * 0.85), w = 0.05 + r() * 0.1;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a - w) * l, cy + Math.sin(a - w) * l); g.lineTo(cx + Math.cos(a + w) * l, cy + Math.sin(a + w) * l); g.closePath();
    gr = g.createRadialGradient(cx, cy, R * 0.3, cx, cy, l); gr.addColorStop(0, 'rgba(8,6,5,0.5)'); gr.addColorStop(1, 'rgba(8,6,5,0)'); g.fillStyle = gr; g.fill();
  }
  // lohjennut alue: epäsäännöllinen monikulmio, paljastunut tiili/kiviaines
  g.beginPath(); h.beginPath();
  const n = 18;
  for (let k = 0; k <= n; k++) { const a = k / n * Math.PI * 2, d = R * (0.65 + r() * 0.5), x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d; if (k) { g.lineTo(x, y); h.lineTo(x, y); } else { g.moveTo(x, y); h.moveTo(x, y); } }
  g.fillStyle = 'rgb(112,78,60)'; g.fill(); h.fillStyle = 'rgb(55,55,55)'; h.fill();
  for (let k = 0; k < 220; k++) {   // tiilien ja laastin kuvio + karkea pinta
    const a = r() * Math.PI * 2, d = R * Math.sqrt(r()) * 0.95, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, s = S * (0.006 + r() * 0.02);
    const v = r(); g.fillStyle = v < 0.4 ? `rgba(150,100,76,0.9)` : v < 0.7 ? 'rgba(80,60,50,0.9)' : 'rgba(30,24,20,0.9)';
    g.fillRect(x, y, s, s * 0.6); h.fillStyle = `rgba(${v * 255 | 0},${v * 255 | 0},${v * 255 | 0},0.6)`; h.fillRect(x, y, s, s * 0.6);
  }
  gr = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.8); gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(1, 'rgba(0,0,0,0.1)'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R * 0.8, 0, 7); g.fill();
  g.strokeStyle = 'rgba(5,4,3,0.85)'; h.strokeStyle = 'rgb(30,30,30)'; g.lineWidth = h.lineWidth = Math.max(1, S / 260);
  for (let k = 0; k < 12; k++) {
    let a = r() * Math.PI * 2, x = cx + Math.cos(a) * R * 0.8, y = cy + Math.sin(a) * R * 0.8;
    g.beginPath(); h.beginPath(); g.moveTo(x, y); h.moveTo(x, y);
    for (let s = 0; s < 7; s++) { a += (r() - 0.5) * 1.0; x += Math.cos(a) * R * 0.18; y += Math.sin(a) * R * 0.18; g.lineTo(x, y); h.lineTo(x, y); }
    g.stroke(); h.stroke();
  }
  // sirpaleiden iskemät reiät ympärillä
  for (let k = 0; k < 40; k++) {
    const a = r() * Math.PI * 2, d = R * (1 + r() * 0.9), x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, s = S * (0.004 + r() * 0.008);
    g.fillStyle = 'rgba(15,12,10,0.95)'; g.beginPath(); g.arc(x, y, s, 0, 7); g.fill(); h.fillStyle = 'rgb(20,20,20)'; h.beginPath(); h.arc(x, y, s, 0, 7); h.fill();
  }
  g.restore(); h.restore();
}
function atlas2x2(draw, size, seed0) {
  const c = canvas(size), hc = canvas(size), g = c.getContext('2d'), h = hc.getContext('2d'), S = size / 2;
  for (let i = 0; i < 4; i++) draw(g, h, (i % 2) * S, Math.floor(i / 2) * S, S, seed0 + i * 977);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const bump = new THREE.CanvasTexture(hc);
  return { map, bump };
}
let craters = null, scorches = null;
export const craterAtlas = () => craters || (craters = atlas2x2(drawCrater, 1024, 101));
export const scorchAtlas = () => scorches || (scorches = atlas2x2(drawScorch, 1024, 303));

let hole = null;
export function bulletHoleTexture() {
  if (hole) return hole;
  const S = 64, c = canvas(S), g = c.getContext('2d');
  let gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.16, 'rgba(10,8,6,1)'); gr.addColorStop(0.24, 'rgba(70,60,52,0.9)'); gr.addColorStop(0.45, 'rgba(40,34,30,0.55)'); gr.addColorStop(1, 'rgba(30,25,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const r = rng(3); g.strokeStyle = 'rgba(20,16,12,0.7)';
  for (let k = 0; k < 6; k++) { const a = r() * 6.28; g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 + Math.cos(a) * S * 0.35, S / 2 + Math.sin(a) * S * 0.35); g.stroke(); }
  hole = new THREE.CanvasTexture(c); hole.colorSpace = THREE.SRGBColorSpace;
  return hole;
}

// tähtäinten heijasteet: punapiste ja holografinen rengas
export function reticleTexture(kind) {
  const S = 128, c = canvas(S), g = c.getContext('2d'), cx = S / 2;
  const glowDot = (r, a) => { const gr = g.createRadialGradient(cx, cx, 0, cx, cx, r); gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.35, `rgba(255,60,40,${a})`); gr.addColorStop(1, 'rgba(255,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cx, r, 0, 7); g.fill(); };
  if (kind === 'holo') {
    g.strokeStyle = 'rgba(255,70,50,0.95)'; g.lineWidth = 3; g.shadowColor = 'rgba(255,40,20,1)'; g.shadowBlur = 6;
    g.beginPath(); g.arc(cx, cx, S * 0.36, 0, 7); g.stroke();
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) { g.beginPath(); g.moveTo(cx + Math.cos(a) * S * 0.36, cx + Math.sin(a) * S * 0.36); g.lineTo(cx + Math.cos(a) * S * 0.44, cx + Math.sin(a) * S * 0.44); g.stroke(); }
    g.shadowBlur = 0; glowDot(S * 0.06, 1);
  } else glowDot(S * 0.16, 1);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// nimikyltti avatarin yläpuolelle
export function nameTexture(name, color) {
  const c = canvas(256, 64), g = c.getContext('2d');
  g.font = 'bold 30px system-ui, -apple-system, Segoe UI, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(8,12,18,0.55)'; const w = Math.min(250, g.measureText(name).width + 28);
  g.beginPath(); g.roundRect((256 - w) / 2, 10, w, 44, 10); g.fill();
  g.fillStyle = color; g.fillRect((256 - w) / 2 + 8, 28, 6, 8);
  g.fillStyle = '#fff'; g.fillText(name, 128 + 6, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
