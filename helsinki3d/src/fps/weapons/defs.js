// Asevalikoima datana. Uusi ase = uusi rivi tähän + malli WeaponModels.js:ään (build-funktio samalla id:llä).
// Yksiköt: vahinko osumapisteinä (terveys 100), kulmat asteina, ajat sekunteina, etäisyydet metreinä.
//
//  kind      'hitscan' (luoti osuu heti) | 'rocket' (lentävä ammus, alueosuma palvelimella)
//  auto      sarjatuli pidettäessä liipaisinta
//  rpm       tulinopeus; cycle = lukon/pumpun käyttö laukausten välissä (pultti- ja pumppuaseet)
//  pellets   haulien määrä laukausta kohden
//  falloff   [alkaa, loppuu, kerroin lopussa]
//  spread    hajonta [lonkalta, tähdätessä], bloom = lisähajonta laukausta kohden, move = liikkeen lisä
//  recoil    { v: pystypotku, h: sivuhajonta, kick: aseen taaksepotku (m), punch: näkymän hetkellinen nykäys }
//  sight     'iron' | 'reddot' | 'holo' | 'scope' | 'tube' ; adsFov = näkökenttä tähdätessä; zoom = kiikarin suurennos
//  reloadMode 'mag' (lipas kerralla) | 'shell' (patruuna kerrallaan)
//  speed     liikenopeuden kerroin aseen kanssa
//  snd       äänisynteesin parametrit (audio/Sound.js)
export const WEAPONS = [
  {
    id: 'pistol', name: 'P-9 PISTOOLI', short: 'P-9', slot: 1, kind: 'hitscan',
    dmg: 27, head: 2.0, auto: false, rpm: 420, mag: 15, reserve: Infinity, reload: 1.35,
    falloff: [18, 45, 0.6], spread: [1.7, 0.25], bloom: 0.5, move: 1.0,
    recoil: { v: 1.5, h: 0.5, kick: 0.035, punch: 1.1, roll: 6 },
    sight: 'iron', adsFov: 62, adsTime: 0.14, speed: 1.0, swap: 0.3,
    snd: { f: 1400, q: 0.9, decay: 0.09, thump: 90, crack: 0.5, gain: 0.8, tail: 0.5 },
  },
  {
    id: 'smg', name: 'K5 KONEPISTOOLI', short: 'K5', slot: 2, kind: 'hitscan',
    dmg: 17, head: 1.7, auto: true, rpm: 880, mag: 32, reserve: Infinity, reload: 1.85,
    falloff: [12, 38, 0.55], spread: [2.4, 0.75], bloom: 0.22, move: 0.6,
    recoil: { v: 0.5, h: 0.45, kick: 0.02, punch: 0.45, roll: 3 },
    sight: 'reddot', adsFov: 60, adsTime: 0.17, speed: 1.0, swap: 0.4,
    snd: { f: 1700, q: 0.8, decay: 0.06, thump: 80, crack: 0.45, gain: 0.6, tail: 0.35 },
  },
  {
    id: 'rifle', name: 'R-23 RYNNÄKKÖKIVÄÄRI', short: 'R-23', slot: 3, kind: 'hitscan',
    dmg: 24, head: 2.0, auto: true, rpm: 650, mag: 30, reserve: Infinity, reload: 2.25,
    falloff: [35, 95, 0.72], spread: [2.8, 0.28], bloom: 0.3, move: 1.4,
    recoil: { v: 0.75, h: 0.35, kick: 0.028, punch: 0.6, roll: 3 },
    sight: 'tube', adsFov: 50, adsTime: 0.22, speed: 0.94, swap: 0.5,
    snd: { f: 1100, q: 0.9, decay: 0.12, thump: 70, crack: 0.8, gain: 0.85, tail: 0.75 },
  },
  {
    id: 'shotgun', name: 'H12 HAULIKKO', short: 'H12', slot: 4, kind: 'hitscan',
    dmg: 14, pellets: 9, head: 1.5, auto: false, rpm: 75, cycle: 0.62, mag: 6, reserve: Infinity, reload: 0.5, reloadMode: 'shell',
    falloff: [7, 24, 0.22], spread: [5.2, 3.6], bloom: 0, move: 0.6,
    recoil: { v: 4.2, h: 1.1, kick: 0.08, punch: 3.0, roll: 8 },
    sight: 'iron', adsFov: 64, adsTime: 0.2, speed: 0.97, swap: 0.55,
    snd: { f: 520, q: 0.7, decay: 0.2, thump: 55, crack: 0.6, gain: 1.0, tail: 1.0 },
  },
  {
    id: 'sniper', name: 'TKIV-85 TARKKUUSKIVÄÄRI', short: 'TKIV', slot: 5, kind: 'hitscan',
    dmg: 95, head: 2.2, auto: false, rpm: 48, cycle: 1.0, mag: 5, reserve: Infinity, reload: 2.9,
    falloff: [120, 300, 0.85], spread: [7.0, 0.0], bloom: 0, move: 6,
    recoil: { v: 3.6, h: 0.6, kick: 0.07, punch: 2.6, roll: 4 },
    sight: 'scope', zoom: [4, 8], adsFov: 40, adsTime: 0.32, speed: 0.88, swap: 0.65, sway: 0.35,
    snd: { f: 650, q: 0.8, decay: 0.24, thump: 50, crack: 1.0, gain: 1.15, tail: 1.4 },
  },
  {
    id: 'lmg', name: 'KK-62 KONEKIVÄÄRI', short: 'KK-62', slot: 6, kind: 'hitscan',
    dmg: 21, head: 1.8, auto: true, rpm: 620, mag: 100, reserve: Infinity, reload: 4.4,
    falloff: [40, 110, 0.7], spread: [3.8, 0.7], bloom: 0.12, move: 2.0,
    recoil: { v: 0.6, h: 0.55, kick: 0.03, punch: 0.6, roll: 2 },
    sight: 'holo', adsFov: 54, adsTime: 0.36, speed: 0.82, swap: 0.8, spinup: 0.12,
    snd: { f: 850, q: 0.9, decay: 0.14, thump: 60, crack: 0.75, gain: 0.95, tail: 0.85 },
  },
  {
    id: 'launcher', name: 'RK-90 SINKO', short: 'RK-90', slot: 7, kind: 'rocket',
    dmg: 0, auto: false, rpm: 60, mag: 1, reserve: 3, reload: 2.8,
    spread: [1.2, 0.0], bloom: 0, move: 1.5, projSpeed: 58,
    recoil: { v: 3.0, h: 0.6, kick: 0.12, punch: 2.0, roll: 3 },
    sight: 'iron', adsFov: 52, adsTime: 0.3, speed: 0.86, swap: 0.8,
    snd: { f: 380, q: 0.6, decay: 0.35, thump: 45, crack: 0.2, gain: 1.0, tail: 1.2 },
  },
];
export const GRENADE = { name: 'KÄSIKRANAATTI', count: 3, fuse: 2.6, speed: 17, up: 3.5, radius: 0.07 };
// kuoleman syy kill feediin (palvelin käyttää indeksejä 0–6 aseille, 6 = raketti, 7 = kranaatti)
export const WEAPON_LABEL = i => i === 7 ? 'KRANAATTI' : (WEAPONS[i] ? WEAPONS[i].short : '?');
