#!/usr/bin/env python3
"""One-attempt, rollback-safe S9+ 7-second 4K release, only in a cool idle window.

This does not change stored videos, purge policy, person decisions or HA pages.
All checks fail closed. A failed/ambiguous attempted rollout is never retried
automatically: preserve the original signed APK and investigate its evidence.
"""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request
import zipfile

HOME=Path("/home/jespern/c720p-home-hub")
RELEASE=HOME/"releases/s9-native-7s-superset-3adf1c7c512f"
CANDIDATE=RELEASE/"candidate.apk"
ROLLBACK=RELEASE/"rollback-exact-current.apk"
ATTEST=RELEASE/"attestation.json"
STATE=HOME/"state"
RESULT=STATE/"s9-native-seven-second-rollout-v1.json"
LOCK=STATE/".s9-native-seven-second-rollout.lock"
SOURCE_SHA="3adf1c7c512f1cc5f3abc31d424e7d8c4577d1a2"
NEW_SHA="37091d542b8708db26f520a67af8a4edbb687c80d2b24c01d87bf1a2d8b5d059"
OLD_SHA="c8c291218e0048a3a65a01f5a8747da11b3ffb87430e1638606b1545cf6a5e8a"
SIGNER="0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5"
PHONE="192.168.178.250:5555"
PACKAGE="nl.kalenel.s9security"
URL="http://127.0.0.1:18808/status"
TEMP_START_MAX=36.7
TEMP_POST_MAX=39.0
SD_MIN_BYTES=20*1024**3
ROOT_MIN_BYTES=650*1024**2
SCHEMA="s9_native_7s_cool_rollout_v1"
JAVA_PREFIX="ops/c720p/s9-native-security/src/nl/kalenel/s9security/"

def run(argv,timeout=40):
    p=subprocess.run(argv,text=True,capture_output=True,timeout=timeout)
    if p.returncode:raise RuntimeError("command_failed:"+str(argv[:3])+":"+p.stderr[-170:])
    return p.stdout.strip()
def adb(*args,timeout=40):
    return run(["adb","-s",PHONE,*args],timeout)
def sha_file(path):
    with path.open("rb") as f:
        h=hashlib.sha256()
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()
def camera():
    with urllib.request.urlopen(URL,timeout=9) as r:
        if r.status!=200:raise RuntimeError("native_camera_http_status")
        return json.load(r)
def healthy(s,pre=False):
    t=s.get("temperature_c")
    return (s.get("ok") is True and s.get("mode")=="watching"
        and s.get("native_4k_enabled") is True
        and s.get("continuous_4k_ready") is True
        and s.get("continuous_4k_trial_active") is True
        and s.get("continuous_4k_production_persisted") is True
        and type(t) in (int,float) and 0<t<(TEMP_START_MAX if pre else TEMP_POST_MAX)
        and type(s.get("continuous_4k_buffered_ms")) is int
        and s["continuous_4k_buffered_ms"]>=6500
        and s.get("continuous_4k_dropped_output_frames")==0
        and s.get("garden_person_gate_backend")=="gpu"
        and s.get("garden_person_gate_ready") is True
        and type(s.get("last_frame_age_ms")) is int
        and 0<=s["last_frame_age_ms"]<2000
        and type(s.get("sd_free_bytes")) is int
        and s["sd_free_bytes"]>=SD_MIN_BYTES)
def enough_disk():
    s=os.statvfs(str(HOME))
    return s.f_bavail*s.f_frsize>=ROOT_MIN_BYTES
def check_approval():
    for path in (CANDIDATE,ROLLBACK,ATTEST):
        if path.is_symlink() or not path.is_file():raise RuntimeError("unsafe_release_path")
    if sha_file(CANDIDATE)!=NEW_SHA or sha_file(ROLLBACK)!=OLD_SHA:
        raise RuntimeError("release_or_rollback_changed")
    conf=json.loads(ATTEST.read_text())
    if (conf.get("source_sha")!=SOURCE_SHA or conf.get("candidate_sha256")!=NEW_SHA or
        conf.get("rollback_sha256")!=OLD_SHA or conf.get("signer_sha256")!=SIGNER or
        conf.get("assets_native_manifest_unchanged") is not True):
        raise RuntimeError("wrong_release_attestation")
    for apk in (CANDIDATE,ROLLBACK):
        if SIGNER not in run(["apksigner","verify","--print-certs",str(apk)],30):
            raise RuntimeError("signed_apk_identity_changed")
    with zipfile.ZipFile(CANDIDATE) as after,zipfile.ZipFile(ROLLBACK) as before:
        old={n for n in before.namelist() if n=="AndroidManifest.xml" or n.startswith(("assets/","lib/"))}
        new={n for n in after.namelist() if n=="AndroidManifest.xml" or n.startswith(("assets/","lib/"))}
        if old!=new or any(hashlib.sha256(before.read(n)).digest()!=hashlib.sha256(after.read(n)).digest() for n in old):
            raise RuntimeError("model_native_manifest_drift")
    if not enough_disk():raise RuntimeError("root_space_below_safe_margin")
def current_apk_sha():
    names=adb("shell","pm","path",PACKAGE,timeout=25).splitlines()
    paths=[x.partition(":")[2].strip() for x in names
           if x.startswith("package:") and x.endswith("base.apk")]
    if len(paths)!=1:raise RuntimeError("ambiguous_installed_camera_package")
    digest=adb("shell","sha256sum",paths[0],timeout=25).split()[0]
    if len(digest)!=64:raise RuntimeError("invalid_installed_camera_digest")
    return digest
def main_java_source_has_not_changed():
    # GitHub public compare is a READ-ONLY code-drift interlock, not an
    # executable remote update. Ignore UI/docs commits, reject ANY newer
    # native Java source. Network failures defer rather than bypass this gate.
    url=("https://api.github.com/repos/JesperOaths/kale-nel/compare/"
         +SOURCE_SHA+"...main")
    req=urllib.request.Request(url,headers={
        "Accept":"application/vnd.github+json","User-Agent":"S9-7s-safe-upgrade-source-interlock/1"})
    with urllib.request.urlopen(req,timeout=18) as r:
        if r.status!=200:raise RuntimeError("git_source_status_unavailable")
        raw=r.read(2500000)
        if len(raw)>=2500000:raise RuntimeError("git_source_compare_unbounded")
    data=json.loads(raw)
    if (data.get("status") not in ("ahead","identical") or
        data.get("behind_by") not in (0,None) or data.get("too_large")):
        raise RuntimeError("source_tree_diverged")
    changed=[x["filename"] for x in data.get("files",[])
             if x.get("filename","").startswith(JAVA_PREFIX)
             and x["filename"].endswith(".java")]
    if changed:raise RuntimeError("newer_camera_java_source_detected")
def competing():
    for name in ("c720p-s9-face-v5-cool-window.service",
                 "c720p-s9-original-hash-ledger-v1.service",
                 "c720p-s9-standalone-catalog.service",
                 "c720p-s9-recovery-playback-smoke-v1.service",
                 "c720p-s9-auxiliary-recovery-refresh-v1.service"):
        p=subprocess.run(["systemctl","--user","is-active",name],
            capture_output=True,text=True,timeout=7)
        if p.stdout.strip() in ("active","activating","reloading"):return name
    return None
def write_result(status,extra=None):
    if RESULT.is_symlink():raise RuntimeError("unsafe_result")
    body={"schema_version":SCHEMA,"state":status,"source_sha":SOURCE_SHA,
          "candidate_sha256":NEW_SHA,"baseline_sha256":OLD_SHA,
          "updated_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
          **(extra or {})}
    fd,tmp=tempfile.mkstemp(prefix=".s9-native-7s-state-",dir=STATE)
    try:
        with os.fdopen(fd,"w") as f:
            os.fchmod(f.fileno(),0o600)
            json.dump(body,f,sort_keys=True);f.write("\n");f.flush();os.fsync(f.fileno())
        os.replace(tmp,RESULT)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
def result_state():
    if RESULT.is_symlink():raise RuntimeError("unsafe_result")
    if not RESULT.is_file():return None
    doc=json.loads(RESULT.read_text())
    if doc.get("schema_version")!=SCHEMA:raise RuntimeError("unknown_existing_rollout_state")
    return doc.get("state")
def check_health_after_upgrade():
    stop=time.monotonic()+115
    while time.monotonic()<stop:
        time.sleep(4)
        try:
            adb("forward","tcp:18808","tcp:8808",timeout=15)
            stat=camera()
            if healthy(stat,pre=False):
                oldframes=int(stat.get("frames") or 0)
                time.sleep(5)
                nextstat=camera()
                if healthy(nextstat) and int(nextstat.get("frames") or 0)-oldframes>=20:
                    return nextstat
        except Exception:pass
    raise RuntimeError("camera_or_native_4k_did_not_recover_after_upgrade")
def launch_camera():
    adb("shell","am","start","-n",PACKAGE+"/.CameraActivity",
        "--ez","enable_native_camera","true",timeout=25)
def one_attempt():
    state=result_state()
    if state in ("done","attempting","failed"):
        print("S9_7S_ROLLOUT_TERMINAL "+state)
        return state
    try:before=camera()
    except Exception:
        print("S9_7S_ROLLOUT_DEFERRED status_unavailable");return "deferred"
    if not healthy(before,pre=True):
        print("S9_7S_ROLLOUT_DEFERRED camera_hot_recording_or_4k_not_ready")
        return "deferred"
    if competing():
        print("S9_7S_ROLLOUT_DEFERRED concurrent_camera_service")
        return "deferred"
    check_approval()
    if current_apk_sha()==NEW_SHA:
        if healthy(camera(),pre=False):
            write_result("done",{"already_installed":True,"video_or_reviews_modified":False})
            print("S9_7S_ROLLOUT_ALREADY_VERIFIED");return "done"
        raise RuntimeError("candidate_installed_but_camera_unhealthy")
    if current_apk_sha()!=OLD_SHA:raise RuntimeError("installed_camera_changed_since_signed_build")
    main_java_source_has_not_changed()
    first=before
    for _ in range(3):
        time.sleep(6)
        nextstat=camera()
        if (not healthy(nextstat,pre=True) or nextstat.get("recorded")!=first.get("recorded")
            or competing()):
            print("S9_7S_ROLLOUT_DEFERRED changing_capture_or_temperature")
            return "deferred"
    if current_apk_sha()!=OLD_SHA:raise RuntimeError("installed_apk_raced")
    write_result("attempting",{"camera_temperature_before_c":first.get("temperature_c")})
    touched=False
    try:
        # A native APK must be restarted to switch DEX; never reboot Android.
        touched=True
        adb("shell","am","force-stop",PACKAGE,timeout=25)
        ack=adb("install","-r","-g",str(CANDIDATE),timeout=190)
        if "Success" not in ack:raise RuntimeError("apk_install_not_confirmed")
        if current_apk_sha()!=NEW_SHA:raise RuntimeError("new_camera_apk_digest_mismatch")
        launch_camera()
        after=check_health_after_upgrade()
        write_result("done",{"installed":True,
            "continuous_4k_buffered_ms":after.get("continuous_4k_buffered_ms"),
            "camera_temperature_after_c":after.get("temperature_c"),
            "original_videos_intentionally_modified":False,
            "manual_person_reviews_intentionally_modified":False})
        print("S9_7S_ROLLOUT_DEPLOY_VERIFIED "+json.dumps({
            "source_sha":SOURCE_SHA,"apk_sha256":NEW_SHA,
            "continuous_4k_buffered_ms":after.get("continuous_4k_buffered_ms"),
            "camera_temperature_c":after.get("temperature_c"),"zero_output_drops":True,
            "rollbacks_available":True},sort_keys=True))
        return "done"
    except Exception as err:
        details={"failure_class":type(err).__name__,"rolled_back":False}
        if touched:
            try:
                adb("shell","am","force-stop",PACKAGE,timeout=25)
                ack=adb("install","-r","-g",str(ROLLBACK),timeout=190)
                if "Success" not in ack or current_apk_sha()!=OLD_SHA:
                    raise RuntimeError("rollback_apk_install_mismatch")
                launch_camera()
                # Validate that the old camera is alive, but its 4K rearm
                # can be delayed by thermal control; do not override it.
                ending=camera()
                details["rolled_back"]=ending.get("mode") in ("watching","opening","recording")
            except Exception as roll_err:
                details["rollback_error_class"]=type(roll_err).__name__
        write_result("failed",details)
        print("S9_7S_ROLLOUT_FAILED_CLOSED "+json.dumps(details,sort_keys=True))
        return "failed"
def main():
    STATE.mkdir(parents=True,exist_ok=True)
    if LOCK.is_symlink():raise RuntimeError("unsafe_exclusive_lock")
    with LOCK.open("a+") as f:
        try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print("S9_7S_ROLLOUT_DEFERRED another_rollout_active");return
        one_attempt()
if __name__=="__main__":main()
