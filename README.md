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
