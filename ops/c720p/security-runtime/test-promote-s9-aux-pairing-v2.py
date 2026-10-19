#!/usr/bin/env python3
"""Synthetic contract tests: isolated S9 catalog worker promotion/rollback."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

here=Path(__file__).resolve().parent
source=here/"promote-s9-aux-pairing-v2.py"
spec=importlib.util.spec_from_file_location("aux_promotion",source)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Tests(unittest.TestCase):
    def setUp(self):
        holder=tempfile.TemporaryDirectory()
        self.addCleanup(holder.cleanup)
        self.root=Path(holder.name)
        old=b"print('previous adapter')\n"
        new=b"print('verified adapter')\n"
        old_catalog={"records":{"motion_1792000000000.mp4":{"version":"test"}}}
        old_summary={"recordings":1,"auxiliary_mp4_inventory":{}}
        self.old_catalog=json.dumps(old_catalog).encode()
        self.old_summary=json.dumps(old_summary).encode()
        fake={
         "BIN":self.root/"bin/s9_standalone_phone_catalog_v1.py",
         "DEX":self.root/"build/classes.dex",
         "DROPIN":self.root/"systemd/zz-auxiliary-pairing-v2.conf",
         "EXISTING_DROPIN":self.root/"systemd/auxiliary-inventory-v1.conf",
         "CATALOG":self.root/"state/catalog.json",
         "SUMMARY":self.root/"state/summary.json",
         "BACKUPS":self.root/"backups",
         "LOCK":self.root/"state/lock",
         "OLD_SCRIPT_BLOB":m.blob(old),"NEW_SCRIPT_BLOB":m.blob(new),
         "DEX_SHA256":hashlib.sha256(b"DEX-METADATA-ISOLATED").hexdigest(),
         "EXISTING_DROPIN_SHA256":hashlib.sha256(b"[Service]\n").hexdigest(),
        }
        self.restore={key:getattr(m,key) for key in fake}
        self.addCleanup(lambda:[setattr(m,k,v) for k,v in self.restore.items()])
        for k,v in fake.items():setattr(m,k,v)
        m.DROPIN_TEXT=b"[Service]\nExecStart= \nExecStart=/usr/bin/python3 /tmp/isolated.py --apply\n"
        self.addCleanup(lambda:setattr(m,"DROPIN_TEXT",self.drop_before))
        self.drop_before=self.restore_dropin_content()
        for p,data in ((m.BIN,old),(m.DEX,b"DEX-METADATA-ISOLATED"),
                       (m.EXISTING_DROPIN,b"[Service]\n"),
                       (m.CATALOG,self.old_catalog),(m.SUMMARY,self.old_summary)):
            p.parent.mkdir(parents=True,exist_ok=True)
            p.write_bytes(data)
        self.new=new
        self.camera={"ok":True,"mode":"watching","native_4k_enabled":True,
            "continuous_4k_ready":True,"continuous_4k_dropped_output_frames":0,
            "temperature_c":34.0}
        self.patches=[
            patch.object(m.urllib.request,"urlopen",return_value=io.BytesIO(new)),
            patch.object(m,"camera",return_value=self.camera),
            patch.object(m,"active",side_effect=lambda unit:unit==m.TIMER),
        ]
        for p in self.patches:
            p.start();self.addCleanup(p.stop)
        self.calls=[]
        self.install_side_effect=None
        def fake_system(*args,**kwargs):
            self.calls.append(args)
            if args==("start",m.SERVICE):
                if self.install_side_effect:self.install_side_effect()
                aux={"preroll_with_verified_primary":1,
                     "preroll_with_raw_unverified_primary":0,
                     "preroll_without_any_primary":2,"preroll_segments":3,
                     "completed_companion_with_verified_primary":0,
                     "completed_companion_with_raw_unverified_primary":0,
                     "completed_companion_without_any_primary":4,
                     "completed_companion_mp4_files":4,
                     "partial_companion_with_verified_primary":0,
                     "partial_companion_with_raw_unverified_primary":0,
                     "partial_companion_without_any_primary":1,
                     "partial_completion_mp4_files":1,
                     "no_media_quarantined_or_deleted":True,
                     "auxiliary_pairing_is_filename_presence_only_not_media_integrity":True}
                m.SUMMARY.write_text(json.dumps({"recordings":1,"auxiliary_mp4_inventory":aux}))
        p=patch.object(m,"system",side_effect=fake_system)
        p.start();self.addCleanup(p.stop)
    def restore_dropin_content(self):
        return m.DROPIN_TEXT
    def test_preflight_no_mutations(self):
        d=m.promote(False)
        self.assertEqual(d["action"],"preflight_only")
        self.assertFalse(m.DROPIN.exists())
        self.assertEqual(m.BIN.read_bytes(),b"print('previous adapter')\n")
        self.assertFalse(m.BACKUPS.exists())
        self.assertFalse(self.calls)
    def test_first_promotion_and_idempotent_again(self):
        d=m.promote(True)
        self.assertEqual(d["action"],"persistent_promotion_verified")
        self.assertEqual(d["unpaired_prerolls"],2)
        self.assertEqual(d["completed_without_original"],4)
        self.assertEqual(m.BIN.read_bytes(),self.new)
        self.assertEqual(m.DROPIN.read_bytes(),m.DROPIN_TEXT)
        self.assertIn(("start",m.TIMER),self.calls)
        backups=list(m.BACKUPS.glob("*/adapter-before.py"))
        self.assertEqual(len(backups),1)
        self.assertEqual(backups[0].read_bytes(),b"print('previous adapter')\n")
        self.assertEqual(m.promote(True)["action"],"already_active")
    def test_failed_oneshot_restores_files_and_metadata(self):
        self.install_side_effect=lambda: (_ for _ in ()).throw(RuntimeError("simulated catalog worker failure"))
        with self.assertRaisesRegex(RuntimeError,"simulated catalog"):
            m.promote(True)
        self.assertEqual(m.BIN.read_bytes(),b"print('previous adapter')\n")
        self.assertEqual(m.SUMMARY.read_bytes(),self.old_summary)
        self.assertEqual(m.CATALOG.read_bytes(),self.old_catalog)
        self.assertFalse(m.DROPIN.exists())
        self.assertIn(("start",m.TIMER),self.calls)
    def test_concurrent_adapter_rejected(self):
        m.BIN.write_bytes(b"surprise edit")
        with self.assertRaisesRegex(RuntimeError,"concurrent_adapter_change"):
            m.promote(True)
        self.assertFalse(m.DROPIN.exists())
    def test_worker_checksum_mismatch_rejected(self):
        m.DEX.write_bytes(b"changed DEX")
        with self.assertRaisesRegex(RuntimeError,"digest_mismatch"):
            m.promote(True)
        self.assertEqual(m.BIN.read_bytes(),b"print('previous adapter')\n")
    def test_source_and_preservation_contract(self):
        original=self.restore["OLD_SCRIPT_BLOB"]
        self.assertEqual(original,"2f2b20e47f058802286143639131b709d9a7e9ad")
        main=source.read_text()
        for required in ("camera_capture_health_gate","previous_catalog_service_busy",
                         "verified_original_missing_post_promote","S9_AUX_PAIRING_V2_ROLLED_BACK",
                         "no_media_quarantined_or_deleted","auxiliary_pairing_is_filename_presence_only_not_media_integrity"):
            self.assertIn(required,main)
if __name__=="__main__":
    unittest.main(verbosity=2)
