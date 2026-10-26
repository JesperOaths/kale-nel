#!/usr/bin/env python3
"""Offline, experimental 1024-D head+body descriptor fusion for manual triage.

Uses already locally cached JPEGs ONLY; never phone/ADB, review journals, media
provenance attestations, live API, trained ONNX features, or production indexes.

For each SHA-verified source:
  head=existing normalized handcrafted 512-D upper-region descriptor
  body=same handcrafted extractor on full local body crop
  fusion=L2([sqrt(.5)*head, sqrt(.5)*body]), 1024-D.

For S9, the full-body bounding box is scaled from 4K native track geometry to
the cached thumbnail; SAME-KEYFRAME correspondence is unverified and stays so.
"""
from __future__ import annotations
import argparse, hashlib, json, math, os, re, subprocess, tempfile
from pathlib import Path
from typing import Any

BASE = Path('/home/jespern/c720p-home-hub')
CROP_TOOL = BASE/'artifacts/offline-cranial-backfill-tool-v1-20261026'
DRIVE = BASE/'artifacts/offline-cranial-body-crops-v1-20261026'
SD = BASE/'artifacts/offline-s9-thumbnail-head-rois-v1-20261026'
DRIVE_IMAGES = BASE/'state/s9-verified-people-v33/images'
S9_THUMBS = Path('/opt/homeassistant/config/www/frontyard-security-new/s9-phone-thumbs')
OUT = BASE/'artifacts/offline-merged-manual-triage-v1-20261026'
MANUAL=BASE/'state/s9-manual-recording-links-v1.json'
MODEL='handcrafted_head_fulltrack_concat_1024d_v1'
CHILD='handcrafted_spatial_luma_chroma_gradient_512d_v1'
HEX=re.compile(r'[a-f0-9]{64}\Z')
def sha(raw: bytes)->str:return hashlib.sha256(raw).hexdigest()
def doc(path:Path):
    if path.is_symlink() or not path.is_file():raise ValueError('unsafe_document')
    raw=path.read_bytes()
    if not 5<len(raw)<15_000_000:raise ValueError('unexpected_document_size')
    return json.loads(raw),sha(raw)
def read_bound(path:Path,expected:str,limit:int=8_000_000):
    if path.is_symlink() or not path.is_file():raise ValueError('unsafe_source_image')
    blob=path.read_bytes()
    if not 400<=len(blob)<=limit or sha(blob)!=expected or not blob.startswith(b'\xff\xd8'):
        raise ValueError('source_image_sha256_mismatch')
    return blob
def raw_body_from_s9(source:Path,geom:list[int]):
    if len(geom)!=4 or any(not isinstance(x,int) for x in geom):
        raise ValueError('invalid_geometry')
    x,y,w,h=geom
    if x<0 or y<0 or w<16 or h<24:raise ValueError('undersized_geometry')
    out=subprocess.run(['ffmpeg','-v','error','-nostdin','-threads','1',
         '-i',str(source),'-vf',f'crop={w}:{h}:{x}:{y},scale=32:32:flags=area',
         '-pix_fmt','rgb24','-f','rawvideo','-frames:v','1','pipe:1'],
         stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=9,check=True)
    if len(out.stdout)!=32*32*3:raise ValueError('bad_raster_size')
    return out.stdout
def unit(vec):
    if not vec or not all(math.isfinite(float(x)) for x in vec):raise ValueError('invalid_embedding')
    den=math.sqrt(math.fsum(x*x for x in vec))
    if den<1e-10:raise ValueError('zero_embedding')
    return [float(x)/den for x in vec]
def fused(head,body):
    if len(head)!=512 or len(body)!=512:raise ValueError('model_dimensions_differ')
    w=math.sqrt(.5)
    return unit([w*x for x in unit(head)]+[w*x for x in unit(body)])
def assemble():
    import sys
    sys.path.insert(0,str(CROP_TOOL))
    from offline_handcrafted_roi_512d_v1 import vector,raw_rgb
    from offline_s9_cached_thumbnail_rois_v1 import scaled_crop
    drive_meta,drive_meta_hash=doc(DRIVE/'manifest.json')
    drive_desc,drive_desc_hash=doc(DRIVE/'handcrafted-roi-descriptors-512d-v1.json')
    sd_meta,sd_meta_hash=doc(SD/'manifest.json')
    sd_desc,sd_desc_hash=doc(SD/'handcrafted-s9-roi-descriptors-512d-v1.json')
    manual,manual_hash=doc(MANUAL)
    if (drive_meta.get('count')!=108 or sd_meta.get('count')!=52 or
        drive_desc.get('count')!=108 or sd_desc.get('count')!=52 or
        drive_desc.get('model_id')!=CHILD or sd_desc.get('model_id')!=CHILD):
        raise ValueError('unverified_descriptor_set')
    if (drive_desc['source_manifest_sha256']!=drive_meta_hash or
        sd_desc['source_manifest_sha256']!=sd_meta_hash):
        raise ValueError('manifest_descriptor_provenance_invalid')
    head={r['source_roi_sha256']:r['embedding'] for r in drive_desc['rows']}
    head.update({r['roi_sha256']:r['embedding'] for r in sd_desc['rows']})
    objects=[]
    for row in drive_meta['records']:
        key=row['geometry']['derived_sha256']
        obj={'source':'drive','clip_id':row['source_clip_key'],
            'original_index_sha256':row['source_original_sha256'],
            'head_sha256':key,'head_vector':head[key],
            'body_sha256':row['source_body_crop_sha256'],
            'body_file':str(DRIVE_IMAGES/(row['source_body_crop_sha256']+'.jpg'))}
        # Original saved body filenames are not keyed by their SHA.
        # Resolve only through the existing SHA-bound feature index.
        objects.append(obj)
    index,_=doc(BASE/'state/s9-verified-people-v33/features.json')
    body_map={}
    for e in index['entries'].values():
        if e.get('source')!='drive':continue
        for t in e.get('tracks',[]):
            filename=t.get('body_image','')
            digest=t.get('images',{}).get(filename,{}).get('sha256')
            if re.fullmatch(r'[a-f0-9]{24}[.]jpg',filename) and HEX.fullmatch(str(digest)):
                body_map[(e.get('name'),digest)]=DRIVE_IMAGES/filename
    for obj in objects:
        source=body_map.get((obj['clip_id'],obj['body_sha256']))
        if source is None:raise ValueError('missing_bound_drive_body')
        obj['body_file']=str(source)
    for row in sd_meta['items']:
        name=row['clip_id'];src=S9_THUMBS/(name+'.thumb.jpg')
        # Track geometry, including original frame dims, was already validated
        # by the source crop construction; map 75%-top crop -> full body box.
        x,y,cw,ch=row['head_geometry_thumbnail']
        original_box=row['box_original_pixels']
        thumb_w,thumb_h=row['thumbnail_source_dimensions']
        native_w,native_h=3840,2160
        fx=max(0,min(thumb_w-1,round(original_box[0]*thumb_w/native_w)))
        rx=max(0,min(thumb_w,round(original_box[2]*thumb_w/native_w)))
        fy=max(0,min(thumb_h-1,round(original_box[1]*thumb_h/native_h)))
        by=max(0,min(thumb_h,round(original_box[3]*thumb_h/native_h)))
        rect=[fx,fy,rx-fx,by-fy]
        objects.append({'source':'sd','clip_id':name,
            'original_index_sha256':row['original_index_sha256'],
            'head_sha256':row['derived_sha256'],'head_vector':head[row['derived_sha256']],
            'body_sha256':row['cached_thumbnail_sha256'],'body_file':str(src),
            'body_rect':rect})
    return objects,{'drive_manifest':drive_meta_hash,'s9_manifest':sd_meta_hash,
                    'drive_head_vectors':drive_desc_hash,'s9_head_vectors':sd_desc_hash,
                    'manual_assignments':manual_hash}
def main():
    import sys
    sys.path.insert(0,str(CROP_TOOL))
    from offline_handcrafted_roi_512d_v1 import vector,raw_rgb
    args=argparse.ArgumentParser()
    args.add_argument('--max-new',type=int,default=16)
    a=args.parse_args()
    if not 1<=a.max_new<=24:raise ValueError('max_new_exceeds_bounded_batch')
    OUT.mkdir(mode=0o700,parents=True,exist_ok=True)
    if OUT.is_symlink():raise ValueError('unsafe_output')
    path=OUT/'fused-vectors.json'
    objects,origins=assemble()
    if len(objects)!=160:raise ValueError('unexpected_reference_count')
    existing={'model_id':MODEL,'origins':origins,'rows':[]}
    if path.is_file():
        existing=json.loads(path.read_text())
        if existing.get('model_id')!=MODEL or existing.get('origins')!=origins:
            raise ValueError('stale_source_changed_fails_closed')
    cached={(r['source'],r['clip_id'],r['head_sha256']):r for r in existing['rows']}
    created=0;errors={};rows=[]
    for obj in objects:
        key=(obj['source'],obj['clip_id'],obj['head_sha256'])
        if key in cached:
            row=cached[key]
            if len(row.get('vector',[]))!=1024 or not math.isclose(
                math.sqrt(math.fsum(x*x for x in row['vector'])),1.,abs_tol=1e-8):
                raise ValueError('invalid_existing_vector')
            rows.append(row);continue
        if created>=a.max_new:continue
        try:
            file=Path(obj['body_file'])
            read_bound(file,obj['body_sha256'])
            if obj['source']=='drive':
                raw=raw_rgb(file)
            else:
                raw=raw_body_from_s9(file,obj['body_rect'])
            body=vector(raw)
            merged=fused(obj['head_vector'],body)
            rows.append({'source':obj['source'],'clip_id':obj['clip_id'],
                'original_index_sha256':obj['original_index_sha256'],
                'head_sha256':obj['head_sha256'],'body_sha256':obj['body_sha256'],
                'vector':merged,'model_id':MODEL,
                'identity_verified':False,'same_keyframe_verified':False,
                'trained_onnx_compatible':False})
            created+=1
        except (OSError,ValueError,KeyError,TypeError,subprocess.SubprocessError) as e:
            name=type(e).__name__+':'+str(e)[:85]
            errors[name]=errors.get(name,0)+1
    final={'schema':'manual_triage_1024d_fusion_v1','model_id':MODEL,
        'origins':origins,'eligible':len(objects),'count':len(rows),
        'complete':len(rows)==len(objects),'rows':rows,
        'identity_matching':False,'certified_reference_validation':False,
        'same_original_keyframes_verified':False,'trained_onnx_compatible':False,
        'errors_this_batch':errors}
    with tempfile.NamedTemporaryFile('w',dir=OUT,prefix='.fusion-',delete=False) as f:
        temp=Path(f.name);json.dump(final,f,separators=(',',':'),allow_nan=False)
        f.flush();os.fsync(f.fileno())
    try:temp.chmod(0o600);temp.replace(path)
    finally:
        if temp.exists():temp.unlink()
    print(json.dumps({'eligible':len(objects),'count':len(rows),'created':created,
        'complete':final['complete'],'errors':errors}))
if __name__=='__main__':main()

