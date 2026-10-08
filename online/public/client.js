// Stellar Duel Online - selainasiakas: oma koko ruudun näkymä, näppäimistö ja kosketusohjaimet
(function () {
'use strict';
const SD = window.SD;
const { add, sub, scl, madd, dot, cross, vlen, norm, clamp, rnd, chance, randDir, newOri, oriFromForward,
  rotPitch, rotRoll, rotYaw, orthonorm, rotAxis, toWorld, toLocal, MODELS, SHIPDEF, LASERS, MISSILES, BUDGET, MAXSPD, STS, ROCK_R } = SD;
const { BLACK, WHITE, RED, CYAN, PURPLE, GREEN, BLUE, YELLOW, ORANGE, BROWN, LRED, DGREY, GREY, LGREEN, LBLUE, LGREY } = SD.COL;

// ===================== GRAFIIKKA =====================
const W = 640, H = 360, VH = 270;
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const img = ctx.createImageData(W, H);
const buf = new Uint32Array(img.data.buffer);
const PAL = ['000000','ffffff','68372b','70a4b2','6f3d86','588d43','352879','b8c76f',
             '6f4f25','433900','9a6759','444444','6c6c6c','9ad284','6c5eb5','959595'];
const PAL32 = PAL.map(h => {
  const r = parseInt(h.substr(0,2),16), g = parseInt(h.substr(2,2),16), b = parseInt(h.substr(4,2),16);
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
});
let clipX0 = 0, clipY0 = 0, clipX1 = W-1, clipY1 = H-1;
function setClip(x0, y0, x1, y1) { clipX0 = x0; clipY0 = y0; clipX1 = x1; clipY1 = y1; }
function fullClip() { setClip(0, 0, W-1, H-1); }
function pset(x, y, c) {
  x = Math.round(x); y = Math.round(y);
  if (x < clipX0 || x > clipX1 || y < clipY0 || y > clipY1) return;
  buf[y*W + x] = PAL32[c];
}
function fillRect(x, y, w, h, c) {
  const x0 = Math.max(clipX0, Math.round(x)), y0 = Math.max(clipY0, Math.round(y));
  const x1 = Math.min(clipX1, Math.round(x + w - 1)), y1 = Math.min(clipY1, Math.round(y + h - 1));
  const col = PAL32[c];
  for (let yy = y0; yy <= y1; yy++) { const o = yy*W; for (let xx = x0; xx <= x1; xx++) buf[o+xx] = col; }
}
function hline(x0, x1, y, c) {
  y = Math.round(y); if (y < clipY0 || y > clipY1 || !isFinite(x0) || !isFinite(x1)) return;
  if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
  x0 = Math.max(clipX0, Math.round(x0)); x1 = Math.min(clipX1, Math.round(x1));
  const col = PAL32[c], o = y*W;
  for (let x = x0; x <= x1; x++) buf[o+x] = col;
}
function rect(x, y, w, h, c) {
  hline(x, x+w-1, y, c); hline(x, x+w-1, y+h-1, c);
  line(x, y, x, y+h-1, c); line(x+w-1, y, x+w-1, y+h-1, c);
}
function outcode(x, y, xa, ya, xb, yb) {
  let c = 0; if (x < xa) c |= 1; else if (x > xb) c |= 2; if (y < ya) c |= 4; else if (y > yb) c |= 8; return c;
}
function line(x0, y0, x1, y1, c) {
  if (!isFinite(x0) || !isFinite(y0) || !isFinite(x1) || !isFinite(y1)) return;
  const xa = clipX0 - 0.49, ya = clipY0 - 0.49, xb = clipX1 + 0.49, yb = clipY1 + 0.49;
  let c0 = outcode(x0, y0, xa, ya, xb, yb), c1 = outcode(x1, y1, xa, ya, xb, yb);
  for (let n = 0; n < 8; n++) {
    if (!(c0 | c1)) break;
    if (c0 & c1) return;
    const co = c0 || c1; let x, y;
    if (co & 8) { x = x0 + (x1-x0)*(yb-y0)/(y1-y0); y = yb; }
    else if (co & 4) { x = x0 + (x1-x0)*(ya-y0)/(y1-y0); y = ya; }
    else if (co & 2) { y = y0 + (y1-y0)*(xb-x0)/(x1-x0); x = xb; }
    else { y = y0 + (y1-y0)*(xa-x0)/(x1-x0); x = xa; }
    if (co === c0) { x0 = x; y0 = y; c0 = outcode(x0, y0, xa, ya, xb, yb); }
    else { x1 = x; y1 = y; c1 = outcode(x1, y1, xa, ya, xb, yb); }
  }
  if (c0 | c1) return;
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const col = PAL32[c];
  let dx = Math.abs(x1-x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1-y0), sy = y0 < y1 ? 1 : -1, err = dx + dy;
  for (let i = 0; i < 3000; i++) {
    if (x0 >= clipX0 && x0 <= clipX1 && y0 >= clipY0 && y0 <= clipY1) buf[y0*W + x0] = col;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2*err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
function circle(cx, cy, r, c, fill = -1) {
  if (!isFinite(cx) || !isFinite(cy) || !isFinite(r) || r < 0.5) { if (r >= 0) pset(cx, cy, c); return; }
  const yTop = Math.max(clipY0, Math.ceil(cy - r)), yBot = Math.min(clipY1, Math.floor(cy + r));
  if (yTop > yBot || cx + r < clipX0 || cx - r > clipX1) return;
  let pl = null, pr = null, py = 0;
  for (let y = yTop; y <= yBot; y++) {
    const dy = y - cy, w = Math.sqrt(Math.max(0, r*r - dy*dy));
    const l = cx - w, rr = cx + w;
    if (fill >= 0) hline(l, rr, y, fill);
    if (c >= 0) {
      if (pl === null) { if (y === Math.ceil(cy - r)) hline(l, rr, y, c); else { pset(l, y, c); pset(rr, y, c); } }
      else { line(pl, py, l, y, c); line(pr, py, rr, y, c); }
    }
    pl = l; pr = rr; py = y;
  }
  if (c >= 0 && pl !== null && yBot === Math.floor(cy + r)) hline(pl, pr, yBot, c);
}
function ellipse(cx, cy, rx, ry, c, seg = 48) {
  let px = cx + rx, py = cy;
  for (let i = 1; i <= seg; i++) {
    const a = i / seg * Math.PI * 2, x = cx + Math.cos(a)*rx, y = cy + Math.sin(a)*ry;
    line(px, py, x, y, c); px = x; py = y;
  }
}
function fillPoly(pts, c) {
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { if (!(Math.abs(p[0]) < 1e5 && Math.abs(p[1]) < 1e5)) return; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  y0 = Math.max(clipY0, Math.ceil(y0 - 0.5)); y1 = Math.min(clipY1, Math.floor(y1 - 0.5));
  const n = pts.length;
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5; let xa = Infinity, xb = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i+1) % n];
      if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
        const x = a[0] + (sy - a[1]) * (b[0]-a[0]) / (b[1]-a[1]);
        if (x < xa) xa = x; if (x > xb) xb = x;
      }
    }
    if (xa <= xb) hline(xa, xb, y, c);
  }
}
// 8x8 bittikarttafontti (Press Start 2P, OFL)
const FONTHEX = '000000000000000038383830300030006c6c6c00000000006cfe6c6c6cfe6c00107cd07c16fc100062a4c810264a8c0070d8d870dacc7e0030303000000000000c18303030180c006030181818306000006c38fe386c00000018187e1818000000000000003030600000007e0000000000000000003030000204081020408000384cc6c6c66438001838181818187e007cc60e3c78e0fe007e0c183c06c67c001c3c6cccfe0c0c00fcc0fc0606c67c003c60c0fcc6c67c00fec60c183030300078c4e4789e867c007cc6c67e060c7800003030003030000000303000303060000c18306030180c000000fe00fe0000006030180c183060007cfec60c380038007c82baaabe807c00386cc6c6fec6c600fcc6c6fcc6c6fc003c66c0c0c0663c00f8ccc6c6c6ccf800fec0c0fcc0c0fe00fec0c0fcc0c0c0003e60c0cec6663e00c6c6c6fec6c6c6007e18181818187e000606060606c67c00c6ccd8f0f8dcce006060606060607e00c6eefed6d6c6c600c6e6f6decec6c6007cc6c6c6c6c67c00fcc6c6c6fcc0c0007cc6c6c6decc7a00fcc6c6cef8dcce007cc6c07c06c67c007e18181818181800c6c6c6c6c6c67c00c6c6c6ee7c381000d6d6d6d6feee4400c6c66c386cc6c6006666663c18181800fe0e1c3870e0fe003c30303030303c0080402010080402007818181818187800386c00000000000000000000000000fe6c00386cc6fec6006c007cc6c6c67c001028386cc6fec600';
const FONT = new Uint8Array(FONTHEX.length / 2);
for (let i = 0; i < FONT.length; i++) FONT[i] = parseInt(FONTHEX.substr(i*2, 2), 16);
function glyphIndex(ch) {
  const u = ch.toUpperCase();
  if (u === 'Ä') return 64; if (u === 'Ö') return 65; if (u === 'Å') return 66;
  const k = u.charCodeAt(0);
  return (k >= 32 && k < 96) ? k - 32 : 31;
}
function text(x, y, s, c, sc = 1) {
  s = String(s);
  for (let i = 0; i < s.length; i++) {
    const g = glyphIndex(s[i]) * 8;
    for (let row = 0; row < 8; row++) {
      const b = FONT[g + row]; if (!b) continue;
      for (let col = 0; col < 8; col++) if (b & (128 >> col)) {
        if (sc === 1) pset(x + i*8 + col, y + row, c);
        else fillRect(x + (i*8 + col)*sc, y + row*sc, sc, sc, c);
      }
    }
  }
}
function textC(y, s, c, sc = 1, x0 = 0, w = W) { s = String(s); text(Math.round(x0 + (w - s.length*8*sc)/2), y, s, c, sc); }
function textR(xRight, y, s, c) { s = String(s); text(xRight - s.length*8, y, s, c); }

const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
function fitCanvas() {
  const s = Math.max(0.5, Math.min(window.innerWidth / W, window.innerHeight / H));
  const cw = Math.floor(W * s), ch = Math.floor(H * s);
  cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
  const sc = document.getElementById('scan'), r = cv.getBoundingClientRect();
  Object.assign(sc.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  layoutTouch();
}
window.addEventListener('resize', () => setTimeout(fitCanvas, 50));

// ===================== ÄÄNET =====================
let AC = null, master = null, noiseBuf = null, soundOn = true, volMul = 1;
function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.3; master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random()*2 - 1;
  } catch (e) { AC = null; }
}
function tone(type, f0, f1, dur, vol = 0.2, delay = 0) {
  if (!AC || !soundOn || volMul <= 0.01) return;
  const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(20, f0), t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol * volMul, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
}
function noise(dur, vol, f0 = 3000, f1 = 200, delay = 0) {
  if (!AC || !soundOn || volMul <= 0.01) return;
  const t = AC.currentTime + delay, s = AC.createBufferSource(), fl = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; fl.type = 'lowpass';
  fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  g.gain.setValueAtTime(vol * volMul, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  s.connect(fl); fl.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.03);
}
const SFX = {
  laser:  L => tone(L.snd[0], L.snd[1], L.snd[2], L.snd[3], L.snd[4]),
  hit:    () => noise(0.14, 0.35, 5000, 700),
  boom:   () => { noise(1.2, 0.6, 2600, 50); tone('triangle', 140, 30, 0.8, 0.3); },
  small:  () => noise(0.35, 0.3, 3000, 200),
  beep:   () => tone('square', 990, 990, 0.045, 0.06),
  err:    () => tone('square', 180, 160, 0.18, 0.08),
  lock:   () => tone('square', 700, 700, 0.04, 0.04),
  locked: () => tone('square', 1760, 1760, 0.09, 0.06),
  missile:() => { noise(0.6, 0.25, 1200, 300); tone('sawtooth', 260, 900, 0.5, 0.05); },
  alarm:  () => { tone('square', 1046, 1046, 0.09, 0.07); tone('square', 784, 784, 0.09, 0.07, 0.11); },
  flare:  () => { noise(0.45, 0.22, 7000, 900); tone('triangle', 1300, 300, 0.3, 0.06); },
  launch: () => { noise(1.5, 0.22, 500, 3500); tone('triangle', 220, 55, 1.5, 0.22); },
  count:  () => tone('square', 523, 523, 0.15, 0.08),
  go:     () => { tone('square', 1046, 1046, 0.4, 0.08); tone('triangle', 523, 523, 0.4, 0.12); },
  jingle: () => {
    const N = [262, 330, 392, 523, 392, 494, 587, 784, 659, 523, 392, 523];
    N.forEach((f, i) => { tone('square', f, f, 0.14, 0.06, i*0.12); tone('triangle', f/2, f/2, 0.14, 0.1, i*0.12); });
  },
  fanfare: () => {
    const N = [523, 523, 523, 659, 784, 659, 784, 1046];
    N.forEach((f, i) => { tone('square', f, f, i === 7 ? 0.8 : 0.16, 0.07, i*0.17); tone('triangle', f/2, f/2, 0.16, 0.12, i*0.17); });
  },
};
function play(fn, k = 1, arg) { const o = volMul; volMul = k; try { fn(arg); } finally { volMul = o; } }

// ===================== TILA =====================
const INTERP = 0.1, FOCAL = 400, NEAR = 3, RADAR_R = 9000;
let sock = null, myIdx = -1, roomCode = '', autoJoined = false;
let mode = 'lobby', modeT = 0, animT = 0;
let selS = null, selInit = false, wins = [0, 0], totals = [0, 0], prize = null, drawReason = '', winnerId = -1;
let world = null, rocks = [], lo = null, me = null, dust = [];
let snaps = [], latest = null, timeOff = null, rtt = 0;
let debris = [], dots = [];
let msg = { t: '', d: 0, c: WHITE };
const localSel = { cur: 0, laser: 0, mis: 2, ready: false, msg: '', msgT: 0 };
let invert = false; try { invert = localStorage.getItem('sd_invert') === '1'; } catch (e) {}
let laserCdLocal = 0, beamLocal = { t: 0, end: null }, oppBeam = { t: 0, end: null }, lastBeSnap = null;
let sendT = 0, escT = 0, lastCount = -1, lockBeepT = 0;
const trailT = new Map();
const keys = {};
const touch = { sx: 0, sy: 0, stick: false, thr: null, laser: false, yawL: false, yawR: false };

const srvNow = () => performance.now() / 1000 + (timeOff || 0);
const myStats = () => (latest && latest.P) ? latest.P[myIdx] : null;
const oppIdx = () => 1 - myIdx;

// ===================== VERKKO =====================
const $ = id => document.getElementById(id);
function setStatus(t) { $('status').textContent = t || ''; }
function showPane(id) { for (const p of ['pMenu', 'pHost', 'pJoin']) $(p).hidden = p !== id; }
function connect() {
  setStatus('YHDISTETÄÄN PALVELIMEEN...');
  sock = io({ transports: ['websocket', 'polling'] });
  sock.on('connect', () => {
    setStatus('');
    const k = new URLSearchParams(location.search).get('k');
    if (k && !autoJoined) { autoJoined = true; showPane('pJoin'); $('codeIn').value = k.toUpperCase(); doJoin(k); }
  });
  sock.on('connect_error', () => setStatus('PALVELIN HERÄÄ TAI YHTEYS EI TOIMI - YRITETÄÄN UUDELLEEN...'));
  sock.on('disconnect', () => { if (mode !== 'lobby') toLobby('YHTEYS PALVELIMEEN KATKESI'); });
  sock.on('ready', d => { myIdx = d.idx; roomCode = d.code; enterGame(); });
  sock.on('sel', d => {
    selS = d.sel; wins = d.wins; totals = d.totals;
    const mine = selS[myIdx];
    if (mine && !selInit) { localSel.laser = mine.laser; localSel.mis = mine.mis; selInit = true; }
    if (mine) localSel.ready = mine.ready;
  });
  sock.on('start', onStart);
  sock.on('R', d => { rocks = d.rocks.map(parseRock); });
  sock.on('fix', d => { if (me) { me.pos = d.p.slice(); me.speed = d.s; me.fixN = d.n; } });
  sock.on('S', onSnap);
  sock.on('left', d => toLobby(d && d.reason));
  setInterval(() => { if (sock.connected) { const t = performance.now(); sock.emit('png', t, () => { rtt = performance.now() - t; }); } }, 2000);
}
function doCreate() {
  initAudio(); setStatus('LUODAAN PELIÄ...');
  sock.emit('create', { origin: location.origin }, d => {
    setStatus(''); showPane('pHost');
    $('code').textContent = d.code; $('joinUrl').textContent = d.url;
    if (d.qr) $('qr').src = d.qr;
  });
}
function doJoin(code) {
  initAudio();
  code = String(code || '').toUpperCase().trim();
  if (code.length !== 4) { setStatus('KOODISSA ON NELJÄ KIRJAINTA'); return; }
  setStatus('LIITYTÄÄN...');
  sock.emit('join', { code }, d => { if (d && d.err) setStatus(d.err); else setStatus(''); });
}
function enterGame() {
  $('lobby').hidden = true; document.body.classList.add('ingame');
  mode = 'select'; selInit = false; localSel.ready = false;
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  if (isTouch) goFullscreen();
}
function toLobby(reason) {
  mode = 'lobby'; me = null; world = null; snaps = []; latest = null; myIdx = -1; selInit = false;
  $('lobby').hidden = false; document.body.classList.remove('ingame'); showPane('pMenu');
  setStatus(reason || '');
  updateTouchVisibility();
}
function goFullscreen() {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().then(() => {
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    }).catch(() => {});
  } catch (e) {}
}
function parseRock(o) {
  return { id: o.i, size: o.s, shape: o.k, p0: o.p, v: o.v, t0: o.t, ax: o.a, w: o.w,
    o: { r: o.o[0], u: o.o[1], f: o.o[2] }, model: MODELS.rocks[o.s][o.k] };
}
function onStart(d) {
  world = SD.makeWorldData(d.seed);
  rocks = d.rocks.map(parseRock); lo = d.lo;
  const sp = d.sp[myIdx];
  me = { pos: sp.p.slice(), r: sp.r, u: sp.u, f: sp.f, speed: sp.s, roll: 0, pitch: 0, yaw: 0, fixN: 0 };
  touch.thr = null;
  dust = []; for (let k = 0; k < 90; k++) dust.push(madd(me.pos, randDir(), rnd(60, 1000)));
  snaps = []; latest = null; timeOff = null; debris = []; dots = []; msg.d = 0; lastCount = -1;
  beamLocal.t = 0; oppBeam.t = 0; trailT.clear();
  SFX.launch();
}
function onSnap(s) {
  const now = performance.now() / 1000, off = s.t - now;
  if (timeOff === null || Math.abs(off - timeOff) > 1) timeOff = off; else timeOff += (off - timeOff) * 0.05;
  const old = mode;
  mode = s.m; modeT = s.mt; winnerId = s.w; drawReason = s.dr; wins = s.wn; totals = s.tt; prize = s.pr;
  latest = s;
  if (s.P) {
    if (snaps.length && s.t < snaps[snaps.length - 1].t) snaps = [];
    snaps.push(s); while (snaps.length > 30) snaps.shift();
    const ob = s.P[oppIdx()].be;
    if (ob) { oppBeam.t = 0.09; oppBeam.end = ob; }
  }
  if (old !== mode) onMode(old, mode);
  for (const e of s.E) handleEvent(e);
  updateTouchVisibility();
}
function onMode(old, nw) {
  if (nw === 'select') { localSel.ready = false; }
  if (nw === 'fight') SFX.go();
  if (nw === 'victory') { if (winnerId === myIdx) setTimeout(SFX.jingle, 600); }
  if (nw === 'docking') SFX.launch();
  if (nw === 'prize') SFX.fanfare();
}
function distK(p) { if (!me || !p) return 0.5; return clamp(1.2 - vlen(sub(p, me.pos)) / 15000, 0.12, 1); }
function handleEvent(e) {
  switch (e.e) {
    case 'msg': if (e.id === myIdx) msg = { t: e.t, d: e.d, c: e.c }; break;
    case 'sfx': {
      const mine = e.id === myIdx, fn = SFX[e.n];
      if (!fn) break;
      if (['err', 'alarm', 'locked'].includes(e.n)) { if (mine) fn(); }
      else play(fn, mine ? 1 : 0.4);
      break;
    }
    case 'las': if (e.id !== myIdx && lo) { const p = interpPlayer(e.id); play(SFX.laser, 0.45 * distK(p && p.pos), LASERS[lo[e.id].laser]); } break;
    case 'boom': {
      const m = SD.modelByKey(e.k), ent = { model: m, pos: e.p, r: e.o[0], u: e.o[1], f: e.o[2], speed: e.s };
      explodeFx(ent, e.c, e.b);
      play(e.b ? SFX.boom : SFX.small, distK(e.p));
      break;
    }
  }
}
// ---------- interpolointi ----------
function bracket(rt) {
  if (!snaps.length) return null;
  if (rt <= snaps[0].t) return { a: snaps[0], b: snaps[0], k: 0 };
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].t <= rt) {
      const a = snaps[i], b = snaps[i + 1] || a;
      return { a, b, k: b === a ? 0 : clamp((rt - a.t) / (b.t - a.t), 0, 1) };
    }
  }
  return { a: snaps[0], b: snaps[0], k: 0 };
}
const lerp3 = (a, b, k) => [a[0] + (b[0]-a[0])*k, a[1] + (b[1]-a[1])*k, a[2] + (b[2]-a[2])*k];
function oriFU(f, u) { f = norm(f); const r = norm(cross(u, f)); return { r, u: cross(f, r), f }; }
function interpPlayer(i, rt = srvNow() - INTERP) {
  const br = bracket(rt); if (!br || !br.a.P) return null;
  const A = br.a.P[i], B = br.b.P[i];
  const o = oriFU(lerp3(A.f, B.f, br.k), lerp3(A.u, B.u, br.k));
  return { pos: lerp3(A.p, B.p, br.k), r: o.r, u: o.u, f: o.f, speed: B.s, dead: !!B.d, id: i, def: SHIPDEF[i], model: MODELS[SHIPDEF[i].mk] };
}
function interpMissiles(rt) {
  const br = bracket(rt); if (!br || !br.b.M) return [];
  const am = new Map(); for (const m of (br.a.M || [])) am.set(m[0], m);
  return br.b.M.map(m => {
    const a = am.get(m[0]) || m, k = am.has(m[0]) ? br.k : 1;
    const o = oriFU(lerp3([a[4], a[5], a[6]], [m[4], m[5], m[6]], k), lerp3([a[7], a[8], a[9]], [m[7], m[8], m[9]], k));
    return { id: m[0], pos: lerp3([a[1], a[2], a[3]], [m[1], m[2], m[3]], k), r: o.r, u: o.u, f: o.f, model: m[10] ? MODELS.mini : MODELS.missile, tg: m[11] };
  });
}
function interpFlares(rt) {
  const br = bracket(rt); if (!br || !br.b.F) return [];
  const am = new Map(); for (const f of (br.a.F || [])) am.set(f[0], f);
  return br.b.F.map(f => { const a = am.get(f[0]) || f; return { id: f[0], pos: lerp3([a[1], a[2], a[3]], [f[1], f[2], f[3]], br.k) }; });
}
const rockEnt = (rk, t) => Object.assign(SD.rockPose(rk, t), { model: rk.model, size: rk.size });
const stationEnt = t => Object.assign(SD.stationPose(world.station, t), { model: MODELS.station });

// ===================== OMA LENTO =====================
const K = { pu: ['ArrowDown', 'KeyS'], pd: ['ArrowUp', 'KeyW'], rl: ['ArrowLeft', 'KeyA'], rr: ['ArrowRight', 'KeyD'],
  yl: ['KeyQ', 'Comma'], yr: ['KeyE', 'Period'], tu: ['KeyR', 'ShiftLeft', 'ShiftRight', 'PageUp', 'NumpadAdd'],
  td: ['KeyF', 'KeyZ', 'PageDown', 'NumpadSubtract'], fire: ['Space'], mis: ['KeyX', 'Enter', 'NumpadEnter', 'KeyM'],
  flare: ['KeyC', 'KeyN', 'KeyB', 'Tab'] };
const anyKey = l => l.some(k => keys[k]);
function canFly() {
  const st = myStats();
  return me && st && !st.d && (mode === 'fight' || (mode === 'victory' && winnerId === myIdx));
}
function flyLocal(dt) {
  const ease = (v, inp) => inp ? clamp(v + inp*dt*4, -1, 1) : v - Math.sign(v) * Math.min(Math.abs(v), dt*5);
  const toward = (v, t) => v + (t - v) * Math.min(1, dt * 9);
  let kr = (anyKey(K.rr) ? 1 : 0) - (anyKey(K.rl) ? 1 : 0);
  let kp = (anyKey(K.pu) ? 1 : 0) - (anyKey(K.pd) ? 1 : 0);
  const ky = (anyKey(K.yr) || touch.yawR ? 1 : 0) - (anyKey(K.yl) || touch.yawL ? 1 : 0);
  if (invert) kp = -kp;
  if (touch.stick) {
    me.roll = toward(me.roll, touch.sx);
    me.pitch = toward(me.pitch, (invert ? -1 : 1) * touch.sy);
  } else { me.roll = ease(me.roll, kr); me.pitch = ease(me.pitch, kp); }
  me.yaw = ease(me.yaw, ky);
  rotRoll(me, me.roll * 2.2 * dt); rotPitch(me, me.pitch * 1.35 * dt); rotYaw(me, me.yaw * 0.7 * dt); orthonorm(me);
  if (touch.thr !== null && !anyKey(K.tu) && !anyKey(K.td)) me.speed += clamp(touch.thr * MAXSPD - me.speed, -210*dt, 210*dt);
  if (anyKey(K.tu)) { me.speed = Math.min(MAXSPD, me.speed + 210*dt); touch.thr = null; }
  if (anyKey(K.td)) { me.speed = Math.max(0, me.speed - 210*dt); touch.thr = null; }
  me.pos = madd(me.pos, me.f, me.speed * dt);
}
function localLaser(dt, firing) {
  laserCdLocal -= dt; beamLocal.t -= dt;
  const st = myStats(); if (!firing || !st || st.oh || !lo) return;
  const L = LASERS[lo[myIdx].laser];
  if (laserCdLocal > 0) return;
  laserCdLocal = L.cd; beamLocal.t = Math.min(0.09, L.cd * 0.85);
  SFX.laser(L);
  // kosmeettinen säteen loppupiste (palvelin ratkaisee oikeat osumat)
  const t = srvNow(), cands = [];
  const op = interpPlayer(oppIdx()); if (op && !op.dead) cands.push([op.pos, op.def.hitR, true]);
  for (const rk of rocks) cands.push([SD.rockPose(rk, t).pos, ROCK_R[rk.size] * 0.85, false]);
  cands.push([world.station.pos, STS * 1.05, false]);
  let bt = L.range;
  for (const [pos, r, ship] of cands) {
    const rel = sub(pos, me.pos), tt = dot(rel, me.f);
    if (tt <= 0 || tt > bt + r) continue;
    const assist = ship ? (1 + tt * 0.00035) * (L.wide || 1) : 1;
    if (vlen(madd(rel, me.f, -tt)) < r * assist) bt = Math.max(1, tt - r * 0.5);
  }
  beamLocal.end = madd(me.pos, me.f, bt);
  if (bt < L.range) dots.push({ p: beamLocal.end.slice(), v: scl(randDir(), 60), life: 0.3 });
}
function explodeFx(e, col, big) {
  let n = 0;
  for (const pt of e.model.parts) for (const ed of pt.edges) {
    if (n++ > 44) break;
    const a = toWorld(e, pt.v[ed.a]), b = toWorld(e, pt.v[ed.b]), mid = scl(add(a, b), 0.5);
    debris.push({ p: add(e.pos, mid), h: scl(sub(b, a), 0.5), v: madd(scl(e.f, (e.speed || 0) * 0.4), norm(mid), rnd(20, 110)),
      ax: randDir(), w: rnd(-4, 4), life: rnd(1.6, 3.2), col: pt.col !== undefined ? pt.col : col });
  }
  const nd = big ? 70 : 18;
  for (let i = 0; i < nd; i++) dots.push({ p: e.pos.slice(), v: madd(scl(e.f, (e.speed || 0) * 0.3), randDir(), rnd(30, 200) * (big ? 1 : 0.5)), life: rnd(0.6, 2) });
}
function update(dt) {
  animT += dt; modeT += dt; msg.d -= dt; localSel.msgT -= dt; escT -= dt; oppBeam.t -= dt;
  if (!world || !me) return;
  if (mode === 'countdown') { const n = Math.floor(modeT); if (n !== lastCount && n < 3) { lastCount = n; SFX.count(); } }
  const firing = anyKey(K.fire) || touch.laser;
  if (canFly()) {
    flyLocal(dt);
    localLaser(dt, firing);
    sendT -= dt;
    if (sendT <= 0) {
      sendT = 1 / 30;
      sock.emit('st', { n: me.fixN, p: me.pos.map(v => Math.round(v * 10) / 10), f: me.f.map(v => Math.round(v * 1e4) / 1e4),
        u: me.u.map(v => Math.round(v * 1e4) / 1e4), s: Math.round(me.speed), fire: firing });
    }
  } else beamLocal.t -= dt;
  const st = myStats();
  if (st && st.lp > 0 && !st.lk && mode === 'fight') { lockBeepT -= dt; if (lockBeepT <= 0) { SFX.lock(); lockBeepT = 0.25 - st.lp * 0.15; } }
  for (const d of dust) for (let i = 0; i < 3; i++) { const r = d[i] - me.pos[i]; if (r > 1000) d[i] -= 2000; else if (r < -1000) d[i] += 2000; }
  for (const pl of world.planets) rotYaw(pl.ori, 0.015 * dt);
  const rt = srvNow() - INTERP;
  for (const m of interpMissiles(rt)) {
    const t = (trailT.get(m.id) || 0) - dt;
    if (t <= 0) { dots.push({ p: madd(m.pos, m.f, -14), v: scl(randDir(), 8), life: 0.7, col: chance(0.3) ? LGREY : GREY }); trailT.set(m.id, 0.035); }
    else trailT.set(m.id, t);
  }
  for (const f of interpFlares(rt)) if (chance(dt * 20)) dots.push({ p: f.pos.slice(), v: scl(randDir(), 25), life: 0.45, col: chance(0.5) ? YELLOW : ORANGE });
  for (const d of debris) { d.p = madd(d.p, d.v, dt); d.h = rotAxis(d.h, d.ax, d.w * dt); d.life -= dt; }
  debris = debris.filter(d => d.life > 0);
  for (const d of dots) { d.p = madd(d.p, d.v, dt); d.life -= dt; }
  dots = dots.filter(d => d.life > 0);
}
// ===================== 3D-PIIRTO =====================
const CAM = { pos:[0,0,0], r:[1,0,0], u:[0,1,0], f:[0,0,1], cx:W/2, cy:VH/2, F:FOCAL, hw:W/2, hh:VH/2 };
function setCam(pos, o, cx = W/2, cy = VH/2, F = FOCAL, hw = W/2, hh = VH/2) {
  CAM.pos = pos; CAM.r = o.r; CAM.u = o.u; CAM.f = o.f; CAM.cx = cx; CAM.cy = cy; CAM.F = F; CAM.hw = hw; CAM.hh = hh;
}
function camSpace(p) { const d = sub(p, CAM.pos); return [dot(d, CAM.r), dot(d, CAM.u), dot(d, CAM.f)]; }
const project = c => [CAM.cx + c[0] * CAM.F / c[2], CAM.cy - c[1] * CAM.F / c[2]];
function line3(a, b, col) {
  if (a[2] < NEAR && b[2] < NEAR) return;
  if (a[2] < NEAR) { const t = (NEAR - a[2]) / (b[2] - a[2]); a = [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t, NEAR]; }
  else if (b[2] < NEAR) { const t = (NEAR - b[2]) / (a[2] - b[2]); b = [b[0] + (a[0]-b[0])*t, b[1] + (a[1]-b[1])*t, NEAR]; }
  const p = project(a), q = project(b);
  line(p[0], p[1], q[0], q[1], col);
}
function drawModel(e, baseCol, dcolOverride) {
  const m = e.model, c = camSpace(e.pos);
  if (c[2] < -m.r) return;
  if (c[2] > m.r) {
    const s = CAM.F / c[2];
    if (m.r * s < 1.2) { const p = project(c); pset(p[0], p[1], baseCol); return; }
    if ((Math.abs(c[0]) - m.r) * s > CAM.hw + 2 || (Math.abs(c[1]) - m.r) * s > CAM.hh + 2) return;
  }
  const M = [[dot(e.r, CAM.r), dot(e.u, CAM.r), dot(e.f, CAM.r)],
             [dot(e.r, CAM.u), dot(e.u, CAM.u), dot(e.f, CAM.u)],
             [dot(e.r, CAM.f), dot(e.u, CAM.f), dot(e.f, CAM.f)]];
  const tf = v => [c[0] + M[0][0]*v[0] + M[0][1]*v[1] + M[0][2]*v[2],
                   c[1] + M[1][0]*v[0] + M[1][1]*v[1] + M[1][2]*v[2],
                   c[2] + M[2][0]*v[0] + M[2][1]*v[1] + M[2][2]*v[2]];
  const lc = toLocal(e, sub(CAM.pos, e.pos));
  const small = c[2] > 0 && m.r * CAM.F / c[2] < 4;
  const parts = m.parts.length > 1 ? m.parts.slice().sort((a, b) => vlen(sub(b.cen, lc)) - vlen(sub(a.cen, lc))) : m.parts;
  for (const pt of parts) {
    const col = pt.col !== undefined ? pt.col : baseCol;
    const dcol = dcolOverride !== undefined ? dcolOverride : (pt.dcol !== undefined ? pt.dcol : col);
    const vis = pt.faces.map(f => dot(f.n, sub(lc, f.p)) > 0);
    const cvv = pt.v.map(tf);
    if (!small && cvv.every(v => v[2] > NEAR)) {
      const pr = cvv.map(project);
      pt.faces.forEach((f, i) => { if (vis[i]) fillPoly(f.idx.map(k => pr[k]), BLACK); });
    }
    for (const ed of pt.edges) if (vis[ed.f1] || vis[ed.f2]) line3(cvv[ed.a], cvv[ed.b], col);
    for (const d of pt.decals) if (vis[d.f]) line3(tf(d.a), tf(d.b), dcol);
  }
}
function sphereScreen(pos, R) {
  const c = camSpace(pos), d = vlen(c);
  if (c[2] <= 0 || d <= R) return null;
  const p = project(c);
  return { c, p, r: CAM.F * R / Math.sqrt(Math.max(1, c[2]*c[2] - R*R)) * Math.min(1.6, d / c[2]) };
}
function surfRing(pl, ax, bx, center, rad, col, seg = 48) {
  let prev = null;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg * Math.PI * 2;
    const w = add(center, add(scl(ax, Math.cos(t) * rad), scl(bx, Math.sin(t) * rad)));
    const vis = dot(sub(w, pl.pos), sub(CAM.pos, w)) > 0;
    const cp = camSpace(w);
    if (vis && prev) line3(prev, cp, col);
    prev = vis ? cp : null;
  }
}
function drawBody(pl) {
  const s = sphereScreen(pl.pos, pl.R);
  if (s) {
    if (s.r < 1.2) { pset(s.p[0], s.p[1], pl.col); return; }
    if (s.p[0] + s.r < CAM.cx - CAM.hw || s.p[0] - s.r > CAM.cx + CAM.hw || s.p[1] + s.r < 0 || s.p[1] - s.r > VH) { if (!pl.rings) return; }
    else {
      circle(s.p[0], s.p[1], s.r, pl.col, BLACK);
      if (s.r >= 6) {
        const o = pl.ori, R = pl.R;
        const lat = (la, col) => surfRing(pl, o.r, o.f, madd(pl.pos, o.u, R * Math.sin(la)), R * Math.cos(la), col);
        if (pl.style === 'giant') { for (const la of [-0.95, -0.62, -0.3, -0.08, 0.16, 0.42, 0.72, 1.0]) lat(la, la === 0.16 || la === -0.08 ? pl.col2 : pl.col); }
        else if (pl.style === 'globe') {
          lat(0, pl.col); lat(0.6, pl.col); lat(-0.6, pl.col);
          surfRing(pl, o.u, o.f, pl.pos, R, pl.col); surfRing(pl, o.u, o.r, pl.pos, R, pl.col);
          surfRing(pl, o.u, norm(add(o.r, o.f)), pl.pos, R, DGREY); surfRing(pl, o.u, norm(sub(o.r, o.f)), pl.pos, R, DGREY);
        } else {
          lat(0, DGREY);
          for (const cr of pl.craters) {
            const n = norm(cr), ax = norm(cross(n, [0, 1, 0.01])), bx = cross(n, ax);
            surfRing(pl, ax, bx, madd(pl.pos, n, R * Math.cos(cr[3])), R * Math.sin(cr[3]), LGREY, 20);
          }
        }
      }
    }
  }
  if (pl.rings) {
    const o = pl.ori, dc = vlen(sub(pl.pos, CAM.pos));
    for (const [k, col] of [[1.35, DGREY], [1.5, GREY], [1.62, pl.ringCol], [1.85, pl.ringCol], [2.05, GREY]]) {
      let prev = null; const rad = pl.R * k;
      for (let i = 0; i <= 96; i++) {
        const t = i / 96 * Math.PI * 2, w = add(pl.pos, add(scl(o.r, Math.cos(t) * rad), scl(o.f, Math.sin(t) * rad)));
        const cp = camSpace(w);
        let vis = true;
        if (s && cp[2] > NEAR) { const q = project(cp); if (Math.hypot(q[0] - s.p[0], q[1] - s.p[1]) < s.r && vlen(sub(w, CAM.pos)) > dc) vis = false; }
        if (vis && prev) line3(prev, cp, col);
        prev = vis ? cp : null;
      }
    }
  }
}
function drawSun() {
  const s = sphereScreen(world.sun.pos, world.sun.R);
  if (!s) return;
  if (s.r < 1.5) { pset(s.p[0], s.p[1], YELLOW); return; }
  const y0 = Math.max(clipY0, Math.ceil(s.p[1] - s.r)), y1 = Math.min(clipY1, Math.floor(s.p[1] + s.r));
  for (let y = y0; y <= y1; y++) {
    const dy = y - s.p[1], w = Math.sqrt(Math.max(0, s.r*s.r - dy*dy));
    const j = s.r > 4 ? rnd(-1.5, 2.5) * (1 + s.r * 0.006) : 0;
    hline(s.p[0] - w - j, s.p[0] + w + j, y, ORANGE);
    hline(s.p[0] - w*0.8, s.p[0] + w*0.8, y, YELLOW);
    if (w > 3) hline(s.p[0] - w*0.5, s.p[0] + w*0.5, y, WHITE);
  }
}
const SKY = (() => {
  const R = SD.mulberry32(99), stars = [], gal = [];
  for (let i = 0; i < 320; i++) stars.push({ d: norm([R()*2-1, R()*2-1, R()*2-1]), c: R() < 0.15 ? LGREY : (R() < 0.5 ? GREY : DGREY) });
  const gc = norm([-0.5, 0.45, 0.75]), ga = norm(cross(gc, [0.3, 1, 0])), gb = cross(gc, ga);
  for (let i = 0; i < 300; i++) {
    const arm = i % 2, t = R(), a = t * 5.2 + arm * Math.PI + (R() - 0.5) * 0.5, rr = t * 0.11 + 0.004;
    gal.push({ d: norm(add(gc, add(scl(ga, Math.cos(a) * rr), scl(gb, Math.sin(a) * rr * 0.45)))), c: t < 0.15 ? WHITE : (t < 0.45 ? LBLUE : (R() < 0.5 ? PURPLE : DGREY)) });
  }
  return { stars, gal };
})();
function drawSkyPoints(list) {
  for (const s of list) {
    const z = dot(s.d, CAM.f); if (z < 0.2) continue;
    pset(CAM.cx + dot(s.d, CAM.r) * CAM.F / z, CAM.cy - dot(s.d, CAM.u) * CAM.F / z, s.c);
  }
}
function drawComet() {
  const c = world.comet, cp = camSpace(c.pos);
  if (cp[2] < NEAR) return;
  const tb = norm(cross(c.tail, [0, 1, 0]));
  for (let k = -2; k <= 2; k++) {
    const end = madd(madd(c.pos, c.tail, 9000 - Math.abs(k) * 1500), tb, k * 700);
    line3(cp, camSpace(end), k === 0 ? LBLUE : (Math.abs(k) === 1 ? BLUE : PURPLE));
  }
  const q = project(cp); pset(q[0], q[1], WHITE); pset(q[0]+1, q[1], LGREY); pset(q[0], q[1]+1, LGREY);
}
function drawEngine(p) {
  const len = 6 + p.speed * 0.07;
  for (const e of p.def.exh) {
    const a = add(p.pos, toWorld(p, e));
    line3(camSpace(a), camSpace(madd(a, p.f, -len * rnd(0.7, 1.2))), chance(0.5) ? ORANGE : YELLOW);
    line3(camSpace(madd(a, p.u, 2)), camSpace(madd(a, p.f, -len * 0.5)), LRED);
  }
}
function drawWorld(opp, withDust) {
  drawSkyPoints(SKY.stars); drawSkyPoints(SKY.gal);
  drawSun(); drawComet();
  const bodies = world.planets.map(pl => [vlen(sub(pl.pos, CAM.pos)), pl]).sort((a, b) => b[0] - a[0]);
  for (const [, pl] of bodies) drawBody(pl);
  if (withDust) {
    const sl = Math.min(80, me.speed * 0.05);
    for (const d of dust) {
      const c = camSpace(d); if (c[2] < 8) continue;
      const col = c[2] < 300 ? LGREY : (c[2] < 650 ? GREY : DGREY);
      if (sl >= 4) line3(c, camSpace(madd(d, me.f, sl)), col);
      else { const q = project(c); pset(q[0], q[1], col); }
    }
  }
  const t = srvNow(), rt = t - INTERP, list = [];
  for (const rk of rocks) list.push([rockEnt(rk, t), LGREY]);
  list.push([stationEnt(t), WHITE, 'st']);
  if (opp && !opp.dead) list.push([opp, opp.def.col, 'ship']);
  const mis = interpMissiles(rt);
  for (const m of mis) list.push([m, m.tg === myIdx ? LRED : WHITE]);
  list.sort((a, b) => vlen(sub(b[0].pos, CAM.pos)) - vlen(sub(a[0].pos, CAM.pos)));
  for (const [e, col, kind] of list) { drawModel(e, col, kind === 'st' ? LBLUE : undefined); if (kind === 'ship') drawEngine(e); }
  for (const d of debris) { if (d.life < 0.5 && Math.random() < 0.4) continue; line3(camSpace(add(d.p, d.h)), camSpace(sub(d.p, d.h)), d.col); }
  const dc = [YELLOW, WHITE, ORANGE, LRED];
  for (const d of dots) { const c = camSpace(d.p); if (c[2] > NEAR) { const q = project(c); pset(q[0], q[1], d.col !== undefined ? d.col : dc[(Math.random()*4)|0]); } }
  for (const f of interpFlares(rt)) {
    const c = camSpace(f.pos); if (c[2] < NEAR) continue;
    const q = project(c), s = Math.max(1, Math.min(7, 1200 / c[2])), col = chance(0.5) ? WHITE : YELLOW;
    line(q[0] - s, q[1], q[0] + s, q[1], col); line(q[0], q[1] - s, q[0], q[1] + s, col);
    if (s > 2) { line(q[0] - s*0.6, q[1] - s*0.6, q[0] + s*0.6, q[1] + s*0.6, ORANGE); line(q[0] - s*0.6, q[1] + s*0.6, q[0] + s*0.6, q[1] - s*0.6, ORANGE); }
  }
  if (opp && !opp.dead && oppBeam.t > 0 && oppBeam.end && lo)
    for (const g of opp.def.guns) line3(camSpace(add(opp.pos, toWorld(opp, g))), camSpace(oppBeam.end), LASERS[lo[opp.id].laser].col);
}
// ---------- HUD ----------
function edgeArrow(c, col, label) {
  let dx = c[0], dy = -c[1];
  if (Math.abs(dx) + Math.abs(dy) < 1e-6) dy = 1;
  const l = Math.hypot(dx, dy); dx /= l; dy /= l;
  const k = Math.min((CAM.hw - 16) / Math.max(1e-6, Math.abs(dx)), (CAM.hh - 16) / Math.max(1e-6, Math.abs(dy)));
  const px = CAM.cx + dx * k, py = CAM.cy + dy * k;
  const tx = px + dx * 8, ty = py + dy * 8, bx = px - dx * 4, by = py - dy * 4;
  line(tx, ty, bx - dy * 7, by + dx * 7, col); line(tx, ty, bx + dy * 7, by - dx * 7, col); line(bx - dy * 7, by + dx * 7, bx + dy * 7, by - dx * 7, col);
  if (label) text(Math.round(px - dx * 20 - label.length * 4), Math.round(py - dy * 16 - 4), label, col);
}
function markTarget(pos, r, col, label, st, isOpp) {
  const c = camSpace(pos);
  const q0 = c[2] > NEAR ? project(c) : null;
  if (!q0 || Math.abs(q0[0] - CAM.cx) > CAM.hw - 4 || Math.abs(q0[1] - CAM.cy) > CAM.hh - 4) { edgeArrow(c, col, label); return; }
  const q = q0, s = Math.max(8, Math.min(70, r * CAM.F / c[2] + 3)), L = Math.max(3, s * 0.35);
  for (const [sx, sy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
    const x = q[0] + sx * s, y = q[1] + sy * s;
    line(x, y, x - sx * L, y, col); line(x, y, x, y - sy * L, col);
  }
  textC(Math.round(q[1] + s + 3), (label ? label + ' ' : '') + Math.round(vlen(sub(pos, me.pos))) + 'M', col, 1, q[0] - 100, 200);
  if (isOpp && st && st.lp > 0) {
    if (st.lk) {
      const b = (animT * 8 | 0) % 2 ? LRED : YELLOW, d = s + 6;
      line(q[0], q[1] - d, q[0] + d, q[1], b); line(q[0] + d, q[1], q[0], q[1] + d, b);
      line(q[0], q[1] + d, q[0] - d, q[1], b); line(q[0] - d, q[1], q[0], q[1] - d, b);
      textC(Math.round(q[1] - s - 13), 'LUKITTU', b, 1, q[0] - 60, 120);
    } else { const d = s + (1 - st.lp) * 46; rect(Math.round(q[0] - d), Math.round(q[1] - d), Math.round(d * 2), Math.round(d * 2), YELLOW); }
  }
}
function drawCrosshair(st) {
  const cx = CAM.cx, cy = CAM.cy, col = st && st.oh ? ORANGE : WHITE;
  if (myIdx === 0) {
    hline(cx - 14, cx - 5, cy, col); hline(cx + 5, cx + 14, cy, col); line(cx, cy - 14, cx, cy - 5, col); line(cx, cy + 5, cx, cy + 14, col);
    hline(cx - 24, cx - 19, cy - 9, GREY); hline(cx + 19, cx + 24, cy - 9, GREY);
  } else {
    circle(cx, cy, 10, col); pset(cx, cy, col);
    line(cx - 18, cy, cx - 12, cy, col); line(cx + 12, cy, cx + 18, cy, col); line(cx, cy + 12, cx, cy + 18, col);
  }
}
function drawOwnBeam() {
  if (beamLocal.t <= 0 || !beamLocal.end || !lo) return;
  const c = camSpace(beamLocal.end); if (c[2] < NEAR) return;
  const q = project(c), L = LASERS[lo[myIdx].laser], col = L.col;
  if (myIdx === 0) { line(50, VH - 1, q[0], q[1], col); line(W - 50, VH - 1, q[0], q[1], col); }
  else { line(W/2 - 2, VH - 1, q[0], q[1], col); line(W/2 + 2, VH - 1, q[0], q[1], col); line(12, VH - 36, q[0], q[1], col); line(W - 12, VH - 36, q[0], q[1], col); }
  if (L.wide) circle(q[0], q[1], 3, col);
}
function drawApproach(st) {
  for (let k = 1; k <= 6; k++) {
    const c = madd(st.pos, st.f, STS + 320 * k), hx = 0.36 * STS + k * 18, hy = 0.14 * STS + k * 8;
    const pts = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a, b]) => camSpace(add(c, add(scl(st.r, a * hx), scl(st.u, b * hy)))));
    const col = (animT * 6 - k | 0) % 6 === 0 ? LGREEN : GREEN;
    for (let i = 0; i < 4; i++) line3(pts[i], pts[(i+1) % 4], col);
  }
}
function drawView() {
  const st = myStats(), def = SHIPDEF[myIdx];
  setClip(0, 0, W - 1, VH - 1); fillRect(0, 0, W, VH, BLACK);
  const opp = interpPlayer(oppIdx());
  const dead = st && st.d;
  const chase = dead && opp && !opp.dead && winnerId === oppIdx() && st.dt > 2.5 && (mode === 'victory' || mode === 'docking');
  if (chase) {
    const pos = add(opp.pos, add(scl(opp.f, -240), scl(opp.u, 60)));
    setCam(pos, oriFromForward(sub(madd(opp.pos, opp.f, 300), pos), opp.u));
    drawWorld(opp, false);
  } else {
    setCam(me.pos, me);
    drawWorld(opp, !dead);
  }
  const blink = (animT * 4 | 0) % 2;
  if (!dead) {
    drawOwnBeam();
    if (mode === 'victory' && winnerId === myIdx) {
      const sp = stationEnt(srvNow());
      if (vlen(sub(sp.pos, me.pos)) < 12000) drawApproach(sp);
      markTarget(sp.pos, STS, CYAN, 'ASEMA', st, false);
    } else if (opp && !opp.dead) markTarget(opp.pos, opp.def.hitR, LRED, 'P' + (oppIdx() + 1), st, true);
    for (const m of interpMissiles(srvNow() - INTERP)) if (m.tg === myIdx) { const c = camSpace(m.pos); if (c[2] <= NEAR || Math.abs(project(c)[0] - CAM.cx) > CAM.hw) edgeArrow(c, blink ? LRED : WHITE, ''); }
    drawCrosshair(st);
    text(5, 4, 'P' + (myIdx + 1) + ' ' + def.name, def.col);
    const incoming = interpMissiles(srvNow() - INTERP).some(m => m.tg === myIdx);
    const oppSt = latest && latest.P ? latest.P[oppIdx()] : null;
    if (incoming && blink) textR(W - 5, 4, 'OHJUS!', LRED);
    else if (oppSt && oppSt.lk && mode === 'fight') textR(W - 5, 4, 'LUKITTU!', blink ? LRED : ORANGE);
    else textR(W - 5, 4, Math.round(rtt) + 'MS', DGREY);
    if (mode === 'victory' && winnerId === myIdx) textC(18, 'TELAKOIDU ASEMALLE', blink ? LGREEN : GREEN);
  } else if (chase) {
    textC(18, 'PELAAJA ' + (winnerId + 1) + ' VOITTI', SHIPDEF[winnerId].col); textC(30, 'SEURATAAN VOITTAJAA', GREY);
  } else textC(80, 'TUHOUTUIT', blink ? LRED : WHITE, 3);
  if (mode === 'countdown') {
    const n = 3 - Math.floor(modeT);
    textC(90, n > 0 ? String(n) : 'TAISTELU!', n > 0 ? YELLOW : LGREEN, n > 0 ? 6 : 3);
    if (lo) textC(170, 'LASER: ' + LASERS[lo[myIdx].laser].nm + '   OHJUS: ' + MISSILES[lo[myIdx].mis].nm, GREY);
    textC(184, isTouch ? 'VASEN PUIKKO OHJAA, OIKEALLA ASEET' : 'NUOLET/WASD OHJAUS  VÄLILYÖNTI LASER  X OHJUS  C SOIHDUT', DGREY);
  }
  if (mode === 'fight' && modeT < 1) textC(90, 'TAISTELU!', LGREEN, 3);
  if (mode === 'draw') { textC(80, 'EI VOITTAJAA', blink ? LRED : WHITE, 2); textC(110, drawReason, ORANGE); }
  if (escT > 0) textC(VH - 30, 'PAINA ESC UUDELLEEN POISTUAKSESI', ORANGE);
  if (msg.d > 0) {
    const bl = msg.c === LRED && (msg.d * 6 | 0) % 2 === 0;
    if (!bl) { const tw = msg.t.length * 8; fillRect(W/2 - tw/2 - 3, VH - 18, tw + 6, 11, BLACK); textC(VH - 16, msg.t, msg.c); }
  }
  rect(0, 0, W, VH, st && st.hf ? LRED : def.frame);
  if (myIdx === 1) rect(2, 2, W - 4, VH - 4, DGREY);
  fullClip();
}
// ---------- kojelauta ----------
function bar(x, y, w, frac, col) { frac = clamp(frac, 0, 1); fillRect(x, y, w, 5, BLACK); rect(x - 1, y - 1, w + 2, 7, DGREY); if (frac > 0) fillRect(x, y, Math.max(1, Math.round(w * frac)), 5, col); }
function boxes(x, y, n, max, col, w = 6) { for (let k = 0; k < max; k++) { if (k < n) fillRect(x + k * (w + 2), y, w, 5, col); else rect(x + k * (w + 2), y, w, 5, DGREY); } }
function drawDash() {
  const st = myStats(); if (!st || !lo) return;
  const y0 = VH, i = myIdx, def = SHIPDEF[i], L = LASERS[lo[i].laser], M = MISSILES[lo[i].mis];
  setClip(0, y0, W - 1, H - 1); fillRect(0, y0, W, H - VH, BLACK);
  const blink = (animT * 4 | 0) % 2, lab = i === 0 ? CYAN : YELLOW;
  rect(0, y0 + 1, W, H - VH - 1, def.frame);
  const barsX = i === 0 ? 8 : W - 136, infoX = i === 0 ? W - 136 : 8;
  const speed = me ? me.speed : st.s;
  const rows = [['KILPI', st.sh / 100, st.sh < 25 ? LRED : LGREEN], ['RUNKO', st.hu / 100, st.hu < 30 ? LRED : lab],
                ['LÄMPÖ', st.he / 100, st.oh ? (blink ? LRED : ORANGE) : (st.he > 70 ? ORANGE : GREEN)], ['NOPEUS', speed / MAXSPD, YELLOW]];
  rows.forEach((r, k) => { const y = y0 + 7 + k * 11; text(barsX, y, r[0], lab); bar(barsX + 54, y + 1, 72, r[1], r[2]); });
  let y = y0 + 7 + 4 * 11;
  text(barsX, y, 'OHJ', lab); boxes(barsX + 32, y + 1, st.mi, M.cnt, st.lk ? (blink ? LRED : YELLOW) : LGREEN, M.cnt > 6 ? 7 : 10);
  y += 11; text(barsX, y, 'SOI', lab); boxes(barsX + 32, y + 1, st.fl, 8, YELLOW, 9);
  y += 11;
  if (M.guided) { text(barsX, y, 'LUK', lab); bar(barsX + 32, y + 1, 94, st.lp, st.lk ? LRED : ORANGE); }
  else text(barsX, y, 'RAKETIT: SUORALENTO', GREY);
  text(infoX, y0 + 7, L.nm, L.col); text(infoX + 72, y0 + 7, '*'.repeat(L.tier), [0, GREY, LGREEN, YELLOW, LRED][L.tier]);
  text(infoX, y0 + 18, M.nm, WHITE); text(infoX + 72, y0 + 18, '*'.repeat(M.tier), [0, GREY, LGREEN, YELLOW, LRED][M.tier]);
  text(infoX, y0 + 31, 'VOITOT ' + wins[i] + '-' + wins[1 - i], LGREEN);
  const opp = interpPlayer(oppIdx());
  const winnerMe = mode === 'victory' && winnerId === i;
  const tgt = winnerMe ? world.station.pos : (opp && !opp.dead ? opp.pos : null);
  const ccx = infoX + 12, ccy = y0 + 64;
  circle(ccx, ccy, 10, GREY);
  if (tgt && !st.d && me) {
    const d = norm(toLocal(me, sub(tgt, me.pos)));
    fillRect(Math.round(ccx + d[0] * 8) - 1, Math.round(ccy - d[1] * 8) - 1, 3, 3, d[2] >= 0 ? LGREEN : LRED);
    text(infoX + 28, ccy - 9, winnerMe ? 'ASEMA' : 'KOHDE', GREY);
    text(infoX + 28, ccy + 2, (vlen(sub(tgt, me.pos)) / 1000).toFixed(1) + ' KM', WHITE);
  }
  const rcx = W / 2, rcy = y0 + 46;
  setClip(150, y0 + 3, W - 150, H - 3);
  const items = [];
  if (!st.d && me) {
    const add2 = (pos, c, s) => items.push([toLocal(me, sub(pos, me.pos)), c, s]);
    const t = srvNow();
    if (opp && !opp.dead) add2(opp.pos, LRED, 3);
    add2(world.station.pos, CYAN, 4);
    for (const rk of rocks) add2(SD.rockPose(rk, t).pos, rk.size === 0 ? LGREY : GREY, rk.size === 0 ? 3 : 2);
    for (const m of interpMissiles(t - INTERP)) add2(m.pos, m.tg === myIdx ? ((animT * 8 | 0) % 2 ? LRED : WHITE) : WHITE, 2);
    for (const f of interpFlares(t - INTERP)) add2(f.pos, YELLOW, 1);
  }
  if (i === 0) {
    const rx = 120, ry = 34;
    ellipse(rcx, rcy, rx, ry, GREEN, 64); ellipse(rcx, rcy, rx * 0.5, ry * 0.5, DGREY, 40);
    line(rcx, rcy - ry, rcx, rcy + ry, DGREY); line(rcx - rx, rcy, rcx + rx, rcy, DGREY);
    line(rcx, rcy, rcx - 70, rcy - 26, DGREY); line(rcx, rcy, rcx + 70, rcy - 26, DGREY);
    for (const [l, c, s] of items) {
      if (Math.abs(l[0]) > RADAR_R || Math.abs(l[1]) > RADAR_R || Math.abs(l[2]) > RADAR_R) continue;
      const sx = Math.round(rcx + l[0] / RADAR_R * rx), sy = Math.round(rcy - l[2] / RADAR_R * ry), ty = Math.round(sy - l[1] / RADAR_R * 34);
      line(sx, sy, sx, ty, c); fillRect(sx - 1, ty - 1, s, 2, c);
    }
  } else {
    const rr = 42;
    circle(rcx, rcy, rr, GREEN); circle(rcx, rcy, rr * 0.5, DGREY);
    line(rcx - rr, rcy, rcx + rr, rcy, DGREY); line(rcx, rcy - rr, rcx, rcy + rr, DGREY);
    const sw = animT * 2.5; line(rcx, rcy, rcx + Math.cos(sw) * rr, rcy + Math.sin(sw) * rr, GREEN);
    for (const [l, c, s] of items) {
      const sx = l[0] / RADAR_R * rr, sy = -l[2] / RADAR_R * rr;
      if (Math.hypot(sx, sy) > rr || Math.abs(l[1]) > RADAR_R) continue;
      const X = Math.round(rcx + sx), Y = Math.round(rcy + sy);
      if (l[1] >= 0) fillRect(X - 1, Y - 1, s, s, c); else rect(X - 1, Y - 1, s + 1, s + 1, c);
    }
  }
  pset(rcx, rcy, WHITE);
  fullClip();
}
// ===================== MUUT RUUDUT =====================
const SEL_ROWS = { laserY: 38, misY: 118, rowH: 11, x0: 8, x1: 430 };
function selRowAt(x, y) {
  if (x < SEL_ROWS.x0 || x > SEL_ROWS.x1) return -1;
  for (let k = 0; k < 6; k++) {
    if (y >= SEL_ROWS.laserY + k * 11 - 2 && y < SEL_ROWS.laserY + k * 11 + 9) return k;
    if (y >= SEL_ROWS.misY + k * 11 - 2 && y < SEL_ROWS.misY + k * 11 + 9) return 6 + k;
  }
  return -1;
}
const READY_BTN = { x: 200, y: 290, w: 240, h: 26 };
function drawSelect() {
  fullClip(); fillRect(0, 0, W, H, BLACK);
  if (myIdx < 0) return;
  const d = SHIPDEF[myIdx], s = localSel, blink = (animT * 3 | 0) % 2;
  textC(6, 'STELLAR DUEL  -  PELAAJA ' + (myIdx + 1) + ' ' + d.name, d.col);
  hline(4, W - 5, 16, d.frame);
  setCam([0,0,0], newOri(), 540, 82, 240, 100, 60);
  setClip(440, 20, W - 3, 160);
  const pe = { model: MODELS[d.mk], pos: [0, 0, 330], ...newOri() };
  rotYaw(pe, animT * 0.8); rotPitch(pe, 0.35); rotRoll(pe, Math.sin(animT * 0.6) * 0.25);
  drawModel(pe, d.col);
  fullClip();
  textC(150, 'VOITOT ' + wins[myIdx] + ' - ' + wins[1 - myIdx], LGREEN, 1, 440, 200);
  const used = LASERS[s.laser].tier + MISSILES[s.mis].tier;
  const row = (idx, y, it, chosen) => {
    if (chosen) fillRect(SEL_ROWS.x0 - 4, y - 2, SEL_ROWS.x1 - SEL_ROWS.x0 + 6, 11, BLUE);
    if (s.cur === idx && !s.ready && !isTouch) text(SEL_ROWS.x0 - 2, y, '>', blink ? WHITE : YELLOW);
    text(SEL_ROWS.x0 + 10, y, it.nm, chosen ? WHITE : LGREY);
    text(SEL_ROWS.x0 + 86, y, '*'.repeat(it.tier), [0, GREY, LGREEN, YELLOW, LRED][it.tier]);
    text(SEL_ROWS.x0 + 126, y, it.desc, chosen ? LGREY : GREY);
  };
  text(8, SEL_ROWS.laserY - 13, 'LASERIT', d.col);
  LASERS.forEach((L, k) => row(k, SEL_ROWS.laserY + k * 11, L, s.laser === k));
  text(8, SEL_ROWS.misY - 13, 'OHJUKSET', d.col);
  MISSILES.forEach((M, k) => row(6 + k, SEL_ROWS.misY + k * 11, M, s.mis === k));
  text(8, 190, 'TEHOPISTEET ' + used + '/' + BUDGET, used >= BUDGET ? YELLOW : LGREEN);
  text(160, 190, 'VAIN TOINEN ASE VOI OLLA TEHOKAS', GREY);
  const it = s.cur < 6 ? LASERS[s.cur] : MISSILES[s.cur - 6];
  hline(4, W - 5, 202, DGREY);
  if (s.cur < 6) text(8, 208, it.nm + ': VAHINKO/S ' + Math.round(it.dmg / it.cd) + '  KANTAMA ' + it.range + 'M  KUUMENEE ' + Math.round(it.heat / it.cd) + '/S', LGREY);
  else text(8, 208, it.nm + ': VAHINKO ' + it.dmg * (it.swarm || 1) + '  MÄÄRÄ ' + it.cnt + '  SOIHTUSIETO ' + (it.guided ? Math.round(it.resist * 100) + '%' : '-'), LGREY);
  text(8, 222, 'NYÖKKÄYS: ' + (invert ? 'KÄÄNNETTY (YLÖS = NOKKA YLÖS)' : 'LENTOKONE (YLÖS = NOKKA ALAS)'), CYAN);
  text(8, 232, isTouch ? '(NAPAUTA VAIHTAAKSESI)' : '(I = VAIHDA)', DGREY);
  if (s.msgT > 0) textC(246, s.msg, ORANGE);
  const os = selS && selS[1 - myIdx];
  textC(262, 'VASTUSTAJA (' + SHIPDEF[1 - myIdx].name + '): ' + (os && os.ready ? 'VALMIS' : 'VALITSEE...'), os && os.ready ? LGREEN : GREY);
  const b = READY_BTN;
  fillRect(b.x, b.y, b.w, b.h, s.ready ? GREEN : BLACK); rect(b.x, b.y, b.w, b.h, s.ready ? LGREEN : (blink ? YELLOW : ORANGE));
  textC(b.y + 9, s.ready ? 'VALMIS! (PERU)' : 'VALMIS', s.ready ? WHITE : YELLOW, 1, b.x, b.w);
  textC(H - 20, isTouch ? 'NAPAUTA ASETTA VALITAKSESI' : 'YLÖS/ALAS SELAA   VÄLILYÖNTI VALITSE   ENTER VALMIS', GREY);
  textC(H - 10, 'PELI ' + roomCode, DGREY);
  rect(0, 0, W, H, d.frame);
}
function selChoose(cur) {
  const s = localSel; s.cur = cur;
  if (cur < 6) {
    s.laser = cur;
    if (LASERS[s.laser].tier + MISSILES[s.mis].tier > BUDGET) {
      const lim = BUDGET - LASERS[s.laser].tier; let best = 0;
      MISSILES.forEach((M, k) => { if (M.tier <= lim && M.tier >= MISSILES[best].tier) best = k; });
      s.mis = best; s.msg = 'OHJUS VAIHDETTU: ' + MISSILES[best].nm; s.msgT = 2;
    }
  } else {
    s.mis = cur - 6;
    if (LASERS[s.laser].tier + MISSILES[s.mis].tier > BUDGET) {
      const lim = BUDGET - MISSILES[s.mis].tier; let best = 0;
      LASERS.forEach((L, k) => { if (L.tier <= lim && L.tier >= LASERS[best].tier) best = k; });
      s.laser = best; s.msg = 'LASER VAIHDETTU: ' + LASERS[best].nm; s.msgT = 2;
    }
  }
  SFX.beep(); sendSel();
}
function sendSel() { sock.emit('sel', { laser: localSel.laser, mis: localSel.mis, ready: localSel.ready }); }
function toggleReady() { localSel.ready = !localSel.ready; SFX.beep(); sendSel(); }
function toggleInvert() { invert = !invert; try { localStorage.setItem('sd_invert', invert ? '1' : '0'); } catch (e) {} SFX.beep(); }
function drawTunnel() {
  fullClip(); fillRect(0, 0, W, H, BLACK);
  const cols = [BLUE, LBLUE, CYAN, WHITE];
  for (let k = 0; k < 14; k++) {
    const s = Math.pow(((modeT * 0.9 + k / 14) % 1), 2.2), w = s * 340, h = s * 190;
    rect(W/2 - w, H/2 - h, w * 2, h * 2, cols[k % 4]);
  }
  textC(H/2 - 8, winnerId === myIdx ? 'TELAKOINTI' : 'VOITTAJA TELAKOITUU', YELLOW, 2);
  rect(0, 0, W, H, LBLUE);
}
function drawPrize() {
  fullClip(); fillRect(0, 0, W, H, BLACK);
  if (!prize) return;
  setCam([0,0,0], newOri(), 320, 170, 300, 320, 180);
  drawSkyPoints(SKY.stars);
  const tr = { model: MODELS.trophy, pos: [0, -14, 260], ...newOri() };
  rotYaw(tr, animT * 1.1); rotPitch(tr, 0.2);
  setClip(200, 70, 440, 280); drawModel(tr, YELLOW); fullClip();
  for (let k = 0; k < 10; k++) { const a = animT * 0.8 + k * 0.63, r = 110 + Math.sin(animT * 3 + k) * 10; pset(320 + Math.cos(a) * r, 170 + Math.sin(a) * r * 0.6, k % 2 ? YELLOW : WHITE); }
  const d = SHIPDEF[prize.id], mine = prize.id === myIdx;
  textC(10, mine ? 'PALKINTO ON SINUN!' : 'PALKINTOSEREMONIA', YELLOW, 2);
  textC(34, 'VOITTAJA: PELAAJA ' + (prize.id + 1) + ' - ' + d.name, d.col);
  const lines = [['PERUSPALKKIO', prize.base], ['RUNKO EHJÄNÄ', prize.hullB], ['OHJUKSET', prize.misB], ['SOIHDUT', prize.flareB]];
  const shown = Math.min(lines.length, Math.floor(modeT / 0.5));
  lines.slice(0, shown).forEach(([n, v], k) => { text(16, 80 + k * 14, n, LGREY); textR(196, 80 + k * 14, v + ' CR', WHITE); });
  if (modeT > 2.4) { hline(16, 196, 140, LBLUE); text(16, 146, 'YHTEENSÄ', YELLOW); textR(196, 146, prize.total + ' CR', YELLOW); }
  text(460, 80, 'TILANNE', GREY);
  text(460, 96, 'SALAMA', CYAN); textR(624, 96, wins[0] + ' VOITTOA', WHITE); textR(624, 108, totals[0] + ' CR', LGREY);
  text(460, 126, 'KORPPI', YELLOW); textR(624, 126, wins[1] + ' VOITTOA', WHITE); textR(624, 138, totals[1] + ' CR', LGREY);
  if (modeT > 3) textC(H - 22, isTouch ? 'NAPAUTA = UUSI KAKSINTAISTELU' : 'VÄLILYÖNTI / ENTER = UUSI KAKSINTAISTELU', (animT * 3 | 0) % 2 ? WHITE : LGREY);
  rect(0, 0, W, H, YELLOW);
}
const TA = { model: MODELS.salama, pos: [-170, 0, 600], ...newOri() }, TB = { model: MODELS.korppi, pos: [170, 0, 600], ...newOri() };
function drawLobbyBg() {
  fullClip(); fillRect(0, 0, W, H, BLACK);
  setCam([0,0,0], newOri(), 320, 180, 300, 320, 180);
  drawSkyPoints(SKY.stars); drawSkyPoints(SKY.gal);
  Object.assign(TA, newOri()); Object.assign(TB, newOri());
  rotYaw(TA, Math.PI / 2 + Math.sin(animT * 0.7) * 0.5); rotRoll(TA, Math.sin(animT * 0.9) * 0.4); rotPitch(TA, 0.25);
  rotYaw(TB, -Math.PI / 2 + Math.sin(animT * 0.6 + 1) * 0.5); rotRoll(TB, Math.sin(animT * 0.8 + 2) * 0.4); rotPitch(TB, 0.25);
  TA.pos = [-240, 120 + Math.sin(animT) * 20, 600]; TB.pos = [240, 120 + Math.cos(animT) * 20, 600];
  drawModel(TA, CYAN); drawModel(TB, YELLOW);
}
function render() {
  fullClip();
  switch (mode) {
    case 'lobby': drawLobbyBg(); break;
    case 'select': drawSelect(); break;
    case 'docking': drawTunnel(); break;
    case 'prize': drawPrize(); break;
    default:
      if (world && me && latest && latest.P) { drawView(); drawDash(); }
      else { fillRect(0, 0, W, H, BLACK); textC(H/2, 'LADATAAN...', GREY); }
  }
  ctx.putImageData(img, 0, 0);
}
// ===================== SYÖTE =====================
const GAME_KEYS = new Set([].concat(...Object.values(K), ['KeyI', 'Escape', 'Digit9', 'Digit0']));
window.addEventListener('keydown', ev => {
  initAudio();
  if (mode === 'lobby') { if (ev.code === 'Enter' && !$('pJoin').hidden) doJoin($('codeIn').value); return; }
  const c = ev.code;
  if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && (GAME_KEYS.has(c) || /^Key|^Arrow|^Digit|^Numpad/.test(c))) ev.preventDefault();
  keys[c] = true;
  if (ev.repeat) return;
  if (c === 'Digit9') { soundOn = !soundOn; return; }
  if (c === 'Digit0') { const el = document.documentElement; if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); return; }
  if (c === 'Escape') {
    if (escT > 0) { sock.emit('quit'); toLobby(''); } else escT = 2;
    return;
  }
  if (mode === 'select') {
    if (localSel.ready && c !== 'Enter' && c !== 'NumpadEnter') return;
    if (c === 'ArrowUp' || c === 'KeyW') { localSel.cur = (localSel.cur + 11) % 12; SFX.beep(); }
    else if (c === 'ArrowDown' || c === 'KeyS') { localSel.cur = (localSel.cur + 1) % 12; SFX.beep(); }
    else if (c === 'Space') selChoose(localSel.cur);
    else if (c === 'Enter' || c === 'NumpadEnter') toggleReady();
    else if (c === 'KeyI') toggleInvert();
    return;
  }
  if (mode === 'prize' || mode === 'draw') { if ((c === 'Space' || c === 'Enter') && modeT > 1.5) sock.emit('next'); return; }
  if (mode === 'fight' || mode === 'victory') {
    if (K.mis.includes(c)) sock.emit('act', 'mis');
    if (K.flare.includes(c)) sock.emit('act', 'flare');
  }
});
window.addEventListener('keyup', ev => { keys[ev.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; touch.laser = false; touch.stick = false; });
function bufCoords(ev) {
  const r = cv.getBoundingClientRect();
  return [(ev.clientX - r.left) / r.width * W, (ev.clientY - r.top) / r.height * H];
}
cv.addEventListener('pointerdown', ev => {
  initAudio();
  if (isTouch && mode !== 'lobby') goFullscreen();
  const [x, y] = bufCoords(ev);
  if (mode === 'select') {
    const b = READY_BTN;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { toggleReady(); return; }
    if (localSel.ready) return;
    const k = selRowAt(x, y); if (k >= 0) { selChoose(k); return; }
    if (y >= 218 && y <= 240 && x < 440) toggleInvert();
  } else if ((mode === 'prize' || mode === 'draw') && modeT > 1.5) sock.emit('next');
});
// ---------- kosketusohjaimet ----------
function layoutTouch() {
  const r = cv.getBoundingClientRect(); if (!r.width) return;
  const viewB = r.top + r.height * (VH / H) - 8;
  const S = Math.min(r.height * 0.44, 180), B = Math.min(r.height * 0.26, 108), b2 = B * 0.72, yw = Math.min(r.height * 0.13, 52);
  const place = (id, x, y, w, h) => Object.assign($(id).style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  const thrW = Math.min(40, r.width * 0.05), thrH = r.height * 0.5;
  place('thr', r.left + 10, r.top + r.height * 0.12, thrW, thrH);
  const sx = r.left + 10 + thrW + Math.max(14, r.width * 0.03);
  place('stick', sx, viewB - S, S, S);
  place('tYawL', sx, viewB - S - yw - 10, yw, yw);
  place('tYawR', sx + S - yw, viewB - S - yw - 10, yw, yw);
  const lx = r.right - B - Math.max(14, r.width * 0.03);
  place('tLaser', lx, viewB - B, B, B);
  place('tMis', lx - b2 - 14, viewB - b2, b2, b2);
  place('tFlare', lx + (B - b2) / 2, viewB - B - b2 - 14, b2, b2);
}
function updateTouchVisibility() {
  const show = isTouch && (mode === 'countdown' || mode === 'fight' || mode === 'victory') && !!myStats() && !myStats().d;
  const el = $('touch');
  if (el.hidden === show) { el.hidden = !show; if (show) layoutTouch(); }
}
function setupTouch() {
  const stick = $('stick'), knob = $('knob');
  let sid = null;
  const moveStick = ev => {
    const r = stick.getBoundingClientRect(), R = r.width / 2;
    let dx = (ev.clientX - r.left - R) / R, dy = (ev.clientY - r.top - R) / R;
    const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    touch.sx = Math.abs(dx) < 0.08 ? 0 : dx; touch.sy = Math.abs(dy) < 0.08 ? 0 : dy; touch.stick = true;
    knob.style.left = (30 + dx * 30) + '%'; knob.style.top = (30 + dy * 30) + '%';
  };
  const endStick = () => { sid = null; touch.stick = false; touch.sx = touch.sy = 0; knob.style.left = '30%'; knob.style.top = '30%'; };
  stick.addEventListener('pointerdown', ev => { ev.preventDefault(); initAudio(); sid = ev.pointerId; stick.setPointerCapture(sid); moveStick(ev); });
  stick.addEventListener('pointermove', ev => { if (ev.pointerId === sid) moveStick(ev); });
  stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);
  const thr = $('thr'); let tid = null;
  const moveThr = ev => { const r = thr.getBoundingClientRect(); touch.thr = clamp(1 - (ev.clientY - r.top) / r.height, 0, 1); };
  thr.addEventListener('pointerdown', ev => { ev.preventDefault(); tid = ev.pointerId; thr.setPointerCapture(tid); moveThr(ev); });
  thr.addEventListener('pointermove', ev => { if (ev.pointerId === tid) moveThr(ev); });
  thr.addEventListener('pointerup', () => { tid = null; }); thr.addEventListener('pointercancel', () => { tid = null; });
  const hold = (id, key) => {
    const el = $(id);
    const on = ev => { ev.preventDefault(); initAudio(); el.setPointerCapture(ev.pointerId); touch[key] = true; el.classList.add('on'); };
    const off = () => { touch[key] = false; el.classList.remove('on'); };
    el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
  };
  hold('tLaser', 'laser'); hold('tYawL', 'yawL'); hold('tYawR', 'yawR');
  const tap = (id, act) => {
    const el = $(id);
    el.addEventListener('pointerdown', ev => { ev.preventDefault(); initAudio(); el.classList.add('on'); if (mode === 'fight' || mode === 'victory') sock.emit('act', act); });
    const off = () => el.classList.remove('on');
    el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
  };
  tap('tMis', 'mis'); tap('tFlare', 'flare');
}
function updateThrFill() {
  if ($('touch').hidden || !me) return;
  $('thrFill').style.height = Math.round(me.speed / MAXSPD * 100) + '%';
}
// ===================== KÄYNNISTYS =====================
$('bCreate').onclick = doCreate;
$('bJoin').onclick = () => { showPane('pJoin'); setStatus(''); setTimeout(() => $('codeIn').focus(), 50); };
$('bJoinGo').onclick = () => doJoin($('codeIn').value);
$('bBack1').onclick = () => { sock.emit('quit'); showPane('pMenu'); };
$('bBack2').onclick = () => { showPane('pMenu'); setStatus(''); };
if (isTouch) $('helpKeys').style.display = 'none';
setupTouch();
showPane('pMenu');
fitCanvas();
connect();
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000)); lastT = now;
  try { update(dt); render(); updateThrFill(); } catch (err) { console.error(err); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__SD_DEBUG = { get mode() { return mode; }, get me() { return me; }, get latest() { return latest; }, get myIdx() { return myIdx; }, keys, touch, img };
})();
