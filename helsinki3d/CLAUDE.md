# Helsinki 3D – peliprojekti (lyhyt kehittäjäohje)

## Tavoite
Selaimessa toimiva Three.js-pohjainen, päivänvalossa teksturoitu Helsinki 3D -maailma. Ensimmäinen vaihe: vapaa kamera, lento ja kävely. Myöhemmin auto / lentokone / FPV-shooter. Rakennusten muotojen ja tekstuurien tunnistettavuus on etusijalla.

## Konteksti ja assettien käyttö
- **Älä lue tai tulosta kokonaisia OBJ/GML/GLB/PNG-tiedostoja tai tuhansia verteksiä keskusteluun.** Käsittele niitä paikallisten skriptien avulla. Palauta vain lyhyet tilastot ja olennaiset virheet.
- Käytä `public/world/world-manifest.json` tiedostojen ja alkuperäkoordinaattien hakemiseen.
- Valmiit pelimallit: `public/world/buildings.glb` ja `public/world/terrain.glb`. Molemmat sisältävät tekstuurinsa; erillisiä PNG-kansioita ei tarvitse siirtää pelin public-hakemistoon.
- Muunnosskripti: `scripts/build_world.py`. Alkuperäinen ZIP säilytetään erillään pelin julkaistavista tiedostoista.
- Three.js-sovellus on jaettu moduuleihin (alla). Älä vaihda koordinaatistoa tietämättäsi.

## Arkkitehtuuri (v0.2)
- `src/world/CityWorld.js` – kaupunkimaailma: GLB-lataus, materiaalit, varjoliput, tekstuurien laatutasot, korkeusruudukko (`heightAt`, `surfaceAt`, `isBuilding`) peleille.
- `src/lighting/Lighting.js` – fysikaalinen taivas tai kevyt taivas, aurinko Helsingin todellisessa kohdassa (`setTime(h, päivä)`), varjot, IBL, sumu.
- `src/camera/CameraRig.js` – kartta-, lento- ja kävelykamera, `setPose()` ohjelmalliseen kameran asetukseen.
- `src/game/GameManager.js` – pelimekaniikan kerros. Pelit rekisteröidään pelitiloina (`{ id, enter, exit, update }`) ja ne saavat kontekstin `{ scene, camera, world, lighting, rig }`. Nyt vain `explore`.
- `src/core/quality.js` (Low/Medium/High), `core/renderer.js`, `core/Perf.js` (FPS-mittari ja mittausajo).
- `src/main.js` vain kokoaa moduulit ja käyttöliittymän. `src/legacy/main-v01.js` + `viewer-v01.html` = alkuperäinen toimiva versio, älä muokkaa.
- Suorituskyky: `docs/PERFORMANCE.md`. Mittaa (`?bench=all`) ennen optimointeja.

## Nordic Combat (`fps.html`, `src/fps/`, `server/fps-server.js`)
Kolmen pelaajan moninpeli-FPS samassa maailmassa. Render-palvelu `nordiccombat`: REQUIRE_PASSWORD=1 ja GAME_PASSWORD (salaisuus, asetetaan vain Renderissä).
- Nimi pelaajille näkyvissä paikoissa on Nordic Combat; Helsinki mainitaan vain lisenssin vaatimassa aineistolähteessä (CC BY 4.0).
- Ohjaus: Välilyönti/hiiri ampuu, E hyppy, 1–7 aseet, Z kiikari, T tiimiviesti, Tab tilanne + näppäimet; kosketuslaitteilla `ui/Touch.js`.
- Kartat: `/` = kartta 1 (`public/world`, nimiavaruus /fps), `/kartta2` = kartta 2 (`public/world2`, /fps2). 1–6 pelaajaa.
- `shared.js` (palvelin + selain): paitavärit (sama väri = tiimi, ei omien tulitusta, tiimin kaadot 25), tarkastuspaikat ja laatikoiden mahdolliset paikat karttakohtaisesti.
- Kartta 2:n meri: `water_polygons_local_xz` manifestissa (käyttäjän merkitsemä, kohdistettu ilmakuvaan) → `world/Water.js` vedenpinta, `PlayerController.validXZ` estää kävelyn.
- `world/Objectives.js` tarkastuspaikat (karttanäyttö, `ui/MiniMap.js` piirtää yläkuvan latauksessa) ja ammuslaatikot; `ui/Chat.js` tiimiradio (LCD).
- `physics/WorldCollider.js` BVH (three-mesh-bvh) suoraan piirtomesheihin: säteet ja kapselitörmäys. `player/PlayerController.js` liike.
- `weapons/defs.js` asevalikoima datana; `WeaponModels.js` ohjelmalliset mallit (staattiset osat yhdistetään); `Viewmodel.js` ADS, rekyyli, animaatiot, kiikarin PiP-suurennos; `WeaponSystem.js` tulitus, osumat, raketit, kranaatit.
- `fx/Effects.js` partikkelit, räjähdykset; `fx/Marks.js` pysyvät kraatterit/seinäjäljet/kivet siemenluvusta (palvelin tallentaa, myöhään liittyvät saavat listan).
- Verkko: liike ja osumat ampujan selaimessa, palvelin hoitaa terveyden, kuolemat, pisteet, alueosuman ja jäljet.
- Testaus: `?q=low&pr=0.3` (pieni piirtotarkkuus headless-selaimelle), `window.__FPS`.

## Koordinaatit
Lähde EPSG:3879, yksikkö metri. Pelin x = easting − origin_easting, y = alkuperäinen korkeus, z = −(northing − origin_northing). Origo luetaan manifestista. Rakennukset ja maasto on jo kohdistettu **samaan** lokaaliin origoonsa; älä siirrä niitä erikseen.

## Rajoitukset
- Nykyinen vienti kattaa ~383 × 364 metriä, EI koko Kruununhakaa tai Katajanokkaa.
- Ortoilmakuva on tekstuuri, ei katuverkon navigointi- tai törmäysgeometriaa.
- Kävelykameran korkeus seuraa maaston korkeusruudukkoa; rakennusten törmäyksiä ei ole toteutettu (ruudukossa on valmiina kattokorkeudet).
- Rakennuksissa on vielä osin harmaita teksturoimattomia pintoja alkuperäisen OBJ-viennin mukaisesti.
- Three.js-katselimen kamerat ja UI tarvitsevat selaintestauksen käyttäjän ympäristössä.

## Käynnistys
`npm install && npm run dev` (Three.js ja Vite); tuotanto `npm run build && npm start` (Express, dist/); vaihtoehtoisesti `python3 -m http.server 8000` ja avaa `http://localhost:8000/viewer-cdn.html` (vaatii Internetin CDN-kirjastoihin).

## Jatkotehtävät prioriteettijärjestyksessä
1. Käynnistä katselin; tarkista katon/julkisivujen UV:t ja suuntaus katutasolta sekä yläviistosta.
2. Lisää FPS-törmäykset ja käveltävän maanpinnan rajoitukset; pidä renderöintimesh erillään törmäysmeshistä.
3. Lisää katuverkko ja puut erillisestä aineistosta, jos lähdevienti ei sisällä niitä.
4. Tee aluekohtainen culling ja tarkempi tekstuurien LOD vasta mitatun suorituskyvyn perusteella.
5. Lisää valittu peli (ajaminen, FPV-lento tai FPS), kun ympäristö on tarkistettu.

## Lisenssi
Aineiston lähde on Helsingin kaupungin 3D-kaupunkimalli (LoD2) sekä ortoilmakuva 2025. Varmista molempien aineistojen aineistokohtainen lisenssi ja laita vaaditut tekijä- ja muutostiedot pelin Aineistolähteet-valikkoon ennen julkaisua.
