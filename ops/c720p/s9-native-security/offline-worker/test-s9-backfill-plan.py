#!/usr/bin/env python3
"""Source-qualified preservation tests with synthetic archive metadata only."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import json
import unittest

MODULE=Path(__file__).with_name("plan-s9-dual-archive-backfill.py")
sp=importlib.util.spec_from_file_location("s9_plan",MODULE)
p=importlib.util.module_from_spec(sp)
sys.modules[sp.name]=p
sp.loader.exec_module(p)


class BackfillPlan(unittest.TestCase):
    def test_includes_unindexed_sd_and_drive_and_inspection_crops(self):
        a="motion_1792211111111.mp4"
        b="motion_1792222222222.mp4"
        s9=[
            {"clip_no":a,"snapshot_name":a.replace(".mp4",".thumb.jpg")},
        ]
        drive=[
            {"clip_no":"NEW_20251019112233.mp4","snapshot_name":"legacy.jpg"},
            {"clip_no":"S3_20251019112233.mp4","snapshot_name":"legacy2.jpg"},
        ]
        files={a,b,"motion_1792211111111__facecrop__221_0.jpg",a+".verified.json"}
        rows,stats=p.plan(s9,drive,files)
        self.assertEqual(stats["sd_raw_mp4"],2)
        self.assertEqual(stats["sd_catalog_clips"],1)
        self.assertEqual(stats["sd_raw_not_in_catalog"],1)
        self.assertEqual(stats["drive_catalog_clips"],2)
        self.assertEqual(stats["source_qualified_recordings"],4)
        self.assertTrue(any(x["crop_ref"]=="motion_1792211111111__facecrop__221_0.jpg"
                           and x["inspection_only"] for x in rows))
        self.assertTrue(all(x["visual_embedding"] is None
                            and x["structural_crop_embedding"] is None
                            and x["verified_same_person"] is False for x in rows))
        self.assertTrue(any(x["source"]=="gdrive_archive" for x in rows))
        self.assertEqual(len({x["key"] for x in rows}),len(rows))

    def test_auxiliary_mp4_are_not_independent_person_recordings(self):
        primary="motion_1792211111111.mp4"
        preroll=primary+".preroll.mp4"
        complete=primary+".complete.mp4"
        partial=primary+".complete.partial.mp4"
        diagnostic="diagnostic_preroll_1792211111111.mp4"
        drive="DVR_20251019.mp4"
        files={primary,preroll,complete,partial,diagnostic}
        rows,stats=p.plan([{"clip_no":primary}],
                          [{"clip_no":77,"remote_name":drive}],files)
        self.assertEqual(stats["sd_raw_mp4"],5)
        self.assertEqual(stats["sd_primary_recordings"],1)
        self.assertEqual(stats["sd_auxiliary_mp4"],4)
        self.assertEqual(stats["auxiliary_media_rows"],4)
        self.assertEqual(stats["source_qualified_recordings"],2)
        eligible=[x for x in rows if x["kind"]=="recording"]
        self.assertEqual({(x["source"],x["clip"]) for x in eligible},
                         {("s9_sd",primary),("gdrive_archive",drive)})
        extras=[x for x in rows if x["kind"]=="auxiliary_media"]
        self.assertEqual(len(extras),4)
        self.assertTrue(all(x["inspection_only"] and not x["model_ready"]
                            and x["embedding_status"]=="not_an_independent_recording"
                            and x["visual_embedding"] is None for x in extras))

    def test_same_filename_across_sources_stays_separate(self):
        clip="motion_1792211111111.mp4"
        rows,_=p.plan([{"clip_no":clip}],[{"clip_no":clip}],{clip})
        # The Drive source uses a broader valid filename rule.
        exact=[r for r in rows if r["clip"]==clip and r["kind"]=="recording"]
        self.assertEqual(len(exact),2)
        self.assertEqual({x["source"] for x in exact},{"s9_sd","gdrive_archive"})

    def test_reused_drive_numeric_ids_do_not_collapse_original_clips(self):
        clip1="ArchiveA_2024.mp4"
        clip2="ArchiveB_2024.mp4"
        rows,stats=p.plan([],
            [{"clip_no":12,"remote_name":clip1,"snapshot_name":"a.jpg"},
             {"clip_no":12,"remote_name":clip2,"snapshot_name":"b.jpg"}],
            set())
        recordings=[r for r in rows
                    if r["source"]=="gdrive_archive" and r["kind"]=="recording"]
        snaps=[r for r in rows
               if r["source"]=="gdrive_archive" and r["kind"]=="catalog_snapshot"]
        self.assertEqual(len(recordings),2)
        self.assertEqual(len(snaps),2)
        self.assertEqual(stats["source_qualified_recordings"],2)
        self.assertEqual({r["clip"] for r in recordings},{clip1,clip2})
        self.assertEqual(len({r["source_id"] for r in recordings}),2)
        self.assertEqual(len({r["key"] for r in recordings}),2)
        for row in recordings:
            snap=next(x for x in snaps if x["clip"]==row["clip"])
            self.assertEqual(snap["source_id"],row["source_id"])

    def test_untrusted_sources_rejected(self):
        for bad in ({"clip_no":"../evil.mp4"},
                    {"clip_no":"/tmp/something.mp4"},
                    {"clip_no":"foo\\evil.mp4"},
                    {"clip_no":""}):
            self.assertIsNone(p.safe_clip(bad,"gdrive_archive"))
        with self.assertRaises(ValueError):
            p.one_row("unknown","motion_1792211111111.mp4")
        with self.assertRaises(ValueError):
            p.one_row("s9_sd","../../motion_1792211111111.mp4")

    def test_private_plan_atomic_and_never_overwrites(self):
        rows,_=p.plan([],[],{"motion_1792211111111.mp4"})
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"plan.jsonl"
            digest=p.write_private(rows,path)
            self.assertEqual(len(digest),64)
            self.assertEqual(len(path.read_text().splitlines()),len(rows))
            with self.assertRaises(RuntimeError):p.write_private([],path)

if __name__=="__main__":
    unittest.main(verbosity=2)
