#!/usr/bin/env python3
"""Read-only continuity proof for the ALREADY deployed saved-recording Edit people action.

Verifies both the exact static bytes Home Assistant serves and the code that a
temporary, authenticated C720P Chromium Security page can load. It performs
NO person assignment, modal submission, Save/Delete, camera or media writes.
A structural/browser-loaded-source check is NOT a human-review round-trip.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import urllib.request

HERE=Path(__file__).resolve().parent
BASE=HERE/"smoke-c720p-legacy-auth-browser-v136.py"
TARGET=Path("/opt/homeassistant/config/www/frontyard-security-new/security-people-v45.js")
URL="http://127.0.0.1:8123/local/frontyard-security-new/security-people-v45.js"
MARK="C720P_EDIT_PEOPLE_SERVED_BROWSER_V152_VERIFIED "
START="if(item.decision==='approved'){"
END="}else if(['rejected','skipped'].includes(item.decision)){"
ACTION="tools.append(control('＋ Edit people',()=>openApproval(item),'primary'));"
RETURN="tools.append(control('↩ Return to review queue',"
GROUP="selected.length>1?'assign_many'"
MAX=1_000_000

def structure(source):
 if not isinstance(source,str) or source.count(START)!=1 or source.count(END)!=1:
  raise RuntimeError("approved_recording_action_not_unique")
 left=source.index(START)
 right=source.index(END)
 if left>=right:raise RuntimeError("approved_recording_action_order_drift")
 block=source[left:right]
 if (block.count(ACTION)!=1 or block.count(RETURN)!=1
     or source.count(ACTION)!=1 or GROUP not in source
     or "addApprovalPerson" not in source
     or "openApproval(item)" not in block):
  raise RuntimeError("edit_or_group_review_contract_missing")
 return True

def local():
 if TARGET.is_symlink() or not TARGET.is_file():
  raise RuntimeError("served_people_file_untrusted")
 size=TARGET.stat().st_size
 if not 0<size<MAX:raise RuntimeError("served_people_file_unbounded")
 raw=TARGET.read_bytes()
 structure(raw.decode("utf-8"))
 return raw

def served():
 with urllib.request.urlopen(URL+"?v152=readonly",timeout=12) as reply:
  if reply.status!=200:raise RuntimeError("people_js_http_failed")
  data=reply.read(MAX+1)
 if not 0<len(data)<MAX:raise RuntimeError("served_people_js_unbounded")
 structure(data.decode("utf-8"))
 return data

def script():
 # Returns booleans and total size only, never image/person/video data.
 return r"""(async()=>{
  const res=await fetch('/local/frontyard-security-new/security-people-v45.js?v152=readonly',
                        {cache:'no-store'});
  if(res.status!==200)return {ok:false,reason:'people_asset_http_failed'};
  const source=await res.text();
  if(source.length>1000000)return {ok:false,reason:'people_asset_oversized'};
  const start="if(item.decision==='approved'){";
  const end="}else if(['rejected','skipped'].includes(item.decision)){";
  const action="tools.append(control('＋ Edit people',()=>openApproval(item),'primary'));";
  const returning="tools.append(control('↩ Return to review queue',";
  const first=source.indexOf(start),second=source.indexOf(end);
  if(first<0||second<=first||source.indexOf(start,first+1)!==-1||
     source.indexOf(end,second+1)!==-1)
    return {ok:false,reason:'approved_branch_invalid'};
  const body=source.slice(first,second);
  return {ok:true,loaded_security_shell:!!document.getElementById('s9v5-nav'),
    approved_edit_action:body.includes(action)&&source.indexOf(action)===source.lastIndexOf(action),
    separate_return_action:body.includes(returning),
    grouped_assignments_preserved:source.includes("selected.length>1?'assign_many'")&&
      source.includes('addApprovalPerson'),
    loaded_asset_characters:source.length,read_only:true,
    identities_returned:false,signed_urls_returned:false,
    actual_card_click_or_review_write_executed:false};
})()"""

def validate(data):
 if not isinstance(data,dict):raise RuntimeError("browser_people_probe_missing")
 if (data.get("ok") is not True
   or data.get("loaded_security_shell") is not True
   or data.get("approved_edit_action") is not True
   or data.get("separate_return_action") is not True
   or data.get("grouped_assignments_preserved") is not True
   or type(data.get("loaded_asset_characters")) is not int
   or not 1000<data["loaded_asset_characters"]<MAX
   or data.get("read_only") is not True
   or data.get("identities_returned") is not False
   or data.get("signed_urls_returned") is not False
   or data.get("actual_card_click_or_review_write_executed") is not False):
  raise RuntimeError("browser_people_edit_source_not_verified")
 return {"edit_people_action_served":True,"return_to_queue_separate":True,
         "group_picker_structure_retained":True,
         "real_person_review_mutations":0,"browser_card_click_tested":False,
         "live_person_ids_disclosed":False,"current_people_asset_bytes":True}

def run():
 if not BASE.is_file() or BASE.is_symlink():raise RuntimeError("browser_helper_missing")
 before=local()
 if served()!=before:raise RuntimeError("home_assistant_people_asset_not_current")
 spec=importlib.util.spec_from_file_location("c720p_edit_presence_v152",BASE)
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 mod.script=script
 mod.validate_result=validate
 mod.MARK=MARK
 mod.run()
 if local()!=before or served()!=before:
  raise RuntimeError("people_js_changed_during_browser_probe")

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--run",action="store_true")
 args=parser.parse_args()
 try:
  if args.run:run()
  else:
   raw=local()
   if served()!=raw:raise RuntimeError("home_assistant_people_asset_not_current")
   print("C720P_EDIT_PEOPLE_V152_PREFLIGHT "+json.dumps({
    "source_and_served_sha_equal":True,"source_sha256":hashlib.sha256(raw).hexdigest(),
    "group_picker_code_present":True,"camera_modified":False,"reviews_modified":False,
    "browser_not_started":True},sort_keys=True),flush=True)
 except Exception:
  # Never print private exception contents or unsigned browser URLs.
  print("C720P_EDIT_PEOPLE_V152_UNVERIFIED "+json.dumps({
   "read_only":True,"media_modified":False,"reviews_modified":False}),flush=True)
  raise SystemExit(1)

if __name__=="__main__":main()
