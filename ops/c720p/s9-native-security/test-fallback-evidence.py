#!/usr/bin/env python3
"""No-network regression tests for S9 preview-only catalog/proxy/HTML."""
import hashlib, importlib.util, io, json, pathlib, tempfile, unittest
from unittest.mock import patch as mockpatch

BASE=pathlib.Path(__file__).resolve().parents[1]
def load(filename):
    path=BASE / filename
    spec=importlib.util.spec_from_file_location(filename.replace("/","_").replace(".","_"),path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class Tests(unittest.TestCase):
    def test_gallery_idempotent_and_strict(self):
        ui=load("s9-native-security/patch-fallback-preview-ui.py")
        original='<html><script id="c720p-s9-phone-clips-ui-v1"></script></body></html>'
        patched=ui.patch_text(original)
        self.assertIn('s9-fallback-section',patched)
        self.assertIn('Still JPEG · not person-identified',patched)
        self.assertIn("C720PSecureRelay",patched)
        self.assertEqual(ui.patch_text(patched),patched)
        with self.assertRaises(ValueError):ui.patch_text('<html></body></html>')
    def test_authorized_preview_route_and_clip_separation(self):
        proxy=load("s9-person-ml-v1/s9_sd_proxy_extension.py")
        with tempfile.TemporaryDirectory() as d:
            source=pathlib.Path(d)/"evidence.json"
            name="preview_motion_1791579999123.jpg"
            blob=b"\xff\xd8\xff"+b"x"*6500+b"\xff\xd9"
            item={"name":name,"kind":"preview_only_motion_evidence","sd_verified":True,
                  "sd_only":True,"person_status":"not_evaluated",
                  "size":len(blob),"sha256":hashlib.sha256(blob).hexdigest()}
            source.write_text(json.dumps({"previews":[item,dict(item,name="../secret.jpg")]}))
            with mockpatch.object(proxy,"PREVIEW_CAT",source):
                indexed=proxy.preview_rows()
                self.assertEqual(set(indexed),{name})
                class Handler:
                    def __init__(self,path):self.path=path;self.command="GET";self.headers={};self.output=io.BytesIO();self.wfile=self.output;self.code=None;self.body=None
                    def go(self):self.code=418
                    def js(self,status,body):self.code=status;self.body=body
                    def send_response(self,status):self.code=status
                    def send_header(self,*args):pass
                    def end_headers(self):pass
                proxy.install_local_sd(Handler)
                with mockpatch.object(proxy,"rows",return_value={}), mockpatch.object(proxy.subprocess,"run",return_value=type("R",(),{"stdout":blob})()):
                    api=Handler("/new/api/saved");api.go()
                    self.assertEqual(api.code,200)
                    self.assertEqual(api.body["events"],[])
                    self.assertEqual(len(api.body["fallback_previews"]),1)
                    still=Handler("/new/saved/still/"+name);still.go()
                    self.assertEqual(still.code,200)
                    self.assertEqual(still.output.getvalue(),blob)
                    not_video=Handler("/new/saved/clip/"+name);not_video.go()
                    self.assertEqual(not_video.code,418)
                    bad=Handler("/new/saved/still/../secret.jpg");bad.go()
                    self.assertEqual(bad.code,418)
                with mockpatch.object(proxy.subprocess,"run",return_value=type("R",(),{"stdout":blob+b"BAD"})()):
                    corrupt=Handler("/new/saved/still/"+name);corrupt.go()
                    self.assertEqual(corrupt.code,503)
    def test_catalog_is_sd_only(self):
        catalog=(BASE/"s9-person-ml-v1/local-sd-catalog.py").read_text()
        self.assertIn("PRIVATE_FALLBACK",catalog)
        self.assertIn('m.get("kind")!="preview_only_motion_evidence"',catalog)
        self.assertIn('m.get("person_identity")!="not_evaluated"',catalog)
        self.assertNotIn('Google Drive',catalog.split("PRIVATE_FALLBACK=",1)[1].split("def adb",1)[0])
if __name__=="__main__":unittest.main()
