// Pysyvät jäljet: kraatterit maahan, palo- ja lohkeamajäljet rakennusten seiniin ja kattoihin sekä irtokivet.
// Alkuperäistä mallia ei muuteta: jäljet ovat omia, mallin pintaan sovitettuja verkkojaan.
//  - maakraatteri: pieni ruudukko, joka seuraa maaston korkeutta ja jonka reunavalli kohoaa
//  - seinäjälki: DecalGeometry osuman saaneesta rakennusmeshistä (projisoitu tarra)
//  - irtokivet: yksi instanssoitu mesh
// Kaikki jäljet kootaan muutamaan yhteiseen puskuriin (3 piirtokutsua yhteensä, vaikka jälkiä olisi satoja).
// Ulkoasu lasketaan palvelimen antamasta siemenluvusta, joten jokainen pelaaja näkee täsmälleen saman jäljen.
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { craterAtlas, scorchAtlas, rng } from './textures.js';

const N = 16;                                   // kraatteriruudukko N × N
const CRATER_R = { rocket: 2.3, grenade: 1.6 };   // kuopan säde (m)
const MAX_CRATERS = 420, MAX_DECAL_VERTS = 150000, MAX_RUBBLE = 7000;

export class Marks {
  constructor(scene, world, collider) {
    this.scene = scene; this.world = world; this.collider = collider;
    this.count = 0; this.list = [];
    // maakraatterit
    const vpc = (N + 1) * (N + 1);
    const g = new THREE.BufferGeometry();
    this.cPos = new THREE.BufferAttribute(new Float32Array(MAX_CRATERS * vpc * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.cNor = new THREE.BufferAttribute(new Float32Array(MAX_CRATERS * vpc * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.cUv = new THREE.BufferAttribute(new Float32Array(MAX_CRATERS * vpc * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.cPos); g.setAttribute('normal', this.cNor); g.setAttribute('uv', this.cUv);
    const idx = new Uint32Array(MAX_CRATERS * N * N * 6);
    for (let c = 0, k = 0; c < MAX_CRATERS; c++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = c * vpc + j * (N + 1) + i, b = a + 1, d = a + (N + 1), e = d + 1;
      idx[k++] = a; idx[k++] = d; idx[k++] = b; idx[k++] = b; idx[k++] = d; idx[k++] = e;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.setDrawRange(0, 0);
    const ca = craterAtlas();
    this.craterMat = new THREE.MeshStandardMaterial({ map: ca.map, bumpMap: ca.bump, bumpScale: 4, transparent: true, depthWrite: false, roughness: 1, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.craters = new THREE.Mesh(g, this.craterMat); this.craters.receiveShadow = true; this.craters.frustumCulled = false; this.craters.renderOrder = 1;
    this.craters.name = 'marks-craters'; scene.add(this.craters);
    this.nCraters = 0;
    // seinä- ja kattojäljet
    const dg = new THREE.BufferGeometry();
    this.dPos = new THREE.BufferAttribute(new Float32Array(MAX_DECAL_VERTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.dNor = new THREE.BufferAttribute(new Float32Array(MAX_DECAL_VERTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.dUv = new THREE.BufferAttribute(new Float32Array(MAX_DECAL_VERTS * 2), 2).setUsage(THREE.DynamicDrawUsage);
    dg.setAttribute('position', this.dPos); dg.setAttribute('normal', this.dNor); dg.setAttribute('uv', this.dUv); dg.setDrawRange(0, 0);
    const sa = scorchAtlas();
    this.decalMat = new THREE.MeshStandardMaterial({ map: sa.map, bumpMap: sa.bump, bumpScale: 3, transparent: true, depthWrite: false, roughness: 1, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.decals = new THREE.Mesh(dg, this.decalMat); this.decals.receiveShadow = true; this.decals.frustumCulled = false; this.decals.renderOrder = 1;
    this.decals.name = 'marks-walls'; scene.add(this.decals);
    this.nDecalVerts = 0;
    // irtokivet
    const rg = new THREE.IcosahedronGeometry(1, 0);
    this.rubble = new THREE.InstancedMesh(rg, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), MAX_RUBBLE);
    this.rubble.count = 0; this.rubble.castShadow = true; this.rubble.receiveShadow = true; this.rubble.frustumCulled = false; this.rubble.name = 'marks-rubble';
    this.rubble.setColorAt(0, new THREE.Color()); scene.add(this.rubble);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._c = new THREE.Color();
  }

  clear() {
    this.nCraters = 0; this.craters.geometry.setDrawRange(0, 0);
    this.nDecalVerts = 0; this.decals.geometry.setDrawRange(0, 0);
    this.rubble.count = 0; this.list = []; this.count = 0;
  }

  // mark = { k: 'rocket'|'grenade', p: [x,y,z], n: [x,y,z], seed, wall }
  add(mark) {
    const r = rng(mark.seed), p = new THREE.Vector3().fromArray(mark.p), n = new THREE.Vector3().fromArray(mark.n).normalize();
    const R = CRATER_R[mark.k] || 1.6;
    this.list.push(mark); this.count++;
    const ground = this.world.heightAt(p.x, p.z);
    const nearGround = ground !== null && p.y - ground < 1.2;
    if (mark.wall && !(n.y > 0.85 && nearGround)) {
      this.addDecal(p, n, R * (mark.k === 'rocket' ? 1.25 : 1.05), r);
      // seinästä irronnut rappaus ja kivet putoavat seinän juurelle
      const foot = p.clone().addScaledVector(new THREE.Vector3(n.x, 0, n.z).normalize(), 0.8);
      const fy = this.world.heightAt(foot.x, foot.z);
      if (fy !== null && p.y - fy < 14) this.addRubble(foot.setY(fy), R * 0.7, mark.k === 'rocket' ? 14 : 8, r, true);
      if (nearGround && n.y < 0.5) this.addCrater(foot.setY(fy ?? p.y), R * 0.75, r);
    } else if (nearGround) {
      this.addCrater(p, R, r);
      this.addRubble(p, R, mark.k === 'rocket' ? 16 : 11, r, false);
    } else {
      this.addDecal(p, n, R, r);
    }
  }

  addCrater(p, R, r) {
    if (this.nCraters >= MAX_CRATERS) return;
    const c = this.nCraters++, vpc = (N + 1) * (N + 1), base = c * vpc;
    const half = R / 0.6;                                     // tekstuurissa kuoppa on 60 % puolikkaasta
    const rot = r() * Math.PI * 2, cs = Math.cos(rot), sn = Math.sin(rot);
    const variant = Math.floor(r() * 4), u0 = (variant % 2) * 0.5, v0 = variant < 2 ? 0.5 : 0;
    const rimH = R * 0.085, P = this.cPos.array, U = this.cUv.array, H = new Float32Array(vpc);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const lx = (i / N * 2 - 1) * half, lz = (j / N * 2 - 1) * half;
      const x = p.x + lx * cs - lz * sn, z = p.z + lx * sn + lz * cs;
      const g = this.world.heightAt(x, z) ?? p.y;
      const d = Math.hypot(lx, lz) / R;
      const rim = rimH * Math.exp(-Math.pow((d - 0.98) / 0.22, 2)) * (0.8 + 0.4 * r());
      const y = g + 0.04 + rim, k = base + j * (N + 1) + i;
      H[j * (N + 1) + i] = y;
      P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z;
      U[k * 2] = u0 + (i / N) * 0.5; U[k * 2 + 1] = v0 + (1 - j / N) * 0.5;
    }
    // normaalit korkeuseroista
    const Nn = this.cNor.array, step = 2 * half / N;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const h = (ii, jj) => H[Math.min(N, Math.max(0, jj)) * (N + 1) + Math.min(N, Math.max(0, ii))];
      const dx = (h(i + 1, j) - h(i - 1, j)) / (2 * step), dz = (h(i, j + 1) - h(i, j - 1)) / (2 * step);
      const lx = -dx, lz = -dz;                                // paikallinen normaali (lx, 1, lz), käännetään maailmaan
      this._v.set(lx * cs - lz * sn, 1, lx * sn + lz * cs).normalize();
      const k = base + j * (N + 1) + i; Nn[k * 3] = this._v.x; Nn[k * 3 + 1] = this._v.y; Nn[k * 3 + 2] = this._v.z;
    }
    for (const a of [this.cPos, this.cNor, this.cUv]) { a.addUpdateRange(base * a.itemSize, vpc * a.itemSize); a.needsUpdate = true; }
    this.craters.geometry.setDrawRange(0, this.nCraters * N * N * 6);
  }

  addDecal(p, n, R, r) {
    const hit = this.collider.raycast(p.clone().addScaledVector(n, 0.6), n.clone().negate(), 2.5);
    if (!hit || hit.kind !== 'buildings') return;
    this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    this._q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), r() * Math.PI * 2));
    const e = new THREE.Euler().setFromQuaternion(this._q);
    const size = new THREE.Vector3(R * 2, R * 2, R * 1.6);
    let geo;
    try { geo = new DecalGeometry(hit.mesh, hit.point, e, size); } catch (err) { return; }
    const cnt = geo.attributes.position.count;
    if (!cnt || this.nDecalVerts + cnt > MAX_DECAL_VERTS) { geo.dispose(); return; }
    const variant = Math.floor(r() * 4), u0 = (variant % 2) * 0.5, v0 = variant < 2 ? 0.5 : 0;
    const o = this.nDecalVerts;
    this.dPos.array.set(geo.attributes.position.array, o * 3);
    this.dNor.array.set(geo.attributes.normal.array, o * 3);
    const uv = geo.attributes.uv.array, U = this.dUv.array;
    for (let i = 0; i < cnt; i++) { U[(o + i) * 2] = u0 + uv[i * 2] * 0.5; U[(o + i) * 2 + 1] = v0 + uv[i * 2 + 1] * 0.5; }
    // pieni siirto normaalin suuntaan estää välkkymisen
    const P = this.dPos.array, Nn = this.dNor.array;
    for (let i = o; i < o + cnt; i++) { P[i * 3] += Nn[i * 3] * 0.015; P[i * 3 + 1] += Nn[i * 3 + 1] * 0.015; P[i * 3 + 2] += Nn[i * 3 + 2] * 0.015; }
    for (const a of [this.dPos, this.dNor, this.dUv]) { a.addUpdateRange(o * a.itemSize, cnt * a.itemSize); a.needsUpdate = true; }
    this.nDecalVerts += cnt; this.decals.geometry.setDrawRange(0, this.nDecalVerts);
    geo.dispose();
  }

  addRubble(p, R, count, r, plaster) {
    for (let i = 0; i < count && this.rubble.count < MAX_RUBBLE; i++) {
      const a = r() * Math.PI * 2, d = R * (plaster ? r() * 1.1 : 0.75 + r() * 0.7);
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d, g = this.world.heightAt(x, z);
      if (g === null || this.world.isBuilding(x, z)) continue;
      const s = (plaster ? 0.06 : 0.07) + r() * (plaster ? 0.14 : 0.16);
      this._s.set(s * (0.7 + r() * 0.8), s * (0.4 + r() * 0.4), s * (0.7 + r() * 0.8));
      this._q.setFromEuler(new THREE.Euler(r() * 6, r() * 6, r() * 6));
      this._v.set(x, g + this._s.y * 0.5, z);
      this._m.compose(this._v, this._q, this._s);
      const i2 = this.rubble.count++;
      this.rubble.setMatrixAt(i2, this._m);
      const v = 0.32 + r() * 0.25;
      if (plaster) this._c.setRGB(v * 1.5, v * 1.35, v * 1.2); else this._c.setRGB(v * 1.05, v * 0.95, v * 0.82);
      this.rubble.setColorAt(i2, this._c);
    }
    this.rubble.instanceMatrix.needsUpdate = true; if (this.rubble.instanceColor) this.rubble.instanceColor.needsUpdate = true;
  }
}
