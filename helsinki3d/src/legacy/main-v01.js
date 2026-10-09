import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;
renderer.shadowMap.enabled = false;
$('viewport').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc6dce9);
scene.fog = new THREE.Fog(0xc6dce9, 350, 1800);
scene.add(new THREE.HemisphereLight(0xe6f5ff, 0x9b9a83, 2.05));
scene.add(new THREE.AmbientLight(0xffffff, .35));
const sun = new THREE.DirectionalLight(0xfff4df, 2.15);
sun.position.set(-220, 450, 220);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(61, window.innerWidth / window.innerHeight, .08, 4000);
camera.position.set(245, 205, 260);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 8, 0);
controls.enableDamping = true;
controls.dampingFactor = .07;
controls.minDistance = 5;
controls.maxDistance = 1800;
controls.maxPolarAngle = Math.PI * .495;
controls.update();
const loader = new GLTFLoader();
const clock = new THREE.Clock();
const state = { mode: 'orbit', loaded: false, terrain: null, buildings: null, speed: 45, yaw: 0, pitch: 0, key: new Set(), manifest: null, frame: 0, frameTime: 0 };
const ray = new THREE.Raycaster();
ray.far = 500;
const down = new THREE.Vector3(0,-1,0);
const tempForward = new THREE.Vector3();
const tempRight = new THREE.Vector3();
const UP = new THREE.Vector3(0,1,0);

function status(message, isError=false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', isError);
}
function setMode(next) {
  state.mode = next;
  controls.enabled = next === 'orbit';
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === next));
  const fps = next !== 'orbit';
  $('crosshair').classList.toggle('visible', fps);
  $('help').textContent = next === 'orbit'
    ? 'Hiiri: pyöritä · rulla: zoomaa · oikea: siirrä näkymää'
    : 'Klikkaa 3D-näkymää hiiren lukitsemiseksi · WASD: liiku · Shift: nopeuta · Q/E: alas/ylös · Esc: vapauta hiiri';
  if (next === 'walk') {
    const h = terrainHeight(camera.position.x,camera.position.z);
    camera.position.y = h===null? 9 : h+1.75;
  }
  if (fps) {
    const direction = new THREE.Vector3(); camera.getWorldDirection(direction);
    state.yaw = Math.atan2(-direction.x,-direction.z);
    state.pitch = Math.asin(Math.max(-1, Math.min(1, direction.y)));
  }
  if (document.pointerLockElement === renderer.domElement && next==='orbit') document.exitPointerLock();
}
function terrainHeight(x,z) {
  if (!state.terrain) return null;
  ray.set(new THREE.Vector3(x, 350, z), down);
  const hits = ray.intersectObject(state.terrain, true);
  return hits.length ? hits[0].point.y : null;
}
function updateFirstPerson(dt) {
  const direction = new THREE.Vector3(
    -Math.sin(state.yaw)*Math.cos(state.pitch),
    Math.sin(state.pitch),
    -Math.cos(state.yaw)*Math.cos(state.pitch)
  );
  camera.lookAt(camera.position.clone().add(direction));
  tempForward.set(-Math.sin(state.yaw),0,-Math.cos(state.yaw));
  tempRight.crossVectors(tempForward,UP).normalize();
  const move = new THREE.Vector3();
  if(state.key.has('KeyW') || state.key.has('ArrowUp')) move.add(tempForward);
  if(state.key.has('KeyS') || state.key.has('ArrowDown')) move.sub(tempForward);
  if(state.key.has('KeyD') || state.key.has('ArrowRight')) move.add(tempRight);
  if(state.key.has('KeyA') || state.key.has('ArrowLeft')) move.sub(tempRight);
  let rate = state.speed * (state.key.has('ShiftLeft') || state.key.has('ShiftRight') ? 3 : 1);
  if (state.mode==='walk') rate = Math.min(rate,8) * (state.key.has('ShiftLeft')?1.8:1);
  if (move.lengthSq()) camera.position.addScaledVector(move.normalize(),dt*rate);
  if(state.mode==='fly') {
    if (state.key.has('KeyE') || state.key.has('Space')) camera.position.y+=dt*rate;
    if (state.key.has('KeyQ') || state.key.has('ControlLeft')) camera.position.y-=dt*rate;
  } else {
    const ground = terrainHeight(camera.position.x,camera.position.z);
    if(ground!==null) camera.position.y = THREE.MathUtils.lerp(camera.position.y,ground+1.75,Math.min(1,dt*12));
  }
}
function onResize() {
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);
}
window.addEventListener('resize', onResize);
window.addEventListener('keydown',e=>{
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code) && state.mode!=='orbit')e.preventDefault();
  state.key.add(e.code);
  if(e.code==='Digit1')setMode('orbit');
  if(e.code==='Digit2')setMode('fly');
  if(e.code==='Digit3')setMode('walk');
});
window.addEventListener('keyup',e=>state.key.delete(e.code));
renderer.domElement.addEventListener('click',()=>{
 if(state.mode!=='orbit' && document.pointerLockElement!==renderer.domElement){
  renderer.domElement.requestPointerLock?.();
 }
});
document.addEventListener('mousemove',e=>{
 if(document.pointerLockElement!==renderer.domElement||state.mode==='orbit')return;
 state.yaw -= e.movementX*.0021;
 state.pitch=Math.max(-Math.PI/2+.045,Math.min(Math.PI/2-.045,state.pitch-e.movementY*.0021));
});
for(const button of document.querySelectorAll('[data-mode]'))button.addEventListener('click',()=>setMode(button.dataset.mode));
$('reset').addEventListener('click',()=>{
 setMode('orbit');camera.position.set(245,205,260);controls.target.set(0,8,0);controls.update();
});
$('speed').addEventListener('input',e=>{state.speed=Number(e.target.value);$('speedValue').textContent=state.speed+' m/s';});
for(const id of ['buildings','terrain']) {
 $('toggle-'+id).addEventListener('change',e=>{if(state[id])state[id].visible=e.target.checked;});
}
$('compact').addEventListener('click',()=>document.body.classList.toggle('hide-sidebar'));

function animate() {
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.07);
  if(state.mode==='orbit')controls.update();else updateFirstPerson(dt);
  renderer.render(scene,camera);
  state.frameTime+=dt;state.frame++;
  if(state.frameTime>.55){
    $('fps').textContent=Math.round(state.frame/state.frameTime)+' FPS';
    $('altitude').textContent=`Korkeus ${camera.position.y.toFixed(1)} m`;
    state.frame=0;state.frameTime=0;
  }
}
animate();

async function loadScene(){
 try{
  status('Luetaan maailman tiedot…');
  const resp = await fetch('world/world-manifest.json');
  if (!resp.ok) throw new Error(`world-manifest.json: HTTP ${resp.status}`);
  state.manifest=await resp.json();
  $('stats').textContent=`${state.manifest.layers.buildings.triangles.toLocaleString('fi-FI')} rakennuskolmiota · ${state.manifest.layers.terrain.triangles.toLocaleString('fi-FI')} maastokolmiota`;
  let i=0;
  for (const [name, title] of [['terrain','Maasto ja ortoilmakuva'],['buildings','LoD2-rakennukset']]) {
    status(`Ladataan ${title.toLowerCase()} (${i+1}/2)…`);
    const gltf=await loader.loadAsync('world/'+state.manifest.layers[name].file);
    state[name]=gltf.scene;
    // Geo-referenced world coordinates have already been translated in the GLB conversion.
    scene.add(state[name]);
    i++;
  }
  state.loaded=true;
  status('Valmis – voit tutkia Helsinkiä!');
  $('loading').classList.add('hidden');
 }catch(err){
  console.error(err);
  status('Lataus epäonnistui: '+err.message,true);
  $('loading').classList.remove('hidden');
  $('loadingText').textContent='Tiedostojen lataus epäonnistui. Avaa sivu paikallisen HTTP-palvelimen kautta (katso README).';
 }
}
loadScene();
