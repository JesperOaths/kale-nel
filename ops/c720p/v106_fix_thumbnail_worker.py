#!/usr/bin/env python3
from pathlib import Path
import subprocess,py_compile,time,json,os

BASE=Path('/home/jespern/c720p-home-hub')
TH=BASE/'bin/c720p-saved-thumbnailer-v106.py'
UI=Path('/opt/homeassistant/config/www/c720p-drive-saved.html')
SRV=BASE/'bin/c720p-drive-security-archive.py'
RET=BASE/'bin/c720p-drive-value-retention.py'
LOCAL=BASE/'bin/c720p-archive-quota-trim-v869.py'

# Stop the broken first-run thumbnail child spawned by the installer. It has
# already installed all policy/UI files before starting this child.
subprocess.run(['pkill','-f',str(TH)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False)
time.sleep(1)

s=TH.read_text()
if "ARCH=BASE/'state/drive-security-archive.json'" not in s:
    s=s.replace("BASE=HOME/\"c720p-home-hub\"\n", "BASE=HOME/\"c720p-home-hub\"\nARCH=BASE/\"state/drive-security-archive.json\"\nDET=BASE/\"state/person-detection-index.json\"\n",1)
s=s.replace('PLAY="http://127.0.0.1:8795/new/saved/clip/"','PLAY="http://127.0.0.1:8795/new/clip/"')
s=s.replace("for i,x in enumerate(scores[:len(SAMPLE_FRACTIONS)]):",
            "for i,x in enumerate(scores):")
s=s.replace("vals.append((score,dur*SAMPLE_FRACTIONS[i]))",
            "vals.append((score,dur*((i+0.5)/max(1,len(scores)))))")
TH.write_text(s)
py_compile.compile(str(TH),doraise=True)

# Verify the installed V106 policies before running anything.
ls=LOCAL.read_text(); rs=RET.read_text(); ss=SRV.read_text(); us=UI.read_text()
checks={
 "local_v106":"v106-person-protected-elastic" in ls,
 "local_confirmed_gate":"confirmed_person_emergency_cloud_copy" in ls,
 "drive_v106":"v106-person-protected-drive" in rs,
 "drive_confirmed_never_auto_delete":"confirmed_person_auto_delete" in rs and "Never delete" not in rs,
 "server_force_reconcile":"reconcile_remote(cam,True)" in ss,
 "ui_remote_name_delete":"JSON.stringify({remote_name:e.remote_name})" in us,
 "ui_thumb_manifest":"c720p-saved-thumbs/manifest.json" in us,
 "thumbnail_direct_archive_url":'PLAY="http://127.0.0.1:8795/new/clip/"' in s,
 "thumbnail_detector_paths":"ARCH=BASE/" in s and "DET=BASE/" in s,
}
if not all(checks.values()):
    raise SystemExit("V106_VERIFY_FAILED "+json.dumps(checks,sort_keys=True))

# Archive service must be available for thumbnail video reads.
subprocess.run(['systemctl','--user','restart','c720p-drive-security-archive.service'],check=True,timeout=30)

# Safe policy checks. Drive retention is protective and only deletes when Drive
# is below the configured reserve; local retention uses the installed V106 gates.
lr=subprocess.run(['python3',str(LOCAL)],text=True,capture_output=True,timeout=120)
dr=subprocess.run(['python3',str(RET)],text=True,capture_output=True,timeout=180)
if lr.returncode: raise SystemExit("LOCAL_RETENTION_FAILED "+lr.stderr[-1500:])
if dr.returncode: raise SystemExit("DRIVE_RETENTION_FAILED "+dr.stderr[-1500:])

# Generate an initial priority batch: confirmed person first, then likely person,
# then newest other saved clips. The timer will fill the rest progressively.
env=os.environ.copy();env['C720P_THUMB_LIMIT']='36'
tr=subprocess.run(['python3',str(TH)],env=env,text=True,capture_output=True,timeout=720)
if tr.returncode: raise SystemExit("THUMBNAILER_FAILED "+tr.stderr[-2000:])

# Keep recurring fill enabled.
subprocess.run(['systemctl','--user','enable','--now','c720p-saved-thumbnailer-v106.timer'],check=True,timeout=30)
subprocess.run(['systemctl','--user','restart','c720p-home-hub-kiosk.service'],check=False,timeout=25)

manifest=Path('/opt/homeassistant/config/www/c720p-saved-thumbs/manifest.json')
md=json.loads(manifest.read_text()) if manifest.exists() else {}
print(json.dumps({
 "ok":True,
 "checks":checks,
 "local_retention_tail":lr.stdout[-4000:],
 "drive_retention_tail":dr.stdout[-4000:],
 "thumbnail_run":tr.stdout[-5000:],
 "thumbnail_manifest_items":len(md.get("items",{})) if isinstance(md,dict) else 0,
 "timer_active":subprocess.run(['systemctl','--user','is-active','c720p-saved-thumbnailer-v106.timer'],text=True,capture_output=True).stdout.strip(),
},indent=2))
