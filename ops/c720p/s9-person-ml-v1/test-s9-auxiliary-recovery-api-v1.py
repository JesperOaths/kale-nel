#!/usr/bin/env python3
"""Recovery artifacts are private, distinct from verified originals and reviews."""
import datetime as dt
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

FILE=Path(__file__).with_name("s9_auxiliary_recovery_api_v1.py")
MAIN=Path(__file__).with_name("s9_sd_proxy_extension.py")
spec=importlib.util.spec_from_file_location("aux_recovery",FILE)
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
P="motion_1792000010000.mp4.preroll.mp4"
C="motion_1792000013000.mp4.complete.mp4"
S="motion_1792000016000.mp4.complete.partial.mp4"

def report():
 return {"schema_version":"s9_auxiliary_structural_report_v1",
  "generated_at_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
  "video_decoded":False,"video_bytes_transferred_to_hub":False,
  "originals_modified":False,"manual_person_reviews_modified":False,
  "structural_packets_are_not_full_decode_proof":True,"total_unpaired":3,
  "rows":[
   {"name":P,"role":"preroll","status":"compressed_video_samples_read","bytes":1400000,
    "mime":"video/avc","width":640,"height":480,"duration_us":5100000},
   {"name":C,"role":"complete","status":"compressed_video_samples_read","bytes":6200000,
    "mime":"video/avc","width":1280,"height":720,"duration_us":16400000},
   {"name":S,"role":"partial","status":"size_outside_probe_limits","bytes":48}],
  "by_role":{"preroll":{"checked":1,"statuses":{"compressed_video_samples_read":1}},
   "complete":{"checked":1,"statuses":{"compressed_video_samples_read":1}},
   "partial":{"checked":1,"statuses":{"size_outside_probe_limits":1}}}}
class Handler:
 def __init__(self,method,path):
  self.command=method;self.path=path;self.wfile=io.BytesIO()
  self.headers={};self.calls=[];self.responses=[];self.headers_sent=[]
 def send_response(self,v):self.responses.append(v)
 def send_header(self,k,v):self.headers_sent.append((k,v))
 def end_headers(self):pass
 def js(self,status,data):self.calls.append((status,data))
 def go(self):self.calls.append(("original",None))
class Tests(unittest.TestCase):
 def setUp(self):
  td=tempfile.TemporaryDirectory()
  self.addCleanup(td.cleanup)
  self.tmp=Path(td.name)/"report.json"
  self.tmp.write_text(json.dumps(report()))
  self.tmp.chmod(0o600)
  self.old=api.REPORT;api.REPORT=self.tmp
  self.addCleanup(lambda:setattr(api,"REPORT",self.old))
 def test_only_two_structural_candidates_not_three_recordings(self):
  x=api.read_recovery()
  self.assertEqual((x["structural_candidates"],x["unpaired_auxiliary_files"]),(2,3))
  self.assertEqual(len(x["files"]),2)
  self.assertTrue(x["not_verified_original_recordings"])
  self.assertFalse(x["full_frame_decode_verified"])
 def test_tampered_count_or_name_is_not_served(self):
  for mutate in (
   lambda x:x.update(total_unpaired=4),
   lambda x:x["rows"][0].update(name="../../evil.mp4"),
   lambda x:x["rows"][0].update(status="human_approved"),
   lambda x:x["rows"][0].update(role="complete"),
   lambda x:x["rows"][0].update(duration_us=-1)
  ):
   x=report();mutate(x);self.tmp.write_text(json.dumps(x))
   with self.assertRaises((ValueError,TypeError)):api.read_recovery()
 def test_api_auth_bound_handler_and_no_store(self):
  h=Handler("GET","/new/api/s9-auxiliary-recovery")
  api.install(Handler,lambda *_:None)
  h.go()
  self.assertEqual(h.responses,[200])
  self.assertIn(("Cache-Control","private,no-store"),h.headers_sent)
  self.assertEqual(len(json.loads(h.wfile.getvalue())["files"]),2)
 def test_playback_whitelist_and_partial_denial(self):
  captured=[]
  api.install(Handler,lambda _,name,rec:captured.append((name,rec)))
  h=Handler("HEAD","/new/saved/recovery/clip/"+P)
  h.go()
  self.assertEqual(captured,[(P,{"size":1400000})])
  denied=Handler("GET","/new/saved/recovery/clip/"+S);denied.go()
  self.assertEqual(denied.calls[0][0],400)
 def test_unknown_file_not_exposed(self):
  api.install(Handler,lambda *_:self.fail("unexpected_video_access"))
  h=Handler("GET","/new/saved/recovery/clip/motion_1792000099000.mp4.complete.mp4")
  h.go()
  self.assertEqual(h.calls[0][0],404)
 def test_unrelated_routes_unchanged(self):
  api.install(Handler,lambda *_:None)
  h=Handler("GET","/new/api/saved");h.go()
  self.assertEqual(h.calls,[("original",None)])
 def test_outer_auth_only_existing_inner_loopback(self):
  source=MAIN.read_text()
  self.assertIn("s9_multivector_appearance_api.install(H)",source)
  self.assertIn("s9_auxiliary_recovery_api_v1.install(H,play_sd)",source)
  self.assertNotIn("HTTPServer(",FILE.read_text())
  self.assertNotIn("listen(",FILE.read_text())
  for token in (".unlink(", "subprocess.run(", "os.remove(", "shutil.rmtree("):
   self.assertNotIn(token,FILE.read_text())
if __name__=="__main__":unittest.main(verbosity=2)
