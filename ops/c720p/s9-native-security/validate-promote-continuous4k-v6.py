#!/usr/bin/env python3
"""Guarded S9+ native 4K production rollout only after repeat physical 4K proof.

Install ONLY idle & healthy 4K/GPU v3, preserve installed signed APK, run
one labelled diagnostic event through a single 4K encoder. Independently
probe packet PTS and decode the resulting MP4. Restore v3 on ANY failure.
"""
from pathlib import Path
import datetime,hashlib,json,os,re,statistics,subprocess,tempfile,time,urllib.request,zipfile

HOME=Path("/home/jespern/c720p-home-hub")
RELEASE=HOME/"build/s9-continuous4k-v6/release.json"
OUTPUT=HOME/"build/s9-continuous4k-v6/production-report.json"
BACK=HOME/"backups/s9-continuous4k-v6"
SERIAL="192.168.178.250:5555"
BASE="http://127.0.0.1:18808"
PACKAGE="nl.kalenel.s9security"
PHONE_ROOT="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
V5_SHA="86bb0325601b5ff4fe84871b36ffcc05916eec7503a705ddb09fae75030b6827"
SIGNER="0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5"
VERSION="continuous_native_4k_h264_ring_v1"

def call(parts,timeout=30):
    p=subprocess.run(parts,text=True,capture_output=True,timeout=timeout)
    if p.returncode:raise RuntimeError("command_failed "+repr(parts[:4])+" stderr="+p.stderr[-600:])
    return p.stdout
def adb(*args,timeout=30):return call(["adb","-s",SERIAL,*args],timeout)
def sha(path):
    h=hashlib.sha256()
    with open(path,"rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()
def valid_signer(path):
    if SIGNER not in call(["apksigner","verify","--print-certs",str(path)],40):
        raise RuntimeError("apk_signing_identity_changed")
def status():
    with urllib.request.urlopen(BASE+"/status",timeout=12) as r:return json.load(r)
def control(key,value):
    data=json.dumps({"key":key,"value":value}).encode()
    req=urllib.request.Request(BASE+"/control",data=data,headers={"Content-Type":"application/json"},method="POST")
    try:
        with urllib.request.urlopen(req,timeout=12) as r:return json.load(r)
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode())
def healthy(d):
    return d.get("ok") is True and d.get("mode")=="watching" and d.get("native_4k_enabled") is True and d.get("garden_person_gate_backend")=="gpu" and d.get("temperature_c",100)<38.5 and d.get("sd_free_bytes",0)>15*1024**3 and 0<=d.get("last_frame_age_ms",999999)<1500
def configure_connection():
    if adb("shell","getprop","ro.product.model",timeout=15).strip()!="SM-G965F":raise RuntimeError("wrong_phone")
    adb("forward","tcp:18808","tcp:8808",timeout=15)
def install(path):
    result=adb("install","-r","-g",str(path),timeout=190)
    if "Success" not in result:raise RuntimeError("apk_install_not_confirmed")
def launch():
    adb("shell","am","start","-n",PACKAGE+"/.CameraActivity","--ez","enable_native_camera","true",timeout=45)
def wait_for_health(required_version=None,maxsec=110):
    for _ in range(maxsec//2):
        time.sleep(2)
        try:
            configure_connection()
            d=status()
            if healthy(d) and (required_version is None or d.get("preroll_version")==required_version):
                return d
        except Exception:pass
    raise RuntimeError("camera_health_missing_after_install")

def ffmeta(path):
    data=json.loads(call(["ffprobe","-v","error","-select_streams","v:0",
      "-show_entries","stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames:format=duration,size",
      "-of","json",str(path)],30))
    if len(data.get("streams",[]))!=1:raise RuntimeError("video_stream_missing")
    return data["streams"][0],float(data["format"]["duration"])

def packets(path):
    d=json.loads(call(["ffprobe","-v","error","-select_streams","v:0",
      "-show_packets","-show_entries","packet=pts_time,flags","-of","json",str(path)],70))
    stamps=[float(k["pts_time"]) for k in d["packets"] if "pts_time" in k]
    if len(stamps)<350:raise RuntimeError("too_few_video_packets_"+str(len(stamps)))
    pairs=[b-a for a,b in zip(stamps,stamps[1:])]
    pos=[x for x in pairs if x>0]
    return {"count":len(stamps),"start_pts":stamps[0],"end_pts":stamps[-1],
      "median_interval":statistics.median(pos),"max_gap":max(pairs),
      "nonmonotonic":sum(1 for x in pairs if x<=0),
      "keyframes":sum(1 for x in d["packets"] if "K" in x.get("flags",""))}

def thermometer():
    p=adb("shell","dumpsys","thermalservice",timeout=17)
    out={}
    for key,t in (("cpu_c",1),("battery_c",3)):
        match=re.search(r"Temperature\{mValue=([-0-9.]+), mType="+str(t),p)
        out[key]=float(match.group(1)) if match else None
    return out

def save(data):
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    p=OUTPUT.with_suffix(".tmp")
    p.write_text(json.dumps(data,indent=2,sort_keys=True)+"\n")
    os.replace(p,OUTPUT)

def main():
    m=json.loads(RELEASE.read_text());apk=Path(m["apk"])
    if sha(apk)!=m["sha256"] or not m.get("models_native_and_manifest_preserved"):
        raise RuntimeError("signed_release_digest_mismatch")
    valid_signer(apk)
    if not m.get("source_sha") or not m.get("signed") or m.get("min_saved_preroll_ms")!=5500:
        raise RuntimeError("4k_v6_release_contract_mismatch")
    if m.get("continuous_4k_trial")!="requires_verification_then_promotion":
        raise RuntimeError("trial_release_missing_hard_off_switch")
    configure_connection()
    if os.statvfs(HOME).f_bavail*os.statvfs(HOME).f_frsize<320*1024**2:
        raise RuntimeError("insufficient_hub_space_for_rollback")
    first=status()
    if not healthy(first) or first.get("preroll_version") not in (VERSION,"s9_on_phone_avc_memory_ring_keyframe_7s_v3"):
        print("S9_4K_TRIAL_DEFERRED_UNHEALTHY_BASELINE",json.dumps({"mode":first.get("mode"),"temp":first.get("temperature_c")}),flush=True)
        return
    print("BASELINE_HEALTHY",json.dumps({"temp":first["temperature_c"],"gpu":first.get("garden_person_gate_backend"),"recorder":first.get("recorder")}),flush=True)
    time.sleep(14)
    later=status()
    if not healthy(later) or later.get("recorded")!=first.get("recorded"):
        print("S9_4K_TRIAL_DEFERRED_ACTIVITY",flush=True);return
    location=adb("shell","pm","path",PACKAGE,timeout=15)
    old_paths=[line.split(":",1)[1] for line in location.splitlines() if line.startswith("package:") and line.endswith("base.apk")]
    if len(old_paths)!=1:raise RuntimeError("installed_apk_path_not_unique")
    BACK.mkdir(parents=True,exist_ok=True)
    old=BACK/("baseline-v5-"+datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".apk")
    adb("pull",old_paths[0],str(old),timeout=100)
    valid_signer(old)
    if sha(old)!=V5_SHA:raise RuntimeError("unexpected_running_v4_apk_refuse_overwrite")
    changed=False
    try:
        final=status()
        if not healthy(final) or final.get("recorded")!=later.get("recorded"):
            print("S9_4K_TRIAL_DEFERRED_LATE_ACTIVITY",flush=True);return
        adb("shell","am","force-stop",PACKAGE,timeout=17)
        changed=True
        install(apk);launch()
        baseline=wait_for_health("s9_on_phone_avc_memory_ring_keyframe_7s_v3")
        if baseline.get("continuous_4k_trial_active") is not False:
            raise RuntimeError("experiment_not_default_off")
        activated=control("continuous_4k_trial","enable")
        if not activated.get("ok"):raise RuntimeError("trial_enable_rejected_"+str(activated)[:120])
        ring=None
        for i in range(35):
            time.sleep(2)
            d=status()
            if d.get("continuous_4k_trial_active") and d.get("mode")=="watching" and d.get("continuous_4k_ready") and d.get("continuous_4k_buffered_ms",0)>=6000:
                ring=d;break
            if d.get("continuous_4k_error") or not d.get("continuous_4k_trial_active"):
                raise RuntimeError("trial_camera2_codec_failed_"+str(d.get("continuous_4k_last_result")))
        if ring is None:raise RuntimeError("continuous_4k_ring_not_ready")
        print("S9_4K_RING_LIVE",json.dumps({"buffer_ms":ring.get("continuous_4k_buffered_ms"),"buffer_bytes":ring.get("continuous_4k_buffer_bytes"),"fps":ring.get("sensor_result_fps")}),flush=True)
        samples=[]
        for i in range(12):
            time.sleep(8)
            d=status()
            if not healthy(d) or not d.get("continuous_4k_ready") or d.get("continuous_4k_dropped_output_frames",0)!=0:
                raise RuntimeError("4k_thermal_or_camera_regression")
            if d.get("temperature_c",100)>=38.5:raise RuntimeError("4k_temperature_guard")
            fps=d.get("sensor_result_fps")
            if fps is not None and float(fps)<22:raise RuntimeError("4k_sensor_fps_regression")
            sample={"at_s":(i+1)*8,"temp":d.get("temperature_c"),"fps":fps,
                "buffer_ms":d.get("continuous_4k_buffered_ms"),"drops":d.get("continuous_4k_dropped_output_frames"),
                "error":d.get("continuous_4k_error")}
            samples.append(sample)
            if i%4==0:print("4K_SOAK_SAMPLE",json.dumps(sample),flush=True)
        d=status()
        if d.get("preroll_diagnostic_used") is True:raise RuntimeError("diagnostic_already_used")
        ack=control("preroll_diagnostic","record_once")
        if not ack.get("ok"):raise RuntimeError("4k_diagnostic_control_rejected_"+str(ack)[:100])
        clip=""
        for n in range(45):
            time.sleep(1)
            d=status();clip=d.get("preroll_diagnostic_clip","")
            if re.fullmatch(r"diagnostic_preroll_[0-9]{13}\.mp4",clip) and "single_native_4k_complete_" in d.get("preroll_diagnostic_result",""):
                break
        else:raise RuntimeError("single_4k_diagnostic_never_finalized_"+str(d.get("continuous_4k_last_result")))
        with tempfile.TemporaryDirectory(prefix="native4k-realproof-",dir="/tmp") as tmp:
            pulled=Path(tmp)/clip
            adb("pull",PHONE_ROOT+"/"+clip,str(pulled),timeout=140)
            if not pulled.is_file() or pulled.stat().st_size<5_000_000:raise RuntimeError("too_small_single_4k")
            stream,duration=ffmeta(pulled)
            quality=packets(pulled)
            if (stream.get("width"),stream.get("height"),stream.get("codec_name"))!=(3840,2160,"h264"):
                raise RuntimeError("incorrect_native_4k_resolution")
            if not 14.0<=duration<=30.0:raise RuntimeError("preroll_plus_event_duration_invalid_"+str(duration))
            if abs(float(stream.get("r_frame_rate","0/1").split("/")[0])/max(1,float(stream.get("r_frame_rate","1/1").split("/")[1]))-30)>1:
                raise RuntimeError("4k_wrong_framerate")
            if quality["max_gap"]>0.12 or quality["nonmonotonic"]>0 or quality["keyframes"]<4:
                raise RuntimeError("4k_frame_continuity_invalid_"+str(quality))
            # Decode at first and final seconds; never trust metadata alone.
            for at in ("0","7","14"):
                call(["ffmpeg","-nostdin","-hide_banner","-threads","1","-v","error","-ss",at,
                  "-i",str(pulled),"-map","0:v:0","-frames:v","2","-f","null","-"],60)
            result={"verified":True,"single_4k_mp4":clip,"duration":duration,"stream":stream,"packets":quality,
              "bytes":pulled.stat().st_size,"sha256":sha(pulled),"samples":samples,
              "backup_apk":str(old),"new_apk_sha256":sha(apk),
              "production_persisted":False,"post_test_camera_status":d.get("mode")}
            save(result)
            print("S9_CONTINUOUS_4K_REAL_VIDEO_VERIFIED",json.dumps(result),flush=True)
            # Only the explicitly-labelled one-shot diagnostic, never footage.
            adb("shell","rm","--",PHONE_ROOT+"/"+clip,timeout=20)
        # Promotion requires a real verified 4K diagnostic on this exact
        # signed APK: it cannot be enabled on a newly started encoder.
        d=status()
        if d.get("continuous_4k_last_result","").startswith("verified_native_4k_") is False:
            raise RuntimeError("latest_native_4k_evidence_missing")
        promoted=control("continuous_4k_trial","promote")
        if not promoted.get("ok") or not promoted.get("production_persisted"):
            raise RuntimeError("production_promotion_refused_"+str(promoted)[:160])
        persisted=status()
        if not persisted.get("continuous_4k_production_persisted"):
            raise RuntimeError("production_flag_not_committed")
        print("4K_PRODUCTION_PROMOTED",json.dumps({"temp":persisted.get("temperature_c"),"buffer_ms":persisted.get("continuous_4k_buffered_ms")}),flush=True)
        # A *real restart* proves that the on-phone, self-contained 4K service
        # comes back without a hub watchdog or human control call.
        if not healthy(persisted) or persisted.get("mode")!="watching":
            raise RuntimeError("camera_not_idle_before_reboot_test")
        adb("shell","am","force-stop",PACKAGE,timeout=20)
        launch()
        verified_boot=wait_for_health(VERSION,maxsec=125)
        if not verified_boot.get("continuous_4k_production_persisted") or not verified_boot.get("continuous_4k_trial_active"):
            raise RuntimeError("native_4k_not_restored_on_boot")
        for _ in range(22):
            time.sleep(2)
            verified_boot=status()
            if verified_boot.get("continuous_4k_ready") and verified_boot.get("continuous_4k_buffered_ms",0)>=6500:break
        else:raise RuntimeError("4k_pre_event_ring_did_not_recover_after_restart")
        if not healthy(verified_boot) or verified_boot.get("continuous_4k_dropped_output_frames",0)>0:
            raise RuntimeError("native_4k_reboot_health_failed")
        for i in range(8):
            time.sleep(8)
            verified_boot=status()
            if not healthy(verified_boot) or not verified_boot.get("continuous_4k_ready") or verified_boot.get("continuous_4k_dropped_output_frames",0):
                raise RuntimeError("post_reboot_4k_soak_failed")
        result["production_persisted"]=True
        result["production_boot_verified"]=True
        result["post_boot_camera"]={k:verified_boot.get(k) for k in (
            "mode","temperature_c","sensor_result_fps","continuous_4k_ready",
            "continuous_4k_buffered_ms","continuous_4k_production_persisted",
            "continuous_4k_dropped_output_frames","garden_person_gate_backend")}
        save(result)
        print("S9_CONTINUOUS_NATIVE_4K_PRODUCTION_VERIFIED",json.dumps(result["post_boot_camera"]),flush=True)
    except BaseException as error:
        if changed:
            try:
                # A failed promotion must never remain armed on reboot.
                try:control("continuous_4k_trial","disable")
                except Exception:pass
                adb("shell","am","force-stop",PACKAGE,timeout=20)
                install(old);launch()
                restored=wait_for_health("s9_on_phone_avc_memory_ring_keyframe_7s_v3")
                print("S9_4K_V6_PRODUCTION_ROLLED_BACK",json.dumps({"why":str(error)[:250],"healthy":healthy(restored),"old":str(old)}),flush=True)
            except BaseException as secondary:
                print("S9_4K_TRIAL_ROLLBACK_FAILED",repr(secondary),flush=True)
        raise

if __name__=="__main__":main()
