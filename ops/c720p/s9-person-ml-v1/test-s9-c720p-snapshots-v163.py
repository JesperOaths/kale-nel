#!/usr/bin/env python3
"""No-phone privacy, bounded-response and metadata provenance tests."""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
MOD=HERE/"s9_c720p_snapshots_v163.py"
spec=importlib.util.spec_from_file_location("snap_playback_v163",MOD)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
CLIP="motion_1792000010000.mp4"
JPG="motion_1792000010000.jpg"
FRAME=b"\xff\xd8\xff"+b"x"*1200+b"\xff\xd9"

def proofs():
    import hashlib
    mp4={"schema_version":m.MP4_SCHEMA,"records":{CLIP:{
        "sd_path":m.MP4_ROOT+"/"+CLIP,"bytes":12000,"sha256":"a"*64,
        "indexed":True}}}
    jpg={"schema_version":m.SCHEMA,"records":{JPG:{
        "clip":CLIP,"clip_sha256":"a"*64,"sd_path":m.S9_ROOT+"/"+JPG,
        "bytes":len(FRAME),"sha256":hashlib.sha256(FRAME).hexdigest()}}}
    return jpg,mp4

class H:
    def __init__(self,path,method="GET",headers=None):
        self.path=path
        self.command=method
        self.headers=headers or {}
        self.wfile=io.BytesIO()
        self.sent=[]
    def send_response(self,n):self.sent.append(n)
    def send_header(self,name,val):self.sent.append((name,val))
    def end_headers(self):pass
    def js(self,code,data):self.sent.append(code)
    def go(self):self.sent.append("previous")

class Tests(unittest.TestCase):
    def make_files(self,root):
        jpg,mp4=proofs()
        a=Path(root)/"j.json"
        b=Path(root)/"m.json"
        a.write_text(json.dumps(jpg));b.write_text(json.dumps(mp4))
        a.chmod(0o600);b.chmod(0o600)
        return a,b,jpg,mp4

    def test_rejects_wrong_clip_origin_and_untrusted_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            a,b,jpg,mp4=self.make_files(tmp)
            self.assertEqual(len(m.read_proof(a,b)),1)
            jpg["records"][JPG]["clip_sha256"]="b"*64
            a.write_text(json.dumps(jpg))
            with self.assertRaisesRegex(ValueError,"source_mp4_provenance_mismatch"):
                m.read_proof(a,b)
            a.chmod(0o644)
            with self.assertRaisesRegex(ValueError,"private_proof_untrusted"):
                m.read_proof(a,b)

    def test_one_snapshot_route_no_changes_to_other_archive_routes(self):
        with tempfile.TemporaryDirectory() as tmp:
            a,b,jpg,mp4=self.make_files(tmp)
            with patch.object(m,"REPORT",a),patch.object(m,"MP4_REPORT",b),patch.object(
                    m,"read_phone_jpeg",return_value=FRAME) as read:
                m.install(H)
                h=H("/new/saved/c720p-migrated/snap/"+JPG)
                h.go()
                self.assertEqual(h.wfile.getvalue(),FRAME)
                self.assertIn(200,h.sent)
                self.assertIn(("Content-Type","image/jpeg"),h.sent)
                self.assertIn(("Cache-Control","private,no-store"),h.sent)
                read.assert_called_once()
                out=H("/new/saved/c720p-migrated/clip/"+CLIP);out.go()
                self.assertEqual(out.sent,["previous"])
                head=H("/new/saved/c720p-migrated/snap/"+JPG,method="HEAD")
                head.go();self.assertIn(200,head.sent)
                self.assertEqual(head.wfile.getvalue(),b"")
                for route in ("/new/saved/c720p-migrated/snap/"+JPG+"?auth=1",
                              "/new/saved/c720p-migrated/snap/../"+JPG):
                    bad=H(route);bad.go();self.assertIn(400,bad.sent)
                bad=H("/new/saved/c720p-migrated/snap/"+JPG,
                      headers={"Range":"bytes=0-2"})
                bad.go();self.assertIn(400,bad.sent)

    def test_unverified_snapshot_cannot_be_fetched(self):
        with tempfile.TemporaryDirectory() as tmp:
            a,b,jpg,mp4=self.make_files(tmp)
            with patch.object(m,"REPORT",a),patch.object(m,"MP4_REPORT",b),patch.object(
                    m,"read_phone_jpeg") as phone:
                m.install(H)
                missing=H("/new/saved/c720p-migrated/snap/missing.jpg")
                missing.go();self.assertIn(404,missing.sent)
                phone.assert_not_called()

    def test_bounded_read_and_wrong_sha_rejection_without_phone(self):
        real_popen=subprocess.Popen
        def fake_popen(command,**kwargs):
            self.assertEqual(command[0:5],
                             ["adb","-s",m.SERIAL,"exec-out","cat"])
            return real_popen(["python3","-c",
              "import sys;sys.stdout.buffer.write(b'\\xff\\xd8\\xff'+b'x'*1200+b'\\xff\\xd9')"],
              stdout=kwargs["stdout"],stderr=kwargs["stderr"])
        import hashlib
        sha=hashlib.sha256(FRAME).hexdigest()
        with patch.object(m.subprocess,"Popen",side_effect=fake_popen):
            self.assertEqual(m.read_phone_jpeg(JPG,len(FRAME),sha),FRAME)
            with self.assertRaisesRegex(ValueError,"phone_snapshot_integrity_failure"):
                m.read_phone_jpeg(JPG,len(FRAME),"f"*64)
            with self.assertRaisesRegex(ValueError,"oversized_phone_snapshot"):
                m.read_phone_jpeg(JPG,len(FRAME)-1,sha)

    def test_snapshot_api_remains_readonly_and_bounded(self):
        body=MOD.read_text()
        for forbidden in ("pm install","os.remove(", "os.unlink(",
                          "shutil.rmtree","review_decide","auto_assign_person",
                          "open(REPORT,'w'","unlink("):
            self.assertNotIn(forbidden,body)
        self.assertIn("selectors.DefaultSelector",body)
        self.assertIn("expected+1-len(body)",body)
        self.assertIn('self.send_header("Cache-Control","private,no-store")',body)
        self.assertIn("read_proof()",body)

if __name__=="__main__":
    unittest.main(verbosity=2)
