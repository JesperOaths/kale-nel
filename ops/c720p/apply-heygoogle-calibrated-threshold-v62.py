#!/usr/bin/env python3
"""C720P calibrated Hey Google sensitivity patch, narrow rollback-safe change.

Adds a dedicated systemd drop-in for the local wake-word service. Defaults to
inspect-only. --apply changes only WAKE_THRESHOLD and restarts only that service.
Never touches Home Assistant, satellites, the microphone, audio sinks or cameras.
"""
from __future__ import annotations
import argparse,json,pathlib,re,subprocess,time,socket
UNIT="c720p-openwakeword-v53e.service"
U=pathlib.Path("/home/jespern/.config/systemd/user")
D=U/(UNIT+".d")
TARGET=D/"99-hybrid-wake-v62.conf"
MODEL=pathlib.Path("/opt/homeassistant/wyoming-openwakeword/custom_models/hey_google.onnx")
EVAL=MODEL.parent/"training_report.json"
CONF="[Service]\nEnvironment=WAKE_THRESHOLD=0.88\nEnvironment=WAKE_TRIGGER_LEVEL=2\nEnvironment=WAKE_REFRACTORY_SECONDS=1.50\n"
def run(*args,timeout=35):
 try:
  p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
  return p.returncode,p.stdout.strip(),p.stderr.strip()[-300:]
 except Exception as e:return 127,"",type(e).__name__
def effective():
 rc,s,e=run("systemctl","--user","show",UNIT,"-p","Environment","--value")
 if rc:raise RuntimeError("cannot_read_service_environment")
 return {k:(re.search(r"(?:^|\s)"+k+r"=([^\s]+)",s).group(1)
            if re.search(r"(?:^|\s)"+k+r"=([^\s]+)",s) else None)
         for k in ("WAKE_THRESHOLD","WAKE_TRIGGER_LEVEL","WAKE_REFRACTORY_SECONDS")}
def healthy():
 status=run("systemctl","--user","is-active",UNIT)[1]
 if status!="active":return False
 try:
  with socket.create_connection(("127.0.0.1",10400),timeout=2) as s:
   s.settimeout(2)
   s.sendall(b'{"type":"describe","data":{}}\n')
   head=bytearray()
   while b"\n" not in head and len(head)<4096:
    data=s.recv(2048)
    if not data:break
    head.extend(data)
   j=json.loads(bytes(head).split(b"\n",1)[0])
   return j.get("type")=="info"
 except Exception:return False
def main():
 p=argparse.ArgumentParser();p.add_argument("--apply",action="store_true")
 args=p.parse_args()
 result={"unit":UNIT,"apply":args.apply,"already_installed":TARGET.is_file(),
         "model_present":MODEL.is_file(),"service_before":healthy()}
 result["environment_before"]=effective()
 try:
  report=json.loads(EVAL.read_text())
  recommended=float(report.get("recommended_wake_threshold"))
  max_negative=float(report.get("max_feature_negative_score"))
  result["recommended_threshold"]=round(recommended,4)
  result["max_observed_feature_negative"]=round(max_negative,4)
 except Exception:
  result["outcome"]="calibration_missing_no_change";print(json.dumps(result));return 2
 if not MODEL.is_file() or not (0.82<recommended<0.94 and max_negative<0.88):
  result["outcome"]="unsafe_calibration_no_change";print(json.dumps(result));return 3
 if TARGET.is_file():
  if TARGET.read_text()!=CONF:
   result["outcome"]="conflicting_newer_config_no_change";print(json.dumps(result));return 4
  if result["environment_before"]["WAKE_THRESHOLD"]=="0.88" and healthy():
   result["outcome"]="already_active";print(json.dumps(result));return 0
 elif result["environment_before"]!={"WAKE_THRESHOLD":"0.97","WAKE_TRIGGER_LEVEL":"2","WAKE_REFRACTORY_SECONDS":"1.50"}:
  result["outcome"]="unexpected_prior_settings_no_change";print(json.dumps(result));return 5
 if not args.apply:
  result["outcome"]="preflight_pass_no_write";print(json.dumps(result));return 0
 D.mkdir(parents=True,exist_ok=True)
 created=not TARGET.exists()
 if created:
  tmp=TARGET.with_suffix(".conf.tmp")
  tmp.write_text(CONF,encoding="utf-8")
  tmp.replace(TARGET)
 try:
  rc,_,e=run("systemctl","--user","daemon-reload")
  if rc:raise RuntimeError("systemd_reload_failed_"+e[:60])
  env=effective()
  if env!={"WAKE_THRESHOLD":"0.88","WAKE_TRIGGER_LEVEL":"2","WAKE_REFRACTORY_SECONDS":"1.50"}:
   raise RuntimeError("new_override_not_effective")
  rc,_,e=run("systemctl","--user","restart",UNIT,timeout=50)
  if rc:raise RuntimeError("restart_failed_"+e[:60])
  for _ in range(18):
   if healthy():break
   time.sleep(1)
  if not healthy():raise RuntimeError("wake_service_not_healthy")
  result["environment_after"]=effective()
  result["service_after"]=True
  result["outcome"]="applied_and_verified"
  print(json.dumps(result))
  return 0
 except Exception as e:
  result["error"]=str(e)
  if created and TARGET.is_file():TARGET.unlink()
  run("systemctl","--user","daemon-reload")
  run("systemctl","--user","restart",UNIT,timeout=50)
  result["environment_after_rollback"]=effective()
  result["service_after_rollback"]=healthy()
  result["outcome"]="rolled_back" if created else "preexisting_override_retained"
  print(json.dumps(result))
  return 6
if __name__=="__main__":
 raise SystemExit(main())
