#!/usr/bin/env python3
"""Helsinkiralli: muuntaa Helsingin LoD2-kolmioverkon (Kruununhaka) pelidataksi.

Lähde: data/kruununhaka-mesh.json (kärjet, kolmiot, viivat, viivavärit; itä/pohjoinen/ylös, metrit).
Tuottaa:
  public/kaupunki.js       palvelin + selain: rajat, 1 m törmäysruudukko, 2 m korkeusruudukko,
                           4 m maanpinta, aloituspaikat
  public/kaupunki-mesh.js  vain selain: kolmiot ja viivat WebGL-piirtoon, maan pintaluokat
Pelin koordinaatit: x = itä, y = ylös, z = pohjoinen.

Käyttö: python3 muunna_mesh.py ../data/kruununhaka-mesh.json ../public [esikatselu.png]
"""
import json, sys, math, base64
import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from skimage.draw import polygon as fill_polygon

src, outdir = sys.argv[1], sys.argv[2]
d = json.load(open(src))
V = np.array(d['vertices'], dtype=np.float64)          # itä, pohjoinen, ylös
F = np.array(d['faces'], dtype=np.int64)
E = np.array(d['edges'], dtype=np.int64)
COL = np.array(d['colors'], dtype=np.uint8)

MARGIN = 14
x0 = math.floor(V[:, 0].min()) - MARGIN; z0 = math.floor(V[:, 1].min()) - MARGIN
x1 = math.ceil(V[:, 0].max()) + MARGIN;  z1 = math.ceil(V[:, 1].max()) + MARGIN
nx, nz = x1 - x0, z1 - z0

# alustava maanpinta (karkea alaverho) rakennusalueen erotteluun
_t = cKDTree(V[:, :2])
def H0(px, pz):
    ids = _t.query_ball_point([px, pz], 12.0)
    return float(V[ids, 2].min()) if ids else 0.0
# ---------- 2) rakennusalue ja korkeudet kolmioista ----------
occ = np.zeros((nz, nx), bool)
top = np.zeros((nz, nx))
for f in F:
    p = V[f]
    cx, cz = p[:, 0].mean(), p[:, 1].mean()
    if p[:, 2].max() < H0(cx, cz) + 1.2: continue                # maanrajan pinnat eivät ole esteitä
    rr, cc = fill_polygon(p[:, 1] - z0, p[:, 0] - x0, shape=(nz, nx))
    if len(rr) == 0:                                               # pystyseinä: rasteroi särmät
        for a, b in ((0, 1), (1, 2), (2, 0)):
            n = max(2, int(np.hypot(*(p[b, :2] - p[a, :2])) / 0.4) + 1)
            t = np.linspace(0, 1, n)
            ix = np.clip((p[a, 0] + (p[b, 0] - p[a, 0]) * t - x0).astype(int), 0, nx - 1)
            iz = np.clip((p[a, 1] + (p[b, 1] - p[a, 1]) * t - z0).astype(int), 0, nz - 1)
            occ[iz, ix] = True; np.maximum.at(top, (iz, ix), p[:, 2].max())
    else:
        occ[rr, cc] = True; np.maximum.at(top, (rr, cc), p[:, 2].max())
occ = ndimage.binary_closing(occ, iterations=1)
# rasteroinnin pienet aukot katoilla umpeen (ei oikeita pihoja, jotka ovat isoja)
hl, hn = ndimage.label(~occ)
hs = ndimage.sum(~occ, hl, range(1, hn + 1))
occ |= np.isin(hl, [i + 1 for i, v in enumerate(hs) if v < 25])
lab, n = ndimage.label(occ)
sizes = ndimage.sum(occ, lab, range(1, n + 1))
occ &= ~np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s < 4])
top[~occ] = 0
# aukkoja täyttämään: soluille, joihin ei osunut korkeutta, naapurien maksimi
holes = occ & (top <= 0)
if holes.any():
    top = np.where(holes, ndimage.maximum_filter(top, 3), top)
print('rakennusalue %.0f %% alueesta' % (100 * occ.mean()))

HR = 2
hnx, hnz = nx // HR + 1, nz // HR + 1
pad = np.zeros((hnz * HR, hnx * HR)); pad[:nz, :nx] = top
hgt = pad.reshape(hnz, HR, hnx, HR).max(axis=(1, 3))
hgt_u8 = np.clip(np.round(hgt * 3), 0, 255).astype(np.uint8)

street = ~occ
# ---------- 1) maanpinta: kadun puoleisten seinien alareunoista ----------
# Vain ajettavan kadun reunalla olevien seinien alimmat kärjet kelpaavat (ei pihoja, ei matalia kattoja).
GR = 4
gnx, gnz = nx // GR + 2, nz // GR + 2
gx, gz = np.meshgrid(x0 + np.arange(gnx) * GR, z0 + np.arange(gnz) * GR)
tree = cKDTree(V[:, :2])
loc_min = np.array([V[idx, 2].min() for idx in tree.query_ball_point(V[:, :2], 2.5)])
wide_min = np.array([V[idx, 2].min() for idx in tree.query_ball_point(V[:, :2], 15.0)])
vix = np.clip((V[:, 0] - x0).astype(int), 0, nx - 1); viz = np.clip((V[:, 1] - z0).astype(int), 0, nz - 1)
streetband = ndimage.binary_dilation(street, iterations=2)
sel = (V[:, 2] <= loc_min + 0.05) & (V[:, 2] <= wide_min + 4.0) & streetband[viz, vix]
base = V[sel]
btree = cKDTree(base[:, :2])
dist, idx = btree.query(np.c_[gx.ravel(), gz.ravel()], k=12)
ground = np.median(base[idx, 2], axis=1).reshape(gnz, gnx)
ground = ndimage.gaussian_filter(ground, 1.5)
# seinän vieressä maa nostetaan vähintään seinän alareunan tasolle, ettei talon alle jää rakoa
near = btree.query_ball_point(np.c_[gx.ravel(), gz.ravel()], 2.2)
flat = ground.ravel()
for k, ids in enumerate(near):
    if ids:
        hb = base[ids, 2]; hb = hb[hb < flat[k] + 2.5]
        if hb.size: flat[k] = max(flat[k], hb.max())
ground = flat.reshape(gnz, gnx) + 0.1
def H(px, pz):
    fx = (px - x0) / GR; fz = (pz - z0) / GR
    ix = int(min(max(fx, 0), gnx - 2)); iz = int(min(max(fz, 0), gnz - 2))
    tx = min(max(fx - ix, 0), 1); tz = min(max(fz - iz, 0), 1)
    return (ground[iz, ix] * (1 - tx) + ground[iz, ix + 1] * tx) * (1 - tz) + (ground[iz + 1, ix] * (1 - tx) + ground[iz + 1, ix + 1] * tx) * tz
gy, gxx = np.gradient(ground, GR)
sl = np.hypot(gy, gxx)
print('maanpinta %.1f..%.1f m, pohjapisteitä %d, rinne kaduilla: mediaani %.0f %%, 95 %% alle %.0f %%' % (
    ground.min(), ground.max(), len(base), 100 * np.median(sl), 100 * np.percentile(sl, 95)))

# ---------- 3) ajettava katuverkko ja aloituspaikat ----------
slab, sn = ndimage.label(street)
border = set(np.unique(np.concatenate([slab[MARGIN + 2, :], slab[-MARGIN - 3, :], slab[:, MARGIN + 2], slab[:, -MARGIN - 3]]))) - {0}
reach = np.isin(slab, list(border))
edt = ndimage.distance_transform_edt(street)
cands = []
DIRS = [(math.cos(a), math.sin(a)) for a in np.arange(16) * math.pi / 8]
for iz in range(MARGIN + 45, nz - MARGIN - 45, 7):
    for ix in range(MARGIN + 45, nx - MARGIN - 45, 7):
        if not reach[iz, ix] or edt[iz, ix] < 5.0 or edt[iz, ix] > 12: continue
        win = occ[max(0, iz - 25):iz + 26, max(0, ix - 25):ix + 26]
        if win.mean() < 0.3: continue
        best, by = 0, 0
        for ex, ez in DIRS:
            run = 0
            while run < 120:
                jx, jz = int(ix + ex * run), int(iz + ez * run)
                if not (0 <= jx < nx and 0 <= jz < nz) or edt[jz, jx] < 3.0: break
                run += 2
            if run > best: best, by = run, math.atan2(ex, ez)
        if best >= 50: cands.append([x0 + ix + 0.5, z0 + iz + 0.5, round(by, 3)])
print('aloituspaikkaehdokkaita', len(cands))

# maan pintaluokka 4 m ruudukossa: 0 katu, 1 jalkakäytävä (rakennuksen vieressä), 2 piha/aukio (kaukana)
gcls = np.zeros((gnz, gnx), np.uint8)
for iz in range(gnz):
    for ix in range(gnx):
        jx, jz = min(ix * GR, nx - 1), min(iz * GR, nz - 1)
        e = edt[jz, jx]
        gcls[iz, ix] = 1 if e < 3.5 else (2 if e > 22 else 0)

# ---------- 4) tallennus ----------
def rle(mask):
    flat = mask.ravel().astype(np.int8)
    ch = np.flatnonzero(np.diff(flat)) + 1
    runs = np.diff(np.concatenate([[0], ch, [flat.size]]))
    return ([0] if flat[0] else []) + runs.tolist()
b64 = lambda a: base64.b64encode(a.tobytes()).decode()
city = {
    'nimi': 'Kruununhaka, Helsinki',
    'lahde': 'Helsingin kaupungin LoD2-rakennusmalli (kolmioverkko), EPSG:3879, origo [25497500, 6673300, 0]',
    'akselit': 'x = itä, y = ylös, z = pohjoinen; metrit',
    'bounds': [x0, z0, x1, z1],
    'occ': {'res': 1, 'x0': x0, 'z0': z0, 'nx': nx, 'nz': nz, 'rle': rle(occ)},
    'hgt': {'res': HR, 'x0': x0, 'z0': z0, 'nx': hnx, 'nz': hnz, 'b64': b64(hgt_u8)},
    'ground': {'res': GR, 'x0': x0, 'z0': z0, 'nx': gnx, 'nz': gnz, 'dm': [int(round(v * 10)) for v in ground.ravel()]},
    'spawns': cands,
}
# kärjet pelin koordinaatteina (x itä, y ylös, z pohjoinen) desimetreinä Int16
VG = np.round(np.c_[V[:, 0], V[:, 2], V[:, 1]] * 10).astype(np.int16)
mesh = {
    'verts': b64(VG), 'faces': b64(F.astype(np.uint16)), 'edges': b64(E.astype(np.uint16)), 'ecol': b64(COL),
    'gcls': b64(gcls), 'nv': int(len(V)), 'nf': int(len(F)), 'ne': int(len(E)),
}
def write(name, glob, data):
    txt = json.dumps(data, separators=(',', ':'))
    with open(outdir + '/' + name, 'w') as f:
        f.write('// Helsinkiralli: generoitu tools/muunna_mesh.py:lla Helsingin LoD2-mallista. Älä muokkaa käsin.\n')
        f.write('(function (root) { var D = ' + txt + ';\n')
        f.write("if (typeof module === 'object' && module.exports) module.exports = D; else root." + glob + " = D; })(typeof window !== 'undefined' ? window : this);\n")
    print('kirjoitettu', name, len(txt) // 1024, 'kt')
write('kaupunki.js', 'HKI_KAUPUNKI', city)
write('kaupunki-mesh.js', 'HKI_MESH', mesh)

if len(sys.argv) > 3:
    from PIL import Image
    img = np.zeros((nz, nx, 3), np.uint8); img[:] = (14, 16, 24)
    img[occ] = (34, 64, 106); img[street & ~reach] = (40, 20, 40)
    for c in cands:
        ix, iz = int(c[0] - x0), int(c[1] - z0); img[max(0, iz - 1):iz + 2, max(0, ix - 1):ix + 2] = (255, 160, 64)
    Image.fromarray(img[::-1]).save(sys.argv[3])
