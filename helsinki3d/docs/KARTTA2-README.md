# Maailmapaketti – integraatio-ohje

Uusi teksturoitu kaupunkimaailma Nordic Combat -peliin (Three.js r180 + Vite). Paketti on rakennettu ja tarkistettu [grafiikan perusohjeen](GRAFIIKKA-PERUSOHJE.md) mukaan. Pelimekaniikkaa ei ole lisätty.

## Sisältö

| Tiedosto | Sisältö |
|---|---|
| `buildings.glb` | 191 rakennusta, 41 867 kolmiota (näistä 17 615 lähteessä teksturoimattomia). 4 atlasta 4096² JPEG + teksturoimaton materiaali = 5 piirtokutsua. 19,3 MiB. |
| `terrain.glb` | Maasto ja ortoilmakuva, 146 301 kolmiota. 2 atlasta 4096² JPEG = 2 piirtokutsua. 20,1 MiB. |
| `world-manifest.json` | Koordinaatisto, origo, rajat, vientialueen monikulmio, kerrokset, tekstuuritilastot. |
| `scripts/build_world.py` | Muunnos lähteestä (OBJ + MTL + PNG) GLB-tiedostoiksi. |
| `scripts/validate_world.py` | Ohjelmallinen tarkistus. Lähdekansion kanssa myös vertailu lähteeseen. |

Tekstuurit ovat GLB-tiedostojen sisällä, joten erillisiä kuvatiedostoja ei tarvita.

## Koordinaatit ja mittakaava

- Lähde on EPSG:3879 (GK25FIN), yksikkö metri ja korkeudet absoluuttisia (merenpinnasta).
- Pelin koordinaatit: `x = itä − 25497455,263`, `y = korkeus`, `z = −(pohjoinen − 6673064,126)`.
- Origo on mallin rajojen vaakasuora keskipiste. Molemmat kerrokset käyttävät samaa origoa, eikä niitä siirretä erikseen.
- Mittakaava on 1:1. Koko on 547,5 × 863,7 m (x × z), ja korkeus vaihtelee 0,19–72,33 m.
- Rajat paikallisina koordinaatteina: x −273,7…273,7, y 0,19…72,33, z −431,8…431,8.
- Origon maantieteellinen sijainti on 60,1705° N, 24,9542° E. Valaistuksen aurinkolaskenta (`LAT 60.17`, `LON 24.95`) sopii sellaisenaan.

## Käyttöönotto pelissä

1. Kopioi `buildings.glb`, `terrain.glb` ja `world-manifest.json` uuden pelin hakemistoon `public/world/`.
2. `CityWorld` lukee tiedostot manifestista, ja kerrosten nimet ovat samat (`terrain`, `buildings`). Latauskoodiin ei tarvita muutoksia.
3. Testasin paketin pelin moduuleilla erillisessä kopiossa. Tulokset:
   - katselin latasi kuusi 4096²-atlasta ja 188 168 kolmiota
   - FPS-peli rakensi törmäyspuun 241 ms:ssa ja löysi 20 896 syntymäpistettä
   - pelaaja syntyi maahan, ja seinätörmäys pysäytti kävelyn

Uuden pelin koodiin kannattaa tehdä nämä muutokset, koska alue on erilainen kuin edellisessä mallissa (nykyiseen peliin ei ole koskettu):

- **Vientialue ei ole suorakaide.** Maastoa on vain monikulmion `area_polygon_local_xz` sisällä, ja `bounds_local` on sen ympäröivä laatikko. Pelaajan rajaus kannattaa tehdä tämän monikulmion mukaan, vähintään 3 m reunasta sisäänpäin. Nykyinen rajaus käyttää laatikkoa, joten laatikon tyhjissä kulmissa ei ole maata (`heightAt` palauttaa `null`). Syntymäpisteet tarkistavat `heightAt`-arvon, joten ne ovat jo kunnossa.
- **Alue on noin 3,4 kertaa edellistä suurempi.** Varjokamera sovitetaan rajoihin (`fitTo`), joten 4096-varjokartan tarkkuus on noin 0,25 m/px (edellisessä 0,13). Jos varjot näyttävät liian pehmeiltä, varjokamera voi seurata pelaajaa (esim. 200 m:n alue pelaajan ympärillä).
- **Matalimmat kohdat (≈0,2 m) ovat vesialueita** ortokuvassa. Ne ovat tasaista maastogeometriaa, eli niillä voi kävellä.
- **Rakennusten pohjat ovat keskimäärin noin 1 m maanpinnan alapuolella.** Ominaisuus on lähdeaineistossa (CityGML), eikä se ole muunnosvirhe. Rakennukset eivät leiju: vain 2,5 % reunaruuduista on yli 0,5 m maan yläpuolella.

## Tekstuurit ja muistibudjetti

Lähdeaineistossa on 4 370 PNG-kuvaa, yhteensä 318 megapikseliä: rakennukset 237,5 ja maasto 80,3. Täydellä tarkkuudella se vastaisi noin 19 atlasta, mikä on liikaa selaimelle. Kuvat kootaan siksi atlaksiin näin:

1. **Rajaus.** Jokainen kuva rajataan UV:iden todella käyttämään alueeseen.
2. **Skaalaus.** Koko kuva skaalataan yhdellä kertoimella, joten UV-kohdistus säilyy täsmälleen. Kuvia ei muuten muokata.
3. **Rakennukset.** Kuvia pienennetään tekselitiheyden ylärajalla: tarpeettoman tarkat kuvat pienenevät eniten ja 39 kuvaa säilyy alkuperäisinä. Julkisivujen tarkkuus on 0,084 m/px. Katoille annetaan pienempi osuus (paino 0,3, noin 0,15 m/px), koska kadulta niitä ei näe läheltä.
4. **Maasto.** Kaikki ortokuvan ruudut skaalataan samalla kertoimella 0,61, jolloin tarkkuus on 0,12 m/px kaikkialla. Puhtaan mustat no-data-alueet täytetään lähimmillä kuvapikseleillä 86 ruudussa.
5. **Reunatäyte.** Jokaisen kuvan ympärille jätetään 4 px reunatäyte, jotta mipmapit eivät vuoda naapurikuvaan.

Näytönohjaimen muistia kuluu High-tasolla noin 535 Mt (6 × 4096² RGBA + mipmapit). Edellinen maailma vei noin 340 Mt.

**Tarkista High-taso oikealla puhelimella.** Jos muisti ei riitä, aja muunnos pienemmällä sivumäärällä (`--building-pages 3 --terrain-pages 2` tai `--building-pages 2`). Toinen vaihtoehto on laskea pelin High-tason rakennustekstuurit kokoon 2048 vain mobiilissa.

Pelin piirtokutsuja tulee nyt 9, edellisessä maailmassa 7.

## Korjatut lähdevirheet

Lähteessä ei ollut puuttuvia materiaaleja eikä kuvatiedostoja (4 370 materiaalia, kaikilla kuva).

- **Rikkinäiset maastokolmiot.** 19 kolmiota jätettiin pois: 17:ssä sama kärki toistui ja 2:lla pinta-ala oli nolla.
- **Maaston UV-arvot.** 157 kärjen UV-arvo oli hieman välin 0–1 ulkopuolella (pienin −0,039). Arvot rajattiin välille 0–1.
- **Teksturoimattomat pinnat.** 17 615 rakennuskolmiolta puuttuu lähteessä tekstuuri. Ne saavat materiaalin `untextured`, ja peli antaa niille neutraalin rappausvärin.
- **GML-tiedostoja ei tarvittu.** `export_terrain.gml` sisältää samat 146 320 maastokolmiota kuin OBJ, ja `export.gml` samat 191 rakennusta. Muunnos tehdään OBJ:sta, ja GML-tiedostot jäävät muuttumattomiksi lähteeksi.

## Tarkistus

Komento `python3 scripts/validate_world.py . --source <EXPORT>` antoi tuloksen **96/96 läpäisty**:

- **GLB-rakenne:** otsake, lohkot, puskurit ja accessorit. Arvoissa ei ole NaN-arvoja, normaalit ovat yksikköpituisia eikä nollapinta-alaisia kolmioita ole. Materiaalit ovat kaksipuolisia, metalness 0 ja roughness 1.
- **Atlakset:** kaikki 6 purkautuvat JPEG-kuvina (4096², RGB). Kaikki UV:t ovat välillä 0–1, ja kolmioiden UV-keskipisteet osuvat kuvadataan (taustaväriä enintään 0,02 %).
- **Mittakaava ja sijainti:** paikalliset rajat on johdettu suoraan EPSG-rajoista ja origosta. Jokainen kolmio löytyy lähteestä samasta paikasta (suurin poikkeama 0,02 mm), joten mittakaava, sijainti ja kerrosten keskinäinen asento ovat 1:1.
- **Värit:** atlaksen väri UV-kohdassa vastaa lähdekuvan väriä. Mediaaniero on 0,8/255 maastolla ja 1,9/255 rakennuksilla.

## Uudelleenrakennus

```
pip install numpy pillow scipy pyproj        # pyproj valinnainen
python3 scripts/build_world.py <purettu>/FILECOPY_1-3/EXPORT --out world [--building-pages 4] [--terrain-pages 2]
python3 scripts/validate_world.py world --source <purettu>/FILECOPY_1-3/EXPORT
```

Muunnos kestää noin 5 minuuttia (kahden ytimen kone), ja suurin osa ajasta kuluu 4 191 rakennuskuvan pakkaamiseen atlaksiin. Lähdetiedostoja ei muuteta. Jos maaston materiaalit on nimetty eri tavalla, käytä valitsinta `--terrain-prefix`.

## Lisenssi

Aineisto on Helsingin kaupungin 3D-kaupunkimalli (LoD2) ja ortoilmakuva 2025, lisenssillä CC BY 4.0. Lähdemaininta ja tieto muutoksista näytetään pelin Aineistolähteet-valikossa samalla tavalla kuin nykyisessä pelissä.
