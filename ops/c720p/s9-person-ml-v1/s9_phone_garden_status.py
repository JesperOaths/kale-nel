"""Read-only S9+ on-phone GPU person-gate metadata for authenticated Security.

No image/video bytes or local image-model inference are processed on C720P.
The on-phone Camera2 app owns all actual garden-region model inference.
"""
import json
import threading
import time
import urllib.request

_URL="http://127.0.0.1:18808/status"
_LOCK=threading.Lock()
_LAST_COUNT=None
_LAST_CHANGED_AT=0

def from_phone(phone,now_ms=None):
    global _LAST_COUNT,_LAST_CHANGED_AT
    if now_ms is None:now_ms=int(time.time()*1000)
    if (not isinstance(phone,dict) or phone.get("ok") is not True or
        phone.get("mode") not in ("watching","recording") or
        phone.get("motion_detector")!="garden_roi_gpu_person_gate_v1" or
        int(phone.get("last_frame_age_ms",999999))>9000):
        raise ValueError("on_phone_garden_model_unavailable")
    checked=int(phone.get("garden_person_gate_checked",0))
    matched=int(phone.get("garden_person_gate_matches",0))
    rejected=int(phone.get("garden_person_gate_rejected",0))
    failures=int(phone.get("garden_person_gate_errors",0))
    if min(checked,matched,rejected,failures)<0 or matched>checked or rejected>checked:
        raise ValueError("invalid_native_detector_counters")
    try:score=float(phone.get("garden_person_gate_last_score") or 0)
    except (ValueError,TypeError):score=0
    if not 0<=score<=1:score=0
    with _LOCK:
        if checked!=_LAST_COUNT:
            _LAST_COUNT=checked
            _LAST_CHANGED_AT=now_ms if checked>0 else 0
        age=now_ms-_LAST_CHANGED_AT if _LAST_CHANGED_AT else None
    recent=age is not None and 0<=age<=9000
    likely=recent and score>=0.44
    return {
      "ok":True,"version":"s9-phone-garden-gpu-v2","read_only":True,
      "label_is_ground_truth":False,"on_phone_gpu_inference":True,
      "hub_frame_decoding":False,"last_sample_at_ms":now_ms,
      "last_sample_age_ms":0,"samples":checked,"failures":failures,
      "camera_mode":phone["mode"],"camera_temperature_c":phone.get("temperature_c"),
      "motion_changed_ratio":phone.get("changed_ratio"),
      "motion_coherent_cells":phone.get("coherent_cells"),
      "garden_zone":phone.get("garden_zone","unknown"),
      "model_check_age_ms":age,
      "status":{
        "kind":"person_likely_candidate" if likely else
          ("no_object_detected" if recent else "garden_waiting_for_motion"),
        "person_score":round(score,4) if recent else None,
        "vehicle_score":None,"animal_score":None,
        "simultaneous_people":None,
        "person_checks":checked,"person_matches":matched,
        "person_rejects":rejected,"motion_priority":bool(phone.get("priority_motion")),
        "motion_events_since_service_start":int(phone.get("motion_events") or 0),
        "identity":"not_evaluated","source":"S9+ local SSD MobileNet GPU garden gate"
      },"recent_candidate_transitions":[]}

def read_report():
    with urllib.request.urlopen(_URL,timeout=5) as response:
        blob=response.read(16001)
        if response.status!=200 or len(blob)>16000:
            raise ValueError("unavailable_or_oversize_phone_status")
    return from_phone(json.loads(blob))

def unavailable():
    return {"ok":False,"version":"s9-phone-garden-gpu-v2","read_only":True,
     "on_phone_gpu_inference":True,"hub_frame_decoding":False,
     "label_is_ground_truth":False,
     "status":{"kind":"sensor_unavailable","identity":"not_evaluated"}}
