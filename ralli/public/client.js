// Vektoriralli - selainasiakas: 3D-vektoripiirto, oma auto, minikartta, ohjaimet ja verkko
(function () {
'use strict';
const RD = window.RD;
const { add, sub, scl, madd, dot, cross, vlen, norm, clamp, rnd, chance, ss, H, normalAt, angDiff, CARS, CAR_MODELS, GUNS, SPECIALS, PCOL, PNAME, ROADTYPES, CITY, BLOCK, WORLD, CELL } = RD;
const $ = id => document.getElementById(id);
const hex = h => [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
const W0 = RD.buildWorld();

// ===================== PIIRTOMOOTTORI =====================
const cv = $('c'), mainCtx = cv.getContext('2d');
let DPR = 1, SW = 0, SH = 0;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, isTouch ? 2 : 2);
  const maxW = isTouch ? 1500 : 2200;
  if (window.innerWidth * DPR > maxW) DPR = maxW / window.innerWidth;
  SW = Math.round(window.innerWidth * DPR); SH = Math.round(window.innerHeight * DPR);
  cv.width = SW; cv.height = SH;
  layoutTouch(); minimapDirty = true;
}
const V = { ctx: mainCtx, w: 1, h: 1, cx: 0, cy: 0, F: 1, C: [0,0,0], r: [1,0,0], u: [0,1,0], f: [0,0,1], fogNear: 300, fogFar: 1800, lwk: 1 };
const FOG = [10, 9, 24], NEAR = 0.6;
function setView(ctx, w, h, camPos, look, fog = [300, 1800]) {
  V.ctx = ctx; V.w = w; V.h = h; V.cx = w / 2; V.cy = h * 0.44; V.F = Math.max(w * 0.62, h * 0.95);
  V.C = camPos; V.f = norm(look);
  let r = cross([0, 1, 0], V.f); if (vlen(r) < 1e-4) r = [1, 0, 0]; V.r = norm(r); V.u = cross(V.f, V.r);
  V.fogNear = fog[0]; V.fogFar = fog[1]; V.lwk = Math.max(1, Math.min(w, h) / 600);
}
function fogStr(c, z, k = 1) {
  const t = ss(V.fogNear, V.fogFar, z);
  return 'rgb(' + ((c[0] * k + (FOG[0] - c[0] * k) * t) | 0) + ',' + ((c[1] * k + (FOG[1] - c[1] * k) * t) | 0) + ',' + ((c[2] * k + (FOG[2] - c[2] * k) * t) | 0) + ')';
}
function camP(p) { const x = p[0] - V.C[0], y = p[1] - V.C[1], z = p[2] - V.C[2]; return [x * V.r[0] + y * V.r[1] + z * V.r[2], x * V.u[0] + y * V.u[1] + z * V.u[2], x * V.f[0] + y * V.f[1] + z * V.f[2]]; }
function clipNear(cs) {
  const out = [];
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i], b = cs[(i + 1) % cs.length], ain = a[2] >= NEAR, bin = b[2] >= NEAR;
    if (ain) out.push(a);
    if (ain !== bin) { const t = (NEAR - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]); }
  }
  return out;
}
let itemsA = [], itemsB = [];
function projLines(lines, z) {
  const out = [];
  for (const [a, b, col, w] of lines) {
    let ca = camP(a), cb = camP(b);
    if (ca[2] < NEAR && cb[2] < NEAR) continue;
    if (ca[2] < NEAR) { const t = (NEAR - ca[2]) / (cb[2] - ca[2]); ca = [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, NEAR]; }
    else if (cb[2] < NEAR) { const t = (NEAR - cb[2]) / (ca[2] - cb[2]); cb = [cb[0] + (ca[0] - cb[0]) * t, cb[1] + (ca[1] - cb[1]) * t, NEAR]; }
    out.push(V.cx + ca[0] * V.F / ca[2], V.cy - ca[1] * V.F / ca[2], V.cx + cb[0] * V.F / cb[2], V.cy - cb[1] * V.F / cb[2], fogStr(col, z), w || 1);
  }
  return out;
}
// lisää monikulmio piirtolistaan: sumu, takapintojen poisto, lähitason leikkaus
function poly(wp, fill, stroke, o) {
  o = o || {};
  const n = wp.length, cs = new Array(n);
  let zs = 0, minz = Infinity, maxz = -Infinity;
  for (let i = 0; i < n; i++) { const c = camP(wp[i]); cs[i] = c; zs += c[2]; if (c[2] < minz) minz = c[2]; if (c[2] > maxz) maxz = c[2]; }
  if (maxz < NEAR) return null;
  if (o.cull !== false) {
    const a = cs[0], b = cs[1], c = cs[n - 1];
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (nx * a[0] + ny * a[1] + nz * a[2] >= 0) return null;
  }
  const cl = minz < NEAR ? clipNear(cs) : cs;
  if (cl.length < 3) return null;
  const pts = new Array(cl.length * 2);
  let l = true, r = true, t = true, bt = true;
  for (let i = 0; i < cl.length; i++) {
    const x = V.cx + cl[i][0] * V.F / cl[i][2], y = V.cy - cl[i][1] * V.F / cl[i][2];
    pts[i * 2] = x; pts[i * 2 + 1] = y;
    if (x > 0) l = false; if (x < V.w) r = false; if (y > 0) t = false; if (y < V.h) bt = false;
  }
  if (l || r || t || bt) return null;
  const z = zs / n + (o.bias || 0);
  const it = { z, pts, fill: fill ? fogStr(fill, zs / n, o.shade || 1) : null, stroke: stroke ? fogStr(stroke, zs / n) : null, lw: o.lw || 1,
    lines: o.lines ? projLines(o.lines, zs / n) : null, sub: null };
  (o.list || itemsB).push(it);
  return it;
}
function addLine(a, b, col, lw, list) {
  const L = projLines([[a, b, col, lw]], (camP(a)[2] + camP(b)[2]) / 2);
  if (!L.length) return;
  const z = (camP(a)[2] + camP(b)[2]) / 2;
  (list || itemsB).push({ z, kind: 'ln', l: L });
}
function addDot(p, col, size) {
  const c = camP(p); if (c[2] < NEAR) return;
  const soft = size >= 0.8, s = Math.min(soft ? 70 * V.lwk : 14 * V.lwk, Math.max(1, size * V.F / c[2]));
  itemsB.push({ z: c[2], kind: 'pt', soft, x: V.cx + c[0] * V.F / c[2], y: V.cy - c[1] * V.F / c[2], s, col: fogStr(col, c[2]) });
}
function drawLines(ctx, L) {
  for (let i = 0; i < L.length; i += 6) {
    ctx.strokeStyle = L[i + 4]; ctx.lineWidth = L[i + 5] * V.lwk;
    ctx.beginPath(); ctx.moveTo(L[i], L[i + 1]); ctx.lineTo(L[i + 2], L[i + 3]); ctx.stroke();
  }
}
function drawItem(ctx, it) {
  if (it.kind === 'ln') { drawLines(ctx, it.l); return; }
  if (it.kind === 'pt') {
    ctx.fillStyle = it.col;
    if (it.soft) { ctx.globalAlpha = 0.28; ctx.beginPath(); ctx.arc(it.x, it.y, it.s / 2, 0, 6.3); ctx.fill(); ctx.globalAlpha = 1; }
    else ctx.fillRect(it.x - it.s / 2, it.y - it.s / 2, it.s, it.s);
    return;
  }
  const p = it.pts;
  ctx.beginPath(); ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.closePath();
  if (it.fill) { ctx.fillStyle = it.fill; ctx.fill(); }
  if (it.stroke) { ctx.strokeStyle = it.stroke; ctx.lineWidth = it.lw * V.lwk; ctx.stroke(); }
  if (it.lines) drawLines(ctx, it.lines);
  if (it.sub) for (const s of it.sub) drawItem(ctx, s);
}
function flush(list) {
  list.sort((a, b) => b.z - a.z);
  const ctx = V.ctx; ctx.lineJoin = 'round';
  for (const it of list) drawItem(ctx, it);
}

// ===================== STAATTINEN GEOMETRIA =====================
const COLS = {
  ground: hex('#14161e'), park: hex('#0f2a18'), parkE: hex('#2f8f4f'),
  tower: hex('#0e1522'), towerE: hex('#57b6ff'), mid: hex('#15151d'), midE: hex('#a2abc8'), house: hex('#1d1712'), houseE: hex('#d6a273'),
  roof: hex('#2a1212'), roofE: hex('#ff7f5f'), win: hex('#ffd36b'), winC: hex('#7fd8ff'),
  tree: hex('#0d2414'), treeE: hex('#3fbf6a'), trunk: hex('#6b4a2a'),
  grass: hex('#132a1a'), grassE: hex('#2a6b3f'), rock: hex('#2a2520'), rockE: hex('#7a6650'), snow: hex('#c8d2e4'), snowE: hex('#ffffff'),
  white: hex('#e8ecf5'), yellow: hex('#ffd34d'), median: hex('#1d3a24'),
};
function upward(pts) { // varmista että monikulmio osoittaa ylöspäin
  const a = pts[0], b = pts[1], c = pts[pts.length - 1];
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  return ny >= 0 ? pts : pts.slice().reverse();
}
function outward(pts, center) {
  const a = pts[0], b = pts[1], c = pts[pts.length - 1];
  const n = cross(sub(b, a), sub(c, a));
  let m = [0, 0, 0]; for (const p of pts) m = add(m, p); m = scl(m, 1 / pts.length);
  return dot(n, sub(m, center)) >= 0 ? pts : pts.slice().reverse();
}
// kaupungin pohja ja kadut
const cityTiles = [];
{ const T = 210, E = CITY + 40; for (let x = -E; x < E; x += T) for (let z = -E; z < E; z += T) cityTiles.push(upward([[x, 0, z], [x, 0, Math.min(E, z + T)], [Math.min(E, x + T), 0, Math.min(E, z + T)], [Math.min(E, x + T), 0, z]])); }
const cityRoads = [];
for (const L of W0.lines) {
  const T = ROADTYPES[L.type], w = T.w / 2, col = hex(T.col), edge = hex(T.edge), E = CITY + w;
  for (const axis of [0, 1]) {
    for (let s = -E; s < E; s += BLOCK) {
      const s1 = Math.min(E, s + BLOCK);
      const P = (a, b, y = 0.04) => axis === 0 ? [L.c + a, y, b] : [b, y, L.c + a];
      const lines = [[P(-w + 0.4, s), P(-w + 0.4, s1), edge, 1], [P(w - 0.4, s), P(w - 0.4, s1), edge, 1]];
      if (T.mid === 'median') { lines.push([P(-1.6, s), P(-1.6, s1), COLS.parkE, 1], [P(1.6, s), P(1.6, s1), COLS.parkE, 1]); }
      else for (let d = s + 4; d < s1 - 4; d += 12) lines.push([P(0, d), P(0, Math.min(s1, d + 5)), edge, 1]);
      cityRoads.push({ c: axis === 0 ? [L.c, s + BLOCK / 2] : [s + BLOCK / 2, L.c], pts: upward([P(-w, s), P(-w, s1), P(w, s1), P(w, s)]), col, lines,
        med: T.mid === 'median' ? upward([P(-1.6, s, 0.08), P(-1.6, s1, 0.08), P(1.6, s1, 0.08), P(1.6, s, 0.08)]) : null });
    }
  }
}
// jalkakäytävien reunat korttelien ympärillä
const curbs = [];
{ const st = W0.lines.map(l => l.c + ROADTYPES[l.type].w / 2), en = W0.lines.map(l => l.c - ROADTYPES[l.type].w / 2), cc = hex('#3c4258');
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
    const x0 = st[i], x1 = en[i + 1], z0 = st[j], z1 = en[j + 1], y = 0.12;
    curbs.push({ c: [(x0 + x1) / 2, 0, (z0 + z1) / 2], l: [[[x0, y, z0], [x1, y, z0], cc, 1], [[x1, y, z0], [x1, y, z1], cc, 1], [[x1, y, z1], [x0, y, z1], cc, 1], [[x0, y, z1], [x0, y, z0], cc, 1],
      [[x0 + 3, y, z0 + 3], [x1 - 3, y, z0 + 3], cc, 0.6], [[x1 - 3, y, z0 + 3], [x1 - 3, y, z1 - 3], cc, 0.6], [[x1 - 3, y, z1 - 3], [x0 + 3, y, z1 - 3], cc, 0.6], [[x0 + 3, y, z1 - 3], [x0 + 3, y, z0 + 3], cc, 0.6]] });
  } }
const parks = W0.buildings.filter(b => b.kind === 'park').map(b => upward([[b.x0, 0.06, b.z0], [b.x0, 0.06, b.z1], [b.x1, 0.06, b.z1], [b.x1, 0.06, b.z0]]));
// maastoruudukko
const NG = Math.round(WORLD * 2 / CELL), HG = [];
for (let i = 0; i <= NG; i++) { HG.push([]); for (let j = 0; j <= NG; j++) HG[i].push(H(-WORLD + i * CELL, -WORLD + j * CELL)); }
const cells = [];
const L_SUN = norm([0.5, 0.8, 0.3]);
for (let i = 0; i < NG; i++) for (let j = 0; j < NG; j++) {
  const x0 = -WORLD + i * CELL, z0 = -WORLD + j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
  const hs = [HG[i][j], HG[i][j + 1], HG[i + 1][j + 1], HG[i + 1][j]];
  if (Math.max(...hs) < 0.01 && Math.max(Math.abs(x0 + CELL / 2), Math.abs(z0 + CELL / 2)) < CITY + 40) continue;
  const pts = [[x0, hs[0], z0], [x0, hs[1], z1], [x1, hs[2], z1], [x1, hs[3], z0]];
  const hav = (hs[0] + hs[1] + hs[2] + hs[3]) / 4;
  const n = norm(cross(sub(pts[1], pts[0]), sub(pts[3], pts[0])));
  const slope = 1 - Math.abs(n[1]);
  let fill = COLS.grass, edge = COLS.grassE;
  if (hav > 320 || (hav > 250 && slope < 0.25)) { fill = COLS.snow; edge = COLS.snowE; }
  else if (slope > 0.22 || hav > 160) { fill = COLS.rock; edge = COLS.rockE; }
  const shade = 0.55 + 0.6 * Math.max(0, dot(n, L_SUN));
  cells.push({ c: [x0 + CELL / 2, hav, z0 + CELL / 2], pts, fill, edge, shade, roads: [] });
}
const cellIndex = new Map(); cells.forEach(c => cellIndex.set(Math.floor((c.c[0] + WORLD) / CELL) * 1000 + Math.floor((c.c[2] + WORLD) / CELL), c));
// maaseudun tiet paloina maastoruutujen sisään
const looseRoads = [];
for (const s of W0.roads) {
  const T = ROADTYPES[s.type], w = T.w / 2, col = hex(T.col), edge = hex(T.edge);
  const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(L / 25));
  const px = -dz / L * w, pz = dx / L * w;
  for (let k = 0; k < n; k++) {
    const ax = s.a[0] + dx * k / n, az = s.a[1] + dz * k / n, bx = s.a[0] + dx * (k + 1) / n, bz = s.a[1] + dz * (k + 1) / n;
    const y = (x, z) => H(x, z) + 0.35;
    const pts = upward([[ax - px, y(ax - px, az - pz), az - pz], [bx - px, y(bx - px, bz - pz), bz - pz], [bx + px, y(bx + px, bz + pz), bz + pz], [ax + px, y(ax + px, az + pz), az + pz]]);
    const lines = [[[ax - px * 0.9, y(ax - px, az - pz) + 0.05, az - pz * 0.9], [bx - px * 0.9, y(bx - px, bz - pz) + 0.05, bz - pz * 0.9], edge, 1],
                   [[ax + px * 0.9, y(ax + px, az + pz) + 0.05, az + pz * 0.9], [bx + px * 0.9, y(bx + px, bz + pz) + 0.05, bz + pz * 0.9], edge, 1]];
    if (T.mid === 'yellow' || (T.mid === 'lanes' && k % 2 === 0)) lines.push([[ax, y(ax, az) + 0.05, az], [(ax + bx) / 2, y((ax + bx) / 2, (az + bz) / 2) + 0.05, (az + bz) / 2], T.mid === 'yellow' ? COLS.yellow : COLS.white, 1]);
    const piece = { c: [(ax + bx) / 2, 0, (az + bz) / 2], pts, col, lines };
    const ci = Math.floor((piece.c[0] + WORLD) / CELL) * 1000 + Math.floor((piece.c[2] + WORLD) / CELL);
    const cell = cellIndex.get(ci);
    if (cell) cell.roads.push(piece); else looseRoads.push(piece);
  }
}
// rakennukset
const blds = W0.buildings.filter(b => b.kind !== 'park').map((b, i) => {
  const c = [(b.x0 + b.x1) / 2, b.h / 2, (b.z0 + b.z1) / 2];
  const cols = b.kind === 'tower' ? [COLS.tower, COLS.towerE] : b.kind === 'mid' ? [COLS.mid, COLS.midE] : [COLS.house, COLS.houseE];
  const wall = (ax, az, bx, bz) => ({ pts: outward([[ax, 0, az], [bx, 0, bz], [bx, b.h, bz], [ax, b.h, az]], c), a: [ax, az], b: [bx, bz] });
  const walls = [wall(b.x0, b.z0, b.x1, b.z0), wall(b.x1, b.z0, b.x1, b.z1), wall(b.x1, b.z1, b.x0, b.z1), wall(b.x0, b.z1, b.x0, b.z0)];
  let roof;
  if (b.kind === 'house') {
    const rh = b.h + 3.5;
    if (b.ridgeX) { const mz = (b.z0 + b.z1) / 2;
      roof = [outward([[b.x0, b.h, b.z0], [b.x1, b.h, b.z0], [b.x1, rh, mz], [b.x0, rh, mz]], c), outward([[b.x0, b.h, b.z1], [b.x1, b.h, b.z1], [b.x1, rh, mz], [b.x0, rh, mz]], c),
        outward([[b.x0, b.h, b.z0], [b.x0, b.h, b.z1], [b.x0, rh, mz]], c), outward([[b.x1, b.h, b.z0], [b.x1, b.h, b.z1], [b.x1, rh, mz]], c)];
    } else { const mx = (b.x0 + b.x1) / 2;
      roof = [outward([[b.x0, b.h, b.z0], [b.x0, b.h, b.z1], [mx, rh, b.z1], [mx, rh, b.z0]], c), outward([[b.x1, b.h, b.z0], [b.x1, b.h, b.z1], [mx, rh, b.z1], [mx, rh, b.z0]], c),
        outward([[b.x0, b.h, b.z0], [b.x1, b.h, b.z0], [mx, rh, b.z0]], c), outward([[b.x0, b.h, b.z1], [b.x1, b.h, b.z1], [mx, rh, b.z1]], c)];
    }
  } else roof = [upward([[b.x0, b.h, b.z0], [b.x0, b.h, b.z1], [b.x1, b.h, b.z1], [b.x1, b.h, b.z0]])];
  return { b, c, walls, roof, fill: cols[0], edge: cols[1], warm: (i * 7919) % 3 !== 0 };
});
const treeG = W0.trees.map(t => {
  const y = t.y, top = [t.x, y + t.h, t.z], r = t.r, c = [t.x, y + t.h * 0.5, t.z];
  const b = [[t.x - r, y + t.h * 0.3, t.z - r], [t.x + r, y + t.h * 0.3, t.z - r], [t.x + r, y + t.h * 0.3, t.z + r], [t.x - r, y + t.h * 0.3, t.z + r]];
  return { c, faces: [0, 1, 2, 3].map(k => outward([b[k], b[(k + 1) % 4], top], c)), trunk: [[t.x, y, t.z], [t.x, y + t.h * 0.3, t.z]] };
});
// automallien tahkoille kuuluvat koristeviivat
const CARGEO = CAR_MODELS.map(m => ({ r: m.r, parts: m.parts.map(pt => {
  const fd = pt.faces.map(f => dot(f.n, pt.v[f.idx[0]]));
  const decByFace = pt.faces.map(() => []);
  for (const d of pt.dec) {
    const mid = scl(add(d[0], d[1]), 0.5); let best = 0, bd = Infinity;
    pt.faces.forEach((f, k) => { const q = Math.abs(dot(f.n, mid) - fd[k]); if (q < bd) { bd = q; best = k; } });
    decByFace[best].push(d);
  }
  return Object.assign({}, pt, { decByFace });
}) }));
const TONES = { body: null, cabin: null, trim: [hex('#2a2c34'), hex('#9aa0b4')], tire: [hex('#0b0b0f'), hex('#6a6f80')], brass: [hex('#3a2c10'), hex('#e0b850')], glass: [null, hex('#9fdcff')] };

// ===================== AUTON PIIRTO =====================
function carOri(pos, yaw) {
  if (carOriOverride) return carOriOverride;
  const n = normalAt(pos[0], pos[2]), fh = [Math.sin(yaw), 0, Math.cos(yaw)];
  const f = norm(madd(fh, n, -dot(fh, n))), r = norm(cross(n, f));
  return { r, u: n, f: cross(r, n) };
}
function newDents(ci) { return CARGEO[ci].parts.map(pt => pt.wheel ? null : pt.v.map(() => [0, 0, 0])); }
function applyDent(car, lp, s) {
  if (!lp) return;
  const geo = CARGEO[car.ci], R = 0.9 + s * 0.6;
  geo.parts.forEach((pt, k) => {
    const D = car.dents[k]; if (!D) return;
    pt.v.forEach((v, i) => {
      const o = D[i], cur = add(v, o), d = vlen(sub(cur, lp));
      if (d >= R) return;
      const dir = norm(sub([0, 0.9, 0], lp)), a = s * 0.32 * (1 - d / R);
      const nv = madd(o, dir, a), m = vlen(nv), lim = 0.5;
      D[i] = m > lim ? scl(nv, lim / m) : nv;
    });
  });
  car.scars = (car.scars || 0) + 1;
}
function drawCar(car, list) {
  const geo = CARGEO[car.ci], o = carOri(car.pos, car.yaw);
  const pc = hex(PCOL[car.id]);
  const dmg = car.dead ? 1 : 1 - clamp(car.hp / car.maxHp, 0, 1);
  const bodyF = car.dead ? [20, 16, 14] : [pc[0] * 0.18, pc[1] * 0.18, pc[2] * 0.2];
  const bodyE = car.dead ? [90, 70, 60] : [pc[0] * (1 - dmg * 0.45), pc[1] * (1 - dmg * 0.45), pc[2] * (1 - dmg * 0.45)];
  const cabF = car.dead ? [14, 12, 12] : [pc[0] * 0.1, pc[1] * 0.1, pc[2] * 0.12];
  const steer = (car.steer || 0) * 0.45, spin = car.spin || 0, cs = Math.cos(spin), sn = Math.sin(spin), ct = Math.cos(steer), st = Math.sin(steer);
  const lift = [0, 0.02, 0];
  geo.parts.forEach((pt, k) => {
    const D = car.dents && car.dents[k];
    let vs;
    if (pt.wheel) {
      const c = pt.wheel.c;
      vs = pt.v.map(v => {
        let x = v[0] - c[0], y = v[1] - c[1], z = v[2] - c[2];
        const y2 = y * cs - z * sn, z2 = y * sn + z * cs; y = y2; z = z2;
        if (pt.wheel.front) { const x3 = x * ct + z * st, z3 = -x * st + z * ct; x = x3; z = z3; }
        return [x + c[0], y + c[1], z + c[2]];
      });
    } else vs = D ? pt.v.map((v, i) => add(v, D[i])) : pt.v;
    const wv = vs.map(v => add(add(car.pos, lift), RD.toWorld(o, v)));
    const tone = TONES[pt.tone];
    const fill = pt.tone === 'body' ? bodyF : pt.tone === 'cabin' ? cabF : (tone ? tone[0] : bodyF);
    const edge = pt.tone === 'body' || pt.tone === 'cabin' ? bodyE : (car.dead ? [60, 55, 50] : tone[1]);
    pt.faces.forEach((f, fi) => {
      const pts = f.idx.map(i => wv[i]);
      const decs = pt.decByFace[fi];
      const lines = decs.length ? decs.map(d => {
        const map = p => add(add(car.pos, lift), RD.toWorld(o, pt.wheel ? (() => { const c = pt.wheel.c; let x = p[0] - c[0], y = p[1] - c[1], z = p[2] - c[2]; const y2 = y * cs - z * sn, z2 = y * sn + z * cs; y = y2; z = z2; if (pt.wheel.front) { const x3 = x * ct + z * st, z3 = -x * st + z * ct; x = x3; z = z3; } return [x + c[0], y + c[1], z + c[2]]; })() : p));
        return [map(d[0]), map(d[1]), edge, 1];
      }) : null;
      poly(pts, fill, edge, { lines, list, lw: 1.1 });
    });
  });
  return o;
}
// ===================== TILA JA VERKKO =====================
let sock = null, myIdx = -1, roomCode = '', slots = [], host = -1, mode = 'lobby', modeT = 0, animT = 0, winner = -1, wins = [0, 0, 0];
let selState = [], mySel = { car: 0, gun: 0, spec: 0, ready: false }, selInit = false;
let me = null, cars = new Map(), snaps = [], latest = null, timeOff = null, rtt = 0;
let parts = [], tracers = [], msgs = [], feed = [];
let camMode = 0, mapZoom = 1, escT = 0, sendT = 0;
const keys = {}, touch = { sx: 0, sy: 0, stick: false, fire: false, hand: false };
const srvNow = () => performance.now() / 1000 + (timeOff || 0);
const INTERP = 0.12;
function setStatus(t) { $('status').textContent = t || ''; }
function show(id, on) { $(id).hidden = !on; }
function showPane(p) { for (const id of ['pMenu', 'pHost', 'pJoin', 'pRoom']) show(id, false); for (const id of [].concat(p)) show(id, true); show('bBack', p !== 'pMenu'); }
function connect() {
  setStatus('YHDISTETÄÄN PALVELIMEEN...');
  sock = io({ transports: ['websocket', 'polling'] });
  sock.on('connect', () => {
    setStatus('');
    const k = new URLSearchParams(location.search).get('k');
    if (k && !connect.auto) { connect.auto = true; $('codeIn').value = k.toUpperCase(); showPane('pJoin'); doJoin(k); }
  });
  sock.on('connect_error', () => setStatus('PALVELIN HERÄÄ TAI YHTEYS EI TOIMI - YRITETÄÄN UUDELLEEN...'));
  sock.on('disconnect', () => { if (mode !== 'lobby') toLobby('YHTEYS KATKESI'); });
  sock.on('roster', d => {
    roomCode = d.code; host = d.host; myIdx = d.you;
    if (d.you === d.host && $('code').textContent === d.code) showPane(['pHost', 'pRoom']); else showPane('pRoom');
    const n = d.slots.filter(Boolean).length;
    $('roster').innerHTML = d.slots.map((on, i) => `<div class="slot ${on ? 'on' : ''}" style="color:${on ? PCOL[i] : ''};border-color:${on ? PCOL[i] : ''}">${on ? PNAME[i] + (i === d.you ? ' (SINÄ)' : '') : 'VAPAA'}</div>`).join('');
    $('roomInfo').textContent = 'PELI ' + d.code + ' · PELAAJIA ' + n + '/3 · ' + (d.you === d.host ? (n >= 2 ? 'VOIT ALOITTAA' : 'ODOTETAAN PELAAJIA...') : 'ODOTETAAN ETTÄ PELIN LUOJA ALOITTAA');
    $('bBegin').hidden = d.you !== d.host; $('bBegin').disabled = n < 2;
  });
  sock.on('ready', d => { myIdx = d.idx; slots = d.slots; roomCode = d.code; enterSelect(); });
  sock.on('sel', d => {
    selState = d.sel; wins = d.wins;
    const mine = selState.find(s => s.id === myIdx);
    if (mine && !selInit) { mySel = { car: mine.car, gun: mine.gun, spec: mine.spec, ready: mine.ready }; selInit = true; buildSelectUI(); }
    if (mine) mySel.ready = mine.ready;
    updateSelectUI();
  });
  sock.on('start', onStart);
  sock.on('S', onSnap);
  sock.on('fix', d => { if (me && !me.dead) { me.pos = d.p.slice(); me.vel = d.v.slice(); me.fixN = d.n; } });
  sock.on('spin', d => { if (me) { me.spinT = d.t; me.yawRate += (Math.random() < 0.5 ? -1 : 1) * 2.2; } });
  sock.on('note', d => addMsg(d.t, '#ffd060', 2));
  sock.on('left', d => toLobby(d && d.reason));
  setInterval(() => { if (sock.connected) { const t = performance.now(); sock.emit('png', t, () => { rtt = performance.now() - t; }); } }, 2000);
}
function doCreate() {
  initAudio(); setStatus('LUODAAN PELIÄ...');
  sock.emit('create', { origin: location.origin }, d => {
    setStatus(''); $('code').textContent = d.code; $('joinUrl').textContent = d.url; if (d.qr) $('qr').src = d.qr;
    showPane(['pHost', 'pRoom']);
  });
}
function doJoin(code) {
  initAudio(); code = String(code || '').toUpperCase().trim();
  if (code.length !== 4) { setStatus('KOODISSA ON NELJÄ KIRJAINTA'); return; }
  setStatus('LIITYTÄÄN...');
  sock.emit('join', { code }, d => { if (d && d.err) setStatus(d.err); else setStatus(''); });
}
function goFullscreen() {
  const el = document.documentElement;
  try { if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().then(() => { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); }).catch(() => {}); } catch (e) {}
}
function enterSelect() {
  mode = 'select'; selInit = false; show('lobby', false); show('select', true); document.body.classList.add('ingame');
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  if (isTouch) goFullscreen();
  updateTouch();
}
function toLobby(reason) {
  mode = 'lobby'; me = null; cars.clear(); snaps = []; latest = null; myIdx = -1; selInit = false;
  show('select', false); show('lobby', true); document.body.classList.remove('ingame'); showPane('pMenu');
  $('code').textContent = '----'; setStatus(reason || ''); updateTouch(); engineOff();
}
// ---------- valintaruutu ----------
function buildSelectUI() {
  const pc = PCOL[myIdx];
  $('selBox').style.setProperty('--pc', pc);
  const bar = v => `<i style="width:${Math.round(clamp(v, 0.05, 1) * 100)}%"></i>`;
  $('carRow').innerHTML = CARS.map((c, i) => `<button class="card" data-k="car" data-i="${i}"><div class="nm">${c.nm}</div><div class="ds">${c.desc}</div>
    <div class="st"><span>NOPEUS</span>${bar((c.maxSpd - 25) / 17)}<span>KESTÄVYYS</span>${bar((c.hp - 80) / 80)}<span>OHJATTAVUUS</span>${bar((c.turn - 1.4) / 1)}<span>MAASTO</span>${bar(c.off)}</div></button>`).join('');
  $('gunRow').innerHTML = GUNS.map((g, i) => `<button class="card" data-k="gun" data-i="${i}"><div class="nm">${g.nm}</div><div class="ds">${g.desc}</div>
    <div class="st"><span>VAHINKO/S</span>${bar(g.dmg * g.pellets / g.cd / 35)}<span>KANTAMA</span>${bar(g.range / 300)}</div></button>`).join('');
  $('specRow').innerHTML = SPECIALS.map((s, i) => `<button class="card" data-k="spec" data-i="${i}"><div class="nm">${s.nm}</div><div class="ds">${s.desc} · ${s.cnt} KPL</div></button>`).join('');
  for (const b of document.querySelectorAll('.card')) b.onclick = () => {
    if (mySel.ready) return;
    mySel[b.dataset.k] = +b.dataset.i; beep(); sendSel(); updateSelectUI();
  };
  updateSelectUI();
}
function updateSelectUI() {
  for (const b of document.querySelectorAll('.card')) b.classList.toggle('on', mySel[b.dataset.k] === +b.dataset.i);
  $('bReady').textContent = mySel.ready ? 'VALMIS! (PERU)' : 'VALMIS';
  $('others').innerHTML = 'TILANNE: ' + selState.filter(s => s.on).map(s => `<span style="color:${PCOL[s.id]}">${PNAME[s.id]}${s.id === myIdx ? ' (SINÄ)' : ''} ${wins[s.id]} V · ${s.ready ? 'VALMIS' : 'VALITSEE'}</span>`).join(' &nbsp; ');
}
function sendSel() { sock.emit('sel', mySel); }
// ---------- ottelu ----------
function onStart(d) {
  cars.clear();
  for (const c of d.cars) {
    if (!c.on) continue;
    const car = { id: c.id, ci: c.car, gun: c.gun, spec: c.spec, pos: c.p.slice(), yaw: c.yaw, steer: 0, spin: 0, hp: CARS[c.car].hp, maxHp: CARS[c.car].hp,
      dead: false, dents: newDents(c.car), am: SPECIALS[c.spec].cnt, speed: 0, k: 0 };
    cars.set(c.id, car);
  }
  const mc = cars.get(myIdx);
  me = Object.assign(mc, { vel: [0, 0], yawRate: 0, fixN: 0, spinT: 0, local: true, gunCd: 0 });
  cam.pos = null; snaps = []; latest = null; timeOff = null; parts = []; tracers = []; msgs = []; feed = [];
  show('select', false); mode = 'countdown'; modeT = 0; updateTouch(); engineOn();
}
function onSnap(s) {
  const now = performance.now() / 1000, off = s.t - now;
  if (timeOff === null || Math.abs(off - timeOff) > 1) timeOff = off; else timeOff += (off - timeOff) * 0.05;
  const old = mode;
  if (mode !== 'lobby' && !(mode === 'select' && s.m === 'select')) { mode = s.m; modeT = s.mt; }
  winner = s.w; wins = s.wn;
  latest = s;
  if (s.P) { if (snaps.length && s.t < snaps[snaps.length - 1].t) snaps = []; snaps.push(s); while (snaps.length > 30) snaps.shift(); }
  for (const p of (s.P || [])) {
    const c = cars.get(p.i); if (!c) continue;
    c.hp = p.hp; c.am = p.am; c.k = p.k;
    if (p.d && !c.dead) { c.dead = true; if (c === me) { me.vel = [0, 0]; } }
  }
  if (old !== mode) {
    if (mode === 'fight') { sfx('go'); addMsg('AJA!', '#9dff9d', 1.2); }
    if (mode === 'over') { if (winner === myIdx) sfx('win'); }
    if (mode === 'select') { show('select', true); mySel.ready = false; updateSelectUI(); engineOff(); }
  }
  for (const e of s.E) handleEvent(e);
  updateTouch();
}
function handleEvent(e) {
  switch (e.e) {
    case 'msg': if (e.id === myIdx) addMsg(e.t, e.c, e.d); break;
    case 'shot': {
      if (e.id !== myIdx) for (const b of e.b) tracers.push({ a: e.a, b, col: hex(GUNS[e.k].col), t: 0.07 });
      if (e.id !== myIdx) sfx('gun' + e.k, distK(e.a));
      break;
    }
    case 'hit': {
      const c = cars.get(e.id); if (!c) break;
      c.hp = e.hp; applyDent(c, e.lp, e.ds);
      if (e.lp) { const o = carOri(c.pos, c.yaw), wp = add(c.pos, RD.toWorld(o, e.lp)); for (let i = 0; i < 6; i++) parts.push({ p: wp.slice(), v: madd([rnd(-3, 3), rnd(1, 5), rnd(-3, 3)], [0, 0, 0], 1), t: rnd(0.2, 0.5), col: [255, 220, 120], s: 0.25 }); }
      if (e.id === myIdx) { hitFlash = 0.18; if (e.k !== 'crash') sfx('hit'); }
      break;
    }
    case 'boom': {
      const big = !!e.b;
      for (let i = 0; i < (big ? 60 : 30); i++) parts.push({ p: e.p.slice(), v: [rnd(-1, 1) * (big ? 14 : 9), rnd(2, big ? 16 : 10), rnd(-1, 1) * (big ? 14 : 9)], t: rnd(0.5, 1.4), col: chance(0.5) ? [255, 200, 80] : [255, 90, 40], s: big ? 0.6 : 0.45, g: 1 });
      for (let i = 0; i < 14; i++) parts.push({ p: e.p.slice(), v: [rnd(-3, 3), rnd(2, 6), rnd(-3, 3)], t: rnd(1.5, 3), col: [70, 70, 80], s: 1.2 });
      sfx(big ? 'boom' : 'blast', distK(e.p));
      break;
    }
    case 'kill': feed.push({ t: 5, s: (e.by >= 0 && e.by !== e.id ? PNAME[e.by] + ' TUHOSI: ' : '') + PNAME[e.id], c: PCOL[e.id] }); break;
    case 'sfx': { const c = cars.get(e.id); sfx(e.n, c ? distK(c.pos) : 1); break; }
  }
}
function addMsg(t, c, d) { msgs = msgs.filter(m => m.t !== t); msgs.push({ t, c: c || '#fff', d: d || 2 }); if (msgs.length > 3) msgs.shift(); }
function distK(p) { if (!me || !p) return 0.6; return clamp(1.2 - vlen(sub(p, me.pos)) / 400, 0.08, 1); }
// interpolointi
function interpCars() {
  const rt = srvNow() - INTERP;
  if (!snaps.length) return;
  let a = snaps[0], b = snaps[0];
  for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i].t <= rt) { a = snaps[i]; b = snaps[i + 1] || a; break; }
  const k = b === a ? 0 : clamp((rt - a.t) / (b.t - a.t), 0, 1);
  const am = new Map(a.P.map(p => [p.i, p]));
  for (const pb of b.P) {
    const c = cars.get(pb.i); if (!c || c.local) continue;
    const pa = am.get(pb.i) || pb;
    c.pos = [pa.p[0] + (pb.p[0] - pa.p[0]) * k, pa.p[1] + (pb.p[1] - pa.p[1]) * k, pa.p[2] + (pb.p[2] - pa.p[2]) * k];
    c.yaw = pa.y + angDiff(pb.y, pa.y) * k; c.steer = pb.st; c.speed = pb.s;
  }
}
// ===================== OMA AUTO (fysiikka) =====================
const KEYS = { gas: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  fire: ['Space'], spec: ['KeyX', 'Enter', 'NumpadEnter', 'KeyK'], hand: ['ShiftLeft', 'ShiftRight', 'KeyC'] };
const any = l => l.some(k => keys[k]);
function canDrive() { return me && !me.dead && (mode === 'fight' || mode === 'over'); }
function physics(dt) {
  const c = CARS[me.ci];
  let thr = (any(KEYS.gas) ? 1 : 0) - (any(KEYS.brake) ? 1 : 0), steer = (any(KEYS.right) ? 1 : 0) - (any(KEYS.left) ? 1 : 0);
  if (touch.stick) { steer = clamp(touch.sx * 1.25, -1, 1); thr = clamp(-touch.sy * 1.3, -1, 1); }
  const hand = any(KEYS.hand) || touch.hand;
  me.steer += (steer - me.steer) * Math.min(1, dt * (touch.stick ? 10 : 6));
  const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw), rx = fz, rz = -fx;
  let vF = me.vel[0] * fx + me.vel[1] * fz, vR = me.vel[0] * rx + me.vel[1] * rz;
  const rt = W0.roadAt(me.pos[0], me.pos[2]);
  const surf = rt && ROADTYPES[rt] ? ROADTYPES[rt] : rt === 'PIHA' ? { grip: 0.95, spd: 0.85 } : { grip: 0.75, spd: c.off };
  const maxS = c.maxSpd * surf.spd;
  if (thr > 0) vF += c.acc * thr * dt * clamp(1 - vF / maxS, -0.5, 1) * (vF < 0 ? 2 : 1);
  else if (thr < 0) { if (vF > 0.5) vF -= 22 * -thr * dt; else vF = Math.max(-11, vF - 7 * -thr * dt); }
  vF -= vF * (0.12 + (hand ? 0.6 : 0)) * dt;
  if (thr === 0 && Math.abs(vF) < 0.3) vF = 0;
  // painovoima rinteessä
  const n = normalAt(me.pos[0], me.pos[2]);
  const gt = [-n[0] * n[1] * 9.8, 0, -n[2] * n[1] * 9.8];
  vF += (gt[0] * fx + gt[2] * fz) * dt * 0.8;
  // sivupito: käsijarru ja öljy liu'uttavat
  me.spinT -= dt;
  const grip = (me.spinT > 0 ? 0.6 : hand ? 1.4 : 8) * surf.grip * c.grip;
  vR *= Math.exp(-grip * dt);
  // ohjaus
  const sp = Math.abs(vF);
  const targetRate = me.steer * c.turn * clamp(sp / 7, 0, 1) * (1 - 0.35 * clamp(sp / c.maxSpd, 0, 1)) * Math.sign(vF || 1) * (hand ? 1.5 : 1);
  me.yawRate += (targetRate - me.yawRate) * Math.min(1, dt * (me.spinT > 0 ? 1.2 : 8));
  me.yaw += me.yawRate * dt;
  me.vel = [fx * vF + rx * vR, fz * vF + rz * vR];
  let nx = me.pos[0] + me.vel[0] * dt, nz = me.pos[2] + me.vel[1] * dt;
  // liian jyrkkä rinne toimii seinänä
  const n2 = normalAt(nx, nz);
  if (n2[1] < 0.72) {
    const gx = n2[0], gz = n2[2], gl = Math.hypot(gx, gz) || 1, up = -(me.vel[0] * gx + me.vel[1] * gz) / gl;
    if (up > 0) { me.vel = [me.vel[0] + gx / gl * up * 1.2, me.vel[1] + gz / gl * up * 1.2]; nx = me.pos[0] + me.vel[0] * dt; nz = me.pos[2] + me.vel[1] * dt; }
  }
  me.pos = [nx, H(nx, nz), nz];
  collideStatic();
  const r = Math.hypot(me.pos[0], me.pos[2]);
  if (r > RD.BOUND) { const k = RD.BOUND / r; me.pos[0] *= k; me.pos[2] *= k; me.pos[1] = H(me.pos[0], me.pos[2]); me.vel = scl3(me.vel, 0.5); if (!physics.bt || physics.bt < animT) { addMsg('VUORET SULKEVAT TIEN', '#ffd060', 1.2); physics.bt = animT + 2; } }
  me.speed = vF; me.spin += vF * dt / 0.4;
  // savu vauriosta
  const dmg = 1 - me.hp / me.maxHp;
  if (dmg > 0.5 && chance(dt * (dmg * 18))) smoke(me, dmg);
  return { thr, hand };
}
const scl3 = (v, k) => [v[0] * k, v[1] * k];
function smoke(c, dmg) {
  const o = carOri(c.pos, c.yaw), p = add(c.pos, RD.toWorld(o, [rnd(-0.4, 0.4), 1.1, 1.5]));
  parts.push({ p, v: [rnd(-0.5, 0.5), rnd(1.5, 3), rnd(-0.5, 0.5)], t: rnd(0.8, 1.6), col: dmg > 0.75 && chance(0.5) ? [255, 120, 40] : [80, 80, 90], s: 0.9 });
}
function collideStatic() {
  const R = 2.1;
  for (const o of W0.nearObstacles(me.pos[0], me.pos[2])) {
    let nx, nz, pen;
    if (o.kind !== undefined) {
      const cx = clamp(me.pos[0], o.x0, o.x1), cz = clamp(me.pos[2], o.z0, o.z1), dx = me.pos[0] - cx, dz = me.pos[2] - cz, d = Math.hypot(dx, dz);
      if (d >= R) continue;
      if (d < 1e-6) { nx = 0; nz = 1; pen = R; } else { nx = dx / d; nz = dz / d; pen = R - d; }
    } else {
      const dx = me.pos[0] - o.x, dz = me.pos[2] - o.z, d = Math.hypot(dx, dz), rr = R + 0.7;
      if (d >= rr) continue;
      nx = dx / (d || 1); nz = dz / (d || 1); pen = rr - d;
    }
    me.pos[0] += nx * pen; me.pos[2] += nz * pen;
    const vn = me.vel[0] * nx + me.vel[1] * nz;
    if (vn < 0) {
      me.vel = [me.vel[0] - nx * vn * 1.35, me.vel[1] - nz * vn * 1.35];
      const imp = -vn;
      if (imp > 4) {
        const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw);
        const lx = -(nx * fz - nz * fx), lz = -(nx * fx + nz * fz);
        sock.emit('crash', { imp: Math.round(imp * 10) / 10, lp: [Math.round(lx * 1.0 * 100) / 100, 0.8, Math.round(lz * 2.0 * 100) / 100] });
        sfx('crash', clamp(imp / 20, 0.3, 1));
        for (let i = 0; i < 8; i++) parts.push({ p: [me.pos[0] - nx * 2, me.pos[1] + 0.8, me.pos[2] - nz * 2], v: [rnd(-3, 3), rnd(1, 4), rnd(-3, 3)], t: 0.4, col: [255, 230, 160], s: 0.2 });
      }
    }
  }
}
// ===================== KAMERA JA PIIRTO =====================
const cam = { pos: null, look: [0, 0, 1] };
let hitFlash = 0;
function camTarget() {
  if (me && !me.dead) return me;
  // kuollut: seuraa elossa olevaa autoa
  for (const c of cars.values()) if (!c.dead) return c;
  return me;
}
function updateCam(dt) {
  const t = camTarget(); if (!t) return;
  const fh = [Math.sin(t.yaw), 0, Math.cos(t.yaw)];
  const back = camMode ? 17 : 10.5, up = camMode ? 8 : 4.6;
  const want = [t.pos[0] - fh[0] * back, 0, t.pos[2] - fh[2] * back];
  want[1] = Math.max(t.pos[1] + up, H(want[0], want[2]) + 2.2);
  if (!cam.pos) cam.pos = want; else { const k = Math.min(1, dt * 6); cam.pos = [cam.pos[0] + (want[0] - cam.pos[0]) * k, cam.pos[1] + (want[1] - cam.pos[1]) * k, cam.pos[2] + (want[2] - cam.pos[2]) * k]; }
  cam.pos[1] = Math.max(cam.pos[1], H(cam.pos[0], cam.pos[2]) + 1.5);
  const target = add(t.pos, [fh[0] * 7, 1.6, fh[2] * 7]);
  cam.look = sub(target, cam.pos);
}
function drawSky(ctx, w, h) {
  // horisontin korkeus kameran suunnasta
  const hz = V.cy - (V.f[1] / Math.max(0.05, Math.hypot(V.f[0], V.f[2]))) * V.F * -1;
  const hy = clamp(V.cy + V.F * (V.f[1] / Math.max(0.05, Math.hypot(V.f[0], V.f[2]))), -h, 2 * h);
  const g = ctx.createLinearGradient(0, hy - h * 0.8, 0, hy + 10);
  g.addColorStop(0, '#04040c'); g.addColorStop(0.65, '#160c30'); g.addColorStop(0.92, '#4a1c4a'); g.addColorStop(1, '#7a3a3a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgb(' + FOG.join(',') + ')'; ctx.fillRect(0, hy, w, h - hy + 2);
  // tähdet
  ctx.fillStyle = '#9aa6c8';
  for (let i = 0; i < 90; i++) {
    const a = (i * 2.399) % (Math.PI * 2), el = 0.08 + ((i * 0.618) % 1) * 0.9;
    const d = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)], c = [dot(d, V.r), dot(d, V.u), dot(d, V.f)];
    if (c[2] < 0.1) continue;
    const x = V.cx + c[0] * V.F / c[2], y = V.cy - c[1] * V.F / c[2];
    if (y < hy - 4) ctx.fillRect(x, y, V.lwk, V.lwk);
  }
  // kuu
  const md = norm([-0.6, 0.35, 0.7]), mc = [dot(md, V.r), dot(md, V.u), dot(md, V.f)];
  if (mc[2] > 0.1) { const x = V.cx + mc[0] * V.F / mc[2], y = V.cy - mc[1] * V.F / mc[2], r = V.F * 0.03; ctx.strokeStyle = '#ffe6b0'; ctx.lineWidth = 1.5 * V.lwk; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); ctx.fillStyle = 'rgba(255,230,176,0.12)'; ctx.fill(); }
  return hz;
}
function buildScene() {
  itemsA = []; itemsB = [];
  const C = V.C, fh = norm([V.f[0], 0, V.f[2]]);
  const front = (p, m) => (p[0] - C[0]) * fh[0] + (p[2] - C[2]) * fh[2] > -m;
  const d2 = (p) => (p[0] - C[0]) ** 2 + (p[2] - C[2]) ** 2;
  const VIEW = V.fogFar, VIEW2 = VIEW * VIEW;
  // kaupungin pohja, puistot ja kadut (tasainen kerros, piirretään ensin)
  const inCity = Math.max(Math.abs(C[0]), Math.abs(C[2])) < CITY + 900;
  if (inCity) {
    for (const t of cityTiles) poly(t, COLS.ground, null, { list: itemsA });
    for (const cb of curbs) if (d2(cb.c) < 380 * 380 && front(cb.c, 60)) for (const l of cb.l) addLine(l[0], l[1], l[2], l[3], itemsA);
    for (const p of parks) if (d2(p[0]) < 700 * 700) poly(p, COLS.park, COLS.parkE, { list: itemsA });
    for (const r of cityRoads) if (d2([r.c[0], 0, r.c[1]]) < 900 * 900 && front([r.c[0], 0, r.c[1]], 90)) {
      const it = poly(r.pts, r.col, null, { list: itemsA, lines: d2([r.c[0], 0, r.c[1]]) < 420 * 420 ? r.lines : r.lines.slice(0, 2) });
      if (r.med) poly(r.med, COLS.median, null, { list: itemsA, bias: -0.1 });
    }
  }
  // maasto ja maaseudun tiet
  for (const c of cells) {
    if (d2(c.c) > VIEW2 || !front(c.c, 160)) continue;
    const it = poly(c.pts, c.fill, c.edge, { bias: CELL * 0.75, shade: c.shade, lw: 0.6 });
    if (it && c.roads.length) {
      it.sub = [];
      const save = itemsB; itemsB = it.sub;
      for (const r of c.roads) poly(r.pts, r.col, null, { lines: r.lines, cull: true });
      itemsB = save;
    }
  }
  for (const r of looseRoads) if (d2(r.c) < VIEW2 && front(r.c, 40)) poly(r.pts, r.col, null, { lines: r.lines, bias: 30 });
  // rakennukset
  for (const B of blds) {
    const dd = d2(B.c); if (dd > 1100 * 1100 || !front(B.c, 120)) continue;
    const near = dd < 300 * 300, vnear = dd < 150 * 150;
    for (const wl of B.walls) {
      let lines = null;
      if (near && B.b.kind !== 'house') {
        lines = [];
        const wc = B.warm ? COLS.win : COLS.winC;
        for (let y = 3.6; y < B.b.h - 1; y += 3.6) lines.push([[wl.a[0], y, wl.a[1]], [wl.b[0], y, wl.b[1]], wc, 0.6]);
        if (vnear) { const L = Math.hypot(wl.b[0] - wl.a[0], wl.b[1] - wl.a[1]), n = Math.floor(L / 5);
          for (let k = 1; k < n; k++) { const t = k / n; lines.push([[wl.a[0] + (wl.b[0] - wl.a[0]) * t, 1.5, wl.a[1] + (wl.b[1] - wl.a[1]) * t], [wl.a[0] + (wl.b[0] - wl.a[0]) * t, B.b.h - 1, wl.a[1] + (wl.b[1] - wl.a[1]) * t], wc, 0.5]); } }
      } else if (near) {
        const mx = (wl.a[0] + wl.b[0]) / 2, mz = (wl.a[1] + wl.b[1]) / 2;
        lines = [[[mx - 1, 1.5, mz], [mx + 1, 1.5, mz], COLS.win, 1], [[mx - 1, 3.3, mz], [mx + 1, 3.3, mz], COLS.win, 1]];
      }
      poly(wl.pts, B.fill, B.edge, { lines, lw: 1 });
    }
    for (const rf of B.roof) poly(rf, B.b.kind === 'house' ? COLS.roof : B.fill, B.b.kind === 'house' ? COLS.roofE : B.edge, {});
  }
  // puut
  for (const t of treeG) {
    if (d2(t.c) > 650 * 650 || !front(t.c, 20)) continue;
    for (const f of t.faces) poly(f, COLS.tree, COLS.treeE, {});
    addLine(t.trunk[0], t.trunk[1], COLS.trunk, 2);
  }
  // öljyt ja miinat
  if (latest && latest.O) for (const o of latest.O) {
    const pts = []; for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2, x = o[1] + Math.cos(a) * o[3] * (0.85 + 0.15 * Math.sin(k * 3)), z = o[2] + Math.sin(a) * o[3]; pts.push([x, H(x, z) + 0.12, z]); }
    poly(upward(pts), [6, 6, 12], [110, 90, 200], { bias: -1 });
  }
  if (latest && latest.M) for (const m of latest.M) {
    const y = H(m[1], m[2]), c = [m[1], y + 0.35, m[2]], b = [];
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; b.push([m[1] + Math.cos(a) * 0.9, y + 0.05, m[2] + Math.sin(a) * 0.9]); }
    for (let k = 0; k < 6; k++) poly(outward([b[k], b[(k + 1) % 6], c], [m[1], y, m[2]]), [30, 30, 30], [180, 180, 190], {});
    if (m[3] && (animT * 3 | 0) % 2) addDot(add(c, [0, 0.15, 0]), [255, 60, 60], 0.35);
  }
  // raketit
  if (latest && latest.K) for (const k of latest.K) {
    const p = [k[1], k[2], k[3]], d = [k[4], k[5], k[6]];
    addLine(p, madd(p, d, -1.6), [230, 230, 240], 2.5);
    if (chance(0.8)) parts.push({ p: madd(p, d, -1.8), v: [rnd(-1, 1), rnd(0, 1), rnd(-1, 1)], t: 0.5, col: chance(0.5) ? [255, 170, 60] : [120, 120, 130], s: 0.5 });
  }
  // autot
  for (const c of cars.values()) {
    if (d2(c.pos) > 900 * 900) continue;
    drawCar(c, itemsB);
    if (c.dead && chance(0.4)) parts.push({ p: add(c.pos, [rnd(-1, 1), 1.3, rnd(-1, 1)]), v: [rnd(-0.6, 0.6), rnd(2, 4), rnd(-0.6, 0.6)], t: rnd(0.6, 1.2), col: chance(0.5) ? [255, 130, 40] : [60, 60, 70], s: 1 });
    // nimikyltti muille autoille
    if (c !== me) { const cp = camP(add(c.pos, [0, 3.2, 0])); if (cp[2] > 2) itemsB.push({ z: cp[2] - 3, kind: 'tag', x: V.cx + cp[0] * V.F / cp[2], y: V.cy - cp[1] * V.F / cp[2], c }); }
  }
  for (const t of tracers) addLine(t.a, t.b, t.col, 1.6);
  for (const p of parts) addDot(p.p, p.col, p.s);
}
const _drawItem = drawItem;
function drawItemHUD(ctx, it) {
  if (it.kind !== 'tag') return _drawItem(ctx, it);
  const c = it.c;
  ctx.font = `${Math.round(11 * V.lwk)}px "Share Tech Mono", monospace`; ctx.textAlign = 'center';
  ctx.fillStyle = PCOL[c.id]; ctx.fillText(PNAME[c.id] + (c.dead ? ' ✕' : ''), it.x, it.y - 8 * V.lwk);
  if (!c.dead) { const w = 40 * V.lwk; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(it.x - w / 2, it.y - 4 * V.lwk, w, 4 * V.lwk); ctx.fillStyle = PCOL[c.id]; ctx.fillRect(it.x - w / 2, it.y - 4 * V.lwk, w * clamp(c.hp / c.maxHp, 0, 1), 4 * V.lwk); }
}
// ---------- minikartta ----------
const MAP_S = 0.32, MAP_N = Math.round(WORLD * 2 * MAP_S);
let mapImg = null, minimapDirty = true;
function buildMapImage() {
  mapImg = document.createElement('canvas'); mapImg.width = MAP_N; mapImg.height = MAP_N;
  const g = mapImg.getContext('2d');
  const X = x => (x + WORLD) * MAP_S, Z = z => (WORLD - z) * MAP_S;
  g.fillStyle = '#070912'; g.fillRect(0, 0, MAP_N, MAP_N);
  for (const c of cells) {
    const h = c.c[1], col = h > 300 ? '#3a3f4c' : h > 160 ? '#2a241e' : '#0f2216';
    g.fillStyle = col; g.fillRect(X(c.c[0] - CELL / 2), Z(c.c[2] + CELL / 2), CELL * MAP_S + 1, CELL * MAP_S + 1);
  }
  g.fillStyle = '#10121a'; g.fillRect(X(-CITY - 40), Z(CITY + 40), (CITY + 40) * 2 * MAP_S, (CITY + 40) * 2 * MAP_S);
  for (const b of W0.buildings) { g.fillStyle = b.kind === 'park' ? '#123a20' : b.kind === 'tower' ? '#1f3550' : '#24242e'; g.fillRect(X(b.x0), Z(b.z1), (b.x1 - b.x0) * MAP_S, (b.z1 - b.z0) * MAP_S); }
  g.lineCap = 'round';
  const roadCol = { BULEVARDI: '#c8ccd8', KATU: '#6c7088', MOOTTORITIE: '#ffd34d', MAANTIE: '#e0e0e0', SORATIE: '#b0814f' };
  for (const L of W0.lines) { g.strokeStyle = roadCol[L.type]; g.lineWidth = Math.max(1.2, ROADTYPES[L.type].w * MAP_S);
    g.beginPath(); g.moveTo(X(L.c), Z(-CITY)); g.lineTo(X(L.c), Z(CITY)); g.moveTo(X(-CITY), Z(L.c)); g.lineTo(X(CITY), Z(L.c)); g.stroke(); }
  for (const s of W0.roads) { g.strokeStyle = roadCol[s.type]; g.lineWidth = Math.max(1.4, ROADTYPES[s.type].w * MAP_S); g.beginPath(); g.moveTo(X(s.a[0]), Z(s.a[1])); g.lineTo(X(s.b[0]), Z(s.b[1])); g.stroke(); }
}
function drawMinimap(ctx) {
  if (!mapImg) buildMapImage();
  const t = camTarget(); if (!t) return;
  const R = Math.round(Math.min(SW, SH) * (mapZoom === 2 ? 0.3 : 0.17)), cx = SW - R - 14 * V.lwk, cy = R + 14 * V.lwk;
  const zoom = mapZoom === 0 ? 2.2 : mapZoom === 2 ? 0.9 : 1.3;
  const k = MAP_S * zoom * (R / 140);
  const rot = -Math.PI / 2 - Math.atan2(-Math.cos(t.yaw), Math.sin(t.yaw));
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = '#05060c'; ctx.fill(); ctx.clip();
  ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(k / MAP_S, k / MAP_S);
  ctx.globalAlpha = 0.9;
  ctx.drawImage(mapImg, -(t.pos[0] + WORLD) * MAP_S, -(WORLD - t.pos[2]) * MAP_S);
  ctx.globalAlpha = 1;
  ctx.restore();
  // muut autot nuolina; kartan reunalle jos kaukana
  const toMap = (x, z) => { const dx = (x - t.pos[0]) * k, dy = -(z - t.pos[2]) * k, c = Math.cos(rot), s = Math.sin(rot); return [dx * c - dy * s, dx * s + dy * c]; };
  const arrow = (x, y, ang, col, sz, ghost) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.7, sz * 0.8); ctx.lineTo(0, sz * 0.35); ctx.lineTo(-sz * 0.7, sz * 0.8); ctx.closePath();
    ctx.fillStyle = ghost ? 'rgba(0,0,0,0.5)' : col; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.5 * V.lwk; ctx.stroke(); ctx.restore();
  };
  for (const c of cars.values()) {
    if (c === t) continue;
    let [mx, my] = toMap(c.pos[0], c.pos[2]);
    const d = Math.hypot(mx, my), edge = d > R - 10 * V.lwk;
    if (edge) { mx *= (R - 10 * V.lwk) / d; my *= (R - 10 * V.lwk) / d; }
    const ang = rot + Math.atan2(-Math.cos(c.yaw), Math.sin(c.yaw)) + Math.PI / 2;
    arrow(cx + mx, cy + my, ang, PCOL[c.id], 7 * V.lwk, c.dead);
    if (edge) { ctx.fillStyle = PCOL[c.id]; ctx.font = `${Math.round(10 * V.lwk)}px "Share Tech Mono", monospace`; ctx.textAlign = 'center';
      ctx.fillText(Math.round(vlen(sub(c.pos, t.pos))) + 'M', cx + mx * 0.78, cy + my * 0.78 + 3 * V.lwk); }
  }
  arrow(cx, cy, 0, PCOL[t.id], 8 * V.lwk, false);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.strokeStyle = PCOL[myIdx] || '#8af'; ctx.lineWidth = 2 * V.lwk; ctx.stroke();
  ctx.fillStyle = '#c8d0e0'; ctx.font = `${Math.round(10 * V.lwk)}px "Share Tech Mono", monospace`; ctx.textAlign = 'center';
  ctx.fillText('KARTTA' + (isTouch ? '' : ' (M)'), cx, cy + R + 13 * V.lwk);
}
// ---------- HUD ----------
function drawHUD(ctx) {
  const s = V.lwk, pad = 14 * s;
  ctx.textAlign = 'left';
  if (me) {
    const c = CARS[me.ci], hp = clamp(me.hp / me.maxHp, 0, 1), pc = PCOL[myIdx];
    ctx.font = `${Math.round(13 * s)}px Orbitron, sans-serif`; ctx.fillStyle = pc;
    ctx.fillText(PNAME[myIdx] + ' · ' + c.nm, pad, pad + 10 * s);
    const bw = 190 * s, bh = 10 * s, by = pad + 20 * s;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(pad, by, bw, bh);
    ctx.fillStyle = hp > 0.5 ? '#9dff9d' : hp > 0.25 ? '#ffd060' : ((animT * 4 | 0) % 2 ? '#ff6060' : '#a03030'); ctx.fillRect(pad, by, bw * hp, bh);
    ctx.strokeStyle = pc; ctx.lineWidth = 1.2 * s; ctx.strokeRect(pad, by, bw, bh);
    ctx.font = `${Math.round(11 * s)}px "Share Tech Mono", monospace`; ctx.fillStyle = '#c8d0e0';
    ctx.fillText('KESTÄVYYS ' + Math.round(hp * 100) + '%', pad, by + bh + 13 * s);
    ctx.fillText(GUNS[me.gun].nm + ' · ' + SPECIALS[me.spec].nm + ' ' + '■'.repeat(Math.max(0, me.am)) + '□'.repeat(Math.max(0, SPECIALS[me.spec].cnt - me.am)), pad, by + bh + 27 * s);
    ctx.font = `${Math.round(30 * s)}px Orbitron, sans-serif`; ctx.fillStyle = '#e8ecf5'; ctx.textAlign = isTouch ? 'center' : 'left';
    const kmh = Math.round(Math.abs(me.speed || 0) * 3.6);
    const sx = isTouch ? SW / 2 : pad, sy = SH - pad - (isTouch ? 0 : 8 * s);
    ctx.fillText(kmh, sx, sy); ctx.font = `${Math.round(11 * s)}px "Share Tech Mono", monospace`; ctx.fillStyle = '#6b7390';
    ctx.fillText('KM/H · ' + (W0.roadAt(me.pos[0], me.pos[2]) || 'MAASTO'), isTouch ? sx : sx + 62 * s, isTouch ? sy + 13 * s : sy);
  }
  ctx.textAlign = 'right'; ctx.font = `${Math.round(10 * s)}px "Share Tech Mono", monospace`; ctx.fillStyle = '#3a4060';
  ctx.fillText(Math.round(rtt) + ' MS', SW - pad, SH - pad);
  // tähtäin
  if (me && !me.dead && (mode === 'fight' || mode === 'countdown')) {
    const o = carOri(me.pos, me.yaw), aim = camP(add(add(me.pos, [0, 1.3, 0]), scl(o.f, 45)));
    if (aim[2] > 1) {
      const x = V.cx + aim[0] * V.F / aim[2], y = V.cy - aim[1] * V.F / aim[2], r = 9 * s;
      ctx.strokeStyle = me.gunCd > 0 ? '#ffe066' : 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5 * s;
      ctx.beginPath(); ctx.moveTo(x - r * 1.8, y); ctx.lineTo(x - r * 0.6, y); ctx.moveTo(x + r * 0.6, y); ctx.lineTo(x + r * 1.8, y); ctx.moveTo(x, y - r * 1.4); ctx.lineTo(x, y - r * 0.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r * 0.35, 0, 7); ctx.stroke();
    }
    // automaattitähtäyksen lukitus (sama sääntö kuin palvelimella)
    const fh = [Math.sin(me.yaw), Math.cos(me.yaw)];
    for (const c of cars.values()) {
      if (c === me || c.dead) continue;
      const to = [c.pos[0] - me.pos[0], c.pos[2] - me.pos[2]], d = Math.hypot(to[0], to[1]);
      if (d > GUNS[me.gun].range || Math.acos(clamp((to[0] * fh[0] + to[1] * fh[1]) / (d || 1), -1, 1)) > 0.11) continue;
      const cp = camP(add(c.pos, [0, 1, 0])); if (cp[2] < 1) continue;
      const x = V.cx + cp[0] * V.F / cp[2], y = V.cy - cp[1] * V.F / cp[2], r = Math.max(12 * s, 3 * V.F / cp[2]);
      ctx.strokeStyle = PCOL[c.id]; ctx.lineWidth = 2 * s;
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.beginPath(); ctx.moveTo(x + a * r, y + b * r * 0.6); ctx.lineTo(x + a * r * 0.6, y + b * r * 0.6); ctx.moveTo(x + a * r, y + b * r * 0.6); ctx.lineTo(x + a * r, y + b * r * 0.25); ctx.stroke(); }
    }
  }
  // viestit
  ctx.textAlign = 'center';
  let my = SH * 0.3;
  for (const m of msgs) { ctx.font = `${Math.round(16 * s)}px Orbitron, sans-serif`; ctx.fillStyle = m.c; ctx.globalAlpha = clamp(m.d, 0, 1); ctx.fillText(m.t, SW / 2, my); my += 24 * s; }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left'; ctx.font = `${Math.round(11 * s)}px "Share Tech Mono", monospace`;
  feed.forEach((f, i) => { ctx.fillStyle = f.c; ctx.globalAlpha = clamp(f.t, 0, 1); ctx.fillText(f.s, pad, SH * 0.32 + i * 15 * s); });
  ctx.globalAlpha = 1;
  // tilanteet
  ctx.textAlign = 'center';
  if (mode === 'countdown') {
    const n = 3 - Math.floor(modeT);
    ctx.font = `${Math.round(80 * s)}px Orbitron, sans-serif`; ctx.fillStyle = '#ffd060'; ctx.fillText(n > 0 ? n : 'AJA!', SW / 2, SH * 0.42);
    ctx.font = `${Math.round(13 * s)}px "Share Tech Mono", monospace`; ctx.fillStyle = '#c8d0e0';
    ctx.fillText(isTouch ? 'VASEN PUIKKO: OHJAUS JA KAASU · OIKEALLA AMMU, ERIKOISASE, KÄSIJARRU' : 'W/↑ KAASU · S/↓ JARRU · A D OHJAUS · VÄLILYÖNTI AMMU · X ERIKOISASE · SHIFT KÄSIJARRU', SW / 2, SH * 0.52);
    ctx.fillText('VIIMEINEN EHJÄ AUTO VOITTAA. KARTALTA NÄET MUUT.', SW / 2, SH * 0.56);
  }
  if (me && me.dead && mode === 'fight') { ctx.font = `${Math.round(30 * s)}px Orbitron, sans-serif`; ctx.fillStyle = '#ff6060'; ctx.fillText('AUTOSI ON ROMUNA', SW / 2, SH * 0.2); ctx.font = `${Math.round(12 * s)}px "Share Tech Mono", monospace`; ctx.fillStyle = '#c8d0e0'; ctx.fillText('SEURATAAN MUITA', SW / 2, SH * 0.2 + 22 * s); }
  if (mode === 'over') {
    ctx.fillStyle = 'rgba(5,5,12,0.55)'; ctx.fillRect(0, SH * 0.32, SW, SH * 0.3);
    ctx.font = `${Math.round(34 * s)}px Orbitron, sans-serif`;
    ctx.fillStyle = winner >= 0 ? PCOL[winner] : '#ff6060';
    ctx.fillText(winner === myIdx ? 'VOITIT KIERROKSEN!' : winner >= 0 ? PNAME[winner] + ' VOITTI' : 'EI VOITTAJAA', SW / 2, SH * 0.44);
    ctx.font = `${Math.round(14 * s)}px "Share Tech Mono", monospace`; ctx.fillStyle = '#c8d0e0';
    ctx.fillText('VOITOT: ' + [...cars.values()].map(c => PNAME[c.id] + ' ' + wins[c.id]).join(' · '), SW / 2, SH * 0.52);
    ctx.fillText('UUSI KIERROS ALKAA PIAN', SW / 2, SH * 0.57);
  }
  if (escT > 0) { ctx.font = `${Math.round(13 * s)}px "Share Tech Mono", monospace`; ctx.fillStyle = '#ffd060'; ctx.fillText('PAINA ESC UUDELLEEN POISTUAKSESI', SW / 2, SH - 40 * s); }
  if (hitFlash > 0) { ctx.strokeStyle = 'rgba(255,60,60,' + (hitFlash * 3) + ')'; ctx.lineWidth = 14 * s; ctx.strokeRect(0, 0, SW, SH); }
}
// ---------- valintaruudun esikatselu ----------
const prevCv = $('prev'), prevCtx = prevCv.getContext('2d');
function drawPreview() {
  const w = prevCv.width, h = prevCv.height;
  prevCtx.fillStyle = '#070812'; prevCtx.fillRect(0, 0, w, h);
  const a = animT * 0.6, camPos = [Math.sin(a) * 7.5, 2.6, Math.cos(a) * 7.5];
  setView(prevCtx, w, h, camPos, sub([0, 0.9, 0], camPos), [100, 200]);
  V.cy = h * 0.55; V.F = h * 1.25; V.lwk = 1.2;
  itemsB = [];
  for (let k = -3; k <= 3; k++) { addLine([k * 2, 0, -7], [k * 2, 0, 7], [40, 50, 80], 1); addLine([-7, 0, k * 2], [7, 0, k * 2], [40, 50, 80], 1); }
  const fake = { id: myIdx < 0 ? 0 : myIdx, ci: mySel.car, pos: [0, 0, 0], yaw: 0, steer: Math.sin(animT) * 0.6, spin: animT * 3, hp: 1, maxHp: 1, dents: null };
  const savedH = RD.H, savedN = normalAt;
  drawCarFlat(fake);
  flush(itemsB);
}
function drawCarFlat(car) {
  // esikatselussa maasto on tasainen
  const o = { r: [Math.cos(car.yaw), 0, -Math.sin(car.yaw)], u: [0, 1, 0], f: [Math.sin(car.yaw), 0, Math.cos(car.yaw)] };
  const save = carOri; carOriOverride = o; drawCar(car, itemsB); carOriOverride = null;
}
let carOriOverride = null;
const _carOri = carOri;
// ===================== ÄÄNET =====================
let AC = null, master = null, noiseBuf = null, eng = null, soundOn = true;
function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.35; master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { AC = null; }
}
function tone(type, f0, f1, dur, vol, delay = 0) {
  if (!AC || !soundOn || vol < 0.005) return;
  const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(Math.max(20, f0), t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
}
function noise(dur, vol, f0, f1, delay = 0) {
  if (!AC || !soundOn || vol < 0.005) return;
  const t = AC.currentTime + delay, s = AC.createBufferSource(), fl = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; fl.type = 'lowpass'; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  s.connect(fl); fl.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.03);
}
function sfx(n, k = 1) {
  switch (n) {
    case 'gun0': noise(0.06, 0.25 * k, 4000, 900); break;
    case 'gun1': noise(0.25, 0.45 * k, 3000, 200); tone('square', 120, 50, 0.15, 0.1 * k); break;
    case 'gun2': noise(0.5, 0.5 * k, 1800, 60); tone('triangle', 90, 30, 0.4, 0.3 * k); break;
    case 'hit': noise(0.12, 0.3, 6000, 1500); tone('square', 300, 150, 0.08, 0.06); break;
    case 'crash': noise(0.3, 0.5 * k, 1200, 80); tone('triangle', 70, 40, 0.25, 0.25 * k); break;
    case 'boom': noise(1.4, 0.7 * k, 2400, 40); tone('triangle', 110, 25, 1, 0.35 * k); break;
    case 'blast': noise(0.7, 0.5 * k, 2600, 60); break;
    case 'rocket': noise(0.6, 0.25 * k, 900, 3000); break;
    case 'drop': tone('square', 400, 200, 0.12, 0.08 * k); break;
    case 'skid': noise(0.8, 0.3 * k, 3000, 1500); break;
    case 'go': tone('square', 880, 880, 0.35, 0.08); tone('triangle', 440, 440, 0.35, 0.12); break;
    case 'count': tone('square', 523, 523, 0.12, 0.07); break;
    case 'win': [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone('square', f, f, 0.18, 0.07, i * 0.15)); break;
  }
}
const beep = () => tone('square', 990, 990, 0.04, 0.05);
function engineOn() {
  if (!AC || eng) return;
  const o = AC.createOscillator(), o2 = AC.createOscillator(), f = AC.createBiquadFilter(), g = AC.createGain();
  o.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = -1200; f.type = 'lowpass'; f.frequency.value = 600; g.gain.value = 0;
  o.connect(f); o2.connect(f); f.connect(g); g.connect(master); o.start(); o2.start();
  eng = { o, o2, f, g };
}
function engineOff() { if (eng) { try { eng.o.stop(); eng.o2.stop(); } catch (e) {} eng = null; } }
function engineUpdate(thr) {
  if (!eng || !me) return;
  const sp = Math.abs(me.speed || 0), gear = sp / 9, rpm = 1 + (gear % 1) * 1.2 + Math.floor(gear) * 0.08;
  const f = 32 + rpm * 38 + thr * 10;
  eng.o.frequency.setTargetAtTime(f, AC.currentTime, 0.05); eng.o2.frequency.setTargetAtTime(f, AC.currentTime, 0.05);
  eng.g.gain.setTargetAtTime(soundOn && !me.dead && mode !== 'select' ? 0.05 + thr * 0.03 : 0, AC.currentTime, 0.08);
}
// ===================== SYÖTE =====================
window.addEventListener('keydown', ev => {
  initAudio();
  if (mode === 'lobby') { if (ev.code === 'Enter' && !$('pJoin').hidden) doJoin($('codeIn').value); return; }
  const c = ev.code;
  if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && (/^Key|^Arrow|^Digit|^Numpad|^Shift/.test(c) || ['Space', 'Enter', 'Tab'].includes(c))) ev.preventDefault();
  keys[c] = true;
  if (ev.repeat) return;
  if (c === 'Digit9') { soundOn = !soundOn; return; }
  if (c === 'Escape') { if (escT > 0) { sock.emit('quit'); toLobby(''); } else escT = 2; return; }
  if (mode === 'select') {
    if (c === 'Enter' || c === 'Space') { mySel.ready = !mySel.ready; beep(); sendSel(); updateSelectUI(); }
    else if (!mySel.ready && (c === 'ArrowLeft' || c === 'ArrowRight' || c === 'KeyA' || c === 'KeyD')) { mySel.car = (mySel.car + (c === 'ArrowRight' || c === 'KeyD' ? 1 : 3)) % 4; beep(); sendSel(); updateSelectUI(); }
    return;
  }
  if (c === 'KeyV') camMode = 1 - camMode;
  if (c === 'KeyM') mapZoom = (mapZoom + 1) % 3;
  if (KEYS.spec.includes(c) && mode === 'fight') sock.emit('act', 'spec');
});
window.addEventListener('keyup', ev => { keys[ev.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; touch.fire = touch.hand = touch.stick = false; });
cv.addEventListener('pointerdown', () => { initAudio(); if (isTouch && mode !== 'lobby') goFullscreen(); });
function layoutTouch() {
  const w = window.innerWidth, h = window.innerHeight, S = Math.min(h * 0.42, 190), B = Math.min(h * 0.24, 110), b2 = B * 0.72;
  const place = (id, x, y, ww, hh) => Object.assign($(id).style, { left: x + 'px', top: y + 'px', width: ww + 'px', height: hh + 'px' });
  place('stick', Math.max(18, w * 0.04), h - S - Math.max(26, h * 0.08), S, S);
  const fx = w - B - Math.max(18, w * 0.04), fy = h - B - Math.max(26, h * 0.08);
  place('tFire', fx, fy, B, B);
  place('tSpec', fx - b2 - 14, fy + B - b2, b2, b2);
  place('tHand', fx + (B - b2 * 0.8) / 2, fy - b2 * 0.8 - 14, b2 * 0.8, b2 * 0.8);
}
function updateTouch() {
  const show = isTouch && (mode === 'countdown' || mode === 'fight' || mode === 'over') && me && !me.dead;
  if ($('touch').hidden === !!show) { $('touch').hidden = !show; if (show) layoutTouch(); }
}
function setupTouch() {
  const stick = $('stick'), knob = $('knob'); let sid = null;
  const mv = ev => { const r = stick.getBoundingClientRect(), R = r.width / 2; let dx = (ev.clientX - r.left - R) / R, dy = (ev.clientY - r.top - R) / R;
    const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    touch.sx = Math.abs(dx) < 0.06 ? 0 : dx; touch.sy = Math.abs(dy) < 0.08 ? 0 : dy; touch.stick = true;
    knob.style.left = (29 + dx * 29) + '%'; knob.style.top = (29 + dy * 29) + '%'; };
  const end = () => { sid = null; touch.stick = false; touch.sx = touch.sy = 0; knob.style.left = '29%'; knob.style.top = '29%'; };
  stick.addEventListener('pointerdown', ev => { ev.preventDefault(); initAudio(); sid = ev.pointerId; stick.setPointerCapture(sid); mv(ev); });
  stick.addEventListener('pointermove', ev => { if (ev.pointerId === sid) mv(ev); });
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  const hold = (id, k) => { const el = $(id);
    el.addEventListener('pointerdown', ev => { ev.preventDefault(); initAudio(); el.setPointerCapture(ev.pointerId); touch[k] = true; el.classList.add('on'); });
    const off = () => { touch[k] = false; el.classList.remove('on'); }; el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); };
  hold('tFire', 'fire'); hold('tHand', 'hand');
  const sp = $('tSpec');
  sp.addEventListener('pointerdown', ev => { ev.preventDefault(); sp.classList.add('on'); if (mode === 'fight') sock.emit('act', 'spec'); });
  sp.addEventListener('pointerup', () => sp.classList.remove('on')); sp.addEventListener('pointercancel', () => sp.classList.remove('on'));
}
// ===================== SILMUKKA =====================
let lastCount = -1;
function update(dt) {
  animT += dt; modeT += dt; escT -= dt; hitFlash -= dt;
  for (const m of msgs) m.d -= dt; msgs = msgs.filter(m => m.d > 0);
  for (const f of feed) f.t -= dt; feed = feed.filter(f => f.t > 0);
  if (mode === 'countdown') { const n = Math.floor(modeT); if (n !== lastCount && n < 3) { lastCount = n; sfx('count'); } } else lastCount = -1;
  let ctl = { thr: 0 };
  if (me) {
    interpCars();
    if (canDrive()) {
      ctl = physics(dt);
      const firing = (any(KEYS.fire) || touch.fire) && mode === 'fight';
      me.gunCd -= dt;
      if (firing && me.gunCd <= 0) {
        const g = GUNS[me.gun]; me.gunCd = g.cd; sfx('gun' + me.gun, 0.8);
        const o = carOri(me.pos, me.yaw), from = add(me.pos, [0, 1.3, 0]);
        for (let k = 0; k < Math.min(g.pellets, 5); k++) { const d = norm(add(o.f, [rnd(-g.spread, g.spread), rnd(-g.spread, g.spread) * 0.5, rnd(-g.spread, g.spread)]));
          const t = Math.min(g.range, W0.rayBlock(from, d, g.range)); tracers.push({ a: madd(from, o.f, 2.5), b: madd(from, d, t), col: hex(g.col), t: 0.06 }); }
      }
      sendT -= dt;
      if (sendT <= 0) {
        sendT = 1 / 25;
        sock.emit('st', { n: me.fixN, p: me.pos.map(v => Math.round(v * 100) / 100), y: Math.round(me.yaw * 1000) / 1000, s: Math.round(me.speed * 10) / 10,
          st: Math.round(me.steer * 100) / 100, v: me.vel.map(v => Math.round(v * 100) / 100), fire: firing });
      }
    } else if (me.dead) { me.speed = 0; }
    for (const c of cars.values()) if (!c.local) c.spin = (c.spin || 0) + (c.speed || 0) * dt / 0.4;
    for (const c of cars.values()) if (!c.local && !c.dead && c.hp / c.maxHp < 0.5 && chance(dt * 8 * (1 - c.hp / c.maxHp))) smoke(c, 1 - c.hp / c.maxHp);
  }
  for (const p of parts) { p.p = madd(p.p, p.v, dt); if (p.g) p.v[1] -= 9 * dt; else p.v = scl(p.v, 1 - dt * 0.6); p.t -= dt; }
  parts = parts.filter(p => p.t > 0); if (parts.length > 900) parts.splice(0, parts.length - 900);
  for (const t of tracers) t.t -= dt; tracers = tracers.filter(t => t.t > 0);
  updateCam(dt);
  engineUpdate(ctl.thr || 0);
}
function render() {
  const ctx = mainCtx;
  if (mode === 'select') { drawLobbyBg(ctx); drawPreview(); return; }
  if (mode === 'lobby' || !me || !cam.pos) { drawLobbyBg(ctx); return; }
  setView(ctx, SW, SH, cam.pos, cam.look, isTouch ? [220, 1350] : [300, 1900]);
  drawSky(ctx, SW, SH);
  buildScene();
  flushHUD(itemsA); flushHUD(itemsB);
  drawMinimap(ctx);
  drawHUD(ctx);
}
function flushHUD(list) { list.sort((a, b) => b.z - a.z); const ctx = V.ctx; ctx.lineJoin = 'round'; for (const it of list) drawItemHUD(ctx, it); }
function drawLobbyBg(ctx) {
  const a = animT * 0.05, camPos = [Math.sin(a) * 260, 90 + Math.sin(animT * 0.2) * 20, Math.cos(a) * 260];
  setView(ctx, SW, SH, camPos, sub([0, 30, 0], camPos), [200, 1400]);
  drawSky(ctx, SW, SH); buildScene(); flushHUD(itemsA); flushHUD(itemsB);
}
let lastT = performance.now(), fpsAcc = 0;
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000)); lastT = now;
  try { update(dt); render(); } catch (err) { console.error(err); }
  requestAnimationFrame(frame);
}
// ===================== KÄYNNISTYS =====================
$('bCreate').onclick = doCreate;
$('bJoin').onclick = () => { showPane('pJoin'); setStatus(''); setTimeout(() => $('codeIn').focus(), 50); };
$('bJoinGo').onclick = () => doJoin($('codeIn').value);
$('bBack').onclick = () => { sock.emit('quit'); $('code').textContent = '----'; showPane('pMenu'); setStatus(''); };
$('bBegin').onclick = () => sock.emit('begin');
$('bReady').onclick = () => { mySel.ready = !mySel.ready; beep(); sendSel(); updateSelectUI(); };
if (isTouch) $('helpKeys').style.display = 'none';
window.addEventListener('resize', () => setTimeout(resize, 60));
setupTouch(); resize(); showPane('pMenu'); connect();
requestAnimationFrame(frame);
window.__RD_DEBUG = { get mode() { return mode; }, get me() { return me; }, get cars() { return cars; }, get latest() { return latest; }, get myIdx() { return myIdx; }, keys, touch, get items() { return itemsA.length + itemsB.length; } };
})();
