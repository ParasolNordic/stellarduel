# Helsinki 3D – peliprojekti (lyhyt kehittäjäohje)

## Tavoite
Selaimessa toimiva Three.js-pohjainen, päivänvalossa teksturoitu Helsinki 3D -maailma. Ensimmäinen vaihe: vapaa kamera, lento ja kävely. Myöhemmin auto / lentokone / FPV-shooter. Rakennusten muotojen ja tekstuurien tunnistettavuus on etusijalla.

## Konteksti ja assettien käyttö
- **Älä lue tai tulosta kokonaisia OBJ/GML/GLB/PNG-tiedostoja tai tuhansia verteksiä keskusteluun.** Käsittele niitä paikallisten skriptien avulla. Palauta vain lyhyet tilastot ja olennaiset virheet.
- Käytä `public/world/world-manifest.json` tiedostojen ja alkuperäkoordinaattien hakemiseen.
- Valmiit pelimallit: `public/world/buildings.glb` ja `public/world/terrain.glb`. Molemmat sisältävät tekstuurinsa; erillisiä PNG-kansioita ei tarvitse siirtää pelin public-hakemistoon.
- Muunnosskripti: `scripts/build_world.py`. Alkuperäinen ZIP säilytetään erillään pelin julkaistavista tiedostoista.
- Three.js-renderöinti ja kamerat: `src/main.js`. Älä vaihda koordinaatistoa tietämättäsi.

## Koordinaatit
Lähde EPSG:3879, yksikkö metri. Pelin x = easting − origin_easting, y = alkuperäinen korkeus, z = −(northing − origin_northing). Origo luetaan manifestista. Rakennukset ja maasto on jo kohdistettu **samaan** lokaaliin origoonsa; älä siirrä niitä erikseen.

## Rajoitukset
- Nykyinen vienti kattaa ~383 × 364 metriä, EI koko Kruununhakaa tai Katajanokkaa.
- Ortoilmakuva on tekstuuri, ei katuverkon navigointi- tai törmäysgeometriaa.
- Kävelykameran korkeus seuraa maastoa raycastilla; rakennusten törmäyksiä ei ole toteutettu.
- Rakennuksissa on vielä osin harmaita teksturoimattomia pintoja alkuperäisen OBJ-viennin mukaisesti.
- Three.js-katselimen kamerat ja UI tarvitsevat selaintestauksen käyttäjän ympäristössä.

## Käynnistys
`npm install && npm run dev` (Three.js ja Vite); vaihtoehtoisesti `python3 -m http.server 8000` ja avaa `http://localhost:8000/viewer-cdn.html` (vaatii Internetin CDN-kirjastoihin).

## Jatkotehtävät prioriteettijärjestyksessä
1. Käynnistä katselin; tarkista katon/julkisivujen UV:t ja suuntaus katutasolta sekä yläviistosta.
2. Lisää FPS-törmäykset ja käveltävän maanpinnan rajoitukset; pidä renderöintimesh erillään törmäysmeshistä.
3. Lisää katuverkko ja puut erillisestä aineistosta, jos lähdevienti ei sisällä niitä.
4. Tee aluekohtainen culling ja tarkempi tekstuurien LOD vasta mitatun suorituskyvyn perusteella.
5. Lisää valittu peli (ajaminen, FPV-lento tai FPS), kun ympäristö on tarkistettu.

## Lisenssi
Aineiston lähde on Helsingin kaupungin 3D-kaupunkimalli (LoD2) sekä ortoilmakuva 2025. Varmista molempien aineistojen aineistokohtainen lisenssi ja laita vaaditut tekijä- ja muutostiedot pelin Aineistolähteet-valikkoon ennen julkaisua.
