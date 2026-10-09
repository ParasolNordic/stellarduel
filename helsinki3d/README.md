# Helsinki 3D – teksturoitu Three.js -prototyyppi

Pelattavan maailmapohjan ensimmäinen versio: oikean Helsingin LoD2-rakennuksia, niihin kohdistettuja tekstuureja, teksturoitu maastopinta vuoden 2025 ortoilmakuva-aineistosta ja päiväsimulaation valaistus. Vapaata katselua, FPV-lentoa ja maanpinnan korkeutta seuraavaa kävelyä. **Ei vielä auto- tai shooter-peli**, eikä rakennuksille tarkkaa törmäystarkistusta.

## Helpoin tapa käynnistää (Mac / PC)

### Vaihtoehto A: ilman npm-asennusta

1. Pura koko ZIP säilyttäen alikansiot.
2. Avaa Terminal tai komentokehote ja siirry purettuun `helsinki-3d-prototype`-kansioon.
3. Käynnistä paikallinen palvelin: `python3 -m http.server 8000` (Windowsissa `py -m http.server 8000`).
4. Avaa selaimessa **http://localhost:8000/viewer-cdn.html**.

Tämä vaatii Internet-yhteyden **Three.js-kirjaston** lataamiseen CDN-palvelusta; 3D-kaupunki tulee omalta koneeltasi. Älä avaa sivua suoraan `file://`-osoitteella, koska selaimen tiedostolataus estää GLB-mallien hakemisen.

macOS: Voit myös kaksoisklikata `start-viewer.command`-tiedostoa, jos macOS sallii sen suorittamisen.

### Vaihtoehto B: Claude Code -kehitykseen (suositeltu)

Avaa tämä projektikansio Claude Codessa. Asenna Node.js ja aja terminaalissa:

```bash
npm install
npm run dev
```

Avaa Vitessä näytetty paikallinen osoite (yleensä http://localhost:5173). Tässä vaihtoehdossa `index.html` käyttää NPM:llä asennettua Three.js:ää.

## Ohjaus

- **Karttanäkymä:** hiiri kiertää, rulla zoomaa, oikea painike panoroi.
- **FPV-lento:** valitse FPV-lento, klikkaa kuvaa hiiren lukitsemiseksi, katso hiirellä, WASD liikkuminen, Q/E alas/ylös, Shift nopeuttaa.
- **Kävely:** valitse Kävely, klikkaa kuvaa, WASD, hiiri ja Shift; kamera seuraa maastopinnan korkeutta. Rakennusten läpi voi vielä kulkea.
- **Esc** vapauttaa hiiren. **1/2/3** vaihtavat kameratilaa.

## Mitä mukana on?

- `public/world/buildings.glb` – rakennusten teksturoitu geometria, sisäiset JPEG-atlakset.
- `public/world/terrain.glb` – maastogeometria + ortoilmakuva-atlakset; alkuperäisen ortokuvan mustat ei-dataa-reunat täytetty lähimmillä kelvollisilla pikseleillä.
- `public/world/world-manifest.json` – alkuperäisen EPSG:3879-koordinaatiston origo, mitat, aineiston sisältö.
- `src/main.js` + `src/style.css` – Three.js-katselin ja yksinkertaiset liikkumisohjaukset.
- `scripts/build_world.py` – uudelleenkäytettävä muunnos alkuperäisestä OBJ/MTL/PNG-viennistä (vaatii `numpy`, `Pillow`, `scipy`).
- `CLAUDE.md` – lyhyet kehittäjäohjeet Claude Codelle.
- `docs/WORLD_SPEC.md` – dataauditointi, tunnetut rajoitteet.
- `preview-helsinki-3d.png` – **ohjelmallinen esikatselu**, ei Three.js:stä otettu ruutukaappaus.

Lähdeaineisto (OBJ, GML ja yli 600 tekstuuria) ei sisälly kevennettyyn julkaisu-/kehityspakettiin. Säilytä alkuperäinen ZIP omassa varmuuskopiossasi.

## Uudelleenrakentaminen

Pura alkuperäisen aineiston `EXPORT`-kansion tiedostot samaan kansioon ja aja:

```bash
python3 -m pip install numpy pillow scipy
python3 scripts/build_world.py /polku/EXPORT --out public/world
```

Skripti tuottaa kaksi itsenäistä GLB-mallia ja manifestin. Suuria raakatiedostoja ei lueta Clauden kontekstiin.

## Tarkistustaso

Molemmat GLB:t avattiin onnistuneesti `trimesh`-kirjastolla; tekstitiedostoille tehtiin rakennetarkistus ja renderöintiä varten tuotettiin erillinen **CPU-pohjainen** esikatselu. Three.js-katselimen WebGL-piirtoa **ei voitu testata tässä ympäristössä**, koska Three.js-kirjastoa ei ole paikallisesti eikä verkosta voinut asentaa. Tarkista ulkoasu ensimmäisellä ajokerralla; ilmoita mahdolliset virheet.

## Oikeudet

Alkuperäinen kaupunkimalli ja ortoilmakuva ovat Helsingin kaupungin tuottamia. Tarkista lataamiesi aineistojen lisenssit ennen kaupallista julkaisua ja lisää vaaditut lähdemerkinnät ja muutostiedot peliin.
