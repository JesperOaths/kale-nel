#!/usr/bin/env python3
"""Host-only tests. No live camera, network or clock changes."""
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPT=Path(__file__).with_name("audit-c720p-signed-action-clock-v226.py")
spec=importlib.util.spec_from_file_location("clock226",SCRIPT)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class ClockReadiness(unittest.TestCase):
 def test_ready_needs_clock_sync_two_tls_sources_and_low_skew(self):
  ready={"ntp_enabled":True,"synchronized":True,"timezone_preserved":True}
  sample=[{"origin":"www.cloudflare.com","remote_minus_local_seconds":0.5,
           "rtt_seconds":0.2},
          {"origin":"www.google.com","remote_minus_local_seconds":0.2,
           "rtt_seconds":0.3}]
  self.assertTrue(m.evaluate(ready,sample)["signed_action_clock_ready"])
  for altered in (
   {"ntp_enabled":False},{"synchronized":False},
  ):
   with self.subTest(altered=altered):
    self.assertFalse(m.evaluate({**ready,**altered},sample)
                     ["signed_action_clock_ready"])
  behind=[{**row,"remote_minus_local_seconds":row["remote_minus_local_seconds"]+92}
          for row in sample]
  failed=m.evaluate(ready,behind)
  self.assertFalse(failed["signed_action_clock_ready"])
  self.assertEqual(failed["status"],"signed_action_clock_blocked")
  self.assertGreater(failed["median_remote_minus_local_seconds"],90)
  self.assertFalse(failed["allow_widen_expiration_or_bypass_hmac"])
  self.assertFalse(m.evaluate(ready,[sample[0]])["signed_action_clock_ready"])
  disagreement=[sample[0],{**sample[1],"remote_minus_local_seconds":25}]
  self.assertFalse(m.evaluate(ready,disagreement)["signed_action_clock_ready"])
  self.assertFalse(m.evaluate(ready,[{**sample[0],"rtt_seconds":5},sample[1]])
                   ["signed_action_clock_ready"])

 def test_ntp_status_parsed_and_time_zone_must_be_preserved(self):
  body="NTP=no\nNTPSynchronized=no\nCanNTP=no\nTimezone=Europe/Amsterdam\n"
  with patch.object(m.subprocess,"run",return_value=SimpleNamespace(
      returncode=0,stdout=body,stderr="")):
   state=m.ntp_status()
  self.assertEqual(state,{"ntp_enabled":False,"synchronized":False,
                          "ntp_supported":False,"timezone_preserved":True})
  with patch.object(m.subprocess,"run",return_value=SimpleNamespace(
      returncode=0,stdout=body.replace("Europe/Amsterdam","UTC"),stderr="")):
   with self.assertRaisesRegex(m.Refusal,"clock_timezone_or_fields_untrusted"):
    m.ntp_status()

 def test_tls_date_midpoint_no_untrusted_redirect_or_network_command(self):
  class Response:
   status=200
   headers={"Date":"Tue, 20 Oct 2026 20:30:00 GMT"}
   def __init__(self,url):self.url=url
   def geturl(self):return self.url
   def __enter__(self):return self
   def __exit__(self,*args):pass
  clock=[1792528200.2,1792528200.4]
  mono=[3.0,3.2]
  with patch.object(m.urllib.request,"urlopen",return_value=Response(
       "https://www.cloudflare.com/")), \
       patch.object(m.time,"time",side_effect=clock), \
       patch.object(m.time,"monotonic",side_effect=mono):
   result=m.source("www.cloudflare.com")
   self.assertEqual(result["origin"],"www.cloudflare.com")
   self.assertEqual(result["rtt_seconds"],0.2)
  with patch.object(m.urllib.request,"urlopen",return_value=Response(
       "https://untrusted.example.org/")), \
       patch.object(m.time,"time",side_effect=clock), \
       patch.object(m.time,"monotonic",side_effect=mono):
   with self.assertRaisesRegex(m.Refusal,"time_source_redirected_to_untrusted_origin"):
    m.source("www.cloudflare.com")
  with self.assertRaisesRegex(m.Refusal,"non_allowlisted_time_source"):
   m.source("fake.example")

 def test_private_safe_fail_closed_main_and_read_only_source(self):
  with patch.object(m,"audit",side_effect=RuntimeError("private-video.mp4")), \
       patch("sys.stdout",new_callable=io.StringIO) as captured:
   with self.assertRaises(SystemExit):m.main()
  output=captured.getvalue()
  self.assertNotIn("private-video.mp4",output)
  self.assertIn('"signed_action_clock_ready":false',output)
  src=SCRIPT.read_text()
  for forbidden in ("set-ntp","clock_settime(", "datetime.datetime.now().replace(",
                    "apt-get", "sudo", "Files.delete(", "os.unlink(", "adb shell",
                    "pm install","subprocess.Popen(","subprocess.run(['sudo'"):
   self.assertNotIn(forbidden,src)
  self.assertIn('MAX_READY_ABS_OFFSET_SECONDS=10.0',src)
  self.assertIn('source_hosts_returned',src)
  self.assertIn('signed_media_auth_modified',src)

if __name__=="__main__":unittest.main(verbosity=2)
