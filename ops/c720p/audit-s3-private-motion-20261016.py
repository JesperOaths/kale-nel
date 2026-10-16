#!/usr/bin/env python3
"""Read-only audit: bedroom S3 privacy, darkness detection and lamp timers.
No camera frames, credentials, clips, face data, or network configuration changes.
"""
import json, pathlib, re, subprocess, hashlib, time, os
H=pathlib.Path("/home/jespern/c720p-home-hub")
D=pathlib.Path("/opt/homeassistant/config")
S3="192.168.178.47:5555"
def run(argv,limit=5000,timeout=15):
 try:
  p=subprocess.run(argv,capture_output=True,text=True,timeout=timeout)
  return {"rc":p.returncode,"text":p.stdout[:limit]}
 except Exception as e:return {"error":type(e).__name__}
def adb(*args,limit=2000):
 return run(["adb","-s",S3,*args],limit=limit,timeout=14)
def lines(path,pattern,maxlines=36):
 try:
  text=path.read_text()
  matches=[v.strip()[:190] for v in text.splitlines() if re.search(pattern,v,re.I)]
  return {"sha256":hashlib.sha256(text.encode()).hexdigest(),"matches":matches[:maxlines]}
 except Exception as e:return {"error":type(e).__name__}
r={"read_only":True,"timestamp":time.time()}
r["s3"]={
 "adb_state":adb("get-state",limit=100),
 "adb_secure":adb("shell","getprop","ro.adb.secure",limit=100),
 "adb_enabled":adb("shell","settings","get","global","adb_enabled",limit=100),
 "adb_port":adb("shell","getprop","service.adb.tcp.port",limit=100),
 "tcp_listeners":adb("shell","netstat","-lnt",limit=4500),
 "packages":adb("shell","pm","list","packages","-3",limit=1100),
}
r["hub_listeners"]=run(["ss","-lnt"],limit=5500)
r["hub_firewall"]=run(["sudo","-n","iptables","-S"],limit=2000)
r["source"]={
 "frontcam":lines(H/"bin/c720p-frontcam-motion-living-lamp.py",
  r"frontcam-motion-v|NIGHT_SHAPE|NORMAL_MOTION|strict_dark|dark_temporal|night_lamp_shape_gate|thresholds|sensitivity|ambient|delta|changed|contour|confirm",80),
 "s3_java":lines(H/"build/s3-onphone/src/nl/kalenel/s3motion/MotionActivity.java",
  r"version=|threshold|sensitivity|lux|dark|contrast|exposure|flash|onPreviewFrame|http|socket|ServerSocket|listen|port|camera",85)
}
a=D/"automations.yaml"
try:
 t=a.read_text()
 def slice_id(id_):
  m=re.search(r"(?m)^- id:\s*['\"]?"+re.escape(id_)+r"['\"]?",t)
  if not m:return None
  segment=t[m.start():]
  end=re.search(r"(?m)^- id:\s*",segment[3:])
  if end:segment=segment[:end.start()+3]
  clean=[]
  for line in segment.splitlines():
   if re.search(r"webhook|token|secret|password|key:|url:|payload",line,re.I):continue
   clean.append(line[:240])
  return "\n".join(clean[:95])[:4800]
 r["automation_living"]=slice_id("c720p_frontcam_motion_living_lamp_v1")
 r["automation_identifiers"]=[v.strip() for v in t.splitlines()
   if re.match(r"\s*- id:",v) and re.search(r"c720p|s3|bedroom|spots|motion",v,re.I)][:65]
 r["automation_timeout_lines"]=[v.strip()[:160] for v in t.splitlines()
   if re.search(r"(minutes:\s*(5|10)|00:0[5-9]:00|00:10:00)",v)][:55]
except Exception as e:r["automation_error"]=type(e).__name__
for svc in ["c720p-frontcam-motion-living-lamp.service","c720p-s3-motion-health.timer"]:
 r[svc]=run(["systemctl","--user","is-active",svc],limit=150)
s=H/"state/frontcam-motion-living-lamp.json"
try:
 d=json.loads(s.read_text())
 r["frontcam_state"]={k:d.get(k) for k in (
  "version","ok","mode","updated_at","ambient_luminance","night_shape_gate_v17",
  "camera_failures","night_shape_gate_ok","normal_motion_v18","dark_confirmed")}
except Exception as e:r["frontcam_error"]=type(e).__name__
print("S3_PRIVACY_MOTION_AUDIT_V1 "+json.dumps(r,separators=(",",":"),sort_keys=True),flush=True)
