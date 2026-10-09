// Ilmatorjunnan ammuntaharjoitus - palvelimen ja selaimen yhteinen koodi: patteripaikat, aseet, maalilennokit.
(function (root) {
'use strict';
const RD = (typeof module === 'object' && module.exports) ? require('../../helsinkiralli/public/shared.js') : root.RD;
const { H, solid, bldH, KD, BX0, BZ0, BX1, BZ1 } = RD;
function surf(x, z) { const g = H(x, z); if (solid(x, z)) { const b = bldH(x, z); return b > g ? b : g; } return g; }
// patteripaikat: tasakatot (entiset helikopterikentät), vähintään 10 x 10 m, 40 m välein
const SITES = (() => {
  const h = KD.hgt, out = [];
  for (let iz = 3; iz < h.nz - 3; iz++) for (let ix = 3; ix < h.nx - 3; ix++) {
    const x = h.x0 + (ix + 0.5) * h.res, z = h.z0 + (iz + 0.5) * h.res, c = bldH(x, z);
    if (c <= 0 || c < H(x, z) + 7) continue;
    if (x < BX0 + 50 || x > BX1 - 50 || z < BZ0 + 50 || z > BZ1 - 50) continue;
    let ok = true;
    for (let dz = -2; dz <= 2 && ok; dz++) for (let dx = -2; dx <= 2 && ok; dx++) { const xx = x + dx * 2, zz = z + dz * 2; if (Math.abs(bldH(xx, zz) - c) > 0.4 || !solid(xx, zz)) ok = false; }
    if (ok) out.push([x, c, z]);
  }
  const thin = [];
  for (let i = 0; i < out.length; i++) { const p = out[(i * 7919) % out.length]; if (thin.every(q => Math.hypot(q[0] - p[0], q[2] - p[2]) > 40)) thin.push(p); }
  return thin;
})();
const CENTER = [(BX0 + BX1) / 2, 0, (BZ0 + BZ1) / 2];
// aseet (pelin mitoitus): tulinopeus laukausta/s, lähtönopeus m/s, lipas ja lataus, vahinko, kääntönopeus °/s
const WEAPONS = [
  { id: 'itkk96', nm: '12,7 ITKK 96', desc: 'RASKAS KONEKIVÄÄRI · NOPEA KÄÄNTÖ, PIENI TEHO', rate: 11, v: 850, barrels: 1, mag: 150, reload: 4.5, ammo: 1050, dmg: 12, prox: 0, spread: 0.0030, slew: 150, life: 2.6, tracerEvery: 3, col: [255, 196, 96] },
  { id: 'itk61', nm: '23 ITK 61', desc: 'KAKSIPUTKINEN · SUURI TULINOPEUS', rate: 28, v: 970, barrels: 2, mag: 100, reload: 6.0, ammo: 900, dmg: 26, prox: 0, spread: 0.0035, slew: 75, life: 3.0, tracerEvery: 2, col: [255, 120, 70] },
  { id: 'itk88', nm: '35 ITK 88', desc: 'KAKSIPUTKINEN OERLIKON · KANTAVA, LÄHESTYMISSYTYTIN', rate: 18, v: 1175, barrels: 2, mag: 112, reload: 7.0, ammo: 560, dmg: 48, prox: 6, spread: 0.0018, slew: 100, life: 3.4, tracerEvery: 2, col: [140, 230, 255] },
];
const DRONE = { hp: 100, hitR: 3.2, speed: 72, span: 6.2 };
// muodostelma: paikat johtajan koordinaatistossa (oikea, ylös, eteen)
const FORM = [[0, 0, 0], [-16, 2, -16], [16, -2, -16], [-32, 4, -32], [32, -4, -32], [0, 6, -34], [-48, 6, -48], [48, -6, -48]];
const PASSES = 3;
const IT = { RD, surf, SITES, CENTER, WEAPONS, DRONE, FORM, PASSES };
if (typeof module === 'object' && module.exports) module.exports = IT; else root.IT = IT;
})(typeof window !== 'undefined' ? window : this);
