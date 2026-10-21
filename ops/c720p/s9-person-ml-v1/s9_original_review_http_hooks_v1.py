"""Dormant private reviewed-original HTTP handlers: never anonymous.

Activation requires an accepted revision-pinned SD/Drive delegate, signed
8794 routes and independent V252 byte attestation. The server issues no
ticket merely because a URL was generated, a HEAD returned or the browser
claimed a SHA. The player loadedmetadata claim is non-cryptographic.
"""
import json,re
from urllib.parse import urlsplit,parse_qs,quote

OPEN='/new/api/review-original-open'
LOADED='/new/api/review-original-loaded'
INTENT='explicit-original-open-v1'
MEDIA=re.compile(r'/new/review-original/(sd|drive)/([A-Za-z0-9._-]{1,180}[.]mp4)$')
NONCE=re.compile(r'[A-Za-z0-9_-]{20,128}$')
class Refused(ValueError):pass

def install(H,*,sessions,original_delegate,verified_source):
 if not callable(original_delegate) or not callable(verified_source):
  raise Refused('trusted_original_delegate_missing')
 old_post,old_go=H.do_POST,H.go
 def post(self):
  p=urlsplit(self.path)
  if p.path not in (OPEN,LOADED):return old_post(self)
  if p.query or self.headers.get('X-S9-Original-Review-Intent')!=INTENT:
   return self.js(403,dict(ok=False,error='explicit_review_intent_required'))
  if 'application/json' not in self.headers.get('Content-Type','').lower():
   return self.js(415,dict(ok=False,error='json_only'))
  if self.headers.get('Origin','').strip() not in ('','http://127.0.0.1','http://localhost','http://localhost:8123','http://127.0.0.1:8123','https://kalenel.nl','https://www.kalenel.nl'):
   return self.js(403,dict(ok=False,error='review_origin_denied'))
  if self.headers.get('Sec-Fetch-Site','') not in ('','same-origin','none'):
   return self.js(403,dict(ok=False,error='cross_site_denied'))
  try:
   size=int(self.headers.get('Content-Length','0'))
   if not 20<=size<=400:raise Refused('invalid_size')
   body=json.loads(self.rfile.read(size))
   if not isinstance(body,dict):raise Refused('invalid_fields')
   source,name=body.get('source'),body.get('name')
   if p.path==OPEN:
    if set(body)!={'source','name'}:raise Refused('unexpected_open_fields')
    original_identity=verified_source(source,name)
    nonce=sessions.begin_original(source,name,original_identity)
    return self.js(200,dict(ok=True,source=source,name=name,
     open_nonce=nonce,playback_path='/new/review-original/'+source+'/'+quote(name)+'?open='+nonce,
     server_original_revision_anchored=True))
   if set(body)!={'source','name','open_nonce','observed_open_nonce'}:
    raise Refused('unexpected_loaded_fields')
   nonce=body['open_nonce']
   if not isinstance(nonce,str) or not NONCE.fullmatch(nonce):raise Refused('invalid_nonce')
   result=sessions.confirm_player_loaded(nonce,source,name,body['observed_open_nonce'])
   return self.js(200,dict(ok=True,**result))
  except (ValueError,TypeError,KeyError,OSError,RuntimeError):
   return self.js(409,dict(ok=False,error='original_not_delivered_or_source_changed'))
 def go(self):
  path=urlsplit(self.path);m=MEDIA.fullmatch(path.path)
  if not m:return old_go(self)
  if self.command!='GET':return self.js(405,dict(ok=False,error='get_only'))
  try:q=parse_qs(path.query,strict_parsing=True,max_num_fields=1)
  except ValueError:return self.js(400,dict(ok=False,error='invalid_open_nonce'))
  if set(q)!={'open'} or len(q['open'])!=1 or not NONCE.fullmatch(q['open'][0]):
   return self.js(400,dict(ok=False,error='review_nonce_required'))
  source,name=m.groups();nonce=q['open'][0]
  try:
   pinned=sessions.require_current_stream(nonce,source,name)
  except (ValueError,OSError,RuntimeError):
   return self.js(409,dict(ok=False,error='original_session_stale'))
  def after_transfer(metadata):sessions.report_delivery(nonce,source,name,metadata)
  return original_delegate(self,source,name,nonce,pinned,after_transfer)
 H.do_POST=post;H.go=go
