# Stellar Duel

Kahden pelaajan vektorigrafiikkakaksintaistelu samalla näppäimistöllä, Tähtikauppias 64:n hengessä.
Yksi HTML-tiedosto, ei riippuvuuksia: avaa `index.html` selaimessa.

## Kulku
1. **Aseiden valinta** – kumpikin valitsee yhden laserin (6 vaihtoehtoa) ja yhden ohjustyypin (6 vaihtoehtoa).
   Tehopisteitä on 5, joten vain toinen aseista voi olla tehokas.
2. **Kaksintaistelu** – jaettu näyttö pystysuunnassa, asteroidikenttä, kaasujättiläinen renkaineen, kuu, sininen planeetta, aurinko, komeetta ja kaukainen galaksi.
3. **Palkinto** – voittaja telakoituu avaruusasemalle (lähestymiskehykset ohjaavat aukkoon) ja noutaa palkinnon.

## Ohjaimet
| | Pelaaja 1 (vasen) | Pelaaja 2 (oikea) |
|---|---|---|
| Nyökkäys | W / S | ↑ / ↓ |
| Kallistus | A / D | ← / → |
| Sivukääntö | Q / E | , / . |
| Kaasu / jarru | R / F | P / Ö |
| Laser | Välilyönti | Enter (tai Numpad 0) |
| Ohjus | X | Oikea Shift (tai Numpad Enter) |
| Soihdut | C | Ä (tai Numpad ,) |

Esc = tauko, 9 = äänet, 0 = koko näyttö. Nyökkäyssuunnan voi kääntää valintaruudussa.

Ohjus vaatii lukituksen: pidä vastustaja tähtäimen lähellä, kunnes lukitus on valmis. Soihdut harhauttavat ohjuksia ohjustyypin soihtusiedon mukaan ja katkaisevat vastustajan lukituksen.

## Verkkoversio (online/)

Kumpikin pelaaja pelaa omalla laitteellaan (tietokone tai puhelin) ja näkee oman koko ruudun näkymänsä.
Toinen luo pelin ja saa nelikirjaimisen koodin ja QR-koodin, toinen liittyy koodilla tai skannaamalla.

- `online/server.js` – Express + Socket.IO, pelihuoneet ja QR-koodit
- `online/game.js` – palvelimen pelisimulaatio (osumat, ohjukset, törmäykset, voittaja, palkinto)
- `online/public/` – selainasiakas ja yhteinen koodi (`shared.js`)
- Alkuperäinen jaetun ruudun peli (`index.html`) on ennallaan ja löytyy palvelimelta osoitteesta `/jaettu`.

Paikallisesti: `npm install && npm start`, sitten http://localhost:3000

**Näppäimistö:** nuolet / WASD ohjaus, Q E sivukääntö, R / Shift kaasu, F / Z jarru,
välilyönti laser, X / Enter ohjus, C / N soihdut, Esc kahdesti = poistu.
**Puhelin:** vasen puikko ohjaa, vasemman reunan liukusäädin on kaasu, oikealla LASER, OHJUS ja SOIHTU.

## Vektoriralli (ralli/)

Kolmen pelaajan 3D-vektoriautotaistelu kaupungissa ja vuoristossa, kukin omalla laitteellaan.
Vapaa ajoalue: kaupungin katuverkko (bulevardit ja kadut), kehämoottoritie, maantiet ja vuoriston soratiet.
Neljä autoa (kupla, maasturi, 1910-luvun veteraani, 1920-luvun faetoni), kolme asetta ja kolme erikoisasetta
(raketit, miinat, öljy). Kestävyys laskee törmäyksistä ja osumista, lommot näkyvät autossa, ja minikartalla näkyvät muut kilpailijat.
Viimeinen ehjä auto voittaa kierroksen.

Käynnistys: `npm run start:ralli` (oletusportti 3001).

## Helsinkiralli (helsinkiralli/)

Vektorirallin versio Helsingin Kruununhaassa, piirretty WebGL:llä syvyyspuskurin avulla.
Kaupunki on Helsingin LoD2-rakennusmallin oikea kolmioverkko (`helsinkiralli/data/kruununhaka-mesh.json`,
EPSG:3879, 81 850 kolmiota ja 48 614 viivaa). Rakennusten seinät ja katot peittävät taakse jäävän täsmälleen
kuten LoD2-katselimessa; viivat piirretään pintojen päälle.

Muunnosskripti `helsinkiralli/tools/muunna_mesh.py` tuottaa:
- `public/kaupunki.js` (palvelin + selain): törmäysruudukko 1 m (kolmioiden pohjista), korkeudet 2 m
  ammuksille ja näkyvyydelle, maanpinta 4 m (kadun puoleisten seinien alareunoista) ja aloituspaikat
- `public/kaupunki-mesh.js` (selain): kolmiot, viivat ja maan pintaluokat (katu, jalkakäytävä, aukio)

Ajo uudelleen: `cd helsinkiralli/tools && python3 muunna_mesh.py ../data/kruununhaka-mesh.json ../public`
(vaatii numpy, scipy, scikit-image). Käynnistys: `npm run start:helsinki` (oletusportti 3002).
Vanha viivamallista arvaava muunnos on tallessa tiedostossa `tools/muunna_kruununhaka.py`.

## Helsinkikopteri (helsinkikopteri/)

Yksinpelattava helikopterisimulaattori täsmälleen samassa ympäristössä kuin Helsinkiralli: Kruununhaan LoD2-malli,
maasto ja piirtomoottori (WebGL tai varapiirto) tulevat suoraan `helsinkiralli/public`-kansiosta (palvelin jakaa ne polussa `/yhteiset/`).

- Näkymät: ulkoa (jahtikamera) ja ohjaamosta (ikkunakehys ja mittaristo: nopeus, keinohorisontti, korkeus, vario, kompassi, kollektiivi). V vaihtaa.
- Tilat: vapaa lento, reittilento (10 porttia katujen yllä ja kattojen yli, laskeutuminen kotikentälle) ja kattolaskeutumiset (5 tasakattoa).
- Vakain (H): pitää kopterin vaakatasossa ja korkeuden, rajoittaa vajoamaa lähellä pintaa. Ilman vakainta kollektiivi on vipu ja ohjaus kulmanopeuksia.
- Tuho: roottori tai runko osuu rakennukseen tai maahan, liian kova tai vino laskeutuminen.
- Ohjaus: nuolet syklinen, W/S kollektiivi, A/D pyrstöroottori; peliohjain; puhelimessa kaksi kosketustikkua.

Käynnistys: `npm run start:kopteri` (oletusportti 3003).

## Helsinkihelikopterit – moninpeli (helsinkikopteri-moni/, helsinkihelikopterit.onrender.com)

1–3 pelaajaa omilla helikoptereillaan Kruununhaan yllä, kukin omalla laitteellaan (huonekoodi ja QR-koodi kuten rallissa).
Lento, näkymät (ulkoa / ohjaamosta), vakain ja mittaristo ovat samat kuin yksinpelissä; ympäristö tulee `helsinkiralli/public`-kansiosta. Kopteripeleissä rakennusten kerroslinjat on jätetty pois (`{ floors: false }`).

- **Vapaa lento:** yhteinen lento ilman aseita; toisten läpi voi lentää.
- **Reittikilpailu:** samat 10 porttia kaikille (siemenluvusta), lopuksi laskeutuminen kotikentälle. Tuhoutunut kopteri palaa viimeisen portin kohdalle.
- **Taistelu:** yksi kiinteä tykki nokassa. Kantama 150 m, osuma-alue 3,2 m säteellä, 4 vahinkoa/osuma (25 osumaa pudottaa), tykki ylikuumenee jatkuvassa tulessa.
  5 pudotusta tai eniten 6 minuutissa voittaa. Uusi kopteri ilmaan 4 s kuluttua, 3 s suoja. Törmäys toiseen kopteriin tuhoaa molemmat.
- Palvelin (`server.js`) välittää tilat 20 Hz ja ratkaisee osumat, tuhot, portit ja voittajan; yhteinen koodi `public/kyhteinen.js`.

Käynnistys: `npm run start:kopterimoni` (oletusportti 3004).

## IT-harjoitus (itharjoitus/)

Ilmatorjunnan ammuntaharjoitus Kruununhaassa yöllä, samassa ympäristössä kuin helikopteripelit. Hakukoneet ja indeksoijat
estetään (`robots.txt` kieltää kaiken, `X-Robots-Tag`-otsake ja `meta robots` -tagi).

- **Yksinpeli:** sijoita kolme it-patteria tasakatoille (12,7 ITKK 96, 23 ITK 61, 35 ITK 88), vaihda näkymää patterien välillä (1–3)
  ja ammu 360 astetta. Tietokone lennättää 6–8 maalilennokin laivuetta, joka tekee kolme ylilentoa ja poistuu.
  Ammuksilla on lentoaika ja pudotus; ennakkomerkit (L) ja muiden patterien miehistöt (T) voi kytkeä pois. Vähintään puolet alas = onnistunut harjoitus.
- **Kaksinpeli:** toinen komentaa ilmatorjuntaa, toinen lentää johtolennokkia kuuden muun rinnalla. Ilmatorjunta voittaa ampumalla
  johtolennokin alas, laivue voittaa tekemällä kolme ylilentoa harjoitusalueen keskustan yli.

Käynnistys: `npm run start:it` (oletusportti 3005).
