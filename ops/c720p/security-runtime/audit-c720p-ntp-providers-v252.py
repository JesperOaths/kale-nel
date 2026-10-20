#!/usr/bin/env python3
"""Read-only NTP inventory. No changes to service, time, packages, media or permissions."""
import json, pathlib, shutil, socket, subprocess, time
MARK="C720P_NTP_PROVIDERS_V252 "
PROVIDERS=("systemd-timesyncd","chrony","ntpsec","openntpd")
UNITS=("systemd-timesyncd.service","chrony.service","ntpsec.service","openntpd.service")
CONFIGS=(("/etc/systemd/timesyncd.conf","timesyncd"),
 ("/etc/systemd/timesyncd.conf.d","timesyncd_dropins"),
 ("/etc/chrony/chrony.conf","chrony"),("/etc/ntpsec/ntp.conf","ntpsec"),
 ("/etc/openntpd/ntpd.conf","openntpd"))
HOSTS=("time.cloudflare.com","time.google.com","pool.ntp.org")

def run(cmd,sec=10):
 try:
  p=subprocess.run(cmd,capture_output=True,text=True,timeout=sec)
  return p.returncode,p.stdout[:10000]
 except (OSError,subprocess.TimeoutExpired):return 124,""

def clock():
 rc,out=run(["timedatectl","show","-p","NTP","-p","NTPSynchronized","-p","CanNTP","-p","Timezone"])
 if rc:raise RuntimeError("timedatectl_unavailable")
 vals=dict(line.split("=",1) for line in out.splitlines() if "=" in line)
 if not all(k in vals for k in ("NTP","NTPSynchronized","CanNTP","Timezone")):
  raise RuntimeError("timedatectl_incomplete")
 if vals["Timezone"]!="Europe/Amsterdam":raise RuntimeError("unexpected_timezone")
 return {"timezone_amsterdam":True,"ntp_enabled":vals["NTP"]=="yes",
         "ntp_synchronized":vals["NTPSynchronized"]=="yes",
         "ntp_supported":vals["CanNTP"]=="yes"}

def package(name):
 rc,out=run(["dpkg-query","-W","--showformat="+chr(36)+"{Status}",name],6)
 if rc==0 and out.strip()=="install ok installed":return "installed"
 if rc==1:return "not_installed"
 return "unverified"

def unit(name):
 rc,out=run(["systemctl","show",name,"--property=LoadState,ActiveState,UnitFileState,SubState","--no-pager"],8)
 if rc:return {"status":"unavailable"}
 d=dict(line.split("=",1) for line in out.splitlines() if "=" in line)
 return {k:d.get(k,"unknown")[:32] for k in ("LoadState","ActiveState","UnitFileState","SubState")}

def config(path):
 p=pathlib.Path(path)
 if not p.exists():return {"present":False}
 if p.is_symlink():return {"present":True,"trust":"symlink"}
 if p.is_file():
  st=p.stat()
  if st.st_size>100000:return {"present":True,"trust":"oversized"}
  try:s=p.read_text(errors="replace")
  except OSError:return {"present":True,"readable":False}
  allowed=("NTP","FallbackNTP","RootDistanceMaxSec","PollIntervalMinSec",
           "PollIntervalMaxSec","server","pool","sourcedir","confdir")
  directives=[line for line in s.splitlines() if line.strip()
       and not line.lstrip().startswith("#")
       and line.split("=",1)[0].strip().split(" ",1)[0] in allowed]
  return {"present":True,"readable":True,"directive_count":len(directives),
          "owned_by_root":st.st_uid==0}
 if p.is_dir():return {"present":True,"dropin_entries":min(100,len(list(p.iterdir())))}
 return {"present":True,"trust":"unknown_type"}

def reachable(host):
 try:return bool(socket.getaddrinfo(host,123,socket.AF_INET,socket.SOCK_DGRAM))
 except (OSError,socket.gaierror):return False

def audit():
 return {"status":"read_only_verified","read_only":True,
 "clock":clock(),"provider_packages":{x:package(x) for x in PROVIDERS},
 "provider_units":{x:unit(x) for x in UNITS},
 "config":{tag:config(path) for path,tag in CONFIGS},
 "ntp_dns_resolves":{host:reachable(host) for host in HOSTS},
 "existing_sudo_noninteractive":run(["sudo","-n","-v"],8)[0]==0,
 "root_free_mib":round(shutil.disk_usage("/").free/1048576,1),
 "checked_epoch_hub":int(time.time()),"clock_modified":False,
 "service_modified":False,"packages_modified":False,
 "review_or_media_modified":False,"rollback_material_modified":False}

def main():
 try:report=audit();code=0
 except Exception as error:
  report={"status":"refused","error_type":type(error).__name__,"clock_modified":False,
          "service_modified":False,"review_or_media_modified":False};code=2
 print(MARK+json.dumps(report,sort_keys=True),flush=True)
 return code

if __name__=="__main__":raise SystemExit(main())
