// Merialueet: manifestin vesimonikulmiot piirretään vedenpintana suoraan ortokuvan päälle. Maaston pinta ei ole
// merellä tasainen (0,5–2,8 m), joten vesi on ruudukko, jonka jokainen kärki seuraa maanpintaa (+ muutama cm).
// Pelaaja ei voi kävellä vedessä (PlayerController.validXZ).
import * as THREE from 'three';

const STEP = 1.5;      // ruudukon koko metreinä

function inside(P, x, z) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export function addWater(scene, world) {
  const polys = world.manifest && world.manifest.water_polygons_local_xz;
  if (!polys || !polys.length) return null;
  const pos = [], idx = [];
  for (const P of polys) {
    const xs = P.map(p => p[0]), zs = P.map(p => p[1]);
    const x0 = Math.min(...xs), z0 = Math.min(...zs), nx = Math.ceil((Math.max(...xs) - x0) / STEP) + 1, nz = Math.ceil((Math.max(...zs) - z0) / STEP) + 1;
    const vid = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
    const vert = (i, j) => {
      const k = j * (nx + 1) + i; if (vid[k] >= 0) return vid[k];
      const x = x0 + i * STEP, z = z0 + j * STEP, h = world.heightAt(x, z);
      vid[k] = pos.length / 3; pos.push(x, (h ?? 0.5) + 0.05, z); return vid[k];
    };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (!inside(P, x0 + (i + 0.5) * STEP, z0 + (j + 0.5) * STEP)) continue;
      const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  // normaalit ylöspäin: vedenpinta heijastaa taivasta tasaisesti, vaikka alla oleva maasto kumpuilee
  const n = geo.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b5670'), roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.78,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'water'; mesh.receiveShadow = true; mesh.renderOrder = 1;
  scene.add(mesh);
  return mesh;
}
