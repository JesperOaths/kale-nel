#!/usr/bin/env python3
"""Transactional, SHA-pinned rollout of private S9+ migrated JPEG playback.

Two preexisting authenticated user services only. No Camera2 restart, no video
or snapshot deletion, no review/index mutations. Preflight is the default.
"""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
BIN=HOME/"bin"
STATE=HOME/"state"
BACKUP=HOME/"backups/security-migrated-jpeg-v177"
OUTER=BIN/"c720p-lan-camera-relay.py"
INNER=BIN/"s9_sd_proxy_extension.py"
MODULE=BIN/"s9_c720p_snapshots_v163.py"
LOCK=STATE/".security-migrated-jpeg-deploy-v177.lock"
OUTER_OLD_SHA="8003ceac8ed4deabfcfeae715568635c971cb2aa93d98f0695b16488d6d538df"
INNER_OLD_SHA="36f042b42237c4691f6a2cde9b695b468552018ccb2d5f178c69b36764574bed"
MODULE_BLOB="29936ef524cc7aed971fdbbdc3ed8ec06ac50e2e"
COMMIT="3ae255039eaf3c8774a4e90ed7c7c75a97ce2df3"
URL="https://raw.githubusercontent.com/JesperOaths/kale-nel/"+COMMIT+"/ops/c720p/s9-person-ml-v1/s9_c720p_snapshots_v163.py"
INNER_ANCHOR=" import s9_c720p_imported_media_api_v1\n s9_c720p_imported_media_api_v1.install(H,play_sd)\n"
INNER_ADD=" # S9_MIGRATED_JPEG_PRIVATE_V177: additive authenticated-loopback handler\n import s9_c720p_snapshots_v163\n s9_c720p_snapshots_v163.install(H)\n"
OUTER_ANCHOR="  # SECURITY_NATIVE_CAMERA2_RELAY_V18: authenticated GET, read-only metadata"
OUTER_ADD=(
 "  # S9_MIGRATED_JPEG_RELAY_V177: authorization already checked above.\n"
 "  m=re.fullmatch(r'/(new)/saved/c720p-migrated/snap/([A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]jpg)',path)\n"
 "  if m:\n"
 "   if '..' in m.group(2) or urllib.parse.urlsplit(self.path).query or self.headers.get('Range'):\n"
 "    return self.empty(400)\n"
 "   return self.archive(m.group(1),'/saved/c720p-migrated/snap/'+urllib.parse.quote(m.group(2)),head)\n"
)
UNITS=(("c720p-drive-security-archive.service",8795),
       ("c720p-lan-camera-relay.service",8794))
class Deferred(RuntimeError):pass

def require(cond,why):
    if not cond:raise Deferred(why)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def gitblob(raw):return hashlib.sha1(("blob "+str(len(raw))+"\0").encode()+raw).hexdigest()

def file_bytes(path):
    require(not path.is_symlink() and path.is_file(),"missing_or_symlinked_live_source")
    return path.read_bytes()

def fixed_patch(source,anchor,new,marker,why):
    require(marker not in source and source.count(anchor)==1,why)
    result=source.replace(anchor,new+anchor,1) if marker=="S9_MIGRATED_JPEG_RELAY_V177" else source.replace(anchor,anchor+new,1)
    compile(result,"v177_patch","exec")
    return result

def service_active(unit):
    r=subprocess.run(["systemctl","--user","show",unit,"-p","ActiveState","-p","MainPID"],
                     capture_output=True,text=True,timeout=8)
    pairs=dict(x.split("=",1) for x in r.stdout.splitlines() if "=" in x)
    return (r.returncode==0 and pairs.get("ActiveState")=="active"
            and int(pairs.get("MainPID","0") or 0)>0)

def camera():
    with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=9) as r:
        d=json.loads(r.read(90_000))
    t=d.get("temperature_c")
    require(d.get("ok") is True and d.get("mode")=="watching"
            and d.get("continuous_4k_ready") is True
            and d.get("continuous_4k_dropped_output_frames")==0
            and type(t) in (float,int) and 0<t<37,"native_4k_not_idle_and_cool")
    return round(t,1)

def inventory(port):
    with urllib.request.urlopen(
         "http://127.0.0.1:"+str(port)+"/new/api/c720p-migrated-clips",
         timeout=9) as r:
        d=json.loads(r.read(100_000))
        require(r.status==200 and d.get("ok") is True
                and d.get("total_imported")==6
                and d.get("total_bytes")==214181934,
                "migrated_mp4_endpoint_changed")
    return True

def read_module_source():
    with urllib.request.urlopen(URL,timeout=35) as r:
        raw=r.read(80_001)
    require(3000<len(raw)<80_000 and gitblob(raw)==MODULE_BLOB,
            "new_module_not_exactly_pinned")
    compile(raw,"s9_c720p_snapshots_v163.py","exec")
    return raw

def prepare():
    require(not LOCK.is_symlink() and STATE.is_dir(),"unsafe_lock_location")
    require(not MODULE.is_symlink(),"module_symlink_refused")
    orig_outer=file_bytes(OUTER);orig_inner=file_bytes(INNER)
    require(digest(orig_outer)==OUTER_OLD_SHA,"outer_live_sha_drift")
    require(digest(orig_inner)==INNER_OLD_SHA,"inner_live_sha_drift")
    outer=fixed_patch(orig_outer.decode(),OUTER_ANCHOR,OUTER_ADD,
                      "S9_MIGRATED_JPEG_RELAY_V177","outer_route_changed").encode()
    inner=fixed_patch(orig_inner.decode(),INNER_ANCHOR,INNER_ADD,
                      "S9_MIGRATED_JPEG_PRIVATE_V177","inner_extension_changed").encode()
    module=read_module_source()
    if MODULE.exists():
        require(file_bytes(MODULE)==module,"module_name_collision")
    require(all(service_active(u) for u,_ in UNITS),"archive_or_relay_not_active")
    require(inventory(8795) and inventory(8794),"existing_playback_failed")
    temp=camera()
    require(os.statvfs(BIN).f_bavail*os.statvfs(BIN).f_frsize>600*1024*1024,
            "root_disk_reserve")
    require(not BACKUP.is_symlink(),"unsafe_backup_root")
    return orig_outer,orig_inner,outer,inner,module,temp

def atomic_write(target,raw,mode):
    fd,tmp=tempfile.mkstemp(prefix=".v177-",dir=target.parent)
    try:
        with os.fdopen(fd,"wb") as f:
            f.write(raw);f.flush();os.fsync(f.fileno())
        os.chmod(tmp,mode)
        os.replace(tmp,target)
        require(target.read_bytes()==raw,"atomic_write_integrity_error")
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def backup(p,raw):
    BACKUP.mkdir(parents=True,exist_ok=True)
    os.chmod(BACKUP,0o700)
    dest=BACKUP/(p.name+"-"+digest(raw)[:14]+".bak")
    require(not dest.exists() and not dest.is_symlink(),"backup_collision")
    fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"wb") as f:
        f.write(raw);f.flush();os.fsync(f.fileno())
    require(dest.read_bytes()==raw,"backup_validation_failed")

def restart_and_wait(unit,port):
    r=subprocess.run(["systemctl","--user","restart",unit],
                     capture_output=True,text=True,timeout=25)
    require(r.returncode==0,"user_service_restart_failed")
    for _ in range(14):
        if service_active(unit):
            try:
                if inventory(port):return
            except (OSError,ValueError,Deferred,urllib.error.HTTPError):pass
        time.sleep(0.7)
    raise Deferred("service_recovery_or_mp4_route_failed")

def jpeg_proof():
    p=MODULE
    spec=importlib.util.spec_from_file_location("s9_c720p_snapshots_v163",p)
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    proof=mod.read_proof()
    require(len(proof)==6 and sum(x["bytes"] for x in proof.values())==1956743,
            "snapshot_proof_not_expected")
    # Every migrated JPEG must pass the same physical GET/HEAD/range proof.
    return sorted(proof.items())

def jpeg_endpoint(port,name,item):
    url="http://127.0.0.1:"+str(port)+"/new/saved/c720p-migrated/snap/"+name
    with urllib.request.urlopen(url,timeout=22) as r:
        body=r.read(5_000_001)
        require(r.status==200 and
                r.headers.get("Content-Type")=="image/jpeg" and
                "no-store" in r.headers.get("Cache-Control","") and
                r.headers.get("Content-Length")==str(item["bytes"]) and
                len(body)==item["bytes"] and
                digest(body)==item["sha256"],
                "jpeg_endpoint_failed_integrity")
    req=urllib.request.Request(url,method="HEAD")
    with urllib.request.urlopen(req,timeout=15) as r:
        require(r.status==200 and
                r.headers.get("Content-Length")==str(item["bytes"])
                and r.read()==b"", "jpeg_head_contract_failed")
    bad=urllib.request.Request(url,headers={"Range":"bytes=0-1"})
    try:
        urllib.request.urlopen(bad,timeout=8)
    except urllib.error.HTTPError as e:
        require(e.code==400,"range_rejection_changed")
    else:raise Deferred("range_accepted_unexpectedly")

def apply():
    with LOCK.open("a+") as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise Deferred("another_route_deployment_active")
        original_outer,original_inner,new_outer,new_inner,module,temp=prepare()
        outer_mode=stat.S_IMODE(OUTER.stat().st_mode)
        inner_mode=stat.S_IMODE(INNER.stat().st_mode)
        backups_ready=False
        modified_inner=False;modified_outer=False;installed_module=False
        try:
            backup(OUTER,original_outer)
            backup(INNER,original_inner)
            backups_ready=True
            if not MODULE.exists():
                atomic_write(MODULE,module,0o600)
                installed_module=True
            require(file_bytes(OUTER)==original_outer
                    and file_bytes(INNER)==original_inner,"source_changed_before_install")
            modified_inner=True
            atomic_write(INNER,new_inner,inner_mode)
            restart_and_wait(UNITS[0][0],8795)
            all_jpegs=jpeg_proof()
            for name,item in all_jpegs:
                jpeg_endpoint(8795,name,item)
            require(camera()<37,"camera_not_safe_before_relay")
            require(file_bytes(OUTER)==original_outer,"outer_source_changed")
            modified_outer=True
            atomic_write(OUTER,new_outer,outer_mode)
            restart_and_wait(UNITS[1][0],8794)
            for name,item in all_jpegs:
                jpeg_endpoint(8794,name,item)
            require(inventory(8795) and inventory(8794),"mp4_playback_regressed")
            after=camera()
            return {"state":"installed_verified","private_snapshots_accessible":6,
                    "source_and_manifest_sha_verified":True,
                    "mp4_browser_route_preserved":True,
                    "camera_temperature_before_c":temp,"camera_temperature_after_c":after,
                    "camera2_restarted":False,"videos_modified":False,
                    "local_snapshots_deleted":False,"manual_reviews_modified":False,
                    "saved_state_modified":False}
        except Exception:
            if backups_ready:
                # Never overwrite another deployer's newer source changes.
                # If the original source is still present, no rollback write is needed.
                if modified_outer and file_bytes(OUTER)==new_outer:
                    atomic_write(OUTER,original_outer,outer_mode)
                    try:restart_and_wait(UNITS[1][0],8794)
                    except Exception:pass
                if modified_inner and file_bytes(INNER)==new_inner:
                    atomic_write(INNER,original_inner,inner_mode)
                    try:restart_and_wait(UNITS[0][0],8795)
                    except Exception:pass
            if installed_module and not modified_inner and MODULE.exists() and file_bytes(MODULE)==module:
                MODULE.unlink()
            print("S9_JPEG_RELAY_V177_ROLLBACK "+json.dumps({
                "outer_original_sha":digest(OUTER.read_bytes())==OUTER_OLD_SHA,
                "inner_original_sha":digest(INNER.read_bytes())==INNER_OLD_SHA,
                "local_media_modified":False,"manual_reviews_modified":False},sort_keys=True))
            raise

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply",action="store_true")
    args=parser.parse_args()
    if args.apply:result=apply()
    else:
        a,b,outer,inner,module,t=prepare()
        result={"state":"preflight","module_pinned":True,
                "existing_proxy_source_shas_verified":True,
                "patched_inner_compiles":True,"patched_outer_compiles":True,
                "temp_c":t,"services_running":True,
                "existing_mp4_playback_unchanged":True,
                "local_media_modified":False}
    print("S9_JPEG_RELAY_V177 "+json.dumps(result,sort_keys=True))

if __name__=="__main__":
    try:main()
    except Deferred as e:
        print("S9_JPEG_RELAY_V177 "+json.dumps({"state":"deferred",
            "reason":str(e),"camera2_modified":False,"local_media_modified":False},
            sort_keys=True));raise SystemExit(2)
    except Exception as e:
        print("S9_JPEG_RELAY_V177 "+json.dumps({"state":"failed",
            "reason":"restricted_validation_or_rollback_failure",
            "camera2_modified":False,"local_media_modified":False},
            sort_keys=True));raise SystemExit(1)
