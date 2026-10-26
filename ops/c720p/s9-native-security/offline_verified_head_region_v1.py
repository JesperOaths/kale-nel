#!/usr/bin/env python3
"""Offline SHA-bound head-region JPEG derivatives of already-local BODY crops.

NO phone, network, original videos, home-assistant writes, identity assertions
or embedding claims. Separate private artifact; never treat a geometric crop
as proof of a human face or a calibrated face-recognition feature.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path('/home/jespern/c720p-home-hub/state/s9-verified-people-v33')
INDEX = ROOT/'features.json'
IMAGES = ROOT/'images'
OUT = Path('/home/jespern/c720p-home-hub/artifacts/offline-cranial-body-crops-v1-20261026')
IMAGE_PATTERN = re.compile(r'[a-f0-9]{24}[.]jpg\Z')
SHA = re.compile(r'[a-f0-9]{64}\Z')

def sha(raw):return hashlib.sha256(raw).hexdigest()
def check_output(src: Path):
    if src.is_symlink() or not src.is_file():
        raise ValueError('source_not_regular')
    raw=src.read_bytes()
    if not (400<=len(raw)<2000000 and raw.startswith(b'\xff\xd8')):
        raise ValueError('invalid_local_jpeg')
    return raw

def dimensions(path, *, min_h=16):
    raw=check_output(path)
    if raw[:2]!=b'\xff\xd8':raise ValueError('jpeg_header_missing')
    pos=2
    # JPEG SOF is outside entropy-coded pixels. Decode only the length-prefixed
    # header, never decode image or scan pixel payload in the root process.
    while pos+4<len(raw):
        if raw[pos]!=255:raise ValueError('jpeg_marker_invalid')
        while pos<len(raw) and raw[pos]==255:pos+=1
        if pos>=len(raw):break
        marker=raw[pos];pos+=1
        if marker in (0xD8,0xD9) or 0xD0<=marker<=0xD7:continue
        if marker==0xDA:raise ValueError('jpeg_no_image_dimensions')
        length=int.from_bytes(raw[pos:pos+2],'big')
        if length<2 or pos+length>len(raw):raise ValueError('jpeg_section_invalid')
        if marker in (0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF):
            if length<8:raise ValueError('jpeg_sof_invalid')
            h=int.from_bytes(raw[pos+3:pos+5],'big')
            w=int.from_bytes(raw[pos+5:pos+7],'big')
            if not (16<=w<=4096 and min_h<=h<=4096):raise ValueError('unsupported_crop_size')
            return w,h
        pos+=length
    raise ValueError('jpeg_dimensions_missing')

def crop(img, target):
    w,h=dimensions(img)
    # Source is the already SAVED bounding-box crop of a single track. Choose
    # the horizontally centred 75% width and top 25% height (even JPEG dims).
    cw=max(2,((w*3//4)//2)*2)
    ch=max(2,((h//4)//2)*2)
    x=((w-cw)//2)//2*2
    vf=f'crop={cw}:{ch}:{x}:0'
    with tempfile.NamedTemporaryFile(dir=target.parent,suffix='.jpg',delete=False) as temp:
        path=Path(temp.name)
    try:
        subprocess.run(['ffmpeg','-v','error','-nostdin','-threads','1',
            '-i',str(img),'-vf',vf,'-frames:v','1','-q:v','2','-y',str(path)],
            check=True,capture_output=True,timeout=12)
        blob=check_output(path)
        if target.exists() or target.is_symlink():raise ValueError('unexpected_output_conflict')
        path.chmod(0o600)
        path.replace(target)
        return {'width':cw,'height':ch,'x':x,'y':0,'derived_sha256':sha(blob)}
    finally:
        if path.exists():path.unlink()

def main():
    if INDEX.is_symlink() or not INDEX.is_file() or IMAGES.is_symlink():
        raise ValueError('unsafe_source_index')
    if shutil.disk_usage(OUT.parent).free < 850 * 1024 * 1024:
        raise ValueError('host_disk_reserve_low')
    raw=INDEX.read_bytes()
    if len(raw)>15000000:raise ValueError('feature_index_too_large')
    doc=json.loads(raw)
    if not isinstance(doc.get('entries'),dict):raise ValueError('unsupported_reference_index')
    if OUT.is_symlink():raise ValueError('output_symlink_forbidden')
    OUT.mkdir(parents=True,mode=0o700,exist_ok=True)
    if OUT.stat().st_mode & 0o077:raise ValueError('private_output_required')
    limit=int(os.environ.get('MAX_NEW_CROPS','16'))
    if not 1<=limit<=24:raise ValueError('batch_limit_invalid')
    created=0;eligible=0
    records=[];errors={}
    for idx,row in enumerate(doc['entries'].values()):
        if row.get('source')!='drive' or not SHA.fullmatch(str(row.get('original_sha256',''))):
            continue
        if not isinstance(row.get('revision'),str) or not row['revision']:
            continue
        for track in row.get('tracks',[]):
            img=track.get('body_image','')
            meta=track.get('images',{}).get(img,{})
            if (not IMAGE_PATTERN.fullmatch(str(img)) or
                not SHA.fullmatch(str(meta.get('sha256',''))) or
                meta.get('kind') not in ('body','body-v35')):
                continue
            eligible+=1
            source=IMAGES/img
            try:
                source_hash=sha(check_output(source))
                if source_hash!=meta['sha256']:raise ValueError('source_sha_mismatch')
                target=OUT/(source_hash+'.cranial-roi.jpg')
                # Identical saved body crops share one derived JPEG.
                w,h=dimensions(source)
                cw=max(2,((w*3//4)//2)*2)
                ch=max(2,((h//4)//2)*2)
                x=((w-cw)//2)//2*2
                if not target.exists() and created>=limit:
                    continue
                if not target.exists():
                    dims=crop(source,target)
                    created+=1
                else:
                    d=dimensions(target,min_h=16)
                    if d!=(cw,ch):raise ValueError('existing_crop_dimensions_changed')
                    dims={'width':cw,'height':ch,'x':x,'y':0,
                          'derived_sha256':sha(check_output(target))}
                records.append({
                    'source':'drive','source_original_sha256':row['original_sha256'],
                    'source_revision':row['revision'],
                    'source_body_crop_sha256':source_hash,
                    'source_kind':meta['kind'],
                    'output_filename':target.name,
                    'source_clip_key':str(row.get('name',''))[:200],
                    'track_id':str(track.get('id',''))[:100],
                    'geometry':dims,
                    'proof_level':'historical_original_hash_only; current_local_crop_sha_verified',
                    'identity_verified':False,'face_detected':False,
                    'vector_embedding':None,
                })
            except (ValueError,KeyError,TypeError,OSError,subprocess.SubprocessError) as e:
                errors[type(e).__name__+':'+str(e)[:80]]=errors.get(type(e).__name__+':'+str(e)[:80],0)+1
    result={'schema':'offline-head-region-crops-v1','source_index_sha256':sha(raw),
            'derived_from':'SHA-verified locally saved body-crop JPEG, not original keyframe',
            'model':'none; no 512-D vector computed','records':records,'errors':errors,
            'count':len(records),'eligible':eligible,'complete':len(records)==eligible and not errors,
            'unique_outputs':len({r['output_filename'] for r in records})}
    temp=OUT/'manifest.json.tmp'
    temp.write_text(json.dumps(result,sort_keys=True,separators=(',',':')))
    temp.chmod(0o600)
    temp.replace(OUT/'manifest.json')
    print(json.dumps({'output':str(OUT),'records':len(records),
                      'eligible':eligible,'complete':result['complete'],
                      'new':created,'unique_outputs':result['unique_outputs'],
                      'errors':errors}))
if __name__=='__main__':main()

