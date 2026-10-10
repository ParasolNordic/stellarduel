// Merialueet: manifestin vesimonikulmiot piirretään vedenpintana ortokuvan päälle (pelaaja ei voi kävellä niillä,
// ks. PlayerController.validXZ). Pinta on tasainen, heijastaa taivasta ja on hieman läpikuultava.
import * as THREE from 'three';

export function addWater(scene, world) {
  const polys = world.manifest && world.manifest.water_polygons_local_xz;
  if (!polys || !polys.length) return null;
  // vedenpinnan taso: maaston matala kohta vesialueella + pieni lisä
  const hs = [];
  for (const P of polys) {
    const xs = P.map(p => p[0]), zs = P.map(p => p[1]);
    for (let x = Math.min(...xs); x < Math.max(...xs); x += 4) for (let z = Math.min(...zs); z < Math.max(...zs); z += 4) {
      const h = world.heightAt(x, z); if (h !== null) hs.push(h);
    }
  }
  hs.sort((a, b) => a - b);
  const level = (hs.length ? hs[Math.floor(hs.length * 0.2)] : 0.2) + 0.15;
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b5670'), roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.86, depthWrite: true });
  const group = new THREE.Group(); group.name = 'water';
  for (const P of polys) {
    const shape = new THREE.Shape(P.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat); m.position.y = level; m.receiveShadow = true; group.add(m);
  }
  scene.add(group);
  return { group, level };
}
