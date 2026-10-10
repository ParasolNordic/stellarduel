// Grafiikka-asetukset. Yksi paikka, josta renderöijä, maailma ja valaistus lukevat laatutason.
// Arvot on valittu niin, että Low toimii puhelimissa ja integroiduilla näytönohjaimilla ja High näyttää
// rakennusten tekstuurit ja varjot täydellä tarkkuudella.
import * as THREE from 'three';

export const QUALITY_PRESETS = {
  low: {
    id: 'low', label: 'Low',
    maxPixelRatio: 1, pixelScale: 0.8,      // piirtotarkkuus suhteessa näytön pikseleihin
    shadows: false, shadowMapSize: 0, shadowType: THREE.BasicShadowMap,
    // 4096² atlakset skaalataan latauksen jälkeen; julkisivujen tunnistettavuus ensin, joten rakennuksille isompi koko
    textureSize: { buildings: 2048, terrain: 1024 }, anisotropy: 2,
    environment: false,                     // ei taivaasta laskettua ympäristövaloa (IBL)
    sky: 'lite', surroundings: false,       // kevyt kärkiväritaivas (mitattu: fysikaalinen taivas ~20 % ruutuajasta ohjelmallisessa piirrossa)
    fogNear: 260, fogFar: 1400,
  },
  medium: {
    id: 'medium', label: 'Medium',
    maxPixelRatio: 1.5, pixelScale: 1,
    shadows: true, shadowMapSize: 2048, shadowType: THREE.PCFShadowMap,
    textureSize: { buildings: 4096, terrain: 2048 }, anisotropy: 8,
    environment: true, sky: 'physical', surroundings: true,
    fogNear: 350, fogFar: 2200,
  },
  high: {
    id: 'high', label: 'High',
    maxPixelRatio: 2, pixelScale: 1,
    shadows: true, shadowMapSize: 4096, shadowType: THREE.PCFSoftShadowMap,
    textureSize: { buildings: 4096, terrain: 4096 }, anisotropy: 16,   // rajataan laitteen tukemaan maksimiin
    environment: true, sky: 'physical', surroundings: true,
    fogNear: 450, fogFar: 3200,
  },
};

const KEY = 'h3d.quality';
export function initialQuality() {
  const url = new URLSearchParams(location.search).get('q');
  if (url && QUALITY_PRESETS[url]) return url;
  try { const s = localStorage.getItem(KEY); if (s && QUALITY_PRESETS[s]) return s; } catch (e) { /* ei tallennusta */ }
  const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  return coarse ? 'low' : 'high';                 // työpöytä: mittauksen mukaan High pysyy 60 FPS:ssä (Apple GPU)
}
export function saveQuality(id) { try { localStorage.setItem(KEY, id); } catch (e) { /* ei tallennusta */ } }
