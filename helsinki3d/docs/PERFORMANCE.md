# Suorituskyky – mittaukset ennen lisäoptimointia

Versiot: **v0.1** (alkuperäinen katselin, `viewer-v01.html`) ja **v0.2** (moduulirakenne, uusi valaistus, laatutasot, `index.html`).

## 1. Laitteesta riippumattomat mittarit

Nämä on laskettu suoraan malleista ja renderöijän tiedoista (`renderer.info`), joten ne pätevät kaikilla laitteilla.

| | v0.1 | v0.2 Low | v0.2 Medium | v0.2 High |
|---|---|---|---|---|
| Kolmiot | 41 182 | 41 182 (+ taivaspallo) | 41 182 | 41 182 |
| Piirtokutsut / ruutu | 5 | 6 | 7 (+ varjokierros) | 7 (+ varjokierros) |
| Rakennustekstuurit | 2 × 4096² | 2 × 2048² | 2 × 4096² | 2 × 4096² |
| Maastotekstuurit | 2 × 4096² | 2 × 1024² | 2 × 2048² | 2 × 4096² |
| Tekstuurimuisti GPU:lla (RGBA + mipmapit, arvio) | ~340 Mt | ~53 Mt | ~213 Mt | ~340 Mt |
| Varjokartta | – | – | 2048² (~16 Mt) | 4096² (~64 Mt), pehmeä PCF |
| Taivas | tasaväri | kärkiväripallo | fysikaalinen (Preetham) + IBL | fysikaalinen + IBL |
| Lataus paikallisesti | 5,7 s | 6,2 s | 6,2 s | 6,2 s |
| JS-keko latauksen jälkeen | 36 Mt | 14–21 Mt | | |

Lataus on kaikilla tasoilla sama, koska GLB:t ladataan alkuperäisinä (14,3 Mt). Pienemmät tekstuurit tehdään latauksen jälkeen selaimessa, eikä tiedostoja ole muutettu.

## 2. Ruutunopeus testiympäristössä (ohjelmallinen WebGL)

Testiympäristössä ei ole näytönohjainta. WebGL toimii SwiftShaderilla eli prosessorilla, joten luvut kertovat vain **suhteellisista** eroista ja ovat moninkertaisesti pienempiä kuin oikealla näytönohjaimella. Mittaus: 1280×720, pikselisuhde 1, karttanäkymä, 6–10 s.

| Kokoonpano | FPS | Ruutu ka. |
|---|---|---|
| v0.1 karttanäkymä | 5,6 | 178 ms |
| v0.2 Low, fysikaalinen taivas ja ympäröivä maa (ensimmäinen versio) | 4,5 | – |
| v0.2 Low, kevyt taivas (nykyinen) | 7,0 | – |
| v0.2 Low, ilman rakennuksia | 7,6 | – |
| v0.2, tyhjä näkymä (vain taivas) | 22,5 | – |

Mittauksen perusteella tehty muutos: Low-tasolla fysikaalinen taivas ja ympäröivä maataso veivät ohjelmallisessa piirrossa noin 35 % ruutuajasta. Ne korvattiin kärkivärejä käyttävällä taivaspallolla. Medium ja High käyttävät edelleen fysikaalista taivasta, jonka kustannus näytönohjaimella on pieni.

Medium- ja High-tasoilla (varjot 2048/4096, IBL) SwiftShader piirsi alle 2 ruutua sekunnissa, joten luotettavaa vertailua ei saatu.

## 3. Ensimmäinen mittaus oikealla laitteella (10.10.2026)

Laite: Apple GPU (Mac, Safari/WebKit). Mittausajo "Mittaa kaikki tasot", 4 s / näkymä.

| Taso | Karttanäkymä | Yläviisto | Katutaso | p95 | Piirtokutsut |
|---|---|---|---|---|---|
| Low | 59,4 FPS · 16,8 ms | 60,2 · 16,6 ms | 59,1 · 16,9 ms | 18–19 ms | 6 |
| Medium | 59,7 · 16,8 ms | 60,1 · 16,6 ms | 59,9 · 16,7 ms | 17–18 ms | 7 |
| High | 59,5 · 16,8 ms | 59,9 · 16,7 ms | 60,2 · 16,6 ms | 17–19 ms | 7 |

Johtopäätökset:
- Kaikki tasot osuvat näytön virkistystaajuuteen (60 Hz, ~16,7 ms). Selain ei piirrä tätä nopeammin, joten ero tasojen välillä ei näy: näytönohjaimella on varaa, mutta varan määrää ei voi mitata selaimessa (WebKit ei tarjoa GPU-ajastimia).
- 95. persentiili 17–19 ms: ei nykimistä, ei raskaita yksittäisiä ruutuja edes High-tasolla (4096-varjot, 4 × 4096² tekstuurit).
- **Lisäoptimointia ei tarvita työpöydällä.** Oletustaso työpöydällä nostettiin Mediumista Highiin.
- Seuraava mittaus: puhelin (iPhone/Android), jossa muisti (High ~340 Mt tekstuureja + 64 Mt varjokartta) on todennäköisempi rajoite kuin ruutunopeus.

## 4. Mittaus omalla laitteella

1. Avaa sivu ja odota latauksen loppuun.
2. Valitse sivupaneelista **Suorituskyky → Mittaa kaikki tasot**. Ajo kestää noin 40 s, eikä hiirtä tai näppäimiä kannata käyttää sen aikana.
3. Tulokset näkyvät taulukkona. Ne löytyvät myös selaimen konsolista rivinä `Helsinki 3D -mittaus {...}` näytönohjaimen nimen kanssa, ja niihin pääsee käsiksi muuttujasta `window.__H3D_BENCH`.

Osoiteparametrit:
- `?bench=all` käynnistää mittauksen automaattisesti.
- `?bench=medium&sec=8` mittaa yhden tason pidemmällä ajalla.
- `?q=low|medium|high` pakottaa laatutason.

**F-näppäin** näyttää jatkuvan mittarin: FPS, ruutuajan keskiarvo ja 95. persentiili, piirtokutsut, kolmiot ja tekstuurien määrä.

## 5. Seuraavat optimoinnit (vasta oikeiden laitemittausten jälkeen)

- Jos Medium tai High jää alle 60 FPS:n työpöydällä, ensimmäinen kokeilu on varjokartan päivitys vain auringon liikkuessa (`shadowMap.autoUpdate = false`). Maailma on staattinen.
- Jos puhelimen muisti loppuu, KTX2/Basis-pakatut tekstuurit vähentävät GPU-muistia noin 4–6-kertaisesti. Tämä vaatii muunnoksen `build_world.py`-ketjuun.
- Laajemmalle alueelle alueittainen jako ja näkyvyyskarsinta. Nykyisellä noin 400 m alueella kaikki on aina näkyvissä, ja 7 piirtokutsua on jo minimi.
