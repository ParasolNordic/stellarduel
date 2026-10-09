// Ilmatorjunnan ammuntaharjoitus - Kruununhaka yöllä. Kolme it-patteria katoilla, maalilennokkilaivue tekee kolme ylilentoa.
// Yksinpeli: tietokone lennättää laivuetta. Kaksinpeli: toinen pelaaja komentaa ilmatorjuntaa, toinen lentää johtolennokkia.
// Sama ympäristö kuin Helsinkirallissa ja helikopteripeleissä (LoD2-malli, gl3d.js / sw3d.js).
(function () {
'use strict';
const RD = window.RD, IT = window.IT;
const { add, sub, scl, madd, dot, cross, vlen, norm, clamp, H, solid, bldH, KD, BX0, BZ0, BX1, BZ1 } = RD;
const { surf, SITES, CENTER, WEAPONS, DRONE, FORM, PASSES } = IT;
const $ = id => document.getElementById(id);
const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
const W0 = RD.buildWorld();
const D2R = Math.PI / 180, G = 9.81;
const rnd = (a, b) => a + Math.random() * (b - a);
const safeLS = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ei tallennusta */ } } };

// ===================== KANKAAT JA PIIRTÄJÄ =====================
const cv = $('c'), ctx = cv.getContext('2d');
const skyCv = $('sky'), skyCtx = skyCv.getContext('2d'), glCv = $('gl');
let DPR = 1, SW = 0, SH = 0, G3 = null;
const NIGHT = [[2, 3, 9], [5, 7, 18], [11, 13, 28], [22, 22, 38]];      // zeniitti -> horisontti
const FOGC = [8, 9, 17];
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  const maxW = G3 && G3.sw ? 1280 : (isTouch ? 1500 : 2200);
  if (window.innerWidth * DPR > maxW) DPR = maxW / window.innerWidth;
  SW = Math.round(window.innerWidth * DPR); SH = Math.round(window.innerHeight * DPR);
  cv.width = SW; cv.height = SH; skyCv.width = SW; skyCv.height = SH; glCv.width = SW; glCv.height = SH;
}
const DEBUG = /[?&]debug=1\b/.test(location.search);
let rendInfo = '', rendErr = '';
const SOFT_GL = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;
const ROPTS = { floors: false, sky: NIGHT };
function useSoftware(reason) {
  if (G3 && G3.sw) return;
  rendErr = reason || '';
  glCv.style.display = 'none';
  try { G3 = window.HKI_SW.create(skyCv, window.HKI_MESH, KD, H, ROPTS); } catch (e) { console.error(e); G3 = null; rendErr += ' / varapiirto: ' + e.message; }
  rendInfo = 'OHJELMALLINEN PIIRTO';
  if (SW) resize();
}
function initRenderer() {
  if (/[?&]piirto=sw\b/.test(location.search)) return useSoftware('');
  try {
    G3 = window.HKI_GL.create(glCv, window.HKI_MESH, KD, H, why => useSoftware(why), ROPTS);
    const i = G3.info(); rendInfo = 'WebGL · ' + (i.renderer || '?');
    if (SOFT_GL.test(i.renderer || '') && !/[?&]piirto=gl\b/.test(location.search)) { G3 = null; useSoftware('WebGL toimii vain ohjelmallisesti'); }
  } catch (e) { console.error(e); G3 = null; useSoftware(e.message || String(e)); }
}

// ===================== NÄKYMÄ =====================
const V = { w: 1, h: 1, cx: 0, cy: 0, F: 1, C: [0, 0, 0], r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, 1], lwk: 1 };
function setView(pos, f, zoom, up) {
  f = norm(f); let r = cross(up || [0, 1, 0], f); if (vlen(r) < 1e-4) r = [1, 0, 0]; r = norm(r);
  V.w = SW; V.h = SH; V.cx = SW / 2; V.cy = SH / 2; V.F = Math.max(SW * 0.46, SH * 0.78) * (zoom || 1);
  V.C = pos; V.r = r; V.u = cross(f, r); V.f = f; V.lwk = Math.max(1, Math.min(SW, SH) / 600);
}
const camP = p => { const d = sub(p, V.C); return [dot(d, V.r), dot(d, V.u), dot(d, V.f)]; };
const proj = p => { const c = camP(p); return c[2] > 0.3 ? [V.cx + c[0] * V.F / c[2], V.cy - c[1] * V.F / c[2], c[2]] : null; };
function drawSky2D(g) {
  const ry = V.r[1], uy = V.u[1], fy = V.f[1], nl = Math.hypot(ry, uy);
  const fogS = 'rgb(' + FOGC.join(',') + ')';
  if (nl < 1e-3) { g.fillStyle = fy > 0 ? '#02030a' : fogS; g.fillRect(0, 0, SW, SH); return; }
  const nx = ry / nl, ny = -uy / nl, k = nl / V.F, hx = V.cx - nx * fy / k, hy = V.cy - ny * fy / k, L = SH * 0.8;
  const gr = g.createLinearGradient(hx - nx * 2, hy - ny * 2, hx + nx * L, hy + ny * L), e = 2 / (L + 2);
  gr.addColorStop(0, fogS); gr.addColorStop(e * 0.99, fogS); gr.addColorStop(e, '#161626'); gr.addColorStop(e + (1 - e) * 0.08, '#0b0d1c'); gr.addColorStop(e + (1 - e) * 0.35, '#050712'); gr.addColorStop(1, '#020309');
  g.fillStyle = gr; g.fillRect(0, 0, SW, SH);
}
const dirOf = (az, el) => [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];

// ===================== PELIN TILA =====================
// app: menu | place | wait | fight | end ; mode: solo | duo ; role: aa | pilot
let app = 'menu', mode = 'solo', role = 'aa', paused = false;
let bats = [], cur = 0, zoomI = 0, autoFire = safeLS.get('it_auto') !== '0', leadAid = safeLS.get('it_lead') !== '0';
let bullets = [], parts = [], drones = [], fires = [], msgs = [];
let stats = null, result = null, animT = 0, demoA = 0;
let placed = [null, null, null], selW = 0;
const ZOOMS = [1, 2.5, 5];
function addMsg(t, col, dur) { msgs.push({ t, col: col || '#ffd060', dur: dur || 2.5 }); if (msgs.length > 4) msgs.shift(); }

// ---------- patterit ----------
function makeBats(sites) {
  bats = sites.map((s, i) => {
    const w = WEAPONS[i], p = [s[0], s[1], s[2]];
    const toC = sub(CENTER, p), az0 = Math.atan2(toC[0], toC[2]);
    return { i, w, site: p, piv: [p[0], p[1] + 1.7, p[2]], az: az0, el: 12 * D2R, cAz: az0, cEl: 12 * D2R, ammo: w.ammo - Math.min(w.mag, w.ammo), inMag: Math.min(w.mag, w.ammo),
      reloadT: 0, cd: 0, shot: 0, fired: 0, hits: 0, aiT: 0, aiTarget: null, burst: 0 };
  });
  cur = 0;
}
function batDir(b) { return dirOf(b.az, b.el); }
function fireBat(b, dt, want) {
  const w = b.w;
  b.cd -= dt;
  if (b.reloadT > 0) { b.reloadT -= dt; if (b.reloadT <= 0) { const n = Math.min(w.mag, b.ammo); b.inMag = n; b.ammo -= n; if (b === bats[cur]) beep(500, 0.05, 0.08); } return; }
  if (!want) return;
  if (b.inMag <= 0) { if (b.ammo > 0) b.reloadT = w.reload; return; }
  const iv = 1 / w.rate;
  let guard = 0;
  while (b.cd <= 0 && b.inMag > 0 && guard++ < 8) {
    b.cd += iv;
    const d0 = batDir(b), side = norm(cross([0, 1, 0], d0)), up = cross(d0, side);
    const s = w.spread * (b === bats[cur] || role !== 'aa' ? 1 : 2.2);
    const d = norm(add(d0, add(scl(side, (Math.random() - 0.5) * 2 * s), scl(up, (Math.random() - 0.5) * 2 * s))));
    const off = w.barrels > 1 ? (b.shot % 2 ? 0.32 : -0.32) : 0;
    const o = add(add(b.piv, scl(d0, 2.6)), scl(side, off));
    const tracer = b.shot % w.tracerEvery === 0;
    bullets.push({ p: o, v: scl(d, w.v), t: 0, w, b: b.i, tracer, vis: false });
    if (tracer && mode === 'duo') netShots.push([o.map(r1), d.map(r3), b.i]);
    b.shot++; b.inMag--; b.fired++; if (stats) stats.fired++;
    if (b.inMag <= 0 && b.ammo > 0) b.reloadT = w.reload;
    gunSound(b);
  }
  if (b.cd < -iv) b.cd = -iv;
}
const r1 = v => Math.round(v * 10) / 10, r3 = v => Math.round(v * 1000) / 1000;
// ennakko: mihin suuntaan ampua, jotta ammus ja maali kohtaavat (painovoima huomioiden)
function leadPoint(b, d) {
  const w = b.w; let t = vlen(sub(d.p, b.piv)) / w.v, aim = d.p;
  const vel = scl(d.F, d.spd);
  for (let k = 0; k < 4; k++) { aim = madd(d.p, vel, t); t = vlen(sub(aim, b.piv)) / w.v; }
  return { aim: add(aim, [0, 0.5 * G * t * t, 0]), t, real: aim };
}
// muiden patterien miehistöt: valitsevat lähimmän maalin, tähtäävät epätarkasti
function aiBat(b, dt) {
  b.aiT -= dt;
  if (b.aiT <= 0 || !b.aiTarget || !b.aiTarget.alive) {
    b.aiT = rnd(0.8, 1.6); b.aiTarget = null; let best = 1e9;
    for (const d of drones) { if (!d.alive) continue; const L = vlen(sub(d.p, b.piv)); if (L < best && L < b.w.v * b.w.life * 0.55) { best = L; b.aiTarget = d; } }
    b.aiErr = [rnd(-1, 1) * 3.0 * D2R, rnd(-1, 1) * 2.2 * D2R];
  }
  let want = false;
  if (b.aiTarget) {
    const lp = leadPoint(b, b.aiTarget), dv = sub(lp.aim, b.piv);
    b.cAz = Math.atan2(dv[0], dv[2]) + b.aiErr[0]; b.cEl = Math.atan2(dv[1], Math.hypot(dv[0], dv[2])) + b.aiErr[1];
    const e = Math.abs(angDiff(b.cAz, b.az)) + Math.abs(b.cEl - b.el);
    b.burst -= dt; if (b.burst < -1.2) b.burst = rnd(0.6, 1.4);
    want = e < 3 * D2R && b.burst > 0 && b.el > 4 * D2R;
  }
  return want;
}
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
function slewBat(b, dt) {
  const m = b.w.slew * D2R * dt;
  b.az += clamp(angDiff(b.cAz, b.az), -m, m); b.cEl = clamp(b.cEl, -5 * D2R, 85 * D2R);
  b.el += clamp(b.cEl - b.el, -m * 0.8, m * 0.8);
}

// ---------- maalilennokit ----------
function newDrone(id, p, F) { return { id, p: p.slice(), F: norm(F), U: [0, 1, 0], R: [1, 0, 0], spd: DRONE.speed, hp: DRONE.hp, alive: true, fall: false, fv: null, bank: 0, gone: false, flash: 0, spin: 0 }; }
function orient(d, bank) { const f = d.F; let r = cross([0, 1, 0], f); if (vlen(r) < 1e-3) r = [1, 0, 0]; r = norm(r); let u = cross(f, r); const c = Math.cos(bank), s = Math.sin(bank); d.R = norm(add(scl(r, c), scl(u, -s))); d.U = norm(cross(f, d.R)); }
// yksinpelin laivue: johtaja seuraa reittipisteitä, siipimiehet muodostelmapaikkojaan
const fl = { wps: [], wi: 0, pass: 0, inZone: false, leaving: false };
function makeFlight() {
  const n = 6 + ((Math.random() * 3) | 0);
  const th = Math.random() * Math.PI * 2, alt = rnd(170, 320);
  const E = [CENTER[0] + Math.sin(th) * 2600, alt, CENTER[2] + Math.cos(th) * 2600];
  const F = norm(sub([CENTER[0], alt, CENTER[2]], E));
  drones = [];
  for (let i = 0; i < n; i++) { const o = FORM[i], r = norm(cross([0, 1, 0], F)); drones.push(newDrone(i, add(add(E, scl(r, o[0])), add([0, o[1], 0], scl(F, o[2]))), F)); }
  fl.wps = []; fl.wi = 0; fl.pass = 0; fl.inZone = false; fl.leaving = false;
  let ang = th;
  for (let k = 0; k < PASSES; k++) {
    const a = k === 0 ? ang : ang + Math.PI + rnd(-1.1, 1.1);
    const h = rnd(150, 340), off = [rnd(-150, 150), rnd(-150, 150)];
    const X = [CENTER[0] + off[0], h, CENTER[2] + off[1]];
    const dir = [-Math.sin(a), 0, -Math.cos(a)];
    if (k > 0) fl.wps.push([CENTER[0] + Math.sin(a) * 1500, h, CENTER[2] + Math.cos(a) * 1500]);
    fl.wps.push(X, [X[0] + dir[0] * 1400, h + rnd(-30, 30), X[2] + dir[2] * 1400]);
    ang = a;
  }
  const last = fl.wps[fl.wps.length - 1], dl = norm(sub(last, [CENTER[0], last[1], CENTER[2]]));
  fl.wps.push(add(last, scl(dl, 4000)));
  return n;
}
function leaderOf() { return drones.find(d => d.alive); }
function steerLeader(L, dt, tgt) {
  const to = sub(tgt, L.p), hd = norm([to[0], 0, to[2]]), cur = norm([L.F[0], 0, L.F[2]]);
  const ang = Math.atan2(cross(cur, hd)[1], dot(cur, hd));      // + = oikealle (suuntakulma kasvaa)
  const yr = clamp(ang * 0.9, -0.24, 0.24);
  const yaw = Math.atan2(cur[0], cur[2]) + yr * dt;
  const weave = Math.sin(animT * 0.6 + L.id) * 4;
  const vs = clamp((tgt[1] + weave - L.p[1]) * 0.25, -9, 9);
  L.F = norm([Math.sin(yaw), vs / L.spd, Math.cos(yaw)]);
  L.bank += (clamp(yr * 2.4, -0.7, 0.7) - L.bank) * Math.min(1, dt * 2);
  orient(L, L.bank);
  L.p = madd(L.p, L.F, L.spd * dt);
}
function followers(L, dt) {
  const r = norm(cross([0, 1, 0], [L.F[0], 0, L.F[2]])), f = norm([L.F[0], 0, L.F[2]]);
  let slot = 1;
  for (const d of drones) {
    if (!d.alive || d === L) continue;
    const o = FORM[Math.min(slot++, FORM.length - 1)];
    const T = add(add(L.p, scl(r, o[0])), add([0, o[1], 0], scl(f, o[2])));
    const vd = add(scl(L.F, L.spd), scl(sub(T, d.p), 0.7)), sp = vlen(vd);
    const v = sp > L.spd * 1.35 ? scl(vd, L.spd * 1.35 / sp) : vd;
    d.F = norm(add(d.F, scl(sub(norm(v), d.F), Math.min(1, dt * 3)))); d.spd = vlen(v);
    d.bank += (L.bank - d.bank) * Math.min(1, dt * 2); orient(d, d.bank);
    d.p = madd(d.p, v, dt);
  }
}
function updateSoloFlight(dt) {
  const L = leaderOf(); if (!L) return;
  const wp = fl.wps[fl.wi];
  if (wp) {
    steerLeader(L, dt, wp);
    if (Math.hypot(wp[0] - L.p[0], wp[2] - L.p[2]) < 160) fl.wi++;
  }
  followers(L, dt);
  passCheck(L);
  // poistuminen: kaukana alueesta viimeisen ylilennon jälkeen
  if (fl.pass >= PASSES && Math.hypot(L.p[0] - CENTER[0], L.p[2] - CENTER[2]) > 3200) {
    for (const d of drones) if (d.alive) { d.alive = false; d.gone = true; }
  }
}
function passCheck(L) {
  const dc = Math.hypot(L.p[0] - CENTER[0], L.p[2] - CENTER[2]);
  if (dc < 260) fl.inZone = true;
  if (fl.inZone && dc > 700) {
    fl.inZone = false; fl.pass++;
    addMsg(fl.pass < PASSES ? 'YLILENTO ' + fl.pass + ' / ' + PASSES + ' · LAIVUE KÄÄNTYY' : 'VIIMEINEN YLILENTO · LAIVUE POISTUU', '#ffd060', 3);
    if (mode === 'duo' && role === 'pilot' && sock) sock.emit('pass', { n: fl.pass });
  }
}
function droneDown(d, byBat) {
  if (!d.alive) return;
  d.alive = false; d.fall = true; d.fv = scl(d.F, d.spd); d.spin = rnd(-2.5, 2.5);
  if (stats) { stats.down++; if (byBat !== undefined && byBat >= 0 && bats[byBat]) bats[byBat].kills = (bats[byBat].kills || 0) + 1; }
  for (let i = 0; i < 40; i++) parts.push({ p: add(d.p, [rnd(-2, 2), rnd(-2, 2), rnd(-2, 2)]), v: add(scl(d.fv, 0.4), [rnd(-14, 14), rnd(-8, 14), rnd(-14, 14)]), t: rnd(0.5, 1.4), col: Math.random() < 0.5 ? [255, 170, 60] : [255, 230, 150], s: rnd(0.6, 1.6), g: 0.3 });
  boom(vlen(sub(d.p, V.C)));
  addMsg('MAALI ' + (d.id + 1) + ' ALAS' + (byBat >= 0 && bats[byBat] ? ' · ' + bats[byBat].w.nm : ''), '#9dff9d', 2.5);
}
function updateFalling(dt) {
  for (const d of drones) {
    if (d.flash > 0) d.flash -= dt;
    if (!d.fall) continue;
    d.fv[1] -= G * 0.85 * dt; d.fv = scl(d.fv, Math.exp(-dt * 0.08));
    d.p = madd(d.p, d.fv, dt); d.F = norm(d.fv); d.bank += d.spin * dt; orient(d, d.bank);
    if (Math.random() < 0.8) parts.push({ p: d.p.slice(), v: [rnd(-1, 1), rnd(0, 2), rnd(-1, 1)], t: rnd(1.5, 3), col: Math.random() < 0.3 ? [255, 120, 40] : [70, 70, 80], s: rnd(1.2, 2.4), g: -0.05 });
    const s = surf(d.p[0], d.p[2]);
    if (d.p[1] <= s + 0.5) {
      d.fall = false; d.p[1] = s;
      for (let i = 0; i < 50; i++) parts.push({ p: add(d.p, [rnd(-3, 3), 0.5, rnd(-3, 3)]), v: [rnd(-10, 10), rnd(3, 16), rnd(-10, 10)], t: rnd(0.6, 1.8), col: Math.random() < 0.5 ? [255, 150, 50] : [255, 220, 120], s: rnd(0.8, 2), g: 0.6 });
      fires.push({ p: d.p.slice(), t: 22 });
      boom(vlen(sub(d.p, V.C)));
    }
  }
}

// ---------- ammukset ----------
function updateBullets(dt) {
  const n = Math.max(1, Math.ceil(dt / 0.012)), h = dt / n;
  for (let s = 0; s < n; s++) {
    for (const b of bullets) {
      if (b.dead) continue;
      const p0 = b.p; b.v[1] -= G * h; b.p = madd(b.p, b.v, h); b.t += h;
      if (b.local !== false && !b.remote) {
        // osumat: lähin piste janalla lennokin keskipisteeseen
        const seg = sub(b.p, p0), L2 = dot(seg, seg);
        for (const d of drones) {
          if (!d.alive) continue;
          const rel = sub(d.p, p0), tt = clamp(dot(rel, seg) / (L2 || 1), 0, 1), cp = madd(p0, seg, tt), dd = vlen(sub(d.p, cp));
          if (dd < DRONE.hitR) { b.dead = true; hitDrone(d, b.w.dmg, b.b, cp, false); break; }
          if (b.w.prox && dd < b.w.prox) { b.dead = true; hitDrone(d, b.w.dmg * 0.55 * (1 - dd / b.w.prox) + 6, b.b, cp, true); break; }
        }
      }
      if (b.dead) continue;
      if (b.t > b.w.life) { b.dead = true; if (b.w.prox || b.w.id === 'itk61') puff(b.p, b.w.id === 'itk88' ? 1.6 : 1.0); continue; }
      if (b.p[1] < surf(b.p[0], b.p[2])) { b.dead = true; spark(b.p); }
    }
  }
  bullets = bullets.filter(b => !b.dead);
}
function hitDrone(d, dmg, bi, at, burst) {
  if (burst) puff(at, 1.4); else spark(at);
  d.flash = 0.08;
  if (stats) stats.hits++;
  if (bats[bi]) bats[bi].hits++;
  if (mode === 'duo') { if (sock) sock.emit('hit', { id: d.id, dmg: Math.round(dmg * 10) / 10, by: bi }); return; }
  d.hp -= dmg;
  if (d.hp <= 0) droneDown(d, bi);
}
function spark(p) { for (let i = 0; i < 5; i++) parts.push({ p: p.slice(), v: [rnd(-8, 8), rnd(-2, 8), rnd(-8, 8)], t: rnd(0.15, 0.4), col: [255, 230, 160], s: 0.4, g: 0.5 }); }
function puff(p, k) { parts.push({ p: p.slice(), v: [0, 0, 0], t: 0.25, col: [255, 210, 130], s: 3.2 * k, g: 0 }); for (let i = 0; i < 4; i++) parts.push({ p: p.slice(), v: [rnd(-1, 1), rnd(-0.5, 1), rnd(-1, 1)], t: rnd(1, 2), col: [60, 60, 66], s: 2.4 * k, g: -0.02 }); }

// ===================== KAKSINPELI: LENTÄJÄ =====================
const pil = { yaw: 0, pitch: 0, bank: 0, spd: DRONE.speed, thr: 0.6, view: 0, crashed: false };
let pilCam = null, aaSites = null, aaAim = [];
function pilotStart() {
  makeFlight();                                   // aloituspaikka ja muodostelma kuten yksinpelissä, johtajaa ohjaa pelaaja
  drones.length = Math.min(drones.length, FORM.length - 1); while (drones.length < FORM.length - 1) { const L = drones[0], o = FORM[drones.length], r = norm(cross([0, 1, 0], L.F)); drones.push(newDrone(drones.length, add(add(L.p, scl(r, o[0])), add([0, o[1], 0], scl(L.F, o[2]))), L.F)); }
  const L = drones[0]; pil.yaw = Math.atan2(L.F[0], L.F[2]); pil.pitch = 0; pil.bank = 0; pil.spd = DRONE.speed; pil.thr = 0.6; pil.crashed = false;
  fl.pass = 0; fl.inZone = false; pilCam = null;
}
function updatePilot(dt) {
  const L = drones[0]; if (!L || !L.alive) { followersOrphan(dt); return; }
  const k = keys, tc = tstick;
  let roll = (any(['ArrowRight', 'KeyD']) ? 1 : 0) - (any(['ArrowLeft', 'KeyA']) ? 1 : 0);
  let pitch = (any(['ArrowDown', 'KeyS']) ? 1 : 0) - (any(['ArrowUp', 'KeyW']) ? 1 : 0);     // alas = nokka ylös
  let thr = (any(['ShiftLeft', 'ShiftRight', 'KeyE']) ? 1 : 0) - (any(['ControlLeft', 'KeyQ']) ? 1 : 0);
  if (tc.L.on) { roll = tc.L.x; pitch = tc.L.y; }
  if (tc.R.on) thr = -tc.R.y;
  pil.thr = clamp(pil.thr + thr * dt * 0.5, 0, 1);
  pil.spd += ((50 + pil.thr * 70) - pil.spd) * Math.min(1, dt * 0.6);
  pil.bank += (roll * 0.9 - pil.bank) * Math.min(1, dt * (roll ? 1.6 : 2.4));
  pil.pitch += (clamp(pitch, -1, 1) * 0.42 - pil.pitch) * Math.min(1, dt * 1.8);
  pil.yaw += G * Math.tan(pil.bank) / pil.spd * dt;
  L.F = [Math.sin(pil.yaw) * Math.cos(pil.pitch), Math.sin(pil.pitch), Math.cos(pil.yaw) * Math.cos(pil.pitch)];
  L.bank = pil.bank; orient(L, pil.bank); L.spd = pil.spd;
  L.p = madd(L.p, L.F, pil.spd * dt);
  if (L.p[1] > 900) L.p[1] = 900;
  followers(L, dt);
  passCheck(L);
  // törmäys maahan tai rakennukseen
  if (L.p[1] < surf(L.p[0], L.p[2]) + 1.5) { pil.crashed = true; droneDown(L, -1); if (sock) sock.emit('crash'); }
  for (const d of drones) if (d !== L && d.alive && d.p[1] < surf(d.p[0], d.p[2]) + 1) droneDown(d, -1);
}
function followersOrphan(dt) { const n = drones.find(d => d.alive); if (n) { steerLeader(n, dt, [n.p[0] + n.F[0] * 500, n.p[1], n.p[2] + n.F[2] * 500]); followers(n, dt); } }
let fsAcc = 0;
function sendFormation(dt) {
  fsAcc += dt; if (fsAcc < 0.066 || !sock) return; fsAcc = 0;
  sock.emit('fs', { D: drones.map(d => [d.p.map(r1), d.F.map(r3), r3(d.bank), d.alive ? 1 : 0, Math.round(d.spd)]), pass: fl.pass });
}
// ilmatorjunnan puoli: vastaanotetut lennokkien tilat
function onFs(d) {
  if (role !== 'aa' || !d || !d.D) return;
  d.D.forEach((e, i) => {
    let dr = drones[i]; if (!dr) { dr = newDrone(i, e[0], e[1]); dr.rp = e[0].slice(); drones[i] = dr; }
    dr.tp = e[0]; dr.tF = e[1]; dr.tb = e[2]; dr.spd = e[4] || DRONE.speed; dr.age = 0;
    if (!e[3] && dr.alive && !dr.fall) { /* odotetaan palvelimen ilmoitusta */ }
  });
  fl.pass = d.pass || fl.pass;
}
function updateRemoteDrones(dt) {
  for (const d of drones) {
    if (!d.alive || !d.tp) continue;
    d.age = (d.age || 0) + dt;
    const pred = madd(d.tp, d.tF, d.spd * Math.min(0.3, d.age));
    d.p = vlen(sub(pred, d.p)) > 80 ? pred.slice() : add(d.p, scl(sub(pred, d.p), Math.min(1, dt * 8)));
    d.F = norm(add(d.F, scl(sub(d.tF, d.F), Math.min(1, dt * 8)))); d.bank = d.tb || 0; orient(d, d.bank);
  }
}
// lentäjän puoli: ilmatorjunnan ammukset näkyviin
function onShots(d) {
  if (role !== 'pilot' || !d || !d.S) return;
  for (const s of d.S) { const w = WEAPONS[s[2]] || WEAPONS[0]; bullets.push({ p: s[0], v: scl(s[1], w.v), t: 0, w, b: s[2], tracer: true, remote: true }); }
  if (d.S.length && vlen(sub(d.S[0][0], drones[0] ? drones[0].p : V.C)) < 900) gunSound({ w: WEAPONS[d.S[0][2]] || WEAPONS[0], i: d.S[0][2] }, true);
}
let netShots = [], shotAcc = 0, aimAcc = 0;
function sendShots(dt) {
  shotAcc += dt; aimAcc += dt;
  if (shotAcc >= 0.1 && netShots.length && sock) { sock.emit('shots', { S: netShots.splice(0, 80) }); shotAcc = 0; }
  if (aimAcc >= 0.25 && sock) { sock.emit('aim', { A: bats.map(b => [r3(b.az), r3(b.el)]) }); aimAcc = 0; }
}

// ===================== MALLIT =====================
const toWd = (d, b) => add(d.p, add(add(scl(d.R, b[0]), scl(d.U, b[1])), scl(d.F, b[2])));
// geneerinen maalilennokki: runko, deltasiipi, pyrstö, moottori
const DRONE_FACES = [
  [[0, 0, 3.2], [-0.35, 0.1, 1.5], [-0.35, 0.1, -2.4], [0, 0.45, -2.6], [0.35, 0.1, -2.4], [0.35, 0.1, 1.5]],
  [[0, 0, 3.2], [-0.35, -0.2, 1.5], [-0.35, -0.2, -2.4], [0, -0.35, -2.6], [0.35, -0.2, -2.4], [0.35, -0.2, 1.5]],
  [[0, 0, 1.2], [-3.1, 0, -1.6], [-2.8, 0, -2.0], [0, 0, -1.8]],
  [[0, 0, 1.2], [3.1, 0, -1.6], [2.8, 0, -2.0], [0, 0, -1.8]],
  [[0, 0.4, -1.2], [0, 1.6, -2.6], [0, 1.6, -3.0], [0, 0.45, -2.6]],
  [[-1.1, 0.1, -2.2], [1.1, 0.1, -2.2], [1.0, 0.1, -2.7], [-1.0, 0.1, -2.7]],
];
const DCOL = { edge: [255, 140, 60], fill: [40, 18, 10], dead: [90, 60, 50], lead: [255, 220, 90] };
function drawDrone(d) {
  if (d.gone) return;
  const tw = b => toWd(d, b), dead = !d.alive;
  const edge = d.flash > 0 ? [255, 255, 255] : (dead ? DCOL.dead : (mode === 'duo' && d.id === 0 ? DCOL.lead : DCOL.edge));
  for (const f of DRONE_FACES) { const w = f.map(tw); G3.poly(w, DCOL.fill); for (let i = 0; i < w.length; i++) G3.line(w[i], w[(i + 1) % w.length], edge); }
  if (!dead) {
    // navigointivalot ja moottorin hehku
    // valot kasvavat etäisyyden mukaan, jotta laivue erottuu yötaivaalta kaukaakin
    const blink = (animT * 1.5 + d.id * 0.37) % 1 < 0.15, ls = Math.max(0.4, vlen(sub(d.p, V.C)) * 0.0055 / (V.F / Math.max(SW * 0.46, SH * 0.78)));
    G3.point(tw([-3.1, 0, -1.6]), [255, 40, 40], 0.8 * ls, false); G3.point(tw([3.1, 0, -1.6]), [40, 255, 80], 0.8 * ls, false);
    if (blink) G3.point(tw([0, 1.65, -2.8]), [255, 255, 255], 1.1 * ls, false);
    G3.point(tw([0, 0.05, -2.75]), [255, 170, 90], 0.9 * ls, true);
  }
}
const BAT_COL = [[255, 196, 96], [255, 120, 70], [140, 230, 255]];
function drawBattery(b, own, az, el) {
  const p = b.site, col = BAT_COL[b.i], y = p[1] + 0.06;
  // sijoituspaikka: renkaat katolla (entinen helikopterikenttä)
  const ring = r => { const pts = []; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; pts.push([p[0] + Math.cos(a) * r, y, p[2] + Math.sin(a) * r]); } for (let i = 0; i < 16; i++) G3.line(pts[i], pts[(i + 1) % 16], col); return pts; };
  ring(4.5); const sb = ring(2.2);
  for (let i = 0; i < 16; i += 4) G3.line(sb[i], [p[0], p[1] + 1.4, p[2]], col);
  // jalusta ja putket
  const d = dirOf(az, el), side = norm(cross([0, 1, 0], d)), piv = b.piv;
  const n = b.w.barrels, len = b.w.id === 'itk88' ? 4.2 : (b.w.id === 'itk61' ? 3.2 : 2.4);
  for (let k = 0; k < n; k++) { const off = n > 1 ? (k ? 0.32 : -0.32) : 0, a = add(piv, scl(side, off)); G3.line(a, madd(a, d, len), col); G3.line(add(a, [0, 0.12, 0]), madd(add(a, [0, 0.12, 0]), d, len * 0.6), col); }
  const box = [[-0.7, -0.4], [0.7, -0.4], [0.7, 0.6], [-0.7, 0.6]].map(([sx, fz]) => add(add(piv, scl(side, sx)), scl([d[0], 0, d[2]], fz)));
  if (!(own && role === 'aa')) for (let i = 0; i < 4; i++) { G3.line(box[i], box[(i + 1) % 4], col); G3.line(box[i], [box[i][0], p[1] + 0.1, box[i][2]], col); }
}
function buildScene() {
  G3.clear();
  bats.forEach((b, i) => { const a = role === 'pilot' && aaAim[i] ? aaAim[i] : [b.az, b.el]; drawBattery(b, i === cur, a[0], a[1]); });
  for (const d of drones) drawDrone(d);
  for (const b of bullets) {
    if (!b.tracer) continue;
    const tail = madd(b.p, b.v, -0.022), c = b.w.col;
    G3.line(tail, b.p, b.t > b.w.life - 0.4 ? [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6] : c);
  }
  for (const f of fires) { if (Math.random() < 0.5) parts.push({ p: add(f.p, [rnd(-2, 2), rnd(0, 1.5), rnd(-2, 2)]), v: [rnd(-0.5, 0.5), rnd(2, 5), rnd(-0.5, 0.5)], t: rnd(0.6, 1.4), col: Math.random() < 0.6 ? [255, 120, 30] : [70, 66, 70], s: rnd(1, 2.4), g: -0.04 }); }
  for (const p of parts) G3.point(p.p, p.col, p.s, p.s > 1.1);
}

// ===================== HUD =====================
function txt(g, s, x, y, size, col, align, font) { g.font = `${Math.round(size * V.lwk)}px ${font || '"Share Tech Mono", monospace'}`; g.fillStyle = col; g.textAlign = align || 'left'; g.fillText(s, x, y); }
let MAPIMG = null;
function buildMap() {
  const o = KD.occ, c = document.createElement('canvas'); c.width = o.nx; c.height = o.nz;
  const g = c.getContext('2d'), im = g.createImageData(o.nx, o.nz);
  for (let iz = 0; iz < o.nz; iz++) for (let ix = 0; ix < o.nx; ix++) {
    const k = ((o.nz - 1 - iz) * o.nx + ix) * 4, s = RD.solidCell(ix, iz);
    if (s) { const hh = bldH(o.x0 + ix, o.z0 + iz) - H(o.x0 + ix, o.z0 + iz), t = clamp(hh / 30, 0, 1); im.data[k] = 30 + 26 * t; im.data[k + 1] = 52 + 44 * t; im.data[k + 2] = 92 + 56 * t; }
    else { im.data[k] = 12; im.data[k + 1] = 13; im.data[k + 2] = 22; }
    im.data[k + 3] = 255;
  }
  g.putImageData(im, 0, 0); MAPIMG = c;
}
// sijoitteluruutu: kartta pohjoinen ylhäällä
function mapRect() {
  const o = KD.occ, pad = 20 * V.lwk, topPad = (isTouch ? 70 : 90) * V.lwk, panelW = isTouch ? 0 : Math.min(360 * V.lwk, SW * 0.32);
  const aw = SW - panelW - pad * 2, ah = SH - topPad - pad - (isTouch ? 150 * V.lwk : 0), s = Math.min(aw / o.nx, ah / o.nz);
  return { x: pad + (aw - o.nx * s) / 2, y: topPad + (ah - o.nz * s) / 2, s };
}
const mapXY = (m, x, z) => [m.x + (x - KD.occ.x0) * m.s, m.y + (KD.occ.nz - (z - KD.occ.z0)) * m.s];
function drawPlace(g) {
  const k = V.lwk, m = mapRect(), o = KD.occ;
  g.fillStyle = 'rgba(4,5,10,0.85)'; g.fillRect(0, 0, SW, SH);
  g.imageSmoothingEnabled = true; g.drawImage(MAPIMG, m.x, m.y, o.nx * m.s, o.nz * m.s);
  g.strokeStyle = '#2a2f48'; g.lineWidth = 1; g.strokeRect(m.x, m.y, o.nx * m.s, o.nz * m.s);
  txt(g, 'N', m.x + o.nx * m.s - 14 * k, m.y + 18 * k, 13, '#ff6060', 'center');
  const c = mapXY(m, CENTER[0], CENTER[2]); g.strokeStyle = 'rgba(255,208,96,0.35)'; g.setLineDash([6 * k, 6 * k]); g.beginPath(); g.arc(c[0], c[1], 260 * m.s, 0, 7); g.stroke(); g.setLineDash([]);
  for (const s of SITES) { const q = mapXY(m, s[0], s[2]); g.strokeStyle = 'rgba(160,220,255,0.55)'; g.lineWidth = 1.2 * k; g.beginPath(); g.arc(q[0], q[1], 4 * k, 0, 7); g.stroke(); }
  placed.forEach((s, i) => {
    if (!s) return; const q = mapXY(m, s[0], s[2]), col = 'rgb(' + BAT_COL[i].join(',') + ')';
    g.fillStyle = col; g.beginPath(); g.arc(q[0], q[1], 7 * k, 0, 7); g.fill();
    g.strokeStyle = col; g.lineWidth = 1; g.globalAlpha = 0.35; g.beginPath(); g.arc(q[0], q[1], WEAPONS[i].v * WEAPONS[i].life * 0.55 * m.s, 0, 7); g.stroke(); g.globalAlpha = 1;
    txt(g, String(i + 1) + ' ' + WEAPONS[i].nm, q[0] + 10 * k, q[1] + 4 * k, 11, col);
  });
  txt(g, 'SIJOITA KOLME IT-PATTERIA KATOILLE', SW / 2 - (isTouch ? 0 : Math.min(360 * k, SW * 0.32) / 2), 32 * k, 18, '#e8ecf5', 'center', 'Orbitron, sans-serif');
  txt(g, (isTouch ? 'NAPAUTA' : 'NAPSAUTA') + ' KATTOPAIKKAA · VALITTAVANA: ' + (placed.every(Boolean) ? 'KAIKKI SIJOITETTU' : WEAPONS[selW].nm) + ' · KATKOVIIVA = HARJOITUSALUEEN KESKUSTA', SW / 2 - (isTouch ? 0 : Math.min(360 * k, SW * 0.32) / 2), 54 * k, 11, '#9aa6c8', 'center');
}
// tutka (PPI): nykyinen suunta ylöspäin
function drawRadar(g, x, y, R, fromP, az) {
  const k = V.lwk, range = 3000;
  g.fillStyle = 'rgba(2,10,6,0.82)'; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill();
  g.strokeStyle = 'rgba(80,255,140,0.35)'; g.lineWidth = 1; for (const f of [0.33, 0.66, 1]) { g.beginPath(); g.arc(x, y, R * f, 0, 7); g.stroke(); }
  g.beginPath(); g.moveTo(x, y - R); g.lineTo(x, y + R); g.moveTo(x - R, y); g.lineTo(x + R, y); g.stroke();
  const sw = (animT * 1.4) % (Math.PI * 2); g.strokeStyle = 'rgba(80,255,140,0.5)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(sw) * R, y - Math.cos(sw) * R); g.stroke();
  const P = p => { const dx = p[0] - fromP[0], dz = p[2] - fromP[2], a = Math.atan2(dx, dz) - az, r = Math.hypot(dx, dz) / range * R; return [x + Math.sin(a) * Math.min(r, R), y - Math.cos(a) * Math.min(r, R), r > R]; };
  g.strokeStyle = 'rgba(255,208,96,0.4)'; const c = P(CENTER); g.beginPath(); g.arc(c[0], c[1], 260 / range * R, 0, 7); g.stroke();
  for (const d of drones) { if (!d.alive) continue; const q = P(d.p); g.fillStyle = q[2] ? 'rgba(160,255,180,0.5)' : (mode === 'duo' && d.id === 0 ? '#ffe066' : '#9dffb0'); g.fillRect(q[0] - 2 * k, q[1] - 2 * k, 4 * k, 4 * k); }
  if (role === 'pilot' && aaSites) for (const s of aaSites) { const q = P(s); g.strokeStyle = '#ff6060'; g.strokeRect(q[0] - 3 * k, q[1] - 3 * k, 6 * k, 6 * k); }
  g.strokeStyle = '#4fd6ff'; g.lineWidth = 1.5 * k; g.beginPath(); g.arc(x, y, R, 0, 7); g.stroke();
  txt(g, 'TUTKA 3 KM', x, y + R + 13 * k, 10, '#6b7390', 'center');
}
function drawAAHUD(g) {
  const k = V.lwk, b = bats[cur]; if (!b) return;
  // tähtäin: rengastähtäin keskellä
  const cx = SW / 2, cy = SH / 2, zr = ZOOMS[zoomI];
  g.strokeStyle = 'rgba(157,255,157,0.85)'; g.lineWidth = 1.4 * k;
  g.beginPath(); g.arc(cx, cy, 3 * k, 0, 7); g.stroke();
  for (const f of [0.045, 0.09]) { g.beginPath(); g.arc(cx, cy, f * V.F, 0, 7); g.stroke(); }
  g.beginPath(); g.moveTo(cx - 0.12 * V.F, cy); g.lineTo(cx - 0.095 * V.F, cy); g.moveTo(cx + 0.095 * V.F, cy); g.lineTo(cx + 0.12 * V.F, cy); g.moveTo(cx, cy + 0.095 * V.F); g.lineTo(cx, cy + 0.12 * V.F); g.stroke();
  // ennakkomerkit
  if (leadAid) for (const d of drones) {
    if (!d.alive) continue; const L = vlen(sub(d.p, b.piv)); if (L > b.w.v * b.w.life) continue;
    const lp = leadPoint(b, d), q = proj(lp.aim), qd = proj(d.p); if (!q || !qd) continue;
    g.strokeStyle = 'rgba(255,224,102,0.8)'; g.lineWidth = 1.2 * k; const s = 6 * k;
    g.beginPath(); g.moveTo(q[0] - s, q[1]); g.lineTo(q[0], q[1] - s); g.lineTo(q[0] + s, q[1]); g.lineTo(q[0], q[1] + s); g.closePath(); g.stroke();
    g.setLineDash([3 * k, 4 * k]); g.beginPath(); g.moveTo(qd[0], qd[1]); g.lineTo(q[0], q[1]); g.stroke(); g.setLineDash([]);
  }
  // lennokkien etäisyys kun näkyvissä
  for (const d of drones) { if (!d.alive) continue; const q = proj(d.p); if (!q || q[0] < 0 || q[0] > SW || q[1] < 0 || q[1] > SH) continue; txt(g, (q[2] / 1000).toFixed(1) + ' KM', q[0] + 10 * k, q[1] - 8 * k, 10, mode === 'duo' && d.id === 0 ? '#ffe066' : 'rgba(255,170,100,0.9)'); }
  // patterilista
  let y = (isTouch ? 64 * DPR : 24 * k);
  bats.forEach((bb, i) => {
    const on = i === cur, col = 'rgb(' + BAT_COL[i].join(',') + ')';
    const st = bb.reloadT > 0 ? 'LATAA ' + bb.reloadT.toFixed(1) + ' S' : (bb.inMag + bb.ammo <= 0 ? 'AMMUKSET LOPPU' : bb.inMag + ' / ' + bb.ammo);
    txt(g, (on ? '▶ ' : '  ') + (i + 1) + ' ' + bb.w.nm + '  ' + st + (on ? '' : (autoFire ? ' · MIEHISTÖ' : '')), 14 * k, y, on ? 13 : 11, on ? col : 'rgba(200,208,224,0.75)'); y += (on ? 18 : 15) * k;
  });
  txt(g, 'ENNAKKO ' + (leadAid ? 'PÄÄLLÄ' : 'POIS') + ' (L) · MIEHISTÖT ' + (autoFire ? 'AMPUVAT' : 'ODOTTAVAT') + ' (T) · ZOOM ' + zr + 'X', 14 * k, y + 2 * k, 10, '#6b7390');
  // suunta ja korotus
  let az = b.az / D2R % 360; if (az < 0) az += 360;
  txt(g, 'SUUNTA ' + String(Math.round(az)).padStart(3, '0') + '° · KOROTUS ' + Math.round(b.el / D2R) + '°', SW / 2, SH - (isTouch ? 150 * k : 24 * k), 12, '#c8d0e0', 'center');
  const R = Math.round(Math.min(SW, SH) * 0.15); drawRadar(g, SW - R - 14 * k, R + 14 * k, R, b.piv, b.az);
}
function drawPilotHUD(g) {
  const k = V.lwk, L = drones[0]; if (!L) return;
  const agl = L.p[1] - surf(L.p[0], L.p[2]);
  txt(g, 'JOHTOLENNOKKI · YLILENNOT ' + fl.pass + ' / ' + PASSES + ' · KESTÄVYYS ' + Math.max(0, Math.round(L.hp)), 14 * k, (isTouch ? 64 * DPR : 24 * k), 13, '#ffe066');
  txt(g, 'LAIVUEESSA ' + drones.filter(d => d.alive).length + ' / ' + drones.length + ' · NOPEUS ' + Math.round(pil.spd * 3.6) + ' KM/H · KORKEUS ' + Math.round(agl) + ' M · KAASU ' + Math.round(pil.thr * 100) + ' %', 14 * k, (isTouch ? 64 * DPR : 24 * k) + 18 * k, 11, '#c8d0e0');
  txt(g, 'LENNÄ HARJOITUSALUEEN KESKUSTAN YLI (KATKOVIIVA) JA ULOS ' + PASSES + ' KERTAA', 14 * k, (isTouch ? 64 * DPR : 24 * k) + 34 * k, 10, '#9aa6c8');
  // suuntanuoli keskustaan
  const to = sub([CENTER[0], L.p[1], CENTER[2]], L.p), dist = Math.hypot(to[0], to[2]);
  let brg = Math.atan2(to[0], to[2]) - Math.atan2(L.F[0], L.F[2]); while (brg > Math.PI) brg -= 2 * Math.PI; while (brg < -Math.PI) brg += 2 * Math.PI;
  const ax = SW / 2 + Math.sin(brg) * SH * 0.3, ay = SH / 2 - Math.cos(brg) * SH * 0.3;
  g.save(); g.translate(ax, ay); g.rotate(brg); g.fillStyle = fl.inZone ? '#9dff9d' : '#ffd060'; g.beginPath(); g.moveTo(0, -14 * k); g.lineTo(10 * k, 8 * k); g.lineTo(-10 * k, 8 * k); g.closePath(); g.fill(); g.restore();
  txt(g, (fl.inZone ? 'ALUEELLA · ' : 'KESKUSTA ') + Math.round(dist) + ' M', ax, ay + 24 * k, 11, fl.inZone ? '#9dff9d' : '#ffd060', 'center');
  if (agl < 60) txt(g, 'MATALALLA!', SW / 2, SH * 0.62, 18, '#ff6060', 'center');
  const R = Math.round(Math.min(SW, SH) * 0.15); drawRadar(g, SW - R - 14 * k, R + 14 * k, R, L.p, Math.atan2(L.F[0], L.F[2]));
}
function drawTop(g) {
  const k = V.lwk;
  if (app === 'fight' && stats) {
    const alive = drones.filter(d => d.alive).length;
    txt(g, 'MAALEJA ALAS ' + stats.down + ' / ' + stats.total + ' · ILMASSA ' + alive + ' · YLILENTO ' + Math.min(fl.pass + (fl.inZone ? 1 : 0), PASSES) + ' / ' + PASSES, SW / 2, (isTouch ? 64 * DPR : 24 * k), 13, '#e8ecf5', 'center');
  }
  let my = SH * 0.2;
  for (const m of msgs) { g.globalAlpha = clamp(m.dur, 0, 1); txt(g, m.t, SW / 2, my, 16, m.col, 'center'); my += 22 * k; }
  g.globalAlpha = 1;
  if (app === 'wait') txt(g, waitMsg, SW / 2, SH * 0.3, 18, '#ffd060', 'center');
  if (paused) { g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, 0, SW, SH); txt(g, 'TAUKO · P JATKAA', SW / 2, SH / 2, 22, '#e8ecf5', 'center'); }
}
let waitMsg = '';
function drawResult(g) {
  if (app !== 'end' || !result) return;
  const k = V.lwk;
  g.fillStyle = 'rgba(4,5,10,0.75)'; g.fillRect(0, 0, SW, SH);
  g.font = `${Math.round(28 * k)}px Orbitron, sans-serif`; g.textAlign = 'center'; g.fillStyle = result.win ? '#9dff9d' : '#ff8060';
  g.fillText(result.title, SW / 2, SH * 0.28);
  result.lines.forEach((l, i) => txt(g, l, SW / 2, SH * 0.28 + (36 + i * 22) * k, 14, i === 0 ? '#ffd060' : '#c8d0e0', 'center'));
  txt(g, mode === 'solo' ? (isTouch ? 'NAPAUTA: UUSI HARJOITUS' : 'R = UUSI HARJOITUS · ESC = VALIKKO') : 'PALATAAN AULAAN HETKEN KULUTTUA...', SW / 2, SH * 0.28 + (50 + result.lines.length * 22) * k, 12, '#9aa6c8', 'center');
}
function drawDebug(g) {
  if (!DEBUG && (!rendErr || animT > 10)) return;
  const si = G3 && G3.sw ? G3.info() : null;
  const lines = [rendInfo + (si ? ' · puskuri ' + si.buf + ' · ' + si.ms + ' ms' : '')];
  if (rendErr) lines.push('WebGL ei käytössä: ' + rendErr.slice(0, 120));
  lines.forEach((l, i) => txt(g, l, SW / 2, SH - (lines.length - i) * 13 * V.lwk - 40 * V.lwk, 10, rendErr ? '#ffd060' : '#9dff9d', 'center'));
}

// ===================== ÄÄNI =====================
let AC = null, soundOn = true, NOISE = null, hum = null;
function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    const len = AC.sampleRate, buf = AC.createBuffer(1, len, AC.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    NOISE = buf;
    const o = AC.createOscillator(), o2 = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = 118; o2.type = 'sawtooth'; o2.frequency.value = 123; f.type = 'lowpass'; f.frequency.value = 420; g.gain.value = 0;
    o.connect(f); o2.connect(f); f.connect(g); g.connect(AC.destination); o.start(); o2.start();
    hum = { g, o, o2 };
  } catch (e) { AC = null; }
}
let lastGun = [0, 0, 0];
function gunSound(b, far) {
  if (!AC || !soundOn) return;
  const t = AC.currentTime, i = b.i || 0;
  if (t - lastGun[i] < (far ? 0.12 : 0.045)) return; lastGun[i] = t;
  const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = NOISE; f.type = 'bandpass'; f.frequency.value = [900, 520, 300][i] || 600; f.Q.value = 0.8;
  const vol = (far ? 0.08 : (b.i === cur ? 0.32 : 0.1)) * [0.8, 1, 1.2][i];
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + [0.07, 0.09, 0.14][i]);
  s.connect(f); f.connect(g); g.connect(AC.destination); s.start(t, Math.random() * 0.5, 0.2);
}
function boom(dist) {
  if (!AC || !soundOn) return;
  const t = AC.currentTime, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = NOISE; f.type = 'lowpass'; f.frequency.value = 380; g.gain.setValueAtTime(clamp(1.2 - (dist || 0) / 2500, 0.08, 0.7), t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
  s.connect(f); f.connect(g); g.connect(AC.destination); s.start(t, 0, 1.5);
}
function beep(fr, d, v) {
  if (!AC || !soundOn) return;
  const o = AC.createOscillator(), g = AC.createGain(); o.frequency.value = fr; o.type = 'square'; g.gain.value = v * 0.3;
  o.connect(g); g.connect(AC.destination); const t = AC.currentTime; g.gain.setTargetAtTime(0, t + d * 0.6, d * 0.3); o.start(t); o.stop(t + d * 2);
}
function updateAudio() {
  if (!hum) return;
  let dmin = 1e9; for (const d of drones) if (d.alive) dmin = Math.min(dmin, vlen(sub(d.p, V.C)));
  const on = soundOn && (app === 'fight' || app === 'wait') && !paused;
  hum.g.gain.setTargetAtTime(on ? clamp(0.12 * (1 - dmin / 2600), 0, 0.12) : 0, AC.currentTime, 0.3);
}

// ===================== VERKKO (KAKSINPELI) =====================
let sock = null, myIdx = 0, roomCode = '', hostRole = 'aa', rtt = 0;
function setStatus(t) { $('status').textContent = t || ''; }
function show(id, on) { $(id).hidden = !on; }
function showPane(p) { for (const id of ['pMenu', 'pHost', 'pJoin', 'pRoom']) show(id, false); for (const id of [].concat(p)) show(id, true); show('bBack', p !== 'pMenu'); }
function connect() {
  if (sock) return;
  setStatus('YHDISTETÄÄN PALVELIMEEN...');
  sock = io({ transports: ['websocket', 'polling'] });
  sock.on('connect', () => {
    setStatus('');
    const k = new URLSearchParams(location.search).get('k');
    if (k && !connect.auto) { connect.auto = true; $('codeIn').value = k.toUpperCase(); showPane('pJoin'); doJoin(k); }
  });
  sock.on('connect_error', () => setStatus('PALVELIN HERÄÄ TAI YHTEYS EI TOIMI - YRITETÄÄN UUDELLEEN...'));
  sock.on('disconnect', () => { if (mode === 'duo' && app !== 'menu') toMenu('YHTEYS KATKESI'); });
  sock.on('roster', d => {
    roomCode = d.code; myIdx = d.you; hostRole = d.hostRole;
    if (app === 'menu') { if (d.you === 0 && $('code').textContent === d.code) showPane(['pHost', 'pRoom']); else showPane('pRoom'); }
    const n = d.slots.filter(Boolean).length, myRole = (d.you === 0) === (d.hostRole === 'aa') ? 'aa' : 'pilot';
    $('roster').innerHTML = ['ILMATORJUNTA', 'LENNOKKILAIVUE'].map((nm, i) => { const r = i === 0 ? 'aa' : 'pilot', who = (r === 'aa') === (d.hostRole === 'aa') ? 0 : 1, on = d.slots[who];
      return `<div class="slot ${on ? 'on' : ''}">${nm}<br>${on ? (who === d.you ? 'SINÄ' : 'VASTUSTAJA') : 'ODOTETAAN...'}</div>`; }).join('');
    for (const r of ['aa', 'pilot']) { const b = $('r_' + r); b.classList.toggle('on', r === d.hostRole); b.disabled = d.you !== 0; }
    $('roomInfo').textContent = 'PELI ' + d.code + ' · PELAAJIA ' + n + '/2 · ' + (d.you === 0 ? (n < 2 ? 'ODOTETAAN TOISTA PELAAJAA' : 'VALITSE ROOLISI JA ALOITA') : 'PELIN LUOJA VALITSEE ROOLIT JA ALOITTAA') + ' · SINÄ: ' + (myRole === 'aa' ? 'ILMATORJUNTA' : 'LENNOKKILAIVUE');
    $('bBegin').hidden = d.you !== 0; $('bBegin').disabled = n < 2 || !!d.playing;
  });
  sock.on('start', d => { role = d.role; mode = 'duo'; startRound(); });
  sock.on('go', d => {
    if (mode !== 'duo') return;
    makeBats(d.sites); aaSites = d.sites;
    if (role === 'pilot') { app = 'fight'; addMsg('ILMATORJUNTA VALMIINA · LENNÄ!', '#ffe066', 3); }
    else { app = 'fight'; addMsg('LAIVUE LÄHESTYY', '#ffd060', 3); }
    updateUI();
  });
  sock.on('fs', onFs);
  sock.on('shots', onShots);
  sock.on('aim', d => { if (d && d.A) aaAim = d.A; });
  sock.on('dhit', d => { const dr = drones[d.id]; if (dr) { dr.hp = d.hp; dr.flash = 0.1; if (role === 'pilot') beep(160, 0.04, 0.1); } });
  sock.on('down', d => { const dr = drones[d.id]; if (dr && dr.alive) droneDown(dr, d.by); });
  sock.on('pass', d => { if (role === 'aa' && d.n > fl.pass) { fl.pass = d.n; addMsg('LAIVUE TEKI YLILENNON ' + d.n + ' / ' + PASSES, '#ff8060', 3); } });
  sock.on('over', d => {
    const meWin = (d.winner === 'aa') === (role === 'aa');
    result = { win: meWin, title: meWin ? 'VOITIT' : 'HÄVISIT', lines: [d.why, 'ALAS AMMUTTUJA LENNOKKEJA ' + d.down + ' / ' + d.total + ' · YLILENNOT ' + d.passes + ' / ' + PASSES] };
    app = 'end'; exitLock(); updateUI();
  });
  sock.on('lobby', () => toMenu(''));
  sock.on('note', d => addMsg(d.t, '#ffd060', 2.5));
  sock.on('left', d => { toMenu(d && d.reason); showPane('pMenu'); roomCode = ''; });
  setInterval(() => { if (sock.connected) { const t = performance.now(); sock.emit('png', t, () => { rtt = performance.now() - t; }); } }, 2000);
}
function doCreate() {
  initAudio(); connect(); setStatus('LUODAAN PELIÄ...');
  const go = () => sock.emit('create', { origin: location.origin }, d => { setStatus(''); $('code').textContent = d.code; $('joinUrl').textContent = d.url; if (d.qr) $('qr').src = d.qr; showPane(['pHost', 'pRoom']); });
  if (sock.connected) go(); else sock.once('connect', go);
}
function doJoin(code) {
  initAudio(); connect(); code = String(code || '').toUpperCase().trim();
  if (code.length !== 4) { setStatus('KOODISSA ON NELJÄ KIRJAINTA'); return; }
  setStatus('LIITYTÄÄN...');
  const go = () => sock.emit('join', { code }, d => { if (d && d.err) setStatus(d.err); else setStatus(''); });
  if (sock.connected) go(); else sock.once('connect', go);
}

// ===================== KULKU =====================
function startRound() {
  bullets = []; parts = []; fires = []; msgs = []; drones = []; bats = []; result = null; paused = false; zoomI = 0;
  placed = [null, null, null]; selW = 0; aaSites = null; aaAim = [];
  fl.pass = 0; fl.inZone = false;
  if (role === 'aa') { app = 'place'; }
  else { app = 'wait'; waitMsg = 'ILMATORJUNTA SIJOITTAA PATTEREITAAN...'; pilotStart(); }
  show('menu', false); updateUI();
  if (isTouch) goFullscreen();
}
function randomPlace() {
  const pool = SITES.slice().sort(() => Math.random() - 0.5);
  placed = [null, null, null];
  for (const s of pool) { if (placed.every(Boolean)) break; const i = placed.indexOf(null); if (placed.some(q => q && Math.hypot(q[0] - s[0], q[2] - s[2]) < 160)) continue; if (Math.hypot(s[0] - CENTER[0], s[2] - CENTER[2]) > 380) continue; placed[i] = s; }
  for (let i = 0; i < 3; i++) if (!placed[i]) placed[i] = pool[i];
  selW = 0; updateUI();
}
function confirmPlace() {
  if (!placed.every(Boolean)) return;
  const sites = placed.map(s => [s[0], s[1], s[2]]);
  makeBats(sites);
  if (mode === 'duo') { sock.emit('sites', { sites }); app = 'wait'; waitMsg = 'ODOTETAAN...'; }
  else {
    const n = makeFlight();
    stats = { total: n, down: 0, hits: 0, fired: 0 };
    app = 'fight'; addMsg('ILMAHÄLYTYS · MAALILENNOKKILAIVUE LÄHESTYY', '#ffd060', 4);
  }
  if (!stats) stats = { total: FORM.length - 1, down: 0, hits: 0, fired: 0 };
  updateUI();
}
function soloEnd() {
  const down = stats.down, total = stats.total, acc = stats.fired ? (100 * stats.hits / stats.fired) : 0;
  const ratio = down / total, win = ratio >= 0.5;
  const grade = ratio >= 1 ? 'ERINOMAINEN' : ratio >= 0.75 ? 'KIITETTÄVÄ' : ratio >= 0.5 ? 'HYVÄ' : ratio >= 0.25 ? 'TYYDYTTÄVÄ' : 'HYLÄTTY';
  result = { win, title: win ? 'HARJOITUS ONNISTUI' : 'HARJOITUS EPÄONNISTUI', lines: ['ARVIO: ' + grade + ' · ALAS ' + down + ' / ' + total,
    'LAUKAUKSIA ' + stats.fired + ' · OSUMIA ' + stats.hits + ' · OSUMATARKKUUS ' + acc.toFixed(1) + ' %',
    bats.map(b => b.w.nm + ': ' + (b.kills || 0) + ' ALAS').join(' · ')] };
  const best = parseInt(safeLS.get('it_best') || '0', 10); if (down > best) safeLS.set('it_best', String(down));
  app = 'end'; exitLock(); updateUI();
}
function toMenu(reason) {
  app = 'menu'; drones = []; bats = []; bullets = []; stats = null; exitLock(); show('menu', true); updateUI();
  if (reason) setStatus(reason);
  if (mode === 'duo' && roomCode) showPane('pRoom'); else if (mode === 'solo') showPane('pMenu');
}
function updateUI() {
  show('placePanel', app === 'place');
  for (let i = 0; i < 3; i++) { const c = $('w' + i); c.classList.toggle('on', i === selW); c.querySelector('i').textContent = placed[i] ? 'SIJOITETTU' : 'VALITSE PAIKKA'; }
  $('bPlaceGo').disabled = !placed.every(Boolean);
  const t = isTouch && (app === 'fight' || app === 'wait' || app === 'end');
  show('touch', t); show('tAA', t && role === 'aa'); show('tPil', t && role === 'pilot');
  const best = safeLS.get('it_best'); $('best').textContent = best ? 'PARAS TULOS ' + best + ' MAALIA ALAS' : '';
}

// ===================== SYÖTE =====================
const keys = {};
const tstick = { L: { x: 0, y: 0, on: false }, R: { x: 0, y: 0, on: false } };
const any = l => l.some(k => keys[k]);
let mouseFire = false, touchFire = false, locked = false;
window.addEventListener('keydown', ev => {
  initAudio();
  const c = ev.code;
  if (app === 'menu') { if (c === 'Enter' && !$('pJoin').hidden) doJoin($('codeIn').value); return; }
  if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && (/^Key|^Arrow|^Digit|^Shift/.test(c) || c === 'Space')) ev.preventDefault();
  keys[c] = true;
  if (ev.repeat) return;
  if (c === 'Escape') { if (locked) return; if (mode === 'solo') toMenu(''); else if (confirm('Poistutaanko pelistä?')) { sock.emit('quit'); roomCode = ''; mode = 'solo'; toMenu(''); } return; }
  if (c === 'Digit9') soundOn = !soundOn;
  if (c === 'KeyP' && mode === 'solo' && app === 'fight') paused = !paused;
  if (app === 'end' && c === 'KeyR' && mode === 'solo') { role = 'aa'; startRound(); return; }
  if (role === 'aa' && (app === 'fight' || app === 'wait')) {
    if (c === 'Digit1' || c === 'Digit2' || c === 'Digit3') { cur = +c.slice(5) - 1; beep(700, 0.03, 0.08); }
    if (c === 'KeyZ' || c === 'KeyX') zoomI = (zoomI + 1) % ZOOMS.length;
    if (c === 'KeyL') { leadAid = !leadAid; safeLS.set('it_lead', leadAid ? '1' : '0'); }
    if (c === 'KeyT') { autoFire = !autoFire; safeLS.set('it_auto', autoFire ? '1' : '0'); }
    if (c === 'KeyR') { const b = bats[cur]; if (b && b.reloadT <= 0 && b.inMag < b.w.mag && b.ammo > 0) { b.ammo += b.inMag; b.inMag = 0; b.reloadT = b.w.reload; } }
  }
  if (role === 'pilot' && c === 'KeyV') pil.view = 1 - pil.view;
});
window.addEventListener('keyup', ev => { keys[ev.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseFire = touchFire = false; });
cv.addEventListener('mousedown', ev => {
  initAudio();
  if (app === 'place') return placeClick(ev.clientX * DPR, ev.clientY * DPR);
  if (app === 'end' && mode === 'solo') { role = 'aa'; startRound(); return; }
  if (role === 'aa' && app === 'fight') {
    if (!locked && cv.requestPointerLock && !isTouch) { try { cv.requestPointerLock(); } catch (e) { /* ei tukea */ } }
    if (ev.button === 0) mouseFire = true; if (ev.button === 2) zoomI = (zoomI + 1) % ZOOMS.length;
  }
});
window.addEventListener('mouseup', ev => { if (ev.button === 0) mouseFire = false; });
cv.addEventListener('contextmenu', ev => ev.preventDefault());
cv.addEventListener('wheel', ev => { if (role === 'aa' && app === 'fight') { zoomI = clamp(zoomI + (ev.deltaY > 0 ? -1 : 1), 0, ZOOMS.length - 1); ev.preventDefault(); } }, { passive: false });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === cv; if (!locked) mouseFire = false; });
function exitLock() { if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock(); }
document.addEventListener('mousemove', ev => {
  if (!locked || role !== 'aa' || app !== 'fight') return;
  const b = bats[cur]; if (!b) return;
  const s = 0.0022 / ZOOMS[zoomI];
  b.cAz += ev.movementX * s; b.cEl = clamp(b.cEl - ev.movementY * s, -5 * D2R, 85 * D2R);
});
function placeClick(x, y) {
  const m = mapRect(); let best = null, bd = 18 * V.lwk;
  for (const s of SITES) { const q = mapXY(m, s[0], s[2]), d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = s; } }
  if (!best) return;
  const other = placed.indexOf(best); if (other >= 0) placed[other] = null;
  placed[selW] = best; beep(800, 0.04, 0.1);
  const nx = placed.indexOf(null); if (nx >= 0) selW = nx;
  updateUI();
}
function aaControls(dt) {
  const b = bats[cur]; if (!b) return;
  const rate = 50 * D2R / ZOOMS[zoomI];
  const h = (any(['ArrowRight', 'KeyD']) ? 1 : 0) - (any(['ArrowLeft', 'KeyA']) ? 1 : 0), v = (any(['ArrowUp', 'KeyW']) ? 1 : 0) - (any(['ArrowDown', 'KeyS']) ? 1 : 0);
  b.cAz += h * rate * dt; b.cEl = clamp(b.cEl + v * rate * dt, -5 * D2R, 85 * D2R);
  if (tstick.L.on) { b.cAz += tstick.L.x * rate * 1.3 * dt; b.cEl = clamp(b.cEl - tstick.L.y * rate * 1.3 * dt, -5 * D2R, 85 * D2R); }
}
// kosketus: tähtäys vetämällä ruutua, ampumisnappi, patterinapit
let dragId = null, dragLast = null;
function setupTouch() {
  cv.addEventListener('pointerdown', ev => {
    if (ev.pointerType !== 'touch') return;
    if (app === 'place') { placeClick(ev.clientX * DPR, ev.clientY * DPR); return; }
    if (app === 'end' && mode === 'solo') { role = 'aa'; startRound(); return; }
    if (role === 'aa' && app === 'fight' && dragId === null) { dragId = ev.pointerId; dragLast = [ev.clientX, ev.clientY]; }
  });
  cv.addEventListener('pointermove', ev => {
    if (ev.pointerId !== dragId) return;
    const b = bats[cur]; if (!b) return;
    const s = 0.0045 / ZOOMS[zoomI], dx = ev.clientX - dragLast[0], dy = ev.clientY - dragLast[1]; dragLast = [ev.clientX, ev.clientY];
    b.cAz += dx * s; b.cEl = clamp(b.cEl + dy * s * -1, -5 * D2R, 85 * D2R);
  });
  const endDrag = ev => { if (ev.pointerId === dragId) dragId = null; };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
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
  const f = $('tFire');
  f.addEventListener('pointerdown', ev => { ev.preventDefault(); initAudio(); f.setPointerCapture(ev.pointerId); touchFire = true; f.classList.add('on'); });
  const off = () => { touchFire = false; f.classList.remove('on'); }; f.addEventListener('pointerup', off); f.addEventListener('pointercancel', off);
  const tap = (id, fn) => $(id).addEventListener('pointerdown', ev => { ev.preventDefault(); ev.stopPropagation(); initAudio(); fn(); });
  tap('tB1', () => { cur = 0; }); tap('tB2', () => { cur = 1; }); tap('tB3', () => { cur = 2; });
  tap('tZoom', () => { zoomI = (zoomI + 1) % ZOOMS.length; });
  tap('tLead', () => { leadAid = !leadAid; });
  tap('tView', () => { pil.view = 1 - pil.view; });
  tap('tExit', () => { if (confirm('Poistutaanko?')) { if (mode === 'duo' && sock) { sock.emit('quit'); roomCode = ''; mode = 'solo'; } toMenu(''); } });
}
function goFullscreen() { const el = document.documentElement; try { if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().then(() => { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); }).catch(() => {}); } catch (e) { /* ei tukea */ } }

// ===================== SILMUKKA =====================
let lastT = performance.now();
function update(dt) {
  animT += dt;
  for (const m of msgs) m.dur -= dt; while (msgs.length && msgs[0].dur <= 0) msgs.shift();
  if (app === 'menu' || app === 'place') { demoA += dt * 0.05; return; }
  if (paused) return;
  if (role === 'aa') {
    if (app === 'fight') {
      aaControls(dt);
      bats.forEach((b, i) => {
        let want = false;
        if (i === cur) want = mouseFire || touchFire || !!keys.Space;
        else if (autoFire) want = aiBat(b, dt);
        slewBat(b, dt); fireBat(b, dt, want);
      });
      if (mode === 'solo') updateSoloFlight(dt); else { updateRemoteDrones(dt); sendShots(dt); }
    }
  } else {
    if (app === 'fight' || app === 'wait') { if (app === 'fight') updatePilot(dt); else { const L = drones[0]; if (L) { L.p = madd(L.p, L.F, 0); } } if (app === 'fight') sendFormation(dt); }
    bats.forEach((b, i) => { if (aaAim[i]) { b.az = aaAim[i][0]; b.el = aaAim[i][1]; } });
  }
  updateBullets(dt);
  updateFalling(dt);
  for (const p of parts) { p.v[1] -= G * (p.g || 0) * dt; p.p = madd(p.p, p.v, dt); p.t -= dt; }
  parts = parts.filter(p => p.t > 0); if (parts.length > 1400) parts.splice(0, parts.length - 1400);
  for (const f of fires) f.t -= dt; fires = fires.filter(f => f.t > 0);
  if (mode === 'solo' && app === 'fight' && stats && drones.length && drones.every(d => !d.alive && !d.fall)) soloEnd();
}
function render() {
  ctx.clearRect(0, 0, SW, SH);
  let pos, f, zoom = 1, fog = [700, 2800];
  if (app === 'menu' || app === 'place' || (role === 'aa' && !bats.length)) {
    pos = [Math.sin(demoA) * 420, 210, Math.cos(demoA) * 420 - 40]; f = sub([0, 30, -40], pos); fog = [450, 1500];
  } else if (role === 'aa') {
    const b = bats[cur], d = batDir(b), side = norm(cross([0, 1, 0], d));
    pos = add(add(b.piv, scl(d, -1.6)), add([0, 1.0, 0], scl(side, 0.0))); f = d; zoom = ZOOMS[zoomI];
  } else {
    const L = drones[0] || { p: [0, 300, 0], F: [0, 0, 1] };
    const fh = norm([L.F[0], 0, L.F[2]]);
    if (pil.view === 1) { pos = toWd(L, [0, 0.6, 3.6]); f = L.F; }
    else {
      const want = add(madd(L.p, fh, -34), [0, 9, 0]);
      pilCam = pilCam ? add(pilCam, scl(sub(want, pilCam), 0.12)) : want; pos = pilCam; f = sub(madd(L.p, L.F, 30), pos);
    }
    fog = [600, 2600];
  }
  setView(pos, f, zoom, role === 'pilot' && pil.view === 1 && drones[0] ? drones[0].U : null);
  if (!G3 || G3.sw) drawSky2D(skyCtx);
  if (G3) {
    if (app === 'menu' || app === 'place') G3.clear(); else buildScene();
    const fg = G3.sw ? [fog[0] * 0.6, fog[1] * 0.64] : fog;
    try { G3.render(V, fg, FOGC); } catch (e) { console.error(e); if (!G3.sw) useSoftware(e.message || String(e)); }
  }
  if (app === 'place') drawPlace(ctx);
  if (app === 'fight' || app === 'wait' || app === 'end') { if (role === 'aa' && bats.length) drawAAHUD(ctx); if (role === 'pilot') drawPilotHUD(ctx); drawTop(ctx); }
  drawResult(ctx);
  drawDebug(ctx);
}
function frame(now) {
  const rawDt = Math.max(0, (now - lastT) / 1000), dt = Math.min(0.05, rawDt); lastT = now;
  try { update(dt); render(); updateAudio(); } catch (err) { console.error(err); }
  requestAnimationFrame(frame);
}

// ===================== KÄYNNISTYS =====================
$('bSolo').onclick = () => { initAudio(); mode = 'solo'; role = 'aa'; startRound(); };
$('bCreate').onclick = () => { mode = 'duo'; doCreate(); };
$('bJoin').onclick = () => { mode = 'duo'; connect(); showPane('pJoin'); setStatus(''); setTimeout(() => $('codeIn').focus(), 50); };
$('bJoinGo').onclick = () => doJoin($('codeIn').value);
$('bBack').onclick = () => { if (sock) sock.emit('quit'); roomCode = ''; mode = 'solo'; $('code').textContent = '----'; showPane('pMenu'); setStatus(''); };
$('bBegin').onclick = () => { initAudio(); sock.emit('begin'); };
$('r_aa').onclick = () => sock && sock.emit('role', 'aa'); $('r_pilot').onclick = () => sock && sock.emit('role', 'pilot');
for (let i = 0; i < 3; i++) $('w' + i).onclick = () => { selW = i; updateUI(); };
$('bPlaceRnd').onclick = randomPlace; $('bPlaceGo').onclick = confirmPlace;
$('bPlaceBack').onclick = () => { if (mode === 'duo') { if (confirm('Poistutaanko pelistä?')) { sock.emit('quit'); roomCode = ''; mode = 'solo'; toMenu(''); } } else toMenu(''); };
if (isTouch) { $('helpKeys').hidden = true; $('helpTouch').hidden = false; }
window.addEventListener('resize', () => setTimeout(resize, 60));
resize(); initRenderer(); buildMap(); setupTouch(); showPane('pMenu'); updateUI();
if (new URLSearchParams(location.search).get('k')) { mode = 'duo'; connect(); }
requestAnimationFrame(frame);
window.__IT = { get app() { return app; }, get bats() { return bats; }, get drones() { return drones; }, get stats() { return stats; }, get result() { return result; }, keys, randomPlace, confirmPlace,
  setCur: i => { cur = i; }, get fl() { return fl; }, get role() { return role; }, info: () => G3 && G3.info ? G3.info() : null };
})();
