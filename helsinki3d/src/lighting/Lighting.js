// Valaistus: fysikaalinen taivas, aurinko oikeassa paikassa Helsingin yllä valitulla kellonajalla,
// taivaasta laskettu ympäristövalo (IBL), ilmaperspektiivi (sumu) ja rakennusten varjot.
// Ei tiedä mitään peleistä eikä kamerasta; maailma antaa vain rajat varjokameraa varten.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const LAT = 60.17, LON = 24.95;            // Helsinki
const D2R = Math.PI / 180;

// Auringon korkeus- ja atsimuuttikulma (asteina, atsimuutti pohjoisesta myötäpäivään)
export function sunPosition(dayOfYear, localHours) {
  const dst = dayOfYear >= 87 && dayOfYear < 300;             // kesäaika noin maalis–lokakuu
  const tz = dst ? 3 : 2;
  const decl = 23.44 * Math.sin(2 * Math.PI * (284 + dayOfYear) / 365) * D2R;
  const B = 2 * Math.PI * (dayOfYear - 81) / 364;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const solar = localHours + (4 * (LON - 15 * tz) + eot) / 60;
  const H = 15 * (solar - 12) * D2R, phi = LAT * D2R;
  const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(sinEl);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + Math.PI;
  return { elevation: el / D2R, azimuth: ((az / D2R) % 360 + 360) % 360 };
}

export class Lighting {
  constructor(renderer, scene) {
    this.renderer = renderer; this.scene = scene;
    this.center = new THREE.Vector3(); this.radius = 300;
    this.day = 258; this.hours = 13.5;           // oletus: syyskuun puoliväli, iltapäivä
    this.envEnabled = true; this.envDirty = true; this.envTimer = 0;

    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    this.sky.name = 'sky';
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3.2; u.rayleigh.value = 1.15; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);
    // kevyt taivas Low-tasolle: pallo, jonka kärkivärit lasketaan auringon korkeudesta (ei raskasta varjostinta)
    const lg = new THREE.SphereGeometry(4000, 32, 24);
    lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(lg.attributes.position.count * 3), 3));
    this.liteSky = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
    this.liteSky.name = 'lite-sky'; this.liteSky.visible = false; this.liteSky.renderOrder = -2;
    scene.add(this.liteSky);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.name = 'sun';
    this.sun.shadow.bias = -0.0003;
    scene.add(this.sun); scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xdcebf7, 0x8b8775, 0.55);
    scene.add(this.hemi);

    scene.fog = new THREE.Fog(0xbfd4e2, 350, 2200);
    scene.background = null;                     // taivas piirtää taustan
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky(); this.envSky.scale.setScalar(1000); this.envScene.add(this.envSky);
    this.envRT = null;
    this.sunDir = new THREE.Vector3();
    this.update(0);
  }

  // maailman rajat varjokameraa varten
  fitTo(box) {
    const s = box.getBoundingSphere(new THREE.Sphere());
    this.center.copy(s.center); this.radius = s.radius;
    this.placeSun();
  }

  setTime(hours, dayOfYear = this.day) { this.hours = hours; this.day = dayOfYear; this.envDirty = true; this.placeSun(); }

  placeSun() {
    const { elevation, azimuth } = sunPosition(this.day, this.hours);
    this.elevation = elevation; this.azimuth = azimuth;
    const el = Math.max(elevation, -2) * D2R, az = azimuth * D2R;
    // pelin koordinaatit: x = itä, y = ylös, z = etelä (−pohjoinen)
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    for (const s of [this.sky, this.envSky]) s.material.uniforms.sunPosition.value.copy(this.sunDir);

    // värit ja voimakkuus auringon korkeuden mukaan: matalalla lämmin ja himmeä, korkealla neutraali
    const t = THREE.MathUtils.clamp(elevation / 35, 0, 1), low = THREE.MathUtils.clamp(elevation / 8, 0, 1);
    this.sun.color.setRGB(1.0, 0.80 + 0.17 * t, 0.62 + 0.30 * t);
    this.sun.intensity = 2.3 * low * (0.6 + 0.4 * t);
    this.hemi.intensity = (this.envEnabled ? 0.3 : 1.1) * (0.7 + 0.3 * low);
    this.hemi.color.setRGB(0.80 + 0.06 * t, 0.86 + 0.06 * t, 0.94);
    const fog = new THREE.Color().setRGB(0.64 + 0.05 * (1 - t), 0.72 + 0.03 * t, 0.82 + 0.03 * t);
    if (elevation < 6) fog.lerp(new THREE.Color(0.86, 0.66, 0.52), 1 - low);
    this.scene.fog.color.copy(fog);
    this.paintLiteSky(fog, t, low);
    this.renderer.toneMappingExposure = 0.82 + 0.4 * (1 - low);
    this.envIntensity = 0.5 * (0.75 + 0.25 * low);
    if (this.scene.environment) this.scene.environmentIntensity = this.envIntensity;

    // varjokamera kattaa koko kaupunkialueen
    const r = this.radius;
    this.sun.target.position.copy(this.center);
    this.sun.position.copy(this.center).addScaledVector(this.sunDir, r * 1.5);
    const cam = this.sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = r * 0.3; cam.far = r * 3.2;
    cam.updateProjectionMatrix();
    this.updateBias();
  }

  paintLiteSky(fog, t, low) {
    const pos = this.liteSky.geometry.attributes.position, col = this.liteSky.geometry.attributes.color;
    const zenith = new THREE.Color().setRGB(0.22 + 0.1 * (1 - low), 0.42 + 0.08 * t, 0.78 + 0.06 * t);
    const horizon = fog.clone().lerp(new THREE.Color(1, 1, 1), 0.15);
    const ground = new THREE.Color().setRGB(0.34, 0.39, 0.30).lerp(fog, 0.2);
    const c = new THREE.Color(), v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const e = v.y;
      if (e >= 0) c.copy(horizon).lerp(zenith, Math.pow(e, 0.55));
      else c.copy(horizon).lerp(ground, Math.min(1, -e * 12));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  updateBias() {
    const size = this.sun.shadow.mapSize.x || 2048;
    const texel = (2 * this.radius) / size;                    // metriä per varjokartan pikseli
    this.sun.shadow.normalBias = texel * 0.9;
  }

  setQuality(q) {
    this.sun.castShadow = q.shadows;
    if (q.shadows && this.sun.shadow.mapSize.x !== q.shadowMapSize) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.sun.shadow.radius = q.shadowMapSize >= 4096 ? 2 : 1;
    this.updateBias();
    this.sky.visible = q.sky === 'physical'; this.liteSky.visible = q.sky === 'lite';
    this.envEnabled = q.environment;
    if (!q.environment) { this.scene.environment = null; } else this.envDirty = true;
    this.scene.fog.near = q.fogNear; this.scene.fog.far = q.fogFar;
    this.placeSun();
  }

  // ympäristövalo lasketaan uudelleen vain kun kellonaika muuttuu (viiveellä, ei joka ruudussa)
  update(dt, camera) {
    if (camera && this.liteSky.visible) this.liteSky.position.copy(camera.position);
    if (!this.envEnabled || !this.envDirty) return;
    this.envTimer -= dt;
    if (this.envTimer > 0) return;
    this.envTimer = 0.2; this.envDirty = false;
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 3000);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = this.envIntensity ?? 0.5;
  }

  info() { return { elevation: this.elevation, azimuth: this.azimuth, hours: this.hours, day: this.day }; }
}
