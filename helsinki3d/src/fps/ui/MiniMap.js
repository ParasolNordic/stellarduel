// Karttakuva ylhäältä: kaupunki piirretään kerran latauksen jälkeen ylhäältä kuvaksi.
// Käytetään tarkastuspaikan karttanäytössä (pelaajien sijainnit piirretään kuvan päälle).
import * as THREE from 'three';

export function renderTopView(renderer, scene, world, { size = 1024, terrainOnly = false } = {}) {
  const b = world.bounds, dx = b.max.x - b.min.x, dz = b.max.z - b.min.z;
  const w = dx >= dz ? size : Math.round(size * dx / dz), h = dz >= dx ? size : Math.round(size * dz / dx);
  // lähes ortografinen kuva hyvin kaukaa kapealla näkökentällä (ortografinen kamera ja ympäristövalo eivät toimi yhdessä)
  const H = 8000, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  const cam = new THREE.PerspectiveCamera(2 * Math.atan(dz / 2 / H) * 180 / Math.PI, dx / dz, H - 200, H + 200);
  cam.position.set(cx, H, cz); cam.up.set(0, 0, -1); cam.lookAt(cx, 0, cz); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 }); rt.texture.colorSpace = THREE.SRGBColorSpace;
  const hidden = [];
  const hide = o => { if (o && o.visible) { o.visible = false; hidden.push(o); } };
  if (terrainOnly) hide(world.layers.buildings);
  hide(world.surroundings);
  scene.traverse(o => { if ((o.isSprite || o.isPoints || (o.isMesh && o.geometry?.isInstancedBufferGeometry)) && o.visible) hide(o); });
  const fog = scene.fog; scene.fog = null;
  // ympäristövalo (PMREM) jättää tämän kuvan mustaksi: tilalle hetkeksi voimakkaampi hemisfäärivalo
  const env = scene.environment; scene.environment = null;
  const hemi = []; scene.traverse(o => { if (o.isHemisphereLight) { hemi.push([o, o.intensity]); o.intensity = 1.2; } });
  const bg = scene.background; scene.background = new THREE.Color(0x0b0f14);
  const sky = scene.getObjectByName('sky'), lite = scene.getObjectByName('lite-sky'); hide(sky); hide(lite);
  const prevTarget = renderer.getRenderTarget(), au = renderer.autoClear;
  renderer.setRenderTarget(rt); renderer.autoClear = true; renderer.render(scene, cam);
  const px = new Uint8Array(w * h * 4); renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
  renderer.setRenderTarget(prevTarget); renderer.autoClear = au;
  scene.fog = fog; scene.background = bg; scene.environment = env; for (const [o, i] of hemi) o.intensity = i; for (const o of hidden) o.visible = true;
  rt.dispose();
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d'), img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);   // WebGL: rivit alhaalta ylös
  g.putImageData(img, 0, 0);
  return { canvas, x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z,
    toPx: (x, z) => [(x - b.min.x) / dx * w, (z - b.min.z) / dz * h] };
}
