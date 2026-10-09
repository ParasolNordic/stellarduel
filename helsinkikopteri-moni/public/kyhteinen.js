// Helsinkihelikopterit - palvelimen ja selaimen yhteinen koodi: kotikenttä, aloituspaikat, reitti, ase.
(function (root) {
'use strict';
const RD = (typeof module === 'object' && module.exports) ? require('../../helsinkiralli/public/shared.js') : root.RD;
const { H, solid, bldH, KD, BX0, BZ0, BX1, BZ1, clamp } = RD;
const W0 = RD.buildWorld();
function surf(x, z) { const g = H(x, z); if (solid(x, z)) { const b = bldH(x, z); return b > g ? b : g; } return g; }
function rngSeed(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// kotikenttä: avoin alue lähellä keskustaa (vapaata vähintään 24 m joka suuntaan)
const HOME = (() => {
  let best = null;
  for (let z = BZ0 + 70; z < BZ1 - 70; z += 8) for (let x = BX0 + 70; x < BX1 - 70; x += 8) {
    if (solid(x, z)) continue;
    let r = 2; outer: for (; r < 30; r += 2) for (let a = 0; a < 20; a++) { const t = a / 20 * Math.PI * 2; if (solid(x + Math.cos(t) * r, z + Math.sin(t) * r)) break outer; }
    if (r < 22) continue;
    const sc = Math.hypot(x, z) - r * 4;
    if (!best || sc < best.sc) best = { x, z, sc };
  }
  if (!best) { const s = KD.spawns[0]; best = { x: s[0], z: s[1] }; }
  return [best.x, H(best.x, best.z), best.z];
})();
// avoimin suunta kotikentältä
const OPEN_YAW = (() => {
  let best = 0, bl = -1;
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, L = W0.rayBlock([HOME[0], HOME[1] + 6, HOME[2]], [Math.sin(a), 0, Math.cos(a)], 400); if (L > bl) { bl = L; best = a; } }
  return best;
})();
// kolme laskeutumispaikkaa rivissä avoimeen suuntaan nähden poikittain, 13 m välein
const PADS = [-1, 0, 1].map(k => { const x = HOME[0] + Math.cos(OPEN_YAW) * 13 * k, z = HOME[2] - Math.sin(OPEN_YAW) * 13 * k; return [x, H(x, z), z]; });
function maxRoofAround(x, z, r) { let m = H(x, z); for (let dz = -r; dz <= r; dz += 4) for (let dx = -r; dx <= r; dx += 4) m = Math.max(m, surf(x + dx, z + dz)); return m; }
// matala portti vain, jos kadulla on tilaa roottorille (vapaata 9 m säteellä portin korkeudella)
function streetClear(x, z, y) { for (let r = 3; r <= 9; r += 3) for (let a = 0; a < 16; a++) { const t = a / 16 * Math.PI * 2, xx = x + Math.cos(t) * r, zz = z + Math.sin(t) * r; if (solid(xx, zz) && bldH(xx, zz) > y - 7) return false; } return true; }
// reittikilpailun portit siemenluvusta (sama palvelimella ja selaimissa)
function makeRoute(seed, n) {
  const rand = rngSeed(seed), rings = [], SP = KD.spawns;
  let prev = [HOME[0], HOME[1] + 15, HOME[2]];
  for (let i = 0; i < n; i++) {
    let pick = null;
    for (let tries = 0; tries < 300 && !pick; tries++) {
      const s = SP[(rand() * SP.length) | 0], d = Math.hypot(s[0] - prev[0], s[1] - prev[2]);
      if (d < 110 || d > 260) continue;
      if (rings.some(r => Math.hypot(r.c[0] - s[0], r.c[2] - s[1]) < 90)) continue;
      pick = s;
    }
    if (!pick) { const a = rand() * 6.28; pick = [clamp(prev[0] + Math.cos(a) * 160, BX0 + 90, BX1 - 90), clamp(prev[2] + Math.sin(a) * 160, BZ0 + 90, BZ1 - 90)]; }
    const x = pick[0], z = pick[1], low = i % 2 === 0 && !solid(x, z) && streetClear(x, z, H(x, z) + 11);
    const y = low ? H(x, z) + 11 : maxRoofAround(x, z, 16) + 16;
    const dl = Math.hypot(x - prev[0], z - prev[2]) || 1;
    rings.push({ c: [x, y, z], n: [(x - prev[0]) / dl, 0, (z - prev[2]) / dl], r: low ? 10 : 12, low });
    prev = [x, y, z];
  }
  return rings;
}
// taisteluase: vain yksi, osuu vain läheltä
const GUN = { range: 150, hitR: 3.2, dmg: 4, interval: 0.11, heatPer: 0.06, cool: 0.25, overheat: 1.0 };
const HP = 100, KILLS_TO_WIN = 5, FIGHT_TIME = 360, RACE_RINGS = 10;
const PCOL = ['#4fd6ff', '#ffa040', '#ff5ad1'], PNAME = ['SININEN', 'ORANSSI', 'VIOLETTI'];
const KY = { RD, surf, rngSeed, HOME, OPEN_YAW, PADS, makeRoute, maxRoofAround, GUN, HP, KILLS_TO_WIN, FIGHT_TIME, RACE_RINGS, PCOL, PNAME, W0 };
if (typeof module === 'object' && module.exports) module.exports = KY; else root.KY = KY;
})(typeof window !== 'undefined' ? window : this);
