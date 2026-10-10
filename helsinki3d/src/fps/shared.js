// Palvelimen ja selaimen yhteiset pelitiedot (puhdasta dataa, ei riippuvuuksia).

// Paitavärit: kaikki yhtä kirkkaita (näkyvät varjossakin), jottei kukaan ole muita huonommin erottuva.
// Sama väri = sama tiimi.
export const COLORS = [
  { id: 'orange', hex: '#ff8a2a', name: 'ORANSSI' },
  { id: 'yellow', hex: '#ffd61f', name: 'KELTAINEN' },
  { id: 'lime', hex: '#8cff3a', name: 'LIMETTI' },
  { id: 'cyan', hex: '#2ef2ff', name: 'TURKOOSI' },
  { id: 'pink', hex: '#ff4fd8', name: 'PINKKI' },
  { id: 'red', hex: '#ff3b3b', name: 'PUNAINEN' },
  { id: 'white', hex: '#f5f5f0', name: 'VALKOINEN' },
  { id: 'violet', hex: '#c58cff', name: 'VIOLETTI' },
];
export const COLOR_HEX = new Set(COLORS.map(c => c.hex));
export const colorName = hex => (COLORS.find(c => c.hex === hex) || { name: 'TIIMI' }).name;
export const MAX_PLAYERS = 6;
export const KILL_LIMIT = 25;           // tiimin (värin) yhteiset kaadot

// Karttakohtaiset paikat (pelin x, z metreinä). Tarkastuspaikat ovat aina samoissa paikoissa.
// Laatikoiden mahdolliset paikat ovat isompien katujen varsilla (laskettu ilmakuvasta ja rakennusten etäisyydestä);
// palvelin arpoo jokaiseen otteluun ja jokaisen poimitun laatikon tilalle uuden paikan näistä.
export const MAPS = {
  1: {
    checkpoints: [[-13.6, 8]],
    crates: 4,
    crateSpots: [[-127.6, -100], [-4.6, 17], [28.4, -115], [79.4, 65], [-91.6, -16], [94.4, -97], [-13.6, -85], [-43.6, -22],
      [-79.6, -58], [-37.6, 23], [16.4, 35], [16.4, -91], [-64.6, -37], [-31.6, -7]],
  },
  2: {
    checkpoints: [[-263.7, -391.8], [-39.4, 416.9], [243.3, -133.8]],   // keskimmäinen laiturilla
    crates: 8,
    vehicles: [{ type: 'apc', p: [13.9, 316.7], h: 1.57 }, { type: 'heli', p: [-110, 96], h: 0 }],
    crateSpots: [[-209.7, -385.8], [-29.7, 421.2], [249.3, -64.8], [-263.7, 61.2], [156.3, -418.8], [231.3, 247.2], [-44.7, -139.8],
      [-14.7, 151.2], [-263.7, 316.2], [-260.7, -172.8], [129.3, -226.8], [-26.7, -334.8], [144.3, 76.2], [75.3, 283.2], [-107.7, 280.2],
      [-149.7, -34.8], [0.3, 1.2], [-143.7, -253.8], [-155.7, 148.2], [234.3, -307.8], [120.3, -52.8], [240.3, -184.8], [258.3, 58.2],
      [-263.7, -52.8], [-254.7, -283.8], [48.3, -412.8], [-263.7, 166.2], [150.3, 181.2], [-107.7, -400.8], [-89.7, 46.2], [30.3, -208.8],
      [123.3, -325.8]],
  },
  3: {
    checkpoints: [[-302.2, -5.7], [279.8, 282.3], [177.8, -239.7]],
    crates: 8,
    vehicles: [{ type: 'apc', p: [56, 18], h: 0.82 }, { type: 'heli', p: [-41.2, -146.7], h: 0.8 }],   // kopteri pallokentällä
    crateSpots: [[-251.2, -50.7], [279.8, 282.3], [219.8, -203.7], [-35.2, 195.3], [3.8, -80.7], [213.8, 45.3], [24.8, -284.7],
      [111.8, 279.3], [-197.2, 105.3], [66.8, 81.3], [-131.2, -125.7], [144.8, -83.7], [-98.2, 9.3], [183.8, 171.3],
      [87.8, -182.7], [270.8, -104.7], [72.8, 183.3], [-104.2, 129.3], [81.8, -11.7], [-257.2, 39.3], [-26.2, 282.3],
      [-20.2, 90.3], [195.8, 258.3], [3.8, -200.7], [216.8, -38.7], [-173.2, -38.7], [243.8, 120.3], [153.8, 99.3],
      [150.8, -233.7], [276.8, 207.3], [-71.2, -80.7], [201.8, -128.7]],
  },
};
export const CRATE_KINDS = { grenade: { label: 'KRANAATIT', give: 2 }, rocket: { label: 'SINKO', give: 2 } };
export const CRATE_RESPAWN = 40;        // s, poimitun laatikon tilalle uusi toisaalle
export const CHECKPOINT_RADIUS = 3.5;   // m

// Ajoneuvot (mallit public/vehicles/, mitat ja nivelet *.manifest.json). Pelissä yleisnimet.
export const VEHICLES = {
  apc: { name: 'NC-4 PANSSARIAJONEUVO', short: 'NC-4', hp: 500, file: '/vehicles/nc4_apc.glb', respawn: 30, enterRadius: 5 },
  heli: { name: 'NC-H6 HELIKOPTERI', short: 'NC-H6', hp: 260, file: '/vehicles/nc_h6.glb', respawn: 30, enterRadius: 6 },
};
// ajoneuvoaseet: 8 = panssariajoneuvon raskas konekivääri (RWS), 9 = helikopterin konetykit; raketit = 6
export const VEHICLE_WEAPONS = {
  8: { id: 'rws', short: 'RWS-KK', name: 'RASKAS KONEKIVÄÄRI', dmg: 34, rpm: 520, mag: 100, reload: 5, spread: 0.45,
    snd: { f: 600, q: 0.8, decay: 0.16, thump: 45, crack: 0.9, gain: 1.1, tail: 1.1 } },
  9: { id: 'heligun', short: 'H6-TYKKI', name: 'KONETYKIT', dmg: 16, rpm: 1100, mag: 300, reload: 6, spread: 1.0,
    snd: { f: 900, q: 0.9, decay: 0.08, thump: 60, crack: 0.7, gain: 0.85, tail: 0.8 } },
};
export const HELI_ROCKETS = { count: 14, cooldown: 0.35, reload: 10 };
// ajoneuvoon osuvan vahingon kerroin aseryhmittäin (palvelin): käsiaseet, räjähteet, RWS, konetykit
export const VEHICLE_DMG = { apc: { small: 0.08, splash: 1.0, 8: 0.3, 9: 0.15 }, heli: { small: 0.5, splash: 1.4, 8: 1.0, 9: 0.8 } };
