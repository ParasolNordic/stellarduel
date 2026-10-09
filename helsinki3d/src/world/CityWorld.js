// Kaupunkimaailma: lataa manifestin ja GLB-mallit, asettaa materiaalit ja varjot, tarjoaa korkeustiedot peleille.
// Geometriaa, mittakaavaa tai koordinaatistoa ei muuteta: GLB:t on jo kohdistettu samaan lokaaliin origoon
// (x = itä − origo, y = korkeus, z = −(pohjoinen − origo)).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const GRID = 1;            // korkeusruudukon solukoko metreinä

export class CityWorld {
  constructor(scene, { baseUrl = 'world/' } = {}) {
    this.scene = scene;
    this.baseUrl = baseUrl;
    this.root = new THREE.Group();
    this.root.name = 'helsinki-world';
    scene.add(this.root);
    this.layers = {};          // { terrain: Object3D, buildings: Object3D }
    this.manifest = null;
    this.bounds = new THREE.Box3();
    this.textures = [];        // { material, original, scaled: Map(size -> Texture) }
    this.textureSize = 4096;
    this.anisotropy = 1;
    this.heights = null;       // maaston korkeusruudukko
    this.tops = null;          // rakennusten yläpinta (katot) samassa ruudukossa
  }

  async load(onProgress = () => {}) {
    onProgress('Luetaan maailman tiedot…', 0);
    const resp = await fetch(this.baseUrl + 'world-manifest.json');
    if (!resp.ok) throw new Error(`world-manifest.json: HTTP ${resp.status}`);
    this.manifest = await resp.json();
    const loader = new GLTFLoader();
    const order = [['terrain', 'maasto ja ortoilmakuva'], ['buildings', 'LoD2-rakennukset']];
    for (let i = 0; i < order.length; i++) {
      const [name, title] = order[i];
      const file = this.manifest.layers[name].file;
      const gltf = await loader.loadAsync(this.baseUrl + file, ev => {
        if (ev.total) onProgress(`Ladataan ${title} (${i + 1}/2) ${Math.round(100 * ev.loaded / ev.total)} %`, (i + ev.loaded / ev.total) / 2);
      });
      const obj = gltf.scene;
      obj.name = name;
      this.prepareLayer(name, obj);
      this.root.add(obj);
      this.layers[name] = obj;
    }
    this.root.updateMatrixWorld(true);
    this.bounds.setFromObject(this.root);
    onProgress('Rakennetaan korkeusruudukko…', 1);
    this.buildHeightGrid();
    return this;
  }

  prepareLayer(name, obj) {
    obj.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = name === 'buildings';
      o.receiveShadow = true;
      const m = o.material;
      if (!m) return;
      m.side = THREE.DoubleSide;                         // lähdemalli on kaksipuolinen; säilytetään
      if (m.map) {
        m.map.colorSpace = THREE.SRGBColorSpace;
        this.textures.push({ layer: name, material: m, original: m.map, scaled: new Map() });
      } else if (name === 'buildings') {
        // teksturoimattomat pinnat: lämmin vaalea rappaus harmaan sijaan (vain väri, ei geometriaa)
        m.color.setRGB(0.80, 0.78, 0.74, THREE.SRGBColorSpace);
      }
      m.roughness = 1; m.metalness = 0;
      // varjo kaksipuolisista pinnoista ilman itsevarjostusta
      m.shadowSide = THREE.BackSide;
      m.needsUpdate = true;
    });
  }

  // Tekstuurien tarkkuus: 4096² alkuperäiset tai ohjelmallisesti pienennetyt kopiot (Low/Medium)
  // size: luku tai { buildings, terrain }
  setTextureQuality(sizes, anisotropy) {
    this.textureSize = sizes; this.anisotropy = anisotropy;
    for (const t of this.textures) {
      const size = typeof sizes === 'number' ? sizes : (sizes[t.layer] || 4096);
      const orig = t.original, img = orig.image;
      const full = Math.max(img?.width || 4096, img?.height || 4096);
      let tex = orig;
      if (size < full && img) {
        tex = t.scaled.get(size);
        if (!tex) {
          const c = document.createElement('canvas'); c.width = c.height = size;
          const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, size, size);
          tex = new THREE.CanvasTexture(c);
          tex.flipY = orig.flipY; tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = orig.wrapS; tex.wrapT = orig.wrapT; tex.magFilter = orig.magFilter; tex.minFilter = orig.minFilter;
          tex.channel = orig.channel; tex.generateMipmaps = true;
          t.scaled.set(size, tex);
        }
      }
      if (tex.anisotropy !== anisotropy) { tex.anisotropy = anisotropy; tex.needsUpdate = true; }
      if (t.material.map !== tex) {
        const prev = t.material.map;
        t.material.map = tex; t.material.needsUpdate = true;
        if (prev && prev !== tex) prev.dispose();          // vapauttaa vain näytönohjaimen kopion; kuva säilyy muistissa
      }
    }
  }

  // Kaupunkialueen ympärille matala maapinta horisonttiin asti, ettei alue leiju tyhjän päällä.
  // Ei muuta kaupungin geometriaa: erillinen taso hieman maaston alimman kohdan alapuolella, sumu häivyttää sen.
  addSurroundings() {
    if (this.surroundings) return this.surroundings;
    const c = this.bounds.getCenter(new THREE.Vector3()), y = this.bounds.min.y - 0.6;
    const geo = new THREE.CircleGeometry(6000, 48); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.36, 0.40, 0.32, THREE.SRGBColorSpace), roughness: 1, metalness: 0 });
    const m = new THREE.Mesh(geo, mat); m.position.set(c.x, y, c.z); m.receiveShadow = false; m.name = 'surroundings';
    m.renderOrder = -1;
    this.scene.add(m); this.surroundings = m;
    return m;
  }

  setLayerVisible(name, on) { if (this.layers[name]) this.layers[name].visible = on; }

  // Korkeusruudukko rasteroimalla kolmiot (nopea kysely peleille: ei raycastia joka ruudussa)
  buildHeightGrid() {
    const b = this.bounds;
    const x0 = Math.floor(b.min.x) - 2, z0 = Math.floor(b.min.z) - 2;
    const nx = Math.ceil((b.max.x - x0) / GRID) + 3, nz = Math.ceil((b.max.z - z0) / GRID) + 3;
    const terrain = new Float32Array(nx * nz).fill(NaN), tops = new Float32Array(nx * nz).fill(-Infinity);
    const v = new THREE.Vector3(), P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const raster = (obj, out, useMax) => {
      obj.traverse(o => {
        if (!o.isMesh) return;
        const pos = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count : pos.count;
        for (let t = 0; t < n; t += 3) {
          for (let k = 0; k < 3; k++) { const i = idx ? idx.getX(t + k) : t + k; P[k].fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); }
          const ax = (P[0].x - x0) / GRID, az = (P[0].z - z0) / GRID, bx = (P[1].x - x0) / GRID, bz = (P[1].z - z0) / GRID, cx = (P[2].x - x0) / GRID, cz = (P[2].z - z0) / GRID;
          const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
          const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxx = Math.min(nx - 1, Math.ceil(Math.max(ax, bx, cx)));
          const minz = Math.max(0, Math.floor(Math.min(az, bz, cz))), maxz = Math.min(nz - 1, Math.ceil(Math.max(az, bz, cz)));
          if (Math.abs(area) < 1e-9) {                       // pystysuora seinä: merkitään reunat
            if (!useMax) continue;
            const ymax = Math.max(P[0].y, P[1].y, P[2].y);
            for (let gz = minz; gz <= maxz; gz++) for (let gx = minx; gx <= maxx; gx++) { const k = gz * nx + gx; if (ymax > out[k]) out[k] = ymax; }
            continue;
          }
          for (let gz = minz; gz <= maxz; gz++) for (let gx = minx; gx <= maxx; gx++) {
            const px = gx + 0.5, pz = gz + 0.5;
            const w0 = ((bx - px) * (cz - pz) - (bz - pz) * (cx - px)) / area, w1 = ((cx - px) * (az - pz) - (cz - pz) * (ax - px)) / area, w2 = 1 - w0 - w1;
            if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
            const y = w0 * P[0].y + w1 * P[1].y + w2 * P[2].y, k = gz * nx + gx;
            if (useMax) { if (y > out[k]) out[k] = y; } else if (Number.isNaN(out[k]) || y > out[k]) out[k] = y;
          }
        }
      });
    };
    if (this.layers.terrain) raster(this.layers.terrain, terrain, false);
    if (this.layers.buildings) raster(this.layers.buildings, tops, true);
    // täytetään aukot lähimmällä arvolla rivi- ja sarakesuunnassa
    for (let pass = 0; pass < 3; pass++) for (let k = 0; k < terrain.length; k++) {
      if (!Number.isNaN(terrain[k])) continue;
      const gx = k % nx, gz = (k / nx) | 0; let s = 0, c = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = gx + dx, zz = gz + dz; if (xx < 0 || zz < 0 || xx >= nx || zz >= nz) continue; const v2 = terrain[zz * nx + xx]; if (!Number.isNaN(v2)) { s += v2; c++; } }
      if (c) terrain[k] = s / c;
    }
    this.heights = { x0, z0, nx, nz, data: terrain };
    this.tops = { x0, z0, nx, nz, data: tops };
  }

  // maanpinnan korkeus (maasto) kohdassa x, z; null alueen ulkopuolella
  heightAt(x, z) {
    const h = this.heights; if (!h) return null;
    const fx = (x - h.x0) / GRID - 0.5, fz = (z - h.z0) / GRID - 0.5;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    if (ix < 0 || iz < 0 || ix >= h.nx - 1 || iz >= h.nz - 1) return null;
    const tx = fx - ix, tz = fz - iz, d = h.data, k = iz * h.nx + ix;
    const a = d[k], b = d[k + 1], c = d[k + h.nx], e = d[k + h.nx + 1];
    if ([a, b, c, e].some(Number.isNaN)) return Number.isNaN(a) ? null : a;
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz;
  }
  // korkein pinta (maasto tai rakennuksen katto) – myöhempiä törmäyksiä ja laskeutumisia varten
  surfaceAt(x, z) {
    const g = this.heightAt(x, z); const t = this.tops; if (!t) return g;
    const ix = Math.floor((x - t.x0) / GRID), iz = Math.floor((z - t.z0) / GRID);
    if (ix < 0 || iz < 0 || ix >= t.nx || iz >= t.nz) return g;
    const top = t.data[iz * t.nx + ix];
    return top > (g ?? -Infinity) ? top : g;
  }
  isBuilding(x, z) { const g = this.heightAt(x, z), s = this.surfaceAt(x, z); return g !== null && s !== null && s > g + 1.5; }

  get center() { return this.bounds.getCenter(new THREE.Vector3()); }

  stats() {
    let tris = 0, verts = 0;
    this.root.traverse(o => { if (o.isMesh) { const g = o.geometry; verts += g.attributes.position.count; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
    const texels = this.textures.reduce((s, t) => { const m = t.material.map, w = m.image?.width || 0, h = m.image?.height || 0; return s + w * h; }, 0);
    const ts = this.textureSize, tsTxt = typeof ts === 'number' ? ts + '²' : `rakennukset ${ts.buildings}², maasto ${ts.terrain}²`;
    return { triangles: Math.round(tris), vertices: verts, textures: this.textures.length, textureSize: tsTxt,
      textureMB: Math.round(texels * 4 * 1.33 / 1048576) };   // RGBA + mipmapit
  }
}
