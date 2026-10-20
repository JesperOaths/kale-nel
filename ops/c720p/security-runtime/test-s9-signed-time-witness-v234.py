#!/usr/bin/env python3
"""Synthetic safety tests: no real HTTP, clock, phone, media or production key."""
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE=Path(__file__).with_name("s9_signed_time_witness_v234.py")
spec=importlib.util.spec_from_file_location("s9_time_witness_234",SOURCE)
m=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=m
spec.loader.exec_module(m)
OFFLINE=SOURCE.parent.parent/"s9-native-security"/"offline-worker"
JAVA=OFFLINE/"S9TrustedClockBridgeTestV234.java"
V198=OFFLINE/"S9MigratedSignedActionV198.java"
TESTCLASS="nl.kalenel.s9offline.S9TrustedClockBridgeTestV234"

class TimeWitness(unittest.TestCase):
 def samples(self):
  return [
    m.Sample("www.cloudflare.com",1792600000.5,100.00,0.20),
    m.Sample("www.google.com",1792600000.9,100.10,0.15)
  ]
 def test_two_coherent_low_rtt_tls_sources(self):
  w=m.establish(self.samples(),100.30)
  self.assertEqual(w.source_count,2)
  self.assertLess(w.spread_seconds,1)
  self.assertTrue(1792600000600<=w.epoch_millis(100.30)<=1792600001200)
  self.assertGreater(w.epoch_millis(102.0),w.epoch_millis(100.30))
  with self.assertRaisesRegex(m.Refusal,"trusted_time_witness_expired"):
   w.epoch_millis(106)
  with self.assertRaisesRegex(m.Refusal,"trusted_time_witness_expired"):
   w.epoch_millis(100)

 def test_untrusted_sources_and_extreme_wall_time_are_rejected(self):
  items=self.samples()
  for bad,reason in [
   ([items[0]],"insufficient_independent_https_times"),
   ([items[0],items[0]],"time_sample_untrusted"),
   ([items[0],m.Sample("www.google.com",1792640800.5,100.10,0.10)],
     "independent_https_times_disagree"),
   ([items[0],m.Sample("www.google.com",1792600000.5,100.10,5.0)],
     "time_sample_untrusted"),
   ([items[0],m.Sample("www.google.com",1792600000.5,92.0,0.10)],
     "time_sample_expired_or_monotonic_reversed"),
   ([items[0],m.Sample("evil.example",1792600000.5,100.10,0.10)],
     "time_sample_untrusted"),
  ]:
   with self.subTest(reason=reason):
    with self.assertRaisesRegex(m.Refusal,reason):
     m.establish(bad,100.3)

 def test_allowlisted_tls_date_origin_cache_and_slow_rejection(self):
  class Response:
   status=200
   def __init__(self,url,age=None,date="Tue, 20 Oct 2026 22:00:00 GMT"):
    self.url=url
    self.headers={"Date":date}
    if age is not None:self.headers["Age"]=age
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def geturl(self):return self.url
  good=Response("https://www.cloudflare.com/")
  with patch.object(m.urllib.request,"urlopen",return_value=good), \
       patch.object(m.time,"monotonic",side_effect=[100.0,100.2]):
   observed=m.probe("www.cloudflare.com")
  self.assertEqual(observed.host,"www.cloudflare.com")
  self.assertAlmostEqual(observed.rtt_seconds,0.2)
  self.assertAlmostEqual(observed.midpoint_monotonic,100.1)
  for fake,expected in (
   (Response("http://www.cloudflare.com/"),"https_date_cross_origin_redirect"),
   (Response("https://evil.example/"),"https_date_cross_origin_redirect"),
   (Response("https://www.cloudflare.com:8443/"),"https_date_cross_origin_redirect"),
   (Response("https://www.cloudflare.com/",age="31"),"cached_https_date_rejected"),
   (Response("https://www.cloudflare.com/",date="not-a-date"),"https_date_invalid"),
  ):
   with self.subTest(expected=expected):
    with patch.object(m.urllib.request,"urlopen",return_value=fake), \
         patch.object(m.time,"monotonic",side_effect=[100.0,100.2]):
     with self.assertRaisesRegex(m.Refusal,expected):
      m.probe("www.cloudflare.com")
  with patch.object(m.urllib.request,"urlopen",return_value=good), \
       patch.object(m.time,"monotonic",side_effect=[100.0,103.0]):
   with self.assertRaisesRegex(m.Refusal,"https_date_response_too_slow"):
    m.probe("www.cloudflare.com")

 def test_readonly_inconclusive_does_not_report_live_activation(self):
  with patch.object(m,"audit",side_effect=RuntimeError("private name")), \
       patch("sys.stdout",new_callable=io.StringIO) as output:
   with self.assertRaises(SystemExit):m.main()
  self.assertIn('"status":"inconclusive"',output.getvalue())
  self.assertNotIn("private name",output.getvalue())
  self.assertIn('"future_production_signing_enabled":false',output.getvalue())
  text=SOURCE.read_text()
  for blocked in ("subprocess.run(", "sudo ", "timedatectl set-", "pm install",
                  "adb push","os.system(", "os.unlink(", "Files.delete(",
                  "hmac.new(", "KeyGenerator", "token_issue("):
   self.assertNotIn(blocked,text)
  self.assertIn('MAX_WITNESS_AGE_SECONDS=5.0',text)
  self.assertIn('MAX_SPREAD_SECONDS=2.5',text)
  self.assertIn('not_an_s9_clock_attestation',text)

 def test_java_v198_interop_from_coherent_witness(self):
  witness=m.establish(self.samples(),100.3)
  utc=str(witness.epoch_millis(100.3))
  with tempfile.TemporaryDirectory(prefix="s9-time-javac-v234-") as root:
   compiler=subprocess.run(["javac","-source","8","-target","8",
      "-d",root,str(V198),str(JAVA)],capture_output=True,text=True,timeout=40)
   self.assertEqual(compiler.returncode,0,"java_v198_interop_compile_failed")
   output=subprocess.run(["java","-cp",root,TESTCLASS,utc],
       capture_output=True,text=True,timeout=25)
   self.assertEqual(output.returncode,0,"java_v198_ttl_and_hmac_parity_failed")
   self.assertEqual(output.stdout.strip(),
                    "S9_TIME_WITNESS_V234_JAVA_SIGNATURE_PARITY_OK")

if __name__=="__main__":unittest.main(verbosity=2)
