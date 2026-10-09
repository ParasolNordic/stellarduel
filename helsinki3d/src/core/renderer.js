// WebGL-renderöijän luonti ja laatutason mukaiset asetukset.
import * as THREE from 'three';

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Neutral-sävykartoitus (Khronos PBR Neutral) säilyttää valokuvatekstuurien sävyt ja värikylläisyyden
  // paremmin kuin ACES, joka siirtää värejä ja tummentaa julkisivuja.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = false;
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);
  return renderer;
}

export function applyRendererQuality(renderer, q) {
  const pr = Math.min(window.devicePixelRatio || 1, q.maxPixelRatio) * q.pixelScale;
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.type = q.shadowType;
  renderer.shadowMap.needsUpdate = true;
}
