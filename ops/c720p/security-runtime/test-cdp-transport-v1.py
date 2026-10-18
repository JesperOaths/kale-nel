#!/usr/bin/env python3
"""TCP segmentation and EOF must not break or hang kiosk recovery reads."""
import importlib.util
import json
from pathlib import Path
import struct
import unittest

spec=importlib.util.spec_from_file_location('cdp',Path(__file__).with_name('c720p-cdp-dashboard-recover.py'))
cdp=importlib.util.module_from_spec(spec);spec.loader.exec_module(cdp)


def frame(value):
    body=json.dumps(value).encode();n=len(body)
    return b'\x81'+(bytes([n]) if n<126 else b'\x7e'+struct.pack('!H',n) if n<65536
                    else b'\x7f'+struct.pack('!Q',n))+body


class SegmentedSocket:
    def __init__(self,data,chunk=1):self.data=data;self.chunk=chunk;self.calls=0
    def settimeout(self,timeout):pass
    def recv(self,n):
        self.calls+=1
        if self.calls>100000:raise AssertionError('unbounded read loop')
        n=min(n,self.chunk);out=self.data[:n];self.data=self.data[n:];return out


class TransportTests(unittest.TestCase):
    def test_header_and_payload_can_arrive_one_byte_at_a_time(self):
        value={'id':1,'result':{'ok':True}}
        self.assertEqual(cdp.ws_recv(SegmentedSocket(frame(value))),value)

    def test_extended_lengths_and_consecutive_messages_preserve_boundaries(self):
        for n in [500,70000]:
            a={'id':1,'result':'x'*n};b={'id':2}
            sock=SegmentedSocket(frame(a)+frame(b),chunk=3)
            self.assertEqual(cdp.ws_recv(sock),a)
            self.assertEqual(cdp.ws_recv(sock),b)

    def test_eof_during_header_or_payload_raises_without_a_busy_loop(self):
        for data in [b'\x81',b'\x81\x7e\x00',b'\x81\x7f\x00',frame({'id':1})[:-2]]:
            sock=SegmentedSocket(data)
            with self.assertRaises(cdp.CDPError):cdp.ws_recv(sock)
            self.assertLess(sock.calls,100)

    def test_incomplete_frame_obeys_total_deadline(self):
        sock=SegmentedSocket(frame({'id':1}))
        with self.assertRaises(TimeoutError):cdp.ws_recv(sock,timeout=0)
        self.assertEqual(sock.calls,0)


if __name__=='__main__':unittest.main()
