// Helsinki 3D – sovelluksen kokoaja. Moduulit:
//   core/renderer.js, core/quality.js   renderöijä ja grafiikka-asetukset
//   world/CityWorld.js                  kaupunkimaailma (GLB:t, materiaalit, korkeusruudukko)
//   lighting/Lighting.js                taivas, aurinko, varjot, ympäristövalo, sumu
//   camera/CameraRig.js                 kartta-, lento- ja kävelykamera
//   game/GameManager.js                 pelimekaniikan kerros (nyt vain vapaa tutkiminen)
//   core/Perf.js                        FPS-mittari ja mittausajo
import * as THREE from 'three';
import { createRenderer, applyRendererQuality } from './core/renderer.js';
import { QUALITY_PRESETS, initialQuality, saveQuality } from './core/quality.js';
import { CityWorld } from './world/CityWorld.js';
import { Lighting } from './lighting/Lighting.js';
import { CameraRig, HOME_VIEW } from './camera/CameraRig.js';
import { GameManager, ExploreMode } from './game/GameManager.js';
import { Perf, runBenchmark } from './core/Perf.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------- perusosat ----------
const renderer = createRenderer($('viewport'));
const scene = new THREE.Scene();
const world = new CityWorld(scene, { baseUrl: 'world/' });
const lighting = new Lighting(renderer, scene);
const rig = new CameraRig(renderer.domElement, { getHeight: (x, z) => world.heightAt(x, z) });
const games = new GameManager({ scene, camera: rig.camera, world, lighting, rig });
games.register(ExploreMode).start('explore');
const perf = new Perf(renderer);
let quality = QUALITY_PRESETS[initialQuality()];

function applyQuality(id, save = true) {
  quality = QUALITY_PRESETS[id];
  applyRendererQuality(renderer, quality);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  world.setTextureQuality(quality.textureSize, Math.min(quality.anisotropy, maxAniso));
  lighting.setQuality(quality);
  if (world.surroundings) world.surroundings.visible = quality.surroundings;
  document.querySelectorAll('[data-q]').forEach(b => b.classList.toggle('active', b.dataset.q === id));
  if (save) saveQuality(id);
  perf.reset();
  updateStats();
}
window.addEventListener('resize', () => applyRendererQuality(renderer, quality));

// ---------- käyttöliittymä ----------
function status(msg, err = false) { $('status').textContent = msg; $('status').classList.toggle('error', err); }
const HELP = {
  orbit: 'Hiiri: pyöritä · rulla: zoomaa · oikea: siirrä näkymää',
  fly: 'Klikkaa näkymää hiiren lukitsemiseksi · WASD: liiku · Q/E: alas/ylös · Shift: nopeuta · Esc: vapauta',
  walk: 'Klikkaa näkymää hiiren lukitsemiseksi · WASD: kävele · Shift: juokse · Esc: vapauta',
};
rig.addEventListener('mode', e => {
  const m = e.detail;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  $('crosshair').classList.toggle('visible', m !== 'orbit');
  $('help').textContent = HELP[m];
});
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => rig.setMode(b.dataset.mode)));
document.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => applyQuality(b.dataset.q)));
$('reset').addEventListener('click', () => rig.reset());
$('speed').addEventListener('input', e => { rig.speed = Number(e.target.value); $('speedValue').textContent = rig.speed + ' m/s'; });
for (const id of ['buildings', 'terrain']) $('toggle-' + id).addEventListener('change', e => world.setLayerVisible(id, e.target.checked));
$('compact').addEventListener('click', () => document.body.classList.toggle('hide-sidebar'));
const fmtTime = h => String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0');
function updateTimeLabel() { const i = lighting.info(); $('timeValue').textContent = `${fmtTime(i.hours)} · aurinko ${Math.round(i.elevation)}°`; }
$('time').addEventListener('input', e => { lighting.setTime(Number(e.target.value)); updateTimeLabel(); });
$('day').addEventListener('change', e => { lighting.setTime(lighting.hours, Number(e.target.value)); updateTimeLabel(); });
window.addEventListener('keydown', e => { if (e.code === 'KeyF' && !e.repeat && !/INPUT|SELECT/.test(e.target.tagName)) $('perf').classList.toggle('hidden'); });
$('licLink').addEventListener('click', () => $('lic').classList.remove('hidden'));
$('licClose').addEventListener('click', () => $('lic').classList.add('hidden'));
function updateStats() {
  if (!world.manifest) return;
  const s = world.stats();
  $('stats').textContent = `${s.triangles.toLocaleString('fi-FI')} kolmiota · ${s.textures} tekstuuriatlasta (${s.textureSize}) · noin ${s.textureMB} Mt näytönohjaimen muistia tekstuureille`;
}

// ---------- mittausajo ----------
function benchPoses() {
  const c = world.center, g = world.heightAt(10, 60) ?? 6;
  return [
    { name: 'Karttanäkymä', mode: 'orbit', pos: HOME_VIEW.position.clone(), look: HOME_VIEW.target.clone() },
    { name: 'Yläviisto', mode: 'orbit', pos: new THREE.Vector3(c.x + 70, 75, c.z + 95), look: new THREE.Vector3(c.x, 10, c.z) },
    { name: 'Katutaso', mode: 'fly', pos: new THREE.Vector3(10, g + 1.75, 60), look: new THREE.Vector3(10, g + 6, -60) },
  ];
}
async function benchmark(levels) {
  const out = [];
  const prevQ = quality.id, prevMode = rig.mode, prevPos = rig.camera.position.clone();
  $('benchBtn').disabled = true; $('benchAll').disabled = true;
  for (const lv of levels) {
    applyQuality(lv, false);
    const res = await runBenchmark({ perf, poses: benchPoses(), seconds: Number(params.get('sec')) || 4,
      setPose: p => { rig.setMode(p.mode); rig.setPose(p.pos, p.look); },
      onStep: name => { $('benchOut').textContent = `Mitataan: ${QUALITY_PRESETS[lv].label} · ${name}…`; } });
    for (const r of res) out.push({ quality: QUALITY_PRESETS[lv].label, ...r });
  }
  applyQuality(prevQ, false); rig.setMode(prevMode); if (prevMode !== 'orbit') rig.camera.position.copy(prevPos); else rig.reset();
  $('benchBtn').disabled = false; $('benchAll').disabled = false;
  const ua = navigator.userAgent, gpu = gpuName();
  $('benchOut').innerHTML = '<table><tr><th>Taso</th><th>Näkymä</th><th>FPS</th><th>ms</th><th>p95</th><th>Kutsut</th></tr>' +
    out.map(r => `<tr><td>${r.quality}</td><td>${r.pose}</td><td>${r.fps.toFixed(1)}</td><td>${r.avgMs.toFixed(1)}</td><td>${r.p95.toFixed(1)}</td><td>${r.calls}</td></tr>`).join('') + `</table><div class="meta">${gpu}</div>`;
  window.__H3D_BENCH = { results: out, gpu, ua, pixelRatio: renderer.getPixelRatio(), size: [innerWidth, innerHeight] };
  console.log('Helsinki 3D -mittaus', JSON.stringify(window.__H3D_BENCH));
  return out;
}
function gpuName() {
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
}
$('benchBtn').addEventListener('click', () => benchmark([quality.id]));
$('benchAll').addEventListener('click', () => benchmark(['low', 'medium', 'high']));

// ---------- silmukka ----------
const clock = new THREE.Clock();
let hudT = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.07);
  rig.update(dt);
  games.update(dt);
  lighting.update(dt, rig.camera);
  renderer.render(scene, rig.camera);
  perf.tick();
  if (performance.now() - hudT > 500) {
    hudT = performance.now();
    const s = perf.summary(60);
    if (s) {
      $('fps').textContent = Math.round(s.fps) + ' FPS';
      $('perf').innerHTML = `<b>${s.fps.toFixed(0)} FPS</b> · ${s.avgMs.toFixed(1)} ms · p95 ${s.p95.toFixed(1)} ms<br>${quality.label} · ${s.calls} piirtokutsua · ${(s.triangles / 1000).toFixed(1)}k kolmiota · ${s.textures} tekstuuria`;
    }
    $('altitude').textContent = `Korkeus ${rig.camera.position.y.toFixed(1)} m`;
  }
}

// ---------- käynnistys ----------
async function start() {
  applyQuality(quality.id, false);
  updateTimeLabel();
  frame();
  try {
    await world.load((msg) => { status(msg); $('loadingText').textContent = msg; });
    world.addSurroundings();
    lighting.fitTo(world.bounds);
    applyQuality(quality.id, false);
    status('Valmis – voit tutkia Helsinkiä!');
    $('loading').classList.add('hidden');
    window.__H3D = { renderer, scene, world, lighting, rig, games, perf, benchmark, applyQuality, get quality() { return quality.id; } };
    const b = params.get('bench');
    if (b) setTimeout(() => benchmark(b === 'all' ? ['low', 'medium', 'high'] : [b]), 1500);
  } catch (err) {
    console.error(err);
    status('Lataus epäonnistui: ' + err.message, true);
    $('loading').classList.remove('hidden');
    $('loadingText').textContent = 'Tiedostojen lataus epäonnistui. Avaa sivu HTTP-palvelimen kautta (katso README).';
  }
}
start();
