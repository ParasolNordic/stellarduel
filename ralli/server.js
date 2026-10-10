// Vektoriralli - HTTP- ja Socket.IO-palvelin. Huoneet nelikirjaimisilla koodeilla, 2-3 pelaajaa.
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { createGame } = require('./game');

const app = express();
require('../norobots.js')(app);                  // hakukoneet ja crawlerit estetty
app.get('/health', (req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });
const rooms = new Map();
const LETTERS = 'ABCDEFGHJKLMNPRSTUVXYZ';
const MAXP = 3;

function newCode() {
  for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)]; if (!rooms.has(c)) return c; }
}
function roster(room) {
  room.socks.forEach((s, i) => { if (s) s.emit('roster', { code: room.code, slots: room.socks.map(x => !!x), you: i, host: room.host, started: !!room.game }); });
}
function closeRoom(room, reason) {
  if (room.timer) clearInterval(room.timer);
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
  if (room.game) {
    room.game.remove(idx);
    if (room.game.activeCount() < 2) closeRoom(room, 'MUUT PELAAJAT POISTUIVAT');
    else io.to(room.code).emit('note', { t: 'PELAAJA POISTUI' });
  } else {
    if (left === 0) { closeRoom(room, ''); return; }
    if (room.host === idx) room.host = room.socks.findIndex(Boolean);
    roster(room);
  }
}
function startGame(room) {
  const slots = room.socks.map((s, i) => s ? i : -1).filter(i => i >= 0);
  room.game = createGame(slots, {
    all: (e, d) => io.to(room.code).emit(e, d),
    to: (i, e, d) => { const s = room.socks[i]; if (s) s.emit(e, d); },
  });
  room.socks.forEach((s, i) => { if (s) s.emit('ready', { idx: i, code: room.code, slots }); });
  room.game.begin();
  let last = Date.now();
  room.timer = setInterval(() => {
    const now = Date.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    try { room.game.tick(dt); } catch (err) { console.error('tick', err); }
  }, 1000 / 60);
}

io.on('connection', sock => {
  sock.data.room = null;
  sock.on('create', async (d, cb) => {
    if (typeof cb !== 'function') return;
    leave(sock);
    const code = newCode();
    const room = { code, socks: [sock, null, null], host: 0, game: null, timer: null };
    rooms.set(code, room); sock.data.room = code; sock.join(code);
    const origin = (d && typeof d.origin === 'string' && /^https?:\/\/[^\s]+$/.test(d.origin)) ? d.origin : '';
    const url = origin + '/?k=' + code;
    let qr = '';
    try { qr = await QRCode.toDataURL(url, { margin: 1, width: 260, color: { dark: '#000000', light: '#ffffffff' } }); } catch (e) {}
    cb({ code, qr, url });
    roster(room);
  });
  sock.on('join', (d, cb) => {
    if (typeof cb !== 'function') return;
    const code = String((d && d.code) || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb({ err: 'PELIÄ EI LÖYTYNYT' });
    if (room.socks.includes(sock)) return cb({ err: 'OLET JO TÄSSÄ PELISSÄ' });
    if (room.game) return cb({ err: 'PELI ON JO ALKANUT' });
    const idx = room.socks.indexOf(null);
    if (idx < 0) return cb({ err: 'PELI ON TÄYNNÄ (3 PELAAJAA)' });
    leave(sock);
    room.socks[idx] = sock; sock.data.room = code; sock.join(code);
    cb({ ok: true });
    roster(room);
    if (room.socks.filter(Boolean).length === MAXP) startGame(room);
  });
  sock.on('begin', () => {
    const room = rooms.get(sock.data.room);
    if (room && !room.game && room.socks[room.host] === sock && room.socks.filter(Boolean).length >= 2) startGame(room);
  });
  const withGame = fn => (...a) => { const r = rooms.get(sock.data.room); if (r && r.game) fn(r, r.socks.indexOf(sock), ...a); };
  sock.on('st', withGame((r, i, d) => r.game.input(i, d)));
  sock.on('act', withGame((r, i, a) => r.game.action(i, a)));
  sock.on('crash', withGame((r, i, d) => r.game.crash(i, d)));
  sock.on('sel', withGame((r, i, d) => r.game.select(i, d)));
  sock.on('png', (t, cb) => { if (typeof cb === 'function') cb(t); });
  sock.on('quit', () => leave(sock));
  sock.on('disconnect', () => leave(sock));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('Vektoriralli kuuntelee porttia ' + PORT));
