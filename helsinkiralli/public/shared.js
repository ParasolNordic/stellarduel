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

// ---------------- Kruununhaan kaupunki (kaupunki.js, generoitu LoD2-mallista) ----------------
// x = itä, y = ylös, z = pohjoinen (metrejä). Rakennusalue 1 m ruudukossa, korkeudet 2 m ruudukossa,
// maanpinta 8 m ruudukossa.
const KD = (typeof module === 'object' && module.exports) ? require('./kaupunki.js') : root.HKI_KAUPUNKI;
const [BX0, BZ0, BX1, BZ1] = KD.bounds, EDGE = 9;
const OCC = (() => {
  const o = KD.occ, a = new Uint8Array(o.nx * o.nz); let k = 0, v = 0;
  for (const run of o.rle) { if (v) a.fill(1, k, k + run); k += run; v ^= 1; }
  return a;
})();
const HGT = (() => {
  const b64 = KD.hgt.b64;
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a;
})();
const GRD = KD.ground.dm.map(v => v / 10);
function solidCell(ix, iz) { const o = KD.occ; return ix < 0 || iz < 0 || ix >= o.nx || iz >= o.nz ? 1 : OCC[iz * o.nx + ix]; }
function solid(x, z) { return solidCell(Math.floor(x - KD.occ.x0), Math.floor(z - KD.occ.z0)); }
// rakennuksen katon korkeus (absoluuttinen y) pisteessä, 0 = katua
function bldH(x, z) {
  const h = KD.hgt, ix = Math.floor((x - h.x0) / h.res), iz = Math.floor((z - h.z0) / h.res);
  if (ix < 0 || iz < 0 || ix >= h.nx || iz >= h.nz) return 0;
  return HGT[iz * h.nx + ix] / 3;
}
function H(x, z) {
  const g = KD.ground, fx = (x - g.x0) / g.res, fz = (z - g.z0) / g.res;
  const ix = clamp(Math.floor(fx), 0, g.nx - 2), iz = clamp(Math.floor(fz), 0, g.nz - 2);
  const tx = clamp(fx - ix, 0, 1), tz = clamp(fz - iz, 0, 1), r = iz * g.nx + ix;
  return (GRD[r] * (1 - tx) + GRD[r + 1] * tx) * (1 - tz) + (GRD[r + g.nx] * (1 - tx) + GRD[r + g.nx + 1] * tx) * tz;
}
function normalAt(x, z) {
  const e = 3, hx = H(x + e, z) - H(x - e, z), hz = H(x, z + e) - H(x, z - e);
  return norm([-hx, 2 * e, -hz]);
}
const inBounds = (x, z, m = 0) => x > BX0 + EDGE + m && x < BX1 - EDGE - m && z > BZ0 + EDGE + m && z < BZ1 - EDGE - m;
const ROADTYPES = { KATU: { w: 10, grip: 1.0, spd: 1.0, col: '#24262e', edge: '#7c8090' } };

function buildWorld() {
  // säde rakennuksia vasten korkeusruudukossa; palauttaa osumaetäisyyden tai maxT
  function rayBlock(p, d, maxT) {
    const step = 0.8;
    for (let t = step; t < maxT; t += step) {
      const x = p[0] + d[0] * t, z = p[2] + d[2] * t;
      if (!inBounds(x, z, -EDGE)) return t;
      const h = bldH(x, z);
      if (h > 0 && p[1] + d[1] * t < h) return t;
    }
    return maxT;
  }
  const roadAt = (x, z) => solid(x, z) ? null : 'KATU';
  return { rayBlock, roadAt, solid, bldH, buildings: KD.buildings, spawns: KD.spawns };
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
const SPAWNS = KD.spawns.slice(0, 3).map(s => ({ x: s[0], z: s[1], yaw: s[2] }));
const CAR_R = 2.3;

const SD = { add, sub, scl, madd, dot, cross, vlen, norm, clamp, rnd, rndi, chance, ss, mulberry32, randDir, toWorld, toLocal, angDiff,
  KD, BX0, BZ0, BX1, BZ1, EDGE, inBounds, solid, solidCell, bldH, H, normalAt, ROADTYPES, buildWorld, CARS, CAR_MODELS, GUNS, SPECIALS, PCOL, PNAME, SPAWNS, CAR_R, GUN_RELOAD, SPEC_RELOAD };
if (typeof module === 'object' && module.exports) module.exports = SD; else root.RD = SD;
})(typeof window !== 'undefined' ? window : this);
