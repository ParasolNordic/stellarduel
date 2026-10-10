# 3D-kaupunkimallit selainpeleissä – grafiikan perusohje

Pohjana on Nordic Combat (Three.js r180 + Vite, WebGL2). Ohjetta käytetään, kun uusi teksturoitu 3D-malli otetaan ohjelman tai pelin pohjaksi. **High-taso pyörii 60 FPS:llä sekä työpöydällä että puhelimessa, joten se on oletus kaikilla laitteilla.**

## 1. Mallin vastaanotto

- **Suuria 3D-tiedostoja tai tekstuureja ei lueta keskusteluun.** Ne käsitellään skripteillä (`scripts/build_world.py`), ja keskusteluun tuodaan vain tilastot: kolmiot, verteksit, rajat ja tekstuurikoot.
- Lähdeaineisto (OBJ/CityGML/ZIP) muunnetaan GLB:ksi, jonka sisällä tekstuurit ovat:
  - kerrokset erikseen, esim. `terrain.glb` ja `buildings.glb`
  - tekstuurit atlaksina, 4096² JPEG
  - mukaan `world-manifest.json`: origo, rajat, tiedostot ja koot
- Koordinaatisto: `x = itä − origo`, `y = korkeus`, `z = −(pohjoinen − origo)`, yksikkönä metri. Kerrokset kohdistetaan samaan origoon, eikä niitä siirretä erikseen.
- Geometriaa, mittakaavaa ja UV:ita ei muuteta. Kaikki pelin lisäykset (jäljet, efektit) ovat omia verkkojaan mallin päällä.
- Lisenssin vaatima lähdemaininta (esim. CC BY 4.0) näytetään aina Aineistolähteet-valikossa. Se on ainoa paikka, jossa alkuperäinen aineistolähde saa näkyä, vaikka peli olisi nimetty muuksi.

## 2. Renderöijä ja värit

| Asetus | Arvo | Miksi |
|---|---|---|
| Ulostulo | `SRGBColorSpace`, tekstuurit `SRGBColorSpace` | valokuvatekstuurit oikeina väreinä |
| Sävykartoitus | `NeutralToneMapping`, valotus ~0,82–1,2 auringon korkeuden mukaan | säilyttää julkisivujen sävyt (ACES tummentaa ja siirtää värejä) |
| Antialiasointi | päällä | ohuet katto- ja seinälinjat |
| Pikselisuhde | `min(devicePixelRatio, 2)` | Retina-tarkkuus ilman 3×-ylikuormaa |

## 3. Valaistus (`src/lighting/Lighting.js`)

- **Taivas:** fysikaalinen `Sky`. Auringon paikka lasketaan mallin todellisesta sijainnista, päivämäärästä ja kellonajasta.
- **Ympäristövalo (IBL):** `PMREMGenerator` taivaasta, voimakkuus ~0,5. Lasketaan uudelleen vain kellonajan muuttuessa.
- **Aurinko:** `DirectionalLight` ~2,3, väri lämpenee matalalla. Hemisfäärivalo täyttää varjot kevyesti (~0,3).
- **Varjot:** varjokamera sovitetaan koko mallin rajoihin (`fitTo(bounds)`), `normalBias = 0,9 × varjokartan pikselikoko metreinä`.
- **Sumu:** ilmaperspektiivi taivaan värillä, ja ympäröivä maataso horisonttiin asti, jottei malli leiju tyhjässä.

## 4. Materiaalit ja tekstuurit (`src/world/CityWorld.js`)

- Kaupunkimallien pinnat ovat usein yksipuolisia tai väärin päin. Siksi materiaaleille asetetaan:
  - `side: DoubleSide` ja `shadowSide: BackSide` (ei itsevarjostusraitoja)
  - `roughness 1`, `metalness 0`
- Rakennukset heittävät varjon, ja kaikki pinnat vastaanottavat sen.
- Teksturoimattomat pinnat saavat neutraalin rappausvärin harmaan sijaan.
- Täydet 4096²-atlakset High-tasolla, `anisotropy` laitteen maksimiin (16) ja mipmapit päälle.
- Low- ja Medium-tasojen pienemmät tekstuurit tehdään latauksen jälkeen selaimessa canvasilla. Tiedostot pysyvät alkuperäisinä.

## 5. Laatutasot (`src/core/quality.js`)

| | Low | Medium | High (oletus) |
|---|---|---|---|
| Tekstuurit (rakennukset / maasto) | 2048² / 1024² | 4096² / 2048² | 4096² / 4096² |
| Varjot | ei | 2048, PCF | 4096, PCFSoft |
| Taivas ja IBL | kärkiväripallo, ei IBL | fysikaalinen + IBL | fysikaalinen + IBL |
| Pikselisuhde | ≤1 × 0,8 | ≤1,5 | ≤2 |

Mitattu Apple-näytönohjaimella: kaikki tasot 60 FPS, p95-ruutuaika 17–19 ms. Mallissa on noin 41 000 kolmiota, ruudun piirtämiseen riittää 7 piirtokutsua, ja tekstuurit vievät näytönohjaimelta noin 340 Mt.

## 6. Pelikerroksen grafiikka (tehokkuuden säännöt)

- **Törmäykset ja osumat:** BVH-hakupuu (`three-mesh-bvh`) rakennetaan suoraan piirtomesheille, ilman kopioita. Rakentaminen kestää noin 60 ms. Lisäksi 1 m korkeusruudukko (`heightAt`, `surfaceAt`) nopeisiin maakyselyihin.
- **Ase- ja ohjaamonäkymä:** oma näkymänsä, joka piirretään kaupungin päälle `clearDepth()`-kutsun jälkeen. Näin ase ei leikkaudu seiniin.
  - Valo kopioidaan kaupungin auringosta.
  - Näkymä tummuu, kun säde aurinkoon osuu rakennukseen.
- **Kiikari:** erillinen kuva (render target, HalfFloat, MSAA 4) kapealla näkökentällä.
  - Suurennos lasketaan linssin todellisesta koosta ruudulla.
  - Varjokarttaa ei piirretä toista kertaa.
- **Partikkelit:** kameraan kääntyvät instanssoidut tasot, yksi piirtokutsu sekoitustapaa kohden (additiivinen + alfa), tekstuurina yksi canvas-atlas. Ei syvyyskirjoitusta.
- **Pysyvät jäljet:** kraatterit, seinätarrat ja kivet kootaan kolmeen yhteiseen puskuriin, joten satakin jälkeä vie vain kolme piirtokutsua.
  - Ulkoasu lasketaan siemenluvusta, joten kaikki pelaajat näkevät saman jäljen.
  - Seinätarrat tehdään `DecalGeometry`-luokalla rakennusmeshistä.
  - Maakraatterit ovat korkeusruudukkoa seuraavia verkkoja, joissa on `polygonOffset`.
- **Valot:** pistevalot lisätään valmiiksi intensiteetillä 0 ja käytetään uudelleen. Valon lisääminen kesken pelin kääntäisi kaikki varjostimet uudelleen ja aiheuttaisi nykäyksen.
- **Proseduraaliset mallit:** aseet ja hahmot rakennetaan perusmuodoista. Staattiset osat yhdistetään materiaaleittain (`mergeGeometries`), jolloin noin 80 piirtokutsua putoaa noin 15:een.
- **Tekstuurit ilman tiedostoja:** savu, tuli, kraatterit, seinävauriot ja tähtäinkuviot piirretään canvasilla siemenluvusta, ja kohoumakartta (bump map) tehdään samasta kuvasta.

## 7. Mobiili

- Sama High-taso kuin työpöydällä.
- Kosketusohjaus: tikku vasemmalla, katselu vetämällä oikealla ja napit. Lisäksi `pointer: coarse` -tunnistus.
- iOS-zoomauksen esto touch- ja gesture-tapahtumilla, `viewport-fit=cover` ja safe-area-reunukset.
- HUD siirtyy kosketuslaitteilla kulmista yläreunaan, jotta peukaloille jää tilaa. Pystyasennossa peli pyytää kääntämään puhelimen.

## 8. Uuden mallin tarkistuslista

1. Muunna GLB:ksi ja kirjoita manifesti. Tarkista koot ja rajat skriptillä, ei katsomalla tiedostoa.
2. Lataa `CityWorld`-luokalla, sovita valaistus (`lighting.fitTo(world.bounds)`) ja aseta todellinen sijainti auringon laskentaan.
3. Tarkista materiaalit: kaksipuolisuus, varjopuoli, väriavaruus ja teksturoimattomien pintojen väri.
4. Rakenna BVH ja korkeusruudukko. Testaa maan korkeus, seinätörmäys ja säteiden osumat.
5. Mittaa ennen optimointia: `?bench=all` ja F-näppäimen mittari. Tavoite on 60 FPS ja p95 alle 20 ms High-tasolla.
6. Testaa headless-selaimella `?q=low&pr=0.3` (vain toiminnallisuus: ohjelmallinen WebGL ei kerro todellista nopeutta). Tee lopullinen nopeustesti oikealla puhelimella ja työpöydällä.
7. Lisää lisenssin vaatima lähdemaininta Aineistolähteet-valikkoon.
