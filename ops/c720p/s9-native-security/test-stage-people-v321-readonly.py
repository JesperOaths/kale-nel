#!/usr/bin/env python3
"""No-network regression for the immutable V321 preview staging gates."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main, mock
import importlib.util
from urllib.parse import urlsplit

spec=importlib.util.spec_from_file_location(
    "v321_preview_stage",Path(__file__).with_name("stage-people-v321-readonly.py"))
stage=importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)

class PreviewStageTest(TestCase):
    def test_real_http_scheme_preserved_in_served_verification(self):
        blob=b"preview fixture valid original"
        urls=[]
        class Reply:
            status=200
            def __enter__(self):return self
            def __exit__(self,*_):pass
            def read(self,n):return blob
        def urlopen(url,timeout):
            parsed=urlsplit(url)
            self.assertEqual(parsed.scheme,"http")
            self.assertEqual(parsed.hostname,"127.0.0.1")
            self.assertEqual(parsed.port,8123)
            self.assertEqual(parsed.path,"/local/frontyard-security-new/security-people-v51.html")
            urls.append(url)
            return Reply()
        with mock.patch.object(stage.urllib.request,"urlopen",side_effect=urlopen):
            stage.verify_served({"security-people-v51.html":blob},"a"*40)
        self.assertEqual(len(urls),1)

    def test_existing_different_preview_is_never_overwritten(self):
        with TemporaryDirectory() as temp:
            path=Path(temp)/"security-people-v51.html"
            self.assertTrue(stage.atom_new(path,b"new"))
            self.assertEqual(path.read_bytes(),b"new")
            self.assertFalse(stage.atom_new(path,b"new"))
            with self.assertRaises(RuntimeError):
                stage.atom_new(path,b"other")
            self.assertEqual(path.read_bytes(),b"new")

    def test_source_has_authenticator_gate_and_versioned_markup(self):
        x={
          "security-people-v321.js": (
            "function renderVerifiedFolderSuggestions() "+
            "typeof signed?.openAndAttest==='function' "+
            "host.hidden=!available "+
            "hook.openAndAttest(row,()=>startVideo(clip)) "+
            "assignmentKey(x)===row.source_qualified_clip_id "+
            "human_review_required "+(" "*12000)).encode(),
          "security-people-v51.html": (
            '<script src="folder-suggestion-cards-v1.js?v=x"></script>'+
            '<script src="security-people-v321.js?v=x"></script>'+
            '<div id="folderRankedCards"></div>'+(" "*12000)).encode()
        }
        stage.check_sources(x)

if __name__=="__main__":
    main(verbosity=2)
