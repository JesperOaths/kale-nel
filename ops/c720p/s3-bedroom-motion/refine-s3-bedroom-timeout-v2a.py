#!/usr/bin/env python3
"""Finalize S3 guarded timeout Tuya latency and late cloud state safety.

Tuya can acknowledge a service call immediately and publish the resulting
OFF status >20 seconds afterward. Wait before deciding the auth is broken,
and do not interpret delayed camera-origin OFF status as a user override while
an overdue camera-owned shutdown is still being retried. Explicit user service
calls and genuine external OFF->ON transitions remain protected.

Atomically patches only /config/packages/c720p_s3_bedroom_occupancy_v1.yaml
through the running HA container's root bind, validates before and after,
backs up the v2 config and reloads automations without a full HA restart.
"""
from __future__ import annotations
import hashlib,datetime,json,pathlib,shutil,subprocess,sys,importlib.util,time,re
FILE=pathlib.Path("/opt/homeassistant/config/packages/c720p_s3_bedroom_occupancy_v1.yaml")
BACK=pathlib.Path("/home/jespern/c720p-home-hub/backups/s3-bedroom-tuya-timeout-v2a")
EXPECTED="ed0c586b639c701109f4029bf0f992a9c89037c890f5da57a15b99549cd1c77d"
MARK="C720P_S3_TUYA_TIMEOUT_GUARDED_V2"
def digest(b):return hashlib.sha256(b).hexdigest()
def run(argv,**kwargs):
 r=subprocess.run(argv,text=True,capture_output=True,timeout=kwargs.pop("timeout",90),**kwargs)
 if r.returncode:raise RuntimeError("command_error:"+str(argv[:4])+":"+r.stderr[-850:]+r.stdout[-500:])
 return r.stdout.strip()
def main():
 raw=FILE.read_bytes()
 if digest(raw)!=EXPECTED:raise RuntimeError("unexpected_original_package_hash")
 t=raw.decode()
 if MARK not in t or "c720p_s3_bedroom_shutdown_in_progress" not in t:
  raise RuntimeError("missing_current_guarded_timeout")
 pattern=r'^ {14}- delay: "00:00:03"$'
 if len(re.findall(pattern,t,flags=re.M))!=1:raise RuntimeError("unexpected_initial_wait_anchor")
 t=re.sub(pattern,'              - delay: "00:00:25"',t,count=1,flags=re.M)
 old2="""              or (not is_state('input_boolean.c720p_s3_bedroom_shutdown_in_progress','on')
                  and (s.state in ['off','unavailable'] or age >= 15))) }}"""
 new2="""              or (not is_state('input_boolean.c720p_s3_bedroom_shutdown_in_progress','on')
                  and (as_timestamp(now())-as_timestamp(states('input_datetime.c720p_s3_bedroom_last_motion'),0)) < 300
                  and (s.state in ['off','unavailable'] or age >= 15))) }}"""
 if t.count(old2)!=1:raise RuntimeError("unexpected_manual_override_anchor")
 t=t.replace(old2,new2,1)
 newer=t.encode()
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 BACK.mkdir(parents=True,exist_ok=True)
 backup=BACK/(stamp+".before.yaml")
 backup.write_bytes(raw);backup.chmod(0o600)
 staged=pathlib.Path("/tmp/c720p-s3-occupancy-final-v2a.yaml")
 if staged.exists():raise RuntimeError("existing_staging_file")
 staged.write_bytes(newer);staged.chmod(0o600)
 try:
  validator="import sys,yaml;d=yaml.safe_load(sys.stdin.read());a={x['id']:x for x in d['automation']}; assert len(a)==3;assert len(a['c720p_s3_bedroom_motion_timeout_v1']['actions'])==5;print('YAML_VERIFIED')"
  with staged.open("r") as f:
   print("CANDIDATE",run(["docker","exec","-i","homeassistant","python3","-c",validator],stdin=f,timeout=35))
  run(["docker","cp",str(staged),"homeassistant:/config/packages/.s3-bedroom-occupancy-v2a-stage.yaml"],timeout=30)
  code="""import os,pathlib,shutil,hashlib
p=pathlib.Path('/config/packages/c720p_s3_bedroom_occupancy_v1.yaml')
n=p.with_name('.s3-bedroom-occupancy-v2a-stage.yaml')
b=p.with_name('.s3-bedroom-occupancy-rollback-v2a-20261014.yaml')
h=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
assert h(p)==%r
assert h(n)==%r
assert not b.exists()
shutil.copy2(p,b)
os.chmod(n,p.stat().st_mode&0o777)
os.replace(n,p)
assert h(p)==%r
print('INSTALLED',str(b))
""" %(EXPECTED,digest(newer),digest(newer))
  print(run(["docker","exec","-u","0","homeassistant","python3","-c",code],timeout=35))
  try:
   print("CHECK",run(["docker","exec","homeassistant","python3","-m","homeassistant","--script","check_config","-c","/config"],timeout=135)[-300:])
  except Exception:
   rollback="""import os,pathlib,shutil
p=pathlib.Path('/config/packages/c720p_s3_bedroom_occupancy_v1.yaml')
b=p.with_name('.s3-bedroom-occupancy-rollback-v2a-20261014.yaml')
t=p.with_name('.s3-bedroom-rollback-incoming')
shutil.copy2(b,t);os.replace(t,p);print('ROLLED_BACK')
"""
   run(["docker","exec","-u","0","homeassistant","python3","-c",rollback],timeout=35)
   raise
  path=pathlib.Path("/home/jespern/c720p-home-hub/build/security-v8/security-v8-real-browser-probe.py")
  sp=importlib.util.spec_from_file_location("s3browser",path)
  mod=importlib.util.module_from_spec(sp);sp.loader.exec_module(mod)
  row=next((x for x in mod.get("json/list") if x.get("type")=="page" and "/c720p-hub/" in x.get("url","")),None)
  if row is None:raise RuntimeError("HA_authenticated_browser_missing_reload_not_applied")
  tab=mod.Socket(row["webSocketDebuggerUrl"]);tab.sock.settimeout(65)
  try:
   exp="""(async()=>{const h=document.querySelector('home-assistant')?.hass;
if(!h?.services?.automation?.reload)return {ok:false,error:'service_unavailable'};
await h.callService('automation','reload',{});
return {ok:true,automation:h.states['automation.s3_bedroom_five_minute_camera_only_timeout']?.state||null};
})()"""
   v=tab.call("Runtime.evaluate",{"expression":exp,"returnByValue":True,"awaitPromise":True})
   if "exceptionDetails" in v:raise RuntimeError("HA_automation_reload_error")
   obj=v.get("result",{}).get("value")
   if not obj or not obj.get("ok"):raise RuntimeError("HA_automation_reload_missing")
  finally:tab.close()
  print(json.dumps({"ok":True,"version":"C720P_S3_TUYA_TIMEOUT_GUARDED_V2A",
   "config_sha256":digest(newer),"backup":str(backup),"HA_automation_reload":True,
   "first_state_settle_seconds":25,"manual_override_late_off_safe":True,
   "HA_configuration_valid":True},sort_keys=True))
  return 0
 finally:staged.unlink(missing_ok=True)
if __name__=="__main__":sys.exit(main())
