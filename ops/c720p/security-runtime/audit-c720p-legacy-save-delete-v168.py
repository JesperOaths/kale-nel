#!/usr/bin/env python3
"""Identify the actual live legacy Save/Delete control-flow dependencies.

Read-only. Does NOT call endpoints, execute recorder functions, access video
contents, touch S9+ remote storage, restart camera, or change review decisions.
Only fixed operation labels and aggregate counts leave the machine.
"""
import ast
import json
from pathlib import Path
import stat
import urllib.request

SOURCE=Path("/home/jespern/c720p-security-camera-new/c720p-frontyard-security-new.py")
EVENTS=Path("/opt/homeassistant/config/www/frontyard-security-new/events.json")
MARK="C720P_LEGACY_SAVE_DELETE_V168_CONTRACT "

def read(path,maximum):
 if path.is_symlink() or not path.is_file():
  raise RuntimeError("unsafe_runtime_source")
 st=path.stat()
 if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or not 1<st.st_size<=maximum:
  raise RuntimeError("unexpected_source_metadata")
 content=path.read_bytes()
 if len(content)!=st.st_size or path.stat().st_mtime_ns!=st.st_mtime_ns:
  raise RuntimeError("source_changed_during_audit")
 return content

def route(n,name):
 t=n.test if isinstance(n,ast.If) else None
 if not isinstance(t,ast.Compare) or len(t.ops)!=1 or not isinstance(t.ops[0],ast.Eq):
  return False
 if len(t.comparators)!=1 or not isinstance(t.comparators[0],ast.Constant):
  return False
 return (t.comparators[0].value==name and
         isinstance(t.left,ast.Attribute) and t.left.attr=="path" and
         isinstance(t.left.value,ast.Name) and t.left.value.id=="parsed")

def call_name(node):
 fun=node.func
 if isinstance(fun,ast.Name):return fun.id
 if isinstance(fun,ast.Attribute):return fun.attr
 return "other"

def save_field_true(node):
 if not isinstance(node,(ast.Assign,ast.AnnAssign)):return False
 targets=node.targets if isinstance(node,ast.Assign) else [node.target]
 val=node.value
 for t in targets:
  if isinstance(t,ast.Subscript) and isinstance(t.slice,ast.Constant) and t.slice.value=="saved":
   if isinstance(val,ast.Constant) and val.value is True:return True
 return False

def unlink_missing_ok(node):
 return any(k.arg=="missing_ok" and isinstance(k.value,ast.Constant) and
    k.value.value is True for k in node.keywords)

def summarize(source):
 try:tree=ast.parse(source.decode("utf-8"))
 except (UnicodeError,SyntaxError):raise RuntimeError("live_python_syntax_invalid") from None
 parts={}
 for key in ("/save","/delete"):
  matches=[n for n in ast.walk(tree) if route(n,key)]
  if len(matches)!=1:
   raise RuntimeError("legacy_route_missing_or_ambiguous")
  parts[key]=matches[0]
 save=parts["/save"];delete=parts["/delete"]
 save_nodes=[n for statement in save.body for n in ast.walk(statement)]
 delete_nodes=[n for statement in delete.body for n in ast.walk(statement)]
 save_calls=[call_name(n) for n in save_nodes if isinstance(n,ast.Call)]
 delete_calls=[call_name(n) for n in delete_nodes if isinstance(n,ast.Call)]
 unlink_calls=[n for n in delete_nodes if isinstance(n,ast.Call) and call_name(n)=="unlink"]
 if not (any(save_field_true(n) for n in save_nodes) and "save_index" in save_calls
         and unlink_calls and "save_index" in delete_calls):
  raise RuntimeError("legacy_save_delete_expected_contract_changed")
 known=("save_index","unlink","exists","is_file","startswith","json",
        "urlencode","urlparse","write","read","send_response","respond",
        "pop","append","remove","request","open","join","basename")
 save_types=sorted(set(x for x in save_calls if x in known))
 delete_types=sorted(set(x for x in delete_calls if x in known))
 external_calls=({"urlopen","Request","adb","subprocess","send_to_s9",
                  "remote_delete","remote_save"})
 return {
  "legacy_save_route_exactly_once":True,
  "legacy_delete_route_exactly_once":True,
  "save_marks_event_saved_true":True,
  "save_persists_index_locally":True,
  "delete_unlinks_local_files":True,
  "delete_unlink_calls":len(unlink_calls),
  "delete_handles_missing_local_with_missing_ok":all(unlink_missing_ok(c) for c in unlink_calls),
  "delete_rewrites_event_index":True,
  "save_has_direct_remote_call":bool(external_calls.intersection(save_calls)),
  "delete_has_direct_remote_call":bool(external_calls.intersection(delete_calls)),
  "save_operation_types":save_types,
  "delete_operation_types":delete_types,
  "remote_save_delete_compatibility_demonstrated":False,
  "local_originals_retention_required":True,
  "no_save_or_delete_executed":True,
  "no_media_or_review_writes":True,
 }

def catalog():
 doc=json.loads(read(EVENTS,3_000_000))
 if isinstance(doc,dict):
  doc=next((doc[k] for k in ("events","items","clips")
            if isinstance(doc.get(k),list)),None)
 if not isinstance(doc,list) or len(doc)>10000:
  raise RuntimeError("legacy_events_catalog_schema_untrusted")
 n=0;saved=0
 for e in doc:
  if not isinstance(e,dict):continue
  if not isinstance(e.get("clip"),str):continue
  n+=1
  if e.get("saved") is True:saved+=1
 return {"catalog_total_clip_references":n,"catalog_saved_clip_references":saved}

def camera():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=10) as r:
  if r.status!=200:raise RuntimeError("camera_status_unavailable")
  raw=r.read(65537)
 if len(raw)>65536:raise RuntimeError("camera_status_unbounded")
 d=json.loads(raw)
 if (d.get("ok") is not True or d.get("mode")!="watching"
  or d.get("native_4k_enabled") is not True
  or d.get("continuous_4k_ready") is not True
  or d.get("continuous_4k_dropped_output_frames")!=0
  or d.get("continuous_4k_error")
  or type(d.get("temperature_c")) not in (float,int)
  or not 0<d["temperature_c"]<=39.5):
  raise RuntimeError("camera_capture_unhealthy")
 return d["temperature_c"]

if __name__=="__main__":
 try:
  before=camera()
  report=summarize(read(SOURCE,500_000))
  report.update(catalog())
  report["capture_temperature_after_c"]=camera()
  report["capture_zero_drops_before_after"]=True
  print(MARK+json.dumps(report,sort_keys=True),flush=True)
 except Exception:
  print("C720P_LEGACY_SAVE_DELETE_V168_UNVERIFIED "+
    json.dumps({"retirement_approved":False,
                "no_media_modified":True},sort_keys=True),flush=True)
  raise SystemExit(1)
