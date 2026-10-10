#!/usr/bin/env python3
"""Verify C720P does not decode native Camera2 MP4s or shell out per seek."""
import importlib.util
from pathlib import Path
from io import BytesIO
from unittest import mock
import urllib.error
import unittest

ROOT=Path(__file__).resolve().parent.parent/"s9-person-ml-v1"/"s9_sd_proxy_extension.py"
spec=importlib.util.spec_from_file_location("s9_phone_range_proxy",ROOT)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class Handler:
    def __init__(self):
        self.wfile=BytesIO()
        self.headers={}
        self.sent=[]
        self.status=None
        self.error=None
    def send_response(self,code):self.status=code
    def send_header(self,name,value):self.sent.append((name,value))
    def end_headers(self):pass
    def js(self,code,body):self.status=code;self.error=body

class Reply:
    def __init__(self,data,size,start,end):
        self.data=BytesIO(data)
        self.status=206
        self.headers={
            "Content-Range":f"bytes {start}-{end}/{size}",
            "Content-Length":str(len(data)),
            "Content-Type":"video/mp4",
        }
    def read(self,n):return self.data.read(n)
    def __enter__(self):return self
    def __exit__(self,*args):pass

class Tests(unittest.TestCase):
    def test_native_phone_range_is_exact_and_avoids_adb(self):
        name="motion_1791651708493.mp4"
        start,end,size=32768,105700,200000
        data=bytes(i%256 for i in range(end-start+1))
        request_seen=[]
        def get(req,timeout):
            request_seen.append((req.full_url,req.headers))
            return Reply(data,size,start,end)
        h=Handler()
        with mock.patch.object(mod.urllib.request,"urlopen",side_effect=get),mock.patch.object(mod.subprocess,"Popen") as adb:
            success=mod.phone_video_range(h,name,size,start,end,len(data),206)
            adb.assert_not_called()
        self.assertTrue(success)
        self.assertEqual(h.status,206)
        self.assertEqual(h.wfile.getvalue(),data)
        self.assertIn(("X-S9-Media-Source","phone-microSD-range"),h.sent)
        self.assertEqual(request_seen[0][0],"http://127.0.0.1:18808/clip/"+name)
        self.assertEqual(request_seen[0][1]["Range"],f"bytes={start}-{end}")

    def test_old_app_404_returns_clean_fallback(self):
        h=Handler()
        error=urllib.error.HTTPError("url",404,"Not Found",{},None)
        with mock.patch.object(mod.urllib.request,"urlopen",side_effect=error):
            self.assertFalse(mod.phone_video_range(h,"motion_1791651708493.mp4",200000,0,10,11,206))
        self.assertIsNone(h.status)

    def test_untrusted_response_cannot_be_forwarded(self):
        h=Handler()
        wrong=Reply(b"corrupted",200000,0,8)
        with mock.patch.object(mod.urllib.request,"urlopen",return_value=wrong):
            self.assertTrue(mod.phone_video_range(h,"motion_1791651708493.mp4",200000,0,10,11,206))
        self.assertEqual(h.status,503)
        self.assertEqual(h.wfile.getvalue(),b"")

if __name__=="__main__":
    unittest.main(verbosity=2)
