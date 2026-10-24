"""No media I/O: isolated byte-range delegate tests."""
import io,pathlib,sys,unittest,hashlib,importlib.util
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
