// Helsinkiralli - varapiirto ilman WebGL:ää (Canvas 2D + ohjelmallinen syvyyspuskuri).
// Käytetään, kun selain ei anna WebGL-kontekstia (esim. laitteistokiihdytys pois päältä tai näytönohjain estolistalla).
// Rakennusten kolmiot rasteroidaan matalaresoluutioiseen syvyyspuskuriin (täyttö näkyy siitä), viivat piirretään
// täydellä tarkkuudella ja vain niiltä osin kuin ne ovat syvyyspuskurin mukaan näkyvissä. Sama rajapinta kuin gl3d.js:llä.
(function (root) {
'use strict';
const NEAR = 0.4;
function create(canvas, mesh, city, H) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dec = b64 => { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a.buffer; };
  const vi = new Int16Array(dec(mesh.verts)), nv = vi.length / 3, P = new Float32Array(vi.length);
  for (let i = 0; i < vi.length; i++) P[i] = vi[i] / 10;
  const faces = new Uint16Array(dec(mesh.faces)), edges = new Uint16Array(dec(mesh.edges)), ecol = new Uint8Array(dec(mesh.ecol));
  // kerroslinjat kuten gl3d.js:ssä
  const floors = [];
  for (let t = 0; t < faces.length; t += 3) {
    const Q = [faces[t], faces[t + 1], faces[t + 2]].map(i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    const ux = Q[1][0] - Q[0][0], uy = Q[1][1] - Q[0][1], uz = Q[1][2] - Q[0][2], vx = Q[2][0] - Q[0][0], vy = Q[2][1] - Q[0][1], vz = Q[2][2] - Q[0][2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz);
    if (nl < 6 || Math.abs(ny) / nl > 0.12) continue;
    const ys = Q.map(p => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (y1 - y0 < 5) continue;
    const gb = H(Q[0][0], Q[0][2]);
    for (let y = gb + 4.0; y < y1 - 0.9; y += 3.4) {
      if (y <= y0 + 0.2) continue;
      const pts = [];
      for (let e = 0; e < 3; e++) { const a = Q[e], b = Q[(e + 1) % 3]; if ((a[1] - y) * (b[1] - y) < 0) { const k = (y - a[1]) / (b[1] - a[1]); pts.push(a[0] + (b[0] - a[0]) * k, y, a[2] + (b[2] - a[2]) * k); } }
      if (pts.length === 6) floors.push(...pts);
    }
  }
  const FL = new Float32Array(floors);
  // katujen reunat
  const g = city.ground, gcls = new Uint8Array(dec(mesh.gcls)), curb = [];
  for (let iz = 0; iz < g.nz - 1; iz++) for (let ix = 0; ix < g.nx - 1; ix++) {
    const k = iz * g.nx + ix, y = kk => g.dm[kk] / 10 + 0.06;
    if ((gcls[k] === 1) !== (gcls[k + 1] === 1)) { const x = g.x0 + (ix + 0.5) * g.res; curb.push(x, y(k), g.z0 + iz * g.res - g.res / 2, x, y(k + g.nx), g.z0 + iz * g.res + g.res / 2); }
    if ((gcls[k] === 1) !== (gcls[k + g.nx] === 1)) { const z = g.z0 + (iz + 0.5) * g.res; curb.push(g.x0 + ix * g.res - g.res / 2, y(k), z, g.x0 + ix * g.res + g.res / 2, y(k + 1), z); }
  }
  const CB = new Float32Array(curb);

  // kamera-avaruuden kärjet
  const CX = new Float32Array(nv), CY = new Float32Array(nv), CZ = new Float32Array(nv);
  // matalaresoluutioiset puskurit
  let LW = 0, LH = 0, depth = null, pix = null, img = null;
  const off = document.createElement('canvas'), octx = off.getContext('2d');
  function ensure(w, h) {
    if (w === LW && h === LH) return;
    LW = w; LH = h; off.width = w; off.height = h;
    img = octx.createImageData(w, h); pix = new Uint32Array(img.data.buffer); depth = new Float32Array(w * h);
  }
  let resK = 1;                                                     // säädetään ruudunpäivityksen mukaan
  // ---- rasterointi: syvyys 1/z, lineaarinen ruutuavaruudessa ----
  function rast(ax, ay, az, bx, by, bz, cx, cy, cz, col) {
    let area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area > -1e-6 && area < 1e-6) return;
    if (area < 0) { let t = bx; bx = cx; cx = t; t = by; by = cy; cy = t; t = bz; bz = cz; cz = t; area = -area; }
    const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxx = Math.min(LW - 1, Math.ceil(Math.max(ax, bx, cx)));
    const miny = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxy = Math.min(LH - 1, Math.ceil(Math.max(ay, by, cy)));
    if (minx > maxx || miny > maxy) return;
    const inv = 1 / area, d0 = -(cy - by), d1 = -(ay - cy), d2 = -(by - ay), px0 = minx + 0.5;
    for (let py = miny; py <= maxy; py++) {
      const pyc = py + 0.5;
      let e0 = (cx - bx) * (pyc - by) - (cy - by) * (px0 - bx);
      let e1 = (ax - cx) * (pyc - cy) - (ay - cy) * (px0 - cx);
      let e2 = (bx - ax) * (pyc - ay) - (by - ay) * (px0 - ax);
      let idx = py * LW + minx;
      for (let px = minx; px <= maxx; px++, idx++, e0 += d0, e1 += d1, e2 += d2) {
        if (e0 < 0 || e1 < 0 || e2 < 0) continue;
        const iz = (e0 * az + e1 * bz + e2 * cz) * inv;
        if (iz > depth[idx]) { depth[idx] = iz; if (col) pix[idx] = col; }
      }
    }
  }
  // kolmio kamera-avaruudessa: leikkaus lähitasoon, projektio matalaan resoluutioon
  const clipBuf = [];
  let Vc = null, sK = 1;
  function triCam(x0, y0, z0, x1, y1, z1, x2, y2, z2, col) {
    if (z0 >= NEAR && z1 >= NEAR && z2 >= NEAR) {
      const F = Vc.F * sK, cx = Vc.cx * sK, cy = Vc.cy * sK;
      rast(cx + x0 * F / z0, cy - y0 * F / z0, 1 / z0, cx + x1 * F / z1, cy - y1 * F / z1, 1 / z1, cx + x2 * F / z2, cy - y2 * F / z2, 1 / z2, col);
      return;
    }
    if (z0 < NEAR && z1 < NEAR && z2 < NEAR) return;
    const inp = [[x0, y0, z0], [x1, y1, z1], [x2, y2, z2]]; clipBuf.length = 0;
    for (let i = 0; i < 3; i++) {
      const a = inp[i], b = inp[(i + 1) % 3], ai = a[2] >= NEAR, bi = b[2] >= NEAR;
      if (ai) clipBuf.push(a);
      if (ai !== bi) { const k = (NEAR - a[2]) / (b[2] - a[2]); clipBuf.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, NEAR]); }
    }
    const F = Vc.F * sK, cx = Vc.cx * sK, cy = Vc.cy * sK, pr = clipBuf.map(p => [cx + p[0] * F / p[2], cy - p[1] * F / p[2], 1 / p[2]]);
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

  // viivan näkyvät osat: näytteet syvyyspuskurista, näkyvät pätkät koriin (väri + sumutaso)
  const buckets = new Map();
  function visLine(ax, ay, az, bx, by, bz, col, lw) {
    if (az < NEAR && bz < NEAR) return;
    if (az < NEAR) { const k = (NEAR - az) / (bz - az); ax += (bx - ax) * k; ay += (by - ay) * k; az = NEAR; }
    else if (bz < NEAR) { const k = (NEAR - bz) / (az - bz); bx += (ax - bx) * k; by += (ay - by) * k; bz = NEAR; }
    if (az > FF + 80 && bz > FF + 80) return;
    const F = Vc.F, cx = Vc.cx, cy = Vc.cy;
    const sx0 = cx + ax * F / az, sy0 = cy - ay * F / az, sx1 = cx + bx * F / bz, sy1 = cy - by * F / bz;
    const W = Vc.w, Hh = Vc.h;
    if ((sx0 < 0 && sx1 < 0) || (sx0 > W && sx1 > W) || (sy0 < 0 && sy1 < 0) || (sy0 > Hh && sy1 > Hh)) return;
    const iz0 = 1 / az, iz1 = 1 / bz;
    const L = Math.hypot(sx1 - sx0, sy1 - sy0) * sK;
    const n = Math.max(1, Math.min(400, Math.ceil(L / 1.2)));
    const zm = 2 / (iz0 + iz1), lev = Math.round(ss(FN, FF, zm) * 7);
    const key = col + '|' + lev + '|' + (lw || 1);
    let arr = buckets.get(key); if (!arr) { arr = []; buckets.set(key, arr); }
    let open = false, fx = 0, fy = 0, lx = 0, ly = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n, sx = sx0 + (sx1 - sx0) * t, sy = sy0 + (sy1 - sy0) * t, iz = iz0 + (iz1 - iz0) * t;
      const qx = (sx * sK) | 0, qy = (sy * sK) | 0;
      let vis = true;
      if (qx >= 0 && qy >= 0 && qx < LW && qy < LH) {
        const d = depth[qy * LW + qx];
        if (d > 0) vis = 1 / iz <= (1 / d) * 1.04 + 1.0;
      }
      if (vis) { if (!open) { fx = sx; fy = sy; open = true; } lx = sx; ly = sy; }
      else if (open) { arr.push(fx, fy, lx, ly); open = false; }
    }
    if (open) arr.push(fx, fy, lx, ly);
  }
  function strokeBuckets() {
    for (const [key, arr] of buckets) {
      if (!arr.length) continue;
      const [cs, lev, lw] = key.split('|'), c = cs.split(',').map(Number), t = (+lev) / 7;
      ctx.strokeStyle = css([c[0] + (FC[0] - c[0]) * t, c[1] + (FC[1] - c[1]) * t, c[2] + (FC[2] - c[2]) * t]);
      ctx.lineWidth = +lw * lwk;
      ctx.beginPath();
      for (let i = 0; i < arr.length; i += 4) { ctx.moveTo(arr[i], arr[i + 1]); ctx.lineTo(arr[i + 2], arr[i + 3]); }
      ctx.stroke();
      arr.length = 0;
    }
  }
  let lwk = 1;
  const LCOL = ['55,201,255', '255,184,77', '255,97,198'], FLCOL = '22,66,98', CURBCOL = '70,76,98';
  const FILL = [8, 13, 22];
  let tAvg = 16;

  function render(V, fog, fogColor) {
    const t0 = performance.now();
    Vc = V; FN = fog[0]; FF = fog[1]; FC = fogColor; lwk = Math.max(1, Math.min(V.w, V.h) / 900);
    const lw = Math.max(160, Math.round(V.w * resK / 3)), lh = Math.max(90, Math.round(lw * V.h / V.w));
    ensure(lw, lh); sK = lw / V.w;
    depth.fill(0); pix.fill(0);
    const C = V.C, r = V.r, u = V.u, f = V.f;
    for (let i = 0, j = 0; i < nv; i++, j += 3) {
      const d0 = P[j] - C[0], d1 = P[j + 1] - C[1], d2 = P[j + 2] - C[2];
      CX[i] = d0 * r[0] + d1 * r[1] + d2 * r[2]; CY[i] = d0 * u[0] + d1 * u[1] + d2 * u[2]; CZ[i] = d0 * f[0] + d1 * f[1] + d2 * f[2];
    }
    // rakennusten täyttö: sumutaso kolmion keskisyvyydestä (8 tasoa valmiiksi pakattuina)
    const fillLev = []; for (let k = 0; k <= 8; k++) { const c = fogMix(FILL, FN + (FF - FN) * (k / 8)); fillLev.push((255 << 24) | ((c[2] | 0) << 16) | ((c[1] | 0) << 8) | (c[0] | 0)); }
    const lim = FF + 120, sideK = 1.25 * Math.max(V.w, V.h) / V.F;
    for (let t = 0; t < faces.length; t += 3) {
      const a = faces[t], b = faces[t + 1], c = faces[t + 2];
      const za = CZ[a], zb = CZ[b], zc = CZ[c];
      if (za < NEAR && zb < NEAR && zc < NEAR) continue;
      const zmn = Math.min(za, zb, zc); if (zmn > lim) continue;
      // karkea sivuraja: kaikki kärjet saman reunan ulkopuolella
      const xa = CX[a], xb = CX[b], xc = CX[c];
      if (xa > za * sideK + 2 && xb > zb * sideK + 2 && xc > zc * sideK + 2) continue;
      if (-xa > za * sideK + 2 && -xb > zb * sideK + 2 && -xc > zc * sideK + 2) continue;
      const zm = (za + zb + zc) / 3, lev = Math.max(0, Math.min(8, Math.round((zm - FN) / (FF - FN) * 8)));
      triCam(xa, CY[a], za, xb, CY[b], zb, xc, CY[c], zc, fillLev[lev]);
    }
    // dynaamiset kolmiot vain syvyyteen (täyttö piirretään täydellä tarkkuudella)
    const dynPolys = [];
    for (const [pts, col] of dyn.tris) {
      const cp = pts.map(toCam);
      for (let i = 1; i < cp.length - 1; i++) triCam(cp[0][0], cp[0][1], cp[0][2], cp[i][0], cp[i][1], cp[i][2], cp[i + 1][0], cp[i + 1][1], cp[i + 1][2], 0);
      dynPolys.push([cp, col, null]);
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, V.w, V.h);
    // dynaamiset täytöt (painter), peittyvät jos keskipiste on rakennuksen takana
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
    const fills = [];
    for (const [cp, col] of dynPolys) fills.push([cp, col, null]);
    for (const [pts, col, alpha] of dyn.glass) fills.push([pts.map(toCam), col, alpha]);
    const drawn = [];
    for (const [cp, col, alpha] of fills) {
      const sp = projPoly(cp); if (sp.length < 3) continue;
      let mx = 0, my = 0, mz = 0; for (const p of sp) { mx += p[0]; my += p[1]; mz += p[2]; } mx /= sp.length; my /= sp.length; mz /= sp.length;
      if (mz > FF + 60 || occluded(mx, my, mz)) continue;
      drawn.push([mz, sp, col, alpha]);
    }
    drawn.sort((a, b) => b[0] - a[0]);
    for (const [mz, sp, col, alpha] of drawn) {
      const c = fogMix(col, mz);
      ctx.fillStyle = alpha === null ? css(c) : css(c, (alpha / 255).toFixed(3));
      ctx.beginPath(); ctx.moveTo(sp[0][0], sp[0][1]); for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i][0], sp[i][1]); ctx.closePath(); ctx.fill();
    }
    // viivat
    for (let i = 0; i < edges.length; i += 2) {
      const a = edges[i], b = edges[i + 1];
      visLine(CX[a], CY[a], CZ[a], CX[b], CY[b], CZ[b], LCOL[ecol[i >> 1]] || LCOL[0], 1);
    }
    const lineArr = (A, col) => {
      for (let i = 0; i < A.length; i += 6) {
        const a = toCam([A[i], A[i + 1], A[i + 2]]), b = toCam([A[i + 3], A[i + 4], A[i + 5]]);
        visLine(a[0], a[1], a[2], b[0], b[1], b[2], col, 1);
      }
    };
    lineArr(CB, CURBCOL); lineArr(FL, FLCOL);
    for (let i = 0; i < dyn.lines.length; i += 7) {
      const a = toCam([dyn.lines[i], dyn.lines[i + 1], dyn.lines[i + 2]]), b = toCam([dyn.lines[i + 3], dyn.lines[i + 4], dyn.lines[i + 5]]), c = dyn.lines[i + 6];
      visLine(a[0], a[1], a[2], b[0], b[1], b[2], c[0] + ',' + c[1] + ',' + c[2], 1.3);
    }
    ctx.lineCap = 'round';
    strokeBuckets();
    // partikkelit
    for (const [p, col, size, soft] of dyn.pts) {
      const c = toCam(p); if (c[2] < 0.5 || c[2] > FF) continue;
      const sx = V.cx + c[0] * V.F / c[2], sy = V.cy - c[1] * V.F / c[2], rr = Math.max(1, Math.min(96, size * V.F / c[2]) / 2);
      if (occluded(sx, sy, c[2])) continue;
      ctx.fillStyle = css(fogMix(col, c[2]), soft ? 0.35 : 1);
      ctx.beginPath(); ctx.arc(sx, sy, rr, 0, 7); ctx.fill();
    }
    // tarkkuus ruudunpäivityksen mukaan
    const dt = performance.now() - t0; tAvg = tAvg * 0.9 + dt * 0.1;
    if (tAvg > 34 && resK > 0.55) resK = Math.max(0.55, resK - 0.05); else if (tAvg < 16 && resK < 1.3) resK = Math.min(1.3, resK + 0.02);
  }
  return { sw: true, render, clear, tri, poly, line, glass, point, info: () => ({ mode: 'ohjelmallinen', buf: LW + 'x' + LH, ms: tAvg.toFixed(1) }),
    stats: { tris: faces.length / 3, lines: edges.length / 2 } };
}
root.HKI_SW = { create };
})(typeof window !== 'undefined' ? window : this);
