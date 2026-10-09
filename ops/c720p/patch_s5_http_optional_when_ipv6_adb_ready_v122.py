#!/usr/bin/env python3
"""Stop one-minute S5 APK reinstall retries while verified IPv6 ADB IR works."""
from pathlib import Path
import datetime,json,shutil,subprocess,sys
P=Path('/home/jespern/c720p-home-hub/bin/c720p-s5-http-companion-recover.py')
s=P.read_text()
MARK='C720P_S5_HTTP_OPTIONAL_WHEN_IPV6_ADB_READY_V122'
if MARK in s:
 print(json.dumps({'ok':True,'already_applied':True}));sys.exit(0)
anchor='''ok,detail=http_ok()
if ok:
'''
inject='''# C720P_S5_HTTP_OPTIONAL_WHEN_IPV6_ADB_READY_V122
# The original companion cannot start an Android 11 background service as
# shell when the APK has no exported launcher. Do not re-install it every
# minute when the trusted S5 IR receiver is already usable via wireless ADB.
# Keep the distinction honest: HTTP is NOT marked ready.
V6_TARGET="[fd00::1:7a4b:87ff:fe80:eee0]:5555"
run(["adb","connect",V6_TARGET],7)
if verify(V6_TARGET):
    pkg=run(["adb","-s",V6_TARGET,"shell","pm","path","com.bruis.s5irbridge"],7)
    if pkg and pkg.returncode==0 and "package:" in pkg.stdout:
        STATE.parent.mkdir(parents=True,exist_ok=True)
        STATE.write_text(json.dumps({
            "ok":False,
            "state":"http_optional_wireless_ir_operational",
            "http_ready":False,
            "network_adb_ok":True,
            "target":V6_TARGET,
            "ir_package_ok":True,
            "at":time.time(),
        },indent=2)+"\\n")
        raise SystemExit(0)

ok,detail=http_ok()
if ok:
'''
assert s.count(anchor)==1
s=s.replace(anchor,inject,1)
assert s.count(MARK)==1
if '--dry-run' in sys.argv:
 print(json.dumps({'ok':True,'dry_run':True,'network_skip':True,'http_truthful':True}));sys.exit(0)
stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
backup=Path('/home/jespern/c720p-backups')/('s5-http-optional-v122-'+stamp)
backup.mkdir(parents=True,exist_ok=False)
shutil.copy2(P,backup/(P.name+'.before'))
try:
 m=P.stat().st_mode
 P.write_text(s);P.chmod(m)
 p=subprocess.run(['python3','-m','py_compile',str(P)],capture_output=True,text=True,timeout=12)
 if p.returncode:raise RuntimeError(p.stderr)
except BaseException:
 shutil.copy2(backup/(P.name+'.before'),P)
 raise
print(json.dumps({'ok':True,'patch':'V122','backup':str(backup)},indent=2))
