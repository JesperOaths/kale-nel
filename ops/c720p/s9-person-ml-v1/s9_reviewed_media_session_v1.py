"""Server-owned binding between full-original proof, Range delivery and player.

The browser's loadedmetadata is an observation for one nonce, NOT a proof of
human viewing. The server independently checks full original SHA via V252
before the session and again on actual human-confirmed commit.
"""
import re,secrets,threading,time
SD=re.compile(r'motion_[0-9]{13}[.]mp4$')
DRIVE=re.compile(r'[A-Za-z0-9._-]{1,180}[.]mp4$')
HEX=re.compile(r'[0-9a-f]{64}$')
class Refused(ValueError):pass
class DeliveryPending(Refused):pass  # Bounded Range still in flight; not an approval or source mismatch.

class OpenSessions:
 def __init__(self,tickets,binder,attestor,clock=time.monotonic,max_active=32,lifetime=480):
  if not 1<=max_active<=128 or not 60<=lifetime<=900:raise ValueError('invalid_session_budget')
  self.tickets,self.binder,self.attestor=tickets,binder,attestor
  self.clock,self.limit,self.lifetime=clock,max_active,lifetime
  self.lock=threading.RLock();self.sessions={}
 def prune(self,now):
  for key,row in list(self.sessions.items()):
   if row['expires']<=now:self.sessions.pop(key,None)
 def begin_original(self,source,name,verified_source_identity):
  if source not in ('sd','drive') or not isinstance(name,str) or not (
     SD.fullmatch(name) if source=='sd' else DRIVE.fullmatch(name) and '..' not in name):
   raise Refused('invalid_original_name')
  # Physical V252 verifier produces original SHA after actual hashing.
  proof=self.binder.bind_new_decision(source,name,self.attestor)
  if proof.get('source_identity')!=verified_source_identity or not isinstance(proof.get('sha256'),str) or not HEX.fullmatch(proof['sha256']):
   raise Refused('source_identity_or_digest_untrusted')
  self.binder.require_unchanged(proof,self.attestor)
  now=self.clock()
  with self.lock:
   self.prune(now)
   if len(self.sessions)>=self.limit:raise Refused('too_many_open_reviews')
   nonce=secrets.token_urlsafe(32)
   self.sessions[nonce]=dict(source=source,name=name,identity=verified_source_identity,
      revision=proof['source_revision'],sha256=proof['sha256'],size=proof['size_bytes'],
      expires=now+self.lifetime,delivered=False,finalized=False)
   return nonce
 def get(self,nonce,source,name):
  self.prune(self.clock())
  row=self.sessions.get(nonce)
  if not row or row['source']!=source or row['name']!=name or row['finalized']:
   raise Refused('unknown_or_expired_original_session')
  return row
 def require_current_stream(self,nonce,source,name):
  with self.lock:
   row=self.get(nonce,source,name)
   current=self.attestor.current_revision(source,name)
   if current.get('source_identity')!=row['identity'] or current.get('source_revision')!=row['revision']:
    raise Refused('source_replaced_before_range')
   return {'source_identity':row['identity'],'source_revision':row['revision'],
           'original_sha256':row['sha256'],'size_bytes':row['size']}
 def report_delivery(self,nonce,source,name,receipt):
  if not isinstance(receipt,dict) or set(receipt)!={'status','transferred_bytes','response_original_sha256','source_revision','source_identity'}:
   raise Refused('untrusted_range_receipt')
  with self.lock:
   row=self.get(nonce,source,name)
   if (receipt['status']!=206 or type(receipt['transferred_bytes']) is not int or
       not 1<=receipt['transferred_bytes']<=row['size'] or
       receipt['response_original_sha256']!=row['sha256'] or
       receipt['source_revision']!=row['revision'] or
       receipt['source_identity']!=row['identity']):
    raise Refused('range_not_pinned_original')
   current=self.attestor.current_revision(source,name)
   if current.get('source_identity')!=row['identity'] or current.get('source_revision')!=row['revision']:
    raise Refused('source_replaced_during_range')
   # Multiple bounded Range requests are common during seek; repeated valid
   # delivery must not issue a second review ticket or fail the video stream.
   row['delivered']=True
 def confirm_player_loaded(self,nonce,source,name,observed_playback_nonce):
  with self.lock:
   row=self.get(nonce,source,name)
   if observed_playback_nonce!=nonce:
    raise Refused('loaded_metadata_nonce_mismatch')
   if not row['delivered']:
    raise DeliveryPending('original_range_delivery_pending')
   current=self.attestor.current_revision(source,name)
   if current.get('source_identity')!=row['identity'] or current.get('source_revision')!=row['revision']:
    raise Refused('original_replaced_after_open')
   ticket=self.tickets.issue(dict(source=source,name=name,source_identity=row['identity'],
     source_revision=row['revision'],original_sha256=row['sha256'],
     http_status=206,bytes_delivered=1,original_media_delivered=True))
   row['finalized']=True
   row['review_ticket']=ticket
   return dict(review_ticket=ticket,source=source,name=name,
      reviewed_media_receipt='server_pinned_original_plus_browser_loadedmetadata',
      human_reviewed_content_not_cryptographically_proven=True)
 def discard(self,nonce,source,name):
  """Cancel exactly this opened source. Never forge consent or abort a commit."""
  with self.lock:
   row=self.sessions.get(nonce)
   if not row or row['source']!=source or row['name']!=name:
    raise Refused('unknown_or_source_mismatched_review_cancel')
   issued=row.get('review_ticket')
   if issued and not self.tickets.revoke_if_unreserved(issued):
    raise Refused('review_commit_in_progress')
   self.sessions.pop(nonce,None)
   return dict(ok=True,original_review_cancelled=True,
               canonical_registry_untouched=True)
