#!/usr/bin/env python3
"""Bounded, synthetic CDP socket-read tests; never contacts the kiosk."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

SOURCE=Path(__file__).with_name("security-v8-real-browser-probe.py")
spec=importlib.util.spec_from_file_location("c720p_browser_probe",SOURCE)
probe=importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

class SocketStub:
 def __init__(self,payload):
  self.remaining=bytearray(payload)
  self.requests=[]
 def recv(self,n):
  self.requests.append(n)
  out=bytes(self.remaining[:n])
  del self.remaining[:n]
  return out

class BoundedCDPRead(unittest.TestCase):
 def test_oversized_frame_is_rejected_before_memory_allocation(self):
  socket=probe.Socket.__new__(probe.Socket)
  socket.sock=Mock()
  for length in (probe.MAX_CDP_FRAME_BYTES+1,2**63,-1):
   with self.subTest(length=length):
    with self.assertRaisesRegex(RuntimeError,"cdp_frame_too_large"):
     socket._get(length)
  socket.sock.recv.assert_not_called()
 def test_read_large_legal_frame_in_bounded_chunks(self):
  expected=b"a"*(80*1024)
  stub=SocketStub(expected)
  socket=probe.Socket.__new__(probe.Socket)
  socket.sock=stub
  self.assertEqual(socket._get(len(expected)),expected)
  self.assertLessEqual(max(stub.requests),65536)
  self.assertEqual(len(stub.remaining),0)
 def test_short_frame_errors_without_infinite_loop(self):
  socket=probe.Socket.__new__(probe.Socket)
  socket.sock=SocketStub(b"test")
  with self.assertRaisesRegex(RuntimeError,"cdp_ws_closed"):
   socket._get(10)
 def test_zero_length_returns_empty(self):
  socket=probe.Socket.__new__(probe.Socket)
  socket.sock=Mock()
  self.assertEqual(socket._get(0),b"")
  socket.sock.recv.assert_not_called()

if __name__=="__main__": unittest.main(verbosity=2)
