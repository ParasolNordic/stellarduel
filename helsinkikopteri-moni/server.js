// Helsinkihelikopterit - HTTP- ja Socket.IO-palvelin. 1-3 pelaajaa omilla laitteillaan.
// Lento lasketaan pelaajan selaimessa; palvelin välittää tilat ja ratkaisee osumat, tuhot, portit ja voittajan.
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const compression = require('compression');
const KY = require('./public/kyhteinen.js');
const { RD, GUN } = KY;

const app = express();
require('../norobots.js')(app);                  // hakukoneet ja crawlerit estetty
app.use(compression());
app.get('/health', (req, res) => res.send('ok'));
const SHARED = ['kaupunki.js', 'kaupunki-mesh.js', 'gl3d.js', 'sw3d.js', 'shared.js', 'ajoneuvot.js', 'lisenssit.js', 'kosketus.js'];
for (const f of SHARED) app.get('/yhteiset/' + f, (req, res) => res.sendFile(path.join(__dirname, '..', 'helsinkiralli', 'public', f), { maxAge: '1h' }));
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });
const rooms = new Map();
const LETTERS = 'ABCDEFGHJKLMNPRSTUVXYZ';
const MODES = ['free', 'race', 'fight'];
const fin = v => typeof v === 'number' && Number.isFinite(v);
const vec = (a, n = 3) => Array.isArray(a) && a.length === n && a.every(fin);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vlen = a => Math.sqrt(dot(a, a));
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;

function newCode() { for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)]; if (!rooms.has(c)) return c; } }
function roster(room) {
  room.socks.forEach((s, i) => { if (s) s.emit('roster', { code: room.code, slots: room.socks.map(x => !!x), you: i, host: room.host, mode: room.mode, playing: !!room.game }); });
}
function closeRoom(room, reason) {
  stopGame(room);
  for (const s of room.socks) if (s) { s.leave(room.code); s.data.room = null; s.emit('left', { reason }); }
  rooms.delete(room.code);
}
function leave(sock) {
  const room = rooms.get(sock.data.room);
  if (!room) return;
  const idx = room.socks.indexOf(sock);
  if (idx >= 0) room.socks[idx] = null;
  sock.leave(room.code); sock.data.room = null;
  const left = room.socks.filter(Boolean).length;
  if (left === 0) { closeRoom(room, ''); return; }
  if (room.host === idx) room.host = room.socks.findIndex(Boolean);
  if (room.game) { room.game.remove(idx); io.to(room.code).emit('note', { t: KY.PNAME[idx] + ' POISTUI' }); }
  roster(room);
}
function stopGame(room) { if (room.timer) clearInterval(room.timer); room.timer = null; room.game = null; }

// ---------------- ottelu ----------------
function createGame(room) {
  const mode = room.mode, seed = (Math.random() * 1e9) | 0;
  const rings = mode === 'race' ? KY.makeRoute(seed, KY.RACE_RINGS) : [];
  const P = new Map();
  room.socks.forEach((s, i) => {
    if (!s) return;
    const pad = KY.PADS[i];
    P.set(i, { id: i, p: pad.slice(), F: [Math.sin(KY.OPEN_YAW), 0, Math.cos(KY.OPEN_YAW)], U: [0, 1, 0], v: [0, 0, 0], rot: 1,
      alive: true, hp: KY.HP, score: 0, deaths: 0, ring: 0, finT: null, deadT: 0, inv: 0, lastFire: 0, heat: 0, hot: false, seen: Date.now() });
  });
  const g = { mode, seed, P, t: 0, over: false, overT: 0, firstFin: null, started: false, cd: 3 };
  const all = (e, d) => io.to(room.code).emit(e, d);
  const ranking = () => {
    const arr = [...P.values()];
    if (mode === 'race') arr.sort((a, b) => (a.finT === null) - (b.finT === null) || (a.finT !== null ? a.finT - b.finT : b.ring - a.ring));
    else arr.sort((a, b) => b.score - a.score || a.deaths - b.deaths);
    return arr.map(p => ({ id: p.id, score: p.score, deaths: p.deaths, ring: p.ring, finT: p.finT }));
  };
  function endGame(why) {
    if (g.over) return;
    g.over = true; g.overT = 0;
    all('over', { why, rank: ranking() });
  }
  function spawnPoint(p) {
    if (mode === 'race') {
      if (p.ring > 0) { const r = rings[p.ring - 1], nx = rings[p.ring] ? rings[p.ring].c : KY.HOME; const d = sub(nx, r.c), L = Math.hypot(d[0], d[2]) || 1; return { p: r.c.slice(), yaw: Math.atan2(d[0] / L, d[2] / L), air: true }; }
      return { p: KY.PADS[p.id].slice(), yaw: KY.OPEN_YAW, air: false };
    }
    if (mode === 'fight') {
      // ilmassa satunnaisen kadun yllä, kauimpana muista
      let best = null;
      for (let k = 0; k < 24; k++) {
        const s = RD.KD.spawns[(Math.random() * RD.KD.spawns.length) | 0];
        let dmin = 1e9; for (const q of P.values()) if (q !== p && q.alive) dmin = Math.min(dmin, Math.hypot(q.p[0] - s[0], q.p[2] - s[1]));
        if (!best || dmin > best.d) best = { s, d: dmin };
      }
      const s = best.s, y = KY.maxRoofAround(s[0], s[1], 12) + 30;
      return { p: [s[0], y, s[1]], yaw: s[2], air: true };
    }
    return { p: KY.PADS[p.id].slice(), yaw: KY.OPEN_YAW, air: false };
  }
  function kill(p, by, why) {
    if (!p.alive) return;
    p.alive = false; p.deadT = 0; p.deaths++; p.hp = 0;
    if (by !== null && by !== undefined && P.has(by) && by !== p.id) P.get(by).score++;
    all('kill', { id: p.id, by: by === undefined ? null : by, why: why || '', p: p.p.map(r2), score: [...P.values()].map(q => [q.id, q.score, q.deaths]) });
    if (mode === 'fight' && by !== null && by !== undefined && P.has(by) && P.get(by).score >= KY.KILLS_TO_WIN) endGame(KY.PNAME[by] + ' VOITTI');
  }
  g.remove = i => { P.delete(i); if (P.size === 0) stopGame(room); else if (mode !== 'free' && P.size < 1) endGame('PELAAJAT POISTUIVAT'); };
  g.state = (i, d) => {
    const p = P.get(i); if (!p || !d) return;
    p.seen = Date.now();
    if (!p.alive) return;
    if (vec(d.p)) p.p = d.p; if (vec(d.F)) p.F = d.F; if (vec(d.U)) p.U = d.U; if (vec(d.v)) p.v = d.v; if (fin(d.r)) p.rot = d.r;
  };
  g.fire = (i, d) => {
    const p = P.get(i);
    if (mode !== 'fight' || g.over || !g.started || !p || !p.alive || !d || !vec(d.p) || !vec(d.d)) return;
    const now = Date.now() / 1000;
    if (now - p.lastFire < GUN.interval * 0.8 || p.hot) return;
    if (vlen(sub(d.p, p.p)) > 12) return;                         // laukaisupaikan pitää olla oman kopterin luona
    p.lastFire = now; p.heat += GUN.heatPer; if (p.heat >= GUN.overheat) { p.hot = true; p.heat = GUN.overheat; }
    const L = vlen(d.d); if (L < 0.5) return;
    const dir = [d.d[0] / L, d.d[1] / L, d.d[2] / L];
    const block = KY.W0.rayBlock(d.p, dir, GUN.range);
    let hit = null, ht = block;
    for (const q of P.values()) {
      if (q === p || !q.alive || q.inv > 0) continue;
      const c = [q.p[0] + q.U[0] * 1.4, q.p[1] + q.U[1] * 1.4, q.p[2] + q.U[2] * 1.4], to = sub(c, d.p), t = dot(to, dir);
      if (t < 0 || t > ht) continue;
      const perp = vlen([to[0] - dir[0] * t, to[1] - dir[1] * t, to[2] - dir[2] * t]);
      if (perp < GUN.hitR) { hit = q; ht = t; }
    }
    all('tr', { id: i, p: d.p.map(r2), d: dir.map(r3), l: r2(Math.min(ht, GUN.range)), h: hit ? hit.id : -1 });
    if (hit) {
      hit.hp -= GUN.dmg;
      if (hit.hp <= 0) kill(hit, i, 'AMMUTTU ALAS'); else all('hit', { id: hit.id, by: i, hp: hit.hp });
    }
  };
  g.crash = (i, d) => { const p = P.get(i); if (!p || !p.alive || g.over) return; kill(p, null, (d && typeof d.why === 'string') ? d.why.slice(0, 60) : 'TUHOUTUI'); };
  g.ring = (i, d) => {
    const p = P.get(i); if (mode !== 'race' || !p || !p.alive || g.over || !d || d.i !== p.ring) return;
    const r = rings[p.ring]; if (!r || vlen(sub(p.p, r.c)) > r.r + 25) return;
    p.ring++;
    all('ring', { id: i, ring: p.ring });
  };
  g.landed = i => {
    const p = P.get(i); if (mode !== 'race' || !p || !p.alive || g.over || p.ring < rings.length || p.finT !== null) return;
    if (Math.hypot(p.p[0] - KY.HOME[0], p.p[2] - KY.HOME[2]) > 30) return;
    p.finT = Math.round(g.t * 10) / 10;
    if (g.firstFin === null) g.firstFin = g.t;
    all('fin', { id: i, t: p.finT, place: [...P.values()].filter(q => q.finT !== null).length });
    if ([...P.values()].every(q => q.finT !== null)) endGame('KAIKKI MAALISSA');
  };
  g.tick = dt => {
    if (g.cd > 0) { g.cd -= dt; if (g.cd <= 0) { g.started = true; all('go', {}); } }
    else if (!g.over) g.t += dt;
    for (const p of P.values()) {
      p.heat = Math.max(0, p.heat - GUN.cool * dt); if (p.hot && p.heat <= 0.25) p.hot = false;
      if (p.inv > 0) p.inv -= dt;
      if (!p.alive && !g.over) {
        p.deadT += dt;
        if (p.deadT > 4) {
          const s = spawnPoint(p);
          p.alive = true; p.hp = KY.HP; p.p = s.p; p.v = [0, 0, 0]; p.F = [Math.sin(s.yaw), 0, Math.cos(s.yaw)]; p.U = [0, 1, 0]; p.inv = mode === 'fight' ? 3 : 0;
          all('spawn', { id: p.id, p: s.p.map(r2), yaw: r3(s.yaw), air: s.air, hp: p.hp });
        }
      }
    }
    // taistelussa törmäys toiseen kopteriin tuhoaa molemmat
    if (mode === 'fight' && g.started && !g.over) {
      const arr = [...P.values()].filter(p => p.alive && p.inv <= 0);
      for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) if (vlen(sub(arr[a].p, arr[b].p)) < 5.5) { kill(arr[a], null, 'TÖRMÄYS'); kill(arr[b], null, 'TÖRMÄYS'); }
    }
    if (!g.over) {
      if (mode === 'fight' && g.t >= KY.FIGHT_TIME) { const rk = ranking(); endGame(rk.length > 1 && rk[0].score === rk[1].score ? 'AIKA LOPPUI · TASAPELI' : 'AIKA LOPPUI · ' + KY.PNAME[rk[0].id] + ' VOITTI'); }
      if (mode === 'race' && g.firstFin !== null && g.t - g.firstFin > 90) endGame('AIKA LOPPUI');
      if (mode === 'race' && g.t > 900) endGame('AIKA LOPPUI');
    } else {
      g.overT += dt;
      if (g.overT > 12) { stopGame(room); roster(room); all('lobby', {}); return; }
    }
    // tilannekuva 20 Hz
    g.snapAcc = (g.snapAcc || 0) + dt;
    if (g.snapAcc >= 0.05) {
      g.snapAcc = 0;
      all('S', { t: r2(g.t), cd: r2(Math.max(0, g.cd)), P: [...P.values()].map(p => [p.id, p.p.map(r2), p.F.map(r3), p.U.map(r3), p.v.map(r2), p.alive ? 1 : 0, Math.max(0, p.hp), p.score, p.ring, r2(p.heat), p.hot ? 1 : 0, p.inv > 0 ? 1 : 0, p.rot]) });
    }
  };
  g.startInfo = i => ({ mode, seed, you: i, slots: [...P.keys()], pads: KY.PADS, rings: rings.length });
  return g;
}
function startGame(room) {
  stopGame(room);
  room.game = createGame(room);
  room.socks.forEach((s, i) => { if (s) s.emit('start', room.game.startInfo(i)); });
  roster(room);
  let last = Date.now();
  room.timer = setInterval(() => {
    const now = Date.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    try { if (room.game) room.game.tick(dt); } catch (err) { console.error('tick', err); }
  }, 1000 / 40);
}

io.on('connection', sock => {
  sock.data.room = null;
  sock.on('create', async (d, cb) => {
    if (typeof cb !== 'function') return;
    leave(sock);
    const code = newCode();
    const room = { code, socks: [sock, null, null], host: 0, mode: 'free', game: null, timer: null };
    rooms.set(code, room); sock.data.room = code; sock.join(code);
    const origin = (d && typeof d.origin === 'string' && /^https?:\/\/[^\s]+$/.test(d.origin)) ? d.origin : '';
    const url = origin + '/?k=' + code;
    let qr = '';
    try { qr = await QRCode.toDataURL(url, { margin: 1, width: 260 }); } catch (e) { /* ilman QR-koodia */ }
    cb({ code, qr, url });
    roster(room);
  });
  sock.on('join', (d, cb) => {
    if (typeof cb !== 'function') return;
    const code = String((d && d.code) || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb({ err: 'PELIÄ EI LÖYTYNYT' });
    if (room.socks.includes(sock)) return cb({ err: 'OLET JO TÄSSÄ PELISSÄ' });
    if (room.game) return cb({ err: 'PELI ON KÄYNNISSÄ - ODOTA ERÄN LOPPUA' });
    const idx = room.socks.indexOf(null);
    if (idx < 0) return cb({ err: 'PELI ON TÄYNNÄ (3 PELAAJAA)' });
    leave(sock);
    room.socks[idx] = sock; sock.data.room = code; sock.join(code);
    cb({ ok: true });
    roster(room);
  });
  sock.on('mode', m => { const room = rooms.get(sock.data.room); if (room && !room.game && room.socks[room.host] === sock && MODES.includes(m)) { room.mode = m; roster(room); } });
  sock.on('begin', () => { const room = rooms.get(sock.data.room); if (room && !room.game && room.socks[room.host] === sock) startGame(room); });
  const withGame = fn => (...a) => { const r = rooms.get(sock.data.room); if (r && r.game) fn(r.game, r.socks.indexOf(sock), ...a); };
  sock.on('st', withGame((g, i, d) => g.state(i, d)));
  sock.on('fire', withGame((g, i, d) => g.fire(i, d)));
  sock.on('crash', withGame((g, i, d) => g.crash(i, d)));
  sock.on('ring', withGame((g, i, d) => g.ring(i, d)));
  sock.on('landed', withGame((g, i) => g.landed(i)));
  sock.on('png', (t, cb) => { if (typeof cb === 'function') cb(t); });
  sock.on('quit', () => leave(sock));
  sock.on('disconnect', () => leave(sock));
});

const PORT = process.env.PORT || 3004;
server.listen(PORT, () => console.log('Helsinkihelikopterit portissa ' + PORT));
