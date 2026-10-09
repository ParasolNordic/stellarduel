// Ilmatorjunnan ammuntaharjoitus - HTTP- ja Socket.IO-palvelin.
// Yksinpeli toimii kokonaan selaimessa. Kaksinpelissä palvelin yhdistää ilmatorjunnan ja lennokkilaivueen pelaajat,
// välittää tilat ja ratkaisee lennokkien kestävyyden, ohitukset ja voittajan.
// Hakukoneet ja muut indeksoijat estetään: robots.txt, X-Robots-Tag-otsake ja meta robots -tagi.
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const compression = require('compression');
const IT = require('./public/ityhteinen.js');

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use((req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai'); next(); });
const BOTS = ['*', 'Googlebot', 'Bingbot', 'Slurp', 'DuckDuckBot', 'Baiduspider', 'YandexBot', 'Applebot', 'GPTBot', 'ChatGPT-User', 'OAI-SearchBot',
  'CCBot', 'ClaudeBot', 'Claude-Web', 'anthropic-ai', 'Google-Extended', 'PerplexityBot', 'Bytespider', 'Amazonbot', 'FacebookBot', 'meta-externalagent', 'cohere-ai', 'Diffbot', 'Omgilibot'];
const ROBOTS = BOTS.map(b => 'User-agent: ' + b + '\nDisallow: /\n').join('\n');
app.get('/robots.txt', (req, res) => res.type('text/plain').send(ROBOTS));
app.get('/health', (req, res) => res.send('ok'));
const SHARED = ['kaupunki.js', 'kaupunki-mesh.js', 'gl3d.js', 'sw3d.js', 'shared.js', 'ajoneuvot.js', 'lisenssit.js', 'kosketus.js'];
for (const f of SHARED) app.get('/yhteiset/' + f, (req, res) => res.sendFile(path.join(__dirname, '..', 'helsinkiralli', 'public', f), { maxAge: '1h' }));
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

const rooms = new Map();
const LETTERS = 'ABCDEFGHJKLMNPRSTUVXYZ';
function newCode() { for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)]; if (!rooms.has(c)) return c; } }
function roster(room) {
  room.socks.forEach((s, i) => { if (s) s.emit('roster', { code: room.code, slots: room.socks.map(Boolean), you: i, host: 0, hostRole: room.hostRole, playing: !!room.game }); });
}
function stopGame(room) { if (room.timer) clearInterval(room.timer); room.timer = null; room.game = null; }
function closeRoom(room, reason) {
  stopGame(room);
  for (const s of room.socks) if (s) { s.leave(room.code); s.data.room = null; s.emit('left', { reason }); }
  rooms.delete(room.code);
}
function leave(sock) {
  const room = rooms.get(sock.data.room); if (!room) return;
  const idx = room.socks.indexOf(sock);
  if (idx === 0) { sock.leave(room.code); sock.data.room = null; room.socks[0] = null; closeRoom(room, 'PELIN LUOJA POISTUI'); return; }
  if (idx > 0) room.socks[idx] = null;
  sock.leave(room.code); sock.data.room = null;
  if (room.game) { stopGame(room); io.to(room.code).emit('left', { reason: 'VASTUSTAJA POISTUI' }); }
  roster(room);
}
const roleOf = (room, i) => (i === 0) === (room.hostRole === 'aa') ? 'aa' : 'pilot';
function startGame(room) {
  stopGame(room);
  const nD = IT.FORM.length - 1;                         // johtaja + 6 siipimiestä
  const g = { t: 0, phase: 'place', hp: Array(nD).fill(IT.DRONE.hp), passes: 0, over: false, overT: 0, seed: (Math.random() * 1e9) | 0 };
  room.game = g;
  const all = (e, d) => io.to(room.code).emit(e, d);
  const sockOf = role => room.socks.find((s, i) => s && roleOf(room, i) === role);
  g.end = (winner, why) => { if (g.over) return; g.over = true; g.overT = 0; all('over', { winner, why, passes: g.passes, down: g.hp.filter(h => h <= 0).length, total: g.hp.length }); };
  g.onSites = d => { if (g.phase !== 'place' || !d || !Array.isArray(d.sites) || d.sites.length !== 3) return; g.phase = 'fight'; g.t = 0; all('go', { sites: d.sites }); };
  g.onFs = d => { const s = sockOf('aa'); if (s && d) s.volatile.emit('fs', d); };
  g.onShots = d => { const s = sockOf('pilot'); if (s && d) s.volatile.emit('shots', d); };
  g.onAim = d => { const s = sockOf('pilot'); if (s && d) s.volatile.emit('aim', d); };
  g.onHit = d => {
    if (g.phase !== 'fight' || g.over || !d || !Number.isInteger(d.id) || d.id < 0 || d.id >= g.hp.length || g.hp[d.id] <= 0) return;
    const dmg = Math.max(0, Math.min(80, +d.dmg || 0));
    g.hp[d.id] -= dmg;
    if (g.hp[d.id] <= 0) { all('down', { id: d.id, by: d.by }); if (d.id === 0) g.end('aa', 'JOHTOLENNOKKI AMMUTTIIN ALAS'); }
    else all('dhit', { id: d.id, hp: g.hp[d.id] });
  };
  g.onPass = d => { if (g.phase !== 'fight' || g.over || !d) return; g.passes = Math.max(g.passes, Math.min(IT.PASSES, d.n | 0)); all('pass', { n: g.passes }); if (g.passes >= IT.PASSES) g.end('pilot', 'LAIVUE TEKI ' + IT.PASSES + ' YLILENTOA'); };
  g.onCrash = () => { if (g.phase === 'fight' && !g.over) { all('down', { id: 0, by: -1 }); g.end('aa', 'JOHTOLENNOKKI SYÖKSYI MAAHAN'); } };
  room.socks.forEach((s, i) => { if (s) s.emit('start', { role: roleOf(room, i), seed: g.seed, n: nD }); });
  roster(room);
  let last = Date.now();
  room.timer = setInterval(() => {
    const now = Date.now(), dt = Math.min(0.2, (now - last) / 1000); last = now;
    if (!room.game) return;
    if (g.phase === 'place') { g.t += dt; if (g.t > 120) { all('note', { t: 'SIJOITTELUAIKA PÄÄTTYI' }); } }
    if (g.phase === 'fight' && !g.over) { g.t += dt; if (g.t > 480) g.end('aa', 'LAIVUEEN AIKA LOPPUI'); }
    if (g.over) { g.overT += dt; if (g.overT > 14) { stopGame(room); roster(room); all('lobby', {}); } }
  }, 200);
}

io.on('connection', sock => {
  sock.data.room = null;
  sock.on('create', async (d, cb) => {
    if (typeof cb !== 'function') return;
    leave(sock);
    const code = newCode();
    const room = { code, socks: [sock, null], hostRole: 'aa', game: null, timer: null };
    rooms.set(code, room); sock.data.room = code; sock.join(code);
    const origin = (d && typeof d.origin === 'string' && /^https?:\/\/[^\s]+$/.test(d.origin)) ? d.origin : '';
    const url = origin + '/?k=' + code;
    let qr = ''; try { qr = await QRCode.toDataURL(url, { margin: 1, width: 260 }); } catch (e) { /* ilman QR-koodia */ }
    cb({ code, qr, url }); roster(room);
  });
  sock.on('join', (d, cb) => {
    if (typeof cb !== 'function') return;
    const code = String((d && d.code) || '').toUpperCase().trim(), room = rooms.get(code);
    if (!room) return cb({ err: 'PELIÄ EI LÖYTYNYT' });
    if (room.socks.includes(sock)) return cb({ err: 'OLET JO TÄSSÄ PELISSÄ' });
    if (room.game) return cb({ err: 'PELI ON KÄYNNISSÄ' });
    if (room.socks[1]) return cb({ err: 'PELI ON TÄYNNÄ (2 PELAAJAA)' });
    leave(sock);
    room.socks[1] = sock; sock.data.room = code; sock.join(code);
    cb({ ok: true }); roster(room);
  });
  sock.on('role', r => { const room = rooms.get(sock.data.room); if (room && !room.game && room.socks[0] === sock && (r === 'aa' || r === 'pilot')) { room.hostRole = r; roster(room); } });
  sock.on('begin', () => { const room = rooms.get(sock.data.room); if (room && !room.game && room.socks[0] === sock && room.socks[1]) startGame(room); });
  const g = fn => d => { const r = rooms.get(sock.data.room); if (r && r.game) fn(r.game, d); };
  sock.on('sites', g((G, d) => G.onSites(d)));
  sock.on('fs', g((G, d) => G.onFs(d)));
  sock.on('shots', g((G, d) => G.onShots(d)));
  sock.on('aim', g((G, d) => G.onAim(d)));
  sock.on('hit', g((G, d) => G.onHit(d)));
  sock.on('pass', g((G, d) => G.onPass(d)));
  sock.on('crash', g(G => G.onCrash()));
  sock.on('png', (t, cb) => { if (typeof cb === 'function') cb(t); });
  sock.on('quit', () => leave(sock));
  sock.on('disconnect', () => leave(sock));
});

const PORT = process.env.PORT || 3005;
server.listen(PORT, () => console.log('IT-harjoitus portissa ' + PORT));
