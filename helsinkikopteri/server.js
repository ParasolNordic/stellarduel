// Helsinkikopteri - staattinen palvelin. Yksinpeli: kaikki pelilogiikka on selaimessa.
// Kaupunkiympäristö (LoD2-malli, maasto, WebGL- ja varapiirto) jaetaan Helsinkirallin kanssa: /yhteiset/ = helsinkiralli/public.
'use strict';
const path = require('path');
const express = require('express');
const compression = require('compression');

const app = express();
app.use(compression());
app.get('/health', (req, res) => res.send('ok'));
const SHARED = ['kaupunki.js', 'kaupunki-mesh.js', 'gl3d.js', 'sw3d.js', 'shared.js', 'ajoneuvot.js', 'lisenssit.js', 'kosketus.js'];
for (const f of SHARED) app.get('/yhteiset/' + f, (req, res) => res.sendFile(path.join(__dirname, '..', 'helsinkiralli', 'public', f), { maxAge: '1h' }));
app.use(express.static(path.join(__dirname, 'public')));
const PORT = process.env.PORT || 3003;
app.listen(PORT, () => console.log('Helsinkikopteri portissa ' + PORT));
