// Kevyt partikkelijärjestelmä: yksi instanssoitu piirtokutsu per sekoitustila (additiivinen tuli/kipinät,
// alfa savu/pöly). Partikkelit ovat kameraan kääntyviä nelikulmioita, joita voi venyttää nopeuden suuntaan
// (kipinät, valojuovat). Simulointi prosessorilla, ei varjoja eikä syvyyskirjoitusta.
import * as THREE from 'three';
import { particleAtlas } from './textures.js';

const VERT = /* glsl */`
attribute vec3 iPos; attribute vec4 iColor; attribute vec4 iMisc; attribute vec3 iVel;
uniform float uFogNear, uFogFar;
varying vec2 vUv; varying vec4 vColor; varying float vFog;
void main(){
  float size = iMisc.x, rot = iMisc.y, frame = iMisc.z, stretch = iMisc.w;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  vec2 c = position.xy;
  vec2 off;
  if (stretch > 0.0) {
    vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
    vec2 d = vv.xy; float l = length(d);
    d = l > 1e-4 ? d / l : vec2(0.0, 1.0);
    vec2 n = vec2(-d.y, d.x);
    off = n * c.x * size + d * c.y * (size + stretch * min(l, 400.0));
  } else {
    float s = sin(rot), co = cos(rot);
    off = vec2(c.x * co - c.y * s, c.x * s + c.y * co) * size;
  }
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  float col = mod(frame, 4.0), row = floor(frame / 4.0);
  vUv = (uv + vec2(col, 1.0 - row)) * vec2(0.25, 0.5);
  vColor = iColor;
  vColor.a *= smoothstep(0.15, 1.2, -mv.z);              // ei täytä ruutua aivan kameran edessä
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
}`;
const FRAG = /* glsl */`
uniform sampler2D map; uniform vec3 uFogColor; uniform float uAdd;
varying vec2 vUv; varying vec4 vColor; varying float vFog;
void main(){
  vec4 t = texture2D(map, vUv);
  vec4 c = vec4(t.rgb * vColor.rgb, t.a * vColor.a);
  if (uAdd > 0.5) { c.rgb *= c.a * (1.0 - vFog); c.a = 0.0; }
  else c.rgb = mix(c.rgb, uFogColor, vFog);
  if (uAdd < 0.5 && c.a < 0.004) discard;
  gl_FragColor = c;
  #include <colorspace_fragment>
}`;

class Pool {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (name, size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * size), size); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.aPos = mk('iPos', 3); this.aCol = mk('iColor', 4); this.aMisc = mk('iMisc', 4); this.aVel = mk('iVel', 3);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
      uniforms: { map: { value: particleAtlas() }, uFogColor: { value: new THREE.Color() }, uFogNear: { value: 400 }, uFogFar: { value: 3000 }, uAdd: { value: additive ? 1 : 0 } },
    });
    if (!additive) { this.mat.blending = THREE.CustomBlending; this.mat.blendSrc = THREE.SrcAlphaFactor; this.mat.blendDst = THREE.OneMinusSrcAlphaFactor; }
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 11 : 10;
    scene.add(this.mesh);
    // simulointitila (rakenne taulukoina)
    const F = n => new Float32Array(max * n);
    this.p = F(3); this.v = F(3); this.age = F(1); this.life = F(1); this.s0 = F(1); this.s1 = F(1); this.rot = F(1); this.rv = F(1);
    this.drag = F(1); this.grav = F(1); this.c0 = F(4); this.c1 = F(4); this.frame = F(1); this.stretch = F(1); this.fadeIn = F(1); this.bounce = F(1);
  }
  emit(o) {
    if (this.n >= this.max) return;
    const i = this.n++, i3 = i * 3, i4 = i * 4;
    this.p[i3] = o.p[0]; this.p[i3 + 1] = o.p[1]; this.p[i3 + 2] = o.p[2];
    const v = o.v || [0, 0, 0]; this.v[i3] = v[0]; this.v[i3 + 1] = v[1]; this.v[i3 + 2] = v[2];
    this.age[i] = 0; this.life[i] = o.life || 1; this.s0[i] = o.size || 1; this.s1[i] = o.size1 ?? this.s0[i];
    this.rot[i] = o.rot ?? Math.random() * 6.283; this.rv[i] = o.rotV ?? 0; this.drag[i] = o.drag ?? 0; this.grav[i] = o.g ?? 0;
    const c = o.color || [1, 1, 1], c1 = o.color1 || c;
    this.c0[i4] = c[0]; this.c0[i4 + 1] = c[1]; this.c0[i4 + 2] = c[2]; this.c0[i4 + 3] = o.alpha ?? 1;
    this.c1[i4] = c1[0]; this.c1[i4 + 1] = c1[1]; this.c1[i4 + 2] = c1[2]; this.c1[i4 + 3] = o.alpha1 ?? 0;
    this.frame[i] = o.frame || 0; this.stretch[i] = o.stretch || 0; this.fadeIn[i] = o.fadeIn ?? 0.05; this.bounce[i] = o.bounce ?? -1;
  }
  kill(i) {   // siirretään viimeinen tilalle
    const j = --this.n; if (i === j) return;
    const cp = (arr, k) => { for (let q = 0; q < k; q++) arr[i * k + q] = arr[j * k + q]; };
    cp(this.p, 3); cp(this.v, 3); cp(this.c0, 4); cp(this.c1, 4);
    for (const a of [this.age, this.life, this.s0, this.s1, this.rot, this.rv, this.drag, this.grav, this.frame, this.stretch, this.fadeIn, this.bounce]) a[i] = a[j];
  }
  update(dt, ground, fog) {
    const P = this.aPos.array, C = this.aCol.array, M = this.aMisc.array, V = this.aVel.array;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.kill(i); i--; continue; }
      const i3 = i * 3, i4 = i * 4, t = this.age[i] / this.life[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.v[i3] *= d; this.v[i3 + 1] = this.v[i3 + 1] * d + this.grav[i] * dt; this.v[i3 + 2] *= d;
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
      if (this.bounce[i] >= 0 && ground) {
        const gy = ground(this.p[i3], this.p[i3 + 2]);
        if (gy !== null && this.p[i3 + 1] < gy) { this.p[i3 + 1] = gy; this.v[i3 + 1] = -this.v[i3 + 1] * this.bounce[i]; this.v[i3] *= 0.6; this.v[i3 + 2] *= 0.6; }
      }
      this.rot[i] += this.rv[i] * dt;
      const fi = this.fadeIn[i] > 0 ? Math.min(1, t / this.fadeIn[i]) : 1;
      P[i3] = this.p[i3]; P[i3 + 1] = this.p[i3 + 1]; P[i3 + 2] = this.p[i3 + 2];
      V[i3] = this.v[i3]; V[i3 + 1] = this.v[i3 + 1]; V[i3 + 2] = this.v[i3 + 2];
      for (let k = 0; k < 3; k++) C[i4 + k] = this.c0[i4 + k] + (this.c1[i4 + k] - this.c0[i4 + k]) * t;
      C[i4 + 3] = (this.c0[i4 + 3] + (this.c1[i4 + 3] - this.c0[i4 + 3]) * t) * fi;
      const st = Math.sqrt(t);
      M[i4] = this.s0[i] + (this.s1[i] - this.s0[i]) * st; M[i4 + 1] = this.rot[i]; M[i4 + 2] = this.frame[i]; M[i4 + 3] = this.stretch[i];
    }
    const g = this.mesh.geometry; g.instanceCount = this.n;
    for (const a of [this.aPos, this.aCol, this.aMisc, this.aVel]) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * a.itemSize); a.needsUpdate = true; }
    if (fog) { this.mat.uniforms.uFogColor.value.copy(fog.color); this.mat.uniforms.uFogNear.value = fog.near; this.mat.uniforms.uFogFar.value = fog.far; }
  }
}

export class Particles {
  constructor(scene, { ground = null, maxAlpha = 2500, maxAdd = 2500 } = {}) {
    this.scene = scene; this.ground = ground;
    this.alpha = new Pool(scene, maxAlpha, false);
    this.add = new Pool(scene, maxAdd, true);
  }
  emit(o) { (o.additive ? this.add : this.alpha).emit(o); }
  update(dt) { this.alpha.update(dt, this.ground, this.scene.fog); this.add.update(dt, this.ground, this.scene.fog); }
  get count() { return this.alpha.n + this.add.n; }
}
