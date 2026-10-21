"""Authenticated-relay-owned V361 integration hook; private 8795 only.

This handler must be installed BELOW the existing 8794 signed authorization
gate. Never infer identity or auto-file. Every request reads live V369 HTTP
and calls Chat 2's actual V361 independently source-revalidating consumer.
"""
import json
import re
from urllib.parse import urlsplit,parse_qs

PATH='/new/api/anonymous-quality-consumption'
SCHEMA='s9_anonymous_quality_consumption_v361'
READER='s9_source_current_priority_reader_v369'
NAME=re.compile(r'motion_[0-9]{13}[.]mp4$')
MAX=6_000_000

def parse_request(url):
    if not isinstance(url,str) or len(url)>340:return None
    p=urlsplit(url)
    if p.path!=PATH or p.scheme or p.netloc or p.fragment:return None
    try:q=parse_qs(p.query,keep_blank_values=True,strict_parsing=True,max_num_fields=1)
    except ValueError:return None
    if set(q)!={'clip'} or len(q['clip'])!=1 or not NAME.fullmatch(q['clip'][0]):
        return None
    return q['clip'][0]

def accept(clip,read_http,phone_rows,consumer):
    if not isinstance(clip,str) or not NAME.fullmatch(clip):
        return 400,{'ok':False,'schema_version':SCHEMA,'error':'invalid_clip'}
    try:
        status,raw=read_http('/new/api/evidence-quality')
        if status!=200 or not isinstance(raw,bytes) or not 20<len(raw)<=MAX:
            raise ValueError('live_v369_unavailable')
        document=json.loads(raw)
        if (not isinstance(document,dict) or document.get('ok') is not True or
           document.get('gap_reader_contract')!=READER or
           document.get('state')=='not_yet_available' or
           not isinstance(document.get('original_gap_benchmark'),dict)):
            raise ValueError('qualified_v369_not_ready')
        rows=phone_rows()
        if not isinstance(rows,dict) or getattr(consumer,'SCHEMA',None)!=SCHEMA:
            raise ValueError('v361_or_current_source_unavailable')
        code,body=consumer.consume(document,rows,clip)
        if code not in (200,400,410,503) or not isinstance(body,dict) or body.get('schema_version')!=SCHEMA:
            raise ValueError('invalid_v361_contract')
        if code==200 and not (body.get('ok') is True and body.get('clip_no')==clip and
            body.get('verified_same_person') is False and
            body.get('automatic_person_assignments')==0 and
            body.get('human_review_required') is True and
            body.get('source_binding_status')=='revalidated_original_and_queue_at_consumption'):
            raise ValueError('unqualified_evidence')
        return code,body
    except (ValueError,TypeError,KeyError,RuntimeError,OSError,OverflowError):
        return 503,{'ok':False,'schema_version':SCHEMA,
                    'error':'live_v369_v361_qualification_unavailable',
                    'automatic_person_assignments':0}

def install(H,phone_rows,consumer,read_http):
    previous=H.go
    def go(self):
        if urlsplit(self.path).path!=PATH:return previous(self)
        if self.command not in ('GET','HEAD'):
            return self.js(405,{'ok':False,'error':'method_not_allowed'})
        clip=parse_request(self.path)
        if clip is None:
            return self.js(400,{'ok':False,'schema_version':SCHEMA,'error':'invalid_clip'})
        if self.command=='HEAD':
            return self.js(200,{'ok':True,'schema_version':SCHEMA})
        code,body=accept(clip,read_http,phone_rows,consumer)
        return self.js(code,body)
    H.go=go
)
MAX=6_000_000

def parse_request(url):
    if not isinstance(url,str) or len(url)>340:return None
    p=urlsplit(url)
    if p.path!=PATH or p.scheme or p.netloc or p.fragment:return None
    try:q=parse_qs(p.query,keep_blank_values=True,strict_parsing=True,max_num_fields=1)
    except ValueError:return None
    if set(q)!={'clip'} or len(q['clip'])!=1 or not NAME.fullmatch(q['clip'][0]):
        return None
    return q['clip'][0]

def accept(clip,read_http,phone_rows,consumer):
    if not isinstance(clip,str) or not NAME.fullmatch(clip):
        return 400,{'ok':False,'schema_version':SCHEMA,'error':'invalid_clip'}
    try:
        status,raw=read_http('/new/api/evidence-quality')
        if status!=200 or not isinstance(raw,bytes) or not 20<len(raw)<=MAX:
            raise ValueError('live_v369_unavailable')
        document=json.loads(raw)
        if (not isinstance(document,dict) or document.get('ok') is not True or
           document.get('gap_reader_contract')!=READER or
           document.get('state')=='not_yet_available' or
           not isinstance(document.get('original_gap_benchmark'),dict)):
            raise ValueError('qualified_v369_not_ready')
        rows=phone_rows()
        if not isinstance(rows,dict) or getattr(consumer,'SCHEMA',None)!=SCHEMA:
            raise ValueError('v361_or_current_source_unavailable')
        code,body=consumer.consume(document,rows,clip)
        if code not in (200,400,410,503) or not isinstance(body,dict) or body.get('schema_version')!=SCHEMA:
            raise ValueError('invalid_v361_contract')
        if code==200 and not (body.get('ok') is True and body.get('clip_no')==clip and
            body.get('verified_same_person') is False and
            body.get('automatic_person_assignments')==0 and
            body.get('human_review_required') is True and
            body.get('source_binding_status')=='revalidated_original_and_queue_at_consumption'):
            raise ValueError('unqualified_evidence')
        return code,body
    except (ValueError,TypeError,KeyError,RuntimeError,OSError,OverflowError):
        return 503,{'ok':False,'schema_version':SCHEMA,
                    'error':'live_v369_v361_qualification_unavailable',
                    'automatic_person_assignments':0}

def install(H,phone_rows,consumer,read_http):
    previous=H.go
    def go(self):
        if urlsplit(self.path).path!=PATH:return previous(self)
        if self.command not in ('GET','HEAD'):
            return self.js(405,{'ok':False,'error':'method_not_allowed'})
        clip=parse_request(self.path)
        if clip is None:
            return self.js(400,{'ok':False,'schema_version':SCHEMA,'error':'invalid_clip'})
        if self.command=='HEAD':
            return self.js(200,{'ok':True,'schema_version':SCHEMA})
        code,body=accept(clip,read_http,phone_rows,consumer)
        return self.js(code,body)
    H.go=go
