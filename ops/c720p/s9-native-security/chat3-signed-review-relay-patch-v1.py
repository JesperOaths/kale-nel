"""Review-only source-pinned future signed relay patch (no live mutation).

Apply to the actual installed private 8794 relay ONLY after manual original
8795 routes, player and real V252 attestations are independently accepted.
Everything remains below the existing self.authorized() gate.
"""
import ast
import hashlib

BASE_BLOB='fc4bc0d1ee8f56a3a5085444cd8cbc6eb733ddab'
ALLOWED_HEAD='X-S9-Original-Review-Intent'
INTENT='explicit-original-open-v1'
POST_ANCHOR="  if path=='/new/api/verified-people/review':"
GO_ANCHOR="  # S9_MANUAL_LINKS_LAN_ROUTE_V2 read-only, guarded after authorized()"
QUERY_ANCHOR="  if subpath=='/api/anonymous-quality-consumption':"
MANUAL_ANCHOR="    if not isinstance(obj,dict) or (set(obj)!={'action','source','name','folder','revision','human_confirmed'} and not (obj.get('action')=='assign_many' and set(obj)=={'action','source','name','folder','folders','revision','human_confirmed'})):return self.empty(400)"
INTENT_HEADER='X-S9-Original-Review-Intent'

POST = """  # Chat3: explicitly signed original open / loaded observation.
  # This is below the existing authorized() boundary. No raw token is returned.
  if path in ('/new/api/review-original-open','/new/api/review-original-loaded'):
   if not self.origin_ok() or self.headers.get('X-S9-Original-Review-Intent')!='explicit-original-open-v1':return self.empty(403)
   if self.headers.get('Sec-Fetch-Site','') not in ('','same-origin','same-site','none'):return self.empty(403)
   try:
    n=int(self.headers.get('Content-Length','0'))
    if not 20<=n<=400 or 'application/json' not in self.headers.get('Content-Type','').lower():return self.empty(415)
    body=self.rfile.read(n);obj=json.loads(body)
    if not isinstance(obj,dict):return self.empty(400)
    keys={'source','name'} if path=='/new/api/review-original-open' else {'source','name','open_nonce','observed_open_nonce'}
    if set(obj)!=keys or obj.get('source') not in ('sd','drive') or not isinstance(obj.get('name'),str):return self.empty(400)
    if obj['source']=='sd':
     if not re.fullmatch(r'motion_[0-9]{13}[.]mp4',obj['name']):return self.empty(400)
    elif not re.fullmatch(r'[A-Za-z0-9._-]{1,180}[.]mp4',obj['name']) or '..' in obj['name']:return self.empty(400)
    if path=='/new/api/review-original-loaded' and any(not isinstance(obj[k],str) or not re.fullmatch(r'[A-Za-z0-9_-]{20,128}',obj[k]) for k in ('open_nonce','observed_open_nonce')):return self.empty(400)
    request=urllib.request.Request('http://127.0.0.1:8795'+path,data=body,
      headers={'Content-Type':'application/json','X-S9-Original-Review-Intent':'explicit-original-open-v1','Origin':'http://127.0.0.1'},method='POST')
    try:reply=urllib.request.urlopen(request,timeout=170 if path=='/new/api/review-original-open' else 12)
    except urllib.error.HTTPError as error:reply=error
    with reply:
     data=reply.read(8192);self.send_response(reply.status);self.cors()
     self.send_header('Content-Type','application/json');self.send_header('Cache-Control','private, no-store')
     self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    return
   except Exception:return self.empty(502)
"""
GO = """  # Chat3: session-scoped original media, never general SD/Drive access.
  m=re.fullmatch(r'/new/review-original/(sd|drive)/([A-Za-z0-9._-]{1,180}[.]mp4)',path)
  if path=='/new/api/s9-manual-recording-links/consumption':
   if head:return self.empty(405)
   return self.archive('new','/api/s9-manual-recording-links/consumption',False)
  if m:
   if head or '..' in m.group(2):return self.empty(405 if head else 400)
   if m.group(1)=='sd' and not re.fullmatch(r'motion_[0-9]{13}[.]mp4',m.group(2)):return self.empty(400)
   return self.archive('new','/review-original/'+m.group(1)+'/'+urllib.parse.quote(m.group(2)),False)
"""
QUERY = """  # Only a single, server-issued review nonce is forwarded; the optional
  # signed auth query belongs to 8794 and MUST NEVER reach private 8795.
  if subpath.startswith('/review-original/'):
   nonce=q.get('open') or []
   if not set(q).issubset({'open','auth'}) or len(nonce)!=1 or not re.fullmatch(r'[A-Za-z0-9_-]{20,128}',nonce[0]):return self.empty(400)
   suffix='?open='+urllib.parse.quote(nonce[0])
  elif subpath=='/api/s9-manual-recording-links/consumption':
   # Signed relay strips its auth credential. Forward only five pinned fields;
   # this private read endpoint never creates a decision or stores a digest.
   expected={'source','name','revision','source_revision','sha256'}
   if not set(q).issubset(expected|{'auth'}) or not expected.issubset(q) or any(len(q[k])!=1 for k in expected):
    return self.empty(400)
   source,name=q['source'][0],q['name'][0]
   if source not in ('sd','drive') or not isinstance(name,str):return self.empty(400)
   if source=='sd':
    if not re.fullmatch(r'motion_[0-9]{13}[.]mp4',name):return self.empty(400)
   elif not re.fullmatch(r'[A-Za-z0-9._-]{1,180}[.]mp4',name) or '..' in name:return self.empty(400)
   if (not re.fullmatch(r'[0-9]{1,12}',q['revision'][0]) or
       not re.fullmatch(r'[A-Za-z0-9._:-]{1,180}',q['source_revision'][0]) or
       not re.fullmatch(r'[a-f0-9]{64}',q['sha256'][0])):return self.empty(400)
   suffix='?'+urllib.parse.urlencode([(k,q[k][0]) for k in ('source','name','revision','source_revision','sha256')])
  elif subpath=='/api/anonymous-quality-consumption':"""
MANUAL = """    if not isinstance(obj,dict):return self.empty(400)
    validated=set(obj)
    if 'review_ticket' in validated:
     if not isinstance(obj['review_ticket'],str) or not re.fullmatch(r'[A-Za-z0-9_-]{20,128}',obj['review_ticket']):return self.empty(400)
     validated.remove('review_ticket')
    if (validated!={'action','source','name','folder','revision','human_confirmed'} and
        not (obj.get('action')=='assign_many' and validated=={'action','source','name','folder','folders','revision','human_confirmed'})):return self.empty(400)"""

def patch(source):
 if not isinstance(source,str):raise ValueError('wrong_source')
 if 'Chat3: session-scoped original media' in source:return source
 # Exact installed Git blob is proven by 'git hash-object', not sha1sum.
 # Refuse a future relay revision even if all four textual anchors survive.
 raw=source.encode('utf-8')
 actual=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
 if actual!=BASE_BLOB:raise ValueError('installed_relay_blob_changed')
 for anchor in (POST_ANCHOR,GO_ANCHOR,QUERY_ANCHOR,MANUAL_ANCHOR):
  if source.count(anchor)!=1:raise ValueError('installed_relay_source_drift')
 if source.count("X-S9-Automatic-Person-Intent')")!=1:
  raise ValueError('CORS_header_anchor_changed')
 source=source.replace("X-S9-Automatic-Person-Intent')","X-S9-Automatic-Person-Intent,X-S9-Original-Review-Intent')")
 source=source.replace(POST_ANCHOR,POST+POST_ANCHOR)
 source=source.replace(GO_ANCHOR,GO+GO_ANCHOR)
 source=source.replace(QUERY_ANCHOR,QUERY)
 source=source.replace(MANUAL_ANCHOR,MANUAL)
 ast.parse(source)
 return source
