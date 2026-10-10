#!/usr/bin/env python3
"""Kaupunkimallin muunnos selainpelin maailmapaketiksi (glTF 2.0 / GLB, tekstuurit sisällä).

Lähde: FME:n OBJ + MTL + PNG-vienti (CityGML-mallista), EPSG:3879, absoluuttiset korkeudet.
Tulos:  buildings.glb, terrain.glb, world-manifest.json

  python3 scripts/build_world.py <EXPORT-kansio> --out <kohdekansio> [--building-pages 3] [--terrain-pages 2]

Periaatteet (GRAFIIKKA-PERUSOHJE.md):
  * Geometriaa, mittakaavaa ja kerrosten keskinäistä sijaintia ei muuteta. Koordinaatit:
      x = itä − origo_itä, y = korkeus (absoluuttinen, m), z = −(pohjoinen − origo_pohjoinen)
    Origo = mallin rajojen vaakasuora keskipiste; sama kaikille kerroksille.
  * Tekstuurit kootaan 4096² JPEG-atlaksiin. Jokainen lähdekuva:
      1) rajataan UV:iden todella käyttämään alueeseen (ei hukkapikseleitä),
      2) skaalataan tasaisesti (koko kuva samalla kertoimella → UV-kohdistus säilyy täsmälleen),
      3) sijoitetaan atlakseen reunatäytteen kanssa (mipmap-vuoto estetty), ja UV:t muunnetaan atlakseen.
    Rakennuksille skaalaus tehdään tekselitiheyden ylärajalla (px/m²): vain tarpeettoman tarkat kuvat pienenevät.
    Maastolle (ortoilmakuva) käytetään yhtä yhteistä kerrointa, jotta maan tarkkuus on kaikkialla sama.
  * Rikkinäiset kolmiot (toistuva kärki tai nollapinta-ala) jätetään pois ja raportoidaan.
  * Ortokuvan puhtaan mustat no-data-alueet täytetään lähimmällä kuvapikselillä.
Riippuvuudet: Python 3.9+, NumPy, Pillow, SciPy (pyproj valinnainen: origon maantieteelliset koordinaatit).
"""
import argparse, io, json, math, re, struct, sys, time
from collections import defaultdict, Counter
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt

ATLAS = 4096
PAD = 4                     # reunatäyte pikseleinä joka suuntaan
JPEG_QUALITY = 86
FILL = 0.94                 # tavoiteltu atlaksen täyttöaste ennen pakkausta (ylitys → automaattinen uusi yritys)
ROOF_WEIGHT = 0.3           # kattojen osuus tekselibudjetista suhteessa julkisivuihin (pinta-alaa kohden)
Image.MAX_IMAGE_PIXELS = None


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- lähde
def parse_mtl(path):
    mats, cur = {}, None
    for line in path.read_text(errors='replace').splitlines():
        s = line.strip().split(maxsplit=1)
        if not s:
            continue
        if s[0] == 'newmtl':
            cur = s[1].strip(); mats[cur] = None
        elif s[0] == 'map_Kd' and cur:
            mats[cur] = path.parent / s[1].strip().replace('\\', '/').lstrip('./')
    return mats


def parse_obj(path):
    V, T, faces = [], [], defaultdict(list)
    grp = None; stats = Counter()
    with path.open(errors='replace') as f:
        for line in f:
            if line.startswith('v '):
                V.append(line.split()[1:4])
            elif line.startswith('vt '):
                T.append(line.split()[1:3])
            elif line.startswith('usemtl'):
                grp = line.split(maxsplit=1)[1].strip()
            elif line.startswith('f '):
                pts = []
                for q in line.split()[1:]:
                    p = q.split('/')
                    pts.append((int(p[0]), int(p[1]) if len(p) > 1 and p[1] else 0))
                stats['polygons'] += 1
                if len(pts) > 3:
                    stats['ngons_triangulated'] += 1
                for i in range(1, len(pts) - 1):           # viuhkajako (lähteessä nyt pelkkiä kolmioita)
                    faces[grp].append((pts[0], pts[i], pts[i + 1]))
    V = np.asarray(V, dtype=np.float64); T = np.asarray(T, dtype=np.float64) if T else np.zeros((0, 2))
    # OBJ-indeksit: 1-pohjaiset, negatiiviset suhteellisia
    fix = lambda i, n: (i - 1) if i > 0 else (n + i)
    out = {}
    for g, tris in faces.items():
        a = np.array([[fix(v, len(V)), fix(t, len(T)) if t else -1] for tri in tris for (v, t) in tri], dtype=np.int64).reshape(-1, 3, 2)
        out[g] = a
    return V, T, out, stats


def request_polygon(summary):
    if not summary.exists():
        return None
    m = re.search(r'Request area coordinates:\s*([0-9.,;\s]+)', summary.read_text(errors='replace'))
    if not m:
        return None
    pts = [tuple(map(float, p.split(','))) for p in m.group(1).strip().split(';') if ',' in p]
    return pts or None


# ---------------------------------------------------------------- atlakset
class Packer:
    """MaxRects best-area-fit."""
    def __init__(self, size):
        self.size = size; self.pages = []

    def place(self, w, h):
        for i, free in enumerate(self.pages):
            p = self._place(free, w, h)
            if p:
                return (i, *p)
        self.pages.append([(0, 0, self.size, self.size)])
        p = self._place(self.pages[-1], w, h)
        if not p:
            raise RuntimeError(f'kuva {w}x{h} ei mahdu atlakseen')
        return (len(self.pages) - 1, *p)

    @staticmethod
    def _place(free, w, h):
        best, score = None, None
        for x, y, rw, rh in free:
            if rw >= w and rh >= h:
                s = (rw * rh - w * h, min(rw - w, rh - h))
                if score is None or s < score:
                    score, best = s, (x, y)
        if best is None:
            return None
        px, py = best; nf = []
        for rx, ry, rw, rh in free:
            if px >= rx + rw or px + w <= rx or py >= ry + rh or py + h <= ry:
                nf.append((rx, ry, rw, rh)); continue
            if px > rx: nf.append((rx, ry, px - rx, rh))
            if px + w < rx + rw: nf.append((px + w, ry, rx + rw - px - w, rh))
            if py > ry: nf.append((rx, ry, rw, py - ry))
            if py + h < ry + rh: nf.append((rx, py + h, rw, ry + rh - py - h))
        nf = [r for r in nf if r[2] > 0 and r[3] > 0]
        free[:] = [a for i, a in enumerate(nf) if not any(i != j and a[0] >= b[0] and a[1] >= b[1] and a[0] + a[2] <= b[0] + b[2] and a[1] + a[3] <= b[1] + b[3] for j, b in enumerate(nf))]
        return best


def crop_rect(uv, w, h):
    """UV:iden käyttämä alue pikseleinä (x0, y0, x1, y1), pieni marginaali. v=0 on kuvan alareuna."""
    u = np.clip(uv[:, 0], 0, 1); v = np.clip(uv[:, 1], 0, 1)
    x0 = max(0, int(math.floor(u.min() * w)) - 2); x1 = min(w, int(math.ceil(u.max() * w)) + 2)
    y0 = max(0, int(math.floor((1 - v.max()) * h)) - 2); y1 = min(h, int(math.ceil((1 - v.min()) * h)) + 2)
    return x0, y0, max(x1, x0 + 1), max(y1, y0 + 1)


def plan_scales(items, pages, mode):
    """items: {name: {'cw','ch','area'}} → {name: kerroin}. Kokonaispinta-ala sovitetaan 'pages' atlakseen."""
    budget = pages * ATLAS * ATLAS * FILL
    tot = sum((it['cw'] + 2 * PAD) * (it['ch'] + 2 * PAD) for it in items.values())
    if tot <= budget:
        return {n: 1.0 for n in items}, None
    if mode == 'uniform':
        s = math.sqrt(budget / tot)
        return {n: s for n in items}, None
    # tekselitiheyden yläraja: kerroin_i = min(1, sqrt(D / tiheys_i)), D haetaan puolitushaulla
    dens = {n: it['cw'] * it['ch'] / max(it['area'], 1e-3) for n, it in items.items()}
    def total(D):
        t = 0
        for n, it in items.items():
            s = min(1.0, math.sqrt(D / dens[n]))
            t += (max(1, round(it['cw'] * s)) + 2 * PAD) * (max(1, round(it['ch'] * s)) + 2 * PAD)
        return t
    lo, hi = 1e-3, max(dens.values())
    for _ in range(60):
        mid = math.sqrt(lo * hi)
        lo, hi = (mid, hi) if total(mid) <= budget else (lo, mid)
    return {n: min(1.0, math.sqrt(lo / dens[n])) for n in items}, lo


def build_atlases(layer, mats, uv_by_mat, area_by_mat, pages, mode, fill_nodata):
    items = {}
    for name, uv in uv_by_mat.items():
        with Image.open(mats[name]) as im:
            w, h = im.size
        x0, y0, x1, y1 = crop_rect(uv, w, h)
        items[name] = {'w': w, 'h': h, 'crop': (x0, y0, x1, y1), 'cw': x1 - x0, 'ch': y1 - y0, 'area': area_by_mat[name]}
    src_px = sum(it['w'] * it['h'] for it in items.values()); crop_px = sum(it['cw'] * it['ch'] for it in items.values())
    target = pages
    for attempt in range(12):
        scales, D = plan_scales(items, target, mode)
        packer = Packer(ATLAS); layout = {}
        order = sorted(items, key=lambda n: (max(items[n]['cw'], items[n]['ch']) * scales[n], items[n]['cw'] * items[n]['ch']), reverse=True)
        for n in order:
            it = items[n]; s = scales[n]
            sw, sh = max(1, round(it['cw'] * s)), max(1, round(it['ch'] * s))
            pg, x, y = packer.place(sw + 2 * PAD, sh + 2 * PAD)
            layout[n] = {'page': pg, 'x': x + PAD, 'y': y + PAD, 'sw': sw, 'sh': sh, **it}
        if len(packer.pages) <= pages:
            break
        target *= 0.95; log(f'  {layer}: {len(packer.pages)} sivua > {pages}, pienennetään budjettia ({attempt + 1})')
    else:
        raise RuntimeError(f'{layer}: atlakset eivät mahdu {pages} sivuun')
    out_px = sum(l['sw'] * l['sh'] for l in layout.values())
    sc = np.array([scales[n] for n in items])
    info = {'source_images': len(items), 'source_megapixels': round(src_px / 1e6, 1), 'after_uv_crop_megapixels': round(crop_px / 1e6, 1),
            'atlas_megapixels_used': round(out_px / 1e6, 1), 'scale_min': round(float(sc.min()), 3), 'scale_median': round(float(np.median(sc)), 3),
            'scale_max': round(float(sc.max()), 3), 'images_unscaled': int((sc >= 0.999).sum())}
    if D:
        info['texel_density_cap_px_per_m2'] = round(D, 1); info['texel_cap_m_per_px'] = round(1 / math.sqrt(D), 4)
    tot_area = sum(it['area'] for it in items.values())
    info['mean_m_per_px_weighted_area'] = round(math.sqrt(tot_area / max(out_px, 1)), 4)
    blobs = []; nodata_fixed = 0
    for pg in range(len(packer.pages)):
        canvas = Image.new('RGB', (ATLAS, ATLAS), (128, 128, 128))
        for n, l in layout.items():
            if l['page'] != pg:
                continue
            with Image.open(mats[n]) as im:
                im = im.convert('RGB').crop(l['crop'])
            if fill_nodata:
                a = np.asarray(im); nod = np.all(a <= 2, axis=2)
                if nod.any() and (~nod).any():
                    idx = distance_transform_edt(nod, return_distances=False, return_indices=True)
                    im = Image.fromarray(a[tuple(idx)]); nodata_fixed += 1
            if (l['sw'], l['sh']) != im.size:
                im = im.resize((l['sw'], l['sh']), Image.LANCZOS)
            x, y, w, h = l['x'], l['y'], l['sw'], l['sh']
            canvas.paste(im, (x, y))
            # reunatäyte: reunarivit toistetaan PAD pikselin verran (suodatus ja mipmapit eivät vuoda naapuriin)
            canvas.paste(im.crop((0, 0, w, 1)).resize((w, PAD)), (x, y - PAD))
            canvas.paste(im.crop((0, h - 1, w, h)).resize((w, PAD)), (x, y + h))
            canvas.paste(im.crop((0, 0, 1, h)).resize((PAD, h)), (x - PAD, y))
            canvas.paste(im.crop((w - 1, 0, w, h)).resize((PAD, h)), (x + w, y))
            for cx, cy, sx, sy in [(x - PAD, y - PAD, 0, 0), (x + w, y - PAD, w - 1, 0), (x - PAD, y + h, 0, h - 1), (x + w, y + h, w - 1, h - 1)]:
                canvas.paste(im.getpixel((sx, sy)), (cx, cy, cx + PAD, cy + PAD))
        buf = io.BytesIO(); canvas.save(buf, format='JPEG', quality=JPEG_QUALITY, subsampling=0, optimize=True)
        blobs.append(buf.getvalue())
        log(f'  {layer} atlas {pg}: {sum(1 for l in layout.values() if l["page"] == pg)} kuvaa, JPEG {len(blobs[-1]) / 1048576:.2f} MiB')
    if fill_nodata:
        info['nodata_images_filled'] = nodata_fixed
    return layout, blobs, info


# ---------------------------------------------------------------- GLB
class GLB:
    def __init__(self, generator):
        self.bin = bytearray()
        self.j = {'asset': {'version': '2.0', 'generator': generator}, 'buffers': [{'byteLength': 0}], 'bufferViews': [], 'accessors': [],
                  'images': [], 'textures': [], 'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
                  'materials': [], 'meshes': [], 'nodes': [], 'scenes': [{'nodes': []}], 'scene': 0}

    def view(self, blob, target=None):
        self.bin.extend(b'\0' * ((-len(self.bin)) % 4)); off = len(self.bin); self.bin.extend(blob)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(blob)}
        if target: v['target'] = target
        self.j['bufferViews'].append(v); return len(self.j['bufferViews']) - 1

    def accessor(self, arr, kind):
        arr = np.ascontiguousarray(arr, dtype=np.float32)
        vw = self.view(arr.tobytes(), 34962)
        self.j['accessors'].append({'bufferView': vw, 'componentType': 5126, 'count': len(arr), 'type': kind,
                                    'min': arr.min(axis=0).tolist(), 'max': arr.max(axis=0).tolist()})
        return len(self.j['accessors']) - 1

    def save(self, path):
        self.j['buffers'][0]['byteLength'] = len(self.bin)
        js = json.dumps(self.j, separators=(',', ':'), ensure_ascii=False).encode('utf-8'); js += b' ' * ((-len(js)) % 4)
        b = bytes(self.bin) + b'\0' * ((-len(self.bin)) % 4)
        with open(path, 'wb') as f:
            f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(b)))
            f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js)
            f.write(struct.pack('<I4s', len(b), b'BIN\0')); f.write(b)
        return path.stat().st_size


def to_local(P, origin):
    """EPSG:3879 (itä, pohjoinen, korkeus) → pelin (x, y, z). Kierto (x,y,z)→(x,z,−y): determinantti +1, kiertosuunta säilyy."""
    return np.stack([P[..., 0] - origin[0], P[..., 2] - origin[2], -(P[..., 1] - origin[1])], axis=-1)


def build_layer(layer, groups, V, T, mats, origin, pages, mode, out):
    t0 = time.time()
    clean, dropped = {}, Counter()
    for g, tri in groups.items():
        vi = tri[:, :, 0]
        rep = (vi[:, 0] == vi[:, 1]) | (vi[:, 1] == vi[:, 2]) | (vi[:, 0] == vi[:, 2])
        P = V[vi]; area = 0.5 * np.linalg.norm(np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]), axis=1)
        bad = rep | (area < 1e-6)
        dropped['repeated_vertex'] += int(rep.sum()); dropped['zero_area'] += int((bad & ~rep).sum())
        if (~bad).any():
            clean[g] = (tri[~bad], area[~bad])
    textured = {g: v for g, v in clean.items() if g and mats.get(g) and mats[g].is_file() and (v[0][:, :, 1] >= 0).all()}
    untextured = {g: v for g, v in clean.items() if g not in textured}
    uv_out = Counter()
    uv_by_mat = {}
    for g, (tri, _) in textured.items():
        uv = T[tri[:, :, 1].reshape(-1)]
        uv_out['outside_0_1'] += int(((uv < -1e-3) | (uv > 1 + 1e-3)).any(axis=1).sum())
        uv_by_mat[g] = uv
    # tekselibudjetti painotetaan näkyvyyden mukaan: julkisivut (pystypinnat) täydellä painolla, katot ja muut vaakapinnat
    # ROOF_WEIGHT-painolla, koska jalankulkijan / FPS-kameran näkökulmasta ne näkyvät harvoin läheltä
    area_by_mat = {}
    for g, (tri, a) in textured.items():
        if layer == 'buildings':
            P = V[tri[:, :, 0]]; n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
            nz = np.abs(n[:, 2]) / np.maximum(np.linalg.norm(n, axis=1), 1e-12)
            area_by_mat[g] = float((a * np.where(nz > 0.6, ROOF_WEIGHT, 1.0)).sum())
        else:
            area_by_mat[g] = float(a.sum())
    log(f'{layer}: {sum(len(t) for t, _ in clean.values())} kolmiota, {len(textured)} teksturoitua materiaalia, '
        f'{sum(len(t) for t, _ in untextured.values())} kolmiota ilman tekstuuria, pois jätetty {dict(dropped)}')
    layout, blobs, ainfo = build_atlases(layer, mats, uv_by_mat, area_by_mat, pages, mode, fill_nodata=(layer == 'terrain'))
    glb = GLB('City model OBJ → glTF atlas converter (build_world.py)')
    for i, blob in enumerate(blobs):
        vw = glb.view(blob)
        glb.j['images'].append({'bufferView': vw, 'mimeType': 'image/jpeg', 'name': f'{layer}-atlas-{i}'})
        glb.j['textures'].append({'source': i, 'sampler': 0})
        glb.j['materials'].append({'name': f'{layer}-atlas-{i}', 'doubleSided': True,
                                   'pbrMetallicRoughness': {'baseColorTexture': {'index': i}, 'metallicFactor': 0.0, 'roughnessFactor': 1.0}})
    untex_mat = len(glb.j['materials'])
    glb.j['materials'].append({'name': 'untextured', 'doubleSided': True, 'pbrMetallicRoughness': {'baseColorFactor': [0.70, 0.69, 0.66, 1], 'metallicFactor': 0.0, 'roughnessFactor': 1.0}})
    by_page = defaultdict(list)
    for g in textured: by_page[layout[g]['page']].append(g)
    prims, pstats = [], []
    def emit(tri_list, uv_list, mat):
        P = to_local(np.concatenate([V[t[:, :, 0]] for t in tri_list]), origin)        # (n,3,3) float64
        n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); n /= np.linalg.norm(n, axis=1, keepdims=True)
        N = np.repeat(n[:, None, :], 3, axis=1)
        UV = np.concatenate(uv_list) if uv_list else np.zeros((len(P) * 3, 2))
        a = glb.accessor(P.reshape(-1, 3), 'VEC3'); b = glb.accessor(N.reshape(-1, 3), 'VEC3'); c = glb.accessor(UV.reshape(-1, 2), 'VEC2')
        prims.append({'attributes': {'POSITION': a, 'NORMAL': b, 'TEXCOORD_0': c}, 'mode': 4, 'material': mat})
        pstats.append({'material': glb.j['materials'][mat]['name'], 'triangles': int(len(P))})
    for pg in sorted(by_page):
        tris, uvs = [], []
        for g in by_page[pg]:
            l = layout[g]; tri = textured[g][0]; uv = np.clip(T[tri[:, :, 1].reshape(-1)], 0, 1)
            x0, y0 = l['crop'][0], l['crop'][1]; sx = l['sw'] / l['cw']; sy = l['sh'] / l['ch']
            px = (uv[:, 0] * l['w'] - x0) * sx + l['x']; py = ((1 - uv[:, 1]) * l['h'] - y0) * sy + l['y']
            tris.append(tri); uvs.append(np.stack([px / ATLAS, py / ATLAS], axis=1))
        emit(tris, uvs, pg)
    if untextured:
        emit([t for t, _ in untextured.values()], [], untex_mat)
    glb.j['meshes'].append({'name': layer, 'primitives': prims})
    glb.j['nodes'].append({'name': layer, 'mesh': 0}); glb.j['scenes'][0]['nodes'].append(0)
    size = glb.save(out / f'{layer}.glb')
    log(f'{layer}.glb {size / 1048576:.2f} MiB, {len(prims)} primitiiviä, {time.time() - t0:.0f} s')
    return {'file': f'{layer}.glb', 'byte_size': size, 'texture_atlases': len(blobs), 'atlas_size': ATLAS, 'draw_primitives': len(prims),
            'triangles': sum(p['triangles'] for p in pstats), 'primitives': pstats, 'textured_materials': len(textured),
            'untextured_triangles': sum(len(t) for t, _ in untextured.values()), 'dropped_triangles': dict(dropped),
            'uv_outside_0_1_clamped': uv_out['outside_0_1'], 'textures': ainfo}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('input', type=Path, help='EXPORT-kansio (export.obj, materials.mtl, materials_textures/)')
    ap.add_argument('--out', type=Path, default=Path('world'))
    ap.add_argument('--obj', default='export.obj'); ap.add_argument('--mtl', default='materials.mtl')
    ap.add_argument('--terrain-prefix', default='ter_', help='maaston materiaalien nimen alku')
    ap.add_argument('--building-pages', type=int, default=4); ap.add_argument('--terrain-pages', type=int, default=2)
    a = ap.parse_args(); a.out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    mats = parse_mtl(a.input / a.mtl)
    V, T, groups, st = parse_obj(a.input / a.obj)
    missing_def = [g for g in groups if g and g not in mats]; missing_file = [m for m, p in mats.items() if p and not p.is_file()]
    log(f'OBJ: {len(V)} kärkeä, {len(T)} UV:ta, {sum(len(t) for t in groups.values())} kolmiota, {len(groups)} materiaaliryhmää, '
        f'määrittelemättömiä materiaaleja {len(missing_def)}, puuttuvia kuvatiedostoja {len(missing_file)}')
    layers = {'buildings': {}, 'terrain': {}}
    for g, t in groups.items():
        layers['terrain' if g and g.startswith(a.terrain_prefix) else 'buildings'][g] = t
    used = np.unique(np.concatenate([t[:, :, 0].reshape(-1) for t in groups.values()]))
    P = V[used]; bmin, bmax = P.min(axis=0), P.max(axis=0)
    origin = [round(float((bmin[0] + bmax[0]) / 2), 3), round(float((bmin[1] + bmax[1]) / 2), 3), 0.0]
    man = {
        'source': 'City model export (FME OBJ/MTL/PNG from CityGML), user-supplied',
        'crs': 'EPSG:3879',
        'coordinates': 'Three.js x=easting-origin.x, y=height-origin.z, z=-(northing-origin.y)',
        'units': 'metre', 'height_mode': 'absolute (sea level)',
        'origin_epsg3879': {'easting': origin[0], 'northing': origin[1], 'height': origin[2]},
        'bounds_epsg3879': {'min': bmin.tolist(), 'max': bmax.tolist()},
        'bounds_local': {'min': [float(bmin[0] - origin[0]), float(bmin[2]), float(-(bmax[1] - origin[1]))],
                         'max': [float(bmax[0] - origin[0]), float(bmax[2]), float(-(bmin[1] - origin[1]))]},
        'size_m': {'x': float(bmax[0] - bmin[0]), 'y': float(bmax[2] - bmin[2]), 'z': float(bmax[1] - bmin[1])},
        'layers': {},
    }
    try:
        from pyproj import Transformer
        lon, lat = Transformer.from_crs('EPSG:3879', 'EPSG:4326', always_xy=True).transform(origin[0], origin[1])
        man['origin_wgs84'] = {'lat': round(lat, 6), 'lon': round(lon, 6)}
    except Exception:
        pass
    poly = request_polygon(a.input / 'request_summary.txt')
    if poly:
        man['area_polygon_local_xz'] = [[round(e - origin[0], 3), round(-(n - origin[1]), 3)] for e, n in poly]
        man['area_polygon_note'] = 'Export area (non-rectangular). Terrain exists only inside it; bounds_local is its bounding box.'
    for name, pages, mode in [('buildings', a.building_pages, 'density'), ('terrain', a.terrain_pages, 'uniform')]:
        man['layers'][name] = build_layer(name, layers[name], V, T, mats, origin, pages, mode, a.out)
    man['source_stats'] = {'vertices': int(len(V)), 'uvs': int(len(T)), 'polygons': st['polygons'], 'ngons_triangulated': st['ngons_triangulated'],
                           'materials': len(mats), 'undefined_materials': len(missing_def), 'missing_texture_files': len(missing_file)}
    man['limits'] = ['Visible textured geometry; use BVH on render meshes for collisions (see GRAFIIKKA-PERUSOHJE.md).',
                     'No street centrelines, trees or separate collision meshes in the source.',
                     'Orthophoto shows streets and water as pixels only.']
    (a.out / 'world-manifest.json').write_text(json.dumps(man, indent=2, ensure_ascii=False))
    log(f'valmis {time.time() - t0:.0f} s → {a.out}')


if __name__ == '__main__':
    main()
