#!/usr/bin/env python3
"""Read-only S9+ Stage 4 detector cutover preflight. Run on C720P.
No APK installation, recording commands, deletion, media pull, camera reset,
face identification, full frames or MP4 bytes pass through this script.
"""
import collections
import datetime as dt
import hashlib
import json
import pathlib
import re
import subprocess
import time
import urllib.request

PHONE="192.168.178.250:5555"
SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
BENCH="/storage/9C33-6BBD/Android/data/nl.kalenel.s9benchmark/files/bench-results/compare-1791699468509.json"
ROOT=pathlib.Path("/home/jespern/c720p-home-hub")
ROLLOUT_MS=int(dt.datetime(2026,10,11,7,6,3,tzinfo=dt.timezone.utc).timestamp()*1000)
CLIP=re.compile(r"motion_([0-9]{13})\.mp4\Z")
MAX_REPORT=1_500_000
def adb(*args,timeout=28,max_bytes=MAX_REPORT,strict=True):
    p=subprocess.run(["adb","-s",PHONE,*args],stdout=subprocess.PIPE,
      stderr=subprocess.PIPE,timeout=timeout)
    if strict and p.returncode:
        raise RuntimeError("adb_failed:"+str(args[:2])+":"+p.stderr.decode(errors="replace")[-180:])
    if len(p.stdout)>max_bytes:raise RuntimeError("adb_output_too_large")
    return p.stdout
def status():
    with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=9) as r:
        d=json.load(r)
    if not isinstance(d,dict):raise RuntimeError("native_status_invalid")
    return d
def safe_read(remote,max_bytes=MAX_REPORT):
    data=adb("exec-out","cat",remote,timeout=22,max_bytes=max_bytes,strict=False)
    return json.loads(data) if data.startswith(b"{") else None
def choose(items,limit=42):
    if len(items)<=limit:return items
    newest=items[-20:];oldest=items[:11]
    middle=items[11:-20]
    stride=max(1,len(middle)//11)
    return sorted(set(oldest+middle[::stride][:11]+newest))
def verify_rollbacks():
    previous=ROOT/"backups/native-security-cutover/S9-native-before-night-guard-20261011-090409.apk"
    candidate=ROOT/"build/s9-native-security/s9-native-security.apk"
    if not previous.is_file() or previous.stat().st_size<4_000_000:
        raise RuntimeError("rollback_apk_missing")
    if not candidate.is_file() or candidate.stat().st_size<4_000_000:
        raise RuntimeError("active_release_apk_missing")
    old_hash=hashlib.sha256(previous.read_bytes()).hexdigest()
    new_hash=hashlib.sha256(candidate.read_bytes()).hexdigest()
    if new_hash!="3b29ad2315988f5b1c2d0c169342ec25f16e087879340f4b6d9e73360e895e0e":
        raise RuntimeError("release_apk_sha256_not_pinned")
    if old_hash==new_hash:raise RuntimeError("rollback_same_as_new_release")
    return {"rollback_apk_saved":True,"rollback_apk_bytes":previous.stat().st_size,
            "rollback_apk_sha256":old_hash,
            "installed_release_artifact_sha256":new_hash}
def main():
    result={"audit":"s9_stage4_archive_live_gate_v1","utc":dt.datetime.now(dt.timezone.utc).isoformat(),
      "ground_truth_source":"independent human-reviewed labels required",
      "retired_existing_detector":False,"installed_candidate_detector":False}
    result["rollbacks"]=verify_rollbacks()
    try:
        state=adb("get-state",timeout=13,max_bytes=500).decode().strip()
    except Exception:
        p=subprocess.run(["adb","connect",PHONE],capture_output=True,timeout=15)
        state=adb("get-state",timeout=13,max_bytes=500).decode().strip()
    if state!="device":raise RuntimeError("S9_ADB_unavailable")
    first=status()
    def compact(d):
        keys=("ok","mode","native_4k_enabled","motion_detector","capture_event_version",
              "thumbnail_selector","snapshot_ready","snapshot_age_ms",
              "temperature_c","sd_free_bytes","frames","motion_events","recorded","reviewed",
              "failed","garden_person_gate_ready","garden_person_gate_backend",
              "garden_person_gate_checked","garden_person_gate_matches",
              "garden_person_gate_confirmed_starts","garden_person_gate_rejected",
              "garden_person_gate_errors","sensor_result_fps","last_frame_age_ms")
        return {k:d.get(k) for k in keys}
    result["live_before"]=compact(first)
    if not first.get("ok") or not first.get("native_4k_enabled"):
        raise RuntimeError("active_camera_not_healthy")
    if first.get("capture_event_version")!="s9_logical_event_segments_v1":
        raise RuntimeError("stage3_native_capture_version_missing")
    if first.get("motion_detector")!="garden_roi_gpu_two_frame_person_gate_v2":
        raise RuntimeError("existing_person_gate_changed_unexpectedly")
    if not first.get("snapshot_ready"):
        raise RuntimeError("live_snapshot_missing")
    # Avoid archive readback while the production Camera2 service is recording.
    result["archive_activity_skipped_camera_busy"]=first.get("mode")!="watching"
    result["archive"]={}
    if first.get("mode")=="watching":
        listed=adb("shell","ls","-1",SD,timeout=33,max_bytes=1_300_000).decode(errors="replace")
        names=sorted(x for x in listed.splitlines() if CLIP.fullmatch(x))
        manifests=set(listed.splitlines())
        selected=choose(names)
        latest=[x for x in names if int(CLIP.fullmatch(x).group(1))>=ROLLOUT_MS]
        categories=collections.Counter()
        has_evidence=0;new_reviewed=0;new_thumbs=0;new_capture=0;invalid=0
        human_confirmed=0;human_negative=0
        sampled_old=0;sampled_new=0
        cover_ranks=[];new_valid=[]
        for name in selected:
            v=name+".verified.json"
            if v not in manifests:continue
            manifest=safe_read(SD+"/"+v,max_bytes=260000)
            if not isinstance(manifest,dict) or manifest.get("name")!=name:
                invalid+=1;continue
            if manifest.get("width")!=3840 or manifest.get("height")!=2160:
                invalid+=1;continue
            bytes_claimed=manifest.get("bytes")
            if not isinstance(bytes_claimed,int) or bytes_claimed<200000:invalid+=1;continue
            is_new=int(CLIP.fullmatch(name).group(1))>=ROLLOUT_MS
            sampled_new+=is_new;sampled_old+=not is_new
            categories[str(manifest.get("person_event_category") or "not_graded")]+=1
            if manifest.get("human_reviewed") is True and manifest.get("human_person_verified") is True:
                human_confirmed+=1
            if manifest.get("human_reviewed") is True and manifest.get("human_person_verified") is False:
                human_negative+=1
            if not is_new:continue
            new_reviewed+=1
            new_valid.append(name)
            new_thumbs+=name+".thumb.jpg" in manifests
            new_capture+=name+".capture.json" in manifests
            if manifest.get("capture_event_version")=="s9_logical_event_segments_v1":
                has_evidence+=1
            rank=manifest.get("thumbnail_sharpness")
            if isinstance(rank,(float,int)) and 0<=rank<=510:cover_ranks.append(round(rank,2))
        result["archive"]={
         "native_mp4_total":len(names),
         "new_since_stage3":len(latest),
         "verified_sidecars_total":sum(n+".verified.json" in manifests for n in names),
         "thumbnail_jpeg_total":sum(n+".thumb.jpg" in manifests for n in names),
         "capture_segment_evidence_total":sum(n+".capture.json" in manifests for n in names),
         "sampled_manifest_count":sampled_old+sampled_new,
         "sampled_older_recordings":sampled_old,
         "sampled_new_recordings":sampled_new,
         "sampled_invalid_or_unreadable":invalid,
         "sampled_model_categories":dict(sorted(categories.items())),
         "new_validated_4k_reviewed":new_reviewed,
         "new_thumbnails_present":new_thumbs,
         "new_capture_sidecars_present":new_capture,
         "new_event_links_in_manifest":has_evidence,
         "new_thumbnail_sharpness_scores":cover_ranks[:12],
         "independent_human_positive_labels":human_confirmed,
         "independent_human_negative_labels":human_negative,
         "classification_labels_are_model_estimates":True,
         "unchanged_original_mp4s":True}
        # Inspect aggregate shadow benchmark, never export frame or JPEG bytes.
        report=safe_read(BENCH)
        if isinstance(report,dict):
            frames=report.get("frames",[])
            clips=report.get("clip_summary",[])
            a=report.get("ssd",{});b=report.get("efficientdet",{})
            if not isinstance(frames,list) or len(frames)>200 or not isinstance(clips,list):
                raise RuntimeError("unexpected_shadow_report")
            def positive(model):
                return sum(int(((x.get(model) or {}).get("class_index_0_at_50") or 0)>0) for x in frames)
            def candidates(model):
                return sum(int(((x.get(model) or {}).get("person_boxes_at_44") or 0)) for x in frames)
            result["benchmark"]={
              "method":"independent CPU inference on identical sampled 4K clip frames",
              "paired_frames":report.get("paired_model_frames"),
              "clips":len(clips),"ssd_p50_ms":a.get("p50_ms"),"lite0_p50_ms":b.get("p50_ms"),
              "ssd_p90_ms":a.get("p90_ms"),"lite0_p90_ms":b.get("p90_ms"),
              "ssd_positive_sampled_frames":positive("ssd"),
              "lite0_positive_sampled_frames":positive("efficientdet"),
              "ssd_candidate_person_boxes":candidates("ssd"),
              "lite0_candidate_person_boxes":candidates("efficientdet"),
              "adaptive_motion_positive":report.get("motion_positive_frames"),
              "temporal_person_event_ssd":report.get("ssd_confirmed_track_events"),
              "temporal_person_event_lite0":report.get("lite0_confirmed_track_events"),
              "temporal_track_disagreements":report.get("temporal_model_disagreement_frames"),
              "human_ground_truth_labels_present":False}
    time.sleep(7)
    after=status();result["live_after"]=compact(after)
    result["camera_live_frame_delta"]=int(after.get("frames") or 0)-int(first.get("frames") or 0)
    result["camera_live_gate_check_delta"]=int(after.get("garden_person_gate_checked") or 0)-int(first.get("garden_person_gate_checked") or 0)
    result["camera_live_failed_delta"]=int(after.get("failed") or 0)-int(first.get("failed") or 0)
    result["camera_live_motion_delta"]=int(after.get("motion_events") or 0)-int(first.get("motion_events") or 0)
    result["camera_still_healthy"]=bool(after.get("ok") and after.get("native_4k_enabled")
         and after.get("snapshot_ready") and result["camera_live_frame_delta"]>0)
    candidate=result.get("benchmark",{})
    result["cutover_gate"]={
       "decision":"HOLD_EXISTING_SSD_DETECTOR",
       "reasons":["No independent day/night positive and negative event labels",
                  "Existing measured SSD CPU median is faster than Lite0",
                  "Live false-negative/missed-visitor evidence not measured",
                  "Stage3 event/thumbnail improvements are not proof of detector accuracy"],
       "candidate_model_verified_better":False,
       "old_detector_retirement_authorized":False}
    path=ROOT/"state/s9-stage4-detector-audit-20261011.json"
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(result,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    print("S9_STAGE4_READONLY_RESULT",json.dumps(result,sort_keys=True),flush=True)
    if not result["camera_still_healthy"]:
        raise RuntimeError("live_camera_health_regressed_during_audit")
    print("S9_STAGE4_READONLY_PASS_KEEP_EXISTING_DETECTOR",flush=True)
if __name__=="__main__":main()
