#!/usr/bin/env python3
"""Owner-authenticated, read-only local ONNX S9 manual-triage queue.

No phone calls, original-video claims, signed review tickets, persistence,
automatic filing, or changes to the existing suggestion/review APIs.
"""
from __future__ import annotations
import hashlib,json,math,os,re
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlsplit

BASE=Path('/home/jespern/c720p-home-hub')
MODEL=BASE/'artifacts/offline-onnx-head-body-20261026/neural-fused-1024d-v1.json'
S9=BASE/'artifacts/offline-s9-thumbnail-head-rois-v1-20261026/manifest.json'
MANUAL=BASE/'state/s9-manual-recording-links-v1.json'
NATIVE=BASE/'state/s9-visual-attributes-v36/catalog.json'
THUMBS=Path('/opt/homeassistant/config/www/frontyard-security-new/s9-phone-thumbs')
CROPS=S9.parent
PREFIX='/new/api/local-neural-manual-triage'
MODEL_SHA='91fd7e22eb6fa2e55abc65442045ec51bc52c7dac757dd065c5b0ce604b40203'
S9_SHA='371e375e18d538f9780dd681ff80b6131e43e300e5b31f992f696527374b8b42'
BACKBONE_SHA='ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d'
HEX=re.compile(r'[a-f0-9]{64}\Z')
CLIP=re.compile(r'motion_[0-9]{13}[.]mp4\Z')

def sha(b):return hashlib.sha256(b).hexdigest()
def read(path,cap,minimum=1):
    if path.is_symlink() or not path.is_file():raise ValueError('private_source_missing')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        stat=os.fstat(fd)
        if not minimum<=stat.st_size<=cap:raise ValueError('private_source_size_changed')
        with os.fdopen(fd,'rb',closefd=False) as stream:blob=stream.read(cap+1)
        if len(blob)!=stat.st_size:raise ValueError('private_source_bytes_changed')
        return blob
    finally:os.close(fd)

def source_metadata():
    if CROPS.is_symlink() or THUMBS.is_symlink():raise ValueError('source_root_changed')
    model_bytes=read(MODEL,8000000,1000)
    s9_bytes=read(S9,100000,300)
    if sha(model_bytes)!=MODEL_SHA or sha(s9_bytes)!=S9_SHA:
        raise ValueError('immutable_vector_or_crop_manifest_changed')
    model=json.loads(model_bytes)
    crop=json.loads(s9_bytes)
    if (model.get('schema')!='offline_onnx_visual_fused_1024d_v1'
        or model.get('complete') is not True or model.get('count')!=160
        or model.get('model_sha256')!=BACKBONE_SHA
        or model.get('review_attestation_changed') is not False
        or model.get('identity_matching') is not False
        or crop.get('schema')!='local-s9-approximate-head-rois-v1'
        or crop.get('count')!=52
        or len(model.get('rows',[]))!=160 or len(crop.get('items',[]))!=52):
        raise ValueError('model_or_crop_provenance_invalid')
    expected=model['source_manifest_hashes']
    if expected.get('s9_manifest')!=S9_SHA:raise ValueError('vector_manifest_source_mismatch')
    manual_bytes=read(MANUAL,250000,20)
    if sha(manual_bytes)!=expected.get('manual_assignments'):
        raise ValueError('manual_assignments_modified_since_model_built')
    manual=json.loads(manual_bytes)['items']
    native_bytes=read(NATIVE,2500000,100)
    # The mutable native catalog can contain unrelated later edits. Verify
    # every indexed S9 recording's original SHA independently below instead
    # of pinning the entire unrelated mutable catalog byte stream.
    native=json.loads(native_bytes)['items']
    by_clip={}
    for r in crop['items']:
        name=r.get('clip_id');ref=r.get('roi_id')
        if (r.get('source')!='sd' or not CLIP.fullmatch(str(name))
            or not HEX.fullmatch(str(ref))
            or not HEX.fullmatch(str(r.get('cached_thumbnail_sha256')))
            or not HEX.fullmatch(str(r.get('derived_sha256')))
            or r.get('image')!=str(ref)+'.jpg'
            or r.get('bound_to_same_native_keyframe') is not False
            or r.get('identity_verified') is not False or r.get('face_detected') is not False
            or native.get(name,{}).get('sha256')!=r.get('original_index_sha256')
            or name in by_clip):
            raise ValueError('untrusted_s9_crop_index')
        by_clip[name]=r
    return model,by_clip,manual

def unit(values):
    if not isinstance(values,list) or len(values)!=1024:raise ValueError('bad_neural_dimension')
    if any(type(v) not in (int,float) or not math.isfinite(v) for v in values):
        raise ValueError('bad_neural_values')
    length=math.sqrt(math.fsum(v*v for v in values))
    if length<1e-10:raise ValueError('zero_vector')
    return tuple(v/length for v in values)

def mean(rows):
    n=len(rows)
    return unit([math.fsum(row[i] for row in rows)/n for i in range(1024)])
def cosine(a,b):return math.fsum(x*y for x,y in zip(a,b))
def folder_ids(manual,key):
    entry=manual.get(key,{})
    ids=entry.get('folders')
    if not ids:ids=[entry['folder']] if entry.get('folder') else []
    if not isinstance(ids,list):raise ValueError('invalid_folder_index')
    return [f for f in ids if isinstance(f,str) and f]

def calculate_queue(model,crops,manual):
    grouped=defaultdict(list)
    for row in model['rows']:
        source,name=row.get('source'),row.get('clip_id')
        if source not in ('drive','sd') or not isinstance(name,str):raise ValueError('invalid_vector_identity')
        key=source+':'+name
        if row.get('model_sha256')!=BACKBONE_SHA or row.get('review_evidence') is not False:
            raise ValueError('unverified_neural_row')
        if source=='sd':
            idx=crops.get(name)
            if idx is None or row.get('head_sha256')!=idx['derived_sha256'] or row.get('original_index_sha256')!=idx['original_index_sha256']:
                raise ValueError('s9_vector_crop_identity_mismatch')
        grouped[key].append(unit(row['neural_fused']))
    if len(grouped)!=92:raise ValueError('unexpected_recording_pool')
    vectors={key:mean(rows) for key,rows in grouped.items()}
    folders=defaultdict(list)
    assigned=set()
    for key,v in vectors.items():
        ids=folder_ids(manual,key)
        if ids:
            if len(ids)!=1:raise ValueError('ambiguous_reference_label')
            folders[ids[0]].append(v)
            assigned.add(key)
    if len(assigned)!=34 or len(folders)!=8:raise ValueError('reference_corpus_changed')
    centroids={folder:mean(rows) for folder,rows in folders.items()}
    candidates=[];refs=[]
    for name,idx in crops.items():
        key='sd:'+name
        image={'source':'sd','clip_id':name,'image_id':idx['roi_id'],
             'image_sha256':idx['derived_sha256'],
             'source_thumbnail_sha256':idx['cached_thumbnail_sha256'],
             'source_original_index_sha256':idx['original_index_sha256'],
             'identity_verified':False,'face_detected':False,
             'same_keyframe_verified':False}
        if key in assigned:
            refs.append({**image,'folder_id':folder_ids(manual,key)[0]})
            continue
        ranking=sorted(((fid,cosine(vectors[key],vector))
                       for fid,vector in centroids.items()),key=lambda pair:(-pair[1],pair[0]))
        candidates.append({**image,'folder_id':ranking[0][0],
             'score':round(ranking[0][1],6),
             'review_status':'manual_triage_only','review_ticket_issued':False,
             'automatic_identity_matching':False})
    if len(candidates)!=49 or len(refs)!=3:raise ValueError('wrong_unassigned_s9_corpus')
    candidates.sort(key=lambda row:(-row['score'],row['clip_id']))
    return {'ok':True,'schema':'local-neural-manual-triage-v1',
       'scoring_mode':'onnx_head_body_concat_1024d_manual_triage',
       'identity_matching':False,'original_attestation':False,
       'review_writes_enabled':False,'automatic_assignments':0,
       'threshold_filter_applied':False,'count':len(candidates),'reference_count':34,
       'folder_ids':sorted(folders),'items':candidates,'assigned_s9_crops':refs}

def crop_blob(record):
    if (record.get('image') != record['roi_id']+'.jpg'
        or not HEX.fullmatch(str(record.get('derived_sha256')))):
        raise ValueError('invalid_source_roi')
    frame=read(THUMBS/(record['clip_id']+'.thumb.jpg'),8000000,400)
    if sha(frame)!=record['cached_thumbnail_sha256']:raise ValueError('source_preview_changed')
    crop=read(CROPS/record['image'],2000000,350)
    if not crop.startswith(b'\xff\xd8') or sha(crop)!=record['derived_sha256']:
        raise ValueError('derived_crop_changed')
    return crop

def reply(handler,status,payload):
    # The production relay H has send_response/cors, not a .js() helper.
    body=json.dumps(payload,separators=(',',':'),allow_nan=False).encode('utf-8')
    handler.send_response(status)
    handler.cors()
    handler.send_header('Content-Type','application/json; charset=utf-8')
    handler.send_header('Cache-Control','private, no-store')
    handler.send_header('X-Content-Type-Options','nosniff')
    handler.send_header('Content-Length',str(len(body)))
    handler.end_headers()
    if handler.command!='HEAD':handler.wfile.write(body)

def install(H):
    if not hasattr(H,'authorized'):raise ValueError('owner_auth_required')
    previous=H.go
    def go(self,*args,**kw):
        path=urlsplit(self.path)
        if path.path!=PREFIX and not path.path.startswith(PREFIX+'/'):
            return previous(self,*args,**kw)
        if self.command not in ('GET','HEAD') or path.query:
            return reply(self,404,{'ok':False,'error':'not_found'})
        if not self.authorized():
            return reply(self,401,{'ok':False,'error':'authentication_required'})
        try:
            model,crops,manual=source_metadata()
            if path.path==PREFIX:
                result=calculate_queue(model,crops,manual)
                # Complete bound-crop verification before showing queue images.
                for record in crops.values():crop_blob(record)
                return reply(self,200,result)
            match=re.fullmatch(re.escape(PREFIX)+r'/image/([a-f0-9]{64})',path.path)
            record=next((r for r in crops.values() if match and r['roi_id']==match.group(1)),None)
            if record is None:return reply(self,404,{'ok':False,'error':'not_indexed'})
            blob=crop_blob(record)
            self.send_response(200);self.cors()
            self.send_header('Content-Type','image/jpeg')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Cache-Control','private,no-store')
            self.send_header('Content-Length',str(len(blob)))
            self.end_headers()
            if self.command=='GET':self.wfile.write(blob)
        except (OSError,ValueError,TypeError,KeyError,json.JSONDecodeError):
            return reply(self,503,{'ok':False,'error':'local_neural_triage_unavailable'})
    H.go=go

