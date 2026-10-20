#!/usr/bin/env python3
"""Offline deterministic tests: never call the internet or write system time."""
import datetime
import email.message
import importlib.util
from pathlib import Path
import unittest
from unittest import mock

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/"s9_authenticated_issuer_https_clock_v234.py"
spec=importlib.util.spec_from_file_location("s9_time_v234",SOURCE)
m=importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name]=m
spec.loader.exec_module(m)
BASE=1800000000.0

def s(host,seconds,at=1000.0,rtt=0.15,offset=None):
    return m.Sample(host,BASE+seconds,at,rtt,
         seconds if offset is None else offset)

class FakeResponse:
    def __init__(self,host,date,age=None,status=200,extra_date=None):
        self.status=status
        self._url="https://"+host+"/"
        self.headers=email.message.Message()
        self.headers.add_header("Date",date)
        if extra_date is not None:
            self.headers.add_header("Date",extra_date)
        if age is not None:self.headers.add_header("Age",age)
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def geturl(self):return self._url

class FakeOpener:
    def __init__(self,response):self.response=response
    def open(self,request,timeout):
        assert request.get_method()=="HEAD"
        assert request.full_url.startswith("https://")
        assert timeout<=5
        return self.response

class Oracle(unittest.TestCase):
    def test_hub_skew_corrected_only_by_two_independent_sources(self):
        result=m.evaluate([
           s("www.google.com",94),s("www.microsoft.com",95)],
           1000,BASE)
        self.assertEqual(len(result.source_hosts),2)
        self.assertGreater(result.epoch_ms,round((BASE+93)*1000))
        self.assertTrue(result.valid_for_signing_at(1001))
        self.assertFalse(result.valid_for_signing_at(1003))
        self.assertGreater(result.remote_minus_hub_s,93)
        self.assertLess(result.source_spread_s,3)

    def test_single_clock_and_redirect_equivalence_refused(self):
        with self.assertRaises(m.Refusal):
            m.evaluate([s("www.google.com",94)],1000,BASE)
        with self.assertRaises(m.Refusal):
            m.evaluate([s("www.google.com",94),
                        s("www.google.com",94.5)],1000,BASE)
        with self.assertRaises(m.Refusal):
            m.evaluate([s("attacker.invalid",94),
                        s("www.google.com",94)],1000,BASE)

    def test_inconsistent_sources_and_stale_outlier(self):
        with self.assertRaises(m.Refusal):
            m.evaluate([s("www.google.com",94),
                        s("www.microsoft.com",108)],1000,BASE)
        accepted=m.evaluate([s("www.google.com",94),
              s("github.com",94.8),
              s("www.microsoft.com",-40000,offset=-40000)],1000,BASE)
        self.assertEqual(set(accepted.source_hosts),
                         {"www.google.com","github.com"})
        with self.assertRaises(m.Refusal):
            m.evaluate([s("www.google.com",90),s("github.com",91),
                s("www.microsoft.com",98),
                s("www.cloudflare.com",99)],1000,BASE)

    def test_timing_and_offset_bounds_refuse(self):
        for sources in (
          [s("www.google.com",94,rtt=5),
           s("github.com",94)],
          [s("www.google.com",94,at=960),
           s("github.com",94,at=960)],
          [s("www.google.com",700),
           s("github.com",701)],
        ):
            with self.assertRaises(m.Refusal):
                m.evaluate(sources,1000,BASE)

    def test_date_cache_duplicates_unparsable_and_redirect(self):
        stamp="Mon, 17 Jan 2027 12:00:00 GMT"
        allowed=FakeResponse("www.google.com",stamp,age="0")
        self.assertIsInstance(m._header_date(allowed),float)
        for bad in (
           FakeResponse("www.google.com",stamp,age="1200"),
           FakeResponse("www.google.com",stamp,extra_date=stamp),
           FakeResponse("www.google.com","not-a-date"),
           FakeResponse("www.google.com","Mon, 17 Jan 2027 12:00:00"),
        ):
            with self.assertRaises(m.Refusal):
                m._header_date(bad)
        with self.assertRaises(m.Refusal):
            m._NoRedirects().redirect_request(None,None,301,"moved",{},
                                                "https://attacker.invalid")
        with self.assertRaises(m.Refusal):
            m._single_source("attacker.invalid")

    def test_live_source_path_still_rejects_bad_status_and_bad_offsets(self):
        stamp="Mon, 17 Jan 2027 12:00:00 GMT"
        response=FakeResponse("www.google.com",stamp,status=302)
        with mock.patch.object(m.urllib.request,"build_opener",
                               return_value=FakeOpener(response)):
            with self.assertRaises(m.Refusal):
                m._single_source("www.google.com")
        response=FakeResponse("www.google.com",stamp,status=200)
        with mock.patch.object(m.urllib.request,"build_opener",
                               return_value=FakeOpener(response)):
            with self.assertRaises(m.Refusal):
                m._single_source("www.google.com",
                   wall=lambda: BASE,
                   monotonic=lambda: 1000.0)

    def test_rollback_clock_no_mutations_or_expiry_bypass(self):
        content=SOURCE.read_text()
        for required in ("ssl.create_default_context()",
             "HTTPSHandler(context=ssl.create_default_context())",
             "MAX_RTT_S=4.0","MAX_DISAGREEMENT_S=3.0",
             "len(distinct)>=2","_NoRedirects()",
             "conflicting_time_majorities",
             "os_ntp_changed","production_signer_enabled"):
            self.assertIn(required,content)
        for forbidden in ("subprocess.","os.system(","os.settimeofday(",
            "timedatectl set","ntpdate","chronyc","Files.delete",
            "getExternalFilesDir","HMAC_SECRET","signForHostTestOnly",
            "CameraManager","http://"):
            self.assertNotIn(forbidden,content)

if __name__=="__main__":
    unittest.main(verbosity=2)
