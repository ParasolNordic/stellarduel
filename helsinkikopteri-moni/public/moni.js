// Helsinkikopteri moninpeli - 1-3 pelaajaa omilla helikoptereillaan Kruununhaan yllä, kukin omalla laitteellaan.
// Pelitavat: vapaa lento, reittikilpailu ja taistelu (yksi lähietäisyyden tykki).
// Lento lasketaan selaimessa (sama malli kuin yksinpelissä); palvelin ratkaisee osumat, tuhot, portit ja voittajan.
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
const KY = window.KY;
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
  try { G3 = window.HKI_SW.create(skyCv, window.HKI_MESH, KD, H); } catch (e) { console.error(e); G3 = null; rendErr += ' / varapiirto: ' + e.message; }
  rendInfo = 'OHJELMALLINEN PIIRTO';
  if (SW) resize();
}
function initRenderer() {
  if (/[?&]piirto=sw\b/.test(location.search)) return useSoftware('');
  try {
    G3 = window.HKI_GL.create(glCv, window.HKI_MESH, KD, H, why => useSoftware(why));
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

// ===================== MAAILMA =====================
const { surf, HOME, PADS, OPEN_YAW, GUN, PCOL, PNAME } = KY;
const PCOLA = PCOL.map(h => [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]);
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

// ===================== HELIKOPTERI =====================
const G = 9.81, ROTOR_R = 5.3;
const heli = { p: [0, 0, 0], v: [0, 0, 0], R: [1, 0, 0], U: [0, 1, 0], F: [0, 0, 1], w: [0, 0, 0], lever: 0.3, thrust: 0, onGround: true,
  rotorA: 0, tailA: 0, rpm: 1, state: 'fly', crashT: 0, gTime: 0 };
let stab = safeLS.get('hk_stab') !== '0', view = safeLS.get('hk_view') === '1' ? 1 : 0, mapZoom = 1;
function resetHeli(at, yaw, air) {
  heli.p = [at[0], at[1], at[2]]; heli.v = [0, 0, 0]; heli.w = [0, 0, 0];
  heli.F = [Math.sin(yaw), 0, Math.cos(yaw)]; heli.U = [0, 1, 0]; heli.R = norm(cross(heli.U, heli.F));
  heli.lever = air ? 0.5 : 0.3; heli.onGround = !air; heli.state = 'fly'; heli.crashT = 0; heli.gTime = 0;
  cam.pos = null; lastP = null;
}
function rotAxis(v, k, th) {
  const c = Math.cos(th), s = Math.sin(th), kv = cross(k, v), kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}
function orthon() { heli.F = norm(heli.F); heli.R = norm(cross(heli.U, heli.F)); heli.U = cross(heli.F, heli.R); }
const toWh = (h, b) => add(h.p, add(add(scl(h.R, b[0]), scl(h.U, b[1])), scl(h.F, b[2])));
const toW = b => toWh(heli, b);
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
function crash(why, fromServer) {
  const h = heli; if (h.state !== 'fly') return;
  h.state = 'crash'; h.crashT = 0; crashWhy = why;
  explode(h.p, h.v);
  if (!fromServer && sock && game) sock.emit('crash', { why });
}
let crashWhy = '';
const rnd = (a, b) => a + Math.random() * (b - a);
let parts = [];

// ===================== VERKKO JA PELI =====================
let sock = null, myIdx = 0, host = 0, roomCode = '', app = 'lobby', roomMode = 'free', rtt = 0;
let game = null;                       // { mode, rings, slots, started, t, cd, over, rank, why, ring, fin, msg, msgT }
const others = new Map();              // id -> muiden kopterit
let tracers = [], hitFlash = 0, hitMark = 0, myHp = KY.HP, scores = {};
const gun = { heat: 0, hot: false, cd: 0 };
const MODE_NAME = { free: 'VAPAA LENTO', race: 'REITTIKILPAILU', fight: 'TAISTELU' };
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
  sock.on('disconnect', () => { if (app !== 'lobby') toLobby('YHTEYS KATKESI'); showPane('pMenu'); });
  sock.on('roster', onRoster);
  sock.on('start', onStart);
  sock.on('go', () => { if (game) { game.started = true; game.msg = MODE_NAME[game.mode] + ' ALKAA!'; game.msgT = 2; beep(880, 0.2, 0.2); } });
  sock.on('S', onSnap);
  sock.on('tr', onTracer);
  sock.on('hit', d => { if (d.id === myIdx) { myHp = d.hp; hitFlash = 0.35; beep(140, 0.05, 0.12); } else { const o = others.get(d.id); if (o) o.hp = d.hp; } if (d.by === myIdx) hitMark = 0.25; });
  sock.on('kill', onKill);
  sock.on('spawn', onSpawn);
  sock.on('ring', d => { if (!game) return; if (d.id === myIdx) game.ring = d.ring; const o = others.get(d.id); if (o) o.ring = d.ring; });
  sock.on('fin', d => { if (!game) return; addMsg(PNAME[d.id] + ' MAALISSA · ' + d.place + '. · ' + fmtT(d.t), PCOL[d.id], 3); if (d.id === myIdx) game.fin = d.t; });
  sock.on('over', d => { if (!game) return; game.over = true; game.why = d.why; game.rank = d.rank; beep(660, 0.15, 0.2); setTimeout(() => beep(990, 0.25, 0.2), 160); });
  sock.on('lobby', () => toLobby(''));
  sock.on('note', d => addMsg(d.t, '#ffd060', 2.5));
  sock.on('left', d => { toLobby(d && d.reason); showPane('pMenu'); });
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
function onRoster(d) {
  roomCode = d.code; host = d.host; myIdx = d.you; roomMode = d.mode;
  if (app === 'lobby') {
    if (d.you === d.host && $('code').textContent === d.code) showPane(['pHost', 'pRoom']); else showPane('pRoom');
  }
  const n = d.slots.filter(Boolean).length;
  $('roster').innerHTML = d.slots.map((on, i) => `<div class="slot ${on ? 'on' : ''}" style="color:${on ? PCOL[i] : ''};border-color:${on ? PCOL[i] : ''}">${on ? PNAME[i] + (i === d.you ? ' (SINÄ)' : '') : 'VAPAA'}</div>`).join('');
  for (const m of ['free', 'race', 'fight']) { const b = $('m_' + m); b.classList.toggle('on', m === d.mode); b.disabled = d.you !== d.host; }
  $('roomInfo').textContent = 'PELI ' + d.code + ' · PELAAJIA ' + n + '/3 · ' + (d.playing ? 'ERÄ KÄYNNISSÄ' : (d.you === d.host ? 'VALITSE PELITAPA JA ALOITA' : 'PELIN LUOJA VALITSEE PELITAVAN JA ALOITTAA'));
  $('bBegin').hidden = d.you !== d.host; $('bBegin').disabled = !!d.playing;
  $('bBegin').textContent = 'ALOITA: ' + MODE_NAME[d.mode] + (n < 2 && d.mode !== 'free' ? ' (YKSIN)' : '');
}
function onStart(d) {
  myIdx = d.you;
  game = { mode: d.mode, rings: d.mode === 'race' ? KY.makeRoute(d.seed, d.rings) : [], slots: d.slots, started: false, t: 0, cd: 3, over: false, rank: null, why: '',
    ring: 0, fin: null, msg: MODE_NAME[d.mode], msgT: 3, landSent: false };
  others.clear(); tracers = []; myHp = KY.HP; scores = {}; gun.heat = 0; gun.hot = false; msgs.length = 0;
  for (const id of d.slots) { scores[id] = [0, 0]; if (id !== myIdx) others.set(id, newOther(id)); }
  const pad = d.pads[myIdx];
  resetHeli(pad, OPEN_YAW, false);
  app = 'play'; show('lobby', false); document.body.classList.add('ingame'); updateTouch();
  if (isTouch) goFullscreen();
}
function newOther(id) {
  const pad = PADS[id] || HOME;
  return { id, p: pad.slice(), rp: pad.slice(), F: [Math.sin(OPEN_YAW), 0, Math.cos(OPEN_YAW)], U: [0, 1, 0], R: [1, 0, 0], tF: null, tU: null, v: [0, 0, 0], alive: true, state: 'fly',
    hp: KY.HP, ring: 0, rotorA: Math.random() * 6, tailA: 0, rot: 1, inv: false, t: 0 };
}
function onSnap(d) {
  if (!game) return;
  game.t = d.t; game.cd = d.cd;
  for (const e of d.P) {
    const [id, p, F, U, v, alive, hp, score, ring, heat, hot, inv, rot] = e;
    if (id === myIdx) { myHp = hp; gun.hot = !!hot || gun.hot && gun.heat > 0.25; if (!game.over) game.ring = Math.max(game.ring, ring); game.inv = !!inv; continue; }
    let o = others.get(id); if (!o) { o = newOther(id); others.set(id, o); }
    o.tp = p; o.tF = F; o.tU = U; o.v = v; o.age = 0; o.hp = hp; o.ring = ring; o.inv = !!inv; o.rot = rot;
    if (alive && !o.alive) { o.rp = p.slice(); o.F = F.slice(); o.U = U.slice(); }
    o.alive = !!alive; o.state = alive ? 'fly' : 'crash';
  }
}
function updateOthers(dt) {
  for (const o of others.values()) {
    o.age = (o.age || 0) + dt;
    if (o.tp) {
      const pred = madd(o.tp, o.v, Math.min(0.25, o.age + 0.05));
      const k = Math.min(1, dt * 10);
      o.rp = add(o.rp, scl(sub(pred, o.rp), k));
      if (vlen(sub(pred, o.rp)) > 30) o.rp = pred.slice();
      o.F = norm(add(o.F, scl(sub(o.tF, o.F), k))); o.U = norm(add(o.U, scl(sub(o.tU, o.U), k)));
    }
    o.R = norm(cross(o.U, o.F)); o.U = cross(o.F, o.R);
    o.p = o.rp;
    if (o.alive) { o.rotorA += dt * 2 * Math.PI * 5.2 * (o.rot || 1); o.tailA += dt * 2 * Math.PI * 22; }
  }
}
function onTracer(d) {
  if (d.id === myIdx) return;                          // omat ammukset piirretään heti paikallisesti
  const a = d.p, b = madd(d.p, d.d, d.l);
  tracers.push({ a, b, t: 0.12, col: PCOLA[d.id] || [255, 255, 255] });
  const o = others.get(d.id); if (o) o.flash = 0.06;
  if (d.h === myIdx) hitFlash = 0.35;
  // laukaus kuuluu, jos se on lähellä
  if (vlen(sub(a, heli.p)) < 120) beep(320 + Math.random() * 40, 0.03, 0.05);
}
function onKill(d) {
  if (!game) return;
  for (const s of d.score) scores[s[0]] = [s[1], s[2]];
  const who = d.id === myIdx ? 'SINÄ' : PNAME[d.id];
  if (d.by !== null && d.by !== undefined) addMsg((d.by === myIdx ? 'SINÄ' : PNAME[d.by]) + ' AMPUI ALAS: ' + who, PCOL[d.by], 3);
  else addMsg(who + ': ' + (d.why || 'TUHOUTUI'), '#ffd060', 3);
  if (d.id === myIdx) { if (heli.state === 'fly') crash(d.why || 'AMMUTTU ALAS', true); }
  else { const o = others.get(d.id); if (o) { o.alive = false; o.state = 'crash'; explode(o.rp, o.v); } }
}
function onSpawn(d) {
  if (!game) return;
  const yaw = d.yaw;
  if (d.id === myIdx) { resetHeli(d.p, yaw, d.air); myHp = d.hp; gun.heat = 0; gun.hot = false; }
  else { const o = others.get(d.id); if (o) { o.rp = d.p.slice(); o.tp = d.p.slice(); o.F = [Math.sin(yaw), 0, Math.cos(yaw)]; o.tF = o.F.slice(); o.U = [0, 1, 0]; o.tU = [0, 1, 0]; o.v = [0, 0, 0]; o.alive = true; o.state = 'fly'; o.hp = d.hp; } }
}
let sendAcc = 0;
function sendState(dt) {
  sendAcc += dt;
  if (sendAcc < 0.05 || !sock || !game) return;
  sendAcc = 0;
  if (heli.state !== 'fly') return;
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  sock.emit('st', { p: heli.p.map(r2), F: heli.F.map(r3), U: heli.U.map(r3), v: heli.v.map(r2), r: 1 });
}
// ase: kiinteä tykki nokassa, tulinopeus 9/s, kuumenee
function gunUpdate(dt, firing) {
  gun.heat = Math.max(0, gun.heat - GUN.cool * dt); if (gun.hot && gun.heat <= 0.25) gun.hot = false;
  gun.cd -= dt;
  if (!firing || !game || game.mode !== 'fight' || !game.started || game.over || heli.state !== 'fly' || gun.hot || gun.cd > 0) return;
  gun.cd = GUN.interval; gun.heat += GUN.heatPer; if (gun.heat >= GUN.overheat) { gun.hot = true; gun.heat = GUN.overheat; }
  const o = toW([0, 0.9, 3.7]), d = gunDir();
  const L = Math.min(GUN.range, KY.W0.rayBlock(o, d, GUN.range));
  tracers.push({ a: o, b: madd(o, d, L), t: 0.1, col: [255, 236, 150] });
  sock.emit('fire', { p: o.map(v => Math.round(v * 100) / 100), d: d.map(v => Math.round(v * 1000) / 1000) });
  beep(300 + Math.random() * 30, 0.03, 0.08);
}
const gunDir = () => norm(add(heli.F, scl(heli.U, -0.035)));
// reittikilpailu: oman portin ohitus ja laskeutuminen kotikentälle
let lastP = null;
function updateRace() {
  if (!game || game.mode !== 'race' || !game.started || game.over || heli.state !== 'fly') { lastP = null; return; }
  const r = game.rings[game.ring];
  if (r && lastP) {
    const s0 = dot(sub(lastP, r.c), r.n), s1 = dot(sub(heli.p, r.c), r.n);
    if (s0 < 0 && s1 >= 0) {
      const k = s0 / (s0 - s1), hit = add(lastP, scl(sub(heli.p, lastP), k)), off = sub(hit, r.c);
      if (vlen(sub(off, scl(r.n, dot(off, r.n)))) < r.r) {
        sock.emit('ring', { i: game.ring }); game.ring++; beep(880, 0.12, 0.2);
        addMsg(game.ring < game.rings.length ? 'PORTTI ' + game.ring + ' / ' + game.rings.length : 'KAIKKI PORTIT! LASKEUDU KOTIKENTÄLLE', '#ffb84d', 2);
      }
    }
  }
  if (game.ring >= game.rings.length && game.fin === null && heli.onGround && Math.hypot(heli.p[0] - HOME[0], heli.p[2] - HOME[2]) < 28) {
    if (!game.landSent || (game.landT = (game.landT || 0) + 1) % 60 === 0) { sock.emit('landed'); game.landSent = true; }
  }
  lastP = heli.p.slice();
}
function toLobby(reason) {
  app = 'lobby'; game = null; others.clear(); show('lobby', false); show('lobby', true); document.body.classList.remove('ingame'); updateTouch();
  if (reason) setStatus(reason);
  if (sock && sock.connected && roomCode) { /* huoneen näkymä palautuu roster-viestistä */ }
}
const msgs = [];
function addMsg(t, col, dur) { msgs.push({ t, col, dur, a: 0 }); if (msgs.length > 4) msgs.shift(); }
function explode(p, v) {
  for (let i = 0; i < 70; i++) parts.push({ p: add(p, [rnd(-2, 2), rnd(0.5, 3), rnd(-2, 2)]), v: add(scl(v || [0, 0, 0], 0.3), [rnd(-9, 9), rnd(2, 14), rnd(-9, 9)]), t: rnd(0.8, 2.2), col: Math.random() < 0.5 ? [255, 150, 50] : [255, 220, 120], s: rnd(0.3, 0.9) });
  if (vlen(sub(p, heli.p)) < 300) boom();
}
function fmtT(t) { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); }

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
function drawHeli(h, ecol, cockpit) {
  const toW = b => toWh(h, b), dead = h.state !== 'fly', edge = dead ? COL.dead : ecol;
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
  const md = game ? game.mode : 'free';
  PADS.forEach((p, i) => drawPad(p, PCOLA[i], 5.8, md === 'race' && game.ring >= game.rings.length && game.fin === null && i === myIdx));
  if (md === 'race') drawPad(HOME, [255, 210, 80], 16, game.ring >= game.rings.length && game.fin === null);
  if (md === 'free') for (const p of ROOFS) if (Math.hypot(p[0] - heli.p[0], p[2] - heli.p[2]) < 500) drawPad(p, [120, 200, 140], 5.5, false);
  if (md === 'race') game.rings.forEach((r, i) => { if (i >= game.ring) drawRing(r, i === game.ring ? [255, 184, 77] : (i === game.ring + 1 ? [150, 110, 60] : [70, 60, 50]), i === game.ring); });
  drawHeli(heli, game && game.inv && (animT * 6 | 0) % 2 ? [255, 255, 255] : PCOLA[myIdx], cockpit);
  for (const o of others.values()) {
    if (!o.alive) continue;
    const col = o.inv && (animT * 6 | 0) % 2 ? [255, 255, 255] : PCOLA[o.id];
    drawHeli(o, col, false);
    if (o.flash > 0) G3.point(toWh(o, [0, 0.9, 3.9]), [255, 236, 150], 0.9, false);
  }
  for (const t of tracers) G3.line(t.a, t.b, t.col);
  for (const p of parts) G3.point(p.p, p.col, p.s, p.s > 0.7);
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
  if (game && game.mode === 'race') { dot2(HOME, '#ffd250', 4); game.rings.forEach((r, i) => { if (i >= game.ring) dot2(r.c, i === game.ring ? '#ffb84d' : '#6e5a3a', i === game.ring ? 4 : 2.5); }); }
  else PADS.forEach((p, i) => dot2(p, PCOL[i], 2.5));
  if (game && game.mode === 'free') for (const p of ROOFS) dot2(p, 'rgba(120,200,140,0.8)', 1.6);
  // muut pelaajat: kolmio suunnan mukaan, kartan reunalla jos kaukana
  for (const ot of others.values()) {
    if (!ot.alive) continue;
    let q = P(ot.p[0], ot.p[2]); const dx = q[0] - cx, dy = q[1] - cy, l = Math.hypot(dx, dy);
    if (l > R - 6 * k) q = [cx + dx / l * (R - 6 * k), cy + dy / l * (R - 6 * k)];
    const oy = Math.atan2(ot.F[0], ot.F[2]) - yaw;
    g.save(); g.translate(q[0], q[1]); g.rotate(oy); g.fillStyle = PCOL[ot.id];
    g.beginPath(); g.moveTo(0, -7 * k); g.lineTo(5 * k, 5 * k); g.lineTo(-5 * k, 5 * k); g.closePath(); g.fill(); g.restore();
  }
  g.restore();
  g.strokeStyle = PCOL[myIdx]; g.lineWidth = 2 * k; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
  g.fillStyle = '#e8f6ff'; g.beginPath(); g.moveTo(cx, cy - 7 * k); g.lineTo(cx + 5 * k, cy + 5 * k); g.lineTo(cx, cy + 2 * k); g.lineTo(cx - 5 * k, cy + 5 * k); g.closePath(); g.fill();
  const nq = [cx + Rz * (R - 9 * k), cy - Fz * (R - 9 * k)];
  g.fillStyle = '#ff6060'; g.font = `${Math.round(11 * k)}px "Share Tech Mono", monospace`; g.textAlign = 'center'; g.fillText('N', nq[0], nq[1] + 4 * k);
  g.fillStyle = '#6b7390'; g.fillText('KARTTA ' + range * 2 + ' M' + (isTouch ? '' : ' (M)'), cx, cy + R + 14 * k);
}
// muiden nimet ja kestävyys, jos näkyvissä
function drawTags(g) {
  const k = V.lwk;
  for (const o of others.values()) {
    if (!o.alive) continue;
    const head = add(o.p, [0, 4.2, 0]), q = proj(head); if (!q || q[2] > 700) continue;
    const d = sub(head, V.C), L = vlen(d);
    if (KY.W0.rayBlock(V.C, scl(d, 1 / L), L) < L - 4) continue;
    txt(g, PNAME[o.id] + (q[2] > 60 ? ' ' + Math.round(q[2]) + ' M' : ''), q[0], q[1] - 8 * k, 11, PCOL[o.id], 'center');
    if (game && game.mode === 'fight') { const w = 44 * k; g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(q[0] - w / 2, q[1] - 4 * k, w, 4 * k); g.fillStyle = PCOL[o.id]; g.fillRect(q[0] - w / 2, q[1] - 4 * k, w * clamp(o.hp / KY.HP, 0, 1), 4 * k); }
    if (game && game.mode === 'race') txt(g, 'PORTTI ' + o.ring, q[0], q[1] + 10 * k, 10, PCOL[o.id], 'center');
  }
}
function targetInfo() {
  if (!game || game.mode !== 'race') return null;
  const p = game.ring < game.rings.length ? game.rings[game.ring].c : HOME;
  const d = sub(p, heli.p), dist = Math.hypot(d[0], d[2]);
  let brg = Math.atan2(d[0], d[2]) - heading(); while (brg > Math.PI) brg -= 2 * Math.PI; while (brg < -Math.PI) brg += 2 * Math.PI;
  return { dist, brg, dy: d[1], p, ring: game.ring < game.rings.length };
}
function drawTargetMarker(g) {
  const ti = targetInfo(); if (!ti || game.fin !== null) return;
  const k = V.lwk, q = proj(ti.ring ? ti.p : add(ti.p, [0, 2, 0])), col = ti.ring ? '#ffb84d' : '#ffd250';
  if (q && q[0] > 0 && q[0] < SW && q[1] > 0 && q[1] < SH) {
    g.strokeStyle = col; g.lineWidth = 2 * k; const s = 12 * k;
    g.beginPath(); g.moveTo(q[0] - s, q[1]); g.lineTo(q[0], q[1] - s); g.lineTo(q[0] + s, q[1]); g.lineTo(q[0], q[1] + s); g.closePath(); g.stroke();
    txt(g, Math.round(ti.dist) + ' M', q[0], q[1] + s + 14 * k, 11, col, 'center');
  } else {
    const a = ti.brg, r = Math.min(SW, SH) * 0.36, ax = V.cx + Math.sin(a) * r, ay = SH * 0.5 - Math.cos(a) * r;
    g.save(); g.translate(ax, ay); g.rotate(a); g.fillStyle = col; g.beginPath(); g.moveTo(0, -14 * k); g.lineTo(10 * k, 8 * k); g.lineTo(-10 * k, 8 * k); g.closePath(); g.fill(); g.restore();
    txt(g, Math.round(ti.dist) + ' M', ax, ay + 24 * k, 11, col, 'center');
  }
}
// tähtäin: piste 40 m nokan edessä (osuma-alue loppuu 55 metriin)
function drawReticle(g) {
  if (!game || game.mode !== 'fight' || heli.state !== 'fly') return;
  const k = V.lwk, o = toW([0, 0.9, 3.7]);
  for (const [dist, s] of [[GUN.range * 0.75, 14], [GUN.range, 7]]) {
    const q = proj(madd(o, gunDir(), dist)); if (!q) continue;
    g.strokeStyle = gun.hot ? '#ff6060' : (hitMark > 0 ? '#ffffff' : '#9dff9d'); g.lineWidth = 1.6 * k;
    g.beginPath(); g.arc(q[0], q[1], s * k, 0, 7); g.stroke();
    if (s > 10) { g.beginPath(); g.moveTo(q[0] - s * 1.8 * k, q[1]); g.lineTo(q[0] - s * 1.2 * k, q[1]); g.moveTo(q[0] + s * 1.2 * k, q[1]); g.lineTo(q[0] + s * 1.8 * k, q[1]); g.moveTo(q[0], q[1] + s * 1.2 * k); g.lineTo(q[0], q[1] + s * 1.8 * k); g.stroke(); }
    if (hitMark > 0 && s > 10) { g.strokeStyle = '#ffffff'; g.beginPath(); for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.moveTo(q[0] + sx * 6 * k, q[1] + sy * 6 * k); g.lineTo(q[0] + sx * 12 * k, q[1] + sy * 12 * k); } g.stroke(); }
  }
}
function drawGameHUD(g) {
  const k = V.lwk, x = 14 * k; let y = isTouch ? 60 * DPR + 14 * k : 22 * k;
  if (!game) return;
  txt(g, MODE_NAME[game.mode] + ' · PELI ' + roomCode, x, y, 13, PCOL[myIdx]); y += 17 * k;
  txt(g, (stab ? 'VAKAIN PÄÄLLÄ' : 'VAKAIN POIS') + ' · ' + (view ? 'OHJAAMO' : 'ULKONÄKYMÄ') + (rtt ? ' · ' + Math.round(rtt) + ' MS' : ''), x, y, 11, stab ? '#9dff9d' : '#ffd060'); y += 18 * k;
  const ids = [myIdx, ...others.keys()].sort((a, b) => a - b);
  if (game.mode === 'fight') {
    const left = Math.max(0, KY.FIGHT_TIME - game.t);
    txt(g, 'AIKAA ' + fmtT(left).replace(/\.\d$/, '') + ' · ' + KY.KILLS_TO_WIN + ' PUDOTUSTA VOITTAA', x, y, 12, '#e8ecf5'); y += 16 * k;
    for (const id of ids.sort((a, b) => (scores[b] ? scores[b][0] : 0) - (scores[a] ? scores[a][0] : 0))) { const s = scores[id] || [0, 0]; txt(g, PNAME[id] + (id === myIdx ? ' (SINÄ)' : '') + '  ' + s[0] + ' PUDOTUSTA · ' + s[1] + ' TUHOA', x, y, 11, PCOL[id]); y += 14 * k; }
    // oma kestävyys ja tykin lämpö
    const bw = 170 * k, by = isTouch ? SH * 0.42 : SH - 110 * k, bx = isTouch ? x : SW - bw - 16 * k;
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(bx, by, bw, 8 * k); g.fillStyle = myHp > 35 ? '#9dff9d' : '#ff6060'; g.fillRect(bx, by, bw * clamp(myHp / KY.HP, 0, 1), 8 * k);
    txt(g, 'KESTÄVYYS ' + Math.max(0, Math.round(myHp)), bx, by - 4 * k, 10, '#c8d0e0');
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(bx, by + 24 * k, bw, 6 * k); g.fillStyle = gun.hot ? '#ff6060' : '#ffd060'; g.fillRect(bx, by + 24 * k, bw * clamp(gun.heat / GUN.overheat, 0, 1), 6 * k);
    txt(g, gun.hot ? 'TYKKI YLIKUUMENI' : 'TYKIN LÄMPÖ', bx, by + 20 * k, 10, gun.hot ? '#ff6060' : '#c8d0e0');
  }
  if (game.mode === 'race') {
    txt(g, 'AIKA ' + fmtT(game.t) + ' · PORTIT ' + Math.min(game.ring, game.rings.length) + ' / ' + game.rings.length + (game.fin !== null ? ' · MAALISSA ' + fmtT(game.fin) : ''), x, y, 12, '#e8ecf5'); y += 16 * k;
    for (const id of ids) { const r = id === myIdx ? game.ring : (others.get(id) || {}).ring || 0; txt(g, PNAME[id] + (id === myIdx ? ' (SINÄ)' : '') + '  PORTTI ' + r, x, y, 11, PCOL[id]); y += 14 * k; }
    const ti = targetInfo(); if (ti && game.fin === null) txt(g, (ti.ring ? 'SEURAAVA PORTTI ' : 'KOTIKENTTÄ ') + Math.round(ti.dist) + ' M · ' + (ti.dy > 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(ti.dy)) + ' M', x, y, 11, '#9aa6c8');
  }
  if (game.mode === 'free') { for (const id of ids) { txt(g, PNAME[id] + (id === myIdx ? ' (SINÄ)' : ''), x, y, 11, PCOL[id]); y += 14 * k; } }
  // lähtölaskenta
  if (!game.started && game.cd > 0) {
    g.font = `${Math.round(64 * k)}px Orbitron, sans-serif`; g.textAlign = 'center'; g.fillStyle = '#ffd060'; g.fillText(String(Math.ceil(game.cd)), SW / 2, SH * 0.36);
    txt(g, MODE_NAME[game.mode], SW / 2, SH * 0.36 + 30 * k, 14, '#e8ecf5', 'center');
  }
  // viestit
  let my = SH * (view ? 0.14 : 0.18);
  for (const m of msgs) { g.globalAlpha = clamp(m.dur, 0, 1); txt(g, m.t, SW / 2, my, 16, m.col, 'center'); my += 22 * k; }
  g.globalAlpha = 1;
  if (game.msgT > 0) { g.globalAlpha = clamp(game.msgT, 0, 1); txt(g, game.msg, SW / 2, SH * 0.3, 22, '#ffd060', 'center'); g.globalAlpha = 1; }
  const h = heli, M = 40;
  if (h.p[0] < BX0 + M + 10 || h.p[0] > BX1 - M - 10 || h.p[2] < BZ0 + M + 10 || h.p[2] > BZ1 - M - 10) txt(g, 'ALUEEN RAJA', SW / 2, SH * 0.26, 16, '#ff6060', 'center');
  if (hitFlash > 0) { g.fillStyle = 'rgba(255,40,40,' + (hitFlash * 0.6).toFixed(2) + ')'; g.fillRect(0, 0, SW, SH); }
}
function drawOver(g) {
  if (!game || !game.over) return;
  const k = V.lwk;
  g.fillStyle = 'rgba(5,5,12,0.72)'; g.fillRect(0, 0, SW, SH);
  g.font = `${Math.round(30 * k)}px Orbitron, sans-serif`; g.textAlign = 'center'; g.fillStyle = '#ffd060'; g.fillText(game.why || 'ERÄ PÄÄTTYI', SW / 2, SH * 0.3);
  (game.rank || []).forEach((r, i) => {
    const s = game.mode === 'race' ? (r.finT !== null ? fmtT(r.finT) : 'PORTTI ' + r.ring) : r.score + ' PUDOTUSTA · ' + r.deaths + ' TUHOA';
    txt(g, (i + 1) + '. ' + PNAME[r.id] + (r.id === myIdx ? ' (SINÄ)' : '') + '   ' + s, SW / 2, SH * 0.3 + (40 + i * 26) * k, 16, PCOL[r.id], 'center');
  });
  txt(g, 'PALATAAN AULAAN HETKEN KULUTTUA...', SW / 2, SH * 0.3 + 140 * k, 12, '#c8d0e0', 'center');
}
function drawCrash(g) {
  if (heli.state === 'fly' || (game && game.over)) return;
  const k = V.lwk; g.fillStyle = 'rgba(40,0,0,' + clamp(heli.crashT * 0.4, 0, 0.45) + ')'; g.fillRect(0, 0, SW, SH);
  g.font = `${Math.round(30 * k)}px Orbitron, sans-serif`; g.textAlign = 'center'; g.fillStyle = '#ff6060'; g.fillText('KOPTERI TUHOUTUI', SW / 2, SH * 0.42);
  txt(g, crashWhy, SW / 2, SH * 0.42 + 28 * k, 14, '#ffd060', 'center');
  txt(g, 'UUSI KOPTERI ' + Math.max(0, Math.ceil(4 - heli.crashT)) + ' S', SW / 2, SH * 0.42 + 52 * k, 12, '#c8d0e0', 'center');
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
function txt(g, s, x, y, size, col, align) { g.font = `${Math.round(size * V.lwk)}px "Share Tech Mono", monospace`; g.fillStyle = col; g.textAlign = align || 'left'; g.fillText(s, x, y); }
function flightData() {
  const h = heli, hs = Math.hypot(h.v[0], h.v[2]), agl = h.p[1] - surf(h.p[0], h.p[2]);
  let hdg = heading() / D2R; if (hdg < 0) hdg += 360;
  return { kmh: hs * 3.6, agl, alt: h.p[1], vs: h.v[1], hdg, pitch: Math.asin(clamp(-h.F[1], -1, 1)) / D2R, roll: Math.asin(clamp(-h.R[1], -1, 1)) / D2R, lever: h.lever, thr: h.thrust / G };
}
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
  const lamps = [['VAKAIN', stab, '#9dff9d'], [game && game.mode === 'fight' ? (gun.hot ? 'YLIKUUMA' : 'TYKKI') : 'MAASSA', game && game.mode === 'fight' ? true : heli.onGround, game && game.mode === 'fight' ? (gun.hot ? '#ff6060' : '#9dff9d') : '#4fd6ff'], ['MATALALLA', !heli.onGround && d.agl < 10, '#ffd060'], ['VAJOAMA', d.vs < -4.2 && d.agl < 20, '#ff6060']];
  lamps.forEach((l, i) => {
    const lx = Math.max(W * 0.14, stickW) + i * 74 * k, ly = panelY + 8 * k;
    g.fillStyle = l[1] ? l[2] : '#1a1f2c'; g.fillRect(lx, ly, 66 * k, 14 * k);
    g.font = `${Math.round(9 * k)}px "Share Tech Mono", monospace`; g.textAlign = 'center'; g.fillStyle = l[1] ? '#05070d' : '#4a5470'; g.fillText(l[0], lx + 33 * k, ly + 10.5 * k);
  });
  txt(g, String(Math.round(d.alt)) + ' M MPY', W * 0.86, panelY + 18 * k, 10, '#6b8aa6', 'right');
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
  const on = soundOn && app === 'play' && heli.state === 'fly';
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
let touchFire = false, escT = 0;
window.addEventListener('keydown', ev => {
  initAudio();
  const c = ev.code;
  if (app === 'lobby') { if (c === 'Enter' && !$('pJoin').hidden) doJoin($('codeIn').value); return; }
  if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && (/^Key|^Arrow|^Digit|^Shift/.test(c) || c === 'Space')) ev.preventDefault();
  keys[c] = true;
  if (ev.repeat) return;
  if (c === 'Escape') { if (escT > 0) quitGame(); else { escT = 2; addMsg('PAINA ESC UUDELLEEN POISTUAKSESI', '#c8d0e0', 2); } return; }
  if (c === 'KeyV') toggleView();
  if (c === 'KeyH') toggleStab();
  if (c === 'KeyM') mapZoom = (mapZoom + 1) % 3;
  if (c === 'Digit9') soundOn = !soundOn;
  if (c === 'KeyG' && G3 && !G3.sw) useSoftware('vaihdettu käsin (G)');
});
window.addEventListener('keyup', ev => { keys[ev.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; touchFire = false; });
const any = l => l.some(k => keys[k]);
let padFire = false;
function readControls(dt) {
  let cp = (any(['ArrowUp', 'KeyI']) ? 1 : 0) - (any(['ArrowDown', 'KeyK']) ? 1 : 0);
  let cr = (any(['ArrowRight', 'KeyL']) ? 1 : 0) - (any(['ArrowLeft', 'KeyJ']) ? 1 : 0);
  let pd = (any(['KeyD', 'KeyE']) ? 1 : 0) - (any(['KeyA', 'KeyQ']) ? 1 : 0);
  let col = (any(['KeyW', 'PageUp']) ? 1 : 0) - (any(['KeyS', 'PageDown', 'ShiftLeft']) ? 1 : 0);
  const ks = Math.min(1, dt * 5);
  if (tstick.R.on) { cp = -tstick.R.y; cr = tstick.R.x; }
  if (tstick.L.on) { col = -tstick.L.y; pd = tstick.L.x; }
  padFire = false;
  const gps = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of gps) {
    if (!gp || !gp.axes || gp.axes.length < 4) continue;
    const dz = v => Math.abs(v) < 0.12 ? 0 : v;
    const lx = dz(gp.axes[0]), ly = dz(gp.axes[1]), rx = dz(gp.axes[2]), ry = dz(gp.axes[3]);
    if (lx || ly || rx || ry) { pd = lx; col = -ly; cr = rx; cp = -ry; }
    padFire = !!(gp.buttons[7] && gp.buttons[7].pressed) || !!(gp.buttons[0] && gp.buttons[0].pressed);
    if (gp.buttons[3] && gp.buttons[3].pressed && !readControls.gv) toggleView(); readControls.gv = gp.buttons[3] && gp.buttons[3].pressed;
    break;
  }
  if (game && !game.started) { cp = cr = pd = 0; col = Math.min(col, 0); }     // lähtölaskennan ajan maassa
  ctl.cp += (clamp(cp, -1, 1) - ctl.cp) * ks; ctl.cr += (clamp(cr, -1, 1) - ctl.cr) * ks;
  ctl.pd += (clamp(pd, -1, 1) - ctl.pd) * ks; ctl.col += (clamp(col, -1, 1) - ctl.col) * Math.min(1, dt * 6);
}
const firing = () => !!(keys.Space || keys.KeyF || keys.ControlLeft || touchFire || padFire);
function toggleView() { view = 1 - view; safeLS.set('hk_view', String(view)); syncOpts(); }
function toggleStab() { stab = !stab; safeLS.set('hk_stab', stab ? '1' : '0'); if (!stab) heli.lever = clamp(heli.thrust / (2 * G), 0, 1); syncOpts(); }
function syncOpts() {
  $('oStab').textContent = stab ? 'VAKAIN PÄÄLLÄ' : 'VAKAIN POIS'; $('oStab').classList.toggle('on', stab);
  $('oView').textContent = 'NÄKYMÄ: ' + (view ? 'OHJAAMO' : 'ULKOA'); $('oView').classList.toggle('on', !!view);
  $('tStab').classList.toggle('on', stab); $('tView').textContent = view ? 'OHJAAMO' : 'ULKOA';
}
function quitGame() { if (sock) sock.emit('quit'); roomCode = ''; $('code').textContent = '----'; toLobby(''); showPane('pMenu'); }
function updateTouch() { $('touch').hidden = !(isTouch && app === 'play'); $('tFire').hidden = !(game && game.mode === 'fight'); }
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
  tap('tView', toggleView); tap('tStab', toggleStab); tap('tMenu', () => { if (confirm('Poistutaanko pelistä?')) quitGame(); });
  const f = $('tFire');
  f.addEventListener('pointerdown', ev => { ev.preventDefault(); f.setPointerCapture(ev.pointerId); touchFire = true; f.classList.add('on'); });
  const off = () => { touchFire = false; f.classList.remove('on'); };
  f.addEventListener('pointerup', off); f.addEventListener('pointercancel', off);
}
function goFullscreen() {
  const el = document.documentElement;
  try { if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().then(() => { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); }).catch(() => {}); } catch (e) { /* ei tukea */ }
}

// ===================== SILMUKKA =====================
let animT = 0, lastT = performance.now(), demoA = 0;
function update(dt) {
  animT += dt;
  if (escT > 0) escT -= dt;
  for (const m of msgs) m.dur -= dt; while (msgs.length && msgs[0].dur <= 0) msgs.shift();
  if (app !== 'play' || !game) { demoA += dt * 0.05; return; }
  if (game.msgT > 0) game.msgT -= dt;
  hitFlash = Math.max(0, hitFlash - dt); hitMark = Math.max(0, hitMark - dt);
  readControls(dt);
  const n = 4, sdt = dt / n;
  for (let i = 0; i < n; i++) physics(sdt);
  const h = heli;
  if (h.state !== 'fly') h.crashT += dt;
  const rs = h.state === 'fly' ? 1 : Math.max(0, 1 - h.crashT * 0.6);
  h.rotorA += dt * 2 * Math.PI * 5.2 * rs; h.tailA += dt * 2 * Math.PI * 22 * rs;
  gunUpdate(dt, firing());
  updateOthers(dt);
  for (const o of others.values()) if (o.flash > 0) o.flash -= dt;
  for (const t of tracers) t.t -= dt; tracers = tracers.filter(t => t.t > 0);
  for (const p of parts) { p.v[1] -= 9.8 * dt * 0.6; p.p = madd(p.p, p.v, dt); p.t -= dt; const s = surf(p.p[0], p.p[2]); if (p.p[1] < s) { p.p[1] = s; p.v = scl(p.v, 0.3); } }
  parts = parts.filter(p => p.t > 0);
  if (h.state !== 'fly' && Math.random() < 0.5) parts.push({ p: add(h.p, [rnd(-1, 1), 1.5, rnd(-1, 1)]), v: [rnd(-0.5, 0.5), rnd(2, 4), rnd(-0.5, 0.5)], t: rnd(0.8, 1.6), col: Math.random() < 0.4 ? [255, 120, 40] : [60, 60, 70], s: 1.2 });
  const agl = h.p[1] - surf(h.p[0], h.p[2]);
  if (h.state === 'fly' && agl < 10 && h.thrust > G * 0.7 && Math.random() < 0.7) { const a = Math.random() * 6.28, r = rnd(3, 7), x = h.p[0] + Math.cos(a) * r, z = h.p[2] + Math.sin(a) * r; parts.push({ p: [x, surf(x, z) + 0.3, z], v: [Math.cos(a) * 5, 0.6, Math.sin(a) * 5], t: 0.7, col: [90, 92, 110], s: 0.9 }); }
  if (parts.length > 600) parts.splice(0, parts.length - 600);
  updateRace();
  updateCam(dt);
  sendState(dt);
}
function render() {
  ctx.clearRect(0, 0, SW, SH);
  let basis, fog;
  const playing = app === 'play' && game;
  if (!playing) {
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
    if (playing) buildScene(view === 1); else G3.clear();
    const fg = G3.sw ? [fog[0] * 0.6, fog[1] * 0.64] : fog;
    try { G3.render(V, fg, FOGC); } catch (e) { console.error(e); if (!G3.sw) useSoftware(e.message || String(e)); }
  }
  if (playing) {
    if (view === 1) drawCockpit(ctx);
    drawTags(ctx);
    drawTargetMarker(ctx);
    drawReticle(ctx);
    if (view === 0) drawFlightHUD(ctx);
    drawMinimap(ctx);
    drawGameHUD(ctx);
    drawCrash(ctx);
    drawOver(ctx);
  }
  drawDebug(ctx);
}
function frame(now) {
  const rawDt = Math.max(0, (now - lastT) / 1000), dt = Math.min(0.05, rawDt); lastT = now;
  try { update(dt); render(); updateAudio(); } catch (err) { console.error(err); }
  requestAnimationFrame(frame);
}

// ===================== KÄYNNISTYS =====================
$('bCreate').onclick = doCreate;
$('bJoin').onclick = () => { showPane('pJoin'); setStatus(''); setTimeout(() => $('codeIn').focus(), 50); };
$('bJoinGo').onclick = () => doJoin($('codeIn').value);
$('bBack').onclick = () => { if (sock) sock.emit('quit'); roomCode = ''; $('code').textContent = '----'; showPane('pMenu'); setStatus(''); };
$('bBegin').onclick = () => { initAudio(); sock.emit('begin'); };
for (const m of ['free', 'race', 'fight']) $('m_' + m).onclick = () => sock.emit('mode', m);
$('oStab').onclick = toggleStab; $('oView').onclick = toggleView;
if (isTouch) { $('helpKeys').hidden = true; $('helpTouch').hidden = false; }
window.addEventListener('resize', () => setTimeout(resize, 60));
resize();
initRenderer();
buildMap(); setupTouch(); syncOpts(); showPane('pMenu');
resetHeli(HOME, OPEN_YAW, false);
connect();
requestAnimationFrame(frame);
window.__HM = { gun, get tracers() { return tracers; }, heli, ctl, get game() { return game; }, others, keys, get view() { return view; }, set view(v) { view = v; }, info: () => G3 && G3.info ? G3.info() : null, get myIdx() { return myIdx; }, get hp() { return myHp; }, get why() { return crashWhy; } };
})();
