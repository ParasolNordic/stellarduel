// Helsinkiralli - varapiirto ilman WebGL:ää (Canvas 2D + ohjelmallinen syvyyspuskuri).
// Käytetään, kun selain ei anna WebGL-kontekstia tai WebGL toimii vain ohjelmallisesti (SwiftShader yms., hyvin hidas).
// Rakennusten kolmiot rasteroidaan matalaresoluutioiseen syvyyspuskuriin (täyttö näkyy siitä), viivat piirretään
// täydellä tarkkuudella ja vain niiltä osin kuin ne ovat syvyyspuskurin mukaan näkyvissä. Sama rajapinta kuin gl3d.js:llä.
// Nopeus: kaupunki on jaettu 48 m lohkoihin, joista käsitellään vain näkökentässä ja näkyvyysmatkalla olevat.
(function (root) {
'use strict';
const NEAR = 0.4, CELL = 48, NLEV = 8;
function create(canvas, mesh, city, H) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dec = b64 => { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a.buffer; };
  const vi = new Int16Array(dec(mesh.verts));
  const faces0 = new Uint16Array(dec(mesh.faces)), edges0 = new Uint16Array(dec(mesh.edges)), ecol = new Uint8Array(dec(mesh.ecol));
  const PT = []; for (let i = 0; i < vi.length; i++) PT.push(vi[i] / 10);
  // staattiset viivat: [a, b, luokka]; luokat 0-2 mallin viivat, 3 kerroslinjat, 4 katujen reunat
  const SL = [];
  for (let i = 0; i < edges0.length; i += 2) SL.push(edges0[i], edges0[i + 1], ecol[i >> 1] || 0);
  const addV = (x, y, z) => { PT.push(x, y, z); return PT.length / 3 - 1; };
  for (let t = 0; t < faces0.length; t += 3) {
    const Q = [faces0[t], faces0[t + 1], faces0[t + 2]].map(i => [PT[i * 3], PT[i * 3 + 1], PT[i * 3 + 2]]);
    const ux = Q[1][0] - Q[0][0], uy = Q[1][1] - Q[0][1], uz = Q[1][2] - Q[0][2], vx = Q[2][0] - Q[0][0], vy = Q[2][1] - Q[0][1], vz = Q[2][2] - Q[0][2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz);
    if (nl < 6 || Math.abs(ny) / nl > 0.12) continue;
    const ys = Q.map(p => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (y1 - y0 < 5) continue;
    const gb = H(Q[0][0], Q[0][2]);
    for (let y = gb + 4.0; y < y1 - 0.9; y += 3.4) {
      if (y <= y0 + 0.2) continue;
      const pts = [];
      for (let e = 0; e < 3; e++) { const a = Q[e], b = Q[(e + 1) % 3]; if ((a[1] - y) * (b[1] - y) < 0) { const k = (y - a[1]) / (b[1] - a[1]); pts.push([a[0] + (b[0] - a[0]) * k, y, a[2] + (b[2] - a[2]) * k]); } }
      if (pts.length === 2) SL.push(addV(...pts[0]), addV(...pts[1]), 3);
    }
  }
  const g = city.ground, gcls = new Uint8Array(dec(mesh.gcls));
  for (let iz = 0; iz < g.nz - 1; iz++) for (let ix = 0; ix < g.nx - 1; ix++) {
    const k = iz * g.nx + ix, y = kk => g.dm[kk] / 10 + 0.06;
    if ((gcls[k] === 1) !== (gcls[k + 1] === 1)) { const x = g.x0 + (ix + 0.5) * g.res; SL.push(addV(x, y(k), g.z0 + iz * g.res - g.res / 2), addV(x, y(k + g.nx), g.z0 + iz * g.res + g.res / 2), 4); }
    if ((gcls[k] === 1) !== (gcls[k + g.nx] === 1)) { const z = g.z0 + (iz + 0.5) * g.res; SL.push(addV(g.x0 + ix * g.res - g.res / 2, y(k), z), addV(g.x0 + ix * g.res + g.res / 2, y(k + 1), z), 4); }
  }
  const P = new Float32Array(PT), nv = P.length / 3;

  // ---- lohkot: kolmiot ja viivat järjestetään lohkoittain, lohkolle rajapallo ----
  const [bx0, bz0, bx1, bz1] = city.bounds, gnx = Math.ceil((bx1 - bx0) / CELL), gnz = Math.ceil((bz1 - bz0) / CELL), NC = gnx * gnz;
  const cellOf = (x, z) => Math.min(gnx - 1, Math.max(0, Math.floor((x - bx0) / CELL))) + gnx * Math.min(gnz - 1, Math.max(0, Math.floor((z - bz0) / CELL)));
  // palauttaa lohkoittain järjestetyt alkiot (per arvoa kukin) ja lohkojen alkuindeksit alkioina
  function bucketize(items, per, centre) {
    const n = items.length / per, cid = new Int32Array(n), cnt = new Int32Array(NC + 1);
    for (let i = 0; i < n; i++) { const c = centre(i); cid[i] = cellOf(c[0], c[1]); cnt[cid[i] + 1]++; }
    for (let c = 0; c < NC; c++) cnt[c + 1] += cnt[c];
    const out = new Uint32Array(items.length), fill = cnt.slice();
    for (let i = 0; i < n; i++) { const o = fill[cid[i]]++; for (let k = 0; k < per; k++) out[o * per + k] = items[i * per + k]; }
    return { arr: out, start: cnt };
  }
  const FB = bucketize(faces0, 3, i => { const a = faces0[i * 3], b = faces0[i * 3 + 1], c = faces0[i * 3 + 2]; return [(P[a * 3] + P[b * 3] + P[c * 3]) / 3, (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3]; });
  const LB = bucketize(SL, 3, i => { const a = SL[i * 3], b = SL[i * 3 + 1]; return [(P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2]; });
  const faces = FB.arr, lines = LB.arr, fStart = FB.start, lStart = LB.start;
  // rajapallot (x, y, z, r)
  const sphere = new Float32Array(NC * 4);
  { const mn = new Float32Array(NC * 3).fill(1e9), mx = new Float32Array(NC * 3).fill(-1e9);
    const grow = (c, v) => { for (let k = 0; k < 3; k++) { mn[c * 3 + k] = Math.min(mn[c * 3 + k], P[v * 3 + k]); mx[c * 3 + k] = Math.max(mx[c * 3 + k], P[v * 3 + k]); } };
    for (let c = 0; c < NC; c++) {
      for (let i = fStart[c] * 3; i < fStart[c + 1] * 3; i++) grow(c, faces[i]);
      for (let i = lStart[c] * 3; i < lStart[c + 1] * 3; i += 3) { grow(c, lines[i]); grow(c, lines[i + 1]); }
    }
    for (let c = 0; c < NC; c++) {
      if (mn[c * 3] > mx[c * 3]) { sphere[c * 4 + 3] = -1; continue; }
      const x = (mn[c * 3] + mx[c * 3]) / 2, y = (mn[c * 3 + 1] + mx[c * 3 + 1]) / 2, z = (mn[c * 3 + 2] + mx[c * 3 + 2]) / 2;
      sphere[c * 4] = x; sphere[c * 4 + 1] = y; sphere[c * 4 + 2] = z; sphere[c * 4 + 3] = Math.hypot(mx[c * 3] - x, mx[c * 3 + 1] - y, mx[c * 3 + 2] - z) + 0.5;
    } }

  // kamera-avaruuden kärjet: lasketaan vain näkyvien lohkojen kärjille (merkitään ruutunumerolla)
  const CX = new Float32Array(nv), CY = new Float32Array(nv), CZ = new Float32Array(nv), stamp = new Uint32Array(nv);
  let frameNo = 0;
  let LW = 0, LH = 0, depth = null, pix = null, img = null;
  const off = document.createElement('canvas'), octx = off.getContext('2d');
  function ensure(w, h) {
    if (w === LW && h === LH) return;
    LW = w; LH = h; off.width = w; off.height = h;
    img = octx.createImageData(w, h); pix = new Uint32Array(img.data.buffer); depth = new Float32Array(w * h);
  }
  let resK = 1;
  // ---- rasterointi: syvyys 1/z, lineaarinen ruutuavaruudessa ----
  function rast(ax, ay, az, bx, by, bz, cx, cy, cz, col) {
    let area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area > -1e-6 && area < 1e-6) return;
    if (area < 0) { let t = bx; bx = cx; cx = t; t = by; by = cy; cy = t; t = bz; bz = cz; cz = t; area = -area; }
    const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxx = Math.min(LW - 1, Math.ceil(Math.max(ax, bx, cx)));
    const miny = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxy = Math.min(LH - 1, Math.ceil(Math.max(ay, by, cy)));
    if (minx > maxx || miny > maxy) return;
    const inv = 1 / area, d0 = -(cy - by), d1 = -(ay - cy), d2 = -(by - ay), px0 = minx + 0.5;
    const dz = (d0 * az + d1 * bz + d2 * cz) * inv;
    for (let py = miny; py <= maxy; py++) {
      const pyc = py + 0.5;
      let e0 = (cx - bx) * (pyc - by) - (cy - by) * (px0 - bx);
      let e1 = (ax - cx) * (pyc - cy) - (ay - cy) * (px0 - cx);
      let e2 = (bx - ax) * (pyc - ay) - (by - ay) * (px0 - ax);
      let iz = (e0 * az + e1 * bz + e2 * cz) * inv, idx = py * LW + minx, inside = false;
      for (let px = minx; px <= maxx; px++, idx++, e0 += d0, e1 += d1, e2 += d2, iz += dz) {
        if (e0 < 0 || e1 < 0 || e2 < 0) { if (inside) break; continue; }
        inside = true;
        if (iz > depth[idx]) { depth[idx] = iz; if (col) pix[idx] = col; }
      }
    }
  }
  const clipBuf = [];
  let Vc = null, sK = 1, PF = 1, PCX = 0, PCY = 0;
  function triCam(x0, y0, z0, x1, y1, z1, x2, y2, z2, col) {
    if (z0 >= NEAR && z1 >= NEAR && z2 >= NEAR) {
      rast(PCX + x0 * PF / z0, PCY - y0 * PF / z0, 1 / z0, PCX + x1 * PF / z1, PCY - y1 * PF / z1, 1 / z1, PCX + x2 * PF / z2, PCY - y2 * PF / z2, 1 / z2, col);
      return;
    }
    if (z0 < NEAR && z1 < NEAR && z2 < NEAR) return;
    const inp = [[x0, y0, z0], [x1, y1, z1], [x2, y2, z2]]; clipBuf.length = 0;
    for (let i = 0; i < 3; i++) {
      const a = inp[i], b = inp[(i + 1) % 3], ai = a[2] >= NEAR, bi = b[2] >= NEAR;
      if (ai) clipBuf.push(a);
      if (ai !== bi) { const k = (NEAR - a[2]) / (b[2] - a[2]); clipBuf.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, NEAR]); }
    }
    const pr = clipBuf.map(p => [PCX + p[0] * PF / p[2], PCY - p[1] * PF / p[2], 1 / p[2]]);
    for (let i = 1; i < pr.length - 1; i++) rast(pr[0][0], pr[0][1], pr[0][2], pr[i][0], pr[i][1], pr[i][2], pr[i + 1][0], pr[i + 1][1], pr[i + 1][2], col);
  }

  // ---- dynaaminen geometria ----
  const dyn = { tris: [], lines: [], glass: [], pts: [] };
  function clear() { dyn.tris.length = dyn.lines.length = dyn.glass.length = dyn.pts.length = 0; }
  function tri(a, b, c, col) { dyn.tris.push([[a, b, c], col]); }
  function poly(pts, col) { if (pts.length >= 3) dyn.tris.push([pts.slice(), col]); }
  function line(a, b, col) { dyn.lines.push(a[0], a[1], a[2], b[0], b[1], b[2], col); }
  function glass(pts, col, alpha) { dyn.glass.push([pts.slice(), col, alpha]); }
  function point(p, col, size, soft) { dyn.pts.push([p, col, size, soft]); }

  const toCam = p => { const d0 = p[0] - Vc.C[0], d1 = p[1] - Vc.C[1], d2 = p[2] - Vc.C[2];
    return [d0 * Vc.r[0] + d1 * Vc.r[1] + d2 * Vc.r[2], d0 * Vc.u[0] + d1 * Vc.u[1] + d2 * Vc.u[2], d0 * Vc.f[0] + d1 * Vc.f[1] + d2 * Vc.f[2]]; };
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  let FN = 300, FF = 900, FC = [10, 9, 24];
  const fogMix = (c, z) => { const t = ss(FN, FF, z); return [c[0] + (FC[0] - c[0]) * t, c[1] + (FC[1] - c[1]) * t, c[2] + (FC[2] - c[2]) * t]; };
  const css = (c, a) => a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  // viivakorit: staattisille luokka*NLEV+sumutaso, dynaamisille oma kori värin mukaan
  const SCOL = [[55, 201, 255], [255, 184, 77], [255, 97, 198], [22, 66, 98], [70, 76, 98]];
  const bucket = []; for (let i = 0; i < SCOL.length * NLEV; i++) bucket.push({ a: new Float32Array(4096), n: 0 });
  const dynBuckets = new Map();
  const pushSeg = (B, x0, y0, x1, y1) => {
    if (B.n + 4 > B.a.length) { const na = new Float32Array(B.a.length * 2); na.set(B.a); B.a = na; }
    B.a[B.n++] = x0; B.a[B.n++] = y0; B.a[B.n++] = x1; B.a[B.n++] = y1;
  };
  // viivan näkyvät pätkät koriin B (staattisille kori valitaan luokan ja sumutason mukaan)
  function visLine(ax, ay, az, bx, by, bz, cls, B) {
    if (az < NEAR && bz < NEAR) return;
    if (az < NEAR) { const k = (NEAR - az) / (bz - az); ax += (bx - ax) * k; ay += (by - ay) * k; az = NEAR; }
    else if (bz < NEAR) { const k = (NEAR - bz) / (az - bz); bx += (ax - bx) * k; by += (ay - by) * k; bz = NEAR; }
    const F = Vc.F, cx = Vc.cx, cy = Vc.cy;
    const sx0 = cx + ax * F / az, sy0 = cy - ay * F / az, sx1 = cx + bx * F / bz, sy1 = cy - by * F / bz;
    const W = Vc.w, Hh = Vc.h;
    if ((sx0 < 0 && sx1 < 0) || (sx0 > W && sx1 > W) || (sy0 < 0 && sy1 < 0) || (sy0 > Hh && sy1 > Hh)) return;
    const iz0 = 1 / az, iz1 = 1 / bz;
    if (!B) { const zm = 2 / (iz0 + iz1); B = bucket[cls * NLEV + Math.min(NLEV - 1, Math.round(ss(FN, FF, zm) * (NLEV - 1)))]; }
    // näytteet matalaresoluutioisessa puskurissa noin 1,6 pikselin välein
    const qx0 = sx0 * sK, qy0 = sy0 * sK, qx1 = sx1 * sK, qy1 = sy1 * sK;
    const L = Math.abs(qx1 - qx0) + Math.abs(qy1 - qy0);
    const n = Math.max(1, Math.min(300, Math.ceil(L / 1.6)));
    const dqx = (qx1 - qx0) / n, dqy = (qy1 - qy0) / n, diz = (iz1 - iz0) / n;
    let qx = qx0, qy = qy0, iz = iz0, open = false, fi = 0, li = 0;
    for (let i = 0; i <= n; i++, qx += dqx, qy += dqy, iz += diz) {
      let vis = true;
      const ix = qx | 0, iy = qy | 0;
      if (ix >= 0 && iy >= 0 && ix < LW && iy < LH) {
        const d = depth[iy * LW + ix];
        // näkyy, jos 1/iz <= 1.04/d + 1  <=>  d <= iz * (1.04 + d)
        if (d > 0) vis = d <= iz * (1.04 + d);
      }
      if (vis) { if (!open) { fi = i; open = true; } li = i; }
      else if (open) { open = false; pushSeg(B, sx0 + (sx1 - sx0) * fi / n, sy0 + (sy1 - sy0) * fi / n, sx0 + (sx1 - sx0) * li / n, sy0 + (sy1 - sy0) * li / n); }
    }
    if (open) pushSeg(B, sx0 + (sx1 - sx0) * fi / n, sy0 + (sy1 - sy0) * fi / n, sx0 + (sx1 - sx0) * li / n, sy0 + (sy1 - sy0) * li / n);
  }
  function strokeB(B, style, lw) {
    if (!B.n) return;
    ctx.strokeStyle = style; ctx.lineWidth = lw;
    ctx.beginPath();
    const a = B.a;
    for (let i = 0; i < B.n; i += 4) { ctx.moveTo(a[i], a[i + 1]); ctx.lineTo(a[i + 2], a[i + 3]); }
    ctx.stroke(); B.n = 0;
  }
  let lwk = 1;
  const FILL = [8, 13, 22];
  let tAvg = 16, PROF = '';
  const visCells = new Int32Array(NC), cellZ = new Float32Array(NC), hidden = new Uint32Array(NC);

  function render(V, fog, fogColor) {
    const t0 = performance.now();
    Vc = V; FN = fog[0]; FF = fog[1]; FC = fogColor; lwk = Math.max(1, Math.min(V.w, V.h) / 900);
    const lw = Math.max(160, Math.round(V.w * resK / 2.6)), lh = Math.max(90, Math.round(lw * V.h / V.w));
    ensure(lw, lh); sK = lw / V.w; PF = V.F * sK; PCX = V.cx * sK; PCY = V.cy * sK;
    depth.fill(0); pix.fill(0);
    const C = V.C, r = V.r, u = V.u, f = V.f, lim = FF + 60;
    const sideK = 1.05 * (V.w / 2) / V.F, upK = 1.05 * (V.h / 2) / V.F;
    // näkyvät lohkot
    let nvc = 0;
    for (let c = 0; c < NC; c++) {
      const rad = sphere[c * 4 + 3]; if (rad < 0) continue;
      const d0 = sphere[c * 4] - C[0], d1 = sphere[c * 4 + 1] - C[1], d2 = sphere[c * 4 + 2] - C[2];
      const z = d0 * f[0] + d1 * f[1] + d2 * f[2];
      if (z + rad < NEAR || z - rad > lim) continue;
      const x = d0 * r[0] + d1 * r[1] + d2 * r[2], y = d0 * u[0] + d1 * u[1] + d2 * u[2], zz = Math.max(z + rad, NEAR);
      if (Math.abs(x) - rad > zz * sideK || Math.abs(y) - rad > zz * upK + 2) continue;
      cellZ[c] = z; visCells[nvc++] = c;
    }
    // lähimmät ensin, jotta peittyneet lohkot voidaan ohittaa syvyyspuskurin avulla
    const order = Array.from(visCells.subarray(0, nvc)).sort((a, b) => cellZ[a] - cellZ[b]);
    const cellHidden = c => {
      const rad = sphere[c * 4 + 3], zn = cellZ[c] - rad; if (zn < NEAR + 1) return false;
      const d0 = sphere[c * 4] - C[0], d1 = sphere[c * 4 + 1] - C[1], d2 = sphere[c * 4 + 2] - C[2];
      const x = d0 * r[0] + d1 * r[1] + d2 * r[2], y = d0 * u[0] + d1 * u[1] + d2 * u[2];
      // rajapallon kuva: laatikko lähimmän syvyyden mukaan (konservatiivinen)
      const x0 = Math.floor(PCX + (x - rad) * PF / zn), x1 = Math.ceil(PCX + (x + rad) * PF / zn);
      const y0 = Math.floor(PCY - (y + rad) * PF / zn), y1 = Math.ceil(PCY - (y - rad) * PF / zn);
      if (x0 < 0 || y0 < 0 || x1 >= LW || y1 >= LH) return false;
      const need = 1 / zn;
      for (let py = y0; py <= y1; py++) for (let i = py * LW + x0, e = py * LW + x1; i <= e; i++) if (depth[i] < need) return false;
      return true;
    };
    const fr = ++frameNo;
    const xf = v => {
      if (stamp[v] === fr) return;
      stamp[v] = fr; const j = v * 3, d0 = P[j] - C[0], d1 = P[j + 1] - C[1], d2 = P[j + 2] - C[2];
      CX[v] = d0 * r[0] + d1 * r[1] + d2 * r[2]; CY[v] = d0 * u[0] + d1 * u[1] + d2 * u[2]; CZ[v] = d0 * f[0] + d1 * f[1] + d2 * f[2];
    };
    const fillLev = []; for (let k = 0; k <= 8; k++) { const c = fogMix(FILL, FN + (FF - FN) * (k / 8)); fillLev.push((255 << 24) | ((c[2] | 0) << 16) | ((c[1] | 0) << 8) | (c[0] | 0)); }
    const fk = 8 / (FF - FN);
    let nTri = 0;
    let nHid = 0;
    for (let q = 0; q < nvc; q++) {
      const c = order[q];
      if (q > 4 && cellHidden(c)) { hidden[c] = frameNo; nHid++; continue; }
      for (let t = fStart[c] * 3, e = fStart[c + 1] * 3; t < e; t += 3) {
        const a = faces[t], b = faces[t + 1], cc = faces[t + 2];
        xf(a); xf(b); xf(cc);
        const za = CZ[a], zb = CZ[b], zc = CZ[cc];
        if (za < NEAR && zb < NEAR && zc < NEAR) continue;
        if (za > lim && zb > lim && zc > lim) continue;
        const xa = CX[a], xb = CX[b], xc = CX[cc];
        if (xa > za * sideK + 1 && xb > zb * sideK + 1 && xc > zc * sideK + 1) continue;
        if (-xa > za * sideK + 1 && -xb > zb * sideK + 1 && -xc > zc * sideK + 1) continue;
        const zm = (za + zb + zc) / 3, lev = zm <= FN ? 0 : Math.min(8, Math.round((zm - FN) * fk));
        triCam(xa, CY[a], za, xb, CY[b], zb, xc, CY[cc], zc, fillLev[lev]); nTri++;
      }
    }
    // dynaamiset kolmiot vain syvyyteen (täyttö piirretään täydellä tarkkuudella)
    const dynPolys = [];
    for (const [pts, col] of dyn.tris) {
      const cp = pts.map(toCam);
      for (let i = 1; i < cp.length - 1; i++) triCam(cp[0][0], cp[0][1], cp[0][2], cp[i][0], cp[i][1], cp[i][2], cp[i + 1][0], cp[i + 1][1], cp[i + 1][2], 0);
      dynPolys.push([cp, col]);
    }
    const t1 = performance.now();
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, V.w, V.h);
    const projPoly = cp => {
      const out = [];
      for (let i = 0; i < cp.length; i++) {
        const a = cp[i], b = cp[(i + 1) % cp.length], ai = a[2] >= NEAR, bi = b[2] >= NEAR;
        if (ai) out.push(a);
        if (ai !== bi) { const k = (NEAR - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, NEAR]); }
      }
      return out.map(p => [V.cx + p[0] * V.F / p[2], V.cy - p[1] * V.F / p[2], p[2]]);
    };
    const occluded = (sx, sy, z) => {
      const qx = (sx * sK) | 0, qy = (sy * sK) | 0;
      if (qx < 0 || qy < 0 || qx >= LW || qy >= LH) return false;
      const d = depth[qy * LW + qx]; return d > 0 && z > (1 / d) * 1.04 + 1.0;
    };
    const drawn = [];
    const addFill = (cp, col, alpha) => {
      const sp = projPoly(cp); if (sp.length < 3) return;
      let mx = 0, my = 0, mz = 0; for (const p of sp) { mx += p[0]; my += p[1]; mz += p[2]; } mx /= sp.length; my /= sp.length; mz /= sp.length;
      if (mz > FF + 60 || occluded(mx, my, mz)) return;
      drawn.push([mz, sp, col, alpha]);
    };
    for (const [cp, col] of dynPolys) addFill(cp, col, null);
    for (const [pts, col, alpha] of dyn.glass) addFill(pts.map(toCam), col, alpha);
    drawn.sort((a, b) => b[0] - a[0]);
    for (const [mz, sp, col, alpha] of drawn) {
      const c = fogMix(col, mz);
      ctx.fillStyle = alpha === null ? css(c) : css(c, (alpha / 255).toFixed(3));
      ctx.beginPath(); ctx.moveTo(sp[0][0], sp[0][1]); for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i][0], sp[i][1]); ctx.closePath(); ctx.fill();
    }
    const t2 = performance.now();
    // staattiset viivat näkyvistä lohkoista; kerroslinjat ja katujen reunat vain lähempää
    const nearLim = Math.min(lim, 380);
    for (let q = 0; q < nvc; q++) {
      const c = order[q];
      if (hidden[c] === frameNo) continue;
      for (let i = lStart[c] * 3, e = lStart[c + 1] * 3; i < e; i += 3) {
        const a = lines[i], b = lines[i + 1], cls = lines[i + 2];
        xf(a); xf(b);
        const za = CZ[a], zb = CZ[b];
        if (cls >= 3 ? (za > nearLim && zb > nearLim) : (za > lim && zb > lim)) continue;
        visLine(CX[a], CY[a], za, CX[b], CY[b], zb, cls, null);
      }
    }
    for (let i = 0; i < dyn.lines.length; i += 7) {
      const a = toCam([dyn.lines[i], dyn.lines[i + 1], dyn.lines[i + 2]]), b = toCam([dyn.lines[i + 3], dyn.lines[i + 4], dyn.lines[i + 5]]), c = dyn.lines[i + 6];
      const key = c[0] + ',' + c[1] + ',' + c[2];
      let B = dynBuckets.get(key); if (!B) { B = { a: new Float32Array(256), n: 0, c }; dynBuckets.set(key, B); }
      visLine(a[0], a[1], a[2], b[0], b[1], b[2], 0, B);
    }
    const t3 = performance.now();
    ctx.lineCap = 'butt';
    for (let cls = 0; cls < SCOL.length; cls++) for (let l = 0; l < NLEV; l++) {
      const t = l / (NLEV - 1), c = SCOL[cls];
      strokeB(bucket[cls * NLEV + l], css([c[0] + (FC[0] - c[0]) * t, c[1] + (FC[1] - c[1]) * t, c[2] + (FC[2] - c[2]) * t]), lwk);
    }
    for (const B of dynBuckets.values()) strokeB(B, css(B.c), 1.3 * lwk);
    if (dynBuckets.size > 64) dynBuckets.clear();
    // partikkelit
    for (const [p, col, size, soft] of dyn.pts) {
      const c = toCam(p); if (c[2] < 0.5 || c[2] > FF) continue;
      const sx = V.cx + c[0] * V.F / c[2], sy = V.cy - c[1] * V.F / c[2], rr = Math.max(1, Math.min(96, size * V.F / c[2]) / 2);
      if (occluded(sx, sy, c[2])) continue;
      ctx.fillStyle = css(fogMix(col, c[2]), soft ? 0.35 : 1);
      if (rr < 2.5) ctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2); else { ctx.beginPath(); ctx.arc(sx, sy, rr, 0, 7); ctx.fill(); }
    }
    const t4 = performance.now();
    PROF = [t1 - t0, t2 - t1, t3 - t2, t4 - t3].map(x => x.toFixed(1)).join('/') + ' · ' + nvc + ' lohkoa (' + nHid + ' peitossa) ' + nTri + ' kolmiota';
    // tarkkuus ruudunpäivityksen mukaan
    const dt = t4 - t0; tAvg = tAvg * 0.9 + dt * 0.1;
    if (tAvg > 22 && resK > 0.6) resK = Math.max(0.6, resK - 0.04); else if (tAvg < 12 && resK < 1.2) resK = Math.min(1.2, resK + 0.02);
  }
  return { sw: true, render, clear, tri, poly, line, glass, point, info: () => ({ mode: 'ohjelmallinen', buf: LW + 'x' + LH, ms: tAvg.toFixed(1), prof: PROF, resK: resK.toFixed(2) }),
    stats: { tris: faces.length / 3, lines: lines.length / 3 } };
}
root.HKI_SW = { create };
})(typeof window !== 'undefined' ? window : this);
