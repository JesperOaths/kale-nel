#!/usr/bin/env python3
"""Offline synthetic, fail-closed tests: no network/credentials/phone or root."""
import importlib.util
import io
import json
import time
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SOURCE=Path(__file__).with_name("c720p-correlated-tls-utc-v234.py")
spec=importlib.util.spec_from_file_location("safe_utc_v234",SOURCE)
m=importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name]=m
spec.loader.exec_module(m)

class TrustUtc(unittest.TestCase):
 def sample(self,values,begin=1792530000,elapsed=1.0):
  def observed(host):
   v=values.get(host)
   if v is None:raise m.UntrustedTimeError("test_source_down")
   if isinstance(v,tuple):return m.Observation(host,*v)
   return m.Observation(host,v,0.3)
  with patch.object(m,"_request",side_effect=observed), \
       patch.object(m.time,"time",side_effect=[begin,begin+elapsed]), \
       patch.object(m.time,"monotonic",side_effect=[90,90+elapsed]):
   return m.calibrated_utc()

 def test_corrects_known_93_second_skew_without_affecting_signature(self):
  c=self.sample({"www.cloudflare.com":93.2,"www.microsoft.com":93.6})
  self.assertEqual(c.source_count,2)
  self.assertAlmostEqual(c.correction_s,93.4)
  self.assertLess(c.max_spread_s,1)
  self.assertFalse(c.authorizes_remote_action())
  self.assertFalse(c.allows_signature_bypass())
  self.assertFalse(c.changes_system_clock())
  with patch.object(m.time,"monotonic",return_value=91.4):
   self.assertAlmostEqual(c.now_unix(),1792530094.4,places=2)
  with patch.object(m.time,"monotonic",return_value=97.5):
   with self.assertRaisesRegex(m.UntrustedTimeError,"expired"):
    c.now_unix()
  with patch.object(m.time,"monotonic",return_value=88):
   with self.assertRaisesRegex(m.UntrustedTimeError,"monotonic"):
    c.now_unix()

 def test_no_single_source_no_inconsistent_offsets(self):
  cases=[
   ({"www.cloudflare.com":93.4},"independent_sources"),
   ({"www.cloudflare.com":93.4,"www.microsoft.com":101.2},"disagreement"),
   ({"www.cloudflare.com":190,"www.microsoft.com":190},"outside_safety_bound"),
   ({"www.cloudflare.com":-185,"www.microsoft.com":-184},"outside_safety_bound"),
   ({},"independent_sources"),
  ]
  for readings,reason in cases:
   with self.subTest(readings=readings):
    with self.assertRaisesRegex(m.UntrustedTimeError,reason):
     self.sample(readings)

 def test_reject_wall_clock_jump_between_separate_tls_requests(self):
  vals={"www.cloudflare.com":93.1,"www.microsoft.com":93.4}
  def obs(host):
   if host=="www.google.com":raise m.UntrustedTimeError("no_network")
   return m.Observation(host,vals[host],0.1)
  with patch.object(m,"_request",side_effect=obs), \
       patch.object(m.time,"time",side_effect=[1000,1010]), \
       patch.object(m.time,"monotonic",side_effect=[100,101]):
   with self.assertRaisesRegex(m.UntrustedTimeError,"clock_jump"):
    m.calibrated_utc()

 def test_duplicate_fake_origin_is_not_a_second_source(self):
  with patch.object(m,"_request",return_value=m.Observation(
       "www.cloudflare.com",93.4,0.2)), \
       patch.object(m.time,"time",side_effect=[1792530000,1792530001]), \
       patch.object(m.time,"monotonic",side_effect=[100,101]):
   with self.assertRaisesRegex(m.UntrustedTimeError,"independent_sources"):
    m.calibrated_utc()

 def test_slow_source_or_bad_tls_response_is_never_accepted(self):
  class Response:
   status=200
   headers={"Date":"Tue, 20 Oct 2026 21:00:00 GMT"}
   def __init__(self,uri):self.uri=uri
   def geturl(self):return self.uri
   def __enter__(self):return self
   def __exit__(self,*args):return False
  for url,clocks,mono,reason in (
    ("https://evil.invalid/",[1792529990,1792529990.2],[1,1.2],"response_invalid"),
    ("https://www.cloudflare.com/",[1792529990,1792529996],[1,7],"slow"),
    ("https://www.cloudflare.com/",[1792529990,1792529989],[1,1.3],"clock_jump")
  ):
   with self.subTest(reason=reason):
    with patch.object(m.urllib.request,"urlopen",return_value=Response(url)), \
         patch.object(m.time,"time",side_effect=clocks), \
         patch.object(m.time,"monotonic",side_effect=mono):
     with self.assertRaisesRegex(m.UntrustedTimeError,reason):
      m._request("www.cloudflare.com")

 def test_main_redacts_unhandled_exceptions(self):
  with patch.object(m,"calibrated_utc",side_effect=RuntimeError("private_id.mp4")), \
       patch("sys.stdout",new_callable=io.StringIO) as output:
   with self.assertRaises(SystemExit) as stopped:m.main()
  self.assertEqual(stopped.exception.code,2)
  self.assertIn('"status": "fail_closed"',output.getvalue())
  self.assertNotIn("private_id.mp4",output.getvalue())

 def test_source_has_no_root_or_token_bypass_or_media_mutations(self):
  source=SOURCE.read_text()
  for prohibited in ("subprocess.", "sudo ", "timedatectl set-ntp",
                     "clock_settime(", "os.system(", "os.unlink(",
                     "KeyGenerator", "secret_key", "getEncoded(",
                     "unlink(", "delete(", "pm install", "adb ",
                     "MAX_READY_ABS_OFFSET_SECONDS=180"):
   self.assertNotIn(prohibited,source)
  for required in ("MAX_USE_AGE_SECONDS=5.0",
                   "MAX_ABSOLUTE_CORRECTION_SECONDS=180.0",
                   "MAX_SPREAD_SECONDS=2.5",
                   "source_count", "remote_actions_enabled",
                   "token_ttl_or_hmac_rules_modified"):
   self.assertIn(required,source)

if __name__=="__main__":
 unittest.main(verbosity=2)
