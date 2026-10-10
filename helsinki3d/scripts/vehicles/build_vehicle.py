#!/usr/bin/env python3
"""
Nordic Combat – NC-4 panssaroitu 4x4-miehistönkuljetusajoneuvo
+ kauko-ohjattava asejärjestelmä (RWS) ja raskas konekivääri.

Proseduraalinen generaattori: rakentaa mallin perusmuodoista ja kirjoittaa
  nc4_apc.glb            – malli (yksi materiaali, 64² väripalettitekstuurit)
  nc4_apc.manifest.json  – mitat, tilastot, nivelet, kiinnityspisteet, törmäyslaatikot

Koordinaatisto (glTF): yksikkö metri, +Y ylös, +Z eteen, +X ajoneuvon vasen kylki.
Origo maan tasolla akselivälin keskellä.

Käyttö: python3 build_vehicle.py [ulostulokansio]
"""
import io
import json
import math
import os
import struct
import sys

import numpy as np
from PIL import Image
from scipy.spatial import ConvexHull

OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
os.makedirs(OUT, exist_ok=True)
NAME = "nc4_apc"

# ---------------------------------------------------------------------------
# Väripaletti: yksi materiaali, värit/karheus/metallisuus/hehku palettitekstuurista
# ---------------------------------------------------------------------------
GRID, CELL = 8, 8
TEX = GRID * CELL
PALETTE = [  # nimi, perusväri sRGB, karheus, metallisuus, hehku sRGB
    ("paint",      (64, 82, 60),    0.72, 0.00, None),
    ("paint_dark", (41, 51, 40),    0.80, 0.00, None),
    ("paint_alt",  (57, 74, 54),    0.74, 0.00, None),
    ("rubber",     (27, 27, 27),    0.93, 0.00, None),
    ("rim",        (86, 92, 78),    0.62, 0.15, None),
    ("steel",      (118, 118, 112), 0.45, 0.65, None),
    ("gunmetal",   (40, 42, 44),    0.42, 0.55, None),
    ("black",      (18, 18, 18),    0.70, 0.00, None),
    ("glass",      (20, 28, 32),    0.06, 0.00, None),
    ("lamp",       (235, 235, 225), 0.20, 0.00, (255, 248, 230)),
    ("tail",       (160, 20, 15),   0.30, 0.00, (255, 26, 16)),
    ("amber",      (205, 120, 25),  0.30, 0.00, None),
    ("ammo",       (66, 72, 46),    0.70, 0.00, None),
]
SW = {p[0]: i for i, p in enumerate(PALETTE)}


def uv_of(sw):
    i = SW[sw]
    return ((i % GRID + 0.5) / GRID, (i // GRID + 0.5) / GRID)


def palette_images():
    base = Image.new("RGB", (TEX, TEX), (128, 128, 128))
    mr = Image.new("RGB", (TEX, TEX), (255, 200, 0))
    emi = Image.new("RGB", (TEX, TEX), (0, 0, 0))
    for i, (_, col, rough, metal, e) in enumerate(PALETTE):
        x0, y0 = (i % GRID) * CELL, (i // GRID) * CELL
        box = (x0, y0, x0 + CELL, y0 + CELL)
        base.paste(col, box)
        mr.paste((255, int(round(rough * 255)), int(round(metal * 255))), box)
        if e:
            emi.paste(e, box)
    out = []
    for im in (base, mr, emi):
        b = io.BytesIO()
        im.save(b, "PNG", optimize=True)
        out.append(b.getvalue())
    return out


# ---------------------------------------------------------------------------
# Verkkojen rakennusosat
# ---------------------------------------------------------------------------
def nrm(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


class Part:
    def __init__(self, P, N, UV, I):
        self.P = np.asarray(P, float).reshape(-1, 3)
        self.N = np.asarray(N, float).reshape(-1, 3)
        self.UV = np.asarray(UV, float).reshape(-1, 2)
        self.I = np.asarray(I, np.int64).reshape(-1, 3)


def merge(parts):
    P, N, UV, I, off = [], [], [], [], 0
    for p in parts:
        P.append(p.P); N.append(p.N); UV.append(p.UV); I.append(p.I + off)
        off += len(p.P)
    return Part(np.vstack(P), np.vstack(N), np.vstack(UV), np.vstack(I))


def xform(p, R=None, t=(0, 0, 0)):
    R = np.eye(3) if R is None else np.asarray(R, float)
    q = Part(p.P @ R.T + np.asarray(t, float), p.N @ R.T, p.UV.copy(), p.I.copy())
    q.N /= np.linalg.norm(q.N, axis=1, keepdims=True)
    return q


def mirror_x(p):
    return xform(p, np.diag([-1.0, 1.0, 1.0]))


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def convex(pts, sw):
    """Kupera kappale pisteistä, tasavarjostus (normaalit qhullin tasoyhtälöistä)."""
    pts = np.asarray(pts, float)
    h = ConvexHull(pts)
    P, N = [], []
    for simp, eq in zip(h.simplices, h.equations):
        for j in simp:
            P.append(pts[j]); N.append(eq[:3])
    n = len(P)
    return Part(P, N, [uv_of(sw)] * n, np.arange(n).reshape(-1, 3))


def box(x0, x1, y0, y1, z0, z1, sw):
    return convex([(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)], sw)


def sbox(s, xa, xb, y0, y1, z0, z1, sw):
    """Laatikko kyljelle s=±1 (xa, xb itseisarvoina)."""
    return box(s * xa, s * xb, y0, y1, z0, z1, sw)


def obox(center, axes, half, sw):
    c = np.asarray(center, float)
    A = [nrm(a) for a in axes]
    pts = [c + i * half[0] * A[0] + j * half[1] * A[1] + k * half[2] * A[2]
           for i in (-1, 1) for j in (-1, 1) for k in (-1, 1)]
    return convex(pts, sw)


def plate(corners, thick, sw, hint, embed=0.01):
    """Tasomaisen monikulmion päälle nostettu levy (paneeli, ikkuna, luukku)."""
    c = np.asarray(corners, float)
    n = np.zeros(3)
    for i in range(len(c)):  # Newell
        a, b = c[i], c[(i + 1) % len(c)]
        n += np.array([(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])])
    n = nrm(n)
    if np.dot(n, hint) < 0:
        n = -n
    return convex(np.vstack([c - n * embed, c + n * thick]), sw)


def frame_of(w):
    w = nrm(w)
    a = np.array([0.0, 1.0, 0.0]) if abs(w[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = nrm(np.cross(a, w))
    return u, np.cross(w, u), w


def cyl(p0, p1, r0, sw, r1=None, seg=12, cap0=True, cap1=True, smooth=True,
        phase=0.0, sw_cap0=None, sw_cap1=None):
    r1 = r0 if r1 is None else r1
    p0 = np.asarray(p0, float); p1 = np.asarray(p1, float)
    L = np.linalg.norm(p1 - p0)
    u, v, w = frame_of(p1 - p0)
    angs = phase + np.arange(seg) * 2 * np.pi / seg
    dirs = [math.cos(a) * u + math.sin(a) * v for a in angs]
    dr = r1 - r0
    P, N, UV, I = [], [], [], []
    uvs = uv_of(sw)
    if smooth:
        for d in dirs:
            n = nrm(d * L - w * dr)
            P += [p0 + d * r0, p1 + d * r1]; N += [n, n]; UV += [uvs, uvs]
        for i in range(seg):
            a0, a1 = 2 * i, 2 * i + 1
            b0 = 2 * ((i + 1) % seg); b1 = b0 + 1
            I += [[a0, b0, b1], [a0, b1, a1]]
    else:
        for i in range(seg):
            d0, d1 = dirs[i], dirs[(i + 1) % seg]
            n = nrm(nrm(d0 + d1) * L - w * dr)
            b = len(P)
            P += [p0 + d0 * r0, p0 + d1 * r0, p1 + d1 * r1, p1 + d0 * r1]
            N += [n] * 4; UV += [uvs] * 4
            I += [[b, b + 1, b + 2], [b, b + 2, b + 3]]
    for cap, pc, rc, nc, swc in ((cap0, p0, r0, -w, sw_cap0), (cap1, p1, r1, w, sw_cap1)):
        if not cap or rc < 1e-6:
            continue
        uvc = uv_of(swc or sw)
        b = len(P)
        for d in dirs:
            P.append(pc + d * rc); N.append(nc); UV.append(uvc)
        for i in range(1, seg - 1):
            I.append([b, b + i, b + i + 1])
    return Part(P, N, UV, I)


def tube(points, r, sw, seg=6):
    pts = [np.asarray(p, float) for p in points]
    parts = []
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        d = nrm(b - a)
        parts.append(cyl(a - d * (r if i > 0 else 0), b + d * (r if i < len(pts) - 2 else 0), r, sw,
                         seg=seg, cap0=(i == 0), cap1=(i == len(pts) - 2)))
    return merge(parts)


def revolve_x(profile, seg, sw, phase=0.0, smooth_deg=40.0):
    """Pyörähdyskappale X-akselin ympäri. Profiili (x, r) myötäpäivään -> ulospäin osoittavat normaalit."""
    prof = np.asarray(profile, float)
    ns = len(prof) - 1
    segN = []
    for j in range(ns):
        dx, dr = prof[j + 1] - prof[j]
        segN.append(nrm([-dr, dx]))
    cos_lim = math.cos(math.radians(smooth_deg))
    angs = phase + np.arange(seg) * 2 * np.pi / seg
    P, N, I = [], [], []
    for j in range(ns):
        nA = nB = segN[j]
        if j > 0 and np.dot(segN[j - 1], segN[j]) > cos_lim:
            nA = nrm(segN[j - 1] + segN[j])
        if j < ns - 1 and np.dot(segN[j], segN[j + 1]) > cos_lim:
            nB = nrm(segN[j] + segN[j + 1])
        (xa, ra), (xb, rb) = prof[j], prof[j + 1]
        b = len(P)
        for a in angs:
            c, s = math.cos(a), math.sin(a)
            P += [(xa, ra * c, ra * s), (xb, rb * c, rb * s)]
            N += [(nA[0], nA[1] * c, nA[1] * s), (nB[0], nB[1] * c, nB[1] * s)]
        for i in range(seg):
            a0 = b + 2 * i; a1 = a0 + 1
            b0 = b + 2 * ((i + 1) % seg); b1 = b0 + 1
            if ra > 1e-9:
                I.append([a0, b0, b1])
            if rb > 1e-9:
                I.append([a0, b1, a1])
    return Part(P, N, [uv_of(sw)] * len(P), I)


def finalize(p):
    """Kääntää kolmiot normaalien mukaisiksi, poistaa rappeutuneet ja yhdistää samat verteksit."""
    P, N, UV, I = p.P, p.N / np.linalg.norm(p.N, axis=1, keepdims=True), p.UV, p.I.copy()
    a, b, c = P[I[:, 0]], P[I[:, 1]], P[I[:, 2]]
    g = np.cross(b - a, c - a)
    keep = np.linalg.norm(g, axis=1) > 1e-9
    avg = N[I[:, 0]] + N[I[:, 1]] + N[I[:, 2]]
    flip = (g * avg).sum(1) < 0
    I[flip] = I[flip][:, [0, 2, 1]]
    I = I[keep]
    key = np.hstack([np.round(P * 1e5), np.round(N * 1e4), np.round(UV * 1e5)])
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    return Part(P[first], N[first], UV[first], inv[I])


# ---------------------------------------------------------------------------
# Mitat
# ---------------------------------------------------------------------------
WR = 0.625          # pyörän säde (sis. kuviopalat)
XW = 1.00           # pyörän keskiö sivulla
ZF, ZRr = 1.75, -1.75
YB = 1.34           # korin pohja pyörien kohdalla
ROOF = 2.45
ZBACK = -2.95
TURRET_POS = (0.0, ROOF, 0.45)
PIVOT_H = 0.66      # tornin pohjasta kehdon kääntöakseliin


def side_up_x(y):          # yläkyljen kalteva taso
    return 1.20 - 0.15 * (y - 1.80) / 0.65


def side_up(s, y, z):
    return (s * side_up_x(y), y, z)


def ws_pt(x, v):           # tuulilasitaso, v 0 (alareuna) .. 1 (yläreuna)
    return (x, 1.80 + 0.65 * v, 1.78 - 0.66 * v)


def ws_hw(v):
    return 1.20 - 0.15 * v


def hood_y(z):
    return 1.68 - 0.06 * (z - 1.70) / 0.92


WS_N = nrm((0, 0.66, 0.65))
HOOD_N = nrm((0, 1, 0.06 / 0.92))


# ---------------------------------------------------------------------------
# Pyörä
# ---------------------------------------------------------------------------
def build_wheel():
    parts = []
    tire = [(-0.17, 0.36), (-0.195, 0.40), (-0.20, 0.47), (-0.19, 0.54), (-0.165, 0.578), (-0.12, 0.595),
            (0.12, 0.595), (0.165, 0.578), (0.19, 0.54), (0.20, 0.47), (0.195, 0.40), (0.17, 0.36)]
    parts.append(revolve_x(tire, 32, "rubber", smooth_deg=50))
    # kuviopalat: kaksi riviä, nuolikuvio; olkapään puoleinen pää viistetty
    nl = 20
    for xc, psi, ph in ((0.10, 0.22, 0.0), (-0.10, -0.22, 0.5)):
        for k in range(nl):
            th = (k + ph) * 2 * np.pi / nl
            rh = np.array([0, math.cos(th), math.sin(th)])
            th_ = np.array([0, -math.sin(th), math.cos(th)])
            xh = np.array([1.0, 0, 0])
            t2 = math.cos(psi) * th_ + math.sin(psi) * xh
            x2 = -math.sin(psi) * th_ + math.cos(psi) * xh
            c = xh * xc
            pts = []
            for a in (-1, 1):
                outer_end = (a * np.sign(xc)) > 0
                for t in (-1, 1):
                    base = c + t2 * t * 0.042 + x2 * a * 0.085
                    pts.append(base + rh * 0.535)
                    pts.append(base + rh * (0.607 if outer_end else 0.623))
            parts.append(convex(pts, "rubber"))
    rim_front = [(0.075, 0.385), (0.10, 0.37), (0.10, 0.345), (0.05, 0.30), (0.05, 0.17), (0.085, 0.14),
                 (0.12, 0.13), (0.14, 0.095), (0.14, 0.0)]
    parts.append(revolve_x(rim_front, 24, "rim", smooth_deg=30))
    rim_back = [(0.035, 0.0), (0.035, 0.355), (-0.17, 0.355)]
    parts.append(revolve_x(rim_back, 24, "rim", smooth_deg=30))
    for k in range(8):
        a = (k + 0.5) * 2 * np.pi / 8
        p = np.array([0.045, 0.21 * math.cos(a), 0.21 * math.sin(a)])
        parts.append(cyl(p, p + [0.04, 0, 0], 0.021, "steel", seg=6, cap0=False, smooth=False))
    return merge(parts)


# ---------------------------------------------------------------------------
# Runko (staattinen)
# ---------------------------------------------------------------------------
def build_body(wheelL):
    B = []
    add = B.append

    # --- alarunko (V-pohja) ---
    def vsec(z, yb, yc, yd):
        return [(0, yb, z), (0.45, yc, z), (-0.45, yc, z), (0.56, yd, z), (-0.56, yd, z),
                (0.56, 1.36, z), (-0.56, 1.36, z)]
    add(convex(vsec(2.62, 0.82, 0.86, 0.90) + vsec(1.95, 0.48, 0.66, 0.74) +
               vsec(-1.95, 0.48, 0.66, 0.74) + vsec(-2.92, 0.80, 0.84, 0.86), "paint_dark"))

    # --- miehistötila + ohjaamo (kuusikulmainen poikkileikkaus) ---
    cell = []
    for s in (1, -1):
        cell += [(s * 1.20, YB, ZBACK), (s * 1.20, 1.80, ZBACK), (s * 1.05, ROOF, ZBACK),
                 (s * 1.05, ROOF, 1.12), (s * 1.20, 1.80, 1.78), (s * 1.20, YB, 1.78)]
    add(convex(cell, "paint"))

    # --- konepelti ---
    hood = []
    for s in (1, -1):
        hood += [(s * 1.18, YB, 1.70), (s * 1.18, 1.50, 1.70), (s * 0.98, 1.68, 1.70),
                 (s * 1.18, YB, 2.62), (s * 1.18, 1.48, 2.62), (s * 0.98, 1.62, 2.62),
                 (s * 1.00, YB, 2.98), (s * 1.00, 1.44, 2.98), (s * 0.84, 1.55, 2.98)]
    add(convex(hood, "paint"))
    # pullistuma
    bul = []
    for s in (1, -1):
        for z in (1.82, 2.55):
            bul += [(s * 0.42, hood_y(z) - 0.012, z), (s * 0.36, hood_y(z) + 0.065, z)]
        bul += [(s * 0.40, hood_y(2.68) - 0.012, 2.68)]
    add(convex(bul, "paint"))
    # tuuletusritilät
    for s in (1, -1):
        x0, x1, z0, z1 = 0.60, 0.88, 1.86, 2.12
        c = [(s * x0, hood_y(z0), z0), (s * x1, hood_y(z0), z0), (s * x1, hood_y(z1), z1), (s * x0, hood_y(z1), z1)]
        add(plate(c, 0.008, "black", HOOD_N))
        for i in range(4):
            za = z0 + 0.02 + i * 0.064
            zb = za + 0.026
            c = [(s * (x0 + 0.01), hood_y(za), za), (s * (x1 - 0.01), hood_y(za), za),
                 (s * (x1 - 0.01), hood_y(zb), zb), (s * (x0 + 0.01), hood_y(zb), zb)]
            add(plate(c, 0.022, "paint", HOOD_N))
        # konepellin lukot
        add(sbox(s, 0.70, 0.78, 1.54, 1.585, 2.86, 2.94, "steel"))

    # --- etuosa: keula, säleikkö, valot, puskuri ---
    fb = []
    for s in (1, -1):
        fb += [(s * 1.16, 0.80, 2.48), (s * 1.16, 1.36, 2.48), (s * 1.16, 0.80, 2.88), (s * 1.16, 1.36, 2.88),
               (s * 0.98, 0.80, 3.02), (s * 0.98, 1.36, 3.02)]
    add(convex(fb, "paint"))
    add(box(-0.46, 0.46, 0.96, 1.30, 2.99, 3.025, "black"))
    for i in range(5):
        y = 1.00 + i * 0.066
        add(box(-0.46, 0.46, y, y + 0.03, 3.0, 3.048, "paint"))
    bump = []
    for s in (1, -1):
        bump += [(s * 1.10, 0.84, 2.98), (s * 1.10, 1.00, 2.98), (s * 1.10, 1.00, 3.13), (s * 1.10, 0.86, 3.13),
                 (s * 1.10, 0.78, 3.05), (s * 1.10, 0.78, 2.98)]
    add(convex(bump, "paint_dark"))
    for s in (1, -1):
        # ajovalot suojaristikoineen
        add(sbox(s, 0.60, 0.90, 1.04, 1.28, 2.99, 3.07, "paint_dark"))
        add(sbox(s, 0.63, 0.87, 1.07, 1.25, 3.06, 3.078, "lamp"))
        for xb in (0.70, 0.80):
            add(sbox(s, xb - 0.008, xb + 0.008, 1.06, 1.26, 3.07, 3.09, "black"))
        # vilkut viisteessä
        mid = np.array([s * 1.07, 0, 2.95]); d = nrm([-s * 0.18, 0, 0.14]); hn = nrm([s * 0.14, 0, 0.18])
        c = [mid + d * -0.05 + [0, 1.15, 0], mid + d * 0.05 + [0, 1.15, 0],
             mid + d * 0.05 + [0, 1.24, 0], mid + d * -0.05 + [0, 1.24, 0]]
        add(plate(c, 0.02, "amber", hn))
        # hinaussakkelit
        xs = s * 0.62
        add(box(xs - 0.07, xs + 0.07, 0.80, 0.88, 3.10, 3.18, "paint_dark"))
        for dx in (-0.035, 0.035):
            add(cyl((xs + dx, 0.81, 3.16), (xs + dx, 0.71, 3.16), 0.017, "steel", seg=6))
        add(cyl((xs - 0.05, 0.71, 3.16), (xs + 0.05, 0.71, 3.16), 0.017, "steel", seg=6))

    # --- pyörien väliset varustelaatikot, takaosa, lokasuojat ---
    for s in (1, -1):
        sb = []
        for z in (-1.02, 1.02):
            sb += [(s * 0.56, 0.84, z), (s * 1.05, 0.84, z), (s * 1.17, 0.96, z), (s * 1.17, 1.36, z), (s * 0.56, 1.36, z)]
        add(convex(sb, "paint_dark"))
        for z0, z1 in ((-0.95, -0.05), (0.05, 0.95)):
            add(sbox(s, 1.16, 1.183, 0.98, 1.30, z0, z1, "paint_dark"))
            add(sbox(s, 1.18, 1.20, 1.22, 1.26, (z0 + z1) / 2 - 0.06, (z0 + z1) / 2 + 0.06, "steel"))
        # astinlauta oven alla
        add(sbox(s, 1.08, 1.34, 0.80, 0.84, 0.38, 0.98, "steel"))
        add(sbox(s, 1.12, 1.17, 0.70, 0.84, 0.42, 0.48, "paint_dark"))
        add(sbox(s, 1.12, 1.17, 0.70, 0.84, 0.88, 0.94, "paint_dark"))

    rb = box(-1.17, 1.17, 0.82, 1.36, ZBACK, -2.48, "paint_dark")
    add(rb)
    add(box(-1.12, 1.12, 0.82, 0.96, -3.03, -2.90, "paint_dark"))

    def fender(zc, s):
        pl = [(-0.80, 1.00), (-0.60, 1.42), (0.60, 1.42), (0.80, 1.00)]
        hub = np.array([0.0, WR])
        out = []
        for i in range(3):
            a = np.array(pl[i]); b = np.array(pl[i + 1])
            d = nrm(b - a)
            n = np.array([-d[1], d[0]])
            if np.dot(n, (a + b) / 2 - hub) < 0:
                n = -n
            a2 = a - d * 0.03; b2 = b + d * 0.03
            pts = []
            for q in (a2, b2, a2 + n * 0.05, b2 + n * 0.05):
                for x in (1.10, 1.30):
                    pts.append((s * x, q[1], zc + q[0]))
            out.append(convex(pts, "paint_dark"))
        return merge(out)

    for zc in (ZF, ZRr):
        for s in (1, -1):
            add(fender(zc, s))
            add(sbox(s, 0.82, 1.18, 0.42, 0.86, zc - 0.735, zc - 0.715, "black"))   # roiskeläppä
            add(cyl((s * 0.40, WR, zc), (s * 0.80, WR, zc), 0.085, "black", seg=10))  # akseli
            add(cyl((s * 0.61, 0.74, zc - 0.18), (s * 0.63, YB, zc - 0.10), 0.042, "paint_dark", seg=8))

    # --- kyljet: ovet, ikkunat, lisäpanssari, kahvat, peilit ---
    for s in (1, -1):
        hint_lo = (s, 0, 0)
        hint_up = (s * 0.65, 0.15, 0)
        # etuovi: alaosa + yläosa
        add(plate([(s * 1.20, 1.40, 0.40), (s * 1.20, 1.40, 1.62), (s * 1.20, 1.80, 1.62), (s * 1.20, 1.80, 0.40)],
                  0.02, "paint_alt", hint_lo))
        add(plate([side_up(s, 1.80, 0.40), side_up(s, 1.80, 1.62), side_up(s, 2.32, 1.18), side_up(s, 2.32, 0.40)],
                  0.02, "paint_alt", hint_up))
        add(plate([side_up(s, 1.88, 0.52), side_up(s, 1.88, 1.47), side_up(s, 2.24, 1.17), side_up(s, 2.24, 0.52)],
                  0.032, "glass", hint_up))
        add(sbox(s, 1.20, 1.245, 1.62, 1.665, 0.50, 0.64, "steel"))          # ovenkahva
        for y in (1.48, 1.72):
            add(sbox(s, 1.20, 1.25, y, y + 0.08, 1.56, 1.64, "steel"))       # saranat
        # tarttumakahva
        add(tube([(s * 1.27, 1.45, 0.30), (s * 1.27, 1.95, 0.30)], 0.018, "steel"))
        add(sbox(s, 1.19, 1.27, 1.46, 1.49, 0.285, 0.315, "steel"))
        add(sbox(s, 1.15, 1.27, 1.91, 1.94, 0.285, 0.315, "steel"))
        # lisäpanssarilevyt alakyljessä + pultit
        for z0, z1 in ((-2.86, -1.40), (-1.34, 0.30)):
            add(plate([(s * 1.20, 1.40, z0), (s * 1.20, 1.40, z1), (s * 1.20, 1.76, z1), (s * 1.20, 1.76, z0)],
                      0.025, "paint", hint_lo))
            nb = max(2, int(round((z1 - z0) / 0.36)) + 1)
            for zb in np.linspace(z0 + 0.06, z1 - 0.06, nb):
                for yb in (1.43, 1.73):
                    add(sbox(s, 1.22, 1.236, yb - 0.012, yb + 0.012, zb - 0.012, zb + 0.012, "paint_dark"))
        # tähystysikkunat takatilassa
        for zc in (-0.45, -1.75):
            add(plate([side_up(s, 1.95, zc - 0.16), side_up(s, 1.95, zc + 0.16),
                       side_up(s, 2.20, zc + 0.16), side_up(s, 2.20, zc - 0.16)], 0.03, "glass", hint_up))
            add(plate([side_up(s, 2.21, zc - 0.20), side_up(s, 2.21, zc + 0.20),
                       side_up(s, 2.25, zc + 0.20), side_up(s, 2.25, zc - 0.20)], 0.06, "paint_dark", hint_up))
        # peili
        ya = 2.02
        add(cyl((s * side_up_x(ya), ya, 1.50), (s * 1.41, 2.10, 1.50), 0.016, "black", seg=6))
        add(sbox(s, 1.37, 1.45, 1.98, 2.24, 1.48, 1.56, "black"))
        add(sbox(s, 1.38, 1.44, 1.995, 2.225, 1.472, 1.49, "glass"))

    # --- tuulilasi ---
    for s in (1, -1):
        v0, v1 = 0.10, 0.88
        c = [ws_pt(s * 0.07, v0), ws_pt(s * (ws_hw(v0) - 0.11), v0), ws_pt(s * (ws_hw(v1) - 0.11), v1), ws_pt(s * 0.07, v1)]
        add(plate(c, 0.022, "glass", WS_N))
        c = [ws_pt(s * 0.16, 0.115), ws_pt(s * 0.80, 0.115), ws_pt(s * 0.80, 0.135), ws_pt(s * 0.16, 0.135)]
        add(plate(c, 0.03, "black", WS_N))   # pyyhkijä
    add(box(-1.02, 1.02, 2.43, 2.47, 1.08, 1.22, "paint_dark"))   # aurinkolippa

    # --- takaovi, varapyörä, takavalot ---
    hb = (0, 0, -1)
    add(plate([(-1.02, 1.40, ZBACK), (-0.12, 1.40, ZBACK), (-0.12, 2.30, ZBACK), (-1.02, 2.30, ZBACK)], 0.03, "paint_alt", hb))
    add(plate([(-0.78, 1.95, ZBACK), (-0.40, 1.95, ZBACK), (-0.40, 2.20, ZBACK), (-0.78, 2.20, ZBACK)], 0.042, "glass", hb))
    add(box(-0.30, -0.18, 1.78, 1.82, -3.0, -2.97, "steel"))
    for y in (1.50, 1.83, 2.16):
        add(box(-1.07, -0.98, y, y + 0.08, -3.0, -2.95, "steel"))
    add(box(-1.0, -0.15, 0.92, 0.96, -3.18, -2.95, "steel"))               # astin
    add(box(0.30, 0.86, 1.59, 2.09, -3.03, -2.94, "paint_dark"))           # varapyörän teline
    add(xform(wheelL, rot_y(math.pi / 2), (0.58, 1.84, -3.23)))
    for s in (1, -1):
        add(sbox(s, 0.74, 1.06, 0.98, 1.18, -3.0, -2.94, "paint_dark"))
        add(sbox(s, 0.77, 0.90, 1.005, 1.155, -3.008, -2.99, "tail"))
        add(sbox(s, 0.92, 1.03, 1.005, 1.155, -3.008, -2.99, "amber"))
        xs = s * 0.55
        add(box(xs - 0.07, xs + 0.07, 0.84, 0.92, -3.10, -3.0, "paint_dark"))
        for dx in (-0.035, 0.035):
            add(cyl((xs + dx, 0.85, -3.08), (xs + dx, 0.75, -3.08), 0.017, "steel", seg=6))
        add(cyl((xs - 0.05, 0.75, -3.08), (xs + 0.05, 0.75, -3.08), 0.017, "steel", seg=6))
    add(box(-0.09, 0.09, 0.84, 0.98, -3.10, -3.0, "paint_dark"))           # vetokoukku
    add(cyl((-0.80, 0.80, 0.60), (-1.18, 0.78, 0.60), 0.045, "black", seg=8))  # pakoputki
    add(cyl((0, 0.84, -3.13), (0, 0.98, -3.13), 0.03, "steel", seg=8))

    # --- katto ---
    add(cyl((0, ROOF - 0.01, 0.45), (0, ROOF + 0.035, 0.45), 0.44, "paint_dark", seg=24))  # tornin kiinteä kehä
    for s in (1, -1):
        xc = s * 0.47
        add(box(xc - 0.33, xc + 0.33, ROOF - 0.01, ROOF + 0.035, -2.05, -1.35, "paint_alt"))  # luukku
        add(box(xc - 0.10, xc + 0.10, ROOF + 0.035, ROOF + 0.06, -1.72, -1.68, "steel"))      # kahva
        for zh in (-1.95, -1.45):
            add(sbox(s, 0.80, 0.86, ROOF, ROOF + 0.07, zh - 0.04, zh + 0.04, "steel"))       # saranat
        # kaiteet
        x = s * 0.97
        add(tube([(x, ROOF - 0.01, 0.92), (x, ROOF + 0.13, 0.86), (x, ROOF + 0.13, -2.70), (x, ROOF - 0.01, -2.78)], 0.018, "paint_dark"))
        for zp in (-0.45, -1.65):
            add(cyl((x, ROOF - 0.01, zp), (x, ROOF + 0.13, zp), 0.016, "paint_dark", seg=6, cap0=False))
        # savunheitinpatterit
        add(sbox(s, 0.70, 0.98, ROOF - 0.01, ROOF + 0.07, 0.86, 1.06, "paint_dark"))
        d = nrm((s * 0.45, 0.62, 0.65))
        for xo in (0.77, 0.90):
            for zo in (0.92, 1.01):
                p0 = np.array((s * xo, ROOF + 0.05, zo))
                add(cyl(p0, p0 + d * 0.20, 0.036, "paint_dark", seg=8, cap0=False, sw_cap1="black"))
        # antennit
        add(cyl((s * 0.88, ROOF - 0.01, -2.72), (s * 0.88, ROOF + 0.10, -2.72), 0.045, "black", seg=8))
        add(cyl((s * 0.88, ROOF + 0.10, -2.72), (s * 0.93, ROOF + 1.90, -2.97), 0.009, "black", r1=0.003, seg=5, cap0=False))
    ac = []
    for s in (1, -1):
        ac += [(s * 0.40, ROOF - 0.01, -2.86), (s * 0.40, ROOF + 0.17, -2.86), (s * 0.40, ROOF - 0.01, -2.36),
               (s * 0.40, ROOF + 0.12, -2.36), (s * 0.40, ROOF + 0.17, -2.44)]
    add(convex(ac, "paint"))
    add(box(-0.30, 0.30, ROOF + 0.16, ROOF + 0.18, -2.80, -2.50, "paint_dark"))
    return merge(B)


# ---------------------------------------------------------------------------
# Torni (kääntyy Y:n ympäri) ja kehto (kääntyy X:n ympäri) – RWS + raskas konekivääri
# ---------------------------------------------------------------------------
def build_turret():
    T = []
    T.append(cyl((0, 0.03, 0), (0, 0.13, 0), 0.39, "paint", seg=24))
    tt = []
    for y in (0.12, 0.24):
        for s in (1, -1):
            tt += [(s * 0.30, y, 0.28), (s * 0.30, y, -0.28), (s * 0.22, y, 0.36), (s * 0.22, y, -0.36)]
    T.append(convex(tt, "paint"))
    col = []
    for s in (1, -1):
        col += [(s * 0.22, 0.24, 0.22), (s * 0.22, 0.24, -0.22), (s * 0.13, 0.51, 0.07), (s * 0.13, 0.51, -0.07)]
    T.append(convex(col, "paint"))
    for s in (1, -1):
        T.append(sbox(s, 0.105, 0.15, 0.49, 0.73, -0.065, 0.065, "paint"))
        T.append(cyl((s * 0.15, PIVOT_H, 0), (s * 0.17, PIVOT_H, 0), 0.05, "paint_dark", seg=12))
    T.append(box(-0.20, 0.20, 0.24, 0.36, -0.36, -0.24, "paint_dark"))     # johdinkotelo
    return merge(T)


def build_cradle():
    C = []
    gy = 0.135  # piipun akselin korkeus kääntöakselista
    C.append(cyl((-0.16, 0, 0), (0.16, 0, 0), 0.045, "paint_dark", seg=12))
    C.append(box(-0.095, 0.095, -0.02, 0.05, -0.36, 0.36, "paint_dark"))
    rec = []
    for s in (1, -1):
        rec += [(s * 0.075, 0.05, -0.42), (s * 0.075, 0.05, 0.26), (s * 0.075, 0.20, -0.42), (s * 0.075, 0.20, 0.26),
                (s * 0.055, 0.225, -0.40), (s * 0.055, 0.225, 0.24)]
    C.append(convex(rec, "gunmetal"))                                       # lukon kehys
    C.append(box(-0.02, 0.02, 0.225, 0.24, -0.30, 0.10, "gunmetal"))        # syöttökannen sarana
    C.append(cyl((0, 0.13, -0.42), (0, 0.13, -0.50), 0.035, "gunmetal", seg=10))
    C.append(box(-0.05, 0.05, 0.07, 0.18, -0.535, -0.50, "gunmetal"))      # laukaisulaite
    C.append(box(-0.06, 0.06, 0.075, 0.195, 0.26, 0.34, "gunmetal"))       # piipun lukitus
    C.append(cyl((0, gy, 0.30), (0, gy, 0.62), 0.040, "gunmetal", seg=10))  # piipun suojaputki
    for z in (0.40, 0.55):
        C.append(cyl((0, gy, z), (0, gy, z + 0.02), 0.046, "gunmetal", seg=10))
    C.append(cyl((0, gy, 0.62), (0, gy, 1.40), 0.023, "gunmetal", seg=8, cap0=False))
    C.append(cyl((0, gy, 1.36), (0, gy, 1.46), 0.034, "gunmetal", seg=8, sw_cap1="black"))  # liekinsammutin
    C.append(box(-0.008, 0.008, gy + 0.035, gy + 0.10, 0.655, 0.675, "gunmetal"))         # kantokahva
    C.append(box(-0.012, 0.012, gy + 0.095, gy + 0.11, 0.60, 0.74, "gunmetal"))
    # patruunalaatikko (+X) ja syöttökouru
    C.append(box(0.17, 0.40, -0.06, 0.22, -0.32, 0.06, "ammo"))
    C.append(box(0.165, 0.405, 0.22, 0.245, -0.33, 0.07, "ammo"))
    C.append(box(0.26, 0.31, 0.10, 0.16, 0.06, 0.075, "steel"))
    C.append(box(0.075, 0.17, 0.10, 0.16, -0.30, -0.14, "paint_dark"))
    C.append(box(0.075, 0.17, 0.165, 0.225, -0.20, -0.04, "black"))
    # tähtäin- ja kamerayksikkö (-X)
    C.append(box(-0.42, -0.19, -0.02, 0.22, -0.30, 0.20, "paint"))
    C.append(box(-0.39, -0.22, 0.11, 0.19, 0.20, 0.215, "glass"))
    C.append(cyl((-0.305, 0.035, 0.20), (-0.305, 0.035, 0.225), 0.055, "black", seg=12))
    C.append(cyl((-0.305, 0.035, 0.225), (-0.305, 0.035, 0.23), 0.042, "glass", seg=12, cap0=False))
    C.append(box(-0.43, -0.18, 0.22, 0.235, 0.10, 0.27, "paint_dark"))     # aurinkosuoja
    C.append(box(-0.19, -0.075, 0.10, 0.16, -0.30, -0.16, "paint_dark"))
    return merge(C)


# ---------------------------------------------------------------------------
# glTF/GLB-kirjoitin
# ---------------------------------------------------------------------------
class GLB:
    def __init__(self):
        self.bin = bytearray()
        self.j = {"asset": {"version": "2.0", "generator": "Nordic Combat build_vehicle.py"},
                  "scene": 0, "scenes": [], "nodes": [], "meshes": [], "accessors": [], "bufferViews": [],
                  "buffers": [], "materials": [], "textures": [], "images": [], "samplers": []}

    def view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        bv = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        if target:
            bv["target"] = target
        self.bin += data
        self.j["bufferViews"].append(bv)
        return len(self.j["bufferViews"]) - 1

    def accessor(self, arr, ctype, typ, target, minmax=False):
        a = {"bufferView": self.view(arr.tobytes(), target), "componentType": ctype,
             "count": int(arr.shape[0]), "type": typ}
        if minmax:
            a["min"] = [float(x) for x in arr.min(0)]
            a["max"] = [float(x) for x in arr.max(0)]
        self.j["accessors"].append(a)
        return len(self.j["accessors"]) - 1

    def mesh(self, name, p, mat):
        P = p.P.astype(np.float32); N = p.N.astype(np.float32); UV = p.UV.astype(np.float32)
        N /= np.linalg.norm(N, axis=1, keepdims=True)
        if len(P) < 65535:
            idx = p.I.astype(np.uint16).reshape(-1); ct = 5123
        else:
            idx = p.I.astype(np.uint32).reshape(-1); ct = 5125
        prim = {"attributes": {"POSITION": self.accessor(P, 5126, "VEC3", 34962, True),
                               "NORMAL": self.accessor(N, 5126, "VEC3", 34962),
                               "TEXCOORD_0": self.accessor(UV, 5126, "VEC2", 34962)},
                "indices": self.accessor(idx, ct, "SCALAR", 34963), "material": mat, "mode": 4}
        self.j["meshes"].append({"name": name, "primitives": [prim]})
        return len(self.j["meshes"]) - 1

    def node(self, name, **kw):
        n = {"name": name}
        n.update({k: v for k, v in kw.items() if v is not None})
        self.j["nodes"].append(n)
        return len(self.j["nodes"]) - 1

    def write(self, path):
        self.j["buffers"] = [{"byteLength": len(self.bin)}]
        for k in [k for k, v in self.j.items() if isinstance(v, list) and not v]:
            del self.j[k]
        js = json.dumps(self.j, separators=(",", ":")).encode()
        js += b" " * ((4 - len(js) % 4) % 4)
        while len(self.bin) % 4:
            self.bin.append(0)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, total))
            f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
            f.write(struct.pack("<II", len(self.bin), 0x004E4942)); f.write(self.bin)
        return total


def main():
    wheelL = build_wheel()
    body = finalize(build_body(wheelL))
    wL = finalize(wheelL)
    wR = finalize(mirror_x(wheelL))
    turret = finalize(build_turret())
    cradle = finalize(build_cradle())

    g = GLB()
    imgs = palette_images()
    for i, data in enumerate(imgs):
        g.j["images"].append({"name": ["nc4_basecolor", "nc4_metal_rough", "nc4_emissive"][i],
                              "bufferView": g.view(data), "mimeType": "image/png"})
    g.j["samplers"].append({"magFilter": 9728, "minFilter": 9728, "wrapS": 33071, "wrapT": 33071})
    g.j["textures"] = [{"sampler": 0, "source": i} for i in range(3)]
    g.j["materials"].append({
        "name": "NC4_Palette",
        "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicRoughnessTexture": {"index": 1},
                                 "metallicFactor": 1.0, "roughnessFactor": 1.0},
        "emissiveTexture": {"index": 2}, "emissiveFactor": [1.0, 1.0, 1.0],
        "extensions": {"KHR_materials_emissive_strength": {"emissiveStrength": 2.0}},
    })
    g.j["extensionsUsed"] = ["KHR_materials_emissive_strength"]

    m_body = g.mesh("NC4_Body", body, 0)
    m_wl = g.mesh("NC4_Wheel_L", wL, 0)
    m_wr = g.mesh("NC4_Wheel_R", wR, 0)
    m_tu = g.mesh("NC4_Turret", turret, 0)
    m_cr = g.mesh("NC4_Cradle", cradle, 0)

    STEER = 30.0
    PMIN, PMAX = -15.0, 50.0
    gy = 0.135
    kids = []
    kids.append(g.node("Body", mesh=m_body))
    wheel_nodes = {}
    for nm, s, z, front in (("FL", 1, ZF, True), ("FR", -1, ZF, True), ("RL", 1, ZRr, False), ("RR", -1, ZRr, False)):
        mesh = m_wl if s > 0 else m_wr
        pos = [s * XW, WR, z]
        if front:
            w = g.node(f"Wheel_{nm}", mesh=mesh, extras={"spinAxis": "x", "radius": WR})
            st = g.node(f"Steer_{nm}", translation=pos, children=[w],
                        extras={"steerAxis": "y", "maxSteerDeg": STEER})
            kids.append(st)
        else:
            kids.append(g.node(f"Wheel_{nm}", mesh=mesh, translation=pos, extras={"spinAxis": "x", "radius": WR}))
        wheel_nodes[nm] = pos
    muzzle = g.node("Muzzle", translation=[0, gy, 1.46])
    camg = g.node("Cam_Gunner", translation=[-0.305, 0.15, 0.24])
    cradle_n = g.node("Cradle", mesh=m_cr, translation=[0, PIVOT_H, 0], children=[muzzle, camg],
                      extras={"pitchAxis": "x", "pitchMinDeg": PMIN, "pitchMaxDeg": PMAX,
                              "note": "positiivinen kulma = piippu ylös (rotation.x negatiivinen three.js:ssä)"})
    turret_n = g.node("Turret", mesh=m_tu, translation=list(TURRET_POS), children=[cradle_n],
                      extras={"yawAxis": "y", "yawLimitDeg": None})
    kids.append(turret_n)
    empties = {
        "Headlight_L": [0.75, 1.16, 3.10], "Headlight_R": [-0.75, 1.16, 3.10],
        "Taillight_L": [0.835, 1.08, -3.02], "Taillight_R": [-0.835, 1.08, -3.02],
        "Cam_Driver": [0.55, 2.10, 1.05], "Exhaust": [-1.18, 0.80, 0.60],
    }
    for k, v in empties.items():
        kids.append(g.node(k, translation=v))
    root = g.node("NC4_APC", children=kids, extras={"manifest": f"{NAME}.manifest.json"})
    g.j["scenes"].append({"name": "NC4", "nodes": [root]})
    size = g.write(os.path.join(OUT, f"{NAME}.glb"))

    # --- tilastot & manifesti ---
    def ntri(p): return int(len(p.I))
    def nvert(p): return int(len(p.P))
    allP = [body.P,
            *[wL.P + wheel_nodes[k] for k in ("FL", "RL")], *[wR.P + wheel_nodes[k] for k in ("FR", "RR")],
            turret.P + TURRET_POS, cradle.P + np.add(TURRET_POS, [0, PIVOT_H, 0])]
    allP = np.vstack(allP)
    pivot_world = [TURRET_POS[0], TURRET_POS[1] + PIVOT_H, TURRET_POS[2]]
    mn, mx = allP.min(0), allP.max(0)
    tris = {"body": ntri(body), "wheel": ntri(wL), "turret": ntri(turret), "cradle": ntri(cradle)}
    total_tris = tris["body"] + 4 * tris["wheel"] + tris["turret"] + tris["cradle"]
    total_verts = nvert(body) + 2 * nvert(wL) + 2 * nvert(wR) + nvert(turret) + nvert(cradle)
    manifest = {
        "name": "NC-4 panssaroitu miehistönkuljetusajoneuvo 4x4 + RWS (raskas konekivääri)",
        "file": f"{NAME}.glb",
        "generator": "build_vehicle.py",
        "units": "m",
        "axes": {"up": "+Y", "forward": "+Z", "left": "+X"},
        "origin": "maan tasolla, akselivälin keskellä",
        "bounds": {"min": [round(float(x), 3) for x in mn], "max": [round(float(x), 3) for x in mx]},
        "dimensions": {"length": round(float(mx[2] - mn[2]), 2), "width": round(float(mx[0] - mn[0]), 2),
                       "widthBody": 2.40, "roofHeight": ROOF,
                       "heightToRwsTop": round(float(pivot_world[1] + cradle.P[:, 1].max()), 2),
                       "heightWithAntennas": round(float(mx[1]), 2), "groundClearance": 0.48},
        "stats": {"triangles": total_tris, "trianglesPerMesh": tris, "vertices": total_verts,
                  "drawCalls": 7, "materials": 1, "textures": "3 × 64² PNG (väri, metallisuus/karheus, hehku)",
                  "fileSizeBytes": size},
        "material": {"name": "NC4_Palette", "note": "Kaikki värit palettitekstuurista; UV:t osoittavat värin keskelle, "
                     "joten suodatus on NEAREST ja mipmapit eivät sekoita värejä.",
                     "palette": [{"name": n, "uv": [round(x, 4) for x in uv_of(n)], "baseColorSRGB": c, "roughness": r,
                                  "metalness": m, "emissive": bool(e)} for n, c, r, m, e in PALETTE],
                     "emissiveStrength": 2.0},
        "wheels": {"radius": WR, "width": 0.40, "wheelbase": ZF - ZRr, "track": 2 * XW,
                   "nodes": {k: {"node": ("Steer_" if k[0] == "F" else "Wheel_") + k, "position": v} for k, v in wheel_nodes.items()},
                   "spin": "Wheel_*-solmun rotation.x += ajettu matka / säde (sama etumerkki kaikilla pyörillä, eteenpäin ajo = positiivinen)",
                   "steer": {"nodes": ["Steer_FL", "Steer_FR"], "axis": "y", "maxDeg": STEER}},
        "articulation": {
            "Turret": {"pivot": list(TURRET_POS), "axis": "y", "limits": None},
            "Cradle": {"pivot": [round(x, 3) for x in pivot_world], "axis": "x", "minDeg": PMIN, "maxDeg": PMAX},
        },
        "attachPoints": {
            "Muzzle": {"parent": "Cradle", "local": [0, gy, 1.46], "worldAtRest": [0, round(pivot_world[1] + gy, 3), round(pivot_world[2] + 1.46, 3)]},
            "Cam_Gunner": {"parent": "Cradle", "local": [-0.305, 0.15, 0.24]},
            **{k: {"parent": "NC4_APC", "local": v} for k, v in empties.items()},
        },
        "collision": {
            "note": "Kevyt törmäysmalli: akselisuuntaiset laatikot ajoneuvon omassa koordinaatistossa.",
            "boxes": [
                {"name": "hull", "min": [-1.20, 0.48, -3.10], "max": [1.20, ROOF, 1.80]},
                {"name": "front", "min": [-1.18, 0.78, 1.80], "max": [1.18, 1.62, 3.13]},
                {"name": "spare", "min": [-0.05, 1.21, -3.45], "max": [1.21, 2.47, -2.95]},
                {"name": "rws", "min": [-0.45, ROOF, 0.0], "max": [0.45, round(pivot_world[1] + 0.25, 2), 0.90]},
            ]},
        "weapon": {"type": "raskas konekivääri kauko-ohjattavassa asejärjestelmässä (RWS)", "barrelLength": 1.14,
                   "muzzleNode": "Muzzle", "ammoBoxSide": "+X", "sightSide": "-X"},
        "attribution": "Oma proseduraalinen malli – ei lisenssin vaatimaa lähdemainintaa.",
    }
    with open(os.path.join(OUT, f"{NAME}.manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(json.dumps({"triangles": total_tris, "per_mesh": tris, "vertices": total_verts, "bytes": size,
                      "bounds": manifest["bounds"], "dims": manifest["dimensions"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
