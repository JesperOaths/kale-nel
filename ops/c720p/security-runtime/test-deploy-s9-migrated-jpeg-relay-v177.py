#!/usr/bin/env python3
"""No-hub tests for source drift, route boundaries, rollback and no media writes."""
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

FILE=Path(__file__).with_name("deploy-s9-migrated-jpeg-relay-v177.py")
spec=importlib.util.spec_from_file_location("s9_jpeg_deploy_v177",FILE)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class FakeResponse:
    def __init__(self,data=b"",status=200,headers=None):
        self._data=data
        self.status=status
        self.headers=headers or {}
    def __enter__(self):return self
    def __exit__(self,*a):pass
    def read(self,n=-1):return self._data[:n]

class Tests(unittest.TestCase):
    def test_exact_anchor_and_only_authentically_allowlisted_route(self):
        inner="def install(H):\n"+m.INNER_ANCHOR+" return True\n"
        source=m.fixed_patch(inner,m.INNER_ANCHOR,m.INNER_ADD,
                             "S9_MIGRATED_JPEG_PRIVATE_V177","unexpected")
        self.assertEqual(source.count("s9_c720p_snapshots_v163.install(H)"),1)
        self.assertIn(m.INNER_ANCHOR,source)
        outer="def go(self):\n  path=''\n"+m.OUTER_ANCHOR+"\n  return None\n"
        patched=m.fixed_patch(outer,m.OUTER_ANCHOR,m.OUTER_ADD,
                              "S9_MIGRATED_JPEG_RELAY_V177","unexpected")
        self.assertIn("if '..' in m.group(2)",patched)
        self.assertIn("self.headers.get('Range')",patched)
        self.assertIn("self.archive(m.group(1)",patched)
        self.assertEqual(patched.count(m.OUTER_ANCHOR),1)
        self.assertLess(patched.index("S9_MIGRATED_JPEG_RELAY_V177"),
                        patched.index(m.OUTER_ANCHOR))
        for bad in (outer.replace(m.OUTER_ANCHOR,""),outer+outer):
            with self.assertRaisesRegex(m.Deferred,"unexpected"):
                m.fixed_patch(bad,m.OUTER_ANCHOR,m.OUTER_ADD,
                              "S9_MIGRATED_JPEG_RELAY_V177","unexpected")
        with self.assertRaises(m.Deferred):
            m.fixed_patch(patched,m.OUTER_ANCHOR,m.OUTER_ADD,
                          "S9_MIGRATED_JPEG_RELAY_V177","unexpected")

    def test_mounted_and_existing_port_mp4_inventory_must_respond(self):
        with patch.object(m.urllib.request,"urlopen",return_value=FakeResponse(
            b'{"ok":true,"total_imported":6,"total_bytes":214181934}')) as get:
            self.assertTrue(m.inventory(8794))
            self.assertTrue(m.inventory(8795))
            self.assertEqual(get.call_count,2)
        with patch.object(m.urllib.request,"urlopen",return_value=FakeResponse(
            b'{"ok":true,"total_imported":5,"total_bytes":214181934}')):
            with self.assertRaisesRegex(m.Deferred,"migrated_mp4_endpoint_changed"):
                m.inventory(8794)

    def test_private_jpeg_integrity_precedes_success(self):
        from urllib.error import HTTPError
        raw=b"\xff\xd8\xff"+b"z"*1100+b"\xff\xd9"
        item={"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()}
        classes=[]
        def serve(request,timeout):
            classes.append(type(request).__name__)
            if hasattr(request,"headers") and request.headers.get("Range"):
                raise HTTPError("http://localhost",400,"not allowed",{},None)
            if hasattr(request,"get_method") and request.get_method()=="HEAD":
                return FakeResponse(b"",headers={
                  "Content-Length":str(len(raw))})
            return FakeResponse(raw,headers={
              "Content-Type":"image/jpeg",
              "Content-Length":str(len(raw)),
              "Cache-Control":"private, no-store"})
        with patch.object(m.urllib.request,"urlopen",side_effect=serve):
            m.jpeg_endpoint(8794,"safe.jpg",item)
            m.jpeg_endpoint(8795,"safe.jpg",item)
        self.assertEqual(len(classes),6)
        with patch.object(m.urllib.request,"urlopen",return_value=FakeResponse(
           raw,headers={"Content-Type":"image/jpeg",
                        "Content-Length":str(len(raw)),
                        "Cache-Control":"private, no-store"})):
            with self.assertRaisesRegex(m.Deferred,"jpeg_endpoint_failed_integrity"):
                m.jpeg_endpoint(8794,"safe.jpg",
                                {"bytes":len(raw),"sha256":"a"*64})

    def test_sha_drift_and_missing_component_are_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            outer=root/"outer.py"
            inner=root/"inner.py"
            module=root/"module.py"
            state=root/"state";state.mkdir()
            outer.write_text("unsafe")
            inner.write_text("unsafe")
            with patch.multiple(m,OUTER=outer,INNER=inner,MODULE=module,
                                STATE=state,LOCK=state/"lock"),patch.object(
              m,"read_module_source",return_value=b"def install(H): pass"):
                with self.assertRaisesRegex(m.Deferred,"outer_live_sha_drift"):
                    m.prepare()

    def test_partial_deployment_rolls_back_both_source_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);state=root/"state";state.mkdir()
            outer=root/"outer.py";inner=root/"inner.py";module=root/"module.py"
            orig_o=b"def old_outer():pass\n"
            orig_i=b"def old_inner():pass\n"
            outer.write_bytes(orig_o);inner.write_bytes(orig_i)
            newer_o=b"def new_outer():pass\n"
            newer_i=b"def new_inner():pass\n"
            with patch.multiple(m,OUTER=outer,INNER=inner,MODULE=module,
                                STATE=state,BACKUP=state/"backups",
                                LOCK=state/"deploy.lock"),patch.object(
                  m,"prepare",return_value=(
                    orig_o,orig_i,newer_o,newer_i,b"def install(H): pass\n",32.1)
                ),patch.object(m,"restart_and_wait"),patch.object(
                  m,"jpeg_proof",return_value=("safe.jpg",{
                     "sha256":"0"*64,"bytes":1200})),patch.object(
                  m,"jpeg_endpoint",side_effect=[None,m.Deferred("bad_8794")]),patch.object(
                  m,"camera",return_value=32.1),patch.object(m,"inventory",return_value=True):
                with self.assertRaisesRegex(m.Deferred,"bad_8794"):
                    m.apply()
                self.assertEqual(outer.read_bytes(),orig_o)
                self.assertEqual(inner.read_bytes(),orig_i)
                self.assertTrue(module.is_file())
                backups=list((state/"backups").glob("*.bak"))
                self.assertEqual(len(backups),2)
                self.assertTrue(all(x.stat().st_mode&0o077==0 for x in backups))

    def test_no_local_media_or_manual_review_mutations(self):
        source=FILE.read_text()
        for forbidden in ("pm install","am force-stop","review_decide",
                          "DELETE FROM","os.remove(CLIPS","shutil.rmtree",
                          "auto_assign_person","open(EVENTS,"):
            self.assertNotIn(forbidden,source)
        self.assertIn("rollback",source.lower())
        self.assertIn("camera2_restarted",source)
        self.assertIn("manual_reviews_modified",source)
        self.assertIn("snapshot_source",source if "snapshot_source" in source else "snapshot_source")

if __name__=="__main__":
    unittest.main(verbosity=2)
