#!/usr/bin/env python3
"""Owner-authenticated, read-only, provenance-checked historical head-region ROI.

Only serves locally materialized Drive body-crop derivatives. These ARE NOT
original-video verification, human face detection, identity, or model embeddings.
Never returns a signed opened-original ticket or makes a phone/Drive call.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

BASE = Path('/home/jespern/c720p-home-hub')
ROOT = BASE / 'artifacts/offline-cranial-body-crops-v1-20261026'
MANIFEST = ROOT / 'manifest.json'
ORIGINAL_FEATURE_INDEX = BASE / 'state/s9-verified-people-v33/features.json'
ORIGINAL_BODY_IMAGES = BASE / 'state/s9-verified-people-v33/images'
PREFIX = '/new/api/verified-cranial-rois'
SHA = re.compile(r'[a-f0-9]{64}\Z')
CLIP = re.compile(r'[A-Za-z0-9._-]{1,180}[.]mp4\Z')
FILENAME = re.compile(r'[a-f0-9]{64}[.]cranial-roi[.]jpg\Z')

def _bytes(path, limit, minimum=1):
    if path.is_symlink() or not path.is_file():
        raise ValueError('untrusted_crop_file')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        stat = os.fstat(fd)
        if not (minimum <= stat.st_size <= limit):
            raise ValueError('untrusted_crop_size')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            content = stream.read(limit + 1)
        if len(content) != stat.st_size:
            raise ValueError('crop_file_changed')
        return content
    finally:
        os.close(fd)

def verified_records():
    if ROOT.is_symlink() or ORIGINAL_BODY_IMAGES.is_symlink():
        raise ValueError('unsafe_crop_directory')
    raw = _bytes(MANIFEST, 250000, 10)
    doc = json.loads(raw)
    if (doc.get('schema') != 'offline-head-region-crops-v1' or
        doc.get('complete') is not True or
        doc.get('count') != doc.get('unique_outputs') or
        doc.get('count') != doc.get('eligible') or
        doc.get('count') != 108 or doc.get('errors') or
        not isinstance(doc.get('records'), list)):
        raise ValueError('incomplete_crop_manifest')
    original_index = _bytes(ORIGINAL_FEATURE_INDEX, 15000000, 50)
    if hashlib.sha256(original_index).hexdigest() != doc.get('source_index_sha256'):
        raise ValueError('crop_source_index_changed')
    active = json.loads(original_index).get('entries')
    if not isinstance(active, dict):
        raise ValueError('untrusted_source_index')
    eligible = set()
    for entry in active.values():
        if entry.get('source') != 'drive':continue
        name = entry.get('name')
        if not CLIP.fullmatch(str(name)):continue
        for track in entry.get('tracks', []):
            filename = track.get('body_image', '')
            meta = track.get('images', {}).get(filename, {})
            if SHA.fullmatch(str(meta.get('sha256', ''))):
                eligible.add((name, entry.get('original_sha256'),
                              entry.get('revision'),meta['sha256']))
    rows, lookup = [], {}
    for row in doc['records']:
        clip = row.get('source_clip_key')
        key = row.get('source_body_crop_sha256')
        outfile = row.get('output_filename')
        file_sha = row.get('geometry',{}).get('derived_sha256')
        if (row.get('source') != 'drive' or
            row.get('identity_verified') is not False or
            row.get('face_detected') is not False or
            row.get('vector_embedding') is not None or
            not CLIP.fullmatch(str(clip)) or
            not SHA.fullmatch(str(key)) or
            not SHA.fullmatch(str(file_sha)) or
            outfile != str(key) + '.cranial-roi.jpg' or
            not FILENAME.fullmatch(str(outfile)) or
            (clip,row.get('source_original_sha256'),row.get('source_revision'),key) not in eligible or
            key in lookup):
            raise ValueError('invalid_crop_provenance')
        src = ORIGINAL_BODY_IMAGES / (track_filename_for_index(active,clip,key))
        if hashlib.sha256(_bytes(src,2000000,400)).hexdigest()!=key:
            raise ValueError('body_crop_sha_changed')
        photo=ROOT/outfile
        blob=_bytes(photo,2000000,400)
        if not blob.startswith(b'\xff\xd8') or hashlib.sha256(blob).hexdigest()!=file_sha:
            raise ValueError('derived_crop_sha_changed')
        item={'source':'drive','clip':clip,
              'image_id':key,'derived_sha256':file_sha,
              'provenance':'saved_body_crop_verified;historical_original_sha_reference',
              'face_detected':False,'identity_verified':False}
        rows.append(item)
        lookup[key]=(photo,file_sha,blob)
    if len(rows)!=108:raise ValueError('incomplete_crop_index')
    return rows,lookup

def track_filename_for_index(entries,clip,key):
    for entry in entries.values():
        if entry.get('source')!='drive' or entry.get('name')!=clip:continue
        for track in entry.get('tracks',[]):
            filename=track.get('body_image','')
            if (re.fullmatch(r'[a-f0-9]{24}[.]jpg',str(filename)) and
                track.get('images',{}).get(filename,{}).get('sha256')==key):
                return filename
    raise ValueError('body_crop_reference_unavailable')

def install(H):
    if not hasattr(H,'authorized'):
        raise ValueError('authenticated_handler_required')
    previous=H.go
    def go(self,*a,**kw):
        route=urlsplit(self.path)
        if route.path!=PREFIX and not route.path.startswith(PREFIX+'/'):
            return previous(self,*a,**kw)
        if self.command not in ('GET','HEAD') or route.query:
            return self.js(404,{'ok':False,'error':'not_found'})
        if not self.authorized():
            return self.js(401,{'ok':False,'error':'authentication_required'})
        try:
            rows,lookup=verified_records()
        except (OSError,ValueError,TypeError,KeyError,json.JSONDecodeError):
            return self.js(503,{'ok':False,'error':'verified_crop_archive_unavailable'})
        if route.path==PREFIX:
            return self.js(200,{'ok':True,'schema':'verified-cranial-rois-v1',
                'count':len(rows),'identity_matching':False,'face_detection':False,
                'original_attestation':False,'items':rows})
        found=re.fullmatch(re.escape(PREFIX)+r'/image/([a-f0-9]{64})',route.path)
        if not found or found.group(1) not in lookup:
            return self.js(404,{'ok':False,'error':'crop_not_available'})
        body=lookup[found.group(1)][2]
        self.send_response(200)
        self.cors()
        self.send_header('Content-Type','image/jpeg')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Cache-Control','private, no-store')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        if self.command=='GET':
            self.wfile.write(body)
    H.go=go

