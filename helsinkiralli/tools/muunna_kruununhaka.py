#!/usr/bin/env python3
"""Muuntaa Helsingin LoD2-viivamallin (Kruununhaka) Helsinkirallin kaupunkidataksi.

Malli sisältää vain viivoja, joten pelin tarvitsemat asiat johdetaan niistä:
  - rakennusalue 1 m ruudukolla (viivat rasteroidaan, pienet aukot suljetaan,
    reunoilta tulvatäyttö = katu, muu = rakennus; umpipihat kuuluvat rakennukseen)
  - rakennusten pohjat (ääriviivat yksinkertaistettuina) ja räystäskorkeudet seiniä varten
  - korkeusruudukko ammusten ja näkyvyyden estämiseen
  - maanpinnan korkeus rakennusten pohjakorkeuksista
  - mallin viivat (>= 1 m) rakennuksittain, jaettuna julkisivuviivoihin ja kattoviivoihin
  - aloituspaikkaehdokkaat leveiltä kaduilta

Käyttö: python3 muunna_kruununhaka.py ../data/kruununhaka-lod2.json ../public/kaupunki.js
Koordinaatit pelissä: x = itä, y = ylös, z = pohjoinen (metrejä mallin origosta).
"""
import json, sys, math, base64
import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from skimage import measure

src, dst = sys.argv[1], sys.argv[2]
d = json.load(open(src))
V = np.array(d['geometry']['vertices'], dtype=np.float64)       # itä, pohjoinen, ylös
E = np.array(d['geometry']['edges'], dtype=np.int64)
A, B = V[E[:, 0]], V[E[:, 1]]
LEN = np.linalg.norm(A - B, axis=1)

MARGIN = 14
x0 = math.floor(V[:, 0].min()) - MARGIN; z0 = math.floor(V[:, 1].min()) - MARGIN
x1 = math.ceil(V[:, 0].max()) + MARGIN;  z1 = math.ceil(V[:, 1].max()) + MARGIN
nx, nz = x1 - x0, z1 - z0
print('ruudukko', nx, 'x', nz, 'm')

# ---------- 1) viivat rasteriin, korkein z soluittain ----------
wall = np.zeros((nz, nx), bool)
zmax = np.full((nz, nx), -1e9)
for a, b in zip(A, B):
    n = max(2, int(np.hypot(*(b[:2] - a[:2])) / 0.4) + 1)
    t = np.linspace(0, 1, n)
    px = a[0] + (b[0] - a[0]) * t; pz = a[1] + (b[1] - a[1]) * t; py = a[2] + (b[2] - a[2]) * t
    ix = np.clip((px - x0).astype(int), 0, nx - 1); iz = np.clip((pz - z0).astype(int), 0, nz - 1)
    wall[iz, ix] = True
    np.maximum.at(zmax, (iz, ix), py)

# ---------- 2) aukot kiinni, katu = reunoilta saavutettava tyhjä alue ----------
sealed = ndimage.binary_dilation(wall, iterations=1)
lab, n = ndimage.label(~sealed)
border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
street = np.isin(lab, list(border))
street = ndimage.binary_dilation(street, iterations=1)           # palautetaan sulkemisen vienyt solu
building = ~street
# pienet irralliset kappaleet (pylväät, kioskit) kaduksi
blab, bn = ndimage.label(building)
sizes = ndimage.sum(building, blab, range(1, bn + 1))
small = np.isin(blab, [i + 1 for i, s in enumerate(sizes) if s < 12])
building &= ~small; street = ~building
blab, bn = ndimage.label(building)
print('rakennuskappaleita', bn, 'katua %.0f %%' % (100 * street.mean()))

# ---------- 3) ääriviivat ja seinäkorkeudet ----------
tree = cKDTree(V[:, :2])
def ground_at(px, pz):
    idx = tree.query_ball_point([px, pz], 3.0)
    return float(V[idx, 2].min()) if idx else None
def eave_at(px, pz):
    idx = tree.query_ball_point([px, pz], 1.6)
    return float(V[idx, 2].max()) if idx else None

buildings = []
gsamples = []                                                    # (x, z, maanpinta)
objs = ndimage.find_objects(blab)
for i, sl in enumerate(objs):
    if sl is None: continue
    sz, sx = sl
    crop = np.pad((blab[sl] == i + 1).astype(float), 1)
    cs = measure.find_contours(crop, 0.5)
    if not cs: continue
    rings = []
    def isb(px, pz):
        jx, jz = int(px - x0), int(pz - z0)
        return 0 <= jx < nx and 0 <= jz < nz and blab[jz, jx] == i + 1
    for c in sorted(cs, key=len, reverse=True):
        c = measure.approximate_polygon(c, tolerance=0.7)
        if len(c) < 4: continue
        pts = [[x0 + sx.start + q - 1 + 0.5, z0 + sz.start + r - 1 + 0.5] for r, q in c[:-1]]
        area = sum(pts[k][0] * pts[(k + 1) % len(pts)][1] - pts[(k + 1) % len(pts)][0] * pts[k][1] for k in range(len(pts))) / 2
        if abs(area) < 30: continue
        # suunta niin, että rakennus on jokaisen särmän vasemmalla puolella (x itä, z pohjoinen)
        votes = 0
        for k in range(len(pts)):
            a_, b_ = pts[k], pts[(k + 1) % len(pts)]
            dx, dz = b_[0] - a_[0], b_[1] - a_[1]; L = math.hypot(dx, dz) or 1
            mx_, mz_ = (a_[0] + b_[0]) / 2, (a_[1] + b_[1]) / 2
            votes += 1 if isb(mx_ - dz / L * 1.2, mz_ + dx / L * 1.2) else -1
        if votes < 0: pts.reverse()
        rings.append(pts)
    if not rings: continue
    allpts = [p for r in rings for p in r]
    eaves_all = [eave_at(*p) for p in allpts]
    known = [e for e in eaves_all if e is not None]
    if not known: continue
    med = float(np.median(known))
    k = 0; ring_eaves = []
    for r in rings:
        ring_eaves.append([(eaves_all[k + j] if eaves_all[k + j] is not None else med) for j in range(len(r))]); k += len(r)
    for p in allpts:
        g = ground_at(*p)
        if g is not None: gsamples.append((p[0], p[1], g))
    buildings.append({'id': i + 1, 'rings': rings, 'eaves': ring_eaves, 'pts': allpts, 'eave': [e for re in ring_eaves for e in re]})
print('rakennuksia seinillä', len(buildings))

# ---------- 4) maanpinta 8 m ruudukolla ----------
GR = 8
gnx, gnz = nx // GR + 2, nz // GR + 2
gs = np.array(gsamples)
gtree = cKDTree(gs[:, :2])
gx, gz = np.meshgrid(x0 + np.arange(gnx) * GR, z0 + np.arange(gnz) * GR)
dist, idx = gtree.query(np.c_[gx.ravel(), gz.ravel()], k=10)
w = 1 / np.maximum(dist, 1) ** 2
ground = (gs[idx, 2] * w).sum(1) / w.sum(1)
ground = ndimage.gaussian_filter(ground.reshape(gnz, gnx), 1.2)
ground = np.maximum(ground, 0.0)
print('maanpinta %.1f..%.1f m' % (ground.min(), ground.max()))
def H(px, pz):
    fx = (px - x0) / GR; fz = (pz - z0) / GR
    ix = min(max(int(fx), 0), gnx - 2); iz = min(max(int(fz), 0), gnz - 2)
    tx = min(max(fx - ix, 0), 1); tz = min(max(fz - iz, 0), 1)
    a = ground[iz, ix] * (1 - tx) + ground[iz, ix + 1] * tx
    b = ground[iz + 1, ix] * (1 - tx) + ground[iz + 1, ix + 1] * tx
    return a * (1 - tz) + b * tz

# ---------- 5) korkeusruudukko 2 m (ammukset, näkyvyys) ----------
HR = 2
hnx, hnz = nx // HR + 1, nz // HR + 1
hgt = np.zeros((hnz, hnx))
med_by_id = {b['id']: float(np.median(b['eave'])) for b in buildings}
bh = np.where(building, zmax, 0)
for b in buildings:
    m = blab == b['id']
    fill = med_by_id[b['id']]
    bh[m & (zmax < -1e8)] = fill
bh[~building] = 0
for iz in range(hnz):
    for ix in range(hnx):
        blk = bh[iz * HR:(iz + 1) * HR, ix * HR:(ix + 1) * HR]
        if blk.size: hgt[iz, ix] = blk.max()
hgt_u8 = np.clip(np.round(hgt * 3), 0, 255).astype(np.uint8)       # 1/3 m tarkkuus

# ---------- 6) viivat rakennuksittain ----------
keep = LEN >= 1.0
bidx = {b['id']: k for k, b in enumerate(buildings)}
for b in buildings: b['lines'] = []
segs_by_b = {}
for b in buildings:
    P = np.concatenate([np.array(r) for r in b['rings']]); Q = np.concatenate([np.roll(np.array(r), -1, axis=0) for r in b['rings']])
    segs_by_b[b['id']] = (P, Q)
def seg_dist(p, P, Q):
    d = Q - P; L2 = (d ** 2).sum(1); L2[L2 == 0] = 1
    t = np.clip(((p - P) * d).sum(1) / L2, 0, 1)
    proj = P + d * t[:, None]
    return np.hypot(*(proj - p).T)
dropped = 0
near_b = ndimage.binary_dilation(building, iterations=2)
def building_near(px, pz):
    jx, jz = int(px - x0), int(pz - z0)
    return 0 <= jx < nx and 0 <= jz < nz and near_b[jz, jx]
for a, b in zip(A[keep], B[keep]):
    mx_, mz_ = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    ix, iz = int(mx_ - x0), int(mz_ - z0)
    lid = 0
    for rr in range(0, 4):
        win = blab[max(0, iz - rr):iz + rr + 1, max(0, ix - rr):ix + rr + 1]
        ids = win[win > 0]
        if ids.size: lid = int(np.bincount(ids).argmax()); break
    if lid not in bidx: dropped += 1; continue
    # viiva kokonaan ajettavalla kadulla (rakennus, jonka sisus päätyi kaduksi) -> pois, ettei näy läpiajettavia rautalankoja
    if all(not building_near(p_[0], p_[1]) for p_ in (a, b, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))): dropped += 1; continue
    bb = buildings[bidx[lid]]
    P, Q = segs_by_b[lid]
    da = seg_dist(a[:2], P, Q); db = seg_dist(b[:2], P, Q)
    k = int(np.argmin(np.maximum(da, db)))
    side = k if max(da[k], db[k]) < 1.3 else -1
    bb['lines'].append([side] + [int(round(v * 10)) for v in (a[0], a[2], a[1], b[0], b[2], b[1])])
print('viivoja', int(keep.sum()), 'pudotettu (ei rakennusta)', dropped)

# ---------- 7) aloituspaikkaehdokkaat ----------
edt = ndimage.distance_transform_edt(street)
cands = []
DIRS = [(math.cos(a), math.sin(a)) for a in np.arange(16) * math.pi / 8]
# vain oikeilta kaduilta: rakennuksia lähellä (ei avoimia reuna-alueita) ja reilusti alueen sisällä
bdist = ndimage.distance_transform_edt(~building)
for iz in range(MARGIN + 45, nz - MARGIN - 45, 7):
    for ix in range(MARGIN + 45, nx - MARGIN - 45, 7):
        if edt[iz, ix] < 5.0 or edt[iz, ix] > 12: continue
        # rakennus molemmin puolin 25 m säteellä (katukuilu)
        win = building[max(0, iz - 25):iz + 26, max(0, ix - 25):ix + 26]
        if win.mean() < 0.3: continue
        best, by = 0, 0
        for ex, ez in DIRS:
            run = 0
            while run < 120:
                jx, jz = int(ix + ex * run), int(iz + ez * run)
                if not (0 <= jx < nx and 0 <= jz < nz) or edt[jz, jx] < 3.0: break
                run += 2
            if run > best: best, by = run, math.atan2(ex, ez)       # yaw: 0 = +z (pohjoinen), pi/2 = +x
        if best >= 50: cands.append([x0 + ix + 0.5, z0 + iz + 0.5, round(by, 3)])
print('aloituspaikkaehdokkaita', len(cands))

# ---------- 8) tallennus ----------
def rle(mask):
    flat = mask.ravel().astype(np.uint8)
    out, cur, run = [], 0, 0
    for v in flat:
        if v == cur: run += 1
        else: out.append(run); cur = v; run = 1
    out.append(run)
    return out
data = {
    'nimi': 'Kruununhaka, Helsinki',
    'lahde': 'Helsingin kaupungin LoD2-rakennusmalli (viivamalli, EPSG:3879, origo ' + str(d.get('coordinateOrigin')) + ')',
    'akselit': 'x = itä, y = ylös, z = pohjoinen; metrit',
    'bounds': [x0, z0, x1, z1],
    'occ': {'res': 1, 'x0': x0, 'z0': z0, 'nx': nx, 'nz': nz, 'rle': rle(building)},
    'hgt': {'res': HR, 'x0': x0, 'z0': z0, 'nx': hnx, 'nz': hnz, 'b64': base64.b64encode(hgt_u8.tobytes()).decode()},
    'ground': {'res': GR, 'x0': x0, 'z0': z0, 'nx': gnx, 'nz': gnz, 'dm': [int(round(v * 10)) for v in ground.ravel()]},
    'spawns': cands,
    'buildings': [{
        'r': [[round(v, 1) for pt, e in zip(r, re) for v in (pt[0], pt[1], max(e, H(*pt) + 3))] for r, re in zip(b['rings'], b['eaves'])],
        'L': b['lines'],
    } for b in buildings],
}
txt = json.dumps(data, separators=(',', ':'))
with open(dst, 'w') as f:
    f.write('// Helsinkiralli: Kruununhaan kaupunkidata, generoitu tools/muunna_kruununhaka.py:lla. Älä muokkaa käsin.\n')
    f.write('(function (root) { var D = ' + txt + ';\n')
    f.write("if (typeof module === 'object' && module.exports) module.exports = D; else root.HKI_KAUPUNKI = D; })(typeof window !== 'undefined' ? window : this);\n")
print('kirjoitettu', dst, len(txt) // 1024, 'kt')

# esikatselukuva
if len(sys.argv) > 3:
    from PIL import Image, ImageDraw
    im = Image.new('RGB', (nx, nz), (14, 16, 24)); dr = ImageDraw.Draw(im)
    for b in buildings:
        for k, r in enumerate(b['rings']):
            dr.polygon([(p[0] - x0, z1 - p[1]) for p in r], fill=(34, 64, 106) if k == 0 else (14, 16, 24), outline=(87, 182, 255))
    for c in cands: dr.ellipse([c[0] - x0 - 2, z1 - c[1] - 2, c[0] - x0 + 2, z1 - c[1] + 2], fill=(255, 160, 64))
    im.save(sys.argv[3])
