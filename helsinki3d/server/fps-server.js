// Nordic Combat – moninpelipalvelin (Socket.IO). Huone = nelikirjaiminen koodi, enintään 6 pelaajaa, vapaa liittyminen
// kesken ottelun. Pelaaja valitsee paitavärin; sama väri = sama tiimi (ei omien tulitusta, yhteiset kaadot, tiimin viestit).
// Liike lasketaan pelaajien selaimissa (ampujan näkymä ratkaisee osuman). Palvelin pitää kirjaa terveydestä, kuolemista,
// pisteistä, räjähdysten alueosumista, ympäristön jäljistä ja ammuslaatikoista; tiedot lähetetään myös myöhemmin liittyville.
import QRCode from 'qrcode';
import { COLORS, COLOR_HEX, colorName, MAX_PLAYERS, KILL_LIMIT, MAPS, CRATE_KINDS, CRATE_RESPAWN, VEHICLES, VEHICLE_DMG, VEHICLE_WEAPONS, DIRECT_HIT } from '../src/fps/shared.js';

const LETTERS = 'ABCDEFGHJKLMNPRSTUVXYZ';
const TIME_LIMIT = 600, SPAWN_PROTECT = 2.0, RESPAWN = 3.0;
// räjähteiden alueosuma: säde (m) ja enimmäisvahinko keskellä
const SPLASH = { rocket: { r: 6.5, dmg: 130 }, grenade: { r: 7.5, dmg: 140 }, drone: { r: 7.5, dmg: 140 } };
const SPLASH_W = { rocket: 6, grenade: 7, drone: 11 };
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

  // ---------- ajoneuvot: kuljettajan selain simuloi liikkeen, palvelin omistajuuden, kestävyyden ja tuhoutumisen ----------
  function resetVehicles(room) {
    room.vehicles = (MAPDEF.vehicles || []).map((d, i) => ({ id: i + 1, type: d.type, spawn: d, pos: [d.p[0], null, d.p[1]], h: d.h || 0, pi: 0, ro: 0, ty: 0, tp: 0,
      s: 0, r: 0, agl: 0, driver: null, hp: VEHICLES[d.type].hp, alive: true, dis: false, rockets: 0, respawnT: 0 }));
  }
  const publicVehicles = room => room.vehicles.map(v => ({ id: v.id, type: v.type, p: v.pos, h: v.h, driver: v.driver, hp: Math.round(v.hp), alive: v.alive, dis: v.dis }));
  function freeVehicle(room, v) { if (!v || !v.driver) return; const d = room.players.get(v.driver); if (d) d.vehicle = null; v.driver = null; }
  const friendlyDriver = (room, v, by) => { const drv = v.driver && room.players.get(v.driver); return !!(by && drv && drv !== by && drv.color === by.color); };
  function destroyVehicle(room, v, by) {
    if (!v.alive) return;
    const drv = v.driver && room.players.get(v.driver);
    v.hp = 0; v.alive = false; v.respawnT = VEHICLES[v.type].respawn;
    nsp.to(room.code).emit('vboom', { v: v.id, p: v.pos, by: by ? by.id : null });
    if (drv) { freeVehicle(room, v); damage(room, drv, by || drv, 999, { w: 10, force: true }); }
    nsp.to(room.code).emit('vehicles', publicVehicles(room));
  }
  // luoti / ammus osuu suoraan (w = aseen indeksi)
  function vehicleDamage(room, v, by, dmg, w) {
    if (!v.alive || room.over || friendlyDriver(room, v, by)) return;
    const k = VEHICLE_DMG[v.type].bullet[w] || 0;
    if (k <= 0) return;
    v.hp -= dmg * k;
    if (v.hp > 0) nsp.to(room.code).emit('vhit', { v: v.id, hp: Math.round(v.hp), by: by ? by.id : null });
    else destroyVehicle(room, v, by);
  }
  // räjähdys ajoneuvon lähellä: kind = rocket | grenade | drone | he, dist = etäisyys keskiöstä, dmg = alueosuman vahinko
  function vehicleBlast(room, v, by, kind, dist, dmg) {
    if (!v.alive || room.over || friendlyDriver(room, v, by)) return;
    const direct = dist <= DIRECT_HIT;
    if (v.type === 'heli') {
      if (kind === 'rocket' && direct) return destroyVehicle(room, v, by);
      if ((kind === 'grenade' || kind === 'drone') && direct && (v.agl < 1.5 || kind === 'drone')) return destroyVehicle(room, v, by);
      if (kind === 'he') { v.hp -= dmg * VEHICLE_DMG.heli.he; } else return;
    } else if (v.type === 'apc') {
      if (kind !== 'rocket' || !direct) return;
      v.rockets++;
      if (v.rockets >= 2) return destroyVehicle(room, v, by);
      v.dis = true; v.hp = Math.min(v.hp, VEHICLES.apc.hp * 0.4);
      nsp.to(room.code).emit('vehicles', publicVehicles(room));
    } else {
      v.hp -= dmg * (kind === 'he' ? VEHICLE_DMG.moto.he : VEHICLE_DMG.moto.splash);
    }
    if (v.hp > 0) nsp.to(room.code).emit('vhit', { v: v.id, hp: Math.round(v.hp), by: by ? by.id : null, dis: v.dis });
    else destroyVehicle(room, v, by);
  }
  function makeRoom(code) {
    const room = { code, players: new Map(), marks: [], seq: 0, t: 0, over: false, overT: 0, timer: null, crates: [], vehicles: [] };
    resetCrates(room); resetVehicles(room);
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
    for (const p of room.players.values()) p.vehicle = null;
    resetVehicles(room);
    nsp.to(room.code).emit('newmatch', {});
    nsp.to(room.code).emit('vehicles', publicVehicles(room));
    nsp.to(room.code).emit('crates', publicCrates(room));
    roster(room);
  }
  const onMoto = (room, p) => { const v = p.vehicle && room.vehicles.find(x => x.id === p.vehicle); return !!(v && v.type === 'moto'); };
  function damage(room, target, by, dmg, info) {
    if (room.over || !target.alive || (target.protect > 0 && !info.force)) return;
    if (by && by !== target && by.color === target.color) return;            // ei omien tulitusta
    if (target.vehicle && !info.force && !onMoto(room, target)) return;     // ajoneuvossa: osumat menevät ajoneuvolle (moottoripyörän ajaja on suojaton)
    target.hp = Math.max(0, target.hp - dmg); target.lastHit = room.t;
    nsp.to(room.code).emit('hit', { t: target.id, by: by ? by.id : null, dmg: Math.round(dmg), hp: Math.round(target.hp), head: !!info.head, w: info.w, from: by ? by.pos : null });
    if (target.hp <= 0) {
      target.alive = false; target.deadT = 0; target.deaths++;
      if (target.vehicle) { freeVehicle(room, room.vehicles.find(v => v.id === target.vehicle)); nsp.to(room.code).emit('vehicles', publicVehicles(room)); }
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
    let vChange = false;
    for (const v of room.vehicles) if (!v.alive) { v.respawnT -= dt; if (v.respawnT <= 0) { Object.assign(v, { pos: [v.spawn.p[0], null, v.spawn.p[1]], h: v.spawn.h || 0, pi: 0, ro: 0, ty: 0, tp: 0, s: 0, r: 0, agl: 0, hp: VEHICLES[v.type].hp, alive: true, dis: false, rockets: 0, driver: null }); vChange = true; } }
    if (vChange) nsp.to(room.code).emit('vehicles', publicVehicles(room));
    room.snapAcc = (room.snapAcc || 0) + dt;
    if (room.snapAcc >= 0.05) {
      room.snapAcc = 0;
      nsp.to(room.code).volatile.emit('snap', { t: r2(room.t), P: [...room.players.values()].map(p => [p.id, p.pos, p.yaw, p.pitch, p.w, p.flags | (p.vehicle ? (onMoto(room, p) ? 8 : 4) : 0), Math.round(p.hp), p.alive ? 1 : 0, p.protect > 0 ? 1 : 0]),
        V: room.vehicles.map(v => [v.id, v.pos, v.h, v.pi, v.ro, v.ty, v.tp, v.driver || 0, Math.round(v.hp), v.alive ? 1 : 0, v.s, v.r, v.dis ? 1 : 0]) });
    }
  }
  const validColor = c => (typeof c === 'string' && COLOR_HEX.has(c.toLowerCase()) ? c.toLowerCase() : null);

  nsp.on('connection', sock => {
    let room = null, me = null;
    const leave = () => {
      if (!room || !me) return;
      if (me.vehicle) { freeVehicle(room, room.vehicles.find(v => v.id === me.vehicle)); nsp.to(room.code).emit('vehicles', publicVehicles(room)); }
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
      cb({ ok: true, id: me.id, color: me.color, name: me.name, code, marks: r.marks, t: r.t, crates: publicCrates(r), vehicles: publicVehicles(r) });
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
      if (d.k === 'drone') mark.k = 'grenade';
      nsp.to(room.code).emit('boom', { id: me.id, n: d.n2 | 0, drone: d.k === 'drone', ...mark });
      for (const p of room.players.values()) {
        if (!p.alive) continue;
        const c = [p.pos[0], p.pos[1] + 1.0, p.pos[2]], dist = Math.hypot(c[0] - d.p[0], c[1] - d.p[1], c[2] - d.p[2]);
        if (dist > s.r) continue;
        let dmg = s.dmg * Math.pow(1 - dist / s.r, 1.4);
        if (p === me) dmg *= 0.5;                                   // oma räjähdys vahingoittaa puolella teholla
        if (Array.isArray(d.occ) && d.occ.includes(p.id)) dmg *= 0.2;   // seinän takana: vain pieni osa paineaallosta
        if (dmg >= 1) damage(room, p, me, dmg, { w: SPLASH_W[d.k] });
      }
      blastVehicles(d.k, d.p, s);
    }));
    function blastVehicles(kind, p, s) {
      for (const v of room.vehicles) {
        if (!v.alive || v.pos[1] === null) continue;
        const dist = Math.hypot(v.pos[0] - p[0], v.pos[1] + 1.2 - p[1], v.pos[2] - p[2]);
        if (dist > s.r + 2) continue;
        vehicleBlast(room, v, me, kind, dist, s.dmg * Math.pow(Math.max(0, 1 - Math.max(0, dist - 1.5) / s.r), 1.2));
      }
    }
    // konetykin räjähtävä ammus: alueosuma ilman pysyviä jälkiä (rajoitettu tulinopeuteen)
    sock.on('he', inRoom(d => {
      if (!d || !vec3(d.p) || me.vehicle === null || me.vehicle === undefined) return;
      const veh = room.vehicles.find(x => x.id === me.vehicle); if (!veh || veh.type !== 'apc') return;
      const now = Date.now(); if (now - (me.lastHe || 0) < 200) return; me.lastHe = now;
      const s = VEHICLE_WEAPONS[8].he;
      for (const p of room.players.values()) {
        if (!p.alive || p === me) continue;
        const dist = Math.hypot(p.pos[0] - d.p[0], p.pos[1] + 1.0 - d.p[1], p.pos[2] - d.p[2]);
        if (dist > s.r) continue;
        const dmg = s.dmg * Math.pow(1 - dist / s.r, 1.2);
        if (dmg >= 1) damage(room, p, me, dmg, { w: 8 });
      }
      blastVehicles('he', d.p, s);
    }));
    // räjähdedrooni: omistajan selain lentää, palvelin välittää sijainnin ja alasampumisen
    sock.on('dst', inRoom(d => { if (!d || !vec3(d.p) || !me.alive) return; me.drone = true; sock.to(room.code).volatile.emit('dst', { id: me.id, p: d.p.map(r2), y: fin(d.y) ? d.y : 0, x: fin(d.x) ? d.x : 0 }); }));
    sock.on('dend', inRoom(d => { me.drone = false; sock.to(room.code).emit('dend', { id: me.id, boom: !!(d && d.boom) }); }));
    sock.on('dhit', inRoom(d => {
      const t = room.players.get(d && d.t); if (!t || !t.drone || t === me || t.color === me.color) return;
      t.drone = false; nsp.to(room.code).emit('ddown', { id: t.id, by: me.id });
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
    // ajoneuvot
    sock.on('venter', inRoom(d => {
      const v = room.vehicles.find(x => x.id === (d && d.v));
      if (!v || !v.alive || v.driver || !me.alive || me.vehicle || room.over) return;
      const r = VEHICLES[v.type].enterRadius + 1.5;
      if (v.pos[1] !== null && Math.hypot(me.pos[0] - v.pos[0], me.pos[2] - v.pos[2]) > r) return;
      v.driver = me.id; me.vehicle = v.id;
      nsp.to(room.code).emit('vehicles', publicVehicles(room));
    }));
    sock.on('vexit', inRoom(() => { const v = room.vehicles.find(x => x.id === me.vehicle); if (v) { freeVehicle(room, v); nsp.to(room.code).emit('vehicles', publicVehicles(room)); } }));
    sock.on('vst', inRoom(d => {
      const v = room.vehicles.find(x => x.id === (d && d.v));
      if (!v || v.driver !== me.id || !vec3(d.p)) return;
      v.pos = d.p.map(r2); for (const k of ['h', 'pi', 'ro', 'ty', 'tp', 's', 'r']) if (fin(d[k])) v[k] = Math.round(d[k] * 1000) / 1000;
      if (fin(d.g)) v.agl = d.g;
    }));
    sock.on('vhit', inRoom(d => {
      const v = room.vehicles.find(x => x.id === (d && d.v));
      if (!v || !me.alive || v.driver === me.id) return;
      vehicleDamage(room, v, me, Math.max(0, Math.min(250, +d.dmg || 0)), d.w | 0);
    }));
    // ajoneuvon pudotessa / törmätessä kuljettaja raportoi vaurion itselleen
    sock.on('vcrash', inRoom(d => {
      const v = room.vehicles.find(x => x.id === me.vehicle); if (!v || !v.alive) return;
      if (v.type === 'apc') return;                                         // panssariajoneuvo ei vaurioidu törmäyksistä
      if (d && d.kill) return destroyVehicle(room, v, null);                // kopteri osui rakennukseen
      v.hp -= Math.max(0, Math.min(400, +(d && d.dmg) || 0));
      if (v.hp <= 0) destroyVehicle(room, v, null); else nsp.to(room.code).emit('vhit', { v: v.id, hp: Math.round(v.hp), by: null });
    }));
    sock.on('quit', leave);
    sock.on('disconnect', leave);
  });
}
