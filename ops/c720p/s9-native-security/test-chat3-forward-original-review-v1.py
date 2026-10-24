"""Synthetic-only integration: actual binder contract; temp registry, no media or decisions."""
import datetime as dt,json,os,pathlib,re,sys,tempfile,threading,time,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'s9-person-ml-v1'))
from s9_manual_review_open_ticket_v1 import Tickets,Rejected
from s9_reviewed_media_session_v1 import OpenSessions,Refused,DeliveryPending
from s9_forward_manual_writer_v1 import FutureWriter
import s9_manual_media_digest_binding_v1 as binder
CLIP='motion_1000000000000.mp4'
SECOND='motion_1000000000001.mp4'
class Attestor:
 def __init__(self):
  self.rev='rev1';self.lock=threading.Lock();self.slow=0
 def current_revision(self,source,name):
  with self.lock:return {'source_identity':'original:sd:one','source_revision':self.rev}
 def verify_bytes(self,source,name):
  if self.slow:time.sleep(self.slow)
  with self.lock:revision=self.rev
  return dict(source=source,name=name,source_identity='original:sd:one',
    source_revision=revision,sha256='a'*64,size_bytes=12000,
    verified_at_utc=dt.datetime.now(dt.timezone.utc).isoformat(),
    verified_original_bytes=True,method='streamed_sha256_original_mp4',
    verifier='phone-original-byte-auditor')
class Legacy:
 FOLDER=re.compile(r'[A-Za-z0-9_-]{1,100}$')
 ORIGINS={'http://localhost'}
 INTENT='manual-original-review-links-v1'
 ROUTE=WRITE='/new/api/s9-manual-recording-links'
 def __init__(self,root):
  self.STORE=pathlib.Path(root)/'reviews.json';self.LOCK=pathlib.Path(root)/'reviews.lock'
  self.AUDIT=pathlib.Path(root)/'audit.jsonl';self.LOCK.touch()
  self.items={f'sd:historical-{i}':{'source':'sd','name':f'historical-{i}','review_status':'assigned','folder':'past'} for i in range(48)}
  self.atomic(dict(version=1,revision=50,items=self.items))
 def current(self):return json.loads(self.STORE.read_text())
 def report(self):
  state=self.current();return dict(ok=True,revision=state['revision'],items=state['items'])
 def source_known(self,source,name,sd_names):return source=='sd' and name in (CLIP,SECOND)
 def atomic(self,document):
  path=self.STORE.with_suffix('.tmp')
  with path.open('w') as stream:
   json.dump(document,stream);stream.flush();os.fsync(stream.fileno())
  os.replace(path,self.STORE)
class Tests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.legacy=Legacy(self.temp.name);self.attestor=Attestor();self.tokens=Tickets()
  self.sessions=OpenSessions(self.tokens,binder,self.attestor)
  self.writer=FutureWriter(self.legacy,self.attestor,binder,self.tokens)
 def open(self,name=CLIP):
  nonce=self.sessions.begin_original('sd',name,'original:sd:one')
  revision=self.sessions.require_current_stream(nonce,'sd',name)
  self.sessions.report_delivery(nonce,'sd',name,dict(status=206,
      transferred_bytes=256,response_original_sha256=revision['original_sha256'],
      source_revision=revision['source_revision'],source_identity=revision['source_identity']))
  # Repeated Range fetch on the same original must be safe.
  self.sessions.report_delivery(nonce,'sd',name,dict(status=206,
      transferred_bytes=128,response_original_sha256=revision['original_sha256'],
      source_revision=revision['source_revision'],source_identity=revision['source_identity']))
  return self.sessions.confirm_player_loaded(nonce,'sd',name,nonce)['review_ticket']
 def decision(self,ticket,name=CLIP,revision=50):
  return dict(action='assign',source='sd',name=name,folder='person-a',
      revision=revision,human_confirmed=True,review_ticket=ticket)
 def test_existing_historical_decision_is_never_rewritten_or_temporarily_bound(self):
  # An independently reviewed ORIGINAL can share a basename with a historical
  # decision; refusing that transaction must preserve all previous authority.
  old=self.legacy.current()
  historical=old['items'].pop('sd:historical-0')
  old['items']['sd:'+CLIP]=dict(historical,source='sd',name=CLIP)
  self.legacy.atomic(old)
  ticket=self.open()
  before=self.legacy.current()
  attempts=[]
  def forbid_atomic(*args,**kwargs):
   attempts.append(1)
   raise AssertionError('historical_entry_write_attempted')
  self.legacy.atomic=forbid_atomic
  status,result=self.writer.mutate(self.decision(ticket),[CLIP])
  self.assertEqual(status,409)
  self.assertEqual(result['error'],'historical_re_review_not_supported_this_release')
  self.assertTrue(result['existing_decision_preserved'])
  self.assertEqual(attempts,[])
  self.assertEqual(self.legacy.current(),before)
  self.assertFalse(self.legacy.AUDIT.exists())
 def test_persist_and_historical_unchanged(self):
  ticket=self.open()
  status,result=self.writer.mutate(self.decision(ticket),[CLIP])
  self.assertEqual(status,200);self.assertTrue(result['persisted'])
  stored=self.legacy.current()
  self.assertEqual(stored['revision'],51)
  self.assertEqual(len(stored['items']),49)
  for key,old in self.legacy.items.items():self.assertEqual(stored['items'][key],old)
  self.assertEqual(stored['items']['sd:'+CLIP]['media_binding']['status'],'bound_at_decision')
  self.assertEqual(len(self.legacy.AUDIT.read_text().splitlines()),1)
 def test_ticket_replay_refused(self):
  ticket=self.open()
  self.assertEqual(self.writer.mutate(self.decision(ticket),[CLIP])[0],200)
  self.assertNotEqual(self.writer.mutate(self.decision(ticket,revision=51),[CLIP])[0],200)
 def test_revocation_before_delivery(self):
  nonce=self.sessions.begin_original('sd',CLIP,'original:sd:one')
  self.attestor.rev='rev2'
  with self.assertRaises(Refused):self.sessions.require_current_stream(nonce,'sd',CLIP)
  self.assertEqual(self.legacy.current()['revision'],50)
 def test_replacement_before_commit(self):
  ticket=self.open();self.attestor.rev='rev2'
  self.assertNotEqual(self.writer.mutate(self.decision(ticket),[CLIP])[0],200)
  self.assertEqual(self.legacy.current()['revision'],50)
 def test_restart_rejects_old_token(self):
  token=self.open();new=Tickets()
  with self.assertRaises(Rejected):new.begin(token,'sd',CLIP)
 def test_concurrent_compare_and_swap(self):
  a=self.open(CLIP);b=self.open(SECOND)
  outcomes=[]
  def job(ticket,name):outcomes.append(self.writer.mutate(self.decision(ticket,name),[CLIP,SECOND])[0])
  t1=threading.Thread(target=job,args=(a,CLIP));t2=threading.Thread(target=job,args=(b,SECOND))
  t1.start();t2.start();t1.join();t2.join()
  self.assertEqual(sorted(outcomes),[200,409])
  self.assertEqual(self.legacy.current()['revision'],51)
 def test_slow_verification_later_timestamp(self):
  self.attestor.slow=2.1
  ticket=self.open()
  status,_=self.writer.mutate(self.decision(ticket),[CLIP])
  self.assertEqual(status,200)
 def test_loaded_metadata_before_completed_delivery_does_not_mint_ticket(self):
  nonce=self.sessions.begin_original('sd',CLIP,'original:sd:one')
  with self.assertRaises(DeliveryPending):
   self.sessions.confirm_player_loaded(nonce,'sd',CLIP,nonce)
  self.assertEqual(len(self.tokens.tokens),0)
  self.assertEqual(self.legacy.current()['revision'],50)
  self.assertFalse(self.legacy.AUDIT.exists())
  revision=self.sessions.require_current_stream(nonce,'sd',CLIP)
  self.sessions.report_delivery(nonce,'sd',CLIP,dict(status=206,
    transferred_bytes=128,response_original_sha256=revision['original_sha256'],
    source_revision=revision['source_revision'],source_identity=revision['source_identity']))
  ticket=self.sessions.confirm_player_loaded(nonce,'sd',CLIP,nonce)['review_ticket']
  self.assertIsInstance(ticket,str)
  self.assertEqual(self.legacy.current()['revision'],50)
 def test_failed_binding_and_report_never_call_atomic_not_even_temporarily(self):
  writes=[]
  def forbidden_atomic(*args,**kwargs):
   writes.append('atomic_called');raise AssertionError('intermediate_registry_write')
  self.legacy.atomic=forbidden_atomic
  report=self.writer.report()
  self.assertEqual(report['revision'],50)
  ticket=self.open()
  self.attestor.rev='rev2'
  self.assertNotEqual(self.writer.mutate(self.decision(ticket),[CLIP])[0],200)
  self.assertEqual(writes,[])
  self.assertFalse(self.legacy.AUDIT.exists())
  self.assertEqual(self.legacy.current()['revision'],50)
 def test_canonical_consumer_only_accepts_exact_revision_and_digest(self):
  token=self.open()
  status,result=self.writer.mutate(self.decision(token),[CLIP])
  self.assertEqual(status,200)
  bound=self.legacy.current()['items']['sd:'+CLIP]['media_binding']
  status,snapshot=self.writer.consume('sd',CLIP,51,bound['source_revision'],bound['sha256'])
  self.assertEqual(status,200)
  self.assertEqual(snapshot['registry_revision'],51)
  self.assertTrue(snapshot['source_must_be_revalidated_at_use'])
  self.assertEqual(self.writer.consume('sd',CLIP,50,bound['source_revision'],bound['sha256'])[0],409)
  self.assertEqual(self.writer.consume('sd',CLIP,51,bound['source_revision'],'b'*64)[0],409)
  self.attestor.rev='rev2'
  self.assertEqual(self.writer.consume('sd',CLIP,51,bound['source_revision'],bound['sha256'])[0],409)
 def test_canonical_consumer_revalidates_replacement_between_checks(self):
  ticket=self.open()
  self.assertEqual(self.writer.mutate(self.decision(ticket),[CLIP])[0],200)
  binding=self.legacy.current()['items']['sd:'+CLIP]['media_binding']
  old=self.attestor.current_revision
  count=[0]
  def flip_between_checks(source,name):
   count[0]+=1
   if count[0]>=2:return dict(source_identity='original:sd:one',source_revision='rev2')
   return old(source,name)
  self.attestor.current_revision=flip_between_checks
  status,result=self.writer.consume('sd',CLIP,51,binding['source_revision'],binding['sha256'])
  self.assertEqual(status,409)
  self.assertEqual(result['error'],'consumer_original_not_current')
  self.assertEqual(self.legacy.current()['revision'],51)
 def test_canonical_consumer_never_promotes_historical_or_writes(self):
  writes=[]
  def forbidden_atomic(*args,**kwargs):
   writes.append(1);raise AssertionError('intermediate registry write during consumption')
  self.legacy.atomic=forbidden_atomic
  before=self.legacy.current()
  code,_=self.writer.consume('sd','historical-0',50,'rev1','a'*64)
  self.assertEqual(code,409)
  self.assertEqual(writes,[])
  self.assertFalse(self.legacy.AUDIT.exists())
  self.assertEqual(self.legacy.current(),before)
 def test_registered_private_consumer_get_pins_query_and_revision(self):
  import urllib.parse
  token=self.open()
  self.assertEqual(self.writer.mutate(self.decision(token),[CLIP])[0],200)
  binding=self.legacy.current()['items']['sd:'+CLIP]['media_binding']
  class H:
   command='GET'
   def go(self):raise AssertionError('wrong route')
   def do_POST(self):raise AssertionError('no writes through GET')
   def js(self,status,payload):return status,payload
  from s9_forward_manual_writer_v1 import install
  future=install(H,self.legacy,lambda:[CLIP],self.attestor,binder,self.tokens)
  h=H()
  q=urllib.parse.urlencode(dict(source='sd',name=CLIP,revision=51,
      source_revision=binding['source_revision'],sha256=binding['sha256']))
  h.path=self.legacy.ROUTE+'/consumption?'+q
  status,body=h.go()
  self.assertEqual(status,200)
  self.assertTrue(body['source_must_be_revalidated_at_use'])
  h.path+='&unexpected=value'
  self.assertEqual(h.go()[0],400)
  h.command='HEAD';h.path=self.legacy.ROUTE+'/consumption?'+q
  self.assertEqual(h.go()[0],405)
  self.assertEqual(self.legacy.current()['revision'],51)
 def test_post_fsync_token_prune_cannot_mask_durable_commit(self):
  ticket=self.open()
  original_ack=self.tokens.consumed
  def emulate_concurrent_expiry(token,*,durable_commit=False):
   with self.tokens.lock:self.tokens.tokens.pop(token,None)
   return original_ack(token,durable_commit=durable_commit)
  self.tokens.consumed=emulate_concurrent_expiry
  status,outcome=self.writer.mutate(self.decision(ticket),[CLIP])
  self.assertEqual(status,200)
  self.assertTrue(outcome['persisted'])
  self.assertEqual(self.legacy.current()['revision'],51)
  self.assertEqual(len(self.legacy.AUDIT.read_text().splitlines()),1)
  with self.assertRaises(Rejected):self.tokens.begin(ticket,'sd',CLIP)
 def test_ticket_post_commit_ack_requires_internal_durable_gate(self):
  ticket=self.open()
  with self.assertRaises(Rejected):self.tokens.consumed(ticket)
  self.assertIn(ticket,self.tokens.tokens)
 def test_cancel_unloaded_original_revokes_session_before_ticket(self):
  nonce=self.sessions.begin_original('sd',CLIP,'original:sd:one')
  result=self.sessions.discard(nonce,'sd',CLIP)
  self.assertTrue(result['canonical_registry_untouched'])
  self.assertEqual(self.tokens.tokens,{})
  with self.assertRaises(Refused):
   self.sessions.require_current_stream(nonce,'sd',CLIP)
  self.assertEqual(self.legacy.current()['revision'],50)
  self.assertFalse(self.legacy.AUDIT.exists())
 def test_cancel_post_loaded_revokes_unreserved_ticket(self):
  nonce=self.sessions.begin_original('sd',CLIP,'original:sd:one')
  revision=self.sessions.require_current_stream(nonce,'sd',CLIP)
  self.sessions.report_delivery(nonce,'sd',CLIP,dict(status=206,
     transferred_bytes=128,response_original_sha256=revision['original_sha256'],
     source_revision=revision['source_revision'],source_identity=revision['source_identity']))
  token=self.sessions.confirm_player_loaded(nonce,'sd',CLIP,nonce)['review_ticket']
  self.assertIn(token,self.tokens.tokens)
  self.assertTrue(self.sessions.discard(nonce,'sd',CLIP)['original_review_cancelled'])
  self.assertNotIn(token,self.tokens.tokens)
  self.assertNotEqual(self.writer.mutate(self.decision(token),[CLIP])[0],200)
  self.assertEqual(self.legacy.current()['revision'],50)
 def test_cancel_cannot_interrupt_reserved_commit(self):
  nonce=self.sessions.begin_original('sd',CLIP,'original:sd:one')
  rev=self.sessions.require_current_stream(nonce,'sd',CLIP)
  self.sessions.report_delivery(nonce,'sd',CLIP,dict(status=206,
     transferred_bytes=128,response_original_sha256=rev['original_sha256'],
     source_revision=rev['source_revision'],source_identity=rev['source_identity']))
  ticket=self.sessions.confirm_player_loaded(nonce,'sd',CLIP,nonce)['review_ticket']
  self.tokens.begin(ticket,'sd',CLIP)
  with self.assertRaises(Refused):self.sessions.discard(nonce,'sd',CLIP)
  self.assertIn(ticket,self.tokens.tokens)
  self.assertEqual(self.legacy.current()['revision'],50)
 def test_report_historical_truth(self):
  report=self.writer.report()
  self.assertEqual(report['binding_counts']['historically_unbound'],48)
  self.assertEqual(report['binding_counts']['bound'],0)
  self.assertEqual(report['revision'],50)
  self.assertIs(report['historical_re_review_supported'],False)
if __name__=='__main__':unittest.main()
