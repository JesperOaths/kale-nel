#!/usr/bin/env python3
"""Task21: read-only discover whether SD and Drive can supply immutable revision.

Select up to ONE currently referenced, already verified original from each
source. Inspect only metadata: Android stat fields / Drive lsjson --stat --hash.
NEVER open media streams, hash video, disclose names, IDs, checksums, paths,
person labels, OAuth secrets or timestamps. This cannot retro-bind any review.
"""
import argparse
import json
import os
import re
import stat
import subprocess
from pathlib import Path
import urllib.request

BASE=Path("/home/jespern/c720p-home-hub")
STATE=BASE/"state"
CFG=BASE/"config/drive-security-archive.json"
MANUAL=STATE/"s9-manual-recording-links-v1.json"
SD=STATE/"s9-standalone-archive-catalog-v1.json"
DRIVE=STATE/"drive-security-archive.json"
PHONE="192.168.178.250:5555"
SDROOT="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
SDNAME=re.compile(r"motion_[0-9]{13}\.mp4\Z")
DRIVENAME=re.compile(r"[A-Za-z0-9._-]{1,180}\.mp4\Z")
MARK="TASK21_SOURCE_REVISION_CAPABILITIES_V247 "

def read_json(path,limit,private):
 if path.is_symlink() or not path.is_file():raise RuntimeError("private_schema_missing")
 st=path.stat()
 if (not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or
     not 10<st.st_size<=limit or st.st_mode&(0o077 if private else 0o022)):
  raise RuntimeError("private_schema_mode_or_size")
 raw=path.read_bytes()
 if len(raw)!=st.st_size or path.stat().st_mtime_ns!=st.st_mtime_ns:
  raise RuntimeError("source_changed_during_scan")
 return json.loads(raw)

def read_role(path,limit,private,role):
 try:return read_json(path,limit,private)
 except RuntimeError as exc:
  # Authored role names only; no file contents, paths or secret values.
  if str(exc) in ("private_schema_missing","private_schema_mode_or_size",
                  "source_changed_during_scan"):
   raise RuntimeError(role+"_"+str(exc)) from None
  raise RuntimeError(role+"_metadata_unknown") from None

def config_read():
 # This is a shared archive service CONFIG file, not the private manual
 # review/audit store. A 0644 metadata config is readable by the
 # archive's existing worker. Refuse foreign ownership, unsafe parent,
 # symlinks, non-regular, oversized and any group/world WRITE.
 if CFG.is_symlink() or not CFG.is_file():
  raise RuntimeError("rclone_config_private_schema_missing")
 st=CFG.stat();parent=CFG.parent.stat()
 if (not stat.S_ISREG(st.st_mode) or st.st_nlink!=1
    or not 10<st.st_size<=100000 or st.st_uid!=os.geteuid()
    or parent.st_uid!=os.geteuid() or parent.st_mode&0o022
    or st.st_mode&0o022):
  raise RuntimeError("rclone_config_private_schema_mode_or_size")
 return read_role(CFG,100000,False,"rclone_config")

def collect():
 manual=read_role(MANUAL,600000,True,"manual")
 sd=read_role(SD,5000000,False,"sd")
 drive=read_role(DRIVE,6000000,False,"drive")
 cfg=config_read()
 if (manual.get("version")!=1 or not isinstance(manual.get("items"),dict)
     or not isinstance(sd.get("records"),dict) or
     not isinstance(drive.get("items"),list)):
  raise RuntimeError("manual_or_catalog_schema_missing")
 selected={}
 for key in sorted(manual["items"]):
  source,sep,name=key.partition(":")
  if sep!=":" or source in selected:continue
  if source=="sd" and SDNAME.fullmatch(name) and name in sd["records"]:
   selected[source]=name
  if source=="drive" and DRIVENAME.fullmatch(name) and ".." not in name and any(
      isinstance(row,dict) and row.get("remote_name")==name and
      row.get("state")=="verified" and row.get("camera")=="new"
      for row in drive["items"]):
   selected[source]=name
 if set(selected)!={"sd","drive"}:
  raise RuntimeError("source_qualified_review_sample_missing")
 sdrec=sd["records"][selected["sd"]]
 if not isinstance(sdrec,dict):raise RuntimeError("sd_catalog_row_untrusted")
 manifest=sdrec.get("manifest")
 sdproof={"catalog_bytes_valid":type(sdrec.get("bytes")) is int and sdrec["bytes"]>=10000,
  "has_claimed_sha256":isinstance(manifest,dict) and isinstance(manifest.get("sha256"),str) and
    bool(re.fullmatch("[a-f0-9]{64}",manifest["sha256"])),
  "catalog_snapshot_present":isinstance(sd.get("snapshot_id"),str),
  "android_stat_succeeded":False,"phone_file_length_matches":False,
  "android_has_mtime_revision":False}
 cmd=["adb","-s",PHONE,"shell","stat","-c","%s:%Y",SDROOT+"/"+selected["sd"]]
 res=subprocess.run(cmd,capture_output=True,text=True,timeout=24)
 if res.returncode==0 and re.fullmatch(r"\d{4,12}:\d{7,12}",res.stdout.strip()):
  length,mtime=(int(x) for x in res.stdout.strip().split(":"))
  sdproof["android_stat_succeeded"]=True
  sdproof["phone_file_length_matches"]=length==sdrec.get("bytes")
  sdproof["android_has_mtime_revision"]=mtime>1000000000
 drivecfg=cfg.get("folders",{}).get("new",{})
 if (not isinstance(drivecfg,dict) or not isinstance(drivecfg.get("id"),str)
    or not isinstance(cfg.get("remote"),str) or
    not isinstance(cfg.get("rclone_config"),str) or
    not isinstance(cfg.get("rclone"),str)):
  raise RuntimeError("existing_drive_config_untrusted")
 cmd=[cfg["rclone"],"--config",cfg["rclone_config"],"lsjson",
   cfg["remote"]+":"+selected["drive"],"--drive-root-folder-id",
   drivecfg["id"],"--files-only","--stat","--hash"]
 d=subprocess.run(cmd,text=True,capture_output=True,timeout=65)
 fields={"rclone_metadata_succeeded":False,"object_id_available":False,
   "modtime_available":False,"md5_available":False,"size_matches_archive":False,
   "version_token_available":False}
 if d.returncode==0 and len(d.stdout)<150000:
  try:
   result=json.loads(d.stdout)
   if isinstance(result,list) and len(result)==1:result=result[0]
   if isinstance(result,dict):
    row=next(x for x in drive["items"] if isinstance(x,dict)
       and x.get("remote_name")==selected["drive"] and
       x.get("state")=="verified")
    fields["rclone_metadata_succeeded"]=True
    fields["object_id_available"]=isinstance(result.get("ID"),str) and len(result["ID"])>=10
    fields["modtime_available"]=isinstance(result.get("ModTime"),str) and len(result["ModTime"])>=12
    hashes=result.get("Hashes")
    fields["md5_available"]=isinstance(hashes,dict) and any(
        str(k).lower()=="md5" and bool(re.fullmatch("[a-fA-F0-9]{32}",str(v)))
        for k,v in hashes.items())
    fields["size_matches_archive"]=type(result.get("Size")) is int and result["Size"]==row.get("size")
    fields["version_token_available"]=isinstance(result.get("Version"),(str,int)) or (
       isinstance(result.get("Metadata"),dict) and
       isinstance(result["Metadata"].get("version"),(str,int)))
  except (ValueError,TypeError,KeyError,StopIteration):
   pass
 return {"schema_version":"task21_revision_capability_v247",
  "manual_revision_stable":read_json(MANUAL,600000,True).get("revision")==manual.get("revision"),
  "sd":sdproof,"drive":fields,
  "historical_digest_backfilled":False,
  "media_bytes_read":0,"review_decisions_modified":False,
  "camera_apk_or_services_modified":False,
  "no_media_filenames_or_ids_disclosed":True}

if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--run",action="store_true")
 args=p.parse_args()
 if args.run:
  try:
   print(MARK+json.dumps(collect(),sort_keys=True),flush=True)
  except Exception as e:
   permitted={"manual_or_catalog_schema_missing",
    "source_qualified_review_sample_missing","sd_catalog_row_untrusted",
    "existing_drive_config_untrusted"}
   permitted.update(role+"_"+why for role in ("manual","sd","drive","rclone_config")
     for why in ("private_schema_missing","private_schema_mode_or_size",
       "source_changed_during_scan","metadata_unknown"))
   reason=str(e)
   if reason not in permitted:reason="source_metadata_unavailable"
   print("TASK21_REVISION_V247_NOT_VERIFIED "+json.dumps({
      "reason_code":reason,"media_bytes_read":0,
      "reviews_modified":False},sort_keys=True),flush=True)
   raise SystemExit(1)
 else:
  print("TASK21_REVISION_V247_PREVIEW "+json.dumps({
   "metadata_only":True,"phone_video_not_opened":True},sort_keys=True))
