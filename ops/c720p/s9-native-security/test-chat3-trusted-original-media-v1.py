"""No media I/O: isolated byte-range delegate tests."""
import io,pathlib,sys,unittest,hashlib,importlib.util,subprocess,shutil
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'s9-person-ml-v1'))
import s9_trusted_original_media_bridge_v1 as bridge

class Response:
    status=206
    def __init__(self,raw,headers):self.raw=io.BytesIO(raw);self.headers=headers
    def __enter__(self):return self
    def __exit__(self,*a):return False
    def read(self,n):return self.raw.read(n)
class Handler:
    def __init__(self,value):self.headers={'Range':value};self.wfile=io.BytesIO();self.reply=None;self.fields={}
    def send_response(self,code):self.reply=code
    def send_header(self,key,value):self.fields[key]=value
    def end_headers(self):pass
class Tests(unittest.TestCase):
    def test_signed_relay_patch_routes_open_and_loaded_with_pinned_source(self):
        # A synthetic relay template: tests pure source transformation only,
        # never starts 8794, opens a media file or performs physical acceptance.
        script=pathlib.Path(__file__).with_name('chat3-signed-review-relay-patch-v1.py')
        spec=importlib.util.spec_from_file_location('chat3_signed_relay_patch',script)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        template="""import re,json,urllib.parse,urllib.request,urllib.error
class H:
 def authorized(self):return True
 def origin_ok(self):return True
 def empty(self,n):return n
 def do_POST(self):
  path=urllib.parse.urlsplit(self.path).path
  if not self.authorized():return self.empty(401)
  if path=='/new/api/verified-people/review':return self.empty(418)
  if path=='/new/api/s9-manual-recording-links':
   obj={}
   if True:
    if not isinstance(obj,dict) or (set(obj)!={'action','source','name','folder','revision','human_confirmed'} and not (obj.get('action')=='assign_many' and set(obj)=={'action','source','name','folder','folders','revision','human_confirmed'})):return self.empty(400)
 def go(self,head=False):
  path=urllib.parse.urlsplit(self.path).path
  if not self.authorized():return self.empty(401)
  # S9_MANUAL_LINKS_LAN_ROUTE_V2 read-only, guarded after authorized()
 def archive(self,cam,subpath,head=False):
  q=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
  try:r=urllib.request.urlopen(req,timeout=8)
  except Exception:return self.empty(502)
  if subpath=='/api/anonymous-quality-consumption':
   return self.empty(400)
 def cors(self):
  self.send_header('Access-Control-Allow-Headers','X-S9-Automatic-Person-Intent')
"""
        # The real C720P installed Git blob has been independently checked
        # against BASE_BLOB. Synthetic fixture substitutes its own known blob.
        raw=template.encode()
        blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
        with patch.object(module,'BASE_BLOB',blob):
            updated=module.patch(template)
            self.assertEqual(module.patch(updated),updated)
            self.assertIn("path=='/new/api/review-original-open'",updated)
            self.assertIn("path=='/new/api/review-original-loaded'",updated)
            self.assertNotIn("path.endswith('/open')",updated)
            self.assertNotIn("path.endswith('/loaded')",updated)
            self.assertIn('self.send_response(reply.status)',updated)
            self.assertIn("timeout=24 if subpath.startswith('/review-original/') else 8",updated)
            self.assertIn("status",updated)
            self.assertLess(updated.index('if not self.authorized()'),updated.index("if path in ('/new/api/review-original-open'"))
            with self.assertRaisesRegex(ValueError,'installed_relay_blob_changed'):
                module.patch(template+'\\n# unauthorized newer source')
    def test_signed_relay_synthetic_authorization_and_http_status(self):
        # No network or physical browser: exercise emitted handler using the
        # deterministic patch fixture established by the source test above.
        import json,urllib.request
        script=pathlib.Path(__file__).with_name('chat3-signed-review-relay-patch-v1.py')
        spec=importlib.util.spec_from_file_location('chat3_signed_relay_patch',script)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        template="""import re,json,urllib.parse,urllib.request,urllib.error
class H:
 def authorized(self):return True
 def origin_ok(self):return True
 def empty(self,n):return n
 def do_POST(self):
  path=urllib.parse.urlsplit(self.path).path
  if not self.authorized():return self.empty(401)
  if path=='/new/api/verified-people/review':return self.empty(418)
  if path=='/new/api/s9-manual-recording-links':
   obj={}
   if True:
    if not isinstance(obj,dict) or (set(obj)!={'action','source','name','folder','revision','human_confirmed'} and not (obj.get('action')=='assign_many' and set(obj)=={'action','source','name','folder','folders','revision','human_confirmed'})):return self.empty(400)
 def go(self,head=False):
  path=urllib.parse.urlsplit(self.path).path
  if not self.authorized():return self.empty(401)
  # S9_MANUAL_LINKS_LAN_ROUTE_V2 read-only, guarded after authorized()
 def archive(self,cam,subpath,head=False):
  q=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
  try:r=urllib.request.urlopen(req,timeout=8)
  except Exception:return self.empty(502)
  if subpath=='/api/anonymous-quality-consumption':
   return self.empty(400)
 def cors(self):
  self.send_header('Access-Control-Allow-Headers','X-S9-Automatic-Person-Intent')
"""
        raw=template.encode()
        blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
        with patch.object(module,'BASE_BLOB',blob):
            src=module.patch(template)
        scope={}
        exec(compile(src,'<isolated-signed-relay-fixture>','exec'),scope)
        H=scope['H']
        class Upstream:
            def __init__(self,status):self.status=status
            def __enter__(self):return self
            def __exit__(self,*a):return False
            def read(self,n):return b'{"ok":true}'
        calls=[]
        def run(path,payload,*,signed=True,authorized=True,upstream_status=200):
            h=H();h.path=path;h.authorized=lambda:authorized
            data=json.dumps(payload).encode()
            h.headers={'Content-Type':'application/json','Content-Length':str(len(data)),
                       'X-S9-Original-Review-Intent':'explicit-original-open-v1' if signed else ''}
            h.rfile=io.BytesIO(data);h.wfile=io.BytesIO();h.reply=None
            h.send_response=lambda code:setattr(h,'reply',code)
            h.send_header=lambda *args:None;h.end_headers=lambda:None
            def fake(req,timeout):
                calls.append((req.full_url,timeout,json.loads(req.data)))
                return Upstream(upstream_status)
            with patch.object(urllib.request,'urlopen',fake):
                direct=h.do_POST()
            return direct if direct is not None else h.reply
        original={'source':'sd','name':'motion_1000000000000.mp4'}
        self.assertEqual(run('/new/api/review-original-open',original,authorized=False),401)
        self.assertEqual(run('/new/api/review-original-open',original,signed=False),403)
        self.assertEqual(calls,[])
        self.assertEqual(run('/new/api/review-original-open',original),200)
        self.assertEqual(calls[-1][1],170)
        self.assertEqual(calls[-1][2],original)
        loaded=dict(original,open_nonce='x'*32,observed_open_nonce='x'*32)
        self.assertEqual(run('/new/api/review-original-loaded',loaded,upstream_status=425),425)
        self.assertEqual(calls[-1][1],12)
        self.assertEqual(run('/new/api/review-original-loaded',loaded,upstream_status=409),409)
        self.assertEqual(run('/new/api/review-original-loaded',original),400)
    @unittest.skipUnless(shutil.which('node'),'Node required for original player contract smoke')
    def test_real_browser_client_mocked_signed_range_receipt_and_cancel(self):
        # Actual checked-in browser source runs in Node's VM with an inert video
        # stub. Never contacts 8794/8795 and never touches canonical state.
        browser=pathlib.Path(__file__).with_name('s9_review_original_browser_v1.js')
        script=r"""
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(process.argv[1],'utf8');
class Video {
 constructor(){this.src='';this.currentSrc='';this.readyState=0;this.videoWidth=640;this.videoHeight=480;this.listeners=new Map()}
 addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn)}
 removeEventListener(type,fn){this.listeners.get(type)?.delete(fn)}
 emit(type){for(const fn of [...(this.listeners.get(type)||[])])fn()}
 pause(){}
 removeAttribute(k){if(k==='src')this.src=''}
 load(){this.currentSrc=this.src;this.readyState=this.src?2:0;
   if(this.src)setTimeout(()=>this.emit('loadedmetadata'),0);
   else this.emit('emptied')
 }
}
const sleep=n=>new Promise(resolve=>setTimeout(resolve,n));
function build(handler,now=Date){
 const window={};
 vm.runInNewContext(source,{window,setTimeout,clearTimeout,Date:now,Error,Promise});
 const video=new Video();
 const relay={url:async path=>'http://signed.invalid'+path,
   fetch:async(path,opts)=>{
     const request=JSON.parse(opts.body);
     const [status,data]=await handler(path,request);
     return {ok:status>=200&&status<300,status,json:async()=>data};
   }};
 return {client:window.C720POriginalReviewClient.build(relay,video),video};
}
const CLIP='motion_1000000000000.mp4', NONCE='n'.repeat(32), TICKET='t'.repeat(32);
const open={ok:true,source:'sd',name:CLIP,open_nonce:NONCE,
 playback_path:'/new/review-original/sd/'+CLIP+'?open='+NONCE};
function loaded(){return {ok:true,source:'sd',name:CLIP,review_ticket:TICKET}}
(async()=>{
 let opens=0,loads=0,cancels=0;
 const happy=build(async(path,p)=>{
   if(path.endsWith('-open')){opens++;return [200,open]}
   if(path.endsWith('-cancel')){cancels++;assert.equal(p.open_nonce,NONCE);return [200,{ok:true}]}
   if(path.endsWith('-loaded')){loads++;return loads<=2?
     [425,{ok:false,error:'original_delivery_pending'}]:[200,loaded()]}
   throw Error('bad route '+path)
 });
 await happy.client.open('sd',CLIP);
 assert.equal(opens,1,'retry must never repeat original-open');
 assert.equal(loads,3,'only pending 425 is retried');
 assert.equal(happy.client.receipt('sd',CLIP),TICKET);
 happy.client.reset();await sleep(0);
 assert.equal(cancels,1,'closing cancels opened ticket');
 assert.equal(happy.client.receipt('sd',CLIP),null);

 let staleLoads=0,staleCancel=0;
 const stale=build(async(path)=>{
   if(path.endsWith('-open'))return [200,open];
   if(path.endsWith('-loaded')){staleLoads++;return [409,{ok:false,error:'source_revision_changed'}]}
   if(path.endsWith('-cancel')){staleCancel++;return [200,{ok:true}]}
   throw Error('bad stale route')
 });
 await assert.rejects(stale.client.open('sd',CLIP));
 assert.equal(staleLoads,1,'409 is terminal: no retry');
 assert.equal(staleCancel,1,'stale session cleaned up');
 assert.equal(stale.client.receipt('sd',CLIP),null);

 let deniedRequests=0;
 const unauthorized=build(async(path)=>{
  deniedRequests++;assert(path.endsWith('-open'));
  return [401,{ok:false,error:'unauthorized'}]
 });
 await assert.rejects(unauthorized.client.open('sd',CLIP));
 assert.equal(deniedRequests,1);
 assert.equal(unauthorized.client.receipt('sd',CLIP),null);

 let supersedeOpen=0,supersedeLoad=0,supersedeCancel=0;
 const interrupted=build(async(path)=>{
   if(path.endsWith('-open')){supersedeOpen++;return [200,open]}
   if(path.endsWith('-loaded')){supersedeLoad++;return [425,{ok:false,error:'pending'}]}
   if(path.endsWith('-cancel')){supersedeCancel++;return [200,{ok:true}]}
   throw Error('unrecognized route')
 });
 const opening=interrupted.client.open('sd',CLIP);
 await sleep(25);interrupted.client.reset();
 await opening;
 assert.equal(supersedeOpen,1);
 assert.equal(supersedeLoad,1,'cancel must stop pending retries');
 assert.equal(supersedeCancel,1);
 assert.equal(interrupted.client.receipt('sd',CLIP),null);

 let t=0,expiredOpen=0,expiredLoads=0,expiredCancel=0;
 const fakeDate={now:()=>t};
 const expired=build(async(path)=>{
   if(path.endsWith('-open')){expiredOpen++;return [200,open]}
   if(path.endsWith('-loaded')){expiredLoads++;t=27000;return [425,{ok:false,error:'pending'}]}
   if(path.endsWith('-cancel')){expiredCancel++;return [200,{ok:true}]}
   throw Error('unexpected route')
 },fakeDate);
 await assert.rejects(expired.client.open('sd',CLIP));
 assert.equal(expiredOpen,1);
 assert.equal(expiredLoads,1,'deadline must stop all retry loops');
 assert.equal(expiredCancel,1);
 console.log('browser-original-contract: 425 retry,401/409 terminal,cancel,deadline PASS')
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
"""
        result=subprocess.run(['node','-e',script,str(browser)],capture_output=True,text=True,timeout=20)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
    def test_bounded_metadata_and_seek(self):
        self.assertEqual(bridge.requested_range('bytes=0-',15_000_000),(0,bridge.LIMIT-1))
        self.assertEqual(bridge.requested_range('bytes=900-1023',12000),(900,1023))
        self.assertEqual(bridge.requested_range('',12000),(0,11999))
    def test_bad_range_refuses(self):
        for header in ('bytes=0-1,3-4','bytes=12-10','bytes=-10','bytes=99999-'):
            with self.assertRaises(bridge.Unavailable):bridge.requested_range(header,12000)
    def test_delivered_exact_bytes_only(self):
        h=Handler('bytes=0-99');pins=dict(size_bytes=12000,source_identity='s',source_revision='r',original_sha256='a'*64)
        callbacks=[]
        def fake(req,timeout):
            self.assertEqual(timeout,20)
            return Response(b'0'*100,{'Content-Range':'bytes 0-99/12000','Content-Length':'100','Content-Type':'video/mp4'})
        with patch.object(bridge,'urlopen',fake):
            bridge.serve_pinned_original(h,'sd','motion_1000000000000.mp4','nonce',pins,callbacks.append)
        self.assertEqual(h.reply,206);self.assertEqual(len(h.wfile.getvalue()),100)
        self.assertEqual(callbacks[0]['transferred_bytes'],100)
    def test_incomplete_response_no_receipt(self):
        h=Handler('bytes=0-99');pins=dict(size_bytes=12000,source_identity='s',source_revision='r',original_sha256='a'*64)
        callbacks=[]
        def fake(req,timeout):
            return Response(b'0'*50,{'Content-Range':'bytes 0-99/12000','Content-Length':'100','Content-Type':'video/mp4'})
        with patch.object(bridge,'urlopen',fake):
            with self.assertRaises(bridge.Unavailable):
                bridge.serve_pinned_original(h,'sd','motion_1000000000000.mp4','nonce',pins,callbacks.append)
        self.assertEqual(callbacks,[])
    def test_wrong_origin_range_no_receipt(self):
        h=Handler('bytes=0-99');pins=dict(size_bytes=12000,source_identity='s',source_revision='r',original_sha256='a'*64)
        callbacks=[]
        def fake(req,timeout):
            return Response(b'0'*100,{'Content-Range':'bytes 0-99/13000','Content-Length':'100','Content-Type':'video/mp4'})
        with patch.object(bridge,'urlopen',fake):
            with self.assertRaises(bridge.Unavailable):
                bridge.serve_pinned_original(h,'sd','motion_1000000000000.mp4','nonce',pins,callbacks.append)
        self.assertEqual(callbacks,[])
if __name__=='__main__':unittest.main()
