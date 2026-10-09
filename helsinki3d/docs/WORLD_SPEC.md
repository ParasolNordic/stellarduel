# Helsinki 3D – asset- ja maailmaspesifikaatio

## Lähde
Helsingin City Models -viennin `request_summary.txt` mukaan: LoD2, tekstuuriteema `rgbTexture_2024`, maasto mukaan, maastotekstuuri `Ortoilmakuva_2025_5cm` (WMS), koordinaatit EPSG:3879, alkuperäinen korkeus absoluuttisena, ei laatoitusta. Käyttäjän antama ZIP `FILECOPY_1-2.zip`.

## Todettu sisältö
- FME OBJ: 25 402 pistekoordinaattia; 27 314 UV:tä; 41 185 kolmioitua pintaa.
- 587 rakennustekstuuria ja 47 maastotekstuuria `materials_textures`-kansiossa. 635 ei ole tekstuurien määrä – kansiokuvassa näkyi myös piilotiedostoja. PNG-kuvia yhteensä 634.
- `citygml_textures` sisältää samat maaston PNG:t sekä rakennustekstuurien JPEG-esitykset; ne eivät ole erillisiä rakennuksia.
- OBJ:n kolmioista 3 887 kuuluu rakennuksiin ja 37 298 maastoon (materiaalin nimen `ter_` mukaan). Ero muutamaan degeneraattiin glb-muunnoksessa on normaalia.
- CityGML-viennin Building-kohteiden lukumäärä oli edellisessä auditoinnissa 51. Se ei tarkoita 51 erillistä asuntoa tai käyntikohdetta.
- Lähdealueen koordinaattirajat saadaan `public/world/world-manifest.json`-tiedostosta, n. 383 × 364 metriä.

## Pelin geometriat
`buildings.glb` sisältää **3 piirrettävää primitiiviä** (2 rakennustekstuuriatlas-materiaalia + 1 ei-teksturoitu).
`terrain.glb` sisältää **2 piirrettävää primitiiviä** (2 maastotekstuuriatlas-materiaalia).
JPEG-atlakset ovat GLB:n sisällä, joten peliin ei tarvitse kopioida alkuperäisiä yksittäisiä PNG-tiedostoja.

## Paikkatieto
EPSG:3879: x = itäkoordinaatti, y = pohjoiskoordinaatti, z = korkeus m. Three.js-peli: x = (itä − itäorigo), y = korkeus, z = −(pohjoinen − pohjoisorigo).
**Molemmat GLB:t on muunnettu samaan origoonsa.** Jos yhdistät myöhemmin toista aineistoa, muunna samaan koordinaatistoon ja samaan origoon.

## Renderöinti ja tekstuurit
- Kaikki lähdetekstuurit olivat RGB-kuvia; JPEG-laaduksi asetettiin 85, 4 096² pikselin atlakset ja 3 px suojareuna.
- Maaston puhtaasti mustat `0,0,0` ei-dataa-pikselit täytetään lähimmällä kelvollisella pikselillä. Tämän voi muuttaa muunnosskriptissä, jos haluat alkuperäiset reunat ennalleen.
- Katto- ja seinäpintoihin jäi jonkin verran materiaalia vailla olevia harmaita kolmioita (lähteen materiaaliton geometria).
- Tekstuurit ovat vuoden 2024 rakennuskuvia ja vuoden 2025 ortoilmakuvaa, eivät oikeaa päivänvalo-/vuodenaikasimulaatiota.

## Rajoitukset / seuraavat vaiheet
- Koordinaatisto ja rakennukset ovat paikkatietolähteestä, mutta peli ei vielä sisällä oikein luokiteltuja ajoratoja, jalkakäytäviä, puiden 3D-malleja tai autojen fysiikkaa.
- Maanpinta kuvaa nykyisen maastomallin ulkopintaa; rakennuksissa ei ole sisätiloja.
- Liikkumiskamera käyttää maastokorkeuteen raycastia; ei rakennustörmäyksiä eikä pelimekaniikkaa.
- GLB ei ole avannut JS-katselinta tässä ympäristössä WebGL:n kautta; visualisointi tehtiin ohjelmallisesti ja mallit validoitiin `trimesh`-latauksella.
- Lataa vain n. 383 × 364 m – tämä käyttäjän rajaus ei kata koko Kruununhakaa ja Katajanokkaa.
