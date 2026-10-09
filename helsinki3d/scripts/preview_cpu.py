"""Software overview preview of generated GLBs to check textures/layout without WebGL."""
import numpy as np, cv2, trimesh
from pathlib import Path
from PIL import Image
from collections import defaultdict
root=Path(__file__).resolve().parents[1]
W,H=1500,1020
img=np.full((H,W,3),(239,226,206),np.uint8) # BGR pale sky
# view from south east, looking towards city center
cam=np.array([330.,245.,410.]);tgt=np.array([0.,6.,0.]);fwd=(tgt-cam);fwd/=np.linalg.norm(fwd)
up=np.array([0.,1.,0.]);right=np.cross(fwd,up);right/=np.linalg.norm(right);cup=np.cross(right,fwd)
focal=1800
meshes=[]
for f in [root/'public/world/terrain.glb',root/'public/world/buildings.glb']:
 scene=trimesh.load(f,force='scene',process=False)
 for m in scene.geometry.values():
  tex=m.visual.material.baseColorTexture
  if isinstance(tex,Image.Image):texture=np.array(tex.convert('RGB'))[:,:,::-1].copy()
  else:print('no image?',type(tex));continue
  v=m.vertices
  diff=v-cam
  z=diff@fwd;px=diff@right*focal/np.maximum(z,.01)+W/2;py=H/2-diff@cup*focal/np.maximum(z,.01)
  faces=m.faces; uv=np.asarray(m.visual.uv); uvimg=uv*np.array([texture.shape[1],texture.shape[0]])
  meshes.append((px,py,z,faces,uvimg,texture,f.name))
faces_to_draw=[]
for mid,(px,py,z,faces,uvimg,texture,fname) in enumerate(meshes):
 for i,ids in enumerate(faces):
  if np.any(z[ids]<.1):continue
  xy=np.column_stack([px[ids],py[ids]])
  if xy[:,0].max()<-10 or xy[:,0].min()>W+10 or xy[:,1].max()<-10 or xy[:,1].min()>H+10:continue
  area=abs(np.cross(xy[1]-xy[0],xy[2]-xy[0]))/2
  if area<.18:continue
  faces_to_draw.append((float(z[ids].mean()),mid,i,xy,ids,area))
print('render triangles',len(faces_to_draw))
faces_to_draw.sort(reverse=True,key=lambda x:x[0]);extra=0
for zz,mid,i,xy,ids,area in faces_to_draw:
 px,py,z,faces,uvimg,tex,fname=meshes[mid]
 xy_i=np.round(xy).astype(np.int32)
 # mean color from centroid texture sample
 source=uvimg[ids].mean(axis=0)
 tx=max(0,min(tex.shape[1]-1,int(source[0])));ty=max(0,min(tex.shape[0]-1,int(source[1])))
 color=tuple(int(v) for v in tex[ty,tx,:])
 if area>35 and area<120000:
  x0=max(0,int(np.floor(xy[:,0].min())));x1=min(W,int(np.ceil(xy[:,0].max()))+1)
  y0=max(0,int(np.floor(xy[:,1].min())));y1=min(H,int(np.ceil(xy[:,1].max()))+1)
  if x1-x0<1 or y1-y0<1:continue
  src=uvimg[ids].astype(np.float32);dst=(xy-np.array([x0,y0])).astype(np.float32)
  if abs(cv2.contourArea(src))<.01: cv2.fillConvexPoly(img,xy_i,color); continue
  mat=cv2.getAffineTransform(src,dst)
  warped=cv2.warpAffine(tex,mat,(x1-x0,y1-y0),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
  mask=np.zeros((y1-y0,x1-x0),dtype=np.uint8)
  cv2.fillConvexPoly(mask,np.round(dst).astype(np.int32),255)
  region=img[y0:y1,x0:x1]
  region[mask==255]=warped[mask==255]
  extra+=1
 else: cv2.fillConvexPoly(img,xy_i,color)
print('fully textured faces rendered',extra)
# text banner
cv2.rectangle(img,(20,20),(830,115),(255,255,255),-1)
cv2.putText(img,'HELSINKI LoD2 + ORTHOPHOTO 2025', (41,61),cv2.FONT_HERSHEY_SIMPLEX,.85,(35,57,73),2,cv2.LINE_AA)
cv2.putText(img,'Software preview of actual generated textured GLB geometry', (41,95),cv2.FONT_HERSHEY_SIMPLEX,.48,(74,86,94),1,cv2.LINE_AA)
out=root/'preview-helsinki-3d.png';cv2.imwrite(str(out),img);print('saved',out)
