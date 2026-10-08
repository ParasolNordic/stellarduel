// Stellar Duel Online - palvelimen ja selaimen yhteinen koodi: matematiikka, vektorimallit, aseet, maailma
(function (root) {
'use strict';
const COL = { BLACK:0, WHITE:1, RED:2, CYAN:3, PURPLE:4, GREEN:5, BLUE:6, YELLOW:7,
  ORANGE:8, BROWN:9, LRED:10, DGREY:11, GREY:12, LGREEN:13, LBLUE:14, LGREY:15 };
const { WHITE, CYAN, YELLOW, ORANGE, LRED, LGREY, LGREEN, LBLUE, GREY } = COL;

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
function randDir(R = Math.random) { for (;;) { const v = [R()*2-1, R()*2-1, R()*2-1], l = vlen(v); if (l > 0.1 && l <= 1) return scl(v, 1/l); } }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function newOri() { return { r: [1,0,0], u: [0,1,0], f: [0,0,1] }; }
function oriFromForward(f, upHint = [0,1,0]) {
  f = norm(f);
  let r = cross(upHint, f);
  if (vlen(r) < 1e-3) r = cross([1,0,0], f);
  r = norm(r);
  return { r, u: cross(f, r), f };
}
function rotPitch(o, a) { const c = Math.cos(a), s = Math.sin(a), f = o.f, u = o.u;
  o.f = [f[0]*c+u[0]*s, f[1]*c+u[1]*s, f[2]*c+u[2]*s]; o.u = [u[0]*c-f[0]*s, u[1]*c-f[1]*s, u[2]*c-f[2]*s]; }
function rotRoll(o, a) { const c = Math.cos(a), s = Math.sin(a), r = o.r, u = o.u;
  o.r = [r[0]*c-u[0]*s, r[1]*c-u[1]*s, r[2]*c-u[2]*s]; o.u = [u[0]*c+r[0]*s, u[1]*c+r[1]*s, u[2]*c+r[2]*s]; }
function rotYaw(o, a) { const c = Math.cos(a), s = Math.sin(a), f = o.f, r = o.r;
  o.f = [f[0]*c+r[0]*s, f[1]*c+r[1]*s, f[2]*c+r[2]*s]; o.r = [r[0]*c-f[0]*s, r[1]*c-f[1]*s, r[2]*c-f[2]*s]; }
function orthonorm(o) { o.f = norm(o.f); o.r = norm(cross(o.u, o.f)); o.u = cross(o.f, o.r); }
function rotAxis(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), kd = dot(k, v) * (1 - c);
  return [v[0]*c + kv[0]*s + k[0]*kd, v[1]*c + kv[1]*s + k[1]*kd, v[2]*c + kv[2]*s + k[2]*kd];
}
const toWorld = (o, v) => [
  o.r[0]*v[0] + o.u[0]*v[1] + o.f[0]*v[2],
  o.r[1]*v[0] + o.u[1]*v[1] + o.f[1]*v[2],
  o.r[2]*v[0] + o.u[2]*v[1] + o.f[2]*v[2]];
const toLocal = (o, v) => [dot(v, o.r), dot(v, o.u), dot(v, o.f)];

// ---------------- vektorimallit: koostetut konveksit osat ----------------
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
    return { n: p.n, d: p.d, p: verts[idx[0]], idx };
  });
  const edges = [];
  for (let i = 0; i < n; i++) for (let j = i+1; j < n; j++) {
    const fs = [];
    planes.forEach((p, idx) => { if (onPlane(p, verts[i]) && onPlane(p, verts[j])) fs.push(idx); });
    if (fs.length >= 2) edges.push({ a: i, b: j, f1: fs[0], f2: fs[1] });
  }
  const decals = [];
  for (const d of (opts.decals || [])) {
    let best = 0, bd = -2;
    faces.forEach((f, idx) => { const q = dot(f.n, norm(d.dir)); if (q > bd) { bd = q; best = idx; } });
    for (let i = 0; i < d.pts.length - (d.open ? 1 : 0); i++)
      decals.push({ a: d.pts[i], b: d.pts[(i+1) % d.pts.length], f: best });
  }
  let cen = [0,0,0]; for (const v of verts) cen = add(cen, v); cen = scl(cen, 1/n);
  return { v: verts, faces, edges, decals, r: scale, cen, col: opts.col, dcol: opts.dcol };
}
const compound = parts => ({ parts, r: Math.max(...parts.map(p => p.r)) });
const mx = v => [-v[0], v[1], v[2]];
function sym(verts, opts = {}) {
  const o2 = Object.assign({}, opts, { decals: (opts.decals || []).map(d => ({ dir: mx(d.dir), pts: d.pts.map(mx), open: d.open })) });
  return [buildPart(verts, opts), buildPart(verts.map(mx), o2)];
}
const rectPts = (x0, y0, x1, y1, z) => [[x0,y0,z],[x1,y0,z],[x1,y1,z],[x0,y1,z]];
const box = (x0, x1, y0, y1, z0, z1) => [[x0,y0,z0],[x1,y0,z0],[x0,y1,z0],[x1,y1,z0],[x0,y0,z1],[x1,y0,z1],[x0,y1,z1],[x1,y1,z1]];
const ngon = (k, r, y, a0 = 0) => { const o = []; for (let i = 0; i < k; i++) { const a = a0 + i/k*Math.PI*2; o.push([Math.cos(a)*r, y, Math.sin(a)*r]); } return o; };

const MODELS = {};
MODELS.salama = compound([
  buildPart([[0,0,64],[-10,7,20],[10,7,20],[-10,-5,20],[10,-5,20],[-12,8,-38],[12,8,-38],[-12,-7,-38],[12,-7,-38]],
    { decals: [{ dir:[0,0,-1], pts: rectPts(-8,-4,8,5,-38) }, { dir:[0,1,0.1], pts: [[0,7.4,18],[0,8,-30]], open: true }], dcol: ORANGE }),
  buildPart([[0,14,12],[-5,7,30],[5,7,30],[-6,7,2],[6,7,2],[0,11,-6]], { col: LBLUE }),
  ...sym([[-10,1.5,14],[-10,-1.5,14],[-10,1.5,-34],[-10,-1.5,-34],[-58,1.5,-40],[-58,-1.5,-40],[-51,1.5,-28],[-51,-1.5,-28]],
    { decals: [{ dir:[0,1,0], pts: [[-22,1.5,-2],[-48,1.5,-28]], open: true }] }),
  ...sym([[-60,3,14],[-55,3,14],[-60,-3,14],[-55,-3,14],[-61,3,-42],[-54,3,-42],[-61,-3,-42],[-54,-3,-42]], { col: LGREY }),
  buildPart([[-1.2,8,-12],[1.2,8,-12],[-1.2,8,-38],[1.2,8,-38],[-1.2,26,-42],[1.2,26,-42],[-1.2,26,-33],[1.2,26,-33]]),
  ...sym([[-15,-5,-4],[-9,-5,-4],[-15,-9,-4],[-9,-9,-4],[-18,-3,-46],[-6,-3,-46],[-18,-12,-46],[-6,-12,-46]],
    { decals: [{ dir:[0,0,-1], pts: rectPts(-16,-10,-8,-5,-46) }], dcol: ORANGE }),
]);
MODELS.korppi = compound([
  buildPart([[0,-2,50],[-10,6,26],[10,6,26],[-10,-8,26],[10,-8,26],[-9,5,-22],[9,5,-22],[-9,-7,-22],[9,-7,-22]],
    { decals: [{ dir:[0,0,-1], pts: rectPts(-6,-5,6,3,-22) }], dcol: ORANGE }),
  buildPart([[0,12,20],[-5,6,38],[5,6,38],[-6,6,10],[6,6,10],[0,9,4]], { col: LGREEN }),
  ...sym([[-30,0,42],[-33,3,30],[-27,3,30],[-33,-3,30],[-27,-3,30],[-35,5,-52],[-25,5,-52],[-35,-6,-52],[-25,-6,-52]],
    { decals: [{ dir:[0,0,-1], pts: rectPts(-33,-4,-27,3,-52) }], dcol: ORANGE }),
  buildPart([[-56,1.5,8],[56,1.5,8],[-56,-1.5,8],[56,-1.5,8],[-56,1.5,-6],[56,1.5,-6],[-56,-1.5,-6],[56,-1.5,-6],
             [-10,1.5,-26],[10,1.5,-26],[-10,-1.5,-26],[10,-1.5,-26]],
    { decals: [{ dir:[0,1,0], pts: [[-50,1.5,4],[-38,1.5,4],[-38,1.5,-2],[-50,1.5,-2]] }, { dir:[0,1,0], pts: [[50,1.5,4],[38,1.5,4],[38,1.5,-2],[50,1.5,-2]] }], dcol: LRED }),
  buildPart(box(-30, 30, 4, 6, -54, -42)),
  ...sym([[-31,5,-36],[-29,5,-36],[-31,5,-52],[-29,5,-52],[-31,22,-56],[-29,22,-56],[-31,22,-47],[-29,22,-47]]),
  buildPart(box(-2, 2, -12, -8, 14, 56), { col: LGREY }),
]);
const STS = 300;
(() => {
  const v = [];
  for (const a of [-1,1]) for (const b of [-1,1]) v.push([a*STS,b*STS,0], [a*STS,0,b*STS], [0,a*STS,b*STS]);
  MODELS.station = compound([buildPart(v, { decals: [
    { dir:[0,0,1], pts: rectPts(-0.36*STS, -0.14*STS, 0.36*STS, 0.14*STS, STS) },
    { dir:[0,0,1], pts: rectPts(-0.5*STS, -0.25*STS, 0.5*STS, 0.25*STS, STS) },
    { dir:[0,0,-1], pts: rectPts(-0.2*STS, -0.2*STS, 0.2*STS, 0.2*STS, -STS) }] })]);
})();
const ROCK_R = [210, 115, 58], ROCK_HP = [140, 60, 22];
MODELS.rocks = ROCK_R.map((rad, sz) => [0,1,2,3].map(k => {
  const t = (1 + Math.sqrt(5)) / 2, R = mulberry32(77 + k*13 + sz*101), base = [];
  for (const a of [-1,1]) for (const b of [-1,1]) base.push([0,a,b*t],[a,b*t,0],[b*t,0,a]);
  return compound([buildPart(base.map(p => scl(norm(p), rad * (0.72 + R()*0.5))))]);
}));
MODELS.missile = compound([buildPart([[0,0,24],[-3.6,3.6,-15],[3.6,3.6,-15],[-3.6,-3.6,-15],[3.6,-3.6,-15],[-10,0,-18],[10,0,-18],[0,10,-18],[0,-10,-18]])]);
MODELS.mini = compound([buildPart([[0,0,14],[-2,2,-9],[2,2,-9],[-2,-2,-9],[2,-2,-9],[-6,0,-11],[6,0,-11],[0,6,-11],[0,-6,-11]])]);
MODELS.trophy = compound([
  buildPart([...ngon(10, 34, 52), ...ngon(10, 11, 12)]),
  buildPart([...ngon(6, 4, 12), ...ngon(6, 4, -2)], { col: LGREY }),
  buildPart([...ngon(8, 16, -2), ...ngon(8, 24, -16)], { col: LGREY }),
  ...sym(box(-44, -32, 24, 44, -3, 3)),
]);
function modelByKey(k) {
  if (k[0] === 'r') { const m = k.match(/^r(\d)_(\d)$/); if (m) return MODELS.rocks[+m[1]][+m[2]]; }
  return MODELS[k] || MODELS.missile;
}

const SHIPDEF = [
  { name:'SALAMA', mk:'salama', col: CYAN, frame: CYAN, exh: [[0,0,-40],[-12,-7,-48],[12,-7,-48]], guns: [[-57,0,15],[57,0,15]], hitR: 46 },
  { name:'KORPPI', mk:'korppi', col: YELLOW, frame: YELLOW, exh: [[0,-1,-24],[-30,0,-54],[30,0,-54]], guns: [[0,-10,57],[-30,0,43],[30,0,43]], hitR: 48 },
];
const LASERS = [
  { nm:'PULSSI',  tier:1, dmg:5,   cd:0.22, heat:4,   range:4000, col:LRED,   desc:'TASAINEN, KESTÄÄ TULTA', snd:['square',1400,180,0.12,0.08] },
  { nm:'NEULA',   tier:1, dmg:2.2, cd:0.06, heat:1.4, range:3500, col:LBLUE,  desc:'NOPEA, HEIKKO OSUMA',    snd:['square',2400,900,0.05,0.05] },
  { nm:'SÄDE',    tier:2, dmg:3.5, cd:0.08, heat:2,   range:4500, col:YELLOW, desc:'TASAINEN SÄDE',          snd:['sawtooth',900,500,0.09,0.05] },
  { nm:'PLASMA',  tier:3, dmg:16,  cd:0.4,  heat:9,   range:4500, col:LGREEN, wide:1.7, desc:'RASKAS JA LEVEÄ OSUMA', snd:['sawtooth',300,60,0.3,0.12] },
  { nm:'SOTILAS', tier:4, dmg:5,   cd:0.07, heat:2.2, range:5500, col:CYAN,   desc:'TUHOISA, KUUMENEE',      snd:['square',1800,300,0.08,0.07] },
  { nm:'TUHOAJA', tier:4, dmg:34,  cd:0.65, heat:14,  range:7000, col:WHITE,  desc:'PITKÄ KANTAMA, HIDAS',   snd:['sawtooth',2200,80,0.45,0.12] },
];
const MISSILES = [
  { nm:'TIKKA',   tier:1, dmg:25,  spd:480, turn:1.6, cnt:6,  resist:0.1,  lockT:1.2, guided:true,  desc:'KEVYT HAKEUTUVA' },
  { nm:'RAKETTI', tier:1, dmg:30,  spd:950, turn:0,   cnt:10, resist:1,    lockT:0,   guided:false, desc:'OHJAAMATON, PALJON' },
  { nm:'HAUKKA',  tier:2, dmg:40,  spd:560, turn:2.0, cnt:5,  resist:0.3,  lockT:1.0, guided:true,  desc:'KETTERÄ HAKEUTUVA' },
  { nm:'PARVI',   tier:3, dmg:22,  spd:540, turn:2.3, cnt:4,  resist:0.35, lockT:1.0, guided:true, swarm:3, desc:'3 PIENOHJUSTA' },
  { nm:'KOBRA',   tier:3, dmg:62,  spd:620, turn:2.5, cnt:4,  resist:0.55, lockT:0.8, guided:true,  desc:'RASKAS, SIETÄÄ SOIHTUJA' },
  { nm:'NEMESIS', tier:4, dmg:100, spd:680, turn:3.0, cnt:3,  resist:0.75, lockT:0.7, guided:true,  desc:'TUHOAVA, HÄIRIÖTÖN' },
];
const BUDGET = 5, MAXSPD = 320, ARENA_R = 30000;

// ---------------- maailma (sama siemen -> sama maailma palvelimella ja selaimessa) ----------------
function tiltOri(u) { u = norm(u); const r = norm(cross(u, [0,0,1])); return { r, u, f: cross(r, u) }; }
function makeWorldData(seed) {
  const R = mulberry32(seed);
  const planets = [
    { pos: [0, -4000, 32000], R: 9000, col: LRED, col2: ORANGE, style: 'giant', ori: tiltOri([0.25, 1, -0.5]), rings: true, ringCol: LGREY },
    { pos: [-28000, 7000, -14000], R: 4200, col: CYAN, style: 'globe', ori: tiltOri([0.3, 1, 0.2]) },
    { pos: [13000, 4000, 22000], R: 1600, col: GREY, style: 'moon', ori: tiltOri([0, 1, 0]),
      craters: [[0.3, 0.5, -0.8, 0.22], [-0.6, 0.1, -0.75, 0.15], [0.1, -0.5, -0.85, 0.18], [0.7, -0.2, -0.6, 0.12]] },
  ];
  const sunPos = scl(norm([0.6, 0.35, -0.7]), 300000);
  const stPos = [3000, 2500, 17500];
  const station = { pos: stPos, o: oriFromForward(sub(stPos, planets[0].pos)) };
  const comet = { pos: [-50000, 25000, 40000] }; comet.tail = norm(sub(comet.pos, sunPos));
  const spawns = [[-5500, 0, -1200], [5500, 0, 1200]];
  const rocks = []; let tries = 0;
  while (rocks.length < 34 && tries++ < 2000) {
    const p = [(R()*2-1)*9500, (R()*2-1)*4500, (R()*2-1)*9500];
    const sz = rocks.length < 10 ? 0 : (rocks.length < 24 ? 1 : 2);
    if (spawns.some(s => vlen(sub(s, p)) < 2000) || vlen(sub(p, stPos)) < 2500) continue;
    if (rocks.some(r => vlen(sub(r.p0, p)) < ROCK_R[r.size] + ROCK_R[sz] + 150)) continue;
    rocks.push({ size: sz, shape: Math.floor(R()*4), p0: p, v: scl(randDir(R), R()*30), t0: 0,
      ax: randDir(R), w: (R()-0.5)*0.8, o: oriFromForward(randDir(R)) });
  }
  return { planets, sun: { pos: sunPos, R: 24000 }, station, comet, spawns, rocks };
}
function rockPose(rk, t) {
  const dt = t - rk.t0, a = rk.w * dt;
  return { pos: madd(rk.p0, rk.v, dt), r: rotAxis(rk.o.r, rk.ax, a), u: rotAxis(rk.o.u, rk.ax, a), f: rotAxis(rk.o.f, rk.ax, a) };
}
function stationPose(st, t) {
  const a = 0.18 * t;
  return { pos: st.pos, r: rotAxis(st.o.r, st.o.f, a), u: rotAxis(st.o.u, st.o.f, a), f: st.o.f };
}
// onko piste kuperan osan sisällä (marginaalilla); palauttaa paikallisen sijainnin ja lähimmän tahkon
function insideHull(pose, part, pos, margin) {
  const d = sub(pos, pose.pos);
  if (vlen(d) > part.r + margin) return null;
  const l = toLocal(pose, d); let worst = null, wd = -Infinity;
  for (const f of part.faces) { const s = dot(f.n, l) - f.d; if (s > margin) return null; if (s > wd) { wd = s; worst = f; } }
  return { l, face: worst, depth: wd };
}

const SD = { COL, add, sub, scl, madd, dot, cross, vlen, norm, clamp, rnd, rndi, chance, randDir, mulberry32,
  newOri, oriFromForward, rotPitch, rotRoll, rotYaw, orthonorm, rotAxis, toWorld, toLocal,
  MODELS, modelByKey, SHIPDEF, LASERS, MISSILES, BUDGET, MAXSPD, ARENA_R, STS, ROCK_R, ROCK_HP,
  makeWorldData, rockPose, stationPose, insideHull };
if (typeof module === 'object' && module.exports) module.exports = SD; else root.SD = SD;
})(typeof window !== 'undefined' ? window : this);
