// Vektoriralli - palvelimen pelisimulaatio yhdelle huoneelle (2-3 pelaajaa).
// Kukin selain ajaa omaa autoaan ja ilmoittaa sijaintinsa; palvelin ratkaisee osumat, ammukset,
// miinat, öljyläikät, autojen väliset törmäykset, vahingot ja voittajan.
'use strict';
const RD = require('./public/shared.js');
const { add, sub, scl, madd, dot, cross, vlen, norm, clamp, rnd, chance, H, normalAt, CARS, GUNS, SPECIALS, SPAWNS, CAR_R } = RD;
const WORLD = RD.buildWorld();
const r1 = v => v.map(x => Math.round(x * 10) / 10);
const okNum = x => typeof x === 'number' && isFinite(x) && Math.abs(x) < 1e6;
const fwd = yaw => [Math.sin(yaw), 0, Math.cos(yaw)];

function createGame(slots, out) {
  let mode = 'select', modeT = 0, time = 0, tickN = 0, winner = -1, evs = [], nextId = 1;
  const wins = [0, 0, 0];
  const P = slots.map(i => ({ id: i, sel: { car: i % 4, gun: 0, spec: i % 3, ready: false }, active: true }));
  let rockets = [], mines = [], oils = [];
  const ev = o => evs.push(o);
  const pmsg = (p, t, c = '#ffffff', d = 2) => ev({ e: 'msg', id: p.id, t, c, d });
  const alive = () => P.filter(p => p.active && !p.dead);
  const sendSel = () => out.all('sel', { sel: P.map(p => ({ id: p.id, car: p.sel.car, gun: p.sel.gun, spec: p.sel.spec, ready: p.sel.ready, on: p.active })), wins });
  const byId = id => P.find(p => p.id === id);

  function goSelect() {
    mode = 'select'; modeT = 0; winner = -1; rockets = []; mines = []; oils = [];
    for (const p of P) p.sel.ready = false;
    sendSel();
  }
  function startRound() {
    time = 0; rockets = []; mines = []; oils = []; pairCd.clear();
    P.forEach((p, k) => {
      const sp = SPAWNS[p.id], c = CARS[p.sel.car];
      Object.assign(p, { pos: [sp.x, H(sp.x, sp.z), sp.z], yaw: sp.yaw, speed: 0, vel: [0, 0], steer: 0, hp: c.hp, maxHp: c.hp, dead: !p.active,
        gun: GUNS[p.sel.gun], spec: SPECIALS[p.sel.spec], ammo: SPECIALS[p.sel.spec].cnt, gunCd: 0, specCd: 0, fire: false,
        fixN: 0, hist: [], spinCd: 0, kills: 0, car: c });
    });
    mode = 'countdown'; modeT = 0;
    out.all('start', { cars: P.map(p => ({ id: p.id, car: p.sel.car, gun: p.sel.gun, spec: p.sel.spec, on: p.active, p: p.pos, yaw: p.yaw })) });
  }
  // ---------------- vahinko ----------------
  function damage(p, dmg, by, worldPt, kind) {
    if (p.dead || dmg <= 0) return;
    p.hp -= dmg;
    // lommo: osumakohta auton paikallisissa koordinaateissa (vain kääntymä huomioidaan)
    let lp = null;
    if (worldPt) {
      const d = sub(worldPt, p.pos), f = fwd(p.yaw), r = [f[2], 0, -f[0]];
      lp = [Math.round(dot(d, r) * 100) / 100, clamp(Math.round((d[1]) * 100) / 100, 0.3, 1.8), Math.round(dot(d, f) * 100) / 100];
    }
    ev({ e: 'hit', id: p.id, by: by ? by.id : -1, hp: Math.max(0, Math.round(p.hp)), lp, ds: Math.min(1, dmg / 25), k: kind });
    if (p.hp <= 0) {
      p.dead = true; p.hp = 0; p.fire = false;
      if (by && by !== p) by.kills++;
      ev({ e: 'boom', p: r1(add(p.pos, [0, 1, 0])), b: 1 });
      ev({ e: 'kill', id: p.id, by: by ? by.id : -1 });
      pmsg(p, by && by !== p ? RD.PNAME[by.id] + ' TUHOSI AUTOSI' : 'AUTOSI TUHOUTUI', '#ff6060', 5);
      if (by && by !== p) pmsg(by, 'TUHOSIT: ' + RD.PNAME[p.id], '#9dff9d', 2.5);
    }
  }
  function posAt(p, t) {
    let best = p.pos;
    for (let k = p.hist.length - 1; k >= 0; k--) { best = p.hist[k][1]; if (p.hist[k][0] <= t) break; }
    return best;
  }
  function aimDir(p) {
    const n = normalAt(p.pos[0], p.pos[2]), f0 = fwd(p.yaw);
    let dir = norm(madd(f0, n, -dot(f0, n)));
    const from = add(p.pos, [0, 1.3, 0]);
    // kevyt automaattitähtäys (helpottaa erityisesti puhelimella)
    let best = null, ba = 0.11;
    for (const q of alive()) {
      if (q === p) continue;
      const to = sub(add(posAt(q, time - 0.1), [0, 1.0, 0]), from), dist = vlen(to);
      if (dist > p.gun.range) continue;
      const a = Math.acos(clamp((to[0] * dir[0] + to[2] * dir[2]) / (Math.hypot(to[0], to[2]) * Math.hypot(dir[0], dir[2]) || 1), -1, 1));
      if (a < ba) { ba = a; best = to; }
    }
    if (best) dir = norm(best);
    return { from, dir };
  }
  function terrainBlock(p, d, maxT) {
    for (let t = 8; t < maxT; t += 8) { const q = madd(p, d, t); if (q[1] < H(q[0], q[2]) - 0.3) return t; }
    return maxT;
  }
  function fireGun(p) {
    const g = p.gun;
    p.gunCd = g.cd;
    const { from, dir } = aimDir(p);
    const ends = [], dmgs = new Map();
    for (let k = 0; k < g.pellets; k++) {
      const d = norm([dir[0] + rnd(-g.spread, g.spread), dir[1] + rnd(-g.spread, g.spread) * 0.5, dir[2] + rnd(-g.spread, g.spread)]);
      let bt = Math.min(WORLD.rayBlock(from, d, g.range), terrainBlock(from, d, g.range)), hitP = null;
      for (const q of P) {
        if (q === p || !q.active) continue;
        const c = add(posAt(q, time - 0.1), [0, 1.0, 0]), rel = sub(c, from), t = dot(rel, d);
        if (t <= 0 || t > bt) continue;
        if (vlen(madd(rel, d, -t)) < 2.4) { bt = t; hitP = q; }
      }
      const end = madd(from, d, bt);
      ends.push(r1(end));
      if (hitP && !hitP.dead) { const o = dmgs.get(hitP) || { dmg: 0, pt: end }; o.dmg += g.dmg; dmgs.set(hitP, o); }
    }
    ev({ e: 'shot', id: p.id, a: r1(from), b: ends, k: p.sel.gun });
    for (const [q, o] of dmgs) damage(q, o.dmg, p, add(posAt(q, time - 0.1), sub(o.pt, posAt(q, time - 0.1))), 'gun');
  }
  function useSpecial(p) {
    if (p.dead || mode !== 'fight' || p.specCd > 0) return;
    if (p.ammo <= 0) { pmsg(p, 'ERIKOISASE TYHJÄ', '#ffb060', 1); return; }
    p.ammo--; p.specCd = 0.6;
    const f = fwd(p.yaw);
    if (p.spec.nm === 'RAKETIT') {
      const { from, dir } = aimDir(p);
      rockets.push({ id: nextId++, owner: p, pos: madd(from, dir, 3), dir, life: 3.2 });
      ev({ e: 'sfx', n: 'rocket', id: p.id });
    } else if (p.spec.nm === 'MIINAT') {
      const x = p.pos[0] - f[0] * 4.5, z = p.pos[2] - f[2] * 4.5;
      mines.push({ id: nextId++, owner: p, x, z, y: H(x, z), arm: 1.0, life: 150 });
      ev({ e: 'sfx', n: 'drop', id: p.id });
    } else {
      const x = p.pos[0] - f[0] * 6, z = p.pos[2] - f[2] * 6;
      oils.push({ id: nextId++, owner: p, x, z, r: 7.5, life: 25 });
      ev({ e: 'sfx', n: 'drop', id: p.id });
    }
  }
  function explode(pos, dmg, radius, by, direct) {
    ev({ e: 'boom', p: r1(pos), b: 0 });
    for (const q of alive()) {
      const d = vlen(sub(add(q.pos, [0, 1, 0]), pos));
      if (q === direct) damage(q, dmg, by, pos, 'blast');
      else if (d < radius) damage(q, dmg * 0.5 * (1 - d / radius), by, pos, 'blast');
    }
  }
  function updateWeapons(dt) {
    for (const r of rockets) {
      r.life -= dt;
      const step = 120 * dt;
      let hit = null;
      for (let s = 0; s < 3 && !hit; s++) {
        r.pos = madd(r.pos, r.dir, step / 3);
        for (const q of alive()) if (q !== r.owner || r.life < 2.8) if (vlen(sub(add(q.pos, [0, 1, 0]), r.pos)) < 3) { hit = q; break; }
        if (hit) break;
        if (r.pos[1] < H(r.pos[0], r.pos[2]) || r.life <= 0) { hit = 'x'; break; }
        for (const o of WORLD.nearObstacles(r.pos[0], r.pos[2])) {
          if (o.kind !== undefined) { if (r.pos[0] > o.x0 && r.pos[0] < o.x1 && r.pos[2] > o.z0 && r.pos[2] < o.z1 && r.pos[1] < o.h) { hit = 'x'; break; } }
          else if (Math.hypot(r.pos[0] - o.x, r.pos[2] - o.z) < 1.5 && r.pos[1] < o.y + o.h) { hit = 'x'; break; }
        }
      }
      if (hit) { r.dead = true; explode(r.pos, r.owner.spec.dmg, r.owner.spec.splash, r.owner, hit === 'x' ? null : hit); }
    }
    rockets = rockets.filter(r => !r.dead);
    for (const m of mines) {
      m.arm -= dt; m.life -= dt;
      if (m.arm > 0) continue;
      for (const q of alive()) if (Math.hypot(q.pos[0] - m.x, q.pos[2] - m.z) < 3.6) {
        m.dead = true; explode([m.x, m.y + 0.5, m.z], 38, 7, m.owner, q); break;
      }
      if (m.life <= 0) m.dead = true;
    }
    mines = mines.filter(m => !m.dead);
    for (const o of oils) {
      o.life -= dt;
      for (const q of alive()) if (q.spinCd <= 0 && Math.hypot(q.pos[0] - o.x, q.pos[2] - o.z) < o.r) {
        q.spinCd = 2.5; out.to(q.id, 'spin', { t: 1.6 }); pmsg(q, 'ÖLJYÄ! LIUKASTA!', '#ffd060', 1.5); ev({ e: 'sfx', n: 'skid', id: q.id });
      }
    }
    oils = oils.filter(o => o.life > 0);
  }
  // Autojen väliset törmäykset: kukin selain erottaa ja kimmottaa oman autonsa itse (ei viiveellisiä
  // sijaintikorjauksia, jotka saivat autot juuttumaan toisiinsa). Palvelin laskee vain vahingon.
  const pairCd = new Map();
  function carCollisions() {
    const list = P.filter(p => p.active && p.pos);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.dead && b.dead) continue;
      const dx = b.pos[0] - a.pos[0], dz = b.pos[2] - a.pos[2], dist = Math.hypot(dx, dz);
      if (dist > CAR_R * 2 * 1.1 || Math.abs(a.pos[1] - b.pos[1]) > 3) continue;
      const key = a.id * 10 + b.id;
      if ((pairCd.get(key) || 0) > time) continue;
      const n = [dx / (dist || 1), dz / (dist || 1)];
      const va = a.dead ? [0, 0] : a.vel, vb = b.dead ? [0, 0] : b.vel;
      const vn = (va[0] - vb[0]) * n[0] + (va[1] - vb[1]) * n[1];
      if (vn < 2) continue;
      pairCd.set(key, time + 0.7);
      const ma = a.dead ? 1e9 : a.car.mass, mb = b.dead ? 1e9 : b.car.mass, ja = mb / (ma + mb), jb = ma / (ma + mb);
      if (!a.dead) damage(a, vn * 0.42 * ja * 2, b.dead ? null : b, add(a.pos, [n[0] * CAR_R, 0.8, n[1] * CAR_R]), 'crash');
      if (!b.dead) damage(b, vn * 0.42 * jb * 2, a.dead ? null : a, add(b.pos, [-n[0] * CAR_R, 0.8, -n[1] * CAR_R]), 'crash');
      ev({ e: 'sfx', n: 'crash', id: a.id }); ev({ e: 'sfx', n: 'crash', id: b.id });
    }
  }
  function update(dt) {
    for (const p of P) {
      if (!p.active || p.dead) continue;
      p.gunCd -= dt; p.specCd -= dt; p.spinCd -= dt;
      p.hist.push([time, p.pos.slice()]); if (p.hist.length > 60) p.hist.shift();
      if (mode === 'fight' && p.fire && p.gunCd <= 0) fireGun(p);
      if (Math.hypot(p.pos[0], p.pos[2]) > RD.BOUND + 60) damage(p, 8 * dt, null, null, 'bound');
    }
    carCollisions();
    updateWeapons(dt);
    if (mode === 'fight') {
      const al = alive();
      if (al.length <= 1) {
        mode = 'over'; modeT = 0; winner = al.length ? al[0].id : -1;
        if (winner >= 0) { wins[winner]++; pmsg(al[0], 'VOITIT KIERROKSEN!', '#9dff9d', 5); }
      }
    }
  }
  function snapshot() {
    const s = { t: Math.round(time * 1000) / 1000, m: mode, mt: Math.round(modeT * 100) / 100, w: winner, wn: wins, E: evs };
    evs = [];
    if (mode !== 'select') {
      s.P = P.filter(p => p.pos).map(p => ({ i: p.id, p: r1(p.pos), y: Math.round(p.yaw * 1000) / 1000, s: Math.round(p.speed * 10) / 10,
        st: Math.round(p.steer * 100) / 100, v: p.vel ? p.vel.map(x => Math.round(x * 10) / 10) : [0, 0], hp: Math.max(0, Math.round(p.hp)), d: p.dead ? 1 : 0, am: p.ammo, on: p.active ? 1 : 0, k: p.kills }));
      s.K = rockets.map(r => [r.id, ...r1(r.pos), ...r.dir.map(x => Math.round(x * 100) / 100)]);
      s.M = mines.map(m => [m.id, Math.round(m.x * 10) / 10, Math.round(m.z * 10) / 10, m.arm <= 0 ? 1 : 0]);
      s.O = oils.map(o => [o.id, Math.round(o.x), Math.round(o.z), o.r, Math.round(o.life)]);
    }
    out.all('S', s);
  }
  return {
    begin() { goSelect(); },
    tick(dt) {
      time += dt; modeT += dt; tickN++;
      if (mode === 'countdown' && modeT >= 3) { mode = 'fight'; modeT = 0; }
      if (mode === 'fight' || mode === 'over') update(dt);
      if (mode === 'over' && modeT > 7) goSelect();
      if (tickN % 3 === 0) snapshot();
    },
    input(id, d) {
      const p = byId(id);
      if (!p || !p.pos || p.dead || !d || d.n !== p.fixN) return;
      if (mode !== 'fight' && mode !== 'over') { p.fire = false; return; }
      if (!Array.isArray(d.p) || !d.p.every(okNum) || !okNum(d.y) || !okNum(d.s)) return;
      p.pos = d.p.slice(0, 3); p.yaw = d.y; p.speed = d.s; p.steer = clamp(+d.st || 0, -1, 1);
      p.vel = Array.isArray(d.v) && d.v.every(okNum) ? d.v.slice(0, 2) : [0, 0];
      p.fire = !!d.fire && mode === 'fight';
    },
    action(id, a) { const p = byId(id); if (p && a === 'spec') useSpecial(p); },
    crash(id, d) {
      const p = byId(id);
      if (!p || !p.pos || p.dead || mode !== 'fight' || !d || !okNum(d.imp)) return;
      const imp = clamp(d.imp, 0, 60);
      if (imp > 5) {
        const lp = Array.isArray(d.lp) && d.lp.every(okNum) ? d.lp : [0, 0.8, 2];
        const f = fwd(p.yaw), r = [f[2], 0, -f[0]];
        damage(p, (imp - 5) * 0.5 / p.car.mass, null, add(p.pos, add(add(scl(r, lp[0]), [0, lp[1], 0]), scl(f, lp[2]))), 'crash');
      }
    },
    select(id, d) {
      const p = byId(id);
      if (!p || mode !== 'select' || !d) return;
      if (CARS[d.car | 0]) p.sel.car = d.car | 0;
      if (GUNS[d.gun | 0]) p.sel.gun = d.gun | 0;
      if (SPECIALS[d.spec | 0]) p.sel.spec = d.spec | 0;
      p.sel.ready = !!d.ready;
      sendSel();
      if (P.filter(q => q.active).every(q => q.sel.ready)) startRound();
    },
    remove(id) {
      const p = byId(id); if (!p) return;
      p.active = false;
      if (p.pos && !p.dead) { p.dead = true; ev({ e: 'boom', p: r1(add(p.pos, [0, 1, 0])), b: 1 }); }
      if (mode === 'select') { sendSel(); if (P.filter(q => q.active).every(q => q.sel.ready)) startRound(); }
    },
    activeCount() { return P.filter(p => p.active).length; },
  };
}
module.exports = { createGame };
