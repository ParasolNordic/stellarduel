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
    crateSpots: [[-209.7, -385.8], [-29.7, 421.2], [249.3, -64.8], [-263.7, 61.2], [156.3, -418.8], [231.3, 247.2], [-44.7, -139.8],
      [-14.7, 151.2], [-263.7, 316.2], [-260.7, -172.8], [129.3, -226.8], [-26.7, -334.8], [144.3, 76.2], [75.3, 283.2], [-107.7, 280.2],
      [-149.7, -34.8], [0.3, 1.2], [-143.7, -253.8], [-155.7, 148.2], [234.3, -307.8], [120.3, -52.8], [240.3, -184.8], [258.3, 58.2],
      [-263.7, -52.8], [-254.7, -283.8], [48.3, -412.8], [-263.7, 166.2], [150.3, 181.2], [-107.7, -400.8], [-89.7, 46.2], [30.3, -208.8],
      [123.3, -325.8]],
  },
};
export const CRATE_KINDS = { grenade: { label: 'KRANAATIT', give: 2 }, rocket: { label: 'SINKO', give: 2 } };
export const CRATE_RESPAWN = 40;        // s, poimitun laatikon tilalle uusi toisaalle
export const CHECKPOINT_RADIUS = 3.5;   // m
