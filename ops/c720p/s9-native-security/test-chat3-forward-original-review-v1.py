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
 def test_report_historical_truth(self):
  report=self.writer.report()
  self.assertEqual(report['binding_counts']['historically_unbound'],48)
  self.assertEqual(report['binding_counts']['bound'],0)
  self.assertEqual(report['revision'],50)
if __name__=='__main__':unittest.main()
