// Nordic Combat – moninpelipalvelin (Socket.IO). Huone = nelikirjaiminen koodi, enintään 6 pelaajaa, vapaa liittyminen
// kesken ottelun. Pelaaja valitsee paitavärin; sama väri = sama tiimi (ei omien tulitusta, yhteiset kaadot, tiimin viestit).
// Liike lasketaan pelaajien selaimissa (ampujan näkymä ratkaisee osuman). Palvelin pitää kirjaa terveydestä, kuolemista,
// pisteistä, räjähdysten alueosumista, ympäristön jäljistä ja ammuslaatikoista; tiedot lähetetään myös myöhemmin liittyville.
import QRCode from 'qrcode';
import { COLORS, COLOR_HEX, colorName, MAX_PLAYERS, KILL_LIMIT, MAPS, CRATE_KINDS, CRATE_RESPAWN } from '../src/fps/shared.js';

const LETTERS = 'ABCDEFGHJKLMNPRSTUVXYZ';
const TIME_LIMIT = 600, SPAWN_PROTECT = 2.0, RESPAWN = 3.0;
// räjähteiden alueosuma: säde (m) ja enimmäisvahinko keskellä
const SPLASH = { rocket: { r: 6.5, dmg: 130 }, grenade: { r: 7.5, dmg: 140 } };
const fin = v => typeof v === 'number' && Number.isFinite(v);
const vec3 = a => Array.isArray(a) && a.length === 3 && a.every(fin);
const r2 = v => Math.round(v * 100) / 100;

export function attachFps(io, { ns = '/fps', path = '/', map = 1 } = {}) {
  const rooms = new Map();
  const nsp = io.of(ns);
  const MAPDEF = MAPS[map] || MAPS[1];
  const newCode = () => { for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += LETTERS[(Math.random() * LETTERS.length) | 0]; if (!rooms.has(c)) return c; } };

  // ---------- ammuslaatikot ----------
  function freeSpot(room, exclude = -1) {
    const spots = MAPDEF.crateSpots, taken = room.crates.filter(c => c.active).map(c => c.spot);
    const ok = spots.map((s, i) => i).filter(i => i !== exclude && taken.every(t => Math.hypot(spots[t][0] - spots[i][0], spots[t][1] - spots[i][1]) > 20));
    const pool = ok.length ? ok : spots.map((s, i) => i).filter(i => !taken.includes(i));
    return pool[(Math.random() * pool.length) | 0];
  }
  function resetCrates(room) {
    room.crates = [];
    for (let i = 0; i < MAPDEF.crates; i++) {
      const c = { i, kind: i % 2 ? 'rocket' : 'grenade', spot: -1, active: false, respawnT: 0 };
      room.crates.push(c); c.spot = freeSpot(room); c.active = true;
    }
  }
  const publicCrates = room => room.crates.map(c => ({ i: c.i, kind: c.kind, p: MAPDEF.crateSpots[c.spot], active: c.active }));

  function makeRoom(code) {
    const room = { code, players: new Map(), marks: [], seq: 0, t: 0, over: false, overT: 0, timer: null, crates: [] };
    resetCrates(room);
    room.timer = setInterval(() => tick(room, 0.05), 50);
    rooms.set(code, room);
    return room;
  }
  const publicPlayer = p => ({ id: p.id, name: p.name, color: p.color, kills: p.kills, deaths: p.deaths, hp: p.hp, alive: p.alive });
  function roster(room) { nsp.to(room.code).emit('roster', { code: room.code, players: [...room.players.values()].map(publicPlayer), t: room.t, limit: KILL_LIMIT, timeLimit: TIME_LIMIT }); }
  function closeIfEmpty(room) { if (room.players.size === 0) { clearInterval(room.timer); rooms.delete(room.code); } }
  function teams(room) {
    const m = new Map();
    for (const p of room.players.values()) { const t = m.get(p.color) || { color: p.color, kills: 0, deaths: 0, members: [] }; t.kills += p.kills; t.deaths += p.deaths; t.members.push(p.name); m.set(p.color, t); }
    return [...m.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }
  const teamLabel = t => t.members.length > 1 ? colorName(t.color) + ' TIIMI' : t.members[0];
  function newMatch(room) {
    room.marks = []; room.t = 0; room.over = false; room.overT = 0;
    for (const p of room.players.values()) { p.kills = 0; p.deaths = 0; p.hp = 100; p.alive = false; p.deadT = RESPAWN - 0.5; }
    resetCrates(room);
    nsp.to(room.code).emit('newmatch', {});
    nsp.to(room.code).emit('crates', publicCrates(room));
    roster(room);
  }
  function damage(room, target, by, dmg, info) {
    if (room.over || !target.alive || target.protect > 0) return;
    if (by && by !== target && by.color === target.color) return;            // ei omien tulitusta
    target.hp = Math.max(0, target.hp - dmg); target.lastHit = room.t;
    nsp.to(room.code).emit('hit', { t: target.id, by: by ? by.id : null, dmg: Math.round(dmg), hp: Math.round(target.hp), head: !!info.head, w: info.w, from: by ? by.pos : null });
    if (target.hp <= 0) {
      target.alive = false; target.deadT = 0; target.deaths++;
      if (by && by !== target) by.kills++; else if (by === target) target.kills = Math.max(0, target.kills - 1);
      nsp.to(room.code).emit('kill', { t: target.id, by: by ? by.id : null, w: info.w, head: !!info.head });
      roster(room);
      const top = teams(room)[0];
      if (top && top.kills >= KILL_LIMIT) endMatch(room, teamLabel(top) + ' VOITTI');
    }
  }
  function endMatch(room, why) {
    if (room.over) return;
    room.over = true; room.overT = 0;
    const rank = [...room.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).map(publicPlayer);
    nsp.to(room.code).emit('over', { why, rank, teams: teams(room) });
  }
  function tick(room, dt) {
    if (!room.over) { room.t += dt; if (room.t >= TIME_LIMIT) { const best = teams(room)[0]; endMatch(room, best ? 'AIKA LOPPUI · ' + teamLabel(best) + ' VOITTI' : 'AIKA LOPPUI'); } }
    else { room.overT += dt; if (room.overT > 12) newMatch(room); }
    for (const p of room.players.values()) {
      if (p.protect > 0) p.protect -= dt;
      if (!p.alive) p.deadT += dt;
      // terveys palautuu, jos osumia ei ole tullut 6 sekuntiin
      else if (p.hp < 100 && room.t - p.lastHit > 6) { p.hp = Math.min(100, p.hp + 15 * dt); }
    }
    let crateChange = false;
    for (const c of room.crates) if (!c.active) { c.respawnT -= dt; if (c.respawnT <= 0) { c.spot = freeSpot(room, c.spot); c.active = true; crateChange = true; } }
    if (crateChange) nsp.to(room.code).emit('crates', publicCrates(room));
    room.snapAcc = (room.snapAcc || 0) + dt;
    if (room.snapAcc >= 0.05) {
      room.snapAcc = 0;
      nsp.to(room.code).volatile.emit('snap', { t: r2(room.t), P: [...room.players.values()].map(p => [p.id, p.pos, p.yaw, p.pitch, p.w, p.flags, Math.round(p.hp), p.alive ? 1 : 0, p.protect > 0 ? 1 : 0]) });
    }
  }
  const validColor = c => (typeof c === 'string' && COLOR_HEX.has(c.toLowerCase()) ? c.toLowerCase() : null);

  nsp.on('connection', sock => {
    let room = null, me = null;
    const leave = () => {
      if (!room || !me) return;
      room.players.delete(me.id); sock.leave(room.code);
      nsp.to(room.code).emit('left', { id: me.id, name: me.name });
      roster(room); closeIfEmpty(room); room = null; me = null;
    };
    sock.on('create', async (d, cb) => {
      if (typeof cb !== 'function') return;
      leave();
      const r = makeRoom(newCode());
      const origin = d && typeof d.origin === 'string' && /^https?:\/\/[^\s]+$/.test(d.origin) ? d.origin : '';
      const url = origin + path + '?k=' + r.code;
      let qr = ''; try { qr = await QRCode.toDataURL(url, { margin: 1, width: 240 }); } catch (e) { /* ilman QR-koodia */ }
      cb({ code: r.code, url, qr });
    });
    sock.on('join', (d, cb) => {
      if (typeof cb !== 'function') return;
      const code = String((d && d.code) || '').toUpperCase().trim(), r = rooms.get(code);
      if (!r) return cb({ err: 'PELIÄ EI LÖYTYNYT' });
      if (r.players.size >= MAX_PLAYERS) return cb({ err: `PELI ON TÄYNNÄ (${MAX_PLAYERS} PELAAJAA)` });
      leave();
      const name = String((d && d.name) || 'PELAAJA').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 14).toUpperCase() || 'PELAAJA';
      me = { id: ++r.seq, name, color: validColor(d && d.color) || COLORS[0].hex, pos: [0, 0, 0], yaw: 0, pitch: 0, w: 0, flags: 0,
        hp: 100, alive: false, deadT: RESPAWN, protect: 0, kills: 0, deaths: 0, lastHit: -99, sock, lastChat: 0 };
      room = r; r.players.set(me.id, me); sock.join(code);
      cb({ ok: true, id: me.id, color: me.color, name: me.name, code, marks: r.marks, t: r.t, crates: publicCrates(r) });
      roster(r);
      sock.to(code).emit('joined', { id: me.id, name: me.name });
    });
    const inRoom = fn => (...a) => { if (room && me) fn(...a); };
    sock.on('color', inRoom(d => { const c = validColor(d && d.color); if (c && c !== me.color) { me.color = c; roster(room); } }));
    sock.on('st', inRoom(d => {
      if (!d || !me.alive || !vec3(d.p)) return;
      me.pos = d.p.map(r2); if (fin(d.y)) me.yaw = d.y; if (fin(d.x)) me.pitch = d.x; if (Number.isInteger(d.w)) me.w = d.w; if (Number.isInteger(d.f)) me.flags = d.f;
    }));
    sock.on('spawn', inRoom(d => {
      if (me.alive || me.deadT < RESPAWN - 0.6 || room.over || !d || !vec3(d.p)) return;
      me.alive = true; me.hp = 100; me.protect = SPAWN_PROTECT; me.pos = d.p.map(r2); me.lastHit = -99;
      nsp.to(room.code).emit('spawned', { id: me.id, p: me.pos });
      roster(room);
    }));
    // laukausten efektit (jäljet, välähdykset, äänet) muille sellaisenaan
    sock.on('fx', inRoom(d => { if (d && Array.isArray(d.S) && d.S.length <= 64) sock.to(room.code).volatile.emit('fx', { id: me.id, S: d.S }); }));
    sock.on('proj', inRoom(d => { if (d && vec3(d.o) && vec3(d.v) && (d.k === 'rocket' || d.k === 'grenade')) sock.to(room.code).emit('proj', { id: me.id, k: d.k, o: d.o, v: d.v, n: d.n | 0, fuse: fin(d.fuse) ? d.fuse : 0 }); }));
    sock.on('hit', inRoom(d => {
      if (!d || !me.alive) return;
      const t = room.players.get(d.t); if (!t || t === me) return;
      const dmg = Math.max(0, Math.min(250, +d.dmg || 0));
      damage(room, t, me, dmg, { head: !!d.head, w: d.w | 0 });
    }));
    // räjähdys: ampujan selain ratkaisee paikan, palvelin alueosuman ja tallentaa pysyvän jäljen
    sock.on('boom', inRoom(d => {
      if (!d || !vec3(d.p) || !SPLASH[d.k]) return;
      const s = SPLASH[d.k], n = vec3(d.n) ? d.n : [0, 1, 0];
      const mark = { k: d.k, p: d.p.map(r2), n: n.map(r2), seed: (Math.random() * 1e9) | 0, wall: !!d.wall, t: r2(room.t) };
      if (room.marks.length < 400) room.marks.push(mark);
      nsp.to(room.code).emit('boom', { id: me.id, n: d.n2 | 0, ...mark });
      for (const p of room.players.values()) {
        if (!p.alive) continue;
        const c = [p.pos[0], p.pos[1] + 1.0, p.pos[2]], dist = Math.hypot(c[0] - d.p[0], c[1] - d.p[1], c[2] - d.p[2]);
        if (dist > s.r) continue;
        let dmg = s.dmg * Math.pow(1 - dist / s.r, 1.4);
        if (p === me) dmg *= 0.5;                                   // oma räjähdys vahingoittaa puolella teholla
        if (Array.isArray(d.occ) && d.occ.includes(p.id)) dmg *= 0.2;   // seinän takana: vain pieni osa paineaallosta
        if (dmg >= 1) damage(room, p, me, dmg, { w: d.k === 'rocket' ? 6 : 7 });
      }
    }));
    // ammuslaatikon poiminta: palvelin tarkistaa etäisyyden ja ettei laatikkoa ole jo otettu
    sock.on('pickup', inRoom(d => {
      const c = room.crates[d && d.i | 0];
      if (!c || !c.active || !me.alive) return;
      const s = MAPDEF.crateSpots[c.spot];
      if (Math.hypot(me.pos[0] - s[0], me.pos[2] - s[1]) > 3.5) return;
      c.active = false; c.respawnT = CRATE_RESPAWN;
      nsp.to(room.code).emit('picked', { i: c.i, by: me.id, kind: c.kind, give: CRATE_KINDS[c.kind].give });
      nsp.to(room.code).emit('crates', publicCrates(room));
    }));
    // tiimiviestit: vain saman paitavärin pelaajille
    sock.on('chat', inRoom(d => {
      const now = Date.now(); if (now - me.lastChat < 600) return; me.lastChat = now;
      const text = String((d && d.text) || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 120);
      if (!text) return;
      const msg = { id: me.id, name: me.name, color: me.color, text };
      for (const p of room.players.values()) if (p.color === me.color) p.sock.emit('chat', msg);
    }));
    sock.on('quit', leave);
    sock.on('disconnect', leave);
  });
}
