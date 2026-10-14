#!/usr/bin/env python3
"""Read-only S3 bedroom timeout failure investigation (HA container Python).
Only logs named bedroom entities, their recorder history, automation trace
steps, integration availability and optionally relevant timeout diagnostics.
"""
from __future__ import annotations
import sqlite3,json,datetime,pathlib,time
c=sqlite3.connect("file:/config/home-assistant_v2.db?mode=ro",uri=True,timeout=15)
c.row_factory=sqlite3.Row
ids=[
 "light.lsc_smart_connect_gu10_rgb_cct",
 "light.lsc_smart_connect_gu10_rgb_cct_2",
 "light.lsc_smart_connect_gu10_rgb_cct_3",
 "light.c720p_bedroom_main_lamp",
 "light.c720p_ui_bedroom_lights",
 "timer.c720p_s3_bedroom_motion",
 "input_datetime.c720p_s3_bedroom_last_motion",
 "input_boolean.c720p_s3_bedroom_camera_owned",
]
start=datetime.datetime(2026,10,14,8,20,tzinfo=datetime.timezone.utc).timestamp()
end=datetime.datetime(2026,10,14,9,40,tzinfo=datetime.timezone.utc).timestamp()
for entity in ids:
 row=c.execute("select metadata_id from states_meta where entity_id=?",(entity,)).fetchone()
 if not row:
  print("MISSING_ENTITY",entity);continue
 rows=list(c.execute("select s.state,s.last_updated_ts,s.attributes_id,s.context_id_bin,s.context_parent_id_bin from states s where s.metadata_id=? and s.last_updated_ts between ? and ? order by s.last_updated_ts",(row["metadata_id"],start,end)))
 out=[]
 for r in rows:
  when=datetime.datetime.fromtimestamp(r["last_updated_ts"],datetime.timezone(datetime.timedelta(hours=2))).strftime("%H:%M:%S")
  attrs={}
  if r["attributes_id"]:
   a=c.execute("select shared_attrs from state_attributes where attributes_id=?",(r["attributes_id"],)).fetchone()
   if a:
    raw=json.loads(a["shared_attrs"])
    attrs={k:raw.get(k) for k in ("friendly_name","brightness","color_mode","supported_color_modes","integration","restored","assumed_state") if k in raw}
  out.append([when,r["state"],attrs])
 print("ENTITY",entity,json.dumps(out,ensure_ascii=False,default=str))
c.close()
p=pathlib.Path("/config/.storage/trace.saved_traces")
d=json.loads(p.read_bytes()).get("data",{})
for key in ["automation.c720p_s3_bedroom_motion_timeout_v1","automation.c720p_s3_bedroom_spots_v1","automation.c720p_s3_bedroom_manual_external_state_override_v1","automation.c720p_s3_bedroom_manual_ha_service_override_v1"]:
 entries=d.get(key,[])
 print("TRACE_SUMMARY",key,len(entries))
 for i,entry in enumerate(entries[-6:]):
  info={}
  for k in ["last_step","run_id","state","script_execution","timestamp","item_id","date","trace","error","short_id","domain","name","config"]:
   if k in entry:info[k]=(entry[k] if k not in ("trace","config") else str(entry[k])[:1000])
  print("TRACE_ENTRY",key,i,json.dumps(info,default=str,ensure_ascii=False)[:1900])
