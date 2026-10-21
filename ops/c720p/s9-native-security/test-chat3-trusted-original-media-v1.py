"""No media I/O: isolated byte-range delegate tests."""
import io,pathlib,sys,unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'s9-person-ml-v1'))
import s9_trusted_original_media_bridge_v1 as bridge

class Response:
    status=206
    def __init__(self,raw,headers):self.raw=io.BytesIO(raw);self.headers=headers
    def __enter__(self):return self
    def __exit__(self,*a):return False
    def read(self,n):return self.raw.read(n)
class Handler:
    def __init__(self,value):self.headers={'Range':value};self.wfile=io.BytesIO();self.reply=None;self.fields={}
    def send_response(self,code):self.reply=code
    def send_header(self,key,value):self.fields[key]=value
    def end_headers(self):pass
class Tests(unittest.TestCase):
    def test_bounded_metadata_and_seek(self):
        self.assertEqual(bridge.requested_range('bytes=0-',15_000_000),(0,bridge.LIMIT-1))
        self.assertEqual(bridge.requested_range('bytes=900-1023',12000),(900,1023))
        self.assertEqual(bridge.requested_range('',12000),(0,11999))
    def test_bad_range_refuses(self):
        for header in ('bytes=0-1,3-4','bytes=12-10','bytes=-10','bytes=99999-'):
            with self.assertRaises(bridge.Unavailable):bridge.requested_range(header,12000)
    def test_delivered_exact_bytes_only(self):
        h=Handler('bytes=0-99');pins=dict(size_bytes=12000,source_identity='s',source_revision='r',original_sha256='a'*64)
        callbacks=[]
        def fake(req,timeout):
            self.assertEqual(timeout,20)
            return Response(b'0'*100,{'Content-Range':'bytes 0-99/12000','Content-Length':'100','Content-Type':'video/mp4'})
        with patch.object(bridge,'urlopen',fake):
            bridge.serve_pinned_original(h,'sd','motion_1000000000000.mp4','nonce',pins,callbacks.append)
        self.assertEqual(h.reply,206);self.assertEqual(len(h.wfile.getvalue()),100)
        self.assertEqual(callbacks[0]['transferred_bytes'],100)
    def test_incomplete_response_no_receipt(self):
        h=Handler('bytes=0-99');pins=dict(size_bytes=12000,source_identity='s',source_revision='r',original_sha256='a'*64)
        callbacks=[]
        def fake(req,timeout):
            return Response(b'0'*50,{'Content-Range':'bytes 0-99/12000','Content-Length':'100','Content-Type':'video/mp4'})
        with patch.object(bridge,'urlopen',fake):
            with self.assertRaises(bridge.Unavailable):
                bridge.serve_pinned_original(h,'sd','motion_1000000000000.mp4','nonce',pins,callbacks.append)
        self.assertEqual(callbacks,[])
    def test_wrong_origin_range_no_receipt(self):
        h=Handler('bytes=0-99');pins=dict(size_bytes=12000,source_identity='s',source_revision='r',original_sha256='a'*64)
        callbacks=[]
        def fake(req,timeout):
            return Response(b'0'*100,{'Content-Range':'bytes 0-99/13000','Content-Length':'100','Content-Type':'video/mp4'})
        with patch.object(bridge,'urlopen',fake):
            with self.assertRaises(bridge.Unavailable):
                bridge.serve_pinned_original(h,'sd','motion_1000000000000.mp4','nonce',pins,callbacks.append)
        self.assertEqual(callbacks,[])
if __name__=='__main__':unittest.main()
