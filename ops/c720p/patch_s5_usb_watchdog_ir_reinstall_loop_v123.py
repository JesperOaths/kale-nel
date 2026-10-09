#!/usr/bin/env python3
"""Prevent unnecessary S5 IR APK reinstalls and adbd resets by USB watchdog."""
from pathlib import Path
import json,datetime,shutil,subprocess,sys
B=Path('/home/jespern/c720p-home-hub/bin')
WATCH=B/'c720p-s5-usb-bootstrap-watch.sh'
REDISC=B/'c720p-s5-rediscover.py'
w=WATCH.read_text();r=REDISC.read_text()
MARK_W='C720P_S5_WIFI_FIRST_WATCH_V123'
MARK_R='C720P_S5_AVOID_APK_REINSTALL_V123'
if MARK_W in w and MARK_R in r:
 print(json.dumps({'ok':True,'already_applied':True}));sys.exit(0)
assert 'systemctl --user start c720p-s5-rediscover.service' in w
w=w.replace('''  systemctl --user start c720p-s5-rediscover.service''','''  # C720P_S5_WIFI_FIRST_WATCH_V123
  # When the trusted S5 is already connected wirelessly, do not restart
  # discovery every 20 seconds; that formerly reinstalled the app and reset
  # ADB, disrupting real-world infrared commands.
  net_target="[fd00::1:7a4b:87ff:fe80:eee0]:5555"
  model="$("$ADB" -s "$net_target" shell getprop ro.product.model 2>/dev/null | tr -d '\\r' || true)"
  serial="$("$ADB" -s "$net_target" shell getprop ro.serialno 2>/dev/null | tr -d '\\r' || true)"
  if [ "$model" = "SM-G900F" ] && [ "$serial" = "$SER" ]; then
    exit 0
  fi
  systemctl --user start c720p-s5-rediscover.service''',1)
assert MARK_W in w
mainanchor=''' result={'timestamp':now,'current_host':curh,'current_port':curp,'prefix':pref,'status':'no_change','candidates':[]}
 # Trusted USB recovery: exact S5 only. Restore legacy network ADB automatically.
 usb=usb_to_network(pref)
'''
mainnew=''' result={'timestamp':now,'current_host':curh,'current_port':curp,'prefix':pref,'status':'no_change','candidates':[]}
 # C720P_S5_AVOID_APK_REINSTALL_V123: an identity-verified IPv6 network
 # session is already the desired state, even when IPv4 subnets differ.
 # In particular, never restart adbd or reinstall the IR APK via USB here.
 if curh.startswith('[') and curh.endswith(']'):
  target=f'{curh}:{curp}'
  healthy,identity=verify(target)
  if healthy:
   result.update(status='healthy_ipv6_network',verified=target,verify=identity)
   atomic_state(result)
   print('S5_REDISCOVER=HEALTHY_IPV6 target='+target)
   return 0
 # Trusted USB recovery: exact S5 only. Restore legacy network ADB automatically.
 usb=usb_to_network(pref)
'''
assert r.count(mainanchor)==1
r=r.replace(mainanchor,mainnew,1)
# Guard against redundant APK updates even when fallback USB discovery occurs.
old=''' if apk.exists():
  install=run(['adb','-s',EXPECTED_SERIAL,'install','-r',str(apk)],45)
  service=run(['adb','-s',EXPECTED_SERIAL,'shell','am','startservice','-n','com.bruis.s5irbridge/.IrHttpService'],10)
'''
new=''' if apk.exists():
  # IR package identity was already checked above; reinstalling it on
  # every recovery pass kills its broadcast receiver and any HTTP service.
  install={'skipped':'trusted_ir_package_already_installed'}
  service=None
'''
assert r.count(old)==1
r=r.replace(old,new,1)
assert r.count(MARK_R)==1
now=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
if '--dry-run' in sys.argv:
 print(json.dumps({'ok':True,'dry_run':True,'watchdog_wifi_first':True,
     'rediscover_wifi_first':True,'no_reinstall_loop':True}))
 sys.exit(0)
back=Path('/home/jespern/c720p-backups')/('s5-reinstall-loop-v123-'+now)
back.mkdir(parents=True,exist_ok=False)
for p in (WATCH,REDISC):shutil.copy2(p,back/(p.name+'.before'))
try:
 for p,s in ((WATCH,w),(REDISC,r)):
  mode=p.stat().st_mode;p.write_text(s);p.chmod(mode)
 cmds=[['bash','-n',str(WATCH)],['python3','-m','py_compile',str(REDISC)]]
 for cmd in cmds:
  z=subprocess.run(cmd,text=True,capture_output=True,timeout=12)
  if z.returncode:raise RuntimeError(str(cmd)+': '+z.stderr)
 print(json.dumps({'ok':True,'installed':True,'backup':str(back),
  'watchdog_fix':MARK_W,'discovery_fix':MARK_R}))
except BaseException:
 for p in (WATCH,REDISC):shutil.copy2(back/(p.name+'.before'),p)
 raise
