// Stellar Duel Online - HTTP- ja Socket.IO-palvelin. Pelihuoneet nelikirjaimisilla koodeilla.
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { createGame } = require('./game');

const app = express();
// Alkuperäinen jaetun ruudun versio pysyy saatavilla sellaisenaan
app.get('/jaettu', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
app.get('/health', (req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });
const rooms = new Map();
const LETTERS = 'ABCDEFGHJKLMNPRSTUVXYZ';

function newCode() {
  for (;;) {
    let c = ''; for (let i = 0; i < 4; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    if (!rooms.has(c)) return c;
  }
}
function closeRoom(room, reason) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
  for (const s of room.socks) if (s) { s.leave(room.code); s.data.room = null; s.emit('left', { reason }); }
  rooms.delete(room.code);
}
function startRoom(room) {
  room.game = createGame({
    all: (e, d) => io.to(room.code).emit(e, d),
    to: (i, e, d) => { const s = room.socks[i]; if (s) s.emit(e, d); },
  });
  room.socks.forEach((s, i) => s.emit('ready', { idx: i, code: room.code }));
  room.game.begin();
  let last = Date.now();
  room.timer = setInterval(() => {
    const now = Date.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    try { room.game.tick(dt); } catch (err) { console.error('tick', err); }
  }, 1000 / 60);
}
function leave(sock) {
  const room = rooms.get(sock.data.room);
  if (!room) return;
  const idx = room.socks.indexOf(sock);
  if (idx >= 0) room.socks[idx] = null;
  closeRoom(room, 'VASTUSTAJA POISTUI PELISTÄ');
}

io.on('connection', sock => {
  sock.data.room = null;
  sock.on('create', async (d, cb) => {
    if (typeof cb !== 'function') return;
    leave(sock);
    const code = newCode();
    const room = { code, socks: [sock, null], game: null, timer: null };
    rooms.set(code, room);
    sock.data.room = code; sock.join(code);
    const origin = (d && typeof d.origin === 'string' && /^https?:\/\/[^\s]+$/.test(d.origin)) ? d.origin : '';
    const url = origin + '/?k=' + code;
    let qr = '';
    try { qr = await QRCode.toDataURL(url, { margin: 1, width: 260, color: { dark: '#000000', light: '#b8c76fff' } }); } catch (e) {}
    cb({ code, qr, url });
  });
  sock.on('join', (d, cb) => {
    if (typeof cb !== 'function') return;
    const code = String((d && d.code) || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb({ err: 'PELIÄ EI LÖYTYNYT' });
    if (room.socks[0] === sock) return cb({ err: 'ET VOI LIITTYÄ OMAAN PELIISI' });
    if (room.socks[1]) return cb({ err: 'PELI ON JO TÄYNNÄ' });
    leave(sock);
    room.socks[1] = sock; sock.data.room = code; sock.join(code);
    cb({ ok: true });
    startRoom(room);
  });
  const withGame = fn => (...a) => { const r = rooms.get(sock.data.room); if (r && r.game) fn(r, r.socks.indexOf(sock), ...a); };
  sock.on('st', withGame((r, i, d) => r.game.input(i, d)));
  sock.on('act', withGame((r, i, a) => r.game.action(i, a)));
  sock.on('sel', withGame((r, i, d) => r.game.select(i, d)));
  sock.on('next', withGame(r => r.game.next()));
  sock.on('png', (t, cb) => { if (typeof cb === 'function') cb(t); });
  sock.on('quit', () => leave(sock));
  sock.on('disconnect', () => leave(sock));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Stellar Duel Online kuuntelee porttia ' + PORT));
