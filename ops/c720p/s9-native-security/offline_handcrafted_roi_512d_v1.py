#!/usr/bin/env python3
"""Independent, untrained 512-D geometric ROI descriptor.

This is NOT the 512-D ONNX visual model. Never inject into model-sidecar
corpus or publish as verified identity evidence. Run only on local SHA-checked
derived JPEGs; no phone/Drive/original-video accesses.
"""
from __future__ import annotations
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile
import os

ROOT = Path('/home/jespern/c720p-home-hub/artifacts/offline-cranial-body-crops-v1-20261026')
SOURCE=ROOT/'manifest.json'
OUT=ROOT/'handcrafted-roi-descriptors-512d-v1.json'
MODEL_ID='handcrafted_spatial_luma_chroma_gradient_512d_v1'

def digest(raw):return hashlib.sha256(raw).hexdigest()
def raw_rgb(path):
    # Constant 32x32 RGB raster with deterministic FFmpeg scaling.
    call=subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-threads','1',
       '-i',str(path),'-vf','scale=32:32:flags=area','-pix_fmt','rgb24',
       '-f','rawvideo','-frames:v','1','pipe:1'],capture_output=True,timeout=8,check=True)
    if len(call.stdout)!=32*32*3:raise ValueError('untrusted_decode_shape')
    return call.stdout

def vector(raw):
    if len(raw)!=3072:raise ValueError('invalid_rgb_length')
    Y=[];U=[];V=[]
    for i in range(0,3072,3):
        r,g,b=(x/255. for x in raw[i:i+3])
        y=.299*r+.587*g+.114*b
        Y.append(y)
        U.append(b-y)
        V.append(r-y)
    def grid(values,side):
        step=32//side
        return [sum(values[(y+dy)*32+(x+dx)]
                for dy in range(step) for dx in range(step))/(step*step)
                for y in range(0,32,step) for x in range(0,32,step)]
    # 256 local luminance + 64 U + 64 V + 64 horiz-gradient +
    # 64 vertical-gradient; each independently centered to neutral gray.
    avg=sum(Y)/1024
    lum=[(v-avg)*.8 for v in grid(Y,16)]
    ch_u=[v*.8 for v in grid(U,8)]
    ch_v=[v*.8 for v in grid(V,8)]
    dx=[abs(Y[i+1]-Y[i-1])*.5 if 1<=i%32<=30 else 0.0 for i in range(1024)]
    dy=[abs(Y[i+32]-Y[i-32])*.5 if 32<=i<992 else 0.0 for i in range(1024)]
    gx=[v*.9 for v in grid(dx,8)]
    gy=[v*.9 for v in grid(dy,8)]
    values=lum+ch_u+ch_v+gx+gy
    if len(values)!=512:raise ValueError('descriptor_dimension')
    norm=math.sqrt(math.fsum(x*x for x in values))
    if not math.isfinite(norm) or norm<=1e-8:raise ValueError('constant_or_invalid_crop')
    return [x/norm for x in values]

def main():
    src=SOURCE.read_bytes()
    metadata=json.loads(src)
    if metadata.get('complete') is not True or metadata.get('count')!=108:
        raise ValueError('incomplete_derivative_manifest')
    if OUT.exists() or OUT.is_symlink():raise ValueError('existing_descriptor_manifest_untouched')
    rows=[]
    for row in metadata['records']:
        file=ROOT/row['output_filename']
        if file.is_symlink() or not file.is_file():raise ValueError('unsafe_source_image')
        content=file.read_bytes()
        if digest(content)!=row['geometry']['derived_sha256']:raise ValueError('roi_sha_mismatch')
        v=vector(raw_rgb(file))
        if not math.isclose(math.sqrt(math.fsum(x*x for x in v)),1.,rel_tol=1e-10,abs_tol=1e-10):
            raise ValueError('vector_not_l2_normalized')
        rows.append({'source_roi_sha256':row['geometry']['derived_sha256'],
         'source_body_crop_sha256':row['source_body_crop_sha256'],
         'source_original_historical_sha256':row['source_original_sha256'],
         'model_id':MODEL_ID,'embedding':v,'dimension':512,
         'person_identity_verified':False,'onnx_compatible':False})
    doc={'schema':'handcrafted-roi-descriptors-512d-v1',
         'source_manifest_sha256':digest(src),'model_id':MODEL_ID,
         'count':len(rows),'identity_matching':False,'compatible_with_visual_embedding_cosine_v1':False,
         'rows':rows}
    with tempfile.NamedTemporaryFile(mode='w',dir=ROOT,prefix='.roi-vector-',delete=False) as stream:
        temp=Path(stream.name)
        json.dump(doc,stream,separators=(',',':'),allow_nan=False)
        stream.flush();os.fsync(stream.fileno())
    try:
        temp.chmod(0o600)
        temp.replace(OUT)
    finally:
        if temp.exists():temp.unlink()
    print(json.dumps({'count':len(rows),'path':str(OUT),'sha256':digest(OUT.read_bytes()),
                     'model_id':MODEL_ID,'production_feature_index_updated':False}))
if __name__=='__main__':main()

