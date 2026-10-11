#!/usr/bin/env python3
"""Read-only inspection of root filesystem reserved blocks and available tools.
No privilege escalation, state changes, secret read, or device IO writes.
"""
import json,os,pathlib,shutil,subprocess
from datetime import datetime,timezone
def go(args,seconds=7):
 try:
  q=subprocess.run(args,check=False,capture_output=True,text=True,timeout=seconds)
  return {"exit_code":q.returncode,"stdout":q.stdout[:5500] if q.returncode==0 else "",
          "error_type":"nonzero" if q.returncode else None}
 except Exception as e:return {"error_type":type(e).__name__}
s=os.statvfs("/")
out={"timestamp":datetime.now(timezone.utc).isoformat(timespec="seconds"),
"mode":"read_only","root_total_mb":round(s.f_blocks*s.f_frsize/1048576,1),
"root_available_mb":round(s.f_bavail*s.f_frsize/1048576,1),
"root_privileged_free_mb":round(s.f_bfree*s.f_frsize/1048576,1),
"reserved_mb":round((s.f_bfree-s.f_bavail)*s.f_frsize/1048576,1),
"reserved_fraction_percent":round((s.f_bfree-s.f_bavail)*100/s.f_blocks,2)}
q=go(["findmnt","-n","-o","SOURCE,FSTYPE,OPTIONS","-T","/"])
if q.get("exit_code")==0:
 parts=q["stdout"].strip().split()
 if len(parts)>=2:
  out["source"]=parts[0] if parts[0].startswith("/dev/") else "not_block_device"
  out["filesystem_type"]=parts[1]
  out["read_write"]=("rw" in (parts[2].split(",") if len(parts)>2 else []))
  if parts[1]=="ext4" and parts[0].startswith("/dev/"):
   source=parts[0]
   d=go(["tune2fs","-l",source],seconds=9)
   if d.get("exit_code")==0:
    keep=("Filesystem state","Block count","Reserved block count","Block size",
          "Free blocks","Filesystem features","Default mount options")
    out["ext4"]={}
    for line in d["stdout"].splitlines():
     name,sep,value=line.partition(":")
     if sep and name in keep:
      if name=="Filesystem features":out["ext4"][name]="available"
      else:out["ext4"][name]=value.strip()[:200]
   else:out["ext4"]={"inspect":"unavailable","reason":d.get("error_type")}
 else:out["reason"]="root_is_not_ext4_block_device"
else:out["root_fs_probe"]={"reason":q.get("error_type")}
out["tool_present"]={k:bool(shutil.which(k)) for k in ["findmnt","tune2fs","sudo","df"]}
out["change_performed"]=False
print("C720P_ROOT_EXT4_RESERVE_PREFLIGHT_V1 "+json.dumps(out,sort_keys=True),flush=True)
