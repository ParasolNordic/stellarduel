// Stellar Duel Online - palvelimen pelisimulaatio yhdelle pelihuoneelle.
// Kukin selain lentää omaa alustaan ja ilmoittaa sijaintinsa; palvelin ratkaisee osumat, ohjukset,
// törmäykset, vahingot ja voittajan.
'use strict';
const SD = require('./public/shared.js');
const { add, sub, scl, madd, dot, cross, vlen, norm, clamp, rnd, rndi, chance, randDir, oriFromForward,
  rotAxis, toWorld, toLocal, COL, MODELS, LASERS, MISSILES, SHIPDEF, BUDGET, MAXSPD, STS, ARENA_R, ROCK_R, ROCK_HP } = SD;

const r1 = v => [Math.round(v[0]*10)/10, Math.round(v[1]*10)/10, Math.round(v[2]*10)/10];
const r3 = v => [Math.round(v[0]*1000)/1000, Math.round(v[1]*1000)/1000, Math.round(v[2]*1000)/1000];
const okVec = v => Array.isArray(v) && v.length >= 3 && v.every(x => typeof x === 'number' && isFinite(x)) && Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2]) < 1e7;
const LAG_REWIND = 0.15;

function createGame(out) {
  let mode = 'select', modeT = 0, time = 0, tickN = 0;
  const sel = [{ laser: 0, mis: 2, ready: false }, { laser: 2, mis: 0, ready: false }];
  const wins = [0, 0], totals = [0, 0];
  let players = [], W = null, winner = null, prize = null, drawReason = '', evs = [], rocksDirty = false, nextId = 1;

  const ev = o => evs.push(o);
  const pmsg = (p, t, c = COL.WHITE, d = 2) => ev({ e: 'msg', id: p.id, t, c, d });
  const sfx = (n, id) => ev({ e: 'sfx', n, id });
  const other = p => players[1 - p.id];
  function sendSel() { out.all('sel', { sel: sel.map(s => ({ laser: s.laser, mis: s.mis, ready: s.ready })), wins, totals }); }
  function boom(e, k, col, big) { ev({ e: 'boom', k, p: r1(e.pos), o: [r3(e.r), r3(e.u), r3(e.f)], c: col, b: big ? 1 : 0, s: Math.round(e.speed || 0) }); }
  const rockPos = r => madd(r.p0, r.v, time - r.t0);
  function rockList() {
    return W.rocks.filter(r => !r.dead).map(r => ({ i: r.id, s: r.size, k: r.shape, p: r1(r.p0), v: r1(r.v), t: Math.round(r.t0*1000)/1000,
      a: r3(r.ax), w: Math.round(r.w*1000)/1000, o: [r3(r.o.r), r3(r.o.u), r3(r.o.f)] }));
  }
  function newRock(pos, size, vel) {
    return { id: nextId++, size, shape: rndi(0, 3), p0: pos, v: vel, t0: time, ax: randDir(), w: rnd(-0.4, 0.4),
      o: oriFromForward(randDir()), hp: ROCK_HP[size], dead: false };
  }

  // ---------------- tilat ----------------
  function goSelect() {
    mode = 'select'; modeT = 0; players = []; W = null; winner = null; prize = null;
    sel[0].ready = sel[1].ready = false; sendSel();
  }
  function newPlayer(i, pos) {
    const o = oriFromForward(i === 0 ? [1, 0, 0.32] : [-1, 0, -0.32]);
    const s = sel[i], mis = MISSILES[s.mis];
    return { id: i, def: SHIPDEF[i], pos: pos.slice(), r: o.r, u: o.u, f: o.f, speed: 140,
      shield: 100, hull: 100, heat: 0, overheat: false, laserCd: 0, beamT: 0, beamEnd: null, regenT: 0,
      laser: LASERS[s.laser], mis, missiles: mis.cnt, misCd: 0, flares: 8, flareCd: 0,
      lockP: 0, locked: false, dead: false, deathT: 0, hitFlash: 0, warnT: 0, boundT: 0, hitR: SHIPDEF[i].hitR,
      fire: false, fixN: 0, hist: [] };
  }
  function startMatch() {
    const seed = (Math.random() * 1e9) | 0; time = 0;
    const wd = SD.makeWorldData(seed);
    W = { st: wd.station, planets: wd.planets, missiles: [], flares: [],
      rocks: wd.rocks.map(r => Object.assign(r, { id: nextId++, hp: ROCK_HP[r.size], dead: false })) };
    players = [0, 1].map(i => newPlayer(i, wd.spawns[i]));
    winner = null; prize = null; mode = 'countdown'; modeT = 0;
    out.all('start', { seed, sp: players.map(p => ({ p: p.pos, r: p.r, u: p.u, f: p.f, s: p.speed })),
      lo: sel.map(s => ({ laser: s.laser, mis: s.mis })), rocks: rockList() });
  }
  function toVictory(w) {
    mode = 'victory'; modeT = 0; winner = w; wins[w.id]++;
    pmsg(w, 'VOITIT! LENNÄ ASEMALLE NOUTAMAAN PALKINTO', COL.LGREEN, 6);
  }
  function toDraw(reason) { mode = 'draw'; modeT = 0; drawReason = reason; }
  function startDocking() {
    mode = 'docking'; modeT = 0;
    const w = winner, hullB = Math.round(w.hull) * 40, misB = w.missiles * 250, flareB = w.flares * 100;
    prize = { id: w.id, base: 5000, hullB, misB, flareB, total: 5000 + hullB + misB + flareB };
    totals[w.id] += prize.total;
  }

  // ---------------- vahinko ja aseet ----------------
  function fix(p) { p.fixN++; out.to(p.id, 'fix', { n: p.fixN, p: p.pos, s: p.speed }); }
  function damage(p, d, src) {
    if (p.dead) return;
    p.hitFlash = 0.15; p.regenT = 2.5;
    if (p.shield >= d) p.shield -= d; else { p.hull -= d - p.shield; p.shield = 0; }
    sfx('hit', p.id);
    if (p.hull <= 0) killPlayer(p, src ? 'PELAAJA ' + (src.id + 1) + ' TUHOSI SINUT' : 'ALUKSESI TUHOUTUI');
  }
  function killPlayer(p, reason) {
    if (p.dead) return;
    p.dead = true; p.hull = 0; p.deathT = 0; p.lockP = 0; p.locked = false; p.beamT = 0; p.fire = false;
    boom(p, p.def.mk, p.def.col, true);
    pmsg(p, reason, COL.LRED, 6);
  }
  function posAt(p, t) {
    let best = p.pos;
    for (let k = p.hist.length - 1; k >= 0; k--) { best = p.hist[k][1]; if (p.hist[k][0] <= t) break; }
    return best;
  }
  function fireLaser(p) {
    const L = p.laser;
    if (p.laserCd > 0 || p.overheat) return;
    p.laserCd = L.cd; p.heat += L.heat;
    if (p.heat >= 100) { p.heat = 100; p.overheat = true; pmsg(p, 'LASER YLIKUUMENI', COL.ORANGE, 1.5); sfx('err', p.id); }
    p.beamT = Math.min(0.09, L.cd * 0.85);
    ev({ e: 'las', id: p.id });
    const t = [];
    const o = other(p);
    if (!o.dead) t.push({ e: o, pos: posAt(o, time - LAG_REWIND), r: o.hitR, kind: 'ship' });
    for (const r of W.rocks) if (!r.dead) t.push({ e: r, pos: rockPos(r), r: ROCK_R[r.size] * 0.85, kind: 'rock' });
    for (const m of W.missiles) if (!m.dead && m.owner !== p) t.push({ e: m, pos: m.pos, r: 16, kind: 'missile' });
    t.push({ e: null, pos: W.st.pos, r: STS * 1.05, kind: 'station' });
    let best = null, bt = L.range;
    for (const c of t) {
      const rel = sub(c.pos, p.pos), tt = dot(rel, p.f);
      if (tt <= 0 || tt > bt + c.r) continue;
      const perp = vlen(madd(rel, p.f, -tt));
      const assist = c.kind === 'ship' ? (1 + tt * 0.00035) * (L.wide || 1) : 1;
      if (perp < c.r * assist) { best = c; bt = Math.max(1, tt - c.r * 0.5); }
    }
    p.beamEnd = madd(p.pos, p.f, best ? bt : L.range);
    if (!best) return;
    const dmg = L.dmg * rnd(0.85, 1.15);
    if (best.kind === 'ship') damage(best.e, dmg, p);
    else if (best.kind === 'rock') hitRock(best.e, dmg);
    else if (best.kind === 'missile') { best.e.hp -= dmg; if (best.e.hp <= 0) killMissile(best.e); }
  }
  function hitRock(r, dmg) {
    if (r.dead) return;
    r.hp -= dmg;
    if (r.hp > 0) return;
    r.dead = true; rocksDirty = true;
    const pose = SD.rockPose(r, time);
    boom(Object.assign(pose, { speed: vlen(r.v) }), 'r' + r.size + '_' + r.shape, COL.GREY, r.size === 0);
    if (r.size < 2) for (let i = 0; i < 2; i++)
      W.rocks.push(newRock(madd(pose.pos, randDir(), ROCK_R[r.size] * 0.5), r.size + 1, madd(r.v, randDir(), rnd(30, 80))));
  }
  function fireMissile(p) {
    if (p.dead || p.misCd > 0) return;
    if (p.missiles <= 0) { pmsg(p, 'OHJUKSET LOPPU', COL.ORANGE, 1); sfx('err', p.id); return; }
    const M = p.mis, o = other(p), tgt = M.guided && p.locked && !o.dead ? o : null;
    p.missiles--; p.misCd = M.guided ? 0.7 : 0.25;
    const n = M.swarm || 1;
    for (let i = 0; i < n; i++) {
      let f = p.f;
      if (n > 1) f = norm(madd(madd(p.f, p.r, (i - 1) * 0.12), p.u, i === 1 ? 0.08 : -0.03));
      const ori = oriFromForward(f, p.u);
      W.missiles.push({ id: nextId++, mini: n > 1, def: M, owner: p, target: tgt,
        pos: madd(madd(madd(p.pos, p.f, 75), p.u, -16), p.r, (i - (n-1)/2) * 22), r: ori.r, u: ori.u, f: ori.f,
        speed: p.speed + 90, life: 13, age: 0, hp: 6, dead: false });
    }
    sfx('missile', p.id);
    if (tgt) { pmsg(o, 'OHJUS LÄHESTYY!', COL.LRED, 2.5); sfx('alarm', o.id); }
    else if (M.guided) pmsg(p, 'EI LUKITUSTA - SUORALENTO', COL.ORANGE, 1.2);
  }
  function dropFlares(p) {
    if (p.dead || p.flareCd > 0) return;
    if (p.flares <= 0) { pmsg(p, 'SOIHDUT LOPPU', COL.ORANGE, 1); sfx('err', p.id); return; }
    p.flares--; p.flareCd = 0.5;
    const fl = [];
    for (const s of [-1, 1]) {
      const f = { id: nextId++, isFlare: true, pos: madd(p.pos, p.u, -10),
        vel: add(scl(p.f, p.speed * 0.35), add(scl(p.r, s * rnd(50, 90)), scl(p.u, -rnd(30, 60)))), life: 3.6 };
      W.flares.push(f); fl.push(f);
    }
    let fooled = 0;
    for (const m of W.missiles) if (!m.dead && m.target === p && vlen(sub(m.pos, p.pos)) < 7000 && Math.random() > m.def.resist) { m.target = fl[fooled % 2]; fooled++; }
    const o = other(p);
    if (o.lockP > 0) { o.lockP = 0; o.locked = false; pmsg(o, 'LUKITUS KATKESI', COL.ORANGE, 1); }
    sfx('flare', p.id);
    pmsg(p, fooled ? 'SOIHTU HARHAUTTI ' + fooled + ' OHJUSTA' : 'SOIHDUT', fooled ? COL.LGREEN : COL.YELLOW, 1.2);
  }
  function updateLock(p, dt) {
    const o = other(p), M = p.mis, was = p.locked;
    if (!M.guided || o.dead || p.dead) { p.lockP = 0; p.locked = false; return; }
    const l = toLocal(p, sub(o.pos, p.pos));
    const ok = l[2] > 200 && l[2] < 8000 && Math.hypot(l[0], l[1]) / l[2] < 0.2;
    if (ok) p.lockP = Math.min(1, p.lockP + dt / M.lockT); else p.lockP = Math.max(0, p.lockP - dt * 1.5);
    p.locked = p.lockP >= 1;
    if (p.locked && !was) { sfx('locked', p.id); pmsg(o, 'SINUT ON LUKITTU!', COL.LRED, 1.5); }
  }
  function killMissile(m) {
    if (m.dead) return;
    m.dead = true; boom(m, m.mini ? 'mini' : 'missile', COL.WHITE, false);
  }
  function updateMissiles(dt) {
    for (const m of W.missiles) {
      if (m.dead) continue;
      m.life -= dt; m.age += dt;
      if (m.life <= 0) { killMissile(m); continue; }
      let t = m.target;
      if (t && (t.dead || (t.isFlare && t.life <= 0))) t = m.target = null;
      if (t && m.def.turn > 0) {
        const d = norm(sub(t.pos, m.pos)), ang = Math.acos(clamp(dot(m.f, d), -1, 1));
        if (ang > 1e-4) {
          const ax = norm(cross(m.f, d)), a = Math.min(ang, m.def.turn * dt);
          const o = oriFromForward(rotAxis(m.f, ax, a), m.u); m.r = o.r; m.u = o.u; m.f = o.f;
        }
      }
      m.speed = Math.min(m.def.spd, m.speed + 320*dt);
      m.pos = madd(m.pos, m.f, m.speed * dt);
      for (const p of players) {
        if (p.dead || (p === m.owner && m.age < 1.2)) continue;
        if (vlen(sub(p.pos, m.pos)) < p.hitR + 12) { killMissile(m); damage(p, m.def.dmg * rnd(0.9, 1.1), m.owner === p ? null : m.owner); break; }
      }
      if (m.dead) continue;
      if (t && t.isFlare && vlen(sub(t.pos, m.pos)) < 40) { killMissile(m); t.life = 0; continue; }
      for (const r of W.rocks) if (!r.dead && vlen(sub(rockPos(r), m.pos)) < ROCK_R[r.size] * 0.85) { killMissile(m); hitRock(r, m.def.dmg * 1.5); break; }
      if (m.dead) continue;
      if (SD.insideHull(SD.stationPose(W.st, time), MODELS.station.parts[0], m.pos, 0)) { killMissile(m); continue; }
      for (const pl of W.planets) if (vlen(sub(pl.pos, m.pos)) < pl.R) { killMissile(m); break; }
    }
    W.missiles = W.missiles.filter(m => !m.dead);
  }
  function updateFlares(dt) {
    for (const f of W.flares) { f.life -= dt; f.pos = madd(f.pos, f.vel, dt); f.vel = scl(f.vel, 1 - 0.5*dt); }
    W.flares = W.flares.filter(f => f.life > 0);
  }
  function collide(p) {
    for (const r of W.rocks) {
      if (r.dead) continue;
      const rp = rockPos(r), d = sub(p.pos, rp), dist = vlen(d), R = ROCK_R[r.size] * 0.85 + p.hitR * 0.6;
      if (dist > R) continue;
      damage(p, 12 + p.speed * 0.08, null);
      p.pos = madd(rp, scl(d, 1/(dist || 1)), R + 4); p.speed *= 0.4; fix(p);
      hitRock(r, 25);
      if (p.dead) return;
      pmsg(p, 'TÖRMÄYS!', COL.LRED, 1);
    }
    const pose = SD.stationPose(W.st, time), hit = SD.insideHull(pose, MODELS.station.parts[0], p.pos, 30);
    if (hit) {
      const l = hit.l;
      if (mode === 'victory' && p === winner && l[2] > STS * 0.75 && Math.hypot(l[0], l[1]) < 150 && dot(p.f, pose.f) < -0.8 && p.speed < 230) { startDocking(); return; }
      damage(p, 20 + p.speed * 0.1, null);
      p.pos = madd(p.pos, toWorld(pose, hit.face.n), 34 - hit.depth); p.speed *= 0.3; fix(p);
      if (!p.dead) pmsg(p, mode === 'victory' && p === winner ? 'OSU AUKKOON SUORAAN JA HITAASTI' : 'TÖRMÄYS ASEMAAN!', COL.LRED, 2);
    }
    for (const pl of W.planets) if (vlen(sub(p.pos, pl.pos)) < pl.R) { killPlayer(p, 'TÖRMÄSIT PLANEETTAAN'); return; }
    const o = other(p);
    if (!o.dead && p.id === 0) {
      const d = sub(p.pos, o.pos), dist = vlen(d);
      if (dist < p.hitR + o.hitR) {
        damage(p, 30, null); damage(o, 30, null);
        const n = scl(d, 1/(dist || 1)); p.pos = madd(p.pos, n, 45); o.pos = madd(o.pos, n, -45);
        p.speed *= 0.4; o.speed *= 0.4; fix(p); fix(o);
      }
    }
    if (vlen(p.pos) > ARENA_R && p.boundT <= 0) { p.boundT = 1; damage(p, 6, null); pmsg(p, 'PALAA TAISTELUALUEELLE!', COL.LRED, 1); }
  }
  function update(dt) {
    for (const p of players) {
      if (p.dead) { p.deathT += dt; continue; }
      p.laserCd -= dt; p.beamT -= dt; p.misCd -= dt; p.flareCd -= dt; p.hitFlash -= dt; p.warnT -= dt; p.regenT -= dt; p.boundT -= dt;
      p.heat = Math.max(0, p.heat - 16*dt);
      if (p.overheat && p.heat < 35) { p.overheat = false; pmsg(p, 'LASER JÄÄHTYNYT', COL.LGREEN, 1); }
      if (p.regenT <= 0 && p.shield < 100) p.shield = Math.min(100, p.shield + 7*dt);
      p.hist.push([time, p.pos.slice()]); if (p.hist.length > 90) p.hist.shift();
      const canAct = mode === 'fight' || (mode === 'victory' && p === winner);
      if (canAct && p.fire) fireLaser(p);
      if (mode === 'fight') updateLock(p, dt); else { p.lockP = 0; p.locked = false; }
      if (W.missiles.some(m => m.target === p && vlen(sub(m.pos, p.pos)) < 6000) && p.warnT <= 0) { sfx('alarm', p.id); p.warnT = 0.9; }
    }
    for (const p of players) if (!p.dead) { collide(p); if (mode === 'docking') return; }
    updateMissiles(dt); updateFlares(dt);
    W.rocks = W.rocks.filter(r => !r.dead);
    if (mode === 'fight') {
      const alive = players.filter(p => !p.dead);
      if (alive.length === 0) toDraw('MOLEMMAT ALUKSET TUHOUTUIVAT');
      else if (alive.length === 1) toVictory(alive[0]);
    } else if (mode === 'victory' && winner.dead) toDraw('VOITTAJA TUHOUTUI - PALKINTO JÄI NOUTAMATTA');
  }
  function snapshot() {
    const s = { t: Math.round(time*1000)/1000, m: mode, mt: Math.round(modeT*100)/100, w: winner ? winner.id : -1, dr: drawReason,
      wn: wins, tt: totals, pr: prize, E: evs };
    evs = [];
    if (W && players.length) {
      s.P = players.map(p => ({ p: r1(p.pos), f: r3(p.f), u: r3(p.u), s: Math.round(p.speed), sh: Math.round(p.shield),
        hu: Math.max(0, Math.round(p.hull)), he: Math.round(p.heat), oh: p.overheat ? 1 : 0, mi: p.missiles, fl: p.flares,
        lp: Math.round(p.lockP*100)/100, lk: p.locked ? 1 : 0, d: p.dead ? 1 : 0, dt: Math.round(p.deathT*10)/10,
        be: p.beamT > 0 && p.beamEnd ? r1(p.beamEnd) : 0, hf: p.hitFlash > 0 ? 1 : 0 }));
      s.M = W.missiles.map(m => [m.id, ...r1(m.pos), ...r3(m.f), ...r3(m.u), m.mini ? 1 : 0, m.target ? (m.target.isFlare ? -2 : m.target.id) : -1]);
      s.F = W.flares.map(f => [f.id, ...r1(f.pos)]);
    }
    out.all('S', s);
  }

  // ---------------- julkinen rajapinta ----------------
  return {
    begin() { goSelect(); },
    tick(dt) {
      time += dt; modeT += dt; tickN++;
      switch (mode) {
        case 'countdown': if (modeT >= 3) { mode = 'fight'; modeT = 0; } break;
        case 'fight': case 'victory': update(dt); break;
        case 'draw': update(dt); if (modeT > 5) goSelect(); break;
        case 'docking': if (modeT > 2) { mode = 'prize'; modeT = 0; } break;
        case 'prize': if (modeT > 60) goSelect(); break;
      }
      if (rocksDirty && W) { out.all('R', { rocks: rockList() }); rocksDirty = false; }
      if (tickN % 2 === 0) snapshot();
    },
    input(i, d) {
      const p = players[i];
      if (!p || p.dead || !d || d.n !== p.fixN) return;
      if (mode !== 'fight' && mode !== 'victory') { p.fire = false; return; }
      if (!okVec(d.p) || !okVec(d.f) || !okVec(d.u)) return;
      p.pos = d.p.slice(0, 3); p.f = norm(d.f); p.r = norm(cross(d.u, p.f)); p.u = cross(p.f, p.r);
      p.speed = clamp(+d.s || 0, 0, MAXSPD); p.fire = !!d.fire;
    },
    action(i, a) {
      const p = players[i];
      if (!p || p.dead) return;
      if (a === 'mis' && mode === 'fight') fireMissile(p);
      if (a === 'flare' && (mode === 'fight' || (mode === 'victory' && p === winner))) dropFlares(p);
    },
    select(i, d) {
      if (mode !== 'select' || !d) return;
      const s = sel[i], l = d.laser | 0, m = d.mis | 0;
      if (LASERS[l] && MISSILES[m] && LASERS[l].tier + MISSILES[m].tier <= BUDGET) { s.laser = l; s.mis = m; }
      s.ready = !!d.ready;
      sendSel();
      if (sel[0].ready && sel[1].ready) startMatch();
    },
    next() { if (mode === 'prize' || mode === 'draw') goSelect(); },
  };
}
module.exports = { createGame };
