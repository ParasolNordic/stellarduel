#!/usr/bin/env python3
"""Maailmapaketin tarkistus: GLB-rakenne, geometria, UV:t, tekstuurit, rajat, mittakaava ja vertailu lähteeseen.

  python3 scripts/validate_world.py <pakettikansio> [--source <EXPORT-kansio>]

Ilman --source-valintaa tarkistetaan paketin sisäinen eheys. Lähteen kanssa lisäksi:
  * kolmiomäärät ja koordinaatit (jokaisen kolmion keskipiste löytyy lähteestä, sama muunnos)
  * tekstuurit: atlaksen väri UV-kohdassa vs. lähdekuvan väri samassa kohdassa (otos kolmioista)
Poistumiskoodi 0 = kaikki tarkistukset läpäisty.
"""
import argparse, io, json, math, struct, sys
from collections import defaultdict
from pathlib import Path
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
OK, FAIL = [], []
def check(cond, msg):
    (OK if cond else FAIL).append(msg); print(('  ok   ' if cond else '  FAIL ') + msg, flush=True); return cond

COMP = {5126: (np.float32, 4), 5125: (np.uint32, 4), 5123: (np.uint16, 2), 5121: (np.uint8, 1)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read_glb(path):
    b = path.read_bytes()
    magic, ver, length = struct.unpack_from('<4sII', b, 0)
    check(magic == b'glTF' and ver == 2, f'{path.name}: glTF 2.0 -otsake')
    check(length == len(b), f'{path.name}: otsakkeen pituus {length} = tiedoston koko')
    jl, jt = struct.unpack_from('<I4s', b, 12)
    check(jt == b'JSON', f'{path.name}: JSON-lohko')
    j = json.loads(b[20:20 + jl])
    bl, bt = struct.unpack_from('<I4s', b, 20 + jl)
    check(bt == b'BIN\0', f'{path.name}: BIN-lohko')
    binb = b[28 + jl:28 + jl + bl]
    check(len(binb) == bl and bl >= j['buffers'][0]['byteLength'], f'{path.name}: BIN-pituus {bl} riittää puskurille')
    return j, binb


def accessor(j, binb, i):
    a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]
    dt, sz = COMP[a['componentType']]; n = NC[a['type']]
    need = a['count'] * n * sz
    assert v['byteOffset'] + v['byteLength'] <= len(binb) and need <= v['byteLength'], 'accessor yli puskurin'
    arr = np.frombuffer(binb, dtype=dt, count=a['count'] * n, offset=v['byteOffset'] + a.get('byteOffset', 0)).reshape(-1, n)
    return a, arr


def validate_glb(path, layer, manifest):
    print(f'\n{path.name}')
    j, binb = read_glb(path)
    L = manifest['layers'][layer]
    check(len(j['images']) == L['texture_atlases'], f'kuvia {len(j["images"])} = manifestin {L["texture_atlases"]}')
    imgs = []
    for k, im in enumerate(j['images']):
        v = j['bufferViews'][im['bufferView']]; blob = binb[v['byteOffset']:v['byteOffset'] + v['byteLength']]
        try:
            pil = Image.open(io.BytesIO(blob)); pil.load()
            check(pil.format == 'JPEG' and pil.size == (4096, 4096) and pil.mode == 'RGB', f'atlas {k}: {pil.format} {pil.size[0]}×{pil.size[1]} {pil.mode}, {len(blob) / 1048576:.2f} MiB')
            imgs.append(np.asarray(pil))
        except Exception as e:
            check(False, f'atlas {k}: kuvan purku epäonnistui ({e})'); imgs.append(None)
    for t in j['textures']:
        check(0 <= t['source'] < len(j['images']) and 0 <= t.get('sampler', 0) < len(j['samplers']), f'tekstuuri → kuva {t["source"]}')
    allP, tris, prim_data = [], 0, []
    for pi, pr in enumerate(j['meshes'][0]['primitives']):
        m = j['materials'][pr['material']]; pbr = m['pbrMetallicRoughness']
        a_p, P = accessor(j, binb, pr['attributes']['POSITION']); _, N = accessor(j, binb, pr['attributes']['NORMAL']); _, UV = accessor(j, binb, pr['attributes']['TEXCOORD_0'])
        name = m['name']
        check(pr.get('mode', 4) == 4 and len(P) % 3 == 0 and len(P) == len(N) == len(UV), f'{name}: {len(P) // 3} kolmiota, attribuutit samanpituisia')
        check(np.isfinite(P).all() and np.isfinite(N).all() and np.isfinite(UV).all(), f'{name}: ei NaN/Inf-arvoja')
        check(np.allclose(P.min(0), a_p['min'], atol=1e-4) and np.allclose(P.max(0), a_p['max'], atol=1e-4), f'{name}: accessorin min/max vastaa dataa')
        nl = np.linalg.norm(N, axis=1); check(np.abs(nl - 1).max() < 1e-3, f'{name}: normaalit yksikköpituisia')
        T = P.reshape(-1, 3, 3).astype(np.float64); area = 0.5 * np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1)
        check((area > 1e-7).all(), f'{name}: ei nollapinta-alaisia kolmioita (pienin {area.min():.2e} m²)')
        check(m.get('doubleSided') is True and pbr.get('metallicFactor') == 0 and pbr.get('roughnessFactor') == 1, f'{name}: doubleSided, metalness 0, roughness 1')
        if 'baseColorTexture' in pbr:
            check(UV.min() >= 0 and UV.max() <= 1, f'{name}: UV:t välillä 0–1 ({UV.min():.4f}…{UV.max():.4f})')
            img = imgs[j['textures'][pbr['baseColorTexture']['index']]['source']]
            if img is not None:
                c = UV.reshape(-1, 3, 2).mean(axis=1); px = np.clip((c * 4096).astype(int), 0, 4095)
                col = img[px[:, 1], px[:, 0]].astype(int)
                bg = (np.abs(col - 128).max(axis=1) <= 2).mean()
                check(bg < 0.01, f'{name}: kolmioiden UV-keskipisteet osuvat kuvadataan (taustaväriä {bg * 100:.2f} %)')
                prim_data.append((img, P, UV))
        allP.append(P); tris += len(P) // 3
    P = np.concatenate(allP)
    check(tris == L['triangles'], f'kolmioita yhteensä {tris} = manifestin {L["triangles"]}')
    return P, prim_data


def tri_key(c):
    return tuple(np.round(c, 2))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('pkg', type=Path); ap.add_argument('--source', type=Path)
    a = ap.parse_args()
    man = json.loads((a.pkg / 'world-manifest.json').read_text())
    print('world-manifest.json')
    for k in ['crs', 'coordinates', 'origin_epsg3879', 'bounds_epsg3879', 'bounds_local', 'layers']:
        check(k in man, f'kenttä {k}')
    for n, l in man['layers'].items():
        check((a.pkg / l['file']).is_file() and (a.pkg / l['file']).stat().st_size == l['byte_size'], f'{l["file"]}: olemassa, koko {l["byte_size"]} täsmää')
    pts, prims = {}, {}
    for layer in ['terrain', 'buildings']:
        pts[layer], prims[layer] = validate_glb(a.pkg / man['layers'][layer]['file'], layer, man)
    print('\nrajat, mittakaava ja kerrosten sijainti')
    allp = np.concatenate(list(pts.values()))
    bl = man['bounds_local']
    check(np.allclose(allp.min(0), bl['min'], atol=0.01) and np.allclose(allp.max(0), bl['max'], atol=0.01), f'kerrosten yhteiset rajat = bounds_local ({allp.min(0).round(2)} … {allp.max(0).round(2)})')
    o = man['origin_epsg3879']; be, bx = man['bounds_epsg3879']['min'], man['bounds_epsg3879']['max']
    exp_min = [be[0] - o['easting'], be[2], -(bx[1] - o['northing'])]; exp_max = [bx[0] - o['easting'], bx[2], -(be[1] - o['northing'])]
    check(np.allclose(bl['min'], exp_min, atol=1e-3) and np.allclose(bl['max'], exp_max, atol=1e-3), 'bounds_local johdettu EPSG:3879-rajoista ja origosta (1:1, ei skaalausta)')
    size = allp.max(0) - allp.min(0)
    check(abs(size[0] - (bx[0] - be[0])) < 0.01 and abs(size[2] - (bx[1] - be[1])) < 0.01 and abs(size[1] - (bx[2] - be[2])) < 0.01, f'koko {size[0]:.2f} × {size[2]:.2f} m, korkeusero {size[1]:.2f} m = lähteen koko')
    # rakennusten alareuna maaston pinnalla: ruudukko 2 m, maaston korkein kohta ruudussa
    T = pts['terrain'].reshape(-1, 3, 3); x0, z0 = bl['min'][0], bl['min'][2]
    g = defaultdict(lambda: -1e9)
    for tri in T:
        c = tri.mean(0); k = (int((c[0] - x0) // 2), int((c[2] - z0) // 2)); g[k] = max(g[k], c[1])
    B = pts['buildings']; low = defaultdict(lambda: 1e9)
    for p in B:
        k = (int((p[0] - x0) // 2), int((p[2] - z0) // 2)); low[k] = min(low[k], p[1])
    # vain rakennusten reunaruudut (alin kärki lähellä maata); sisäruuduissa on pelkkiä kattoja
    d = np.array([low[k] - g[k] for k in low if k in g])
    base = d[np.abs(d) < 3]
    # CityGML-rakennusten pohja ulottuu tyypillisesti hieman maanpinnan alle (rinteessä alimman maan kohdan tasolle):
    # virhe olisi rakennusten leijuminen maan yläpuolella tai kerrosten selvä siirtymä
    check(len(base) > 0.3 * len(d) and -2.5 < np.median(base) < 0.3 and (base > 0.5).mean() < 0.1,
          f'rakennukset maassa kiinni: {len(base)}/{len(d)} reunaruutua, pohjan mediaani {np.median(base):+.2f} m maanpinnasta, leijuvia ruutuja {(base > 0.5).mean() * 100:.1f} %')
    if a.source:
        print('\nvertailu lähteeseen')
        sys.path.insert(0, str(Path(__file__).parent))
        from build_world import parse_obj, parse_mtl, to_local
        mats = parse_mtl(a.source / 'materials.mtl'); V, TT, groups, _ = parse_obj(a.source / 'export.obj')
        origin = [o['easting'], o['northing'], o['height']]
        from scipy.spatial import cKDTree
        cs, refs = [], []
        for gname, tri in groups.items():
            Pl = to_local(V[tri[:, :, 0]], origin); cs.append(Pl.mean(axis=1)); refs += [(gname, t) for t in tri]
        tree = cKDTree(np.concatenate(cs))
        def lookup(c):
            dd, ii = tree.query(c); return refs[ii] if dd < 0.01 else None
        src = type('S', (), {'get': staticmethod(lambda k: lookup(np.array(k)))})()
        for layer in ['terrain', 'buildings']:
            c = pts[layer].reshape(-1, 3, 3).astype(np.float64).mean(axis=1)
            dd, _ = tree.query(c)
            check((dd < 0.01).all(), f'{layer}: kaikki {len(c)} kolmiota löytyvät lähteestä samasta paikasta (suurin poikkeama {dd.max() * 1000:.2f} mm)')
        # värivertailu: otos teksturoiduista kolmioista, lähdekuvan väri vs atlaksen väri (molemmista pieni keskiarvoalue)
        rng = np.random.default_rng(1); cache = {}
        for layer in ['terrain', 'buildings']:
            diffs = []
            for img, P, UV in prims[layer]:
                tri = P.reshape(-1, 3, 3).astype(np.float64); uvt = UV.reshape(-1, 3, 2)
                for i in rng.choice(len(tri), size=min(800, len(tri)), replace=False):
                    hit = src.get(tuple(tri[i].mean(0)))
                    if not hit: continue
                    gname, t = hit
                    if gname not in cache:
                        with Image.open(mats[gname]) as im: cache[gname] = np.asarray(im.convert('RGB'))
                    s = cache[gname]; h, w = s.shape[:2]
                    suv = np.clip(TT[t[:, 1]].mean(0), 0, 1); sx, sy = int(suv[0] * (w - 1)), int((1 - suv[1]) * (h - 1))
                    auv = uvt[i].mean(0); ax, ay = int(auv[0] * 4095), int(auv[1] * 4095)
                    r = max(2, int(0.02 * min(w, h)))
                    a_col = s[max(0, sy - r):sy + r + 1, max(0, sx - r):sx + r + 1].reshape(-1, 3).mean(0)
                    ra = max(1, int(r * 0.5))
                    b_col = img[max(0, ay - ra):ay + ra + 1, max(0, ax - ra):ax + ra + 1].reshape(-1, 3).mean(0)
                    diffs.append(np.abs(a_col - b_col).mean())
            d = np.array(diffs)
            check(len(d) > 200 and np.median(d) < 12 and np.percentile(d, 90) < 30,
                  f'{layer}: atlaksen väri vastaa lähdekuvaa samassa UV-kohdassa (mediaaniero {np.median(d):.1f}/255, p90 {np.percentile(d, 90):.1f}, otos {len(d)})')
    print(f'\n{len(OK)} tarkistusta läpäisty, {len(FAIL)} epäonnistui')
    sys.exit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
