// Törmäys- ja osumageometria kaupunkimallista. Käyttää samoja GLB-meshejä kuin piirto (ei kopioita, ei muutoksia
// geometriaan): jokaiselle meshille rakennetaan BVH-hakupuu (three-mesh-bvh), joka nopeuttaa säteitä ja
// kapselitörmäyksiä. Piirto ei muutu – BVH vain järjestää indeksipuskurin uudelleen.
import * as THREE from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const _ray = new THREE.Raycaster(), _hits = [];
const _box = new THREE.Box3(), _seg = new THREE.Line3(), _tp = new THREE.Vector3(), _cp = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

export class WorldCollider {
  constructor(world) {
    this.world = world;
    this.meshes = [];
    const t0 = performance.now();
    for (const [kind, layer] of Object.entries(world.layers)) {
      layer.traverse(o => {
        if (!o.isMesh) return;
        o.geometry.computeBoundsTree({ targetLeafSize: 8 });
        o.updateMatrixWorld(true);
        this.meshes.push({ mesh: o, kind, inv: o.matrixWorld.clone().invert(), mw: o.matrixWorld });
      });
    }
    this.buildMs = performance.now() - t0;
    _ray.firstHitOnly = true;
    this.b = world.bounds;
  }

  // lähin osuma maailmaan: { point, normal (kohti ampujaa), dist, kind, mesh } tai null
  raycast(origin, dir, far = 400) {
    _ray.set(origin, dir); _ray.near = 0; _ray.far = far;
    let best = null;
    for (const m of this.meshes) {
      _hits.length = 0;
      m.mesh.raycast(_ray, _hits);
      const h = _hits[0];
      if (h && (!best || h.distance < best.dist)) {
        const n = h.face ? h.face.normal.clone().applyMatrix3(_m3.getNormalMatrix(m.mw)).normalize() : new THREE.Vector3(0, 1, 0);
        if (n.dot(dir) > 0) n.negate();                    // kaksipuoliset pinnat: normaali ampujaa kohti
        best = { point: h.point.clone(), normal: n, dist: h.distance, kind: m.kind, mesh: m.mesh };
      }
    }
    return best;
  }

  // Kapseli (pystysuora jana + säde) työnnetään ulos kolmioista. Palauttaa siirtymän, jolla jana liikkui.
  // Perustuu three-mesh-bvh:n hahmoliike-esimerkkiin.
  collideCapsule(start, end, radius, out = new THREE.Vector3()) {
    const s0 = start.clone();
    for (let iter = 0; iter < 2; iter++) {
      for (const m of this.meshes) {
        _seg.start.copy(start).applyMatrix4(m.inv); _seg.end.copy(end).applyMatrix4(m.inv);
        _box.makeEmpty(); _box.expandByPoint(_seg.start); _box.expandByPoint(_seg.end);
        _box.min.addScalar(-radius); _box.max.addScalar(radius);
        let moved = false;
        m.mesh.geometry.boundsTree.shapecast({
          intersectsBounds: b => b.intersectsBox(_box),
          intersectsTriangle: tri => {
            const dist = tri.closestPointToSegment(_seg, _tp, _cp);
            if (dist < radius) {
              const depth = radius - dist;
              if (dist > 1e-6) _d.subVectors(_cp, _tp).divideScalar(dist);
              else { tri.getNormal(_n); _d.copy(_n); if (_d.y < 0) _d.negate(); }
              _seg.start.addScaledVector(_d, depth); _seg.end.addScaledVector(_d, depth);
              moved = true;
            }
          },
        });
        if (moved) { start.copy(_seg.start).applyMatrix4(m.mw); end.copy(_seg.end).applyMatrix4(m.mw); }
      }
    }
    return out.subVectors(start, s0);
  }

  // onko näköyhteys kahden pisteen välillä (esim. auringon varjo asekuvalle)
  clear(a, b) {
    _d.subVectors(b, a); const l = _d.length(); if (l < 1e-4) return true;
    return !this.raycast(a, _d.divideScalar(l), l);
  }
}
