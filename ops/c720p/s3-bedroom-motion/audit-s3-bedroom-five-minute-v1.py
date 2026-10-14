#!/usr/bin/env python3
"""Non-mutating HA bedroom S3 occupancy timeline, helpers and trace inventory.
Execute inside the running homeassistant container from stdin. Prints only
three bedroom spot entities, their timer/ownership and related automations.
"""
from __future__ import annotations
import datetime,json,sqlite3,pathlib,sys,time
DB="file:/config/home-assistant_v2.db?mode=ro"
IDS=[
 "light.lsc_smart_connect_gu10_rgb_cct",
 "light.lsc_smart_connect_gu10_rgb_cct_2",
 "light.lsc_smart_connect_gu10_rgb_cct_3",
 "input_boolean.c720p_s3_bedroom_camera_owned",
 "input_datetime.c720p_s3_bedroom_last_motion",
 "input_datetime.c720p_s3_bedroom_camera_started",
 "timer.c720p_s3_bedroom_motion",
 "automation.c720p_s3_motion_camera_owned_bedroom_spots",
 "automation.s3_bedroom_five_minute_camera_only_timeout",
 "automation.s3_bedroom_preserve_explicit_user_light_commands",
 "automation.s3_bedroom_preserve_direct_google_home_and_external_bulb_changes",
]
def iso(t):
 return datetime.datetime.fromtimestamp(t,datetime.timezone.utc).isoformat() if t else None
c=sqlite3.connect(DB,uri=True,timeout=15)
c.row_factory=sqlite3.Row
cutoff=time.time()-75*60
records=[]
for entity in IDS:
 row=c.execute("select metadata_id from states_meta where entity_id=?",(entity,)).fetchone()
 if row is None:
  records.append({"entity":entity,"present":False});continue
 rows=c.execute(
  "select state_id,state,last_updated_ts,last_changed_ts from states where metadata_id=? and last_updated_ts>=? order by state_id desc limit 26",
  (row["metadata_id"],cutoff)).fetchall()
 records.append({"entity":entity,"latest":[{"state":r["state"],"time":iso(r["last_updated_ts"]),"changed":iso(r["last_changed_ts"])} for r in reversed(rows)]})
print("S3_BEDROOM_HA_HISTORY",json.dumps(records,sort_keys=True))
f=pathlib.Path("/config/.storage/trace.saved_traces")
if f.exists():
 d=json.loads(f.read_bytes())
 print("TRACE_KEYS",list(d.keys()),"DATA_TYPE",type(d.get("data")).__name__)
 a=d.get("data")
 if isinstance(a,dict):
  for entity,traces in a.items():
   if "s3_bedroom" not in str(entity) and "bedroom_spot" not in str(entity):continue
   print("TRACE",entity,"COUNT",len(traces) if isinstance(traces,list) else -1)
   for item in (traces[-6:] if isinstance(traces,list) else []):
    trace=item.get("trace",{}) if isinstance(item,dict) else {}
    print("TRACE_ENTRY",json.dumps({"item_id":item.get("item_id"),"date":item.get("date"),
      "state":item.get("state"),"script_execution":item.get("script_execution"),
      "timestamp":trace.get("timestamp"),"condition_result":item.get("condition_result")},default=str)[:1200])
c.close()
