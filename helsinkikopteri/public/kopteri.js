// Helsinkikopteri - yksinpelattava helikopterisimulaattori Helsingin Kruununhaassa.
// Sama ympäristö kuin Helsinkirallissa: LoD2-kaupunkimalli, maasto ja piirtomoottori (gl3d.js / sw3d.js).
// Näkymät: ulkoa (jahtikamera) ja ohjaamosta (mittaristo ja ikkunakehys).
(function () {
'use strict';
const RD = window.RD;
const { add, sub, scl, madd, dot, cross, vlen, norm, clamp, H, solid, bldH, KD, BX0, BZ0, BX1, BZ1 } = RD;
const $ = id => document.getElementById(id);
const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
const W0 = RD.buildWorld();
const lerp = (a, b, t) => a + (b - a) * t;
const D2R = Math.PI / 180;
const safeLS = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ei tallennusta */ } } };

// ===================== KANKAAT JA PIIRTÄJÄ =====================
const cv = $('c'), ctx = cv.getContext('2d');
const skyCv = $('sky'), skyCtx = skyCv.getContext('2d'), glCv = $('gl');
let DPR = 1, SW = 0, SH = 0, G3 = null, glScale = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  const maxW = G3 && G3.sw ? 1280 : (isTouch ? 1500 : 2200);
  if (window.innerWidth * DPR > maxW) DPR = maxW / window.innerWidth;
  SW = Math.round(window.innerWidth * DPR); SH = Math.round(window.innerHeight * DPR);
  cv.width = SW; cv.height = SH; skyCv.width = SW; skyCv.height = SH;
  glCv.width = Math.round(SW * glScale); glCv.height = Math.round(SH * glScale);
}
const DEBUG = /[?&]debug=1\b/.test(location.search);
let rendInfo = '', rendErr = '';
const SOFT_GL = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;
function useSoftware(reason) {
  if (G3 && G3.sw) return;
  rendErr = reason || '';
  glCv.style.display = 'none';
  try { G3 = window.HKI_SW.create(skyCv, window.HKI_MESH, KD, H, { floors: false }); } catch (e) { console.error(e); G3 = null; rendErr += ' / varapiirto: ' + e.message; }
  rendInfo = 'OHJELMALLINEN PIIRTO';
  if (SW) resize();
}
function initRenderer() {
  if (/[?&]piirto=sw\b/.test(location.search)) return useSoftware('');
  try {
    G3 = window.HKI_GL.create(glCv, window.HKI_MESH, KD, H, why => useSoftware(why), { floors: false });
    const i = G3.info(); rendInfo = 'WebGL · ' + (i.renderer || '?');
    if (SOFT_GL.test(i.renderer || '') && !/[?&]piirto=gl\b/.test(location.search)) { G3 = null; useSoftware('WebGL toimii vain ohjelmallisesti'); }
  } catch (e) { console.error(e); G3 = null; useSoftware(e.message || String(e)); }
}

// ===================== NÄKYMÄ =====================
const V = { w: 1, h: 1, cx: 0, cy: 0, F: 1, C: [0, 0, 0], r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, 1], fogNear: 300, fogFar: 1200, lwk: 1 };
const FOGC = [10, 9, 24];
function setView(pos, r, u, f, cyK) {
  V.w = SW; V.h = SH; V.cx = SW / 2; V.cy = SH * cyK; V.F = Math.max(SW * 0.46, SH * 0.78);
  V.C = pos; V.r = r; V.u = u; V.f = f; V.lwk = Math.max(1, Math.min(SW, SH) / 600);
}
const camP = p => { const d = sub(p, V.C); return [dot(d, V.r), dot(d, V.u), dot(d, V.f)]; };
const proj = p => { const c = camP(p); return c[2] > 0.3 ? [V.cx + c[0] * V.F / c[2], V.cy - c[1] * V.F / c[2], c[2]] : null; };

// 2D-taivas varapiirrolle: horisontti kallistuu kameran mukana
function drawSky2D(g) {
  const ry = V.r[1], uy = V.u[1], fy = V.f[1];
  // g(sx,sy) = (sx-cx)/F*ry + (cy-sy)/F*uy + fy; g > 0 = taivas
  const nl = Math.hypot(ry, uy);
  if (nl < 1e-3) { g.fillStyle = fy > 0 ? '#04040c' : 'rgb(' + FOGC.join(',') + ')'; g.fillRect(0, 0, SW, SH); return; }
  const nx = ry / nl, ny = -uy / nl;                       // taivaan suunta ruudulla
  const gc = fy;                                           // g ruudun keskellä
  const k = nl / V.F;                                      // g:n muutos pikseliä kohti normaalin suuntaan
  const hx = V.cx - nx * gc / k, hy = V.cy - ny * gc / k;  // horisontin piste lähinnä keskustaa
  const L = SH * 0.8;
  const gr = g.createLinearGradient(hx - nx * 2, hy - ny * 2, hx + nx * L, hy + ny * L);
  const fogS = 'rgb(' + FOGC.join(',') + ')', e = 2 / (L + 2);
  gr.addColorStop(0, fogS); gr.addColorStop(e * 0.99, fogS); gr.addColorStop(e, '#7a3a3a'); gr.addColorStop(e + (1 - e) * 0.08, '#4a1c4a'); gr.addColorStop(e + (1 - e) * 0.35, '#160c30'); gr.addColorStop(1, '#04040c');
  g.fillStyle = gr; g.fillRect(0, 0, SW, SH);
}

// ===================== MAAILMA: LASKEUTUMISPAIKAT =====================
function surf(x, z) { const g = H(x, z); if (solid(x, z)) { const b = bldH(x, z); return b > g ? b : g; } return g; }
const ROOFS = (() => {
  const h = KD.hgt, out = [];
  for (let iz = 3; iz < h.nz - 3; iz++) for (let ix = 3; ix < h.nx - 3; ix++) {
    const x = h.x0 + (ix + 0.5) * h.res, z = h.z0 + (iz + 0.5) * h.res, c = bldH(x, z);
    if (c <= 0 || c < H(x, z) + 7) continue;
    let ok = true;
    for (let dz = -2; dz <= 2 && ok; dz++) for (let dx = -2; dx <= 2 && ok; dx++) { const xx = x + dx * 2, zz = z + dz * 2; if (Math.abs(bldH(xx, zz) - c) > 0.4 || !solid(xx, zz)) ok = false; }
    if (ok) out.push([x, c, z]);
  }
  // harvennus deterministisesti: 40 m väli
  const thin = [];
  for (let i = 0; i < out.length; i++) { const p = out[(i * 7919) % out.length]; if (thin.every(q => Math.hypot(q[0] - p[0], q[2] - p[2]) > 40)) thin.push(p); }
  return thin;
})();
const HOME = (() => {
  let best = null;
  for (let z = BZ0 + 70; z < BZ1 - 70; z += 8) for (let x = BX0 + 70; x < BX1 - 70; x += 8) {
    if (solid(x, z)) continue;
    let r = 2; outer: for (; r < 26; r += 2) for (let a = 0; a < 20; a++) { const t = a / 20 * Math.PI * 2; if (solid(x + Math.cos(t) * r, z + Math.sin(t) * r)) break outer; }
    if (r < 20) continue;
    const sc = Math.hypot(x, z) - r * 4;
    if (!best || sc < best.sc) best = { x, z, sc };
  }
  if (!best) { const s = KD.spawns[0]; best = { x: s[0], z: s[1] }; }
  return [best.x, H(best.x, best.z), best.z];
})();

// kotikentältä avoimin suunta (pisin vapaa näkymä 6 m korkeudella)
const OPEN_YAW = (() => {
  let best = 0, bl = -1;
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, d = [Math.sin(a), 0, Math.cos(a)], L = W0.rayBlock([HOME[0], HOME[1] + 6, HOME[2]], d, 400); if (L > bl) { bl = L; best = a; } }
  return best;
})();
// ===================== HELIKOPTERI =====================
const G = 9.81, ROTOR_R = 5.3;
const heli = { p: [0, 0, 0], v: [0, 0, 0], R: [1, 0, 0], U: [0, 1, 0], F: [0, 0, 1], w: [0, 0, 0], lever: 0.3, thrust: 0, onGround: true,
  rotorA: 0, tailA: 0, rpm: 1, state: 'fly', crashT: 0, gTime: 0 };
let stab = safeLS.get('hk_stab') !== '0', view = safeLS.get('hk_view') === '1' ? 1 : 0, mapZoom = 1;
function resetHeli(at, yaw) {
  heli.p = [at[0], at[1], at[2]]; heli.v = [0, 0, 0]; heli.w = [0, 0, 0];
  heli.F = [Math.sin(yaw), 0, Math.cos(yaw)]; heli.U = [0, 1, 0]; heli.R = norm(cross(heli.U, heli.F));
  heli.lever = 0.3; heli.onGround = true; heli.state = 'fly'; heli.crashT = 0; heli.gTime = 0;
  parts.length = 0; cam.pos = null;
}
function rotAxis(v, k, th) {
  const c = Math.cos(th), s = Math.sin(th), kv = cross(k, v), kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}
function orthon() { heli.F = norm(heli.F); heli.R = norm(cross(heli.U, heli.F)); heli.U = cross(heli.F, heli.R); }
const toW = b => add(heli.p, add(add(scl(heli.R, b[0]), scl(heli.U, b[1])), scl(heli.F, b[2])));
const SKIDS = [[-1.0, 0, 1.6], [1.0, 0, 1.6], [-1.0, 0, -1.5], [1.0, 0, -1.5]];
const BODYPTS = [[0, 1.1, 3.4], [0, 1.8, -6.9], [0, 3.0, -6.9], [0, 2.2, 1.0], [0.85, 1.3, 0], [-0.85, 1.3, 0]];

// ohjaimet: cp syklinen eteen (+ = nokka alas), cr syklinen oikealle, pd poljin oikealle, col kollektiivi (-1..1)
const ctl = { cp: 0, cr: 0, pd: 0, col: 0 };
function physics(dt) {
  const h = heli;
  if (h.state !== 'fly') { h.v[1] -= G * dt; h.v = scl(h.v, Math.exp(-dt * 0.3)); h.p = madd(h.p, h.v, dt); const s = surf(h.p[0], h.p[2]); if (h.p[1] < s) { h.p[1] = s; h.v = [0, 0, 0]; } return; }
  const pitchDown = Math.asin(clamp(-h.F[1], -1, 1)), rollRight = Math.asin(clamp(-h.R[1], -1, 1));
  const hs = Math.hypot(h.v[0], h.v[2]);
  const agl = h.p[1] - surf(h.p[0], h.p[2]);
  let tx, ty, tz;
  if (stab) {
    const MAXT = 28 * D2R;
    tx = clamp(3.0 * (ctl.cp * MAXT - pitchDown), -1.4, 1.4);
    tz = -clamp(3.0 * (ctl.cr * MAXT - rollRight), -1.6, 1.6);
    // koordinoitu kaarto: kallistus kääntää myös nokkaa vauhdissa
    ty = ctl.pd * 1.1 + rollRight * clamp(hs / 25, 0, 1) * 0.9;
  } else {
    tx = ctl.cp * 1.2; tz = -ctl.cr * 1.4; ty = ctl.pd * 1.2;
  }
  const kr = Math.min(1, dt * (stab ? 6 : 3));
  h.w[0] += (tx - h.w[0]) * kr; h.w[1] += (ty - h.w[1]) * kr; h.w[2] += (tz - h.w[2]) * kr;
  if (h.onGround) {                                                        // maassa: ei kallistu, vain kääntyy hitaasti
    h.w[0] = -pitchDown * 2; h.w[2] = rollRight * 2; h.w[1] *= ctl.col > 0 || h.lever > 0.45 ? 1 : 0.3;
  }
  const ax = add(add(scl(h.R, h.w[0]), scl(h.U, h.w[1])), scl(h.F, h.w[2])), am = vlen(ax);
  if (am > 1e-6) { const k = scl(ax, 1 / am); h.F = rotAxis(h.F, k, am * dt); h.U = rotAxis(h.U, k, am * dt); orthon(); }
  // nostovoima
  const ge = 1 + 0.12 * clamp(1 - agl / 9, 0, 1);
  let T;
  if (stab) {
    let vyT = ctl.col * 9;
    // vakain rajoittaa vajoamaa lähellä pintaa, jotta laskeutuminen onnistuu pitämällä S pohjassa
    if (vyT < 0) vyT = Math.max(vyT, -(1.3 + Math.max(0, agl) * 0.42));
    T = (G + 2.6 * (vyT - h.v[1])) / Math.max(0.45, h.U[1]);
    if (h.onGround && ctl.col <= 0.05) T = G * 0.55;
    T = clamp(T, 0, 2.2 * G);
    h.lever = clamp(T / (2.0 * G * ge), 0, 1);
  } else {
    h.lever = clamp(h.lever + ctl.col * 0.45 * dt, 0, 1);
    T = h.lever * 2.0 * G * ge;
  }
  h.thrust = T;
  const acc = scl(h.U, T);
  acc[1] -= G;
  const sp = vlen(h.v);
  for (let k = 0; k < 3; k++) acc[k] -= h.v[k] * (0.05 + 0.0012 * sp) + (k === 1 ? h.v[1] * 0.08 : 0);
  h.v = madd(h.v, acc, dt);
  h.p = madd(h.p, h.v, dt);
  // alueen rajat: pehmeä työntö takaisin, katto 900 m
  const M = 40;
  if (h.p[0] < BX0 + M) h.v[0] += (BX0 + M - h.p[0]) * dt * 0.8; if (h.p[0] > BX1 - M) h.v[0] -= (h.p[0] - BX1 + M) * dt * 0.8;
  if (h.p[2] < BZ0 + M) h.v[2] += (BZ0 + M - h.p[2]) * dt * 0.8; if (h.p[2] > BZ1 - M) h.v[2] -= (h.p[2] - BZ1 + M) * dt * 0.8;
  if (h.p[1] > 900) { h.p[1] = 900; h.v[1] = Math.min(0, h.v[1]); }
  collide(dt);
}
function collide(dt) {
  const h = heli;
  // roottori ja runko: osuma rakennukseen tai maahan = tuho
  const hub = toW([0, 2.8, 0]);
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2, q = madd(madd(hub, h.R, Math.cos(a) * ROTOR_R), h.F, Math.sin(a) * ROTOR_R);
    if (q[1] < surf(q[0], q[2]) - 0.05) return crash('ROOTTORI OSUI ' + (solid(q[0], q[2]) ? 'RAKENNUKSEEN' : 'MAAHAN'));
  }
  for (const b of BODYPTS) { const q = toW(b); if (q[1] < surf(q[0], q[2]) - 0.1) return crash('RUNKO OSUI ' + (solid(q[0], q[2]) ? 'RAKENNUKSEEN' : 'MAAHAN')); }
  // jalakset
  let pen = 0, sy = -1e9;
  for (const b of SKIDS) { const q = toW(b), s = surf(q[0], q[2]); if (s - q[1] > pen) pen = s - q[1]; sy = Math.max(sy, s); }
  if (pen > 0) {
    const hs = Math.hypot(h.v[0], h.v[2]);
    if (!h.onGround && (h.v[1] < -4.2 || hs > 7 || h.U[1] < Math.cos(22 * D2R))) return crash(h.v[1] < -4.2 ? 'LIIAN KOVA LASKEUTUMINEN' : (hs > 7 ? 'LIIAN SUURI VAAKANOPEUS' : 'KOPTERI KALLISTUI'));
    if (!h.onGround) { touch = { t: 0.6, vy: -h.v[1] }; beep(220, 0.08, 0.15); }
    h.p[1] += pen; h.v[1] = Math.max(0, h.v[1]);
    const f = Math.exp(-dt * 5); h.v[0] *= f; h.v[2] *= f;
    h.onGround = true;
  } else if (h.onGround) {
    // irtoaminen vasta kun jalakset ovat selvästi ilmassa
    let clear = 1e9; for (const b of SKIDS) { const q = toW(b); clear = Math.min(clear, q[1] - surf(q[0], q[2])); }
    if (clear > 0.15) h.onGround = false;
  }
}
let touch = null;
function crash(why) {
  const h = heli; if (h.state !== 'fly') return;
  h.state = 'crash'; h.crashT = 0; crashWhy = why;
  for (let i = 0; i < 90; i++) parts.push({ p: add(h.p, [rnd(-2, 2), rnd(0.5, 3), rnd(-2, 2)]), v: add(scl(h.v, 0.3), [rnd(-9, 9), rnd(2, 14), rnd(-9, 9)]), t: rnd(0.8, 2.4), col: Math.random() < 0.5 ? [255, 150, 50] : [255, 220, 120], s: rnd(0.3, 0.9) });
  boom();
}
let crashWhy = '';
const rnd = (a, b) => a + Math.random() * (b - a);
let parts = [];

// ===================== TEHTÄVÄT =====================
// mode: 'free' | 'route' | 'roof'
let mode = 'menu', task = null, paused = false;
function rngSeed(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function maxRoofAround(x, z, r) { let m = H(x, z); for (let dz = -r; dz <= r; dz += 4) for (let dx = -r; dx <= r; dx += 4) m = Math.max(m, surf(x + dx, z + dz)); return m; }
// matala portti vain, jos kadulla on tilaa roottorille (vapaata 9 m säteellä portin korkeudella)
function streetClear(x, z, y) { for (let r = 3; r <= 9; r += 3) for (let a = 0; a < 16; a++) { const t = a / 16 * Math.PI * 2, xx = x + Math.cos(t) * r, zz = z + Math.sin(t) * r; if (solid(xx, zz) && bldH(xx, zz) > y - 7) return false; } return true; }
function makeRoute() {
  const rand = rngSeed((Date.now() / 1000) | 0), rings = [];
  let prev = [HOME[0], HOME[1] + 15, HOME[2]];
  const SP = KD.spawns;
  for (let i = 0; i < 10; i++) {
    let pick = null;
    for (let tries = 0; tries < 200 && !pick; tries++) {
      const s = SP[(rand() * SP.length) | 0], d = Math.hypot(s[0] - prev[0], s[1] - prev[2]);
      if (d < 110 || d > 260) continue;
      if (rings.some(r => Math.hypot(r.c[0] - s[0], r.c[2] - s[1]) < 90)) continue;
      pick = s;
    }
    if (!pick) { const a = rand() * 6.28; pick = [clamp(prev[0] + Math.cos(a) * 160, BX0 + 90, BX1 - 90), clamp(prev[2] + Math.sin(a) * 160, BZ0 + 90, BZ1 - 90)]; }
    const x = pick[0], z = pick[1];
    // joka toinen portti kadun yllä matalalla, joka toinen kattojen yläpuolella
    const low = i % 2 === 0 && !solid(x, z) && streetClear(x, z, H(x, z) + 11);
    const y = low ? H(x, z) + 11 : maxRoofAround(x, z, 16) + 16;
    const c = [x, y, z], n = norm([x - prev[0], 0, z - prev[2]]);
    rings.push({ c, n, r: low ? 9 : 11, low });
    prev = c;
  }
  return rings;
}
function makeRoofTask() {
  const rand = rngSeed((Date.now() / 1000) | 0), list = [];
  let prev = HOME;
  for (let i = 0; i < 5; i++) {
    let best = null;
    for (let tries = 0; tries < 300; tries++) {
      const p = ROOFS[(rand() * ROOFS.length) | 0], d = Math.hypot(p[0] - prev[0], p[2] - prev[2]);
      if (d < 120 || d > 330 || list.includes(p)) continue;
      best = p; break;
    }
    if (!best) best = ROOFS[(rand() * ROOFS.length) | 0];
    list.push(best); prev = best;
  }
  return list;
}
function startMode(m) {
  mode = m; paused = false;
  resetHeli([HOME[0], HOME[1], HOME[2]], OPEN_YAW);
  task = { t: 0, idx: 0, done: false, msg: '', msgT: 0 };
  if (m === 'route') { task.rings = makeRoute(); task.msg = 'LENNÄ PORTTIEN LÄPI'; const c = task.rings[0].c; heli.F = norm([c[0] - HOME[0], 0, c[2] - HOME[2]]); orthon(); }
  if (m === 'roof') { task.roofs = makeRoofTask(); task.msg = 'LASKEUDU MERKITYLLE KATOLLE'; }
  if (m === 'free') task.msg = 'VAPAA LENTO · LASKEUTUMISPAIKAT MERKITTY H:LLA';
  task.msgT = 4; task.home = false; task.started = false; task.landT = 0;
  $('menu').hidden = true; updateTouch();
}
function fmtT(t) { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); }
function target() {
  if (!task) return null;
  if (mode === 'route') return task.home ? { p: HOME, kind: 'pad' } : (task.rings[task.idx] ? { p: task.rings[task.idx].c, kind: 'ring' } : null);
  if (mode === 'roof') return task.home ? { p: HOME, kind: 'pad' } : (task.roofs[task.idx] ? { p: task.roofs[task.idx], kind: 'pad' } : null);
  return null;
}
let lastP = null;
function updateTask(dt) {
  if (!task || task.done) return;
  const h = heli;
  if (!task.started && !h.onGround) task.started = true;
  if (task.started && h.state === 'fly') task.t += dt;
  if (task.msgT > 0) task.msgT -= dt;
  if (h.state !== 'fly') { lastP = null; return; }
  if (mode === 'route' && !task.home) {
    const r = task.rings[task.idx];
    if (r && lastP) {
      const s0 = dot(sub(lastP, r.c), r.n), s1 = dot(sub(h.p, r.c), r.n);
      if (s0 < 0 && s1 >= 0) {
        const k = s0 / (s0 - s1), hit = add(lastP, scl(sub(h.p, lastP), k)), off = sub(hit, r.c);
        const lat = vlen(sub(off, scl(r.n, dot(off, r.n))));
        if (lat < r.r) { task.idx++; beep(880, 0.12, 0.2); task.msg = 'PORTTI ' + task.idx + ' / ' + task.rings.length; task.msgT = 1.5; if (task.idx >= task.rings.length) { task.home = true; task.msg = 'LASKEUDU KOTIKENTÄLLE'; task.msgT = 3; } }
      }
    }
  }
  const landedAt = (p, rad) => h.onGround && Math.hypot(h.p[0] - p[0], h.p[2] - p[2]) < rad && Math.abs(h.p[1] - p[1]) < 1.5;
  if (mode === 'roof' && !task.home) {
    const p = task.roofs[task.idx];
    if (p && landedAt(p, 6)) { task.landT += dt; if (task.landT > 1.5) { task.idx++; task.landT = 0; beep(880, 0.15, 0.2); task.msg = 'KATTO ' + task.idx + ' / ' + task.roofs.length; task.msgT = 1.8; if (task.idx >= task.roofs.length) { task.home = true; task.msg = 'PALAA KOTIKENTÄLLE'; task.msgT = 3; } } }
    else task.landT = 0;
  }
  if (task.home && landedAt(HOME, 12)) {
    task.landT += dt;
    if (task.landT > 1.2) {
      task.done = true;
      const key = 'hk_rec_' + mode, old = parseFloat(safeLS.get(key)) || 0, rec = !old || task.t < old;
      if (rec) safeLS.set(key, task.t.toFixed(1));
      task.msg = 'VALMIS! AIKA ' + fmtT(task.t) + (rec ? ' · UUSI ENNÄTYS' : ' · ENNÄTYS ' + fmtT(old)); task.msgT = 99;
      beep(660, 0.15, 0.2); setTimeout(() => beep(990, 0.25, 0.2), 160);
    }
  }
  lastP = h.p.slice();
}

// ===================== KAMERA =====================
const cam = { pos: null, look: [0, 0, 1] };
function updateCam(dt) {
  const h = heli;
  let fh = [h.F[0], 0, h.F[2]]; if (vlen(fh) < 0.2) fh = cam.fh || [0, 0, 1]; fh = norm(fh); cam.fh = fh;
  const tgt = add(h.p, [0, 1.8, 0]);
  const want = add(madd(tgt, fh, -17), [0, 5.5, 0]);
  if (!cam.pos) cam.pos = want.slice();
  const k = Math.min(1, dt * 3.2);
  cam.pos = add(cam.pos, scl(sub(want, cam.pos), k));
  // kamera ei rakennusten sisään: säde kopterista kameraan
  const d = sub(cam.pos, tgt), L = vlen(d);
  if (L > 0.5) { const t = W0.rayBlock(tgt, scl(d, 1 / L), L); if (t < L) cam.pos = madd(tgt, d, Math.max(0.15, (t - 1) / L)); }
  const s = surf(cam.pos[0], cam.pos[2]); if (cam.pos[1] < s + 1.2) cam.pos[1] = s + 1.2;
  cam.look = sub(add(tgt, scl(fh, 5)), cam.pos);
}
function cameraBasis() {
  const h = heli;
  if (view === 1) {
    const a = 7 * D2R, f = norm(add(scl(h.F, Math.cos(a)), scl(h.U, -Math.sin(a)))), u = norm(add(scl(h.U, Math.cos(a)), scl(h.F, Math.sin(a))));
    return { pos: toW([0.38, 1.62, 1.75]), r: h.R, u, f, cy: 0.40 };
  }
  const f = norm(cam.look); let r = cross([0, 1, 0], f); if (vlen(r) < 1e-4) r = [1, 0, 0]; r = norm(r);
  return { pos: cam.pos, r, u: cross(f, r), f, cy: 0.5 };
}

// ===================== MALLI =====================
const ST = [[3.4, 0.25, 0.95, 1.35], [2.6, 0.7, 0.55, 1.95], [1.2, 0.85, 0.45, 2.15], [-1.0, 0.85, 0.5, 2.15], [-2.0, 0.45, 1.1, 2.0], [-6.6, 0.12, 1.6, 1.85]];
const HULL = (() => {
  const q = s => [[-s[1], s[2], s[0]], [s[1], s[2], s[0]], [s[1], s[3], s[0]], [-s[1], s[3], s[0]]];
  const faces = [];
  for (let i = 0; i < ST.length - 1; i++) {
    const a = q(ST[i]), b = q(ST[i + 1]);
    for (let e = 0; e < 4; e++) {
      faces.push({ pts: [a[e], a[(e + 1) % 4], b[(e + 1) % 4], b[e]], glass: i === 0 || (i === 1 && e !== 0) });
    }
  }
  faces.push({ pts: q(ST[0]), glass: true });
  faces.push({ pts: q(ST[ST.length - 1]).reverse(), glass: false });
  // moottorikotelo
  const box = (x0, x1, y0, y1, z0, z1) => { const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    return [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]].map(f => ({ pts: f.map(i => P[i]), glass: false })); };
  faces.push(...box(-0.5, 0.5, 2.15, 2.5, -1.3, 0.8));
  faces.push({ pts: [[0, 1.75, -6.0], [0, 3.05, -6.75], [0, 3.05, -7.05], [0, 1.6, -6.6]], glass: false });
  faces.push({ pts: [[-1.1, 1.72, -5.2], [1.1, 1.72, -5.2], [1.1, 1.72, -5.6], [-1.1, 1.72, -5.6]], glass: false });
  return faces;
})();
const SKIDLINES = (() => {
  const L = [];
  for (const x of [-1.0, 1.0]) {
    L.push([[x, 0, -1.6], [x, 0, 1.8]], [[x, 0, 1.8], [x, 0.3, 2.25]]);
    for (const z of [1.0, -0.9]) L.push([[x, 0, z], [x * 0.72, 0.55, z]]);
  }
  return L;
})();
const COL = { edge: [79, 214, 255], fill: [10, 22, 34], glass: [52, 78, 104], rotor: [170, 190, 210], rotorF: [26, 32, 40], dead: [70, 70, 80] };
function drawHeli(cockpit) {
  const h = heli, dead = h.state !== 'fly', edge = dead ? COL.dead : COL.edge;
  if (!cockpit) {
    for (const f of HULL) {
      const w = f.pts.map(toW);
      if (f.glass && !dead) G3.glass(w, COL.glass, 150); else G3.poly(w, dead ? [16, 16, 18] : COL.fill);
      for (let i = 0; i < w.length; i++) G3.line(w[i], w[(i + 1) % w.length], edge);
    }
    for (const l of SKIDLINES) G3.line(toW(l[0]), toW(l[1]), edge);
    G3.line(toW([0, 2.5, 0]), toW([0, 2.8, 0]), edge);
    // pyrstöroottori
    const tc = [0.2, 2.45, -6.8];
    for (let b = 0; b < 2; b++) { const a = h.tailA + b * Math.PI; G3.line(toW([tc[0], tc[1] + Math.cos(a) * 0.8, tc[2] + Math.sin(a) * 0.8]), toW([tc[0], tc[1] - Math.cos(a) * 0.8, tc[2] - Math.sin(a) * 0.8]), COL.rotor); }
  }
  // pääroottori: 4 lapaa ja läpikuultava kiekko
  const hub = [0, 2.85, 0];
  if (!dead) {
    for (let b = 0; b < 4; b++) {
      const a = h.rotorA + b * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a), wx = -sa * 0.16, wz = ca * 0.16;
      const tip = [ca * ROTOR_R, hub[1] - 0.12, sa * ROTOR_R], root = [ca * 0.4, hub[1], sa * 0.4];
      const pts = [[root[0] + wx, root[1], root[2] + wz], [tip[0] + wx, tip[1], tip[2] + wz], [tip[0] - wx, tip[1], tip[2] - wz], [root[0] - wx, root[1], root[2] - wz]].map(toW);
      G3.poly(pts, COL.rotorF); G3.line(pts[0], pts[1], COL.rotor); G3.line(pts[2], pts[3], COL.rotor); G3.line(pts[1], pts[2], COL.rotor);
    }
    const disc = []; for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; disc.push(toW([Math.cos(a) * ROTOR_R, hub[1] - 0.1, Math.sin(a) * ROTOR_R])); }
    G3.glass(disc, [120, 150, 180], cockpit ? 18 : 28);
    if (!cockpit) for (let i = 0; i < 24; i += 2) G3.line(disc[i], disc[(i + 1) % 24], [60, 90, 120]);
  }
}
// laskeutumispaikka: ympyrä ja H
function drawPad(p, col, r, pulse) {
  const y = p[1] + 0.08, pts = [];
  for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; pts.push([p[0] + Math.cos(a) * r, y, p[2] + Math.sin(a) * r]); }
  for (let i = 0; i < 20; i++) G3.line(pts[i], pts[(i + 1) % 20], col);
  const s = r * 0.42;
  G3.line([p[0] - s, y, p[2] - s], [p[0] - s, y, p[2] + s], col); G3.line([p[0] + s, y, p[2] - s], [p[0] + s, y, p[2] + s], col); G3.line([p[0] - s, y, p[2]], [p[0] + s, y, p[2]], col);
  if (pulse) { const k = 1 + 0.3 * Math.sin(animT * 5); G3.line([p[0], y, p[2]], [p[0], y + 40 * k, p[2]], col); }
}
function drawRing(r, col, active) {
  const n = r.n, side = norm(cross([0, 1, 0], n)), up = [0, 1, 0], pts = [];
  for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; pts.push(add(r.c, add(scl(side, Math.cos(a) * r.r), scl(up, Math.sin(a) * r.r)))); }
  for (let i = 0; i < 28; i++) G3.line(pts[i], pts[(i + 1) % 28], col);
  if (active) { const pts2 = pts.map(p => add(r.c, scl(sub(p, r.c), 0.86))); for (let i = 0; i < 28; i += 2) G3.line(pts2[i], pts2[(i + 1) % 28], col); }
}
function buildScene(cockpit) {
  G3.clear();
  // laskeutumispaikat
  drawPad(HOME, [255, 210, 80], 11, task && task.home);
  if (mode === 'free') for (const p of ROOFS) if (Math.hypot(p[0] - heli.p[0], p[2] - heli.p[2]) < 500) drawPad(p, [120, 200, 140], 5.5, false);
  if (mode === 'roof' && task) task.roofs.forEach((p, i) => { if (i >= task.idx) drawPad(p, i === task.idx && !task.home ? [255, 90, 209] : [110, 70, 110], 5.5, i === task.idx && !task.home); });
  if (mode === 'route' && task) task.rings.forEach((r, i) => { if (i >= task.idx) drawRing(r, i === task.idx ? [255, 184, 77] : (i === task.idx + 1 ? [150, 110, 60] : [70, 60, 50]), i === task.idx); });
  drawHeli(cockpit);
  for (const p of parts) G3.point(p.p, p.col, p.s, p.s > 0.7);
}

// ===================== HUD =====================
let MAPIMG = null;
function buildMap() {
  const o = KD.occ, c = document.createElement('canvas'); c.width = o.nx; c.height = o.nz;
  const g = c.getContext('2d'), im = g.createImageData(o.nx, o.nz);
  for (let iz = 0; iz < o.nz; iz++) for (let ix = 0; ix < o.nx; ix++) {
    const k = (iz * o.nx + ix) * 4, s = RD.solidCell(ix, iz);
    if (s) { const hh = bldH(o.x0 + ix, o.z0 + iz) - H(o.x0 + ix, o.z0 + iz), t = clamp(hh / 30, 0, 1); im.data[k] = 34 + 30 * t; im.data[k + 1] = 64 + 50 * t; im.data[k + 2] = 106 + 60 * t; }
    else { im.data[k] = 18; im.data[k + 1] = 20; im.data[k + 2] = 30; }
    im.data[k + 3] = 255;
  }
  g.putImageData(im, 0, 0); MAPIMG = c;
}
function heading() { return Math.atan2(heli.F[0], heli.F[2]); }
function drawMinimap(g) {
  const k = V.lwk, R = Math.round(Math.min(SW, SH) * 0.16), cx = SW - R - 14 * k, cy = R + 14 * k;
  const range = [140, 260, 520][mapZoom], sc = R / range, yaw = heading();
  const Fx = Math.sin(yaw), Fz = Math.cos(yaw), Rx = Math.cos(yaw), Rz = -Math.sin(yaw);
  const P = (x, z) => { const dx = x - heli.p[0], dz = z - heli.p[2]; return [cx + (dx * Rx + dz * Rz) * sc, cy - (dx * Fx + dz * Fz) * sc]; };
  g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.closePath(); g.fillStyle = '#0c0d18'; g.fill(); g.clip();
  const o = KD.occ, a = Rx * sc, b = -Fx * sc, c = Rz * sc, d = -Fz * sc;
  const ox = o.x0 - heli.p[0], oz = o.z0 - heli.p[2];
  g.setTransform(a, b, c, d, cx + a * ox + c * oz, cy + b * ox + d * oz); g.imageSmoothingEnabled = true;
  g.drawImage(MAPIMG, 0, 0); g.setTransform(1, 0, 0, 1, 0, 0);
  const dot2 = (p, col, rr) => { const q = P(p[0], p[2]); g.fillStyle = col; g.beginPath(); g.arc(q[0], q[1], rr * k, 0, 7); g.fill(); };
  dot2(HOME, '#ffd250', 4);
  if (mode === 'free') for (const p of ROOFS) dot2(p, 'rgba(120,200,140,0.8)', 1.6);
  if (mode === 'roof' && task) task.roofs.forEach((p, i) => { if (i >= task.idx) dot2(p, i === task.idx ? '#ff5ad1' : '#6e466e', i === task.idx ? 4 : 2.5); });
  if (mode === 'route' && task) task.rings.forEach((r, i) => { if (i >= task.idx) dot2(r.c, i === task.idx ? '#ffb84d' : '#6e5a3a', i === task.idx ? 4 : 2.5); });
  g.restore();
  g.strokeStyle = '#4fd6ff'; g.lineWidth = 2 * k; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
  // oma kopteri
  g.fillStyle = '#e8f6ff'; g.beginPath(); g.moveTo(cx, cy - 7 * k); g.lineTo(cx + 5 * k, cy + 5 * k); g.lineTo(cx, cy + 2 * k); g.lineTo(cx - 5 * k, cy + 5 * k); g.closePath(); g.fill();
  // pohjoinen
  const nq = [cx + (0 * Rx + 1 * Rz) * (R - 9 * k), cy - (0 * Fx + 1 * Fz) * (R - 9 * k)];
  g.fillStyle = '#ff6060'; g.font = `${Math.round(11 * k)}px "Share Tech Mono", monospace`; g.textAlign = 'center'; g.fillText('N', nq[0], nq[1] + 4 * k);
  g.fillStyle = '#6b7390'; g.fillText('KARTTA ' + range * 2 + ' M' + (isTouch ? '' : ' (M)'), cx, cy + R + 14 * k);
}
function txt(g, s, x, y, size, col, align) { g.font = `${Math.round(size * V.lwk)}px "Share Tech Mono", monospace`; g.fillStyle = col; g.textAlign = align || 'left'; g.fillText(s, x, y); }
function flightData() {
  const h = heli, hs = Math.hypot(h.v[0], h.v[2]), agl = h.p[1] - surf(h.p[0], h.p[2]);
  let hdg = heading() / D2R; if (hdg < 0) hdg += 360;
  return { kmh: hs * 3.6, agl, alt: h.p[1], vs: h.v[1], hdg, pitch: Math.asin(clamp(-h.F[1], -1, 1)) / D2R, roll: Math.asin(clamp(-h.R[1], -1, 1)) / D2R, lever: h.lever, thr: h.thrust / G };
}
function targetInfo() {
  const t = target(); if (!t) return null;
  const d = sub(t.p, heli.p), dist = Math.hypot(d[0], d[2]);
  let brg = Math.atan2(d[0], d[2]) - heading(); while (brg > Math.PI) brg -= 2 * Math.PI; while (brg < -Math.PI) brg += 2 * Math.PI;
  return { dist, brg, dy: d[1], kind: t.kind, p: t.p };
}
function drawTargetMarker(g) {
  const ti = targetInfo(); if (!ti) return;
  const k = V.lwk, q = proj(ti.kind === 'ring' ? ti.p : add(ti.p, [0, 2, 0]));
  const col = mode === 'route' && !task.home ? '#ffb84d' : (mode === 'roof' && !task.home ? '#ff5ad1' : '#ffd250');
  if (q && q[0] > 0 && q[0] < SW && q[1] > 0 && q[1] < SH) {
    g.strokeStyle = col; g.lineWidth = 2 * k; const s = 12 * k;
    g.beginPath(); g.moveTo(q[0] - s, q[1]); g.lineTo(q[0], q[1] - s); g.lineTo(q[0] + s, q[1]); g.lineTo(q[0], q[1] + s); g.closePath(); g.stroke();
    txt(g, Math.round(ti.dist) + ' M', q[0], q[1] + s + 14 * k, 11, col, 'center');
  } else {
    // nuoli ruudun reunalla suuntaan
    const a = ti.brg, r = Math.min(SW, SH) * 0.36, ax = V.cx + Math.sin(a) * r, ay = SH * 0.5 - Math.cos(a) * r;
    g.save(); g.translate(ax, ay); g.rotate(a); g.fillStyle = col; g.beginPath(); g.moveTo(0, -14 * k); g.lineTo(10 * k, 8 * k); g.lineTo(-10 * k, 8 * k); g.closePath(); g.fill(); g.restore();
    txt(g, Math.round(ti.dist) + ' M', ax, ay + 24 * k, 11, col, 'center');
  }
}
function drawTaskHUD(g) {
  const k = V.lwk, x = 14 * k; let y = isTouch ? 60 * DPR + 14 * k : 22 * k;
  txt(g, mode === 'free' ? 'VAPAA LENTO' : (mode === 'route' ? 'REITTILENTO' : 'KATTOLASKEUTUMISET'), x, y, 13, '#4fd6ff'); y += 17 * k;
  txt(g, (stab ? 'VAKAIN PÄÄLLÄ' : 'VAKAIN POIS · KÄSIOHJAUS') + ' · ' + (view ? 'OHJAAMO' : 'ULKONÄKYMÄ'), x, y, 11, stab ? '#9dff9d' : '#ffd060'); y += 16 * k;
  if (task && mode !== 'free') {
    const tot = mode === 'route' ? task.rings.length : task.roofs.length;
    txt(g, (mode === 'route' ? 'PORTIT ' : 'KATOT ') + Math.min(task.idx, tot) + ' / ' + tot + ' · AIKA ' + fmtT(task.t), x, y, 12, '#e8ecf5'); y += 16 * k;
    const ti = targetInfo(); if (ti && !task.done) txt(g, (task.home ? 'KOTIKENTTÄ ' : (mode === 'route' ? 'SEURAAVA PORTTI ' : 'SEURAAVA KATTO ')) + Math.round(ti.dist) + ' M · ' + (ti.dy > 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(ti.dy)) + ' M', x, y, 11, '#9aa6c8');
  }
  if (task && task.msgT > 0) {
    const a = clamp(task.msgT, 0, 1);
    g.globalAlpha = a; txt(g, task.msg, SW / 2, SH * (view ? 0.16 : 0.2), 22, task.done ? '#9dff9d' : '#ffd060', 'center'); g.globalAlpha = 1;
    if (task.done) txt(g, 'R = UUSI YRITYS · ESC = VALIKKO', SW / 2, SH * (view ? 0.16 : 0.2) + 26 * k, 12, '#c8d0e0', 'center');
  }
  if (mode === 'roof' && task && task.landT > 0 && !task.done) txt(g, 'PYSY PAIKALLASI ' + (1.5 - task.landT).toFixed(1), SW / 2, SH * 0.3, 16, '#ff5ad1', 'center');
  const h = heli, M = 40;
  if (h.p[0] < BX0 + M + 10 || h.p[0] > BX1 - M - 10 || h.p[2] < BZ0 + M + 10 || h.p[2] > BZ1 - M - 10) txt(g, 'ALUEEN RAJA', SW / 2, SH * 0.27, 16, '#ff6060', 'center');
}
// ulkonäkymän lentotiedot
function drawFlightHUD(g) {
  const k = V.lwk, d = flightData(), pad = 16 * k, y0 = SH - pad - (isTouch ? SH * 0.36 : 0);
  if (isTouch) {
    txt(g, Math.round(d.kmh) + ' KM/H', SW / 2 - 70 * k, SH - pad, 16, '#e8ecf5', 'center');
    txt(g, Math.round(d.agl) + ' M', SW / 2 + 70 * k, SH - pad, 16, '#e8ecf5', 'center');
    txt(g, (d.vs >= 0 ? '+' : '') + d.vs.toFixed(1) + ' M/S', SW / 2 + 70 * k, SH - pad - 18 * k, 11, '#9aa6c8', 'center');
    txt(g, 'SUUNTA ' + String(Math.round(d.hdg) % 360).padStart(3, '0') + '°', SW / 2 - 70 * k, SH - pad - 18 * k, 11, '#9aa6c8', 'center');
  } else {
    g.font = `${Math.round(30 * k)}px Orbitron, sans-serif`; g.fillStyle = '#e8ecf5'; g.textAlign = 'left';
    g.fillText(Math.round(d.kmh), pad, y0); txt(g, 'KM/H', pad + 70 * k, y0, 11, '#6b7390');
    g.font = `${Math.round(30 * k)}px Orbitron, sans-serif`; g.fillStyle = '#e8ecf5'; g.fillText(Math.round(d.agl), pad + 140 * k, y0); txt(g, 'M MAASTA', pad + 210 * k, y0, 11, '#6b7390');
    txt(g, 'NOUSU ' + (d.vs >= 0 ? '+' : '') + d.vs.toFixed(1) + ' M/S · SUUNTA ' + String(Math.round(d.hdg) % 360).padStart(3, '0') + '° · KORKEUS ' + Math.round(d.alt) + ' M MPY', pad, y0 - 38 * k, 11, '#9aa6c8');
    // kollektiivipalkki
    const bx = pad, by = y0 - 64 * k, bw = 150 * k;
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(bx, by, bw, 6 * k); g.fillStyle = d.lever > 0.85 ? '#ff6060' : '#4fd6ff'; g.fillRect(bx, by, bw * d.lever, 6 * k);
    txt(g, 'KOLLEKTIIVI ' + Math.round(d.lever * 100) + ' %', bx + bw + 8 * k, by + 7 * k, 10, '#6b7390');
  }
  // pieni keinohorisontti alhaalla keskellä
  if (!isTouch) attitude(g, SW / 2, SH - 70 * k, 52 * k, d);
}
function attitude(g, x, y, r, d) {
  g.save(); g.beginPath(); g.arc(x, y, r, 0, 7); g.clip();
  g.translate(x, y); g.rotate(-d.roll * D2R);
  const py = -d.pitch * r / 30;                      // nokka alas -> horisontti ylös; 30° = säde
  g.fillStyle = '#123a5c'; g.fillRect(-r * 2, -r * 3 + py, r * 4, r * 3);
  g.fillStyle = '#3a2614'; g.fillRect(-r * 2, py, r * 4, r * 3);
  g.strokeStyle = '#e8ecf5'; g.lineWidth = Math.max(1, r / 40); g.beginPath(); g.moveTo(-r * 2, py); g.lineTo(r * 2, py); g.stroke();
  g.lineWidth = Math.max(1, r / 70);
  for (let a = -20; a <= 20; a += 10) { if (!a) continue; const yy = py - a * r / 30, w = r * (a % 20 ? 0.18 : 0.32); g.beginPath(); g.moveTo(-w, yy); g.lineTo(w, yy); g.stroke(); }
  g.restore();
  g.strokeStyle = '#ffd060'; g.lineWidth = Math.max(2, r / 25);
  g.beginPath(); g.moveTo(x - r * 0.55, y); g.lineTo(x - r * 0.18, y); g.lineTo(x - r * 0.08, y + r * 0.1); g.moveTo(x + r * 0.55, y); g.lineTo(x + r * 0.18, y); g.lineTo(x + r * 0.08, y + r * 0.1); g.stroke();
  g.strokeStyle = '#4fd6ff'; g.lineWidth = Math.max(1, r / 30); g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
}
// pyöreä mittari: arvo 0..1 kaarella, asteikkoviivat
function gauge(g, x, y, r, label, value, frac, ticks, warn) {
  g.fillStyle = '#05070d'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  g.strokeStyle = '#2e4660'; g.lineWidth = Math.max(1, r / 22); g.stroke();
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  g.strokeStyle = '#6b8aa6'; g.lineWidth = Math.max(1, r / 50);
  for (let i = 0; i <= ticks; i++) { const a = a0 + (a1 - a0) * i / ticks; g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78); g.lineTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92); g.stroke(); }
  const a = a0 + (a1 - a0) * clamp(frac, 0, 1);
  g.strokeStyle = warn ? '#ff6060' : '#ffd060'; g.lineWidth = Math.max(2, r / 14);
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8); g.stroke();
  g.font = `${Math.round(r * 0.22)}px "Share Tech Mono", monospace`; g.textAlign = 'center'; g.fillStyle = '#6b8aa6'; g.fillText(label, x, y + r * 0.45);
  g.font = `${Math.round(r * 0.3)}px "Share Tech Mono", monospace`; g.fillStyle = '#e8ecf5'; g.fillText(value, x, y + r * 0.78);
}
function compass(g, x, y, r, hdg) {
  g.fillStyle = '#05070d'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.strokeStyle = '#2e4660'; g.lineWidth = Math.max(1, r / 22); g.stroke();
  g.save(); g.translate(x, y); g.rotate(-hdg * D2R);
  g.font = `${Math.round(r * 0.26)}px "Share Tech Mono", monospace`; g.textAlign = 'center';
  const L = ['N', 'I', 'E', 'L']; // pohjoinen, itä, etelä, länsi
  for (let i = 0; i < 36; i++) { g.save(); g.rotate(i * 10 * D2R); g.strokeStyle = '#6b8aa6'; g.lineWidth = Math.max(1, r / 50); g.beginPath(); g.moveTo(0, -r * 0.92); g.lineTo(0, -r * (i % 3 ? 0.84 : 0.76)); g.stroke();
    if (i % 9 === 0) { g.fillStyle = i === 0 ? '#ff6060' : '#e8ecf5'; g.fillText(L[i / 9], 0, -r * 0.52); } g.restore(); }
  g.restore();
  g.strokeStyle = '#ffd060'; g.lineWidth = Math.max(2, r / 14); g.beginPath(); g.moveTo(x, y - r * 0.3); g.lineTo(x, y + r * 0.3); g.moveTo(x - r * 0.2, y + r * 0.05); g.lineTo(x + r * 0.2, y + r * 0.05); g.stroke();
  g.font = `${Math.round(r * 0.22)}px "Share Tech Mono", monospace`; g.fillStyle = '#e8ecf5'; g.fillText(String(Math.round(hdg) % 360).padStart(3, '0') + '°', x, y + r * 0.86);
}
// ohjaamo: ikkunakehys, kojelauta ja mittarit
function drawCockpit(g) {
  const k = V.lwk, d = flightData(), W = SW, Hh = SH;
  const panelY = Hh * 0.70;
  g.fillStyle = '#04060b'; g.strokeStyle = 'rgba(79,214,255,0.5)'; g.lineWidth = 1.5 * k;
  // katto ja pilarit
  const shape = pts => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); g.fill(); g.stroke(); };
  shape([[0, 0], [W, 0], [W, Hh * 0.045], [W * 0.5, Hh * 0.075], [0, Hh * 0.045]]);
  shape([[0, 0], [W * 0.05, Hh * 0.04], [W * 0.115, panelY], [0, panelY + Hh * 0.04]]);
  shape([[W, 0], [W * 0.95, Hh * 0.04], [W * 0.885, panelY], [W, panelY + Hh * 0.04]]);
  shape([[W * 0.494, Hh * 0.07], [W * 0.506, Hh * 0.07], [W * 0.51, panelY], [W * 0.49, panelY]]);
  // kojelauta
  g.beginPath(); g.moveTo(0, panelY + Hh * 0.04); g.lineTo(W * 0.1, panelY); g.quadraticCurveTo(W * 0.5, panelY - Hh * 0.05, W * 0.9, panelY); g.lineTo(W, panelY + Hh * 0.04); g.lineTo(W, Hh); g.lineTo(0, Hh); g.closePath();
  g.fillStyle = '#080b12'; g.fill(); g.stroke();
  // mittarit
  const stickW = isTouch ? (0.34 * Math.min(window.innerWidth, window.innerHeight) + 0.03 * window.innerWidth) * DPR + 8 * k : W * 0.1;
  const n = 6, gw = Math.min((W - 2 * stickW) / n, (Hh - panelY) * 0.85), r = gw * 0.44, y = panelY + (Hh - panelY) * 0.55, x0 = W / 2 - gw * (n - 1) / 2;
  gauge(g, x0, y, r, 'NOPEUS KM/H', Math.round(d.kmh), d.kmh / 300, 10, d.kmh > 260);
  attitude(g, x0 + gw, y, r, d);
  gauge(g, x0 + gw * 2, y, r, 'KORKEUS M', Math.round(d.agl), (d.agl % 100) / 100, 10, d.agl < 8 && !heli.onGround);
  gauge(g, x0 + gw * 3, y, r, 'NOUSU M/S', (d.vs >= 0 ? '+' : '') + d.vs.toFixed(1), 0.5 + clamp(d.vs / 20, -0.5, 0.5), 8, d.vs < -4.2 && d.agl < 15);
  compass(g, x0 + gw * 4, y, r, d.hdg);
  gauge(g, x0 + gw * 5, y, r, 'KOLLEKTIIVI %', Math.round(d.lever * 100), d.lever, 10, d.lever > 0.88);
  // varoitusvalot
  const lamps = [['VAKAIN', stab, '#9dff9d'], ['MAASSA', heli.onGround, '#4fd6ff'], ['MATALALLA', !heli.onGround && d.agl < 10, '#ffd060'], ['VAJOAMA', d.vs < -4.2 && d.agl < 20, '#ff6060']];
  lamps.forEach((l, i) => {
    const lx = Math.max(W * 0.14, stickW) + i * 74 * k, ly = panelY + 8 * k;
    g.fillStyle = l[1] ? l[2] : '#1a1f2c'; g.fillRect(lx, ly, 66 * k, 14 * k);
    g.font = `${Math.round(9 * k)}px "Share Tech Mono", monospace`; g.textAlign = 'center'; g.fillStyle = l[1] ? '#05070d' : '#4a5470'; g.fillText(l[0], lx + 33 * k, ly + 10.5 * k);
  });
  txt(g, String(Math.round(d.alt)) + ' M MPY', W * 0.86, panelY + 18 * k, 10, '#6b8aa6', 'right');
}
function drawCrash(g) {
  if (heli.state === 'fly') return;
  const k = V.lwk; g.fillStyle = 'rgba(40,0,0,' + clamp(heli.crashT * 0.4, 0, 0.45) + ')'; g.fillRect(0, 0, SW, SH);
  g.font = `${Math.round(30 * k)}px Orbitron, sans-serif`; g.textAlign = 'center'; g.fillStyle = '#ff6060'; g.fillText('KOPTERI TUHOUTUI', SW / 2, SH * 0.42);
  txt(g, crashWhy, SW / 2, SH * 0.42 + 28 * k, 14, '#ffd060', 'center');
  txt(g, isTouch ? 'NAPAUTA ALKUUN' : 'R = ALKUUN · ESC = VALIKKO', SW / 2, SH * 0.42 + 52 * k, 12, '#c8d0e0', 'center');
}
function drawDebug(g) {
  if (!DEBUG && (!rendErr || animT > 10)) return;
  const si = G3 && G3.sw ? G3.info() : null;
  const lines = [rendInfo + (si ? ' · puskuri ' + si.buf + ' · ' + si.ms + ' ms' : '')];
  if (rendErr) lines.push('WebGL ei käytössä: ' + rendErr.slice(0, 120));
  lines.forEach((l, i) => txt(g, l, SW / 2, SH - (lines.length - i) * 13 * V.lwk - (view ? SH * 0.3 : 8 * V.lwk), 10, rendErr ? '#ffd060' : '#9dff9d', 'center'));
}

// ===================== ÄÄNI =====================
let AC = null, snd = null, soundOn = true;
function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    const len = AC.sampleRate * 2, buf = AC.createBuffer(1, len, AC.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const noise = AC.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const bp = AC.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 520;
    const chop = AC.createGain(); chop.gain.value = 0.0;
    const lfo = AC.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 22;
    const lfoG = AC.createGain(); lfoG.gain.value = 0.5;
    lfo.connect(lfoG); lfoG.connect(chop.gain);
    const master = AC.createGain(); master.gain.value = 0.0;
    noise.connect(bp); bp.connect(chop); chop.connect(master);
    const tur = AC.createOscillator(); tur.type = 'triangle'; tur.frequency.value = 1150;
    const turG = AC.createGain(); turG.gain.value = 0.012; tur.connect(turG); turG.connect(master);
    master.connect(AC.destination);
    noise.start(); lfo.start(); tur.start();
    snd = { master, lfo, bp, tur, chopBase: chop };
    chop.gain.value = 0.5;
  } catch (e) { AC = null; }
}
function updateAudio() {
  if (!snd) return;
  const on = soundOn && mode !== 'menu' && heli.state === 'fly' && !paused;
  const thr = heli.thrust / G, t = AC.currentTime;
  snd.master.gain.setTargetAtTime(on ? 0.16 + 0.1 * clamp(thr - 0.6, 0, 1) : 0, t, 0.1);
  snd.lfo.frequency.setTargetAtTime(20 + 4 * clamp(thr, 0, 2), t, 0.2);
  snd.bp.frequency.setTargetAtTime(380 + 300 * clamp(thr, 0, 2), t, 0.2);
  snd.tur.frequency.setTargetAtTime(1100 + 120 * clamp(thr, 0, 2), t, 0.3);
}
function beep(f, d, v) {
  if (!AC || !soundOn) return;
  const o = AC.createOscillator(), g = AC.createGain(); o.frequency.value = f; o.type = 'square'; g.gain.value = v * 0.3;
  o.connect(g); g.connect(AC.destination); const t = AC.currentTime; g.gain.setTargetAtTime(0, t + d * 0.6, d * 0.3); o.start(t); o.stop(t + d * 2);
}
function boom() {
  if (!AC || !soundOn) return;
  const len = AC.sampleRate * 1.5, buf = AC.createBuffer(1, len, AC.sampleRate), ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain(); s.buffer = buf; f.type = 'lowpass'; f.frequency.value = 700; g.gain.value = 0.7;
  s.connect(f); f.connect(g); g.connect(AC.destination); s.start();
}

// ===================== SYÖTE =====================
const keys = {};
const tstick = { L: { x: 0, y: 0, on: false }, R: { x: 0, y: 0, on: false } };
window.addEventListener('keydown', ev => {
  initAudio();
  const c = ev.code;
  if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && (/^Key|^Arrow|^Digit|^Shift/.test(c) || c === 'Space')) ev.preventDefault();
  keys[c] = true;
  if (ev.repeat) return;
  if (mode === 'menu') { if (c === 'Digit1') startMode('free'); if (c === 'Digit2') startMode('route'); if (c === 'Digit3') startMode('roof'); return; }
  if (c === 'Escape') { toMenu(); return; }
  if (c === 'KeyV') toggleView();
  if (c === 'KeyH') toggleStab();
  if (c === 'KeyM') mapZoom = (mapZoom + 1) % 3;
  if (c === 'KeyR') startMode(mode);
  if (c === 'KeyP') paused = !paused;
  if (c === 'Digit9') soundOn = !soundOn;
  if (c === 'KeyG' && G3 && !G3.sw) useSoftware('vaihdettu käsin (G)');
});
window.addEventListener('keyup', ev => { keys[ev.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
const any = l => l.some(k => keys[k]);
function readControls(dt) {
  let cp = (any(['ArrowUp', 'KeyI']) ? 1 : 0) - (any(['ArrowDown', 'KeyK']) ? 1 : 0);
  let cr = (any(['ArrowRight', 'KeyL']) ? 1 : 0) - (any(['ArrowLeft', 'KeyJ']) ? 1 : 0);
  let pd = (any(['KeyD']) ? 1 : 0) - (any(['KeyA', 'KeyQ']) ? 1 : 0) + (keys.KeyE ? 1 : 0);
  let col = (any(['KeyW', 'Space', 'PageUp']) ? 1 : 0) - (any(['KeyS', 'ShiftLeft', 'PageDown']) ? 1 : 0);
  // näppäimet tasaisesti: suodatetaan, jotta ohjaus ei nyi
  const ks = Math.min(1, dt * 5);
  if (tstick.R.on) { cp = -tstick.R.y; cr = tstick.R.x; }
  if (tstick.L.on) { col = -tstick.L.y; pd = tstick.L.x; }
  // peliohjain
  const gps = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of gps) {
    if (!gp || !gp.axes || gp.axes.length < 4) continue;
    const dz = v => Math.abs(v) < 0.12 ? 0 : v;
    const lx = dz(gp.axes[0]), ly = dz(gp.axes[1]), rx = dz(gp.axes[2]), ry = dz(gp.axes[3]);
    if (lx || ly || rx || ry) { pd = lx; col = -ly; cr = rx; cp = -ry; }
    if (gp.buttons[3] && gp.buttons[3].pressed && !readControls.gv) { toggleView(); } readControls.gv = gp.buttons[3] && gp.buttons[3].pressed;
    break;
  }
  ctl.cp += (clamp(cp, -1, 1) - ctl.cp) * ks; ctl.cr += (clamp(cr, -1, 1) - ctl.cr) * ks;
  ctl.pd += (clamp(pd, -1, 1) - ctl.pd) * ks; ctl.col += (clamp(col, -1, 1) - ctl.col) * Math.min(1, dt * 6);
}
function toggleView() { view = 1 - view; safeLS.set('hk_view', String(view)); syncOpts(); }
function toggleStab() { stab = !stab; safeLS.set('hk_stab', stab ? '1' : '0'); if (!stab) heli.lever = clamp(heli.thrust / (2 * G), 0, 1); syncOpts(); }
function syncOpts() {
  $('oStab').textContent = stab ? 'VAKAIN PÄÄLLÄ' : 'VAKAIN POIS'; $('oStab').classList.toggle('on', stab);
  $('oView').textContent = 'NÄKYMÄ: ' + (view ? 'OHJAAMO' : 'ULKOA'); $('oView').classList.toggle('on', !!view);
  $('tStab').classList.toggle('on', stab); $('tView').textContent = view ? 'OHJAAMO' : 'ULKOA';
}
function toMenu() { mode = 'menu'; task = null; $('menu').hidden = false; updateRecords(); updateTouch(); }
function updateRecords() {
  for (const [id, m] of [['recRoute', 'route'], ['recRoof', 'roof']]) { const v = parseFloat(safeLS.get('hk_rec_' + m)); $(id).textContent = v ? 'ENNÄTYS ' + fmtT(v) : ''; }
}
function updateTouch() { $('touch').hidden = !(isTouch && mode !== 'menu'); }
function setupTouch() {
  for (const [id, key] of [['stL', 'L'], ['stR', 'R']]) {
    const el = $(id), knob = el.querySelector('.knob'); let pid = null;
    const move = ev => {
      const r = el.getBoundingClientRect(), dx = (ev.clientX - r.left - r.width / 2) / (r.width / 2), dy = (ev.clientY - r.top - r.height / 2) / (r.height / 2);
      const l = Math.hypot(dx, dy), s = l > 1 ? 1 / l : 1, x = dx * s, y = dy * s;
      tstick[key].x = Math.abs(x) < 0.08 ? 0 : x; tstick[key].y = Math.abs(y) < 0.08 ? 0 : y; tstick[key].on = true;
      knob.style.left = (32 + x * 32) + '%'; knob.style.top = (32 + y * 32) + '%';
    };
    el.addEventListener('pointerdown', ev => { ev.preventDefault(); initAudio(); pid = ev.pointerId; el.setPointerCapture(pid); move(ev); });
    el.addEventListener('pointermove', ev => { if (ev.pointerId === pid) move(ev); });
    const end = ev => { if (ev.pointerId !== pid) return; pid = null; tstick[key].on = false; tstick[key].x = tstick[key].y = 0; knob.style.left = '32%'; knob.style.top = '32%'; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  const tap = (id, fn) => $(id).addEventListener('pointerdown', ev => { ev.preventDefault(); ev.stopPropagation(); initAudio(); fn(); });
  tap('tView', toggleView); tap('tStab', toggleStab); tap('tReset', () => startMode(mode)); tap('tMenu', toMenu);
  cv.addEventListener('pointerdown', () => { initAudio(); if (mode !== 'menu' && (heli.state !== 'fly' && heli.crashT > 1 || (task && task.done))) startMode(mode); });
}
function goFullscreen() { const d = document.documentElement; try { if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen().catch(() => {}); } catch (e) { /* ei tukea */ } }

// ===================== SILMUKKA =====================
let animT = 0, lastT = performance.now(), demoA = 0;
function update(dt) {
  animT += dt;
  if (mode === 'menu') { demoA += dt * 0.05; return; }
  if (paused) return;
  readControls(dt);
  const n = 4, sdt = dt / n;
  for (let i = 0; i < n; i++) physics(sdt);
  const h = heli;
  if (h.state !== 'fly') h.crashT += dt;
  // roottorin pyöriminen: hidastuu tuhon jälkeen
  const rs = h.state === 'fly' ? 1 : Math.max(0, 1 - h.crashT * 0.6);
  h.rotorA += dt * 2 * Math.PI * 5.2 * rs; h.tailA += dt * 2 * Math.PI * 22 * rs;
  for (const p of parts) { p.v[1] -= 9.8 * dt * 0.6; p.p = madd(p.p, p.v, dt); p.t -= dt; const s = surf(p.p[0], p.p[2]); if (p.p[1] < s) { p.p[1] = s; p.v = scl(p.v, 0.3); } }
  parts = parts.filter(p => p.t > 0);
  if (h.state !== 'fly' && Math.random() < 0.5) parts.push({ p: add(h.p, [rnd(-1, 1), 1.5, rnd(-1, 1)]), v: [rnd(-0.5, 0.5), rnd(2, 4), rnd(-0.5, 0.5)], t: rnd(0.8, 1.6), col: Math.random() < 0.4 ? [255, 120, 40] : [60, 60, 70], s: 1.2 });
  // pöly roottorin alla matalalla
  const agl = h.p[1] - surf(h.p[0], h.p[2]);
  if (h.state === 'fly' && agl < 10 && h.thrust > G * 0.7 && Math.random() < 0.7) { const a = Math.random() * 6.28, r = rnd(3, 7), x = h.p[0] + Math.cos(a) * r, z = h.p[2] + Math.sin(a) * r; parts.push({ p: [x, surf(x, z) + 0.3, z], v: [Math.cos(a) * 5, 0.6, Math.sin(a) * 5], t: 0.7, col: [90, 92, 110], s: 0.9 }); }
  if (parts.length > 500) parts.splice(0, parts.length - 500);
  updateTask(dt);
  updateCam(dt);
}
function render() {
  ctx.clearRect(0, 0, SW, SH);
  let basis, fog;
  if (mode === 'menu') {
    const p = [Math.sin(demoA) * 380, 170, Math.cos(demoA) * 380 - 40], f = norm(sub([0, 20, -40], p)), r = norm(cross([0, 1, 0], f));
    basis = { pos: p, r, u: cross(f, r), f, cy: 0.5 }; fog = [380, 1300];
  } else {
    basis = cameraBasis();
    const alt = Math.max(0, basis.pos[1]);
    fog = [320 + alt * 0.6, 1000 + alt * 1.2];
  }
  setView(basis.pos, basis.r, basis.u, basis.f, basis.cy);
  if (!G3 || G3.sw) drawSky2D(skyCtx);
  if (G3) {
    if (mode !== 'menu') buildScene(view === 1); else G3.clear();
    const fg = G3.sw ? [fog[0] * 0.6, fog[1] * 0.64] : fog;
    try { G3.render(V, fg, FOGC); } catch (e) { console.error(e); if (!G3.sw) useSoftware(e.message || String(e)); }
  }
  if (mode !== 'menu') {
    if (view === 1) drawCockpit(ctx);
    drawTargetMarker(ctx);
    if (view === 0) drawFlightHUD(ctx);
    drawMinimap(ctx);
    drawTaskHUD(ctx);
    drawCrash(ctx);
    if (paused) { ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, 0, SW, SH); txt(ctx, 'TAUKO · P JATKAA', SW / 2, SH / 2, 22, '#e8ecf5', 'center'); }
  }
  drawDebug(ctx);
}
function frame(now) {
  const rawDt = Math.max(0, (now - lastT) / 1000), dt = Math.min(0.05, rawDt); lastT = now;
  try { update(dt); render(); updateAudio(); } catch (err) { console.error(err); }
  requestAnimationFrame(frame);
}

// ===================== KÄYNNISTYS =====================
$('mFree').onclick = () => { initAudio(); if (isTouch) goFullscreen(); startMode('free'); };
$('mRoute').onclick = () => { initAudio(); if (isTouch) goFullscreen(); startMode('route'); };
$('mRoof').onclick = () => { initAudio(); if (isTouch) goFullscreen(); startMode('roof'); };
$('oStab').onclick = toggleStab; $('oView').onclick = toggleView;
if (isTouch) { $('helpKeys').hidden = true; $('helpTouch').hidden = false; }
window.addEventListener('resize', () => setTimeout(resize, 60));
resize();
initRenderer();
buildMap(); setupTouch(); syncOpts(); updateRecords();
resetHeli(HOME, OPEN_YAW);
requestAnimationFrame(frame);
window.__HK = { get why() { return crashWhy; }, heli, ctl, get mode() { return mode; }, get task() { return task; }, HOME, ROOFS, startMode, keys, get view() { return view; }, set view(v) { view = v; }, info: () => G3 && G3.info ? G3.info() : null };
})();
