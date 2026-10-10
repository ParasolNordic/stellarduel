// Nordic Combat – kokoaja. Käyttää kaupunkimaailman moduuleja sellaisenaan (renderöijä, laatutasot, kaupunki,
// valaistus) ja lisää niiden päälle pelin: liike ja törmäykset, aseet, efektit, pysyvät jäljet, moninpeli, HUD.
import * as THREE from 'three';
import { io } from 'socket.io-client';
import { createRenderer, applyRendererQuality } from '../core/renderer.js';
import { QUALITY_PRESETS } from '../core/quality.js';
import { CityWorld } from '../world/CityWorld.js';
import { Lighting } from '../lighting/Lighting.js';
import { Perf } from '../core/Perf.js';
import { WorldCollider } from './physics/WorldCollider.js';
import { PlayerController, EYE } from './player/PlayerController.js';
import { Viewmodel } from './weapons/Viewmodel.js';
import { WeaponSystem } from './weapons/WeaponSystem.js';
import { WEAPONS, WEAPON_LABEL } from './weapons/defs.js';
import { Effects } from './fx/Effects.js';
import { Marks } from './fx/Marks.js';
import { Avatars } from './avatars/Avatars.js';
import { Sound } from './audio/Sound.js';
import { Hud } from './ui/Hud.js';
import { TouchControls } from './ui/Touch.js';
import './ui/noZoom.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const store = { get: (k, d) => { try { const v = localStorage.getItem('h3dfps.' + k); return v === null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem('h3dfps.' + k, v); } catch (e) { /* ei tallennusta */ } } };
const RESPAWN = 3.0;
// kosketuslaite: ensisijainen osoitin on sormi (puhelin, tabletti); ?touch=1 pakottaa testejä varten
const isTouch = params.get('touch') === '1' || (matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0);
if (isTouch) document.body.classList.add('touch');
let touch = null;

// ---------- perusosat ----------
const renderer = createRenderer($('viewport'));
renderer.autoClear = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.05, 4000);
camera.rotation.order = 'YXZ';
const world = new CityWorld(scene, { baseUrl: 'world/' });
const lighting = new Lighting(renderer, scene);
const perf = new Perf(renderer);
const sound = new Sound();
const hud = new Hud();
let qualityId = params.get('q') && QUALITY_PRESETS[params.get('q')] ? params.get('q') : store.get('quality', 'high');
if (!QUALITY_PRESETS[qualityId]) qualityId = 'high';
const settings = { sens: +store.get('sens', 1), adsSens: +store.get('adsSens', 1), fov: +store.get('fov', 78), vol: +store.get('vol', 0.8) };

let collider, player, vm, weapons, fx, marks, avatars;
const me = { id: null, name: '', color: '#fff', alive: false, hp: 100, deadT: RESPAWN, protect: false, spawnReq: 0, killer: null, deathPos: new THREE.Vector3() };
const game = { code: null, url: '', players: new Map(), t: 0, limit: 15, timeLimit: 600, over: false, playing: false, locked: false };
let spawnCells = [];

function applyQuality(id) {
  qualityId = id; const q = QUALITY_PRESETS[id];
  applyRendererQuality(renderer, q);
  if (params.get('pr')) renderer.setPixelRatio(+params.get('pr'));      // testejä varten
  world.setTextureQuality(q.textureSize, Math.min(q.anisotropy, renderer.capabilities.getMaxAnisotropy()));
  lighting.setQuality(q);
  if (world.surroundings) world.surroundings.visible = q.surroundings;
  if (vm) { const s = id === 'high' ? 768 : id === 'medium' ? 512 : 384; vm.scopeRT.setSize(s, s); }
  document.querySelectorAll('[data-q]').forEach(b => b.classList.toggle('active', b.dataset.q === id));
  store.set('quality', id);
}
addEventListener('resize', () => { applyRendererQuality(renderer, QUALITY_PRESETS[qualityId]); if (params.get('pr')) renderer.setPixelRatio(+params.get('pr')); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (vm) vm.resize(); });

// ---------- verkko ----------
const socket = io('/fps', { transports: ['websocket', 'polling'] });
const net = { emit: (ev, d) => { if (me.id !== null) socket.emit(ev, d); } };

// ---------- lataus ----------
function progress(text, f) { $('loadtxt').textContent = text; $('loadfill').style.width = Math.round(f * 100) + '%'; }
async function load() {
  progress('Ladataan kaupunkia…', 0);
  await world.load((t, f) => progress(t, f * 0.9));
  progress('Rakennetaan törmäysgeometria…', 0.92);
  await new Promise(r => setTimeout(r, 20));
  lighting.fitTo(world.bounds);
  world.addSurroundings();
  collider = new WorldCollider(world);
  player = new PlayerController(collider, world);
  fx = new Effects(scene, world);
  marks = new Marks(scene, world, collider);
  avatars = new Avatars(scene);
  vm = new Viewmodel(renderer, WEAPONS);
  weapons = new WeaponSystem({ vm, sound, fx, collider, avatars, net, world, scene, myId: null });
  weapons.onLocalHit = h => { hud.hitmark(h.head, false); sound.hitmark(h.head); };
  weapons.onLocalBoom = (k, p, n) => { fx.explosion(p, n, k, camera.position); sound.explosion(p, k === 'rocket'); };
  weapons.onShot = d => { fx.shake = Math.max(fx.shake, d.id === 'launcher' ? 0.25 : d.id === 'shotgun' ? 0.12 : 0.03); };
  player.onLand = k => { sound.land(k); landKick = Math.max(landKick, k); };
  player.onStep = s => sound.step(s);
  applyQuality(qualityId);
  computeSpawnCells();
  touch = new TouchControls({ root: $('touch'), player, weapons,
    onLook: (dx, dy) => { lookDx += dx * 2.3; lookDy += dy * 2.3; },
    actions: {
      jump: () => player.jump(),
      reload: () => me.alive && weapons.reload(),
      grenade: () => me.alive && weapons.throwGrenade(),
      ads: () => { weapons.adsHeld = !weapons.adsHeld; $('tAds').classList.toggle('on', weapons.adsHeld); },
      zoom: () => weapons.cycleZoom(),
      pause: () => pauseGame(),
    } });
  // asepaikat yläpalkissa: napautus vaihtaa aseen (kosketus)
  document.querySelectorAll('#slots div').forEach(el => el.addEventListener('pointerdown', e => { e.preventDefault(); if (me.alive) weapons.select(+el.dataset.i); }));
  // esikatselukuva aulan taakse
  const c = world.center; camera.position.set(c.x + 90, c.y + 55, c.z + 120); camera.lookAt(c.x, c.y, c.z);
  progress(`Valmis · ${spawnCells.length} syntymäpistettä · törmäyspuu ${Math.round(collider.buildMs)} ms`, 1);
  setTimeout(() => $('loadbar').classList.add('hidden'), 900);
  for (const b of ['btnCreate', 'btnJoin']) $(b).disabled = false;
  if (params.get('k') && store.get('name', '')) { /* odotetaan käyttäjän klikkausta, jotta ääni voidaan käynnistää */ }
  requestAnimationFrame(frame);
}

function computeSpawnCells() {
  const b = world.bounds, out = [];
  for (let x = b.min.x + 10; x < b.max.x - 10; x += 3) for (let z = b.min.z + 10; z < b.max.z - 10; z += 3) {
    const g = world.heightAt(x, z); if (g === null) continue;
    let ok = true;
    for (let k = 0; k < 8 && ok; k++) { const a = k / 8 * Math.PI * 2; const sx = x + Math.cos(a) * 2.2, sz = z + Math.sin(a) * 2.2; const s = world.surfaceAt(sx, sz), gg = world.heightAt(sx, sz); if (s === null || gg === null || s - gg > 0.4 || Math.abs(gg - g) > 0.8) ok = false; }
    if (!ok || world.surfaceAt(x, z) - g > 0.3) continue;
    const hit = collider.raycast(new THREE.Vector3(x, g + 40, z), new THREE.Vector3(0, -1, 0), 60);
    if (!hit || hit.point.y > g + 0.6) continue;
    out.push(new THREE.Vector3(x, hit.point.y + 0.05, z));
  }
  spawnCells = out;
}
function pickSpawn() {
  if (!spawnCells.length) return world.center;
  const others = [...avatars.map.values()].filter(a => a.alive).map(a => a.pos);
  if (!others.length) return spawnCells[(Math.random() * spawnCells.length) | 0];
  const scored = [];
  for (let i = 0; i < 160; i++) {
    const c = spawnCells[(Math.random() * spawnCells.length) | 0];
    let d = Infinity; for (const o of others) d = Math.min(d, c.distanceTo(o));
    // ei suoraan toisen näköpiiriin: rangaistaan näköyhteydestä
    let vis = 0; for (const o of others) if (c.distanceTo(o) < 90 && collider.clear(c.clone().setY(c.y + EYE), o.clone().setY(o.y + EYE))) vis++;
    scored.push({ c, s: Math.min(d, 110) - vis * 60 + Math.random() * 10 });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored[0].c;
}

// ---------- aula ----------
$('name').value = store.get('name', '');
if (params.get('k')) $('code').value = params.get('k').toUpperCase().slice(0, 4);
for (const b of ['btnCreate', 'btnJoin']) $(b).disabled = true;
function lobbyMsg(t, err = false) { $('lobbyMsg').textContent = t; $('lobbyMsg').classList.toggle('err', err); }
function myName() { const n = $('name').value.trim().toUpperCase() || 'PELAAJA' + Math.floor(Math.random() * 90 + 10); store.set('name', n); return n; }
$('btnCreate').addEventListener('click', () => {
  sound.init(); lobbyMsg('Luodaan peliä…');
  socket.emit('create', { origin: location.origin }, r => { if (!r || !r.code) return lobbyMsg('Pelin luonti epäonnistui', true); game.url = r.url; $('qr').src = r.qr || ''; $('qr').classList.toggle('hidden', !r.qr); join(r.code); });
});
$('btnJoin').addEventListener('click', () => { sound.init(); const c = $('code').value.trim().toUpperCase(); if (c.length !== 4) return lobbyMsg('Anna nelikirjaiminen koodi', true); join(c); });
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoin').click(); });
$('btnCopy').addEventListener('click', () => { navigator.clipboard?.writeText(game.url).then(() => { $('btnCopy').textContent = 'Kopioitu ✓'; }); });
$('btnPlay').addEventListener('click', () => { sound.init(); startPlaying(); });
function join(code) {
  socket.emit('join', { code, name: myName() }, r => {
    if (!r || r.err) return lobbyMsg(r ? r.err : 'Yhteysvirhe', true);
    me.id = r.id; me.name = r.name; me.color = r.color; me.alive = false; me.deadT = RESPAWN;
    weapons.myId = r.id; game.code = r.code; game.t = r.t || 0;
    if (!game.url) game.url = location.origin + '/?k=' + r.code;
    marks.clear(); for (const m of r.marks || []) marks.add(m);
    history.replaceState(null, '', '?k=' + r.code + (params.get('q') ? '&q=' + params.get('q') : ''));
    $('lobbyStart').classList.add('hidden'); $('lobbyShare').classList.remove('hidden');
    $('shareCode').textContent = r.code; $('shareUrl').textContent = game.url;
    if (!$('qr').getAttribute('src')) $('qr').classList.add('hidden');
    $('menuShare').textContent = `Pelin koodi ${r.code} · ${game.url}`;
  });
}
function renderPlayersList() {
  $('players').innerHTML = [...game.players.values()].map(p => `<div><i style="background:${p.color}"></i>${p.name.replace(/</g, '')}${p.id === me.id ? ' (sinä)' : ''}</div>`).join('') +
    (game.players.size < 3 ? `<div style="color:#9aa6b2">Odotetaan pelaajia… (${game.players.size}/3)</div>` : '');
}
function startPlaying() {
  game.playing = true;
  document.body.classList.add('playing');
  $('lobby').classList.add('hidden'); hud.show(true);
  if (isTouch) {
    $('touch').classList.remove('hidden'); game.locked = true;
    // Android: koko näyttö ja vaakasuunta (iPhone ei tue, ohitetaan hiljaa)
    try { const r = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); r?.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {}); } catch (e) { /* ei tukea */ }
  } else lockPointer();
}
function pauseGame() { game.locked = false; touch?.reset(); weapons.adsHeld = false; $('tAds').classList.remove('on'); $('menu').classList.remove('hidden'); }
function resumeGame() { $('menu').classList.add('hidden'); if (isTouch) game.locked = true; else lockPointer(); }

// ---------- hiiri ja näppäimet ----------
function lockPointer() {
  const el = renderer.domElement;
  try { const p = el.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => el.requestPointerLock()); } catch (e) { el.requestPointerLock(); }
}
document.addEventListener('pointerlockchange', () => {
  if (isTouch) return;
  game.locked = document.pointerLockElement === renderer.domElement;
  if (!game.playing) return;
  $('menu').classList.toggle('hidden', game.locked);
  $('clickToPlay').classList.add('hidden');
  if (!game.locked) { weapons.trigger = false; weapons.adsHeld = false; player.keys.clear(); }
});
document.addEventListener('pointerlockerror', () => { if (game.playing && !isTouch) $('clickToPlay').classList.remove('hidden'); });
$('clickToPlay').addEventListener('click', () => lockPointer());
renderer.domElement.addEventListener('click', () => { if (game.playing && !game.locked && !isTouch) lockPointer(); });
$('btnResume').addEventListener('click', resumeGame);
$('btnLeave').addEventListener('click', () => location.href = location.pathname);
let lookDx = 0, lookDy = 0;
document.addEventListener('mousemove', e => {
  if (!game.locked || isTouch) return;
  const mx = e.movementX || 0, my = e.movementY || 0;
  if (Math.abs(mx) > 500 || Math.abs(my) > 500) return;           // selainten satunnaiset hyppäykset
  lookDx += mx; lookDy += my;
});
document.addEventListener('mousedown', e => {
  if (!game.locked || isTouch) return;
  if (e.button === 0) { weapons.trigger = true; weapons.pressed = true; }
  if (e.button === 2) weapons.adsHeld = true;
});
document.addEventListener('mouseup', e => { if (isTouch) return; if (e.button === 0 && !player?.keys.has('Space')) weapons.trigger = false; if (e.button === 2) weapons.adsHeld = false; });
document.addEventListener('contextmenu', e => { if (game.playing) e.preventDefault(); });
// rulla vain kiikarin suurennokseen (ei aseen vaihtoa – Macin kosketuslevyllä liian herkkä)
document.addEventListener('wheel', e => { if (game.locked && me.alive && Math.abs(e.deltaY) > 4) weapons.wheelZoom(e.deltaY); }, { passive: true });
addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.code === 'KeyF' && !e.repeat) $('perf').classList.toggle('hidden');
  if (e.code === 'Tab') { e.preventDefault(); $('board').classList.remove('hidden'); }
  if (!game.locked) return;
  if (e.code === 'Space') e.preventDefault();
  player.keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyE') player.jump();
  if (!me.alive) return;
  if (e.code === 'Space') { weapons.trigger = true; weapons.pressed = true; }
  if (e.code === 'KeyR') weapons.reload();
  if (e.code === 'KeyG') weapons.throwGrenade();
  if (e.code === 'KeyQ') weapons.select(weapons.prev);
  if (e.code === 'KeyZ') weapons.cycleZoom();
  const n = /^Digit([1-7])$/.exec(e.code); if (n) weapons.select(+n[1] - 1);
});
addEventListener('keyup', e => { if (e.code === 'Space' && weapons) weapons.trigger = false; });
addEventListener('keyup', e => { player?.keys.delete(e.code); if (e.code === 'Tab') $('board').classList.add('hidden'); });
addEventListener('blur', () => { player?.keys.clear(); if (weapons) weapons.trigger = false; });

// ---------- asetukset ----------
function bindRange(id, key, fmt) {
  const el = $(id), out = $(id === 'adsSens' ? 'adsV' : id + 'V');
  el.value = settings[key]; out.textContent = fmt(settings[key]);
  el.addEventListener('input', () => { settings[key] = +el.value; out.textContent = fmt(settings[key]); store.set(key, el.value); if (key === 'vol') sound.setVolume(settings.vol); });
}
bindRange('sens', 'sens', v => v.toFixed(2)); bindRange('adsSens', 'adsSens', v => v.toFixed(2)); bindRange('fov', 'fov', v => v + '°'); bindRange('vol', 'vol', v => Math.round(v * 100) + ' %');
sound.volume = settings.vol;
document.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => applyQuality(b.dataset.q)));
for (const id of ['licLink', 'licLink2']) $(id).addEventListener('click', () => $('lic').classList.remove('hidden'));
$('licClose').addEventListener('click', () => $('lic').classList.add('hidden'));

// ---------- verkkotapahtumat ----------
const player_ = id => game.players.get(id) || { name: '?', color: '#aaa' };
socket.on('roster', r => {
  game.players = new Map(r.players.map(p => [p.id, p])); game.limit = r.limit; game.timeLimit = r.timeLimit; game.t = r.t;
  for (const p of r.players) if (p.id !== me.id) avatars.ensure(p);
  for (const id of [...avatars.map.keys()]) if (!game.players.has(id)) avatars.remove(id);
  renderPlayersList();
  hud.leaders(r.players, r.limit); hud.board(r.players, me.id, game.code);
});
socket.on('snap', s => {
  game.t = s.t;
  for (const [id, pos, yaw, pitch, w, flags, hp, alive, prot] of s.P) {
    if (id === me.id) { if (me.alive) me.hp = hp; me.protect = !!prot; continue; }
    avatars.push(id, pos, yaw, pitch, w, alive, prot, hp);
  }
});
socket.on('joined', d => { if (d.id !== me.id) hud.feed(`<span>${d.name.replace(/</g, '')}</span><span class="w">LIITTYI PELIIN</span>`); });
socket.on('left', d => hud.feed(`<span>${d.name.replace(/</g, '')}</span><span class="w">POISTUI</span>`));
const _v = new THREE.Vector3(), _d = new THREE.Vector3();
socket.on('fx', ({ id, S }) => {
  if (!Array.isArray(S) || S.length < 8) return;
  const def = WEAPONS[S[0]]; if (!def) return;
  const from = avatars.muzzleWorld(id, new THREE.Vector3()) || new THREE.Vector3(S[1], S[2], S[3]);
  const dir0 = _d.set(S[4] - from.x, S[5] - from.y, S[6] - from.z).normalize().clone();
  fx.remoteMuzzle(from, dir0);
  sound.shot(def, from);
  for (let i = 4, k = 0; i + 3 < S.length; i += 4, k++) {
    const end = new THREE.Vector3(S[i], S[i + 1], S[i + 2]), code = S[i + 3];
    if (k < 3 || Math.random() < 0.3) fx.tracer(from, end);
    if (code === 1 || code === 2) {
      const dir = end.clone().sub(from); const L = dir.length(); dir.divideScalar(L);
      const h = k < 3 ? collider.raycast(from, dir, L + 0.5) : null;
      if (h) fx.impact(h.point, h.normal, h.kind); else fx.impact(end, dir.negate(), code === 2 ? 'buildings' : 'terrain');
    } else if (code === 3) fx.playerHit(end, '#ffffff');
  }
});
socket.on('proj', d => {
  weapons.remoteProjectile(d);
  if (d.k === 'rocket') { const o = new THREE.Vector3().fromArray(d.o); sound.shot(WEAPONS[6], o); fx.remoteMuzzle(o, new THREE.Vector3().fromArray(d.v)); }
});
socket.on('boom', d => {
  const p = new THREE.Vector3().fromArray(d.p), n = new THREE.Vector3().fromArray(d.n);
  if (d.id !== me.id) { weapons.removeProjectile(d.id, d.n2 ?? d.n); fx.explosion(p, n, d.k, camera.position); sound.explosion(p, d.k === 'rocket'); }
  marks.add(d); fx.smolder(p, d.k === 'rocket' ? 12 : 8);
});
socket.on('hit', d => {
  if (d.t === me.id) {
    me.hp = d.hp;
    let ang = 0;
    if (d.from) { const dx = d.from[0] - player.pos.x, dz = d.from[2] - player.pos.z; ang = Math.atan2(dx, -dz) + player.yaw; }
    hud.damage(ang); sound.hurt();
    weapons.punch.vp += 1.2 + d.dmg * 0.03; weapons.punch.vy += (Math.random() - 0.5) * 2;
  } else if (d.by === me.id && d.w >= 6) { hud.hitmark(false, false); sound.hitmark(false); }
});
socket.on('kill', d => {
  const victim = player_(d.t), killer = d.by ? player_(d.by) : null;
  hud.feed(hud.killFeed(killer, victim, d.w, d.head), d.by === me.id || d.t === me.id);
  if (d.t === me.id) {
    me.alive = false; me.deadT = 0; me.hp = 0; me.killer = killer && d.by !== me.id ? killer : null; me.deathPos.copy(player.pos);
    weapons.trigger = false; weapons.adsHeld = false;
    $('death').classList.remove('hidden');
    $('killer').innerHTML = me.killer ? `Kaatajana <b style="color:${me.killer.color}">${me.killer.name.replace(/</g, '')}</b> · ${WEAPON_LABEL(d.w)}${d.head ? ' · pääosuma' : ''}` : 'Oma räjähde';
  } else if (d.by === me.id) {
    hud.hitmark(d.head, true); sound.killConfirm();
    hud.center('KAATO', `${victim.name}${d.head ? ' · PÄÄOSUMA' : ''}`);
  }
});
socket.on('spawned', d => {
  if (d.id !== me.id) return;
  me.alive = true; me.hp = 100; me.spawnReq = 0; me.protect = true;
  player.teleport(new THREE.Vector3().fromArray(d.p), spawnYaw);
  weapons.reset();
  $('death').classList.add('hidden');
});
socket.on('over', d => {
  game.over = true;
  $('overWhy').textContent = d.why;
  $('overRows').innerHTML = d.rank.map((p, i) => `<tr class="${p.id === me.id ? 'me' : ''}"><td>${i + 1}.</td><td><i style="background:${p.color}"></i></td><td>${p.name.replace(/</g, '')}</td><td>${p.kills} kaatoa</td><td>${p.deaths} kuolemaa</td></tr>`).join('');
  $('over').classList.remove('hidden');
});
socket.on('newmatch', () => {
  game.over = false; $('over').classList.add('hidden');
  marks.clear(); weapons.clearProjectiles();
  me.alive = false; me.deadT = RESPAWN - 0.5; $('death').classList.add('hidden');
  hud.center('UUSI OTTELU', 'ensimmäinen 15 kaatoon');
});
socket.on('disconnect', () => { if (game.playing) hud.center('YHTEYS KATKESI', 'yritetään uudelleen…', 4); });
socket.on('connect', () => { if (game.code && me.id !== null) join(game.code); });

// ---------- pelisilmukka ----------
const clock = new THREE.Clock();
let landKick = 0, stAcc = 0, shadowAcc = 0, shadowed = false, spawnYaw = 0, perfAcc = 0, fovCur = 78;
const sunProbe = new THREE.Vector3();
const prof = { upd: 0, draw: 0 };
function placeCamera(sh) {
  const P = weapons.punch, sw = weapons.sway || { p: 0, y: 0 };
  camera.position.set(player.pos.x, player.pos.y + EYE - landKick * 0.12, player.pos.z);
  camera.rotation.set(player.pitch + P.p + sw.p + (Math.random() - 0.5) * sh * 0.02, player.yaw + P.y + sw.y + (Math.random() - 0.5) * sh * 0.02, (Math.random() - 0.5) * sh * 0.015);
  camera.updateMatrixWorld();
}
function frame() {
  requestAnimationFrame(frame);
  const rawDt = Math.min(0.2, clock.getDelta()), nSub = Math.max(1, Math.ceil(rawDt / 0.034)), dt = rawDt / nSub;   // hitaalla laitteella simulointi useassa osassa
  if (!player) return;
  const tA = performance.now();
  const def = weapons.def;
  const active = game.playing && game.locked && me.alive;

  // syntyminen
  if (game.playing && !me.alive && !game.over && me.id !== null) {
    me.deadT += rawDt;
    $('respawn').textContent = me.deadT < RESPAWN ? `Synnyt uudelleen ${Math.ceil(RESPAWN - me.deadT)} s` : 'Synnytään…';
    if (me.deadT >= RESPAWN && performance.now() - me.spawnReq > 600) {
      const p = pickSpawn(); me.spawnReq = performance.now();
      const c = world.center; spawnYaw = Math.atan2(-(c.x - p.x), -(c.z - p.z));
      socket.emit('spawn', { p: [p.x, p.y, p.z] });
    }
  }
  // hiiren katselu (herkkyys skaalautuu näkökentän ja kiikarin suurennoksen mukaan)
  const A = vm.ads;
  const adsScale = def.sight === 'scope' ? 1 / weapons.zoom : def.adsFov / settings.fov;
  const scale = (1 + (adsScale * settings.adsSens - 1) * A) * settings.sens * 0.0022;
  if (active || (game.playing && game.locked && !me.alive)) player.look(lookDx * scale, lookDy * scale);
  lookDx = lookDy = 0;
  const ldx = player._lastYaw !== undefined ? player.yaw - player._lastYaw : 0, ldy = player._lastPitch !== undefined ? player.pitch - player._lastPitch : 0;
  player._lastYaw = player.yaw; player._lastPitch = player.pitch;

  // liike
  player.ads = A; player.speedMul = def.speed;
  weapons.holding = player.keys.has('ShiftLeft') || player.keys.has('ShiftRight');
  for (let i = 0; i < nSub; i++) {
    if (me.alive) player.update(dt, active);
    if (me.alive) placeCamera(0);                 // laukaus lähtee tämänhetkiseen katsesuuntaan (ei edellisen ruudun)
    weapons.update(dt, { camera, player, alive: active });
  }
  landKick = Math.max(0, landKick - rawDt * 4);

  // kamera
  const sh = fx.shake;
  if (me.alive) placeCamera(sh);
  else if (game.playing) {
    // kuolinkamera: nousee ja katsoo kaatumispaikkaa
    const k = Math.min(1, me.deadT / 2.5);
    camera.position.set(me.deathPos.x, me.deathPos.y + EYE + k * 5, me.deathPos.z).addScaledVector(new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)), k * 4);
    camera.lookAt(me.deathPos.x, me.deathPos.y + 0.5, me.deathPos.z);
  }
  const targetFov = THREE.MathUtils.lerp(settings.fov, def.sight === 'scope' ? 38 : def.adsFov * settings.fov / 78, A * A * (3 - 2 * A)) + (player.sprinting ? 5 : 0);
  fovCur += (targetFov - fovCur) * Math.min(1, rawDt * 14);
  if (Math.abs(camera.fov - fovCur) > 0.01) { camera.fov = fovCur; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();

  // asekuva
  vm.update(rawDt, { def, ads: active && weapons.adsHeld && !player.sprinting && weapons.state !== 'swap', sprint: player.sprinting, moving: player.moving, bob: player.bob, onGround: player.onGround,
    dx: ldx, dy: ldy, landKick });
  shadowAcc += rawDt;
  if (shadowAcc > 0.25) { shadowAcc = 0; sunProbe.copy(camera.position).addScaledVector(lighting.sunDir, 250); shadowed = !collider.clear(camera.position, sunProbe); }
  vm.syncLights(lighting, scene, shadowed); vm.setWorldToView(camera);

  // muut
  avatars.update(rawDt);
  fx.update(rawDt, camera);
  lighting.update(rawDt, camera);
  const fwd = camera.getWorldDirection(_v);
  sound.setListener(camera.position, fwd, new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion));

  // tila palvelimelle 20 Hz
  stAcc += rawDt;
  if (stAcc >= 0.05 && me.alive) {
    stAcc = 0;
    socket.volatile.emit('st', { p: [+(player.pos.x.toFixed(2)), +(player.pos.y.toFixed(2)), +(player.pos.z.toFixed(2))], y: +player.yaw.toFixed(3), x: +player.pitch.toFixed(3), w: weapons.idx, f: (player.sprinting ? 1 : 0) | (A > 0.5 ? 2 : 0) });
  }

  // HUD
  if (game.playing) {
    const spreadDeg = weapons.spread(player);
    const px = Math.tan(spreadDeg * Math.PI / 180) / Math.tan(camera.fov * Math.PI / 360) * innerHeight / 2;
    hud.crosshair(px, me.alive && A < 0.6, player.sprinting);
    hud.health(me.alive ? me.hp : 0);
    hud.ammo(weapons);
    hud.timer(game.t, game.timeLimit);
    $('protect').classList.toggle('hidden', !(me.alive && me.protect));
    hud.update(rawDt);
    if (isTouch) {
      const sn = def.sight === 'scope';
      if (sn !== !$('tZoom').classList.contains('hidden')) $('tZoom').classList.toggle('hidden', !sn);
      if (sn) hud.set('tZoom', weapons.zoom + '×');
      if (!me.alive && weapons.adsHeld) { weapons.adsHeld = false; $('tAds').classList.remove('on'); }
    }
  }

  // piirto: kaupunki → (kiikarin kuva) → asekuva
  const tB = performance.now();
  renderer.setRenderTarget(null); renderer.clear();
  renderer.render(scene, camera);
  const scoped = me.alive && game.playing && vm.renderScope(renderer, scene, camera, weapons.zoom, settings.fov);
  hud.scopeMask(vm.lensScreen, scoped ? Math.max(0, (A - 0.75) / 0.25) * 0.97 : 0);
  if (me.alive && game.playing) vm.render(renderer);
  perf.tick();
  prof.upd = prof.upd * 0.95 + (tB - tA) * 0.05; prof.draw = prof.draw * 0.95 + (performance.now() - tB) * 0.05;
  perfAcc += rawDt;
  if (perfAcc > 0.5 && !$('perf').classList.contains('hidden')) {
    perfAcc = 0; const s = perf.summary(60);
    if (s) $('perf').textContent = `${s.fps.toFixed(0)} FPS · ${s.avgMs.toFixed(1)} ms (p95 ${s.p95.toFixed(1)})\n${s.calls} piirtokutsua · ${(s.triangles / 1000).toFixed(0)}k kolmiota\npartikkelit ${fx.particles.count} · jäljet ${marks.count}\npäivitys ${prof.upd.toFixed(1)} ms · piirto ${prof.draw.toFixed(1)} ms\nlaatu ${qualityId} · ${renderer.getPixelRatio().toFixed(2)}x`;
  }
}

// testejä ja vianetsintää varten
window.__FPS = { get player() { return player; }, get weapons() { return weapons; }, get avatars() { return avatars; }, get marks() { return marks; }, get fx() { return fx; }, me, game, socket, world, camera, renderer,
  get spawnCells() { return spawnCells; }, startPlaying, prof, join, perf, lighting,
  look(yaw, pitch) { player.yaw = yaw; player.pitch = pitch; } };

load().catch(e => { console.error(e); progress('Lataus epäonnistui: ' + e.message, 0); });
