#!/usr/bin/env python3
"""
Nordic Combat – NC-H6 kevyt helikopteri.
Pohjana cadnav.com:n AH-6 Little Bird -malli (3DS). Muuntaa pelivalmiiksi GLB:ksi:
  - Z-ylös -> +Y ylös, nokka +Z, +X vasen kylki, metri; origo maan tasolla pääroottorin akselin alla
  - raskaimmat pienet osat kevennetään (pyfqmr), siluetin osat pysyvät ennallaan
  - yksi palettimateriaali + läpinäkyvä lasi -> 4 piirtokutsua (runko 2, pääroottori, pyrstöroottori)
  - roottorit omina solmuinaan oikeissa kääntöpisteissä, kiinnityspisteet tyhjinä solmuina

Käyttö: python3 build_helicopter.py <AH-6 Little Bird.3ds> [ulostulokansio]
"""
import io
import json
import math
import os
import struct
import sys

import numpy as np
import pyfqmr
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_vehicle import GLB, Part, finalize  # noqa: E402

NAME = "nc_h6"

# --- paletti --------------------------------------------------------------
GRID, CELL = 8, 8
TEX = GRID * CELL
PALETTE = [  # nimi, sRGB, karheus, metallisuus
    ("body",      (65, 82, 56),    0.70, 0.00),
    ("interior",  (118, 136, 108), 0.85, 0.00),
    ("blade",     (50, 50, 48),    0.60, 0.00),
    ("plank",     (74, 62, 50),    0.80, 0.00),
    ("metal",     (98, 98, 98),    0.45, 0.60),
    ("exhaust",   (120, 98, 70),   0.50, 0.70),
    ("black",     (36, 36, 36),    0.70, 0.00),
    ("lightgrey", (156, 158, 152), 0.60, 0.00),
    ("gunmetal",  (40, 42, 44),    0.42, 0.55),
    ("lens",      (20, 28, 32),    0.06, 0.00),
]
SW = {p[0]: i for i, p in enumerate(PALETTE)}
MAT_TO_SW = {"new_gun_metal": "gunmetal", "Interior_green": "interior", "body_green": "body",
             "rotor_black": "blade", "main_rotor_metal": "metal", "engine_exh": "exhaust",
             "black": "black", "Material": "lightgrey", "Glass": "GLASS"}
OBJ_SW = {"gunhldf": "plank", "senslens": "lens"}          # osakohtaiset korjaukset
DROP = {"intrcnpy"}                                         # kuomun sisäpinta: lasi on kaksipuolinen
TARGET = {  # kevennettävät osat: kolmioita jäljelle
    "gunsmth": 1100, "mnrotsm": 1400, "skidsmth": 950, "rocksmth": 1100, "stiksmth": 300, "pylnsmth": 520,
    "antnsmth": 480, "seatsmth": 420, "tailsmth": 650, "gunhldf": 420, "fireextg": 120, "seatbakf": 420,
    "intrsmth": 380, "tlrtsmth": 240, "ruddpedl": 120, "nozzle": 120, "senslens": 60,
}
MAIN_ROTOR = {"mnrotsm", "mnrotfl", "mnrtblsm", "mnrtblfl"}
TAIL_ROTOR = {"tlrtsmth", "tlrtflat"}

# 3DS (Z ylös) -> glTF ja siirto: origo maahan pääroottorin akselin alle
R = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)
SHIFT = np.array([0.0, 7.149, 0.247])
MAIN_PIVOT = np.array([0.0, 2.67, 0.0])
TAIL_PIVOT = np.array([0.231, 1.822, -4.563])
ROTOR_R, TAIL_R = 4.04, 0.74


def uv_of(sw):
    i = SW[sw]
    return ((i % GRID + 0.5) / GRID, (i // GRID + 0.5) / GRID)


def palette_images():
    base = Image.new("RGB", (TEX, TEX), (128, 128, 128))
    mr = Image.new("RGB", (TEX, TEX), (255, 200, 0))
    for i, (_, col, rough, metal) in enumerate(PALETTE):
        x0, y0 = (i % GRID) * CELL, (i // GRID) * CELL
        box = (x0, y0, x0 + CELL, y0 + CELL)
        base.paste(col, box)
        mr.paste((255, int(round(rough * 255)), int(round(metal * 255))), box)
    out = []
    for im in (base, mr):
        b = io.BytesIO()
        im.save(b, "PNG", optimize=True)
        out.append(b.getvalue())
    return out


# --- 3DS-lukija -----------------------------------------------------------
def read_3ds(path):
    data = open(path, "rb").read()
    objs = []

    def cstr(o):
        e = data.index(b"\0", o)
        return data[o:e].decode("latin-1"), e + 1

    def walk(o, end):
        while o + 6 <= end:
            cid, ln = struct.unpack_from("<HI", data, o)
            if ln < 6 or o + ln > end:
                break
            b, e = o + 6, o + ln
            if cid in (0x4D4D, 0x3D3D, 0x4100):
                walk(b, e)
            elif cid == 0x4000:
                n, p = cstr(b)
                objs.append({"name": n, "fm": {}, "sg": None})
                walk(p, e)
            elif cid == 0x4110:
                n = struct.unpack_from("<H", data, b)[0]
                objs[-1]["v"] = np.frombuffer(data, "<f4", n * 3, b + 2).reshape(-1, 3).astype(float)
            elif cid == 0x4120:
                n = struct.unpack_from("<H", data, b)[0]
                objs[-1]["f"] = np.frombuffer(data, "<u2", n * 4, b + 2).reshape(-1, 4)[:, :3].astype(np.int64)
                walk(b + 2 + n * 8, e)
            elif cid == 0x4130:
                n, p = cstr(b)
                k = struct.unpack_from("<H", data, p)[0]
                objs[-1]["fm"][n] = np.frombuffer(data, "<u2", k, p + 2).astype(np.int64)
            elif cid == 0x4150:
                objs[-1]["sg"] = np.frombuffer(data, "<u4", len(objs[-1]["f"]), b).astype(np.int64)
            o = e

    walk(0, len(data))
    return [o for o in objs if "v" in o and "f" in o]


# --- normaalit ------------------------------------------------------------
def normals_by_groups(V, F, sg):
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    acc = {}
    for fi in range(len(F)):
        if sg[fi]:
            for vi in F[fi]:
                k = (vi, sg[fi])
                acc[k] = acc.get(k, 0) + fn[fi]
    P, N, I = [], [], []
    for fi in range(len(F)):
        for vi in F[fi]:
            n = acc[(vi, sg[fi])] if sg[fi] else fn[fi]
            P.append(V[vi]); N.append(n)
        I.append([len(P) - 3, len(P) - 2, len(P) - 1])
    return P, N, I


def normals_by_angle(V, F, crease_deg=45.0):
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    fu = fn / np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
    adj = [[] for _ in range(len(V))]
    for fi, f in enumerate(F):
        for vi in f:
            adj[vi].append(fi)
    c = math.cos(math.radians(crease_deg))
    P, N, I = [], [], []
    for fi, f in enumerate(F):
        for vi in f:
            nb = [g for g in adj[vi] if np.dot(fu[g], fu[fi]) > c]
            P.append(V[vi]); N.append(fn[nb].sum(0))
        I.append([len(P) - 3, len(P) - 2, len(P) - 1])
    return P, N, I


def simplify(V, F, target):
    s = pyfqmr.Simplify()
    s.setMesh(V.astype(np.float64), F.astype(np.int32))
    s.simplify_mesh(target_count=target, aggressiveness=7, preserve_border=True, verbose=False)
    V2, F2, _ = s.getMesh()
    return np.asarray(V2, float), np.asarray(F2, np.int64)


def to_part(P, N, I, sw):
    N = np.asarray(N, float)
    ln = np.linalg.norm(N, axis=1, keepdims=True)
    N = np.where(ln > 1e-12, N / np.maximum(ln, 1e-12), [0.0, 1.0, 0.0])
    return Part(P, N, [uv_of(sw) if sw != "GLASS" else (0.0, 0.0)] * len(P), I)


# --- muunnos ----------------------------------------------------------------
def main():
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "out"
    os.makedirs(out, exist_ok=True)
    objs = read_3ds(src)
    groups = {"body": [], "glass": [], "main": [], "tail": []}
    report = []
    src_tris = 0
    for o in objs:
        name = o["name"]
        src_tris += len(o["f"])
        if name in DROP:
            report.append((name, len(o["f"]), 0)); continue
        V = o["v"] @ R.T + SHIFT
        F = o["f"]
        sg = o["sg"] if o["sg"] is not None else np.zeros(len(F), np.int64)
        fmat = np.array(["Material"] * len(F), dtype=object)
        for m, idx in o["fm"].items():
            fmat[idx] = m
        kept = 0
        for m in sorted(set(fmat.tolist())):
            sel = np.where(fmat == m)[0]
            sw = OBJ_SW.get(name, MAT_TO_SW.get(m, "lightgrey"))
            Fm = F[sel]
            if name in TARGET and len(Fm) > TARGET[name] * 1.1:
                used = np.unique(Fm)
                remap = -np.ones(len(V), np.int64); remap[used] = np.arange(len(used))
                Vs, Fs = simplify(V[used], remap[Fm], int(TARGET[name] * len(Fm) / len(F)))
                P, N, I = normals_by_angle(Vs, Fs, 50.0 if name.endswith("smth") or name in ("gunhldf", "fireextg", "nozzle", "senslens", "ruddpedl", "seatbakf") else 30.0)
            else:
                P, N, I = normals_by_groups(V, Fm, sg[sel])
            part = to_part(P, N, I, sw)
            kept += len(part.I)
            if name in MAIN_ROTOR:
                part.P -= MAIN_PIVOT; groups["main"].append(part)
            elif name in TAIL_ROTOR:
                part.P -= TAIL_PIVOT; groups["tail"].append(part)
            elif sw == "GLASS":
                groups["glass"].append(part)
            else:
                groups["body"].append(part)
        report.append((name, len(o["f"]), kept))

    from build_vehicle import merge
    meshes = {k: finalize(merge(v)) for k, v in groups.items()}

    g = GLB()
    g.j["asset"]["copyright"] = "3D-malli: cadnav.com (AH-6 Little Bird), muokattu Nordic Combatia varten"
    for i, data in enumerate(palette_images()):
        g.j["images"].append({"name": ["nch6_basecolor", "nch6_metal_rough"][i], "bufferView": g.view(data), "mimeType": "image/png"})
    g.j["samplers"].append({"magFilter": 9728, "minFilter": 9728, "wrapS": 33071, "wrapT": 33071})
    g.j["textures"] = [{"sampler": 0, "source": 0}, {"sampler": 0, "source": 1}]
    g.j["materials"] = [
        {"name": "NCH6_Palette", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0},
         "metallicRoughnessTexture": {"index": 1}, "metallicFactor": 1.0, "roughnessFactor": 1.0}},
        {"name": "NCH6_Glass", "alphaMode": "BLEND", "doubleSided": True,
         "pbrMetallicRoughness": {"baseColorFactor": [0.30, 0.36, 0.37, 0.28], "metallicFactor": 0.0, "roughnessFactor": 0.05}},
    ]

    def prim_mesh(name, parts_mats):
        prims = []
        for p, mat in parts_mats:
            P = p.P.astype(np.float32); N = p.N.astype(np.float32); UV = p.UV.astype(np.float32)
            idx = p.I.astype(np.uint16 if len(P) < 65535 else np.uint32).reshape(-1)
            attrs = {"POSITION": g.accessor(P, 5126, "VEC3", 34962, True),
                     "NORMAL": g.accessor(N, 5126, "VEC3", 34962)}
            if mat == 0:
                attrs["TEXCOORD_0"] = g.accessor(UV, 5126, "VEC2", 34962)
            prims.append({"attributes": attrs,
                          "indices": g.accessor(idx, 5123 if len(P) < 65535 else 5125, "SCALAR", 34963),
                          "material": mat, "mode": 4})
        g.j["meshes"].append({"name": name, "primitives": prims})
        return len(g.j["meshes"]) - 1

    m_body = prim_mesh("NCH6_Body", [(meshes["body"], 0), (meshes["glass"], 1)])
    m_main = prim_mesh("NCH6_MainRotor", [(meshes["main"], 0)])
    m_tail = prim_mesh("NCH6_TailRotor", [(meshes["tail"], 0)])

    empties = {
        "Muzzle_Gun_L": [0.945, 0.725, 1.075], "Muzzle_Gun_R": [-0.945, 0.725, 1.075],
        "Rocket_L": [1.547, 0.750, 0.964], "Rocket_R": [-1.547, 0.750, 0.964],
        "Cam_Pilot": [-0.35, 1.94, 0.60], "Cam_Copilot": [0.35, 1.94, 0.60],
        "Exhaust": [0.0, 1.235, -1.83],
    }
    kids = [g.node("Body", mesh=m_body),
            g.node("MainRotor", mesh=m_main, translation=MAIN_PIVOT.tolist(),
                   extras={"spinAxis": "y", "radius": ROTOR_R, "rpm": 490,
                           "note": "vastapäivään ylhäältä katsottuna = rotation.y kasvaa"}),
            g.node("TailRotor", mesh=m_tail, translation=TAIL_PIVOT.round(3).tolist(),
                   extras={"spinAxis": "x", "radius": TAIL_R, "rpm": 2900})]
    for k, v in empties.items():
        kids.append(g.node(k, translation=v))
    root = g.node("NCH6", children=kids, extras={"manifest": f"{NAME}.manifest.json"})
    g.j["scenes"].append({"name": "NCH6", "nodes": [root]})
    size = g.write(os.path.join(out, f"{NAME}.glb"))

    allP = np.vstack([meshes["body"].P, meshes["glass"].P, meshes["main"].P + MAIN_PIVOT, meshes["tail"].P + TAIL_PIVOT])
    mn, mx = allP.min(0), allP.max(0)
    fus = np.vstack([meshes["body"].P, meshes["glass"].P])
    tris = {k: int(len(v.I)) for k, v in meshes.items()}
    total = sum(tris.values())
    verts = sum(int(len(v.P)) for v in meshes.values())
    manifest = {
        "name": "NC-H6 kevyt helikopteri",
        "file": f"{NAME}.glb",
        "source": {"model": "AH-6 Little Bird (3DS)", "from": "cadnav.com", "sourceTriangles": src_tris,
                   "license": "cadnav.com:n ehdot: käyttö osana projektia sallittu myös kaupallisesti, muokkaus sallittu, "
                              "mallin jakaminen tai myynti sellaisenaan kielletty, lähteeksi pyydetään cadnav.com"},
        "attribution": "3D-malli: cadnav.com (AH-6 Little Bird), muokattu",
        "units": "m", "axes": {"up": "+Y", "forward": "+Z", "left": "+X"},
        "origin": "maan tasolla (jalasten pohja), pääroottorin akselin alla",
        "bounds": {"min": [round(float(x), 3) for x in mn], "max": [round(float(x), 3) for x in mx]},
        "dimensions": {"lengthWithRotors": round(float(mx[2] - mn[2]), 2),
                       "fuselageLength": round(float(fus[:, 2].max() - fus[:, 2].min()), 2),
                       "fuselageWidthWithWeapons": round(float(fus[:, 0].max() - fus[:, 0].min()), 2),
                       "height": round(float(mx[1]), 2), "rotorHubHeight": 2.84,
                       "mainRotorDiameter": round(2 * ROTOR_R, 2), "tailRotorDiameter": round(2 * TAIL_R, 2)},
        "stats": {"triangles": total, "trianglesPerPart": tris, "vertices": verts, "drawCalls": 4,
                  "materials": "2 (paletti, läpinäkyvä lasi)", "textures": "2 × 64² PNG", "fileSizeBytes": size,
                  "reducedFrom": src_tris},
        "articulation": {
            "MainRotor": {"pivot": MAIN_PIVOT.tolist(), "axis": "y", "radius": ROTOR_R, "rpm": 490,
                          "direction": "rotation.y kasvaa (vastapäivään ylhäältä)"},
            "TailRotor": {"pivot": TAIL_PIVOT.round(3).tolist(), "axis": "x", "radius": TAIL_R, "rpm": 2900},
            "note": "Täydellä kierrosnopeudella lavat välkkyvät 60 FPS:llä. Pelin kannattaa näyttää nopeassa pyörimisessä "
                    "läpikuultava roottorikiekko (oma verkko) ja hidastaa lapojen näkyvää pyörimistä.",
        },
        "attachPoints": {k: {"parent": "NCH6", "local": v} for k, v in empties.items()},
        "collision": {"note": "Akselisuuntaiset laatikot + roottorikiekko.",
                      "boxes": [{"name": "cabin", "min": [-0.72, 0.5, -1.9], "max": [0.72, 2.55, 1.95]},
                                {"name": "tailboom", "min": [-0.45, 1.0, -4.85], "max": [0.45, 2.75, -1.9]},
                                {"name": "skids", "min": [-1.0, 0.0, -0.4], "max": [1.0, 0.9, 2.3]},
                                {"name": "weapons", "min": [-1.83, 0.42, 0.0], "max": [1.83, 1.05, 1.62]}],
                      "rotorDisc": {"center": MAIN_PIVOT.tolist(), "radius": ROTOR_R}},
        "palette": [{"name": n, "baseColorSRGB": c, "roughness": r, "metalness": m} for n, c, r, m in PALETTE],
        "reduction": [{"part": n, "from": a, "to": b} for n, a, b in report if a != b],
    }
    with open(os.path.join(out, f"{NAME}.manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(json.dumps({"src_tris": src_tris, "triangles": total, "per": tris, "verts": verts, "bytes": size,
                      "bounds": manifest["bounds"], "dims": manifest["dimensions"]}, ensure_ascii=False))
    for n, a, b in report:
        if a != b:
            print(f"  {n:10s} {a:5d} -> {b:5d}")


if __name__ == "__main__":
    main()
