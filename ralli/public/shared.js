// Vektoriralli - palvelimen ja selaimen yhteinen koodi: matematiikka, maasto, tieverkko, rakennukset, autot, aseet
(function (root) {
'use strict';
// ---------------- matematiikka ----------------
const add = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const scl = (a, s) => [a[0]*s, a[1]*s, a[2]*s];
const madd = (a, b, s) => [a[0]+b[0]*s, a[1]+b[1]*s, a[2]+b[2]*s];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const vlen = a => Math.sqrt(dot(a, a));
const norm = a => { const l = vlen(a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const chance = p => Math.random() < p;
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function randDir(R = Math.random) { for (;;) { const v = [R()*2-1, R()*2-1, R()*2-1], l = vlen(v); if (l > 0.1 && l <= 1) return scl(v, 1/l); } }
const toWorld = (o, v) => [
  o.r[0]*v[0] + o.u[0]*v[1] + o.f[0]*v[2],
  o.r[1]*v[0] + o.u[1]*v[1] + o.f[1]*v[2],
  o.r[2]*v[0] + o.u[2]*v[1] + o.f[2]*v[2]];
const toLocal = (o, v) => [dot(v, o.r), dot(v, o.u), dot(v, o.f)];
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI*2; while (d < -Math.PI) d += Math.PI*2; return d; };

// ---------------- maailman mitat ----------------
const CITY = 800, BLOCK = 80, WORLD = 2700, CELL = 100, BOUND = 2500, RING_R = 1150;

// Maasto: kaupunki tasainen, ympärillä kumpuilevat kukkulat ja reunalla jyrkät vuoret
function H(x, z) {
  const c = Math.max(Math.abs(x), Math.abs(z));
  const t = ss(CITY + 100, CITY + 500, c);
  if (t <= 0) return 0;
  const r = Math.hypot(x, z), ang = Math.atan2(z, x);
  const hills = 48 + 30 * Math.sin(x * 0.0041 + 0.7) * Math.cos(z * 0.0037 - 0.4)
    + 16 * Math.sin(x * 0.011 - z * 0.008 + 1.3) + 6 * Math.sin(x * 0.027 + z * 0.023);
  const m = ss(1850, 2550, r);
  const peaks = 300 + 150 * Math.sin(ang * 7 + 0.5) + 90 * Math.sin(ang * 13 + 2) + 40 * Math.sin(ang * 29);
  return t * hills + m * peaks;
}
function normalAt(x, z) {
  const e = 2, hx = H(x + e, z) - H(x - e, z), hz = H(x, z + e) - H(x, z - e);
  return norm([-hx, 2 * e, -hz]);
}

// ---------------- tieverkko ----------------
const ROADTYPES = {
  BULEVARDI:  { w: 22, grip: 1.0,  spd: 1.0,  col: '#2a2d36', edge: '#d8dce6', mid: 'median' },
  KATU:       { w: 11, grip: 1.0,  spd: 1.0,  col: '#262830', edge: '#7c8090', mid: 'dash' },
  MOOTTORITIE:{ w: 20, grip: 1.0,  spd: 1.08, col: '#24262e', edge: '#f2f2f2', mid: 'lanes' },
  MAANTIE:    { w: 12, grip: 0.98, spd: 1.0,  col: '#2b2b2b', edge: '#c9c9c9', mid: 'yellow' },
  SORATIE:    { w: 9,  grip: 0.82, spd: 0.88, col: '#4a3a28', edge: '#8a6a44', mid: 'none' },
};
function cityLineType(k) { return k % 5 === 0 ? 'BULEVARDI' : 'KATU'; }

function buildWorld() {
  const R = mulberry32(20261008);
  const roads = [];   // {a:[x,z], b:[x,z], type}
  // kaupungin katuverkko
  const lines = [];
  for (let k = -10; k <= 10; k++) lines.push({ c: k * BLOCK, type: cityLineType(k) });
  // kehätie
  const ring = [];
  for (let i = 0; i <= 80; i++) { const a = i / 80 * Math.PI * 2; ring.push([Math.cos(a) * RING_R, Math.sin(a) * RING_R * 0.96]); }
  for (let i = 0; i < 80; i++) roads.push({ a: ring[i], b: ring[i + 1], type: 'MOOTTORITIE' });
  // bulevardien jatkeet kehälle (maantiet)
  for (const c of [-400, 0, 400]) {
    roads.push({ a: [c, CITY], b: [c, RING_R * 0.96 * Math.sqrt(1 - (c / RING_R) ** 2)], type: 'MAANTIE' });
    roads.push({ a: [c, -CITY], b: [c, -RING_R * 0.96 * Math.sqrt(1 - (c / RING_R) ** 2)], type: 'MAANTIE' });
    roads.push({ a: [CITY, c], b: [RING_R * Math.sqrt(1 - (c / (RING_R * 0.96)) ** 2), c], type: 'MAANTIE' });
    roads.push({ a: [-CITY, c], b: [-RING_R * Math.sqrt(1 - (c / (RING_R * 0.96)) ** 2), c], type: 'MAANTIE' });
  }
  // vuoristotiet: mutkittelevat soratiet kehältä ylös ja vuoristolenkki
  const mtn = [];
  for (let k = 0; k < 4; k++) {
    const a0 = Math.PI / 4 + k * Math.PI / 2, pts = [];
    for (let i = 0; i <= 50; i++) {
      const t = i / 50, rr = RING_R + t * 640, a = a0 + 0.16 * Math.sin(t * 16 + k) * (0.3 + t);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    for (let i = 0; i < 50; i++) roads.push({ a: pts[i], b: pts[i + 1], type: 'SORATIE' });
    mtn.push(pts);
  }
  const loop = [];
  for (let i = 0; i <= 120; i++) { const a = i / 120 * Math.PI * 2, rr = 1790 + 40 * Math.sin(a * 9); loop.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
  for (let i = 0; i < 120; i++) roads.push({ a: loop[i], b: loop[i + 1], type: 'SORATIE' });
  // tieosien haku ruudukosta
  const RG = 100, rgrid = new Map();
  const rkey = (i, j) => i * 100000 + j;
  roads.forEach((s, idx) => {
    const w = ROADTYPES[s.type].w;
    const x0 = Math.floor((Math.min(s.a[0], s.b[0]) - w) / RG), x1 = Math.floor((Math.max(s.a[0], s.b[0]) + w) / RG);
    const z0 = Math.floor((Math.min(s.a[1], s.b[1]) - w) / RG), z1 = Math.floor((Math.max(s.a[1], s.b[1]) + w) / RG);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = rkey(i, j); if (!rgrid.has(k)) rgrid.set(k, []); rgrid.get(k).push(idx); }
  });

  // rakennukset ja puut
  const buildings = [], trees = [];
  const starts = lines.map((l, i) => l.c + ROADTYPES[l.type].w / 2 + 3);
  const ends = lines.map(l => l.c - ROADTYPES[l.type].w / 2 - 3);
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
    const bx0 = starts[i], bx1 = ends[i + 1], bz0 = starts[j], bz1 = ends[j + 1];
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2, d = Math.hypot(cx, cz);
    const r = R();
    if (r < 0.08 || (Math.abs(cx) < 60 && Math.abs(cz) < 60)) {
      // puisto
      const n = 4 + Math.floor(R() * 6);
      for (let k = 0; k < n; k++) trees.push({ x: bx0 + 5 + R() * (bx1 - bx0 - 10), z: bz0 + 5 + R() * (bz1 - bz0 - 10), h: 7 + R() * 7, r: 2.6 });
      buildings.push({ x0: bx0, x1: bx1, z0: bz0, z1: bz1, h: 0.5, kind: 'park' });
      continue;
    }
    if (d < 330) {
      // keskustan tornit
      const n = R() < 0.5 ? 1 : 2;
      if (n === 1) buildings.push({ x0: bx0 + 2, x1: bx1 - 2, z0: bz0 + 2, z1: bz1 - 2, h: 55 + R() * 110 * (1 - d / 500), kind: 'tower' });
      else {
        const mz = (bz0 + bz1) / 2;
        buildings.push({ x0: bx0 + 2, x1: bx1 - 2, z0: bz0 + 2, z1: mz - 3, h: 45 + R() * 80, kind: 'tower' });
        buildings.push({ x0: bx0 + 2, x1: bx1 - 2, z0: mz + 3, z1: bz1 - 2, h: 30 + R() * 60, kind: 'tower' });
      }
    } else if (d < 640) {
      const mx = (bx0 + bx1) / 2, mz = (bz0 + bz1) / 2;
      for (const [x0, x1, z0, z1] of [[bx0, mx - 2, bz0, mz - 2], [mx + 2, bx1, bz0, mz - 2], [bx0, mx - 2, mz + 2, bz1], [mx + 2, bx1, mz + 2, bz1]])
        if (R() < 0.85) buildings.push({ x0, x1, z0, z1, h: 12 + R() * 30, kind: 'mid' });
    } else {
      // omakotitalot harjakatoin
      const nx = 3, nz = 3, sx = (bx1 - bx0) / nx, sz = (bz1 - bz0) / nz;
      for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
        if (a === 1 && b === 1) { trees.push({ x: bx0 + sx * 1.5, z: bz0 + sz * 1.5, h: 8 + R() * 5, r: 2.6 }); continue; }
        if (R() < 0.2) continue;
        const x0 = bx0 + a * sx + 3, z0 = bz0 + b * sz + 3;
        buildings.push({ x0, x1: x0 + sx - 7, z0, z1: z0 + sz - 7, h: 5 + R() * 4, kind: 'house', ridgeX: R() < 0.5 });
      }
    }
  }
  // metsää kukkuloille (ei teille)
  for (let tries = 0; tries < 1400 && trees.length < 700; tries++) {
    const a = R() * Math.PI * 2, rr = 900 + R() * 1250, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (Math.max(Math.abs(x), Math.abs(z)) < CITY + 30) continue;
    if (roadAtRaw(x, z, 4)) continue;
    const n = 1 + Math.floor(R() * 4);
    for (let k = 0; k < n; k++) {
      const tx = x + (R() - 0.5) * 40, tz = z + (R() - 0.5) * 40;
      if (!roadAtRaw(tx, tz, 4)) trees.push({ x: tx, z: tz, h: 8 + R() * 10, r: 2.4 });
    }
  }
  function roadAtRaw(x, z, margin = 0) {
    const k = rkey(Math.floor(x / RG), Math.floor(z / RG)), list = rgrid.get(k);
    if (!list) return null;
    let best = null;
    for (const idx of list) {
      const s = roads[idx], w = ROADTYPES[s.type].w / 2 + margin;
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - s.a[0]) * dx + (z - s.a[1]) * dz) / L2, 0, 1);
      const ex = s.a[0] + dx * t - x, ez = s.a[1] + dz * t - z;
      if (ex * ex + ez * ez < w * w) { if (!best || ROADTYPES[s.type].spd > ROADTYPES[best].spd) best = s.type; }
    }
    return best;
  }
  // törmäysruudukko rakennuksille ja puille
  const CG = 50, cgrid = new Map();
  const put = (o, x0, x1, z0, z1) => {
    for (let i = Math.floor(x0 / CG); i <= Math.floor(x1 / CG); i++) for (let j = Math.floor(z0 / CG); j <= Math.floor(z1 / CG); j++) {
      const k = rkey(i, j); if (!cgrid.has(k)) cgrid.set(k, []); cgrid.get(k).push(o);
    }
  };
  buildings.forEach(b => { if (b.kind !== 'park') put(b, b.x0, b.x1, b.z0, b.z1); });
  trees.forEach(t => { t.y = H(t.x, t.z); put(t, t.x - 3, t.x + 3, t.z - 3, t.z + 3); });
  function nearObstacles(x, z) {
    const out = [], seen = new Set();
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = cgrid.get(rkey(Math.floor(x / CG) + i, Math.floor(z / CG) + j));
      if (l) for (const o of l) if (!seen.has(o)) { seen.add(o); out.push(o); }
    }
    return out;
  }
  // tien tyyppi pisteessä (kaupungissa nopea modulo-tarkistus)
  function roadAt(x, z) {
    if (Math.abs(x) <= CITY + 11 && Math.abs(z) <= CITY + 11) {
      let best = null;
      const kx = Math.round(x / BLOCK), kz = Math.round(z / BLOCK);
      if (Math.abs(kx) <= 10) { const t = cityLineType(kx); if (Math.abs(x - kx * BLOCK) < ROADTYPES[t].w / 2 && Math.abs(z) <= CITY + ROADTYPES[t].w / 2) best = t; }
      if (Math.abs(kz) <= 10) { const t = cityLineType(kz); if (Math.abs(z - kz * BLOCK) < ROADTYPES[t].w / 2 && Math.abs(x) <= CITY + ROADTYPES[t].w / 2) best = best === 'BULEVARDI' ? best : t; }
      if (best) return best;
      if (Math.abs(x) < CITY - 5 && Math.abs(z) < CITY - 5) return 'PIHA';
    }
    return roadAtRaw(x, z);
  }
  // säde rakennuksia vasten (2D AABB + korkeus), palauttaa osumaetäisyyden tai Infinity
  function rayBlock(p, d, maxT) {
    let best = maxT;
    const steps = Math.ceil(maxT / 25);
    const seen = new Set();
    for (let s = 0; s <= steps; s++) {
      const x = p[0] + d[0] * s * 25, z = p[2] + d[2] * s * 25;
      const l = cgrid.get(rkey(Math.floor(x / CG), Math.floor(z / CG)));
      if (!l) continue;
      for (const o of l) {
        if (seen.has(o) || o.kind === undefined) continue; seen.add(o);
        let t0 = 0, t1 = best, ok = true;
        for (const [pa, da, lo, hi] of [[p[0], d[0], o.x0, o.x1], [p[2], d[2], o.z0, o.z1]]) {
          if (Math.abs(da) < 1e-9) { if (pa < lo || pa > hi) { ok = false; break; } continue; }
          let ta = (lo - pa) / da, tb = (hi - pa) / da; if (ta > tb) { const q = ta; ta = tb; tb = q; }
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) { ok = false; break; }
        }
        if (ok && p[1] + d[1] * t0 < o.h) best = Math.min(best, t0);
      }
      if (best < s * 25) break;
    }
    return best;
  }
  return { roads, lines, ring, mtn, loop, buildings, trees, roadAt, nearObstacles, rayBlock };
}

// ---------------- automallit (desimetreinä, skaalataan metreiksi) ----------------
function buildPart(verts, opts = {}) {
  const n = verts.length;
  let scale = 0; for (const v of verts) scale = Math.max(scale, vlen(v));
  const eps = scale * 1e-4 + 1e-6;
  const planes = [];
  for (let i = 0; i < n; i++) for (let j = i+1; j < n; j++) for (let k = j+1; k < n; k++) {
    let nn = cross(sub(verts[j], verts[i]), sub(verts[k], verts[i]));
    if (vlen(nn) < scale*scale*1e-6) continue;
    nn = norm(nn); let d = dot(nn, verts[i]);
    let pos = 0, neg = 0;
    for (let m = 0; m < n; m++) { const s = dot(nn, verts[m]) - d; if (s > eps) pos++; else if (s < -eps) neg++; }
    if (pos && neg) continue;
    if (pos) { nn = scl(nn, -1); d = -d; }
    if (planes.some(p => dot(p.n, nn) > 0.99999 && Math.abs(p.d - d) < eps*10)) continue;
    planes.push({ n: nn, d });
  }
  const onPlane = (p, v) => Math.abs(dot(p.n, v) - p.d) < eps*10;
  const faces = planes.map(p => {
    const idx = []; verts.forEach((v, i) => { if (onPlane(p, v)) idx.push(i); });
    let cen = [0,0,0]; for (const i of idx) cen = add(cen, verts[i]); cen = scl(cen, 1/idx.length);
    const e1 = norm(sub(verts[idx[0]], cen)), e2 = cross(p.n, e1);
    const ang = i => { const d = sub(verts[i], cen); return Math.atan2(dot(d, e2), dot(d, e1)); };
    idx.sort((a, b) => ang(a) - ang(b));
    return { n: p.n, idx };
  });
  let cen = [0,0,0]; for (const v of verts) cen = add(cen, v); cen = scl(cen, 1/n);
  return { v: verts, faces, cen, r: scale, tone: opts.tone || 'body', wheel: opts.wheel, dec: opts.dec || [] };
}
const S = 0.1;
const P = (pts, opts) => buildPart(pts.map(p => scl(p, S)), Object.assign({}, opts, { dec: (opts && opts.dec || []).map(l => l.map(p => scl(p, S))) }));
const mxv = v => [-v[0], v[1], v[2]];
const symP = (pts, opts = {}) => [P(pts, opts), P(pts.map(mxv), Object.assign({}, opts, { dec: (opts.dec || []).map(l => l.map(mxv)) }))];
const box = (x0, x1, y0, y1, z0, z1) => [[x0,y0,z0],[x1,y0,z0],[x0,y1,z0],[x1,y1,z0],[x0,y0,z1],[x1,y0,z1],[x0,y1,z1],[x1,y1,z1]];
const both = pts => pts.flatMap(p => p[0] === 0 ? [p] : [p, mxv(p)]);
function wheel(x, y, z, r, w, front, spokes) {
  const pts = [], dec = [];
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; for (const xx of [x - w/2, x + w/2]) pts.push([xx, y + Math.cos(a) * r, z + Math.sin(a) * r]); }
  const ox = x + Math.sign(x) * w/2;
  const ns = spokes ? 10 : 5;
  for (let i = 0; i < ns; i++) { const a = i / ns * Math.PI * 2 + 0.3; dec.push([[ox, y, z], [ox, y + Math.cos(a) * r * 0.85, z + Math.sin(a) * r * 0.85]]); }
  return P(pts, { tone: 'tire', wheel: { front, c: [x * S, y * S, z * S] }, dec });
}
const wheels4 = (x, y, zf, zr, r, w, spokes) => [wheel(x, y, zf, r, w, true, spokes), wheel(-x, y, zf, r, w, true, spokes), wheel(x, y, zr, r, w, false, spokes), wheel(-x, y, zr, r, w, false, spokes)];
const rect = (x, y0, y1, z0, z1) => [[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], [x, y0, z0]];
const rectF = (z, x0, x1, y0, y1) => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [x0, y0, z]];
function linesOf(poly) { const out = []; for (let i = 0; i < poly.length - 1; i++) out.push([poly[i], poly[i + 1]]); return out; }

// Automallit tulevat tiedostosta ajoneuvot.js (window.VEKTORIRALLI_AUTOT / require).
// Jokainen osa on kupera monitahokas desimetreinä; lasipinnat ovat täytettäviä pintoja auton päällä.
const AUTODATA = (typeof module === 'object' && module.exports) ? require('./ajoneuvot.js') : root.VEKTORIRALLI_AUTOT;
const CARS = AUTODATA.autot.map(a => Object.assign({ nm: a.nimi, desc: a.kuvaus }, a.ominaisuudet));
const CAR_MODELS = AUTODATA.autot.map(a => {
  const parts = [
    ...a.osat.map(o => P(o.points, { tone: o.tone, dec: o.dec || [] })),
    ...a.renkaat.map(w => wheel(w.center[0], w.center[1], w.center[2], w.radius, w.width, !!w.front, !!w.spokes)),
  ];
  const glass = (a.lasipinnat || []).map(g => ({ pts: g.points.map(q => scl(q, S)), n: norm(g.normal) }));
  return { parts, glass, r: Math.max(...parts.map(p => vlen(p.cen) + p.r * 0.5)) };
});

const GUN_RELOAD = 0.5, SPEC_RELOAD = 3;
const GUNS = [
  // Jokainen laukaus vaatii oman painalluksen, ja sen jälkeen ase latautuu GUN_RELOAD sekuntia.
  { nm: 'KIVÄÄRI', desc: 'TARKKA JA KAUAS KANTAVA', cd: 0.5, dmg: 9, pellets: 1, spread: 0.006, range: 300, aim: 0.16, col: '#ffe066' },
  { nm: 'HAULIKKO', desc: 'LÄHELTÄ TUHOISA', cd: 0.5, dmg: 2.8, pellets: 9, spread: 0.08, range: 95, aim: 0.11, col: '#ffb060' },
  { nm: 'KANUUNA', desc: 'RASKAS OSUMA, VAIKEA TÄHDÄTÄ', cd: 0.5, dmg: 15, pellets: 1, spread: 0.004, range: 260, aim: 0.07, col: '#9be7ff' },
];
const SPECIALS = [
  { nm: 'RAKETIT', desc: 'RÄJÄHTÄVÄ AMMUS', cnt: 6, dmg: 32, splash: 9 },
  { nm: 'MIINAT', desc: 'JÄTETÄÄN TAAKSE', cnt: 5, dmg: 38 },
  { nm: 'ÖLJY', desc: 'LIUKAS LÄIKKÄ TAAKSE', cnt: 4 },
];
const PCOL = ['#4fd6ff', '#ffa040', '#ff5ad1'];
const PNAME = ['SININEN', 'ORANSSI', 'VIOLETTI'];
// Aloitus kaupungin itälaidan bulevardilla, jonka takana alkavat kukkulat ja vuoret; autot muutaman talon päässä toisistaan
const SPAWNS = [{ x: 806, z: -150, yaw: 0 }, { x: 794, z: -60, yaw: Math.PI }, { x: 730, z: -163, yaw: Math.PI / 2 }];
const CAR_R = 2.3;

const SD = { add, sub, scl, madd, dot, cross, vlen, norm, clamp, rnd, rndi, chance, ss, mulberry32, randDir, toWorld, toLocal, angDiff,
  CITY, BLOCK, WORLD, CELL, BOUND, RING_R, H, normalAt, ROADTYPES, buildWorld, CARS, CAR_MODELS, GUNS, SPECIALS, PCOL, PNAME, SPAWNS, CAR_R, GUN_RELOAD, SPEC_RELOAD };
if (typeof module === 'object' && module.exports) module.exports = SD; else root.RD = SD;
})(typeof window !== 'undefined' ? window : this);
