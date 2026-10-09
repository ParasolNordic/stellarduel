#!/usr/bin/env python3
"""Convert Helsinki City Models FME OBJ+MTL+PNG into lightweight textured glTF 2 GLBs.
No external 3D software required; Python stdlib + Pillow + NumPy.
Usage: python scripts/build_world.py /path/to/unzipped/EXPORT --out public/world
Original EPSG:3879 metres are retained in manifest and shifted near world origin.
"""
import argparse, json, re, struct, math, io, time
from pathlib import Path
from collections import defaultdict, Counter
from PIL import Image, ImageOps
import numpy as np
from scipy.ndimage import distance_transform_edt

ATLAS=4096
PAD=3
JPEG_QUALITY=85

class Packer:
    def __init__(self, size=ATLAS):
        self.size=size; self.pages=[]
    def place(self,w,h):
        for i,p in enumerate(self.pages):
            found=self._place(p,w,h)
            if found: return (i,*found)
        p=[(0,0,self.size,self.size)];self.pages.append(p)
        found=self._place(p,w,h)
        if not found:raise RuntimeError(f'Image {w}x{h} too large for atlas {self.size}')
        return (len(self.pages)-1,*found)
    def _place(self,free,w,h):
        best=None; score=None
        for rect in free:
            x,y,rw,rh=rect
            if rw>=w and rh>=h:
                s=(rw*rh-w*h,min(rw-w,rh-h))
                if score is None or s<score:score=s;best=(x,y)
        if best is None:return None
        px,py=best
        occupied=(px,py,w,h)
        fresh=[]
        for rx,ry,rw,rh in free:
            if px >= rx+rw or px+w <= rx or py >= ry+rh or py+h <= ry:
                fresh.append((rx,ry,rw,rh));continue
            if px>rx:fresh.append((rx,ry,px-rx,rh))
            if px+w<rx+rw:fresh.append((px+w,ry,rx+rw-px-w,rh))
            if py>ry:fresh.append((rx,ry,rw,py-ry))
            if py+h<ry+rh:fresh.append((rx,py+h,rw,ry+rh-py-h))
        # remove redundant free rectangles
        fresh=[r for r in fresh if r[2]>0 and r[3]>0]
        out=[]
        for i,a in enumerate(fresh):
            if not any(i!=j and a[0]>=b[0] and a[1]>=b[1] and a[0]+a[2]<=b[0]+b[2] and a[1]+a[3]<=b[1]+b[3] for j,b in enumerate(fresh)):
                out.append(a)
        free[:]=out
        return best

def parse_input(src):
    mat_to_path={}
    mname=None
    for line in (src/'materials.mtl').read_text(errors='replace').splitlines():
        s=line.strip().split(maxsplit=1)
        if not s:continue
        if s[0]=='newmtl':mname=s[1]
        elif s[0]=='map_Kd' and mname:
            mat_to_path[mname]=src / s[1].strip().replace('\\','/').lstrip('./')
    coords=[]; tex=[]; faces={'buildings':defaultdict(list),'terrain':defaultdict(list)}
    group=''; buckets=Counter(); nquad=0
    for line in (src/'export.obj').open(errors='replace'):
        x=line.split()
        if not x:continue
        tag=x[0]
        if tag=='v':coords.append([float(i) for i in x[1:4]])
        elif tag=='vt':tex.append([float(i) for i in x[1:3]])
        elif tag=='usemtl':group=x[1]
        elif tag=='f':
            raw=[]
            for v in x[1:]:
                parts=v.split('/');raw.append((int(parts[0])-1,int(parts[1])-1 if len(parts)>1 and parts[1] else -1))
            target='terrain' if group.startswith('ter_') else 'buildings'
            # geometries may contain >3-gon, triangulate fan
            for i in range(1,len(raw)-1):faces[target][group].append((raw[0],raw[i],raw[i+1]));buckets[target]+=1
            if len(raw)>3:nquad+=1
    coords=np.asarray(coords,dtype=np.float64); tex=np.asarray(tex,dtype=np.float64)
    print('OBJ',len(coords),'vertices',len(tex),'UVs','triangles',dict(buckets),'polygons requiring triangulation',nquad)
    print('bounds',coords.min(axis=0),coords.max(axis=0),'unique materials',len(mat_to_path))
    missing=[(n,str(v)) for n,v in mat_to_path.items() if not v.exists()]
    if missing:print('WARN missing texture paths:',missing[:5],'count',len(missing))
    return coords,tex,faces,mat_to_path

def make_atlases(material_names,mat_files,out_dir,label):
    input_images={}; sizes={}
    for name in sorted(material_names):
        f=mat_files.get(name)
        if f and f.is_file():
            with Image.open(f) as im:sizes[name]=im.size
        else:continue
    # Largest first, best-fit MaxRects layout
    packer=Packer()
    layout={}
    for name,(w,h) in sorted(sizes.items(),key=lambda x:(max(x[1]),x[1][0]*x[1][1]),reverse=True):
        pg,x,y=packer.place(w+2*PAD,h+2*PAD)
        layout[name]={'page':pg,'x':x+PAD,'y':y+PAD,'w':w,'h':h}
    print(label,'textures',len(layout),'pages',len(packer.pages))
    atlases=[]
    for idx in range(len(packer.pages)):
        canvas=Image.new('RGB',(ATLAS,ATLAS),(180,183,182))
        n=0
        for name,pos in layout.items():
            if pos['page']!=idx:continue
            f=mat_files[name]
            with Image.open(f) as im:
                im=im.convert('RGB')
                if label=='terrain':
                    # The exported orthophoto contains pure-black no-data wedges at tile boundaries.
                    # Extend nearest valid pixels into them so these do not show as black triangles.
                    a=np.asarray(im)
                    nodata=np.all(a==0,axis=2)
                    if nodata.any() and (~nodata).any():
                        indices=distance_transform_edt(nodata,return_distances=False,return_indices=True)
                        filled=a[tuple(indices)]
                        im=Image.fromarray(filled)
                x,y=pos['x'],pos['y'];w,h=im.size
                canvas.paste(im,(x,y))
                # Edge clamping padding for filtering/mips
                canvas.paste(im.crop((0,0,w,1)).resize((w,PAD)),(x,y-PAD))
                canvas.paste(im.crop((0,h-1,w,h)).resize((w,PAD)),(x,y+h))
                canvas.paste(im.crop((0,0,1,h)).resize((PAD,h)),(x-PAD,y))
                canvas.paste(im.crop((w-1,0,w,h)).resize((PAD,h)),(x+w,y))
                for cx,cy,sx,sy in [(x-PAD,y-PAD,0,0),(x+w,y-PAD,w-1,0),(x-PAD,y+h,0,h-1),(x+w,y+h,w-1,h-1)]:
                    canvas.paste(im.getpixel((sx,sy)),(cx,cy,cx+PAD,cy+PAD))
            n+=1
        buff=io.BytesIO();canvas.save(buff,format='JPEG',quality=JPEG_QUALITY,subsampling=0,optimize=True)
        blob=buff.getvalue()
        print(' atlas',idx,'textures',n,'JPEG MB',round(len(blob)/1048576,2))
        atlases.append(blob)
        # keep external versions for audit only; GLB is self-contained
    return layout,atlases

class GLB:
    def __init__(self,label):
        self.data=bytearray();self.gltf={'asset':{'version':'2.0','generator':'Helsinki City Models OBJ atlas converter'},'buffers':[{'byteLength':0}], 'bufferViews':[], 'accessors':[], 'images':[], 'textures':[], 'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':33071,'wrapT':33071}], 'materials':[], 'meshes':[], 'nodes':[], 'scenes':[{'nodes':[]}],'scene':0}
        self.label=label
    def view(self,blob,target=None):
        self.data.extend(b'\0'*((-len(self.data))%4));offset=len(self.data)
        self.data.extend(blob)
        item={'buffer':0,'byteOffset':offset,'byteLength':len(blob)}
        if target:item['target']=target
        k=len(self.gltf['bufferViews']);self.gltf['bufferViews'].append(item);return k
    def accessor(self,arr,componentType,kind,target=None):
        arr=np.asarray(arr)
        vw=self.view(arr.tobytes(),target)
        mn,mx=arr.min(axis=0).tolist(),arr.max(axis=0).tolist()
        if not isinstance(mn,list):mn=[mn];mx=[mx]
        k=len(self.gltf['accessors']);self.gltf['accessors'].append({'bufferView':vw,'componentType':componentType,'count':len(arr),'type':kind,'min':mn,'max':mx});return k
    def save(self,path):
        self.gltf['buffers'][0]['byteLength']=len(self.data)
        j=json.dumps(self.gltf,separators=(',',':'),ensure_ascii=False).encode('utf-8');j+=b' '*((-len(j))%4)
        b=bytes(self.data);b+=b'\0'*((-len(b))%4)
        with open(path,'wb') as f:
            f.write(struct.pack('<4sII',b'glTF',2,12+8+len(j)+8+len(b)))
            f.write(struct.pack('<I4s',len(j),b'JSON'));f.write(j)
            f.write(struct.pack('<I4s',len(b),b'BIN\0'));f.write(b)
        return path.stat().st_size

def build_layer(layer,groups,coords,tex,mat_files,world_origin,out_dir):
    names=[m for m in groups.keys() if m];layout,images=make_atlases(names,mat_files,out_dir,layer)
    glb=GLB(layer)
    for idx,blob in enumerate(images):
        vw=glb.view(blob)
        img=len(glb.gltf['images']);glb.gltf['images'].append({'bufferView':vw,'mimeType':'image/jpeg','name':f'{layer}-atlas-{idx}'})
        glb.gltf['textures'].append({'source':img,'sampler':0})
        glb.gltf['materials'].append({'name':f'{layer}-atlas-{idx}','doubleSided':True, 'pbrMetallicRoughness':{'baseColorTexture':{'index':idx},'metallicFactor':0.0,'roughnessFactor':1.0}})
    default_id=len(glb.gltf['materials']);glb.gltf['materials'].append({'name':'untextured','doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':[0.68,0.70,0.72,1], 'metallicFactor':0, 'roughnessFactor':1}})
    bypage=defaultdict(list)
    for material,faces in groups.items():
        page=layout[material]['page'] if material in layout else default_id
        bypage[page].append((material,faces))
    primitives=[];stat=[]
    for page,subgroups in sorted(bypage.items()):
        positions=[];UV=[];normals=[]
        for material, triangles in subgroups:
            info=layout.get(material)
            for tri in triangles:
                xyz=[]
                for vi,ti in tri:
                    x,y,z=coords[vi];xyz.append([x-world_origin[0],z-world_origin[2],-(y-world_origin[1])])
                a=np.array(xyz,dtype=np.float64)
                normal=np.cross(a[1]-a[0],a[2]-a[0]);length=np.linalg.norm(normal)
                if length<1e-7:continue
                n=(normal/length).tolist()
                for (vi,ti),pt in zip(tri,xyz):
                    positions.append(pt);normals.append(n)
                    if info and ti>=0:
                        u,v=tex[ti]
                        u=min(1,max(0,float(u)));v=min(1,max(0,float(v)))
                        UV.append([(info['x']+u*info['w'])/ATLAS,(info['y']+(1-v)*info['h'])/ATLAS])
                    else:UV.append([0,0])
        if not positions:continue
        positions=np.array(positions,dtype=np.float32);normals=np.array(normals,dtype=np.float32);UV=np.array(UV,dtype=np.float32)
        position_acc=glb.accessor(positions,5126,'VEC3',34962)
        normal_acc=glb.accessor(normals,5126,'VEC3',34962)
        tex_acc=glb.accessor(UV,5126,'VEC2',34962)
        primitives.append({'attributes':{'POSITION':position_acc,'NORMAL':normal_acc,'TEXCOORD_0':tex_acc},'mode':4,'material':page})
        stat.append({'atlas_page':page,'triangle_count':len(positions)//3})
        print('  primitive',page,'triangles',len(positions)//3)
    glb.gltf['meshes'].append({'name':layer,'primitives':primitives})
    glb.gltf['nodes'].append({'name':layer,'mesh':0})
    glb.gltf['scenes'][0]['nodes'].append(0)
    path=out_dir/(layer+'.glb');size=glb.save(path)
    print(layer,'GLB',round(size/1048576,2),'MiB')
    return {'file':layer+'.glb','byte_size':size,'texture_atlases':len(images),'draw_primitives':len(primitives),'triangles':sum(s['triangle_count'] for s in stat),'image_count':len(layout),'material_groups':len(groups),'primitives':stat}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('input',type=Path);ap.add_argument('--out',type=Path,default=Path('public/world'));args=ap.parse_args()
    src=args.input;out=args.out;out.mkdir(parents=True,exist_ok=True)
    coords,tex,faces,mat_files=parse_input(src)
    bmin,bmax=coords.min(axis=0),coords.max(axis=0)
    # EPSG3879 centred horizontally, elevation remains sea-level referenced
    origin=[round(float((bmin[0]+bmax[0])/2),3),round(float((bmin[1]+bmax[1])/2),3),0.0]
    manifest={'source':'Helsinki City Models export, user-supplied','crs':'EPSG:3879','coordinates':'Three.js x=easting-origin.x, y=height-origin.z, z=-(northing-origin.y)','origin_epsg3879':{'easting':origin[0],'northing':origin[1],'height':origin[2]},'bounds_epsg3879':{'min':bmin.tolist(),'max':bmax.tolist()},'bounds_local':{'min':[float(bmin[0]-origin[0]),float(bmin[2]),float(-(bmax[1]-origin[1]))], 'max':[float(bmax[0]-origin[0]),float(bmax[2]),float(-(bmin[1]-origin[1]))]},'layers':{}}
    for layer in ['buildings','terrain']:
        manifest['layers'][layer]=build_layer(layer,faces[layer],coords,tex,mat_files,[origin[0],origin[1],origin[2]],out)
    manifest['limits']=['Object data only; no guaranteed street-centrelines or tree meshes','GLBs contain textured visible 3D geometry, not accurate physics colliders','Terrain orthophoto includes streets as pixels, not drivable road surfaces']
    (out/'world-manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False))
    print('manifest:',out/'world-manifest.json')
if __name__=='__main__':main()
