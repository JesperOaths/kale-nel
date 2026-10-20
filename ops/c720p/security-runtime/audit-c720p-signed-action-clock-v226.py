#!/usr/bin/env python3
"""Read-only C720P wall-clock readiness for future signed S9 Save/Delete.

HTTPS Date comparisons plus OS NTP state. No privileged commands, NTP repair,
camera actions, video reads, token requests, person data or stored secrets.
Never relax signed intent HMAC/expirations to compensate for clock drift.
"""
import datetime as dt
import email.utils
import json
import statistics
import subprocess
import time
import urllib.request
import urllib.parse
from pathlib import Path

LABEL="C720P_SIGNED_ACTION_CLOCK_V226 "
HOSTS=("www.cloudflare.com","www.google.com","www.microsoft.com")
MAX_HTTP_RTT=4.0
MAX_SOURCE_SPREAD_SECONDS=5.0
REQUIRED_SOURCES=2
MAX_READY_ABS_OFFSET_SECONDS=10.0
CAMERA="http://127.0.0.1:18808/status"
TIMEOUT=7
CLOCK_FIELDS=("NTP","NTPSynchronized","CanNTP","Timezone")

class Refusal(Exception): pass

def require(condition,reason):
 if not condition:raise Refusal(reason)

def ntp_status():
 try:
  p=subprocess.run(["timedatectl","show","-p","NTP","-p","NTPSynchronized",
                     "-p","CanNTP","-p","Timezone"],
                   capture_output=True,text=True,timeout=8,check=False)
 except (OSError,subprocess.TimeoutExpired):
  raise Refusal("clock_service_query_failed") from None
 require(p.returncode==0 and len(p.stdout)<5000,
         "clock_service_query_failed")
 doc=dict(item.split("=",1) for item in p.stdout.splitlines() if "=" in item)
 require(set(CLOCK_FIELDS).issubset(doc) and doc["Timezone"]=="Europe/Amsterdam",
         "clock_timezone_or_fields_untrusted")
 return {"ntp_enabled":doc["NTP"]=="yes",
         "synchronized":doc["NTPSynchronized"]=="yes",
         "ntp_supported":doc["CanNTP"]=="yes",
         "timezone_preserved":True}

def source(host):
 require(host in HOSTS,"non_allowlisted_time_source")
 request=urllib.request.Request("https://"+host+"/",
          method="HEAD",headers={"User-Agent":"c720p-clock-readiness-v226"})
 local_before=time.time()
 mono_before=time.monotonic()
 try:
  # urllib uses the system CA bundle and hostname verification by default.
  with urllib.request.urlopen(request,timeout=TIMEOUT) as response:
   require(response.status in (200,204),"tls_time_http_status_untrusted")
   final=urllib.parse.urlparse(response.geturl())
   require(final.scheme=="https" and final.hostname==host,
           "time_source_redirected_to_untrusted_origin")
   remote=response.headers.get("Date")
 except (OSError,ValueError):
  raise Refusal("https_time_probe_unavailable") from None
 local_after=time.time()
 mono_after=time.monotonic()
 rtt=mono_after-mono_before
 require(0<=rtt<=MAX_HTTP_RTT and abs((local_after-local_before)-rtt)<2,
         "https_time_probe_clock_jumped")
 try:
  parsed=email.utils.parsedate_to_datetime(remote)
  require(parsed.tzinfo is not None,"https_date_without_timezone")
  server=parsed.timestamp()
 except (TypeError,ValueError,OverflowError,AttributeError):
  raise Refusal("https_date_untrusted") from None
 require(1600000000<server<2200000000,"https_date_outside_expected_epoch")
 offset=server-(local_before+local_after)/2
 require(-3600<offset<3600,"clock_offset_outside_probe_limits")
 return {"origin":host,"remote_minus_local_seconds":round(offset,2),
         "rtt_seconds":round(rtt,2)}

def camera():
 try:
  with urllib.request.urlopen(CAMERA,timeout=6) as response:
   require(response.status==200,"native_camera_unreachable")
   data=response.read(65537)
  require(len(data)<=65536,"native_camera_status_unbounded")
  doc=json.loads(data)
 except (OSError,ValueError,TypeError):
  raise Refusal("native_camera_unreachable") from None
 require(doc.get("ok") is True and doc.get("mode")=="watching"
  and doc.get("native_4k_enabled") is True
  and doc.get("continuous_4k_ready") is True
  and doc.get("continuous_4k_dropped_output_frames")==0
  and not doc.get("continuous_4k_error")
  and type(doc.get("temperature_c")) in (float,int)
  and 0<doc["temperature_c"]<=39.5,
  "native_camera_health_guard")
 return {"ready":True,"temperature_c":doc["temperature_c"],"output_drops":0}

def evaluate(state,samples):
 require(isinstance(samples,list),"time_samples_invalid")
 good=[item for item in samples if isinstance(item,dict)
       and type(item.get("remote_minus_local_seconds")) in (int,float)
       and type(item.get("rtt_seconds")) in (int,float)
       and item["origin"] in HOSTS and item["rtt_seconds"]<=MAX_HTTP_RTT]
 origins={item["origin"] for item in good}
 if len(origins)<REQUIRED_SOURCES:
  return {"status":"time_sources_inconclusive","signed_action_clock_ready":False,
          "measured_sources":len(origins),"ntp_enabled":state["ntp_enabled"],
          "ntp_synchronized":state["synchronized"]}
 offsets=[item["remote_minus_local_seconds"] for item in good]
 median=statistics.median(offsets)
 spread=max(offsets)-min(offsets)
 coherent=spread<=MAX_SOURCE_SPREAD_SECONDS
 ready=(coherent and abs(median)<=MAX_READY_ABS_OFFSET_SECONDS
        and state["ntp_enabled"] and state["synchronized"])
 return {"status":"ready" if ready else "signed_action_clock_blocked",
         "signed_action_clock_ready":ready,
         "median_remote_minus_local_seconds":round(median,2),
         "source_spread_seconds":round(spread,2),
         "time_source_consistent":coherent,
         "measured_sources":len(origins),
         "ntp_enabled":state["ntp_enabled"],
         "ntp_synchronized":state["synchronized"],
         "timezone_preserved":state["timezone_preserved"],
         "allow_widen_expiration_or_bypass_hmac":False}

def audit():
 before=camera()
 os_state=ntp_status()
 samples=[]
 for host in HOSTS:
  try:samples.append(source(host))
  except Refusal:pass
 result=evaluate(os_state,samples)
 after=camera()
 return {**result,"camera_before_ready":before["ready"],
    "camera_after_ready":after["ready"],
    "camera_temperature_after_c":after["temperature_c"],
    "camera_dropped_output_frames_after":after["output_drops"],
    "read_only":True,"clock_changed":False,
    "ntp_service_installed_or_started":False,
    "signed_media_auth_modified":False,
    "media_read_or_modified":False,
    "reviews_modified":False,
    "source_hosts_returned":sorted(x["origin"] for x in samples),
    "does_not_claim_remote_save_delete_active":True}

def main():
 try:result=audit()
 except Exception as ex:
  reason=str(ex) if isinstance(ex,Refusal) else "unexpected_probe_failure"
  allowed={"clock_service_query_failed","clock_timezone_or_fields_untrusted",
           "native_camera_unreachable","native_camera_status_unbounded",
           "native_camera_health_guard","time_samples_invalid"}
  result={"status":"unverified","reason":reason if reason in allowed
          else "unexpected_probe_failure","read_only":True,
          "signed_action_clock_ready":False,"clock_changed":False,
          "signed_media_auth_modified":False,"media_read_or_modified":False,
          "reviews_modified":False}
 print(LABEL+json.dumps(result,sort_keys=True,separators=(",",":")),flush=True)
 if result["status"]=="unverified":raise SystemExit(1)

if __name__=="__main__":main()
