// Tuotantopalvelin: tarjoilee Viten rakentaman dist-kansion.
// Kaksi käyttötapaa samasta koodista:
//  - Helsinki 3D -katselin (oletus): avoin, peli ei käytössä.
//  - Nordic Combat -peli (REQUIRE_PASSWORD=1): juuriosoite avaa pelin, kaikki sivut, tiedostot ja moninpeliyhteys
//    vaativat salasanan (GAME_PASSWORD, asetetaan Renderin ympäristömuuttujiin – ei koskaan gitiin).
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import http from 'node:http';
import { Server } from 'socket.io';
import { attachFps } from './server/fps-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const GAME = process.env.REQUIRE_PASSWORD === '1';
const PASSWORD = process.env.GAME_PASSWORD || '';
const COOKIE = 'nc_auth', MAX_AGE = 30 * 24 * 3600;           // kirjautuminen muistetaan 30 päivää
// allekirjoitusavain johdetaan salasanasta: salasanan vaihto mitätöi kaikki vanhat kirjautumiset
const KEY = crypto.createHash('sha256').update('nordic-combat:' + PASSWORD).digest();
const sign = v => crypto.createHmac('sha256', KEY).update(v).digest('base64url');
const makeToken = () => { const exp = String(Date.now() + MAX_AGE * 1000); return exp + '.' + sign(exp); };
function validToken(t) {
  if (!t || !PASSWORD) return false;
  const [exp, sig] = t.split('.'); if (!exp || !sig || +exp < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const cookieOf = (req, name) => { for (const part of (req.headers.cookie || '').split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return decodeURIComponent(v.join('=')); } return null; };
const authed = req => !GAME || validToken(cookieOf(req, COOKIE));
const safeNext = n => (typeof n === 'string' && /^\/(?!\/)[^\s\\]*$/.test(n) ? n : '/');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loginPage(next, msg = '') {
  return `<!doctype html><html lang="fi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Nordic Combat</title><meta name="robots" content="noindex"><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:radial-gradient(ellipse at top,#1a2430,#0b0f14 70%);color:#eef2f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
form{width:min(380px,100%);background:rgba(10,14,20,.86);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.b{display:flex;gap:14px;align-items:center;margin-bottom:20px}.m{width:46px;height:46px;border-radius:10px;background:#ffb347;color:#1b1206;display:grid;place-items:center;font-weight:900;font-size:24px}
.t{font-weight:900;font-size:24px;letter-spacing:.08em}.t span{color:#ffb347;font-weight:300}label{display:block;font-size:12px;color:#9aa6b2;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px}
input{width:100%;font:inherit;font-size:16px;color:#eef2f5;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:12px;outline:none}input:focus{border-color:#ffb347}
button{width:100%;margin-top:14px;font:inherit;font-weight:700;letter-spacing:.04em;cursor:pointer;border:0;border-radius:8px;padding:12px;background:#ffb347;color:#1b1206}
.e{color:#ff7a6b;font-size:13px;min-height:1.2em;margin-top:10px}</style></head><body>
<form method="post" action="/login"><div class="b"><div class="m">N</div><div class="t">NORDIC <span>COMBAT</span></div></div>
<label for="p">Salasana</label><input id="p" name="password" type="password" autocomplete="current-password" autofocus required>
<input type="hidden" name="next" value="${esc(next)}"><button>Kirjaudu</button><div class="e">${esc(msg)}</div></form></body></html>`;
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);                                   // Renderin välityspalvelin: oikea IP ja https
app.use(compression({ filter: (req, res) => !/\.(glb|jpg|png)$/.test(req.path) && compression.filter(req, res) }));
app.get('/health', (req, res) => res.send('ok'));

if (GAME) {
  // kirjautuminen; virheellisiä yrityksiä rajoitetaan IP-osoitteittain (10 / 10 min)
  const fails = new Map();
  app.get('/login', (req, res) => { res.set('Cache-Control', 'no-store'); res.send(PASSWORD ? loginPage(safeNext(req.query.next)) : 'Salasanaa ei ole vielä asetettu (GAME_PASSWORD).'); });
  app.post('/login', express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
    const ip = req.ip, now = Date.now(), f = fails.get(ip) || { n: 0, t: now };
    if (now - f.t > 600000) { f.n = 0; f.t = now; }
    const next = safeNext(req.body?.next);
    if (f.n >= 10) return res.status(429).send(loginPage(next, 'Liian monta yritystä – odota hetki.'));
    const given = crypto.createHash('sha256').update(String(req.body?.password || '')).digest();
    const want = crypto.createHash('sha256').update(PASSWORD).digest();
    if (!PASSWORD || !crypto.timingSafeEqual(given, want)) { f.n++; fails.set(ip, f); return res.status(401).send(loginPage(next, 'Väärä salasana.')); }
    fails.delete(ip);
    res.cookie(COOKIE, makeToken(), { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: MAX_AGE * 1000, path: '/' });
    res.redirect(303, next);
  });
  // kaikki muu vaatii kirjautumisen
  app.use((req, res, next) => {
    if (authed(req)) return next();
    if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) return res.redirect(302, '/login?next=' + encodeURIComponent(req.originalUrl));
    res.status(401).send('Kirjaudu sisään');
  });
  // pelipalvelussa vain peli: juuri avaa pelin, katselinsivut ohjataan peliin
  app.get(['/', '/index.html', '/viewer-v01.html'], (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(DIST, 'fps.html')); });
} else {
  // katselinpalvelussa peli ei ole käytössä
  app.get('/fps.html', (req, res) => res.status(404).send('Not found'));
}
app.use('/assets', express.static(path.join(DIST, 'assets'), { maxAge: GAME ? '7d' : '30d', immutable: !GAME }));
app.use('/world', express.static(path.join(DIST, 'world'), { maxAge: '1d' }));
app.use(express.static(DIST, { maxAge: 0 }));

const server = http.createServer(app);
if (GAME) {
  // moninpeliyhteys hyväksytään vain kirjautuneelta selaimelta (sama eväste)
  const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000, allowRequest: (req, cb) => cb(null, authed(req)) });
  attachFps(io);
}
const PORT = process.env.PORT || 3010;
server.listen(PORT, () => console.log(`${GAME ? 'Nordic Combat' : 'Helsinki 3D'} portissa ${PORT}${GAME && !PASSWORD ? ' – GAME_PASSWORD puuttuu!' : ''}`));
