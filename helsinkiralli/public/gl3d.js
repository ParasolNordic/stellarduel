// Helsinkiralli - WebGL-piirto syvyyspuskurilla.
// Rakennukset: Helsingin LoD2-mallin kolmiot (tumma täyttö) + mallin viivat; maa: 4 m korkeusruudukko.
// Kamera ja projektio vastaavat client.js:n V-näkymää, joten HUD:n 2D-projektiot osuvat samaan kohtaan.
(function (root) {
'use strict';
const VS = `
attribute vec3 aPos; attribute vec4 aCol; attribute float aSize;
uniform vec3 uC, uR, uU, uF; uniform vec4 uP; uniform vec2 uZ; uniform vec2 uFog; uniform float uFocal;
varying vec4 vCol; varying float vFog;
void main(){
  vec3 d = aPos - uC; float x = dot(d, uR), y = dot(d, uU), z = dot(d, uF);
  gl_Position = vec4(uP.x * x + uP.y * z, uP.z * y + uP.w * z, uZ.x * z + uZ.y, z);
  vCol = aCol; vFog = smoothstep(uFog.x, uFog.y, z);
  gl_PointSize = clamp(aSize * uFocal / max(z, 0.5), 1.0, 96.0);
}`;
const FS = `
precision mediump float;
uniform vec3 uFogC; uniform float uRound;
varying vec4 vCol; varying float vFog;
void main(){
  float a = vCol.a;
  if (uRound > 0.5) { vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q); if (r > 1.0) discard; a *= (uRound > 1.5 ? (1.0 - r) * 0.55 : 1.0); }
  gl_FragColor = vec4(mix(vCol.rgb, uFogC, vFog), a * (1.0 - vFog * 0.15));
}`;

function create(canvas, mesh, city, H) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false, depth: true });
  if (!gl) return null;
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(o)); return o; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const A = { pos: gl.getAttribLocation(prog, 'aPos'), col: gl.getAttribLocation(prog, 'aCol'), size: gl.getAttribLocation(prog, 'aSize') };
  const U = {}; for (const n of ['uC', 'uR', 'uU', 'uF', 'uP', 'uZ', 'uFog', 'uFocal', 'uFogC', 'uRound']) U[n] = gl.getUniformLocation(prog, n);
  const dec = b64 => { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a.buffer; };
  const buf = (type, data, usage) => { const b = gl.createBuffer(); gl.bindBuffer(type, b); gl.bufferData(type, data, usage || gl.STATIC_DRAW); return b; };

  // ---- rakennukset ----
  const vi = new Int16Array(dec(mesh.verts)), bpos = new Float32Array(vi.length);
  for (let i = 0; i < vi.length; i++) bpos[i] = vi[i] / 10;
  const bVB = buf(gl.ARRAY_BUFFER, bpos);
  const faces = new Uint16Array(dec(mesh.faces)), bIB = buf(gl.ELEMENT_ARRAY_BUFFER, faces);
  const edges = new Uint16Array(dec(mesh.edges)), ecol = new Uint8Array(dec(mesh.ecol));
  const egroups = [[], [], []];
  for (let i = 0; i < ecol.length; i++) egroups[ecol[i]].push(edges[i * 2], edges[i * 2 + 1]);
  const eIB = egroups.map(g => ({ b: buf(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(g)), n: g.length }));
  // julkisivujen kerroslinjat: pystysuorien seinäkolmioiden ja vaakatasojen leikkaus (3,4 m välein)
  const floors = [];
  for (let t = 0; t < faces.length; t += 3) {
    const P = [faces[t], faces[t + 1], faces[t + 2]].map(i => [bpos[i * 3], bpos[i * 3 + 1], bpos[i * 3 + 2]]);
    const ux = P[1][0] - P[0][0], uy = P[1][1] - P[0][1], uz = P[1][2] - P[0][2], vx = P[2][0] - P[0][0], vy = P[2][1] - P[0][1], vz = P[2][2] - P[0][2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz);
    if (nl < 6 || Math.abs(ny) / nl > 0.12) continue;                 // vain pystyseinät, ei pikkukolmioita
    const ys = P.map(p => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (y1 - y0 < 5) continue;
    const gb = H(P[0][0], P[0][2]);
    for (let y = gb + 4.0; y < y1 - 0.9; y += 3.4) {
      if (y <= y0 + 0.2) continue;
      const pts = [];
      for (let e = 0; e < 3; e++) {
        const a = P[e], b = P[(e + 1) % 3];
        if ((a[1] - y) * (b[1] - y) < 0) { const k = (y - a[1]) / (b[1] - a[1]); pts.push(a[0] + (b[0] - a[0]) * k, y, a[2] + (b[2] - a[2]) * k); }
      }
      if (pts.length === 6) floors.push(...pts);
    }
  }
  const flVB = buf(gl.ARRAY_BUFFER, new Float32Array(floors)), flN = floors.length / 3;

  // ---- maa ----
  const g = city.ground, gcls = new Uint8Array(dec(mesh.gcls));
  const gp = new Float32Array(g.nx * g.nz * 3), gc = new Uint8Array(g.nx * g.nz * 4);
  const GC = [[24, 26, 34], [44, 47, 60], [20, 30, 26]];               // katu, jalkakäytävä, aukio
  for (let iz = 0; iz < g.nz; iz++) for (let ix = 0; ix < g.nx; ix++) {
    const k = iz * g.nx + ix, x = g.x0 + ix * g.res, z = g.z0 + iz * g.res;
    gp[k * 3] = x; gp[k * 3 + 1] = g.dm[k] / 10; gp[k * 3 + 2] = z;
    const hx = (g.dm[iz * g.nx + Math.min(ix + 1, g.nx - 1)] - g.dm[iz * g.nx + Math.max(ix - 1, 0)]) / 10;
    const sh2 = 1 + Math.max(-0.25, Math.min(0.25, hx * 0.04)), c = GC[gcls[k]] || GC[0];
    gc[k * 4] = c[0] * sh2; gc[k * 4 + 1] = c[1] * sh2; gc[k * 4 + 2] = c[2] * sh2; gc[k * 4 + 3] = 255;
  }
  const gi = [];
  for (let iz = 0; iz < g.nz - 1; iz++) for (let ix = 0; ix < g.nx - 1; ix++) {
    const a = iz * g.nx + ix; gi.push(a, a + 1, a + g.nx, a + 1, a + g.nx + 1, a + g.nx);
  }
  const gVB = buf(gl.ARRAY_BUFFER, gp), gCB = buf(gl.ARRAY_BUFFER, gc), gIB = buf(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(gi));
  const gN = gi.length;
  // katujen reunaviivat: jalkakäytävän ja kadun raja
  const curb = [];
  for (let iz = 0; iz < g.nz - 1; iz++) for (let ix = 0; ix < g.nx - 1; ix++) {
    const k = iz * g.nx + ix;
    const y = (kk) => g.dm[kk] / 10 + 0.06;
    if ((gcls[k] === 1) !== (gcls[k + 1] === 1)) { const x = g.x0 + (ix + 0.5) * g.res; curb.push(x, y(k), g.z0 + iz * g.res - g.res / 2, x, y(k + g.nx), g.z0 + iz * g.res + g.res / 2); }
    if ((gcls[k] === 1) !== (gcls[k + g.nx] === 1)) { const z = g.z0 + (iz + 0.5) * g.res; curb.push(g.x0 + ix * g.res - g.res / 2, y(k), z, g.x0 + ix * g.res + g.res / 2, y(k + 1), z); }
  }
  const curbVB = buf(gl.ARRAY_BUFFER, new Float32Array(curb)), curbN = curb.length / 3;

  // ---- dynaaminen geometria (autot, efektit) ----
  const dyn = { tp: [], tc: [], lp: [], lc: [], ap: [], ac: [], pp: [], pc: [], ps: [] };
  const dynB = { tp: gl.createBuffer(), tc: gl.createBuffer(), lp: gl.createBuffer(), lc: gl.createBuffer(), ap: gl.createBuffer(), ac: gl.createBuffer(),
    pp: gl.createBuffer(), pc: gl.createBuffer(), ps: gl.createBuffer() };
  function clear() { for (const k in dyn) dyn[k].length = 0; }
  const pushC = (arr, c, a) => arr.push(c[0], c[1], c[2], a === undefined ? 255 : a);
  function tri(a, b, c, col) { dyn.tp.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); pushC(dyn.tc, col); pushC(dyn.tc, col); pushC(dyn.tc, col); }
  function poly(pts, col) { for (let i = 1; i < pts.length - 1; i++) tri(pts[0], pts[i], pts[i + 1], col); }
  function line(a, b, col) { dyn.lp.push(a[0], a[1], a[2], b[0], b[1], b[2]); pushC(dyn.lc, col); pushC(dyn.lc, col); }
  function glass(pts, col, alpha) { for (let i = 1; i < pts.length - 1; i++) { for (const p of [pts[0], pts[i], pts[i + 1]]) { dyn.ap.push(p[0], p[1], p[2]); pushC(dyn.ac, col, alpha); } } }
  function point(p, col, size, soft) { dyn.pp.push(p[0], p[1], p[2]); pushC(dyn.pc, col, soft ? 200 : 255); dyn.ps.push(soft ? -size : size); }

  function setCam(V, fogNear, fogFar) {
    const w = V.w, h = V.h, n = 0.4, f = fogFar + 120;                // projektio HUD-pikseleissä; kangas voi olla pienempi
    gl.uniform3fv(U.uC, V.C); gl.uniform3fv(U.uR, V.r); gl.uniform3fv(U.uU, V.u); gl.uniform3fv(U.uF, V.f);
    gl.uniform4f(U.uP, 2 * V.F / w, 2 * V.cx / w - 1, 2 * V.F / h, 1 - 2 * V.cy / h);
    gl.uniform2f(U.uZ, (f + n) / (f - n), -2 * f * n / (f - n));
    gl.uniform2f(U.uFog, fogNear, fogFar); gl.uniform1f(U.uFocal, V.F);
  }
  function attrib(loc, b, size, type, norm) {
    if (b === null) { gl.disableVertexAttribArray(loc); return; }
    gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.vertexAttribPointer(loc, size, type || gl.FLOAT, !!norm, 0, 0); gl.enableVertexAttribArray(loc);
  }
  function constCol(c, a) { gl.disableVertexAttribArray(A.col); gl.vertexAttrib4f(A.col, c[0] / 255, c[1] / 255, c[2] / 255, a === undefined ? 1 : a); }
  function upload(key, Arr, data) { gl.bindBuffer(gl.ARRAY_BUFFER, dynB[key]); gl.bufferData(gl.ARRAY_BUFFER, new Arr(data), gl.DYNAMIC_DRAW); return dynB[key]; }

  const COL = { fill: [8, 13, 22], lines: [[55, 201, 255], [255, 184, 77], [255, 97, 198]] };
  function render(V, fog, fogColor, viewDist) {
    const w = canvas.width, h = canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.depthMask(true);
    setCam(V, fog[0], fog[1]);
    gl.uniform3f(U.uFogC, fogColor[0] / 255, fogColor[1] / 255, fogColor[2] / 255);
    gl.uniform1f(U.uRound, 0);
    gl.disableVertexAttribArray(A.size); gl.vertexAttrib1f(A.size, 1);
    // täytöt (maa, rakennukset, autot) hieman taaksepäin, jotta viivat piirtyvät niiden päälle
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 2);
    attrib(A.pos, gVB, 3); attrib(A.col, gCB, 4, gl.UNSIGNED_BYTE, true);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gIB); gl.drawElements(gl.TRIANGLES, gN, gl.UNSIGNED_SHORT, 0);
    attrib(A.pos, bVB, 3); constCol(COL.fill);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIB); gl.drawElements(gl.TRIANGLES, faces.length, gl.UNSIGNED_SHORT, 0);
    if (dyn.tp.length) { attrib(A.pos, upload('tp', Float32Array, dyn.tp), 3); attrib(A.col, upload('tc', Uint8Array, dyn.tc), 4, gl.UNSIGNED_BYTE, true); gl.drawArrays(gl.TRIANGLES, 0, dyn.tp.length / 3); }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    // viivat
    attrib(A.pos, bVB, 3);
    for (let k = 0; k < 3; k++) { constCol(COL.lines[k]); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eIB[k].b); gl.drawElements(gl.LINES, eIB[k].n, gl.UNSIGNED_SHORT, 0); }
    attrib(A.pos, curbVB, 3); constCol([70, 76, 98]); gl.drawArrays(gl.LINES, 0, curbN);
    attrib(A.pos, flVB, 3); constCol([22, 66, 98]); gl.drawArrays(gl.LINES, 0, flN);
    if (dyn.lp.length) { attrib(A.pos, upload('lp', Float32Array, dyn.lp), 3); attrib(A.col, upload('lc', Uint8Array, dyn.lc), 4, gl.UNSIGNED_BYTE, true); gl.drawArrays(gl.LINES, 0, dyn.lp.length / 3); }
    // läpikuultavat (lasit, öljy) ja partikkelit
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    if (dyn.ap.length) { attrib(A.pos, upload('ap', Float32Array, dyn.ap), 3); attrib(A.col, upload('ac', Uint8Array, dyn.ac), 4, gl.UNSIGNED_BYTE, true); gl.drawArrays(gl.TRIANGLES, 0, dyn.ap.length / 3); }
    if (dyn.pp.length) {
      // kovat kipinät ja pehmeä savu omina kierroksinaan
      const hard = { p: [], c: [], s: [] }, soft = { p: [], c: [], s: [] };
      for (let i = 0; i < dyn.ps.length; i++) {
        const t = dyn.ps[i] < 0 ? soft : hard;
        t.p.push(dyn.pp[i * 3], dyn.pp[i * 3 + 1], dyn.pp[i * 3 + 2]); t.c.push(dyn.pc[i * 4], dyn.pc[i * 4 + 1], dyn.pc[i * 4 + 2], dyn.pc[i * 4 + 3]); t.s.push(Math.abs(dyn.ps[i]));
      }
      for (const [set, mode] of [[soft, 2], [hard, 1]]) {
        if (!set.s.length) continue;
        gl.uniform1f(U.uRound, mode);
        attrib(A.pos, upload('pp', Float32Array, set.p), 3); attrib(A.col, upload('pc', Uint8Array, set.c), 4, gl.UNSIGNED_BYTE, true); attrib(A.size, upload('ps', Float32Array, set.s), 1);
        gl.drawArrays(gl.POINTS, 0, set.s.length);
      }
      gl.uniform1f(U.uRound, 0); gl.disableVertexAttribArray(A.size);
    }
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
  return { gl, render, clear, tri, poly, line, glass, point, stats: { tris: faces.length / 3 + gN / 3, lines: edges.length / 2 + flN / 2 + curbN / 2 } };
}
root.HKI_GL = { create };
})(typeof window !== 'undefined' ? window : this);
