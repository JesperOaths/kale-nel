import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location("catalog_client",Path(__file__).with_name("phone_archive_catalog_v1.py"))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def record(index=0,version="a"):
    name=f"motion_{1792000000000+index}.mp4"
    return {"name":name,"bytes":200000,"version":version*64,"thumbnail":False,"thumbnail_version":"",
            "manifest":{"name":name,"bytes":200000,"sha256":"b"*64,"width":3840,"height":2160}}

def page(records,identity="1",mode="full",total=None,cursor=0,next_cursor=None,removed=None,count=None):
    return {"ok":True,"schema_version":m.VERSION,"snapshot_id":identity*64,"mode":mode,
            "records":records,"removed":removed or [],"errors":[],"read_only":True,
            "video_decode_performed":False,"total_records":len(records) if total is None else total,
            "change_count":len(records) if count is None else count,"cursor":cursor,"next_cursor":next_cursor}

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.cache=Path(self.tmp.name)/"cache.json"
    def load(self,pages):
        with patch.object(m,"_read",side_effect=pages):return m.load_catalog(self.cache)
    def test_full_paging_and_unchanged_does_not_rewrite_cache(self):
        a,b=record(),record(1)
        first=self.load([page([a],total=2,next_cursor=1,count=2),page([b],total=2,cursor=1,count=2)])
        self.assertEqual(len(first["records"]),2);before=self.cache.stat().st_mtime_ns
        second=self.load([page([],mode="unchanged",total=2,count=0)])
        self.assertEqual(first,second);self.assertEqual(before,self.cache.stat().st_mtime_ns)
    def test_delta_update_addition_and_tombstone(self):
        a,b=record(),record(1);self.load([page([a,b])]);a2=record(version="c");c=record(2)
        result=self.load([page([a2,c],identity="2",mode="delta",total=2,removed=[b["name"]])])
        self.assertEqual(set(result["records"]),{a["name"],c["name"]})
        self.assertEqual(result["records"][a["name"]]["version"],"c"*64)
    def test_mixed_generation_never_replaces_previous_cache(self):
        self.load([page([record()])]);prior=self.cache.read_bytes()
        with self.assertRaises(ValueError):self.load([page([record(1)],identity="2",total=2,next_cursor=1,count=2),page([record(2)],identity="3",total=2,cursor=1,count=2)])
        self.assertEqual(prior,self.cache.read_bytes())
    def test_duplicate_truncated_and_nonadvancing_pages_rejected(self):
        bad_sets=[[page([record(),record()])],[page([record()],total=2,count=2)],
                  [page([],total=2,next_cursor=0,count=2)]]
        for pages in bad_sets:
            with self.subTest(pages=pages),self.assertRaises(ValueError):self.load(pages)
        self.assertFalse(self.cache.exists())
    def test_invalid_source_fields_and_error_snapshots_rejected(self):
        for mutate in [lambda p:p.update(errors=["unreadable"]),lambda p:p.update(read_only=False),
                       lambda p:p["records"][0].update(name="../secret.mp4"),
                       lambda p:p["records"][0]["manifest"].update(bytes=300000),
                       lambda p:p["records"][0]["manifest"].update(width=640)]:
            data=page([record()]);mutate(data)
            with self.subTest(data=data),self.assertRaises(ValueError):self.load([data])
    def test_bad_delta_and_changed_base_are_not_accepted(self):
        self.load([page([record()])])
        for data in [page([],identity="2",mode="unchanged",total=1,count=0),
                     page([],identity="2",mode="delta",total=0,count=0,removed=[record(5)["name"]])]:
            with self.assertRaises(ValueError):self.load([data])
    def test_generation_conflict_retries_once_then_defers(self):
        result=self.load([BlockingIOError(),page([record()])]);self.assertEqual(len(result["records"]),1)
        with self.assertRaises(m.Unavailable):self.load([BlockingIOError(),BlockingIOError()])
    def test_failed_thumbnail_refresh_retries_and_keeps_previous(self):
        entry=record();entry.update(thumbnail=True,thumbnail_version="5000:1792000000000")
        path=Path(self.tmp.name)/"thumb.jpg"
        previous=b"\xff\xd8\xff"+b"p"*4995+b"\xff\xd9"
        path.write_bytes(previous)
        with patch.object(m,"read_asset",side_effect=m.Unavailable):
            available,version=m.cache_thumbnail(entry,path,"old")
        self.assertTrue(available);self.assertEqual(version,"old")
        self.assertEqual(path.read_bytes(),previous)
        raw=b"\xff\xd8\xff"+b"x"*4995+b"\xff\xd9"
        with patch.object(m,"read_asset",return_value=raw) as fetch:
            self.assertEqual(m.cache_thumbnail(entry,path,version),(True,entry["thumbnail_version"]))
            m.cache_thumbnail(entry,path,entry["thumbnail_version"])
            self.assertEqual(fetch.call_count,1)

    def test_corrupted_cached_thumbnail_refetched_even_for_unchanged_version(self):
        entry=record();entry.update(thumbnail=True,thumbnail_version="5000:1792000000000")
        path=Path(self.tmp.name)/"thumb.jpg"
        path.write_bytes(b"\xff\xd8\xff"+b"x"*4997)  # same length, missing JPEG terminator
        valid=b"\xff\xd8\xff"+b"y"*4995+b"\xff\xd9"
        with patch.object(m,"read_asset",return_value=valid) as fetch:
            self.assertEqual(m.cache_thumbnail(entry,path,entry["thumbnail_version"]),(True,entry["thumbnail_version"]))
            fetch.assert_called_once()
        self.assertEqual(path.read_bytes(),valid)
        self.assertTrue(m.valid_cached_thumbnail(path,entry["thumbnail_version"]))

    def test_invalid_cached_and_invalid_phone_jpeg_never_claim_success(self):
        entry=record();entry.update(thumbnail=True,thumbnail_version="5000:1792000000000")
        path=Path(self.tmp.name)/"thumb.jpg"
        path.write_bytes(b"\xff\xd8\xff"+b"x"*4997)
        with patch.object(m,"read_asset",side_effect=m.Unavailable):
            self.assertEqual(m.cache_thumbnail(entry,path,entry["thumbnail_version"]),(False,""))
        with patch.object(m,"read_asset",return_value=b"\xff\xd8\xff"+b"x"*4997):
            self.assertEqual(m.cache_thumbnail(entry,path,entry["thumbnail_version"]),(False,""))

    def test_invalid_phone_jpeg_preserves_valid_previous_version(self):
        entry=record();entry.update(thumbnail=True,thumbnail_version="5000:1792000000001")
        path=Path(self.tmp.name)/"thumb.jpg"
        previous=b"\xff\xd8\xff"+b"p"*4995+b"\xff\xd9"
        path.write_bytes(previous)
        with patch.object(m,"read_asset",side_effect=ValueError("bad_phone_image")):
            self.assertEqual(m.cache_thumbnail(entry,path,"5000:1792000000000"),
                             (True,"5000:1792000000000"))
        self.assertEqual(path.read_bytes(),previous)
    def test_asset_path_validation_never_contacts_phone(self):
        with patch.object(m.urllib.request,"urlopen") as request:
            for name in ["../secret","motion_1792000000000.mp4","FaceSnapshots/face.jpg"]:
                with self.assertRaises(ValueError):m.read_asset(name)
            request.assert_not_called()
    def test_phone_vectors_and_unknown_nested_features_never_enter_hub_cache(self):
        source=record();source['manifest'].update(appearance_vector=[.5],possible_same_outfit_clips=['other'],
            face_candidates=[{'snapshot':'crop.jpg','embedding':[1,2],'template':'private'}],
            anonymous_tracks=[{'id':'Person 1','appearance_vector':[3]}])
        self.load([page([source])]);cached=self.cache.read_text()
        self.assertNotIn('embedding',cached);self.assertNotIn('template',cached)
        self.assertNotIn('appearance_vector',cached);self.assertNotIn('possible_same_outfit',cached)
        self.assertIn('crop.jpg',cached);self.assertIn('Person 1',cached)

if __name__=="__main__":unittest.main()
