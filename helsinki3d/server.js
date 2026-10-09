// Helsinki 3D – tuotantopalvelin: tarjoilee Viten rakentaman dist-kansion.
// GLB-mallit ja JS-tiedostot välimuistitetaan (tiedostonimissä on sisältötiiviste tai ne vaihtuvat harvoin).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const DIST = path.join(__dirname, 'dist');
app.disable('x-powered-by');
app.use(compression({ filter: (req, res) => !/\.(glb|jpg|png)$/.test(req.path) && compression.filter(req, res) }));
app.get('/health', (req, res) => res.send('ok'));
app.use('/assets', express.static(path.join(DIST, 'assets'), { maxAge: '30d', immutable: true }));
app.use('/world', express.static(path.join(DIST, 'world'), { maxAge: '1d' }));
app.use(express.static(DIST, { maxAge: 0 }));
const PORT = process.env.PORT || 3010;
app.listen(PORT, () => console.log('Helsinki 3D portissa ' + PORT));
