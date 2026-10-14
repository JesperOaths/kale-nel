"""Isolated relay route tests: no real secrets, connections, recordings or writes."""
import ast,io,json,re,unittest,urllib.parse,urllib.request,urllib.error
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from unittest.mock import patch

tree=ast.parse(Path(__file__).with_name('c720p-lan-camera-relay-v32.py').read_text())
node=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='H')
scope={'BaseHTTPRequestHandler':BaseHTTPRequestHandler,'urllib':urllib,'json':json,'re':re}
exec(compile(ast.Module(body=[node],type_ignores=[]),'relay-test','exec'),scope)
H=scope['H']

class Reply(io.BytesIO):
 status=200
 headers={'Content-Type':'application/json'}
 def __init__(self):super().__init__(b'{"ok":true}')

class RelayTests(unittest.TestCase):
 def handler(self,path,headers=None,body=b'{}'):
  h=object.__new__(H);h.path=path;h.headers=headers or {};h.rfile=io.BytesIO(body);h.wfile=io.BytesIO();h.codes=[]
  h.authorized=lambda:True;h.origin_ok=lambda:h.headers.get('Origin')=='http://192.168.178.141:8123'
  h.send_response=h.codes.append;h.send_header=lambda *a:None;h.end_headers=lambda:None;h.cors=lambda:None;h.empty=h.codes.append
  return h
 def headers(self):return {'Origin':'http://192.168.178.141:8123','Content-Type':'application/json','Content-Length':'2','X-S9-Archive-Review-Intent':'human-recording-review-v32'}
 def test_review_get_preserves_only_allowed_source(self):
  for source in ('sd','drive'):
   h=self.handler('/new/api/archive-review?source='+source+'&auth=private&url=evil')
   with patch.object(urllib.request,'urlopen',return_value=Reply()) as call:h.go()
   self.assertEqual(call.call_args.args[0].full_url,'http://127.0.0.1:8795/new/api/archive-review?source='+source)
 def test_bad_or_duplicate_source_never_reaches_upstream(self):
  for query in ('source=evil','source=sd&source=drive'):
   h=self.handler('/new/api/archive-review?'+query)
   with patch.object(urllib.request,'urlopen') as call:h.go()
   self.assertEqual(h.codes,[400]);call.assert_not_called()
 def test_review_post_fixed_upstream_and_headers(self):
  h=self.handler('/new/api/archive-review/batch?url=evil',self.headers())
  with patch.object(urllib.request,'urlopen',return_value=Reply()) as call:h.do_POST()
  request=call.call_args.args[0];self.assertEqual(request.full_url,'http://127.0.0.1:8795/new/api/archive-review/batch');self.assertEqual(request.data,b'{}');self.assertEqual(request.get_header('X-s9-archive-review-intent'),'human-recording-review-v32');self.assertEqual(h.codes,[200])
 def test_auth_origin_intent_and_body_guards(self):
  variants=[({},403),({**self.headers(),'Origin':'http://evil.test'},403),({**self.headers(),'Content-Length':'18001'},400),({**self.headers(),'Content-Type':'text/plain'},400)]
  for headers,code in variants:
   h=self.handler('/new/api/archive-review/batch',headers)
   with patch.object(urllib.request,'urlopen') as call:h.do_POST()
   self.assertEqual(h.codes,[code]);call.assert_not_called()
  h=self.handler('/new/api/archive-review/batch',self.headers());h.authorized=lambda:False
  with patch.object(urllib.request,'urlopen') as call:h.do_POST()
  self.assertEqual(h.codes,[401]);call.assert_not_called()
 def test_delete_requires_explicit_intent_for_both_sources(self):
  for path in ('/new/api/sd/delete','/new/api/saved/delete'):
   h=self.handler(path,self.headers())
   with patch.object(urllib.request,'urlopen') as call:h.do_POST()
   self.assertEqual(h.codes,[403]);call.assert_not_called()

if __name__=='__main__':unittest.main()
