#!/usr/bin/env python3
"""Guarded release of S9 native HSV APK with preserved installed-package rollback.

Run only on the authorized C720P once build-s9-hsv-v1.py has staged a signed
release. Never delete media, alter the C720P archive or disable camera safeguards.
"""
from pathlib import Path
import datetime
import hashlib
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.request
import urllib.error

HOME=Path("/home/jespern/c720p-home-hub")
RELEASE=HOME/"build/s9-hsv-v1/release.json"
PHONE="192.168.178.250:5555"
URL="http://127.0.0.1:18808"
ARCHIVE="http://127.0.0.1:8795/new/api/saved"
EXPECTED="s9_hsv_histogram_index_v1"
SIGNER="0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5"

def sha(path):
    d=hashlib.sha256()
    with open(path,"rb") as f:
        for chunk in iter(lambda:f.read(131072),b""):d.update(chunk)
    return d.hexdigest()
def run(argv,seconds=40,check=True):
    res=subprocess.run(argv,text=True,capture_output=True,timeout=seconds)
    if check and res.returncode:raise RuntimeError("command_failed:"+str(argv[:4])+":"+res.stderr[-300:])
    return res.stdout.strip()
def adb(*args,seconds=40,check=True):
    return run(["adb","-s",PHONE,*args],seconds,check)
def get(url,seconds=8):
    with urllib.request.urlopen(url,timeout=seconds) as response:
        return json.load(response)
def status():
    return get(URL+"/status")
def inventory():
    result=get(ARCHIVE,15)
    if result.get("archive_mode")!="S9-microSD-only" or not isinstance(result.get("events"),list):
        raise RuntimeError("archive_catalog_unhealthy")
    return {row.get("clip_no") for row in result["events"]}
def signer(path):
    output=run(["apksigner","verify","--print-certs",str(path)],50)
    if SIGNER not in output:raise RuntimeError("signing_key_differs_from_existing_camera")
def preview():
    with urllib.request.urlopen(URL+"/shot.jpg",timeout=9) as result:
        frame=result.read(3000000)
    if len(frame)<1000 or not frame.startswith(b"\xff\xd8") or not frame.endswith(b"\xff\xd9"):
        raise RuntimeError("phone_camera_preview_unavailable")
def healthy(n,baseline=None):
    if not(n.get("ok") is True and n.get("mode")=="watching" and
           n.get("native_4k_enabled") is True and n.get("snapshot_ready") is True):
        return False
    if n.get("recorder")!="camera2_3840x2160_h264":return False
    if int(n.get("recording_rate_max_per_hour") or 0)<24:return False
    if baseline is not None:
        if n.get("continuous_4k_production_persisted")!=baseline.get("continuous_4k_production_persisted"):
            return False
        if baseline.get("continuous_4k_trial_active") is True and n.get("continuous_4k_trial_active") is not True:
            return False
    return True
def launch():
    adb("shell","am","start","-n","nl.kalenel.s9security/.CameraActivity",
        "--ez","enable_native_camera","true",seconds=30)
def await_healthy(baseline,expected_version,timeout=105):
    until=time.monotonic()+timeout;last={}
    initial_frames=-1
    while time.monotonic()<until:
        try:
            last=status()
            if healthy(last,baseline) and (not expected_version or last.get("appearance_index_version")==EXPECTED):
                if initial_frames<0:
                    initial_frames=int(last.get("frames") or 0)
                elif int(last.get("frames") or 0)>initial_frames+4:
                    preview()
                    return last
        except (ValueError,OSError,RuntimeError,urllib.error.URLError):pass
        time.sleep(3)
    raise RuntimeError("phone_camera_health_not_restored:"+str(last.get("last_error","unknown")))
def main():
    manifest=json.loads(RELEASE.read_text())
    ref=os.environ.get("S9_HSV_V1_REF","")
    if not re.fullmatch(r"[0-9a-f]{40}",ref) or manifest.get("source_sha")!=ref:
        raise RuntimeError("immutable_compiled_revision_mismatch")
    if manifest.get("models_native_and_manifest_preserved") is not True or not manifest.get("signed"):
        raise RuntimeError("camera_assets_not_preserved")
    upgrade=Path(manifest["apk"])
    original=HOME/"build/s9-hsv-v1/installed-before.apk"
    if not upgrade.is_file() or not original.is_file() or sha(upgrade)!=manifest["sha256"] or sha(original)!=manifest["baseline_apk_sha256"]:
        raise RuntimeError("release_or_rollback_digest_mismatch")
    signer(original);signer(upgrade)
    if os.statvfs(HOME).f_bavail*os.statvfs(HOME).f_frsize<250*1024*1024:
        raise RuntimeError("hub_root_disk_too_full")
    listing=adb("shell","pm","path","nl.kalenel.s9security").splitlines()
    remote=[line.split("package:",1)[1].strip() for line in listing if line.startswith("package:")]
    if len(remote)!=1:raise RuntimeError("installed_apk_not_unique")
    with tempfile.TemporaryDirectory(prefix="s9-hsv-live-apk-",dir="/tmp") as directory:
        candidate=Path(directory)/"current.apk"
        adb("pull",remote[0],str(candidate),seconds=80)
        if sha(candidate)!=sha(original):raise RuntimeError("running_apk_changed_after_build")
    before=inventory()
    pre=status()
    if not healthy(pre):raise RuntimeError("camera_not_healthy_before_upgrade")
    if float(pre.get("temperature_c") or 100)>39:
        raise RuntimeError("phone_too_hot_for_upgrade")
    if int(pre.get("sd_free_bytes") or 0)<20*1024**3:
        raise RuntimeError("insufficient_microSD_space")
    preview()
    if pre.get("appearance_index_version")==EXPECTED:
        print("S9_HSV_V1_ALREADY_ACTIVE",json.dumps({"mode":pre["mode"],"clips":len(before)}))
        return
    # Preserve original camera package independently of staging artifacts.
    rollback=HOME/"backups/s9-hsv-v1"
    rollback.mkdir(parents=True,exist_ok=True,mode=0o700)
    dest=rollback/("before-hsv-"+datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".apk")
    if dest.exists():raise RuntimeError("rollback_name_collision")
    import shutil
    shutil.copy2(original,dest)
    os.chmod(dest,0o600)
    if sha(dest)!=manifest["baseline_apk_sha256"]:
        raise RuntimeError("rollback_backup_verification_failed")
    seen=0
    end=time.monotonic()+135
    while time.monotonic()<end:
        n=status()
        seen=seen+1 if healthy(n,pre) else 0
        if seen>=2:break
        time.sleep(3)
    else:raise RuntimeError("no_guarded_idle_window")
    stopped=False
    try:
        adb("shell","am","force-stop","nl.kalenel.s9security",seconds=18)
        stopped=True
        response=adb("install","-r","-g",str(upgrade),seconds=190)
        if "Success" not in response:raise RuntimeError("apk_install_not_successful")
        launch()
        live=await_healthy(pre,True,105)
        after=inventory()
        if not before.issubset(after):raise RuntimeError("archive_clips_missing_after_upgrade")
        # Direct phone-local query: no biometric matching or public endpoint.
        query=URL+"/appearance/search?clip=motion_0000000000000.mp4&category=upper_clothing"
        result=get(query,10)
        if not (result.get("ok") is True and result.get("appearance_only") is True and
                result.get("verified_same_person") is False):
            raise RuntimeError("phone_appearance_api_contract_failed")
        if live.get("continuous_4k_trial_active") and not live.get("continuous_4k_ready"):
            # Decoder and ring need 4s of warm-up after recording resumes.
            time.sleep(8)
            live=status()
            if not live.get("continuous_4k_ready") or int(live.get("continuous_4k_buffered_ms") or 0)<4000:
                raise RuntimeError("4k_preroll_not_ready")
        print("S9_HSV_V1_DEPLOYMENT_VERIFIED",json.dumps({
            "apk_sha256":manifest["sha256"],"source_sha":ref,"mode":live["mode"],
            "index_version":live["appearance_index_version"],
            "continuous_4k_active":live.get("continuous_4k_trial_active"),
            "buffered_ms":live.get("continuous_4k_buffered_ms"),
            "temperature_c":live.get("temperature_c"),
            "free_sd_bytes":live.get("sd_free_bytes"),
            "retained_archive_clips":len(after),"rollback_apk":str(dest)}),flush=True)
    except Exception as fault:
        print("S9_HSV_V1_UPGRADE_FAILED",str(fault)[:300],flush=True)
        if stopped:
            try:
                adb("shell","am","force-stop","nl.kalenel.s9security",seconds=18,check=False)
                old=adb("install","-r","-g",str(dest),seconds=190)
                if "Success" not in old:raise RuntimeError("old_apk_install_failed")
                launch()
                recovered=await_healthy(pre,False,100)
                print("S9_HSV_V1_ROLLBACK_VERIFIED",json.dumps({
                   "mode":recovered.get("mode"),"status_ok":recovered.get("ok"),
                   "rolled_back_sha256":sha(dest)}),flush=True)
            except Exception as restore:
                print("S9_HSV_V1_ROLLBACK_FAILED",str(restore)[:300],flush=True)
        raise

if __name__=="__main__":main()
