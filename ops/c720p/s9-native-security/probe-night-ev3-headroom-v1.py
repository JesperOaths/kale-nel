#!/usr/bin/env python3
"""Bounded nighttime +2 vs +3 EV native Camera2 test; restore previous EV.

Runs only on authorized C720P ADB-forward localhost. Never stores images or
changes APK, files, 4K encoder settings, night mode, motion zone, or torch.
Can temporarily change exposure_ev in watching mode for sensor comparison.
"""
from __future__ import annotations
import importlib.util
import json
import statistics
import time
import urllib.request
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("night_quality",HERE/"audit-night-image-quality-v1.py")
quality=importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)
BASE="http://127.0.0.1:18808"
SAMPLES=3

def controls()->dict:
 d=json.loads(quality.read("/controls",100_000))
 if not d.get("ok") or not isinstance(d.get("controls"),dict):
  raise RuntimeError("native_control_status_unavailable")
 return d["controls"]

def set_ev(ev:str)->dict:
 body=json.dumps({"key":"exposure_ev","value":ev},
                 separators=(",",":")).encode("utf8")
 req=urllib.request.Request(BASE+"/control",data=body,method="POST",headers={
   "Content-Type":"application/json",
   "X-S9-Camera-Control-Intent":"explicit-user-selection-v1"})
 with urllib.request.urlopen(req,timeout=12) as response:
  payload=json.loads(response.read(10000))
 if not payload.get("ok") or str(payload.get("value"))!=ev:
  raise RuntimeError("camera_control_change_not_confirmed")
 return payload

def measure()->dict:
 out=[]
 for i in range(SAMPLES):
  s=quality.state()
  if s.get("mode")!="watching" or not s.get("continuous_4k_ready") or (
      not s.get("night_active")):
   raise RuntimeError("night_probe_interrupted_or_4k_unavailable")
  pixels=quality.gray(quality.read("/shot.jpg"))
  out.append(quality.metrics(pixels))
  if i<SAMPLES-1:time.sleep(1.2)
 return {
   "gray":round(statistics.median(x["mean"] for x in out),2),
   "dark":round(statistics.median(x["dark_fraction"] for x in out),3),
   "p90":round(statistics.median(x["p90"] for x in out),1),
   "clipped":round(statistics.median(x["clipped_fraction"] for x in out),3),
   "edge":round(statistics.median(x["local_edge_energy"] for x in out),2)
 }

def restore(previous:str)->bool:
 for attempt in range(15):
  try:
   current=controls().get("exposure_ev",{}).get("value")
   if current==previous:return True
   if quality.state().get("mode")=="watching":
    set_ev(previous)
    if controls().get("exposure_ev",{}).get("value")==previous:return True
  except Exception:pass
  time.sleep(2)
 return False

def main():
 before=quality.state()
 config=controls()
 old=config.get("exposure_ev",{}).get("value")
 if before.get("mode")!="watching" or not before.get("continuous_4k_ready") or (
     before.get("night_mode")!="auto" or not before.get("night_active")
     or before.get("temperature_c",100)>=38.5):
  raise RuntimeError("night_profile_not_in_healthy_watching_state")
 if old!="0":
  raise RuntimeError("manual_exposure_already_changed_no_override")
 if "1" not in config.get("exposure_ev",{}).get("available",[]):
  raise RuntimeError("plus_one_ev_not_supported")
 if config.get("night_effective_ev",0)<1.8:
  raise RuntimeError("existing_plus_two_night_not_active")
 prior_events=before.get("recorded")
 baseline=measure()
 after_set=False
 boosted=None
 boosted_sensor={}
 restored=False
 try:
  if quality.state().get("mode")!="watching":raise RuntimeError("recording_started_before_test")
  set_ev("1")
  after_set=True
  time.sleep(3.2)
  if controls().get("night_effective_ev",0)<2.8:
   raise RuntimeError("plus_three_ev_not_reached")
  boosted=measure()
  boosted_sensor=quality.state()
 finally:
  if after_set:restored=restore(old)
  else:restored=True
 if not restored:
  raise RuntimeError("original_exposure_not_restored_needs_attention")
 final=quality.state()
 if final.get("mode")!="watching" or not final.get("continuous_4k_ready"):
  raise RuntimeError("camera_not_healthy_after_exposure_test")
 if controls().get("exposure_ev",{}).get("value")!=old:
  raise RuntimeError("exposure_did_not_restore")
 if final.get("recorded")!=prior_events:
  comparison="event_during_test_no_clean_comparison"
 else:comparison="same_continuous_observation"
 relative=round(boosted["gray"]/max(1,baseline["gray"]),3)
 dark_delta=round(baseline["dark"]-boosted["dark"],3)
 print("S9_NIGHT_EV3_HEADROOM_V1 "+json.dumps({
  "baseline_plus2":baseline,"temporary_plus3":boosted,
  "relative_preview_brightness":relative,"reduced_dark_fraction":dark_delta,
  "clip_event_consistency":comparison,
  "new_sensor_iso":boosted_sensor.get("sensor_iso"),
  "new_sensor_exposure_ms":boosted_sensor.get("sensor_exposure_ms"),
  "new_sensor_result_fps":boosted_sensor.get("sensor_result_fps"),
  "restored_exposure_ev":old,"restored":restored,
  "camera_4k_ready":final.get("continuous_4k_ready"),
  "camera_mode":final.get("mode"),
  "no_images_or_recordings_saved":True,
  "night_mode":final.get("night_mode"),
  "result":"plus3_visibly_brighter_candidate" if (
      relative>=1.20 and dark_delta>=0.05 and boosted["clipped"]<.06
      and comparison=="same_continuous_observation") else
      "plus3_not_proven_better"
 },sort_keys=True),flush=True)

if __name__=="__main__":main()
