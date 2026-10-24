"""Process-local single-use token for independently source-qualified manual review.

This token is issued by a trusted server after verified media delivery and
a matching loadedmetadata observation. It NEVER proves subjective viewing.
No identity, video modification, historical backfill or new review store.
"""
import re
import secrets
import threading
import time

CLIP=re.compile(r'motion_[0-9]{13}[.]mp4$')
DRIVE=re.compile(r'[A-Za-z0-9._-]{1,180}[.]mp4$')
SHA=re.compile(r'[a-f0-9]{64}$')

class Rejected(ValueError):pass

class Tickets:
 def __init__(self,max_active=256,lifetime_seconds=300,clock=time.monotonic,verify_deadline_seconds=180):
  if not 1<=max_active<=1024 or not 30<=lifetime_seconds<=900 or not 15<=verify_deadline_seconds<=300:
   raise ValueError('ticket_budget_invalid')
  self.clock,self.limit,self.lifetime,self.verify_deadline=clock,max_active,lifetime_seconds,verify_deadline_seconds
  self.lock=threading.RLock()
  self.tokens={}
 def prune(self,now):
  for key,row in list(self.tokens.items()):
   if (row['verify_until'] if row['reserved'] else row['expires'])<=now:self.tokens.pop(key,None)
 def issue(self,delivery):
  fields={'source','name','source_identity','source_revision','original_sha256','http_status','bytes_delivered','original_media_delivered'}
  if not isinstance(delivery,dict) or set(delivery)!=fields:raise Rejected('untrusted_delivery_fields')
  source,name=delivery['source'],delivery['name']
  if not isinstance(name,str) or source not in ('sd','drive') or not (
     CLIP.fullmatch(name) if source=='sd' else DRIVE.fullmatch(name) and '..' not in name):
   raise Rejected('invalid_original_name')
  if (not isinstance(delivery['source_identity'],str) or not 1<=len(delivery['source_identity'])<=240 or
      not isinstance(delivery['source_revision'],str) or not 1<=len(delivery['source_revision'])<=180 or
      not isinstance(delivery['original_sha256'],str) or not SHA.fullmatch(delivery['original_sha256']) or
      delivery['original_media_delivered'] is not True or delivery['http_status'] not in (200,206) or
      type(delivery['bytes_delivered']) is not int or not 1<=delivery['bytes_delivered']<=950000000):
   raise Rejected('untrusted_media_delivery')
  now=self.clock()
  with self.lock:
   self.prune(now)
   if len(self.tokens)>=self.limit:raise Rejected('ticket_capacity')
   token=secrets.token_urlsafe(32)
   self.tokens[token]={**{k:delivery[k] for k in ('source','name','source_identity','source_revision','original_sha256')},
       'reserved':False,'expires':now+self.lifetime,'verify_until':0}
   return token
 def begin(self,token,source,name):
  if not isinstance(token,str) or not 20<=len(token)<=128:raise Rejected('ticket_required')
  now=self.clock()
  with self.lock:
   self.prune(now);row=self.tokens.get(token)
   if not row or row['reserved']:raise Rejected('ticket_expired_or_in_use')
   if row['source']!=source or row['name']!=name:raise Rejected('ticket_source_mismatch')
   row['reserved']=True
   row['verify_until']=now+self.verify_deadline
   return {k:row[k] for k in ('source','name','source_identity','source_revision','original_sha256')}
 def match_proof(self,token,proof):
  with self.lock:
   self.prune(self.clock());row=self.tokens.get(token)
   if not row or not row['reserved']:raise Rejected('ticket_not_reserved')
   if not isinstance(proof,dict) or any(proof.get(k)!=row[k] for k in ('source','name','source_identity','source_revision')) or proof.get('sha256')!=row['original_sha256']:
    raise Rejected('viewed_original_proof_mismatch')
 def revoke_if_unreserved(self,token):
  """Viewer cancellation cannot interrupt a canonical commit in progress."""
  with self.lock:
   row=self.tokens.get(token)
   if row is not None and row['reserved']:return False
   self.tokens.pop(token,None)
   return True
 def abort(self,token):
  with self.lock:self.tokens.pop(token,None)
 def consumed(self,token,*,durable_commit=False):
  # This acknowledgement is internal to the CAS+fsync+readback writer.
  # No caller can use it to bypass begin()/match_proof() before persistence.
  if durable_commit is not True:raise Rejected('durable_commit_ack_required')
  with self.lock:
   row=self.tokens.get(token)
   if row is None:
    # Another request may have pruned the reserved token while the canonical
    # writer finished fsync. The completed durable commit remains true and
    # the missing token is inherently non-replayable.
    return
   if not row['reserved']:raise Rejected('ticket_not_reserved_after_commit')
   self.tokens.pop(token,None)
