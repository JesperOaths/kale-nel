"""Single authoritative forward-only writer for source-attested human reviews.

Opt-in activation only with live signed review endpoints. Uses the existing
s9-manual-recording-links-v1.json, lock, append-only audit and revision CAS.
Historical/unbound entries are NEVER converted to bound.
"""
import datetime as dt,fcntl,json,os,re
from urllib.parse import urlsplit,parse_qs
from s9_forward_review_commit_v1 import prepare_then_commit

class Conflict(RuntimeError):pass
class FutureWriter:
 def __init__(self,legacy,attestor,binder,tickets):
  self.legacy,self.attestor,self.binder,self.tickets=legacy,attestor,binder,tickets
 def report(self):
  old=self.legacy.report()
  if old.get('ok') is not True or not isinstance(old.get('items'),dict):
   raise RuntimeError('registry_unavailable')
  counts=dict(bound=0,historically_unbound=0,source_unavailable=0,revision_mismatch=0)
  visible={}
  for key,entry in old['items'].items():
   state=self.binder.display_status(entry,self.attestor)
   counts[state]+=1
   # Extra fields are a response view only. Do NOT rewrite the historical
   # registry or treat a bound-at-decision record as permanently current.
   visible[key]=dict(entry,media_binding_display_status=state)
  return dict(old,items=visible,binding_counts=counts,
      forward_binding_schema='manual_original_digest_binding_v1',
      historical_authority_preserved=True,digest_backfill_performed=False,
      new_actions_require_trusted_media_receipt=True,
      automatic_identity_matching=False)
 def consume(self,source,name,expected_registry_revision,expected_source_revision,expected_sha256):
  """Read-only, revision-qualified canonical consumer acceptance.

  A successful response is a current snapshot, NOT durable permission to use
  media forever. Consumers must revalidate the original revision at use-time.
  Never promotes historically unbound reviews or creates an approval.
  """
  if (source not in ('sd','drive') or not isinstance(name,str) or
      not isinstance(expected_source_revision,str) or
      not re.fullmatch(r'[A-Za-z0-9._:-]{1,180}',expected_source_revision) or
      not isinstance(expected_sha256,str) or
      not re.fullmatch(r'[0-9a-f]{64}',expected_sha256) or
      type(expected_registry_revision) is not int or expected_registry_revision<0):
   return 400,dict(ok=False,error='invalid_consumer_revision_request')
  if (not self.legacy.LOCK.is_file() or self.legacy.LOCK.is_symlink() or
      self.legacy.STORE.is_symlink()):
   return 503,dict(ok=False,error='canonical_registry_lock_unavailable')
  try:
   with self.legacy.LOCK.open('r') as lock:
    fcntl.flock(lock,fcntl.LOCK_SH)
    state=self.legacy.current()
    if state['revision']!=expected_registry_revision:
     return 409,dict(ok=False,error='canonical_registry_revision_stale')
    key=source+':'+name
    entry=state['items'].get(key)
    if not isinstance(entry,dict):return 404,dict(ok=False,error='canonical_manual_decision_missing')
    binding=entry.get('media_binding')
    if (not isinstance(binding,dict) or
        binding.get('status')!='bound_at_decision'):
     return 409,dict(ok=False,error='historical_or_unbound_not_eligible')
    if (binding.get('source')!=source or binding.get('name')!=name or
        binding.get('source_revision')!=expected_source_revision or
        binding.get('sha256')!=expected_sha256):
     return 409,dict(ok=False,error='consumer_original_binding_mismatch')
    if self.binder.display_status(entry,self.attestor)!='bound':
     return 409,dict(ok=False,error='consumer_original_not_current')
    self.binder.require_unchanged(binding,self.attestor)
    return 200,dict(ok=True,schema_version='manual_original_consumer_snapshot_v1',
      registry_revision=state['revision'],source=source,name=name,
      source_identity=binding['source_identity'],
      source_revision=binding['source_revision'],original_sha256=binding['sha256'],
      folder=entry.get('folder'),folders=entry.get('folders',[]),
      review_status=entry.get('review_status'),human_decision_recorded=True,
      human_review_not_proven_by_playback=True,source_must_be_revalidated_at_use=True)
  except self.binder.Refused:
   # A source can disappear between display_status and the final check.
   # Its previously bound decision remains, but consumption is ineligible.
   return 409,dict(ok=False,error='consumer_original_not_current')
  except (OSError,TypeError,ValueError,KeyError,RuntimeError):
   return 503,dict(ok=False,error='canonical_consumer_unavailable')
 def mutate(self,body,sd_names):
  if not isinstance(body,dict):return 400,dict(ok=False,error='wrong_fields')
  action=body.get('action')
  expected={'action','source','name','folder','revision','human_confirmed','review_ticket'}
  if action=='assign_many':expected.add('folders')
  if set(body)!=expected:return 400,dict(ok=False,error='wrong_fields')
  if action not in ('assign','assign_many','return_to_queue','skip','reject'):
   return 400,dict(ok=False,error='wrong_action')
  source,name=body['source'],body['name']
  if not isinstance(name,str) or not self.legacy.source_known(source,name,sd_names):
   return 404,dict(ok=False,error='source_not_in_verified_archive')
  if body['human_confirmed'] is not True:
   return 400,dict(ok=False,error='explicit_human_review_required')
  folder=body['folder']
  if action=='assign':
   if not isinstance(folder,str) or not self.legacy.FOLDER.fullmatch(folder):
    return 400,dict(ok=False,error='invalid_folder')
   chosen=[folder]
  elif action=='assign_many':
   chosen=body['folders']
   if (not isinstance(chosen,list) or not 1<=len(chosen)<=8 or
       any(not isinstance(x,str) or not self.legacy.FOLDER.fullmatch(x) for x in chosen) or
       len(set(chosen))!=len(chosen) or folder!=chosen[0]):
    return 400,dict(ok=False,error='invalid_folder_selection')
  else:
   if folder is not None:return 400,dict(ok=False,error='return_requires_null_folder')
   chosen=[]
  expected_revision=body['revision']
  if type(expected_revision) is not int or expected_revision<0:
   return 400,dict(ok=False,error='revision_required')
  ticket=body['review_ticket']
  if not isinstance(ticket,str) or not 20<=len(ticket)<=128:
   return 400,dict(ok=False,error='trusted_review_ticket_required')
  if (not self.legacy.LOCK.is_file() or self.legacy.LOCK.is_symlink() or
      self.legacy.AUDIT.is_symlink() or self.legacy.STORE.is_symlink()):
   return 503,dict(ok=False,error='unsafe_registry_path')
  def locked_write(revision,binding,revalidate):
   with self.legacy.LOCK.open('a+') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX)
    old=self.legacy.current()
    if old['revision']!=revision:raise Conflict('concurrent_writer')
    revalidate()
    key=source+':'+name
    previous=old['items'].get(key)
    state='assigned' if chosen else {'return_to_queue':'inbox','skip':'skipped','reject':'rejected'}[action]
    entry=dict(source=source,name=name,folder=chosen[0] if chosen else None,
       folders=list(chosen),review_status=state,media_binding=binding)
    new=dict(version=1,revision=revision+1,items={**old['items'],key:entry})
    log=dict(at=dt.datetime.now(dt.timezone.utc).isoformat(),manual=True,
       reviewed_media_ticket_verified=True,source=source,name=name,action=action,
       revision=revision+1,from_folder=previous.get('folder') if isinstance(previous,dict) else None,
       to=entry['folder'],to_folders=list(chosen),to_review_status=state,
       media_binding=binding)
    self.legacy.atomic(new)
    try:
     fd=os.open(self.legacy.AUDIT,os.O_CREAT|os.O_APPEND|os.O_WRONLY|os.O_NOFOLLOW,0o600)
     with os.fdopen(fd,'a',encoding='utf-8') as audit:
      audit.write(json.dumps(log,sort_keys=True)+'\n')
      audit.flush();os.fsync(audit.fileno())
    except BaseException:
     self.legacy.atomic(old)
     raise
    saved=self.legacy.current()
    if saved['revision']!=new['revision'] or saved['items'].get(key)!=entry:
     raise RuntimeError('durable_readback_failed')
    return dict(ok=True,persisted=True,revision=saved['revision'],source=source,name=name,
      folder=entry['folder'],folders=list(chosen),review_status=state,
      media_binding_status='bound_at_decision',manual_links_only=True)
  try:
   result=prepare_then_commit(source=source,name=name,review_ticket=ticket,
     expected_revision=expected_revision,tickets=self.tickets,
     attestor=self.attestor,binding_protocol=self.binder,locked_write=locked_write)
   return 200,result
  except Conflict:return 409,dict(ok=False,error='review_revision_changed')
  except ValueError:return 409,dict(ok=False,error='reviewed_original_ticket_or_source_stale')
  except (OSError,RuntimeError,TypeError,Exception):
   # Includes the binder's own Refused(Exception), not merely ValueError.
   # It can never become an unbound acceptance or an HTTP handler traceback.
   return 503,dict(ok=False,error='trusted_original_or_persistence_unavailable')

def install(H,legacy,sd_names,attestor,binder,tickets):
 future=FutureWriter(legacy,attestor,binder,tickets)
 previous_get,previous_post=H.go,H.do_POST
 def get(self):
  path=urlsplit(self.path)
  if path.path==legacy.ROUTE+'/consumption':
   if self.command!='GET':return self.js(405,dict(ok=False,error='get_only'))
   try:
    q=parse_qs(path.query,strict_parsing=True,max_num_fields=5)
    if set(q)!={'source','name','revision','source_revision','sha256'} or any(len(v)!=1 for v in q.values()):
     return self.js(400,dict(ok=False,error='consumer_fields_required'))
    revision=q['revision'][0]
    if not re.fullmatch(r'[0-9]{1,12}',revision):raise ValueError('bad_revision')
    status,reply=future.consume(q['source'][0],q['name'][0],int(revision),
      q['source_revision'][0],q['sha256'][0])
    return self.js(status,reply)
   except (ValueError,TypeError):
    return self.js(400,dict(ok=False,error='consumer_revision_invalid'))
  if path.path!=legacy.ROUTE or path.query:return previous_get(self)
  if self.command=='HEAD':return self.js(200,dict(ok=True))
  try:return self.js(200,future.report())
  except (OSError,ValueError,RuntimeError):
   return self.js(503,dict(ok=False,error='manual_registry_unavailable'))
 def post(self):
  path=urlsplit(self.path)
  if path.path!=legacy.WRITE or self.headers.get('X-S9-Manual-Link-Intent')!=legacy.INTENT:
   return previous_post(self)
  if 'application/json' not in self.headers.get('Content-Type','').lower():
   return self.js(415,dict(ok=False,error='json_only'))
  if self.headers.get('Origin','').strip() not in ('',*legacy.ORIGINS):
   return self.js(403,dict(ok=False,error='origin_denied'))
  if self.headers.get('Sec-Fetch-Site','') not in ('','same-origin','none'):
   return self.js(403,dict(ok=False,error='cross_site_denied'))
  try:
   count=int(self.headers.get('Content-Length','0'))
   if not 40<=count<=1600:raise ValueError('invalid_body_size')
   obj=json.loads(self.rfile.read(count))
  except (OSError,ValueError,TypeError):
   return self.js(400,dict(ok=False,error='invalid_manual_review'))
  status,result=future.mutate(obj,sd_names())
  return self.js(status,result)
 H.go=get;H.do_POST=post
 return future
