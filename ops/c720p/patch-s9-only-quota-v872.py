#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

HOME = Path("/home/jespern")
BASE = HOME / "c720p-home-hub"
BIN = BASE / "bin"
UNIT = HOME / ".config/systemd/user"
STAMP = time.strftime("%Y%m%d_%H%M%S")
BACK = HOME / "c720p-backups" / f"v872-s9-only-quota-{STAMP}"
BACK.mkdir(parents=True, exist_ok=True)

CHANGED: list[str] = []

def backup(path: Path) -> None:
    if path.exists():
        dst = BACK / (path.name + ".before")
        if path.is_dir():
            shutil.copytree(path, dst, dirs_exist_ok=True)
        else:
            shutil.copy2(path, dst)

def sub1(s: str, pat: str, repl: str, label: str, flags: int = 0) -> str:
    ns, n = re.subn(pat, repl, s, count=1, flags=flags)
    if n != 1:
        raise RuntimeError(f"{label}: expected one replacement, got {n}")
    return ns

def patch_file(name: str, fn) -> None:
    p = BIN / name
    backup(p)
    s = p.read_text()
    ns = fn(s)
    p.write_text(ns)
    CHANGED.append(str(p))

def run(args: list[str], check: bool = True, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(args, text=True, capture_output=True, check=check, timeout=timeout)

# Battery state: S9+ only.
def battery_state(s: str) -> str:
    s = s.replace(
        "import json, pathlib, subprocess, time, socket, importlib.util",
        "import json, pathlib, subprocess, time, socket",
    )
    s = sub1(
        s,
        r"SPECS=\{\n.*?\n\}\n",
        """SPECS={
 's9':{'label':'S9+','model':'SM-G965F','serial':'27bb603837047ece','endpoints':['192.168.178.250:5555','192.168.178.47:15555'],'watchdog':pathlib.Path('/home/jespern/c720p-home-hub/state/newcam-adb-pro-watchdog.json'),'role':'new'},
}
""",
        "battery specs",
        re.S,
    )
    s = sub1(
        s,
        r"\ndef read_s3_ipwebcam_battery\(\):\n.*?\n\ndef load_old\(\):",
        "\ndef load_old():",
        "battery retired fallback",
        re.S,
    )
    s = s.replace("  if role not in ('new','s3'):continue", "  if role != 'new':continue")
    s = s.replace(
        "  if not bat and key=='s3':\n   bat=read_s3_ipwebcam_battery(); source='ip_webcam' if bat else ''\n",
        "",
    )
    if "s3" in s.lower():
        raise RuntimeError("phone battery state still contains S3")
    return s

patch_file("c720p-phone-battery-state.py", battery_state)

# Battery notifier: S9+ only.
def notifier(s: str) -> str:
    s = s.replace(
        "ROLE_NAME={'s3':'S3 front-yard camera','new':'New IP camera'}",
        "ROLE_NAME={'new':'S9+ front-yard camera'}",
    )
    if "s3" in s.lower():
        raise RuntimeError("battery notifier still contains S3")
    return s

patch_file("c720p-camera-battery-notifier.py", notifier)

# Return watcher: S9+ only.
def return_watch(s: str) -> str:
    s = s.replace("S3CFG = pathlib.Path('/home/jespern/c720p-security-camera/frontyard-security-config.json')\n", "")
    s = s.replace("RECOVERY_HITS = {'new': 3, 's3': 2}", "RECOVERY_HITS = {'new': 3}")
    specs = """def specs():
    n = loadj(NEWCFG, {})
    neigh = neighbor_ips_by_mac()
    host = str(n.get('camera_host_override') or '').strip()
    mac = str(n.get('camera_mac_hint') or '').lower().strip()
    hosts = []
    for h in [host] + list(neigh.get(mac, [])):
        if usable_neighbor_ip(h) and h not in hosts:
            hosts.append(h)
    return [{
        'name': 'new',
        'hosts': hosts,
        'ports': ports(n),
        'configured_host': host,
        'configured_port': int(n.get('camera_port_override', n.get('camera_port', 8080)) or 8080),
    }]


"""
    s = sub1(s, r"def specs\(\):\n.*?\n\ndef probe\(", specs + "def probe(", "return watcher specs", re.S)
    recover = """def recover(name, endpoint, spec):
    changed = endpoint != (spec['configured_host'], spec['configured_port'])
    if changed:
        start_units(['c720p-newcam-rediscover.service'], 25)
    start_units(['c720p-newcam-profile-guard.service', 'c720p-newcam-health-watchdog.service', 'c720p-newcam-app-persistence-guard.service'], 35)


"""
    s = sub1(s, r"def recover\(name, endpoint, spec\):\n.*?\n\ndef endpoint_text\(", recover + "def endpoint_text(", "return watcher recovery", re.S)
    if "s3" in s.lower():
        raise RuntimeError("return watcher still contains S3")
    return s

patch_file("c720p-camera-return-watch.py", return_watch)

# Two-hour failsafe: S9+ only.
def failsafe(s: str) -> str:
    cams = """CAMS={
 'new':{'mac':'82:a7:90:2b:95:b4','port':8793,'rec':'c720p-frontyard-security-new.service','rediscover':'c720p-newcam-rediscover.service','persist':'c720p-newcam-app-persistence-guard.service','cfg':'/home/jespern/c720p-security-camera-new/frontyard-security-config.json','default':'192.168.178.250'}
}
"""
    s = sub1(s, r"CAMS=\{\n.*?\}\n(?=def log)", cams, "failsafe cameras", re.S)
    s = s.replace(
        "  source = h.get('camera_ok') is True if name=='new' else (recording or (not h.get('last_snapshot_error') and 0<=age<150))",
        "  source = h.get('camera_ok') is True",
    )
    s = s.replace(
        " # Recovery is deliberately headless. Both appliances use IP Webcam Pro.\n # Never force-stop/monkey the UI here: those transitions caused S3 crash loops.\n",
        " # Recovery is deliberately headless; never force-stop the camera UI.\n",
    )
    bp = """def battery_policy(name):
 path=Path('/opt/homeassistant/config/www/c720p-phone-battery.json')
 level=None; stale=True
 try:
  d=json.loads(path.read_text()); x=(d.get('devices') or {}).get('s9') or {}; level=x.get('level'); stale=bool(x.get('stale'))
 except Exception: pass
 try:
  g=json.loads(Path('/home/jespern/c720p-home-hub/state/s9-camera-battery-gate.json').read_text())
  if g.get('camera_allowed') is False:
   gl=g.get('level'); level=gl if isinstance(gl,(int,float)) else level
   return True,(int(level) if isinstance(level,(int,float)) else None),stale,str(g.get('action') or 'gate-hold')
 except Exception: pass
 if stale or not isinstance(level,(int,float)):
  return True,(int(level) if isinstance(level,(int,float)) else None),True,'battery-identity-stale'
 if int(level)<=25:
  return True,int(level),False,'battery<=25'
 return False,int(level),False,'allowed'

"""
    s = sub1(s, r"def battery_policy\(name\):\n.*?\n(?=def main\(\):)", bp, "failsafe battery policy", re.S)
    s = s.replace(" for name in ('new','s3'):", " for name in ('new',):")
    if "s3" in s.lower():
        raise RuntimeError("two-hour failsafe still contains S3")
    return s

patch_file("c720p-camera-twohour-live-failsafe.py", failsafe)

# Drive uploader: scan only current S9+ local source.
def uploader(s: str) -> str:
    s = s.replace(
        "ROOTS={'new':pathlib.Path('/opt/homeassistant/config/www/frontyard-security-new'),'s3':pathlib.Path('/opt/homeassistant/config/www/frontyard-security')}",
        "ROOTS={'new':pathlib.Path('/opt/homeassistant/config/www/frontyard-security-new')}",
    )
    s = s.replace("auto_cam={'new':0,'s3':0}", "auto_cam={'new':0}")
    if "'s3'" in s or '"s3"' in s:
        raise RuntimeError("drive uploader still contains S3")
    return s

patch_file("c720p-drive-security-upload.py", uploader)

# Auto profile: S9+ only.
def auto_profile(s: str) -> str:
    s = s.replace(
        "OVERRIDE_FILES={'new':Path('/home/jespern/c720p-security-camera-new/state/camera-manual-overrides.json'),'s3':Path('/home/jespern/c720p-security-camera/state/camera-manual-overrides.json')}",
        "OVERRIDE_FILES={'new':Path('/home/jespern/c720p-security-camera-new/state/camera-manual-overrides.json')}",
    )
    s = s.replace("'scenemode':'hdr' if cam=='new' else 'night'", "'scenemode':'hdr'")
    s = s.replace(
        "f=str(Path('/opt/homeassistant/config/www/frontyard-security-new/latest.jpg' if cam=='new' else '/opt/homeassistant/config/www/frontyard-security/latest.jpg'))",
        "f='/opt/homeassistant/config/www/frontyard-security-new/latest.jpg'",
    )
    s = s.replace("for cam,port in [('new',8793),('s3',8791)]:", "for cam,port in [('new',8793)]:")
    if "s3" in s.lower():
        raise RuntimeError("auto profile still contains S3")
    return s

patch_file("c720p-camera-auto-profile.py", auto_profile)

# Corruption guard: S9+ only, using real recorder stream on 8793.
def corruption(s: str) -> str:
    s = re.sub(r"^POLICY=.*\n", "", s, count=1, flags=re.M)
    cams = """CAMS={
 's9':dict(port=8793,source='http://127.0.0.1:8793/live.mjpg',serials=['192.168.178.250:5555','27bb603837047ece'],gate='c720p-s9-battery-camera-gate.service',profile='c720p-newcam-profile-guard.service',rec='c720p-frontyard-security-new.service')
}
"""
    s = sub1(s, r"CAMS=\{\n.*?\}\n(?=\ndef run)", cams, "corruption cameras", re.S)
    hold = """def hold(c):
 try:
  g=json.loads(Path('/home/jespern/c720p-home-hub/state/s9-camera-battery-gate.json').read_text())
  return g.get('camera_allowed') is False
 except Exception:
  return False

"""
    s = sub1(s, r"def hold\(c\):\n.*?\n(?=def adb_devices)", hold, "corruption gate", re.S)
    if "s3" in s.lower():
        raise RuntimeError("corruption guard still contains S3")
    return s

patch_file("c720p-camera-corruption-guard.py", corruption)

# Compatibility adapter: the old night-charge path now delegates to the S9 gate.
night = """#!/usr/bin/env python3
import argparse,json
from pathlib import Path

GATE=Path('/home/jespern/c720p-home-hub/state/s9-camera-battery-gate.json')

def state():
    try:
        d=json.loads(GATE.read_text())
    except Exception:
        d={}
    held=d.get('camera_allowed') is False
    return {
        'active':held,
        'reason':str(d.get('action') or ('gate-hold' if held else 'camera-allowed')),
        'level':d.get('level'),
        'camera_allowed':d.get('camera_allowed'),
    }

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--active',choices=['s9'])
    ap.add_argument('--json',action='store_true')
    args=ap.parse_args()
    d=state()
    if args.json: print(json.dumps(d,separators=(',',':')))
    elif args.active: print('1' if d['active'] else '0')
    else: print(json.dumps({'devices':{'s9':d}},indent=2))
    return 0 if (args.active and d['active']) else (1 if args.active else 0)

if __name__=='__main__':
    raise SystemExit(main())
"""
night_path = BIN / "c720p-camera-night-charge-policy.py"
backup(night_path)
night_path.write_text(night)
CHANGED.append(str(night_path))

# Cloud health: S9+ topology only.
def cloud_health(s: str) -> str:
    s = s.replace("        's3_battery_gate':unit('c720p-s3-battery-camera-gate.timer'),\n", "")
    s = s.replace("        's3_profile_guard':unit('c720p-s3-profile-guard.timer'),\n", "")
    s = s.replace(
        "'ports':{str(p):port_open(p) for p in (8123,8791,8793,8794,10200,10300,10400,10701)},",
        "'ports':{str(p):port_open(p) for p in (8123,8793,8794,10200,10300,10400,10701)},",
    )
    s = s.replace("'cameras':{'s3':http_health(8791),'new':http_health(8793)},", "'cameras':{'new':http_health(8793)},")
    helper = """def phone_battery_summary():
    d=json_file('/opt/homeassistant/config/www/c720p-phone-battery.json')
    if not isinstance(d,dict): return d
    dev=d.get('devices') or {}
    return {'updated_at':d.get('updated_at'),'cutoff':d.get('cutoff'),'devices':({'s9':dev.get('s9')} if dev.get('s9') is not None else {})}

"""
    if "def phone_battery_summary()" not in s:
        s = s.replace("def latest_backup():\n", helper + "def latest_backup():\n", 1)
    s = s.replace(
        "'phone_battery':json_file('/opt/homeassistant/config/www/c720p-phone-battery.json',('updated_at','cutoff','devices')),",
        "'phone_battery':phone_battery_summary(),",
    )
    if "s3" in s.lower():
        raise RuntimeError("cloud health reporter still contains S3")
    return s

patch_file("c720p-cloud-health-report.py", cloud_health)

# LAN relay: retain only the explicit 410 retirement sentinel; remove retired upstream/routes.
def relay(s: str) -> str:
    s = s.replace("UP={'new':8793,'s3':8791}; PORT=8794", "UP={'new':8793}; PORT=8794")
    s = s.replace("(new|s3)", "(new)")
    remaining = [line for line in s.splitlines() if "s3" in line.lower()]
    if any("startswith('/s3/')" not in line for line in remaining):
        raise RuntimeError(f"unexpected relay S3 refs: {remaining}")
    return s

patch_file("c720p-lan-camera-relay.py", relay)

# Protected-floor-aware quota trimmer.
quota = r'''#!/usr/bin/env python3
from __future__ import annotations
import json,pathlib,time,os,urllib.request

HOME=pathlib.Path("/home/jespern")
ROOT=pathlib.Path("/opt/homeassistant/config/www/frontyard-security-new")
EVENTS=ROOT/"events.json"
CLIPS=ROOT/"clips"
SNAPS=ROOT/"snapshots"
REPORT={"policy_version":"v872-protected-floor","started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"deleted":[],"stale_index_rows_removed":0}
QUOTA=450*1024*1024
MIN_RECENT=6

def load_events():
    try:
        d=json.loads(EVENTS.read_text())
        if isinstance(d,list):return d,"list",d
        if isinstance(d,dict):
            for k in ("events","items","clips"):
                if isinstance(d.get(k),list):return d[k],k,d
    except Exception as e:REPORT["events_error"]=repr(e)
    return [],"list",[]

def path_for(base,v):
    if not v:return None
    p=pathlib.Path(str(v))
    return p if p.is_absolute() else base/p.name

def event_files(e):
    out=[]
    for base,key in ((CLIPS,"clip"),(SNAPS,"snapshot")):
        p=path_for(base,e.get(key) or e.get(key+"_name"))
        if p and p.exists() and p.is_file():out.append(p)
    return out

def mtime(e):
    vals=[]
    for p in event_files(e):
        try:vals.append(p.stat().st_mtime)
        except Exception:pass
    if vals:return max(vals)
    for k in ("timestamp","created_at","event_timestamp","recorded_at"):
        v=e.get(k)
        if isinstance(v,(int,float)):return float(v)
        if isinstance(v,str):
            try:return time.mktime(time.strptime(v[:19],"%Y-%m-%d %H:%M:%S"))
            except Exception:pass
    return 0.0

def total_bytes():
    n=0
    for base in (CLIPS,SNAPS):
        if not base.exists():continue
        for p in base.iterdir():
            try:
                if p.is_file():n+=p.stat().st_size
            except Exception:pass
    return n

def unique_bytes(events):
    seen=set();n=0
    for e in events:
        for p in event_files(e):
            q=str(p.resolve())
            if q in seen:continue
            seen.add(q)
            try:n+=p.stat().st_size
            except Exception:pass
    return n

events,container_key,container=load_events()
REPORT["events_before"]=len(events)
REPORT["bytes_before"]=total_bytes()

live=[]
for e in events:
    if not bool(e.get("saved")) and not event_files(e):
        REPORT["stale_index_rows_removed"]+=1
        continue
    live.append(e)
events=live

ordered=sorted(events,key=mtime,reverse=True)
protected_newest=ordered[:MIN_RECENT]
protected_ids={id(e) for e in protected_newest}
nondeletable_ids={id(e) for e in events if bool(e.get("saved"))}|protected_ids
nondeletable=[e for e in events if id(e) in nondeletable_ids]
protected_floor_bytes=unique_bytes(nondeletable)
candidates=[e for e in sorted(events,key=mtime) if not bool(e.get("saved")) and id(e) not in protected_ids]
remaining=list(events)

for e in candidates:
    if total_bytes()<=QUOTA:break
    deleted_files=[];freed=0
    for p in event_files(e):
        try:
            sz=p.stat().st_size;p.unlink();freed+=sz;deleted_files.append(str(p))
        except FileNotFoundError:pass
        except Exception as ex:deleted_files.append(str(p)+":ERROR:"+repr(ex))
    if freed>0:
        remaining=[x for x in remaining if x is not e]
        REPORT["deleted"].append({"clip_no":e.get("clip_no"),"saved":False,"freed_bytes":freed,"files":deleted_files})

if len(remaining)!=REPORT["events_before"]:
    newdoc=remaining if container_key=="list" else dict(container)
    if container_key!="list":newdoc[container_key]=remaining
    tmp=EVENTS.with_suffix(".json.tmp-v872")
    tmp.write_text(json.dumps(newdoc,indent=2,ensure_ascii=False)+"\n")
    os.replace(tmp,EVENTS)

after=total_bytes()
remaining_candidates=[e for e in remaining if not bool(e.get("saved")) and id(e) not in protected_ids and event_files(e)]
REPORT.update({
    "events_after":len(remaining),
    "bytes_after":after,
    "quota_bytes":QUOTA,
    "protected_newest":min(MIN_RECENT,len(events)),
    "manual_saved_preserved":sum(1 for e in events if bool(e.get("saved"))),
    "protected_floor_bytes":protected_floor_bytes,
    "effective_quota_bytes":max(QUOTA,protected_floor_bytes),
    "quota_floor_override_active":bool(after>QUOTA and not remaining_candidates),
    "finished_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
})

try:
    token=(HOME/".config/c720p-agent/security-token").read_text().strip()
    payload={"observed_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"maintenance":{"v872_archive_quota_trim":REPORT}}
    req=urllib.request.Request(
      "https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/c720p-security-control?action=health",
      data=json.dumps(payload,separators=(",",":")).encode(),method="POST",
      headers={"content-type":"application/json","x-c720p-token":token})
    with urllib.request.urlopen(req,timeout=20) as r:REPORT["health_post_status"]=r.status
except Exception as e:REPORT["health_post_error"]=repr(e)

print(json.dumps(REPORT,indent=2,sort_keys=True))
'''
quota_path = BIN / "c720p-archive-quota-trim-v869.py"
backup(quota_path)
quota_path.write_text(quota)
os.chmod(quota_path, 0o755)
CHANGED.append(str(quota_path))

# Rename active unit descriptions.
unit_replacements = {
    "c720p-camera-return-watch.service": ("fast dual-camera return transition watcher", "fast S9+ return transition watcher"),
    "c720p-camera-twohour-live-failsafe.service": ("two-hour dual-camera live failsafe", "two-hour S9+ live failsafe"),
    "c720p-camera-corruption-guard.service": ("dual-camera visual corruption detector", "S9+ visual corruption detector"),
}
for name,(old,new) in unit_replacements.items():
    p=UNIT/name
    if p.exists():
        backup(p)
        p.write_text(p.read_text().replace(old,new))

# Remove retired S3 definitions from active user-systemd namespace, after backup.
retired = BACK / "retired-systemd"
retired.mkdir(exist_ok=True)
for p in list(UNIT.glob("c720p-s3-*")) + list(UNIT.glob("c720p-newcam-s3-relay-guard.*")):
    if p.is_dir():
        shutil.copytree(p, retired/p.name, dirs_exist_ok=True)
        shutil.rmtree(p)
    elif p.exists():
        shutil.copy2(p, retired/p.name)
        p.unlink()
for wants in (UNIT/"timers.target.wants", UNIT/"default.target.wants"):
    if wants.exists():
        for p in wants.glob("c720p-s3-*"):
            p.unlink(missing_ok=True)

# Syntax check before running anything.
for raw in CHANGED:
    run(["python3","-m","py_compile",raw],timeout=30)

run(["systemctl","--user","daemon-reload"])
run(["systemctl","--user","reset-failed"],check=False)

# Refresh live state. All commands are idempotent or one-shot health checks.
for unit in (
    "c720p-phone-battery-state.service",
    "c720p-camera-return-watch.service",
    "c720p-archive-quota-trim.service",
):
    run(["systemctl","--user","start",unit],check=False,timeout=120)
run(["systemctl","--user","restart","c720p-lan-camera-relay.service"],timeout=60)
for unit in (
    "c720p-camera-auto-profile.service",
    "c720p-camera-corruption-guard.service",
    "c720p-camera-twohour-live-failsafe.service",
    "c720p-cloud-health-report.service",
):
    run(["systemctl","--user","start",unit],check=False,timeout=150)

print(json.dumps({
    "ok":True,
    "backup":str(BACK),
    "changed":CHANGED,
},indent=2))
