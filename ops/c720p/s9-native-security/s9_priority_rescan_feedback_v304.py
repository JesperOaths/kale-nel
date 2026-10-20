#!/usr/bin/env python3
"""Durable, bounded, fail-closed S9 original-4K priority feedback V304.

Source: installed private evidence-quality report (priority producer) plus
verified standalone phone-catalog snapshot (original SHA + bytes + revision).
Not a generic scheduled backfill and never a person-identity assignment.

Only original-4K clips with *no indexed face crop* can receive an independent
YuNet gap-evidence sample; the 245+ "secondary model found no supported face"
priorities are explicitly BLOCKED awaiting a different validated model, not
repeated with the same detector. Result enters the existing authoritative
evidence-quality SECONDARY gap-report API, not the native S9 clip manifest.
A secondary result does not claim an actual face, final identity, or refile.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import time
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
STATE=HOME/"state/s9-priority-rescan-v304"
QUEUE=STATE/"queue.json"
LOCK=STATE/"queue.lock"
AUDIT=STATE/"transitions.jsonl"
REPORT=HOME/"state/s9-evidence-quality-v1/report.json"
SECONDARY=HOME/"state/s9-evidence-quality-v1/original-gap-benchmark.json"
ARCHIVE=HOME/"state/s9-standalone-archive-catalog-v1.json"
EVIDENCE=HOME/"bin/s9_evidence_quality_v1.py"
SCAN=HOME/"bin/rescan-original4k-face-gaps-v1.py"
CAMERA="http://127.0.0.1:18808/status"
CROSS_LOCK=HOME/"state/s9-v3-archive-backfill.lock"
MODEL=HOME/"state/s9-evidence-quality-v1/yunet-2023mar.onnx"
MODEL_SHA="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
NATIVE="s9_onphone_36_samples_overlapping_tiles_v5"
ANALYSIS="s9_original4k_independent_gap_benchmark_v1"
SCHEMA="s9_priority_rescan_feedback_v304"
NAME=re.compile(r"motion_[0-9]{13}\.mp4\Z")
HEX=re.compile(r"[a-f0-9]{64}\Z")
MAX_ATTEMPTS=3
LIMIT=340
LABEL="S9_PRIORITY_RESCAN_V304 "

class Refusal(Exception):pass
def check(ok,why):
    if not ok:raise Refusal(why)
def now():return int(time.time())
def safe_doc(path,maximum=7000000):
    check(path.is_file() and not path.is_symlink() and
          20<path.stat().st_size<maximum,"private_source_unavailable")
    return json.loads(path.read_text())
def atomic(path,data):
    path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    payload=json.dumps(data,separators=(",",":"),sort_keys=True,allow_nan=False).encode()
    check(len(payload)<4000000,"queue_limit_exceeded")
    fd,tmp=tempfile.mkstemp(dir=path.parent,prefix=".rescan-v304-")
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,"wb") as dest:
            dest.write(payload);dest.flush();os.fsync(dest.fileno())
        os.replace(tmp,path)
        dfd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(dfd)
        finally:os.close(dfd)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
def journal(status,reason):
    path=AUDIT
    check(not path.is_symlink(),"audit_symlink_refused")
    row={"at":now(),"status":status,"reason":reason}
    fd=os.open(path,os.O_CREAT|os.O_APPEND|os.O_WRONLY|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"a") as file:
        file.write(json.dumps(row,separators=(",",":"))+"\n")
        file.flush();os.fsync(file.fileno())
def items():
    if not QUEUE.exists():
        return {"schema":SCHEMA,"revision":0,"rows":[],"feedback":{"analyzed":0,"verified":0}}
    doc=safe_doc(QUEUE,4000000)
    check(doc.get("schema")==SCHEMA and type(doc.get("revision")) is int
          and isinstance(doc.get("rows"),list) and len(doc["rows"])<=LIMIT,
          "queue_integrity_invalid")
    return doc
def source():
    report=safe_doc(REPORT)
    catalogue=safe_doc(ARCHIVE,8000000)
    check(report.get("analysis_version")=="s9_evidence_quality_v1" and
          report.get("detector_model_sha256")==MODEL_SHA and
          catalogue.get("schema_version")=="s9_native_archive_catalog_v1" and
          HEX.fullmatch(str(catalogue.get("snapshot_id",""))),
          "priority_source_model_or_catalog_drift")
    recs=report.get("recordings")
    sources=catalogue.get("records")
    check(isinstance(recs,list) and isinstance(sources,dict) and
          len(recs)==len(sources) and 1<=len(recs)<=2000,
          "source_count_or_snapshot_drift")
    return report,recs,catalogue
def validate_priority(row,original):
    name=row.get("clip_no")
    check(isinstance(name,str) and NAME.fullmatch(name) and isinstance(original,dict),
          "priority_original_missing")
    meta=original.get("manifest")
    sha=meta.get("sha256") if isinstance(meta,dict) else None
    size=original.get("bytes")
    version=original.get("version")
    check(meta and meta.get("name")==name and
        type(size) is int and 100000<size<800000000 and
        meta.get("bytes")==size and meta.get("width")==3840
        and meta.get("height")==2160 and HEX.fullmatch(str(sha))
        and HEX.fullmatch(str(version)) and
        row.get("native_face_pass_complete") is True,
        "source_original_or_face_model_unverified")
    reason=row.get("extraction_status")
    check(reason in ("no_indexed_image",
             "secondary_detector_has_no_supported_face"),
             "not_a_rescan_priority")
    key=hashlib.sha256(("sd|"+name+"|"+sha+"|"+str(size)+"|"+version+
          "|"+MODEL_SHA+"|"+NATIVE+"|"+ANALYSIS).encode()).hexdigest()
    return {"id":key,"clip_no":name,"source":"s9_original_4k_microsd",
      "source_sha256":sha,"source_bytes":size,"media_revision":version,
      "native_pass":NATIVE,"model_sha256":MODEL_SHA,
      "required_analysis":ANALYSIS,"priority_reason":reason,
      "status":("pending" if reason=="no_indexed_image" else "blocked"),
      "attempts":0,"next_attempt_at":0,"lease_until":0,
      "last_reason":("awaiting_independent_original_4k_rescan" if reason=="no_indexed_image"
         else "same_yunet_model_cannot_validate_its_own_non_detection"),
      "outcome":None}
def aggregate(rows):
    tally={x:0 for x in ("pending","processing","completed","rejected","blocked","dead_letter")}
    for item in rows:tally[item["status"]]=tally.get(item["status"],0)+1
    return tally
def produce():
    report,priorities,cat=source()
    doc=items()
    byid={x["id"]:x for x in doc["rows"]}
    relevant=set()
    added=0;changed=0
    for row in priorities:
        if row.get("targeted_rescan_priority") is not True:continue
        name=row.get("clip_no")
        approved=validate_priority(row,cat["records"].get(name))
        key=approved["id"];relevant.add(key)
        if key not in byid:
            check(len(byid)<LIMIT,"producer_queue_capacity_exceeded")
            byid[key]=approved;added+=1
    # A source/model change must not resurrect an old "completed" result.
    for key,row in byid.items():
        if key not in relevant and row["status"] in ("pending","processing","blocked"):
            row["status"]="rejected"
            row["last_reason"]="source_revision_or_priority_no_longer_current"
            row["lease_until"]=0;changed+=1
    if added or changed:
        doc["revision"]+=1
        doc["rows"]=sorted(byid.values(),key=lambda x:(x["priority_reason"]!="no_indexed_image",x["id"]))
        atomic(QUEUE,doc);journal("producer_persisted","qualified_originals_from_private_catalog")
    return {"status":"qualified_priority_produced","revision":doc["revision"],
            "new_admissions":added,"invalidated":changed,"tally":aggregate(doc["rows"])}
def camera_guard():
    with urllib.request.urlopen(CAMERA,timeout=7) as response:
        doc=json.loads(response.read(65536))
    check(doc.get("ok") is True and doc.get("mode")=="watching"
      and doc.get("native_4k_enabled") is True and
      doc.get("continuous_4k_ready") is True and
      doc.get("continuous_4k_dropped_output_frames")==0 and
      type(doc.get("continuous_4k_buffered_ms")) is int and
      doc["continuous_4k_buffered_ms"]>=6500 and
      type(doc.get("temperature_c")) in (int,float) and
      0<doc["temperature_c"]<=34.5 and
      not any(doc.get(x) is True for x in (
        "recording_active","recording_in_progress",
        "face_backfill_queued","appearance_backfill_queued",
        "historical_import_queued","movement_4k_backfill_queued",
        "garden_archive_triage_queued")),
        "camera_battery_thermal_recording_or_worker_exclusion")
    check(shutil.disk_usage("/").free>=850*1024*1024,
          "hub_disk_reserve_below_850_mib")
    avail=0
    for line in Path("/proc/meminfo").read_text().splitlines():
        if line.startswith("MemAvailable:"):avail=int(line.split()[1])//1024
    check(avail>=900,"hub_memory_reserve_below_900_mib")
    return doc
def load_module(path,name):
    check(path.is_file() and not path.is_symlink(),"approved_worker_unavailable")
    spec=importlib.util.spec_from_file_location(name,path)
    obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj)
    return obj
def evaluate_one(row):
    # This is secondary original-4K gap evidence, not a person assignment.
    camera_guard()
    q=load_module(EVIDENCE,"s9_evidence_quality_v1")
    benchmark=load_module(SCAN,"s9_original_4k_gap_benchmark_v1")
    check(benchmark.VERSION==ANALYSIS and q.MODEL_SHA==MODEL_SHA,
          "model_version_changed_since_admission")
    archive=json.loads(q.fetch("http://127.0.0.1:8795/new/api/saved",6000000))
    current=q.validate_sources(archive)
    target=next((e for e in current if e["clip_no"]==row["clip_no"]),None)
    check(target is not None and
       target.get("face_deep_review_version")==NATIVE
       and not target["face_candidates"],"original_no_longer_eligible")
    # Re-check digest and revision against freshly fetched PRIVATE catalog.
    cat=source()[2]["records"].get(row["clip_no"])
    check(cat is not None and
          cat["manifest"]["sha256"]==row["source_sha256"] and
          cat["bytes"]==row["source_bytes"] and
          cat["version"]==row["media_revision"],
          "source_changed_during_rescan")
    screen=q.FaceScreen(MODEL)
    sample=[]
    try:
        for point in benchmark.sample_times(target["duration_ms"],3):
            camera_guard()
            frame=benchmark.frame(screen,row["clip_no"],point)
            faces=benchmark.detect_native(screen,frame)
            sample.append({"time_ms":point,"state":"decoded",
             "original_resolution":[3840,2160],
             "face_candidates":faces})
            del frame
            camera_guard()
    finally:
        del screen
    check(len(sample)==3,"incomplete_actual_original_rescan")
    # Cannot mark a valid source proof when the catalog revision changed.
    cat=source()[2]["records"].get(row["clip_no"])
    check(cat is not None and
          cat["version"]==row["media_revision"] and
          cat["manifest"]["sha256"]==row["source_sha256"],
          "source_revision_changed_after_analysis")
    return {"clip_no":row["clip_no"],"duration_ms":target["duration_ms"],
      "source_sha256":row["source_sha256"],
      "source_bytes":row["source_bytes"],
      "source_revision":row["media_revision"],
      "model_sha256":MODEL_SHA,"analysis_version":ANALYSIS,
      "samples":sample}
def publish(record,doc):
    # Existing /new/api/evidence-quality endpoint already consumes this
    # precise secondary report path. Append, never overwrite another clip.
    previous={}
    if SECONDARY.exists():
        old=safe_doc(SECONDARY,1000000)
        check(old.get("analysis_version")==ANALYSIS
          and old.get("detector_model_sha256")==MODEL_SHA,
          "secondary_report_model_revision_changed")
        previous={x["clip_no"]:x for x in old.get("recordings",[])
                  if isinstance(x,dict) and NAME.fullmatch(str(x.get("clip_no","")))}
    previous[record["clip_no"]]=record
    check(len(previous)<=300,"secondary_report_at_capacity")
    new={"analysis_version":ANALYSIS,"detector_model_sha256":MODEL_SHA,
       "generated_at":dt.datetime.now(dt.timezone.utc).isoformat(),
       "original_archive_recordings":len(source()[1]),
       "recordings":list(previous.values()),
       "source_sha256_verified_before_processing":True,
       "queue_revision":doc["revision"]+1,"human_review_required":True,
       "identity_inference_performed":False,
       "original_recordings_modified":False,
       "review_decisions_modified":False}
    atomic(SECONDARY,new)
    return new
def work():
    doc=items();candidate=None
    for row in doc["rows"]:
        if row["status"]=="processing" and row.get("lease_until",0)<now():
            row["status"]="pending" if row["attempts"]<MAX_ATTEMPTS else "dead_letter"
            row["last_reason"]="previous_worker_lease_expired"
            row["lease_until"]=0
        if (candidate is None and row["status"]=="pending" and
                row.get("next_attempt_at",0)<=now()):
            candidate=row
    if candidate is None:
        return {"status":"no_runnable_originals","revision":doc["revision"],
           "tally":aggregate(doc["rows"])}
    # Acquire source/camera locks BEFORE taking a lease.
    check(CROSS_LOCK.is_file() and not CROSS_LOCK.is_symlink(),
          "s9_shared_backfill_lock_unavailable")
    with CROSS_LOCK.open("r") as c:
        try:fcntl.flock(c,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise Refusal("s9_backfill_worker_busy") from None
        camera_guard()
        candidate["status"]="processing";candidate["attempts"]+=1
        candidate["lease_until"]=now()+240
        candidate["last_reason"]="bounded_original_4k_rescan_started"
        doc["revision"]+=1
        atomic(QUEUE,doc);journal("processing","source_and_model_pinned")
        try:
            evidence=evaluate_one(candidate)
            candidate["outcome"]={
              "sampled_frames":len(evidence["samples"]),
              "supported_face_observations":sum(len(x["face_candidates"])
                     for x in evidence["samples"]),
              "source_revision":candidate["media_revision"],
              "model_sha256":MODEL_SHA,
              "verified_secondary_report":True}
            publish(evidence,doc)
            candidate["status"]="completed"
            candidate["last_reason"]="verified_secondary_original_gap_evidence_published"
        except Exception as err:
            # Always retain prior human-reviewed/original evidence. A model
            # miss is not a negative-person or negative-identity decision.
            cause=str(err) if isinstance(err,Refusal) else "analysis_failed_or_unavailable"
            if cause in ("original_no_longer_eligible","source_changed_during_rescan",
                "source_revision_changed_after_analysis","model_version_changed_since_admission"):
                candidate["status"]="rejected"
            elif cause=="camera_battery_thermal_recording_or_worker_exclusion":
                candidate["status"]="pending";candidate["attempts"]-=1
            elif candidate["attempts"]>=MAX_ATTEMPTS:
                candidate["status"]="dead_letter"
            else:
                candidate["status"]="pending"
            candidate["last_reason"]=cause
            candidate["next_attempt_at"]=now()+min(6*3600,60*2**max(0,candidate["attempts"]-1))
        candidate["lease_until"]=0
        doc["revision"]+=1
        atomic(QUEUE,doc);journal(candidate["status"],candidate["last_reason"])
    return {"status":candidate["status"],"revision":doc["revision"],
         "attempts":candidate["attempts"],"tally":aggregate(doc["rows"]),
         "verified_secondary":bool(candidate.get("outcome",{}).get("verified_secondary_report"))}
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("action",choices=("produce","work","status"))
    args=parser.parse_args()
    STATE.mkdir(mode=0o700,parents=True,exist_ok=True)
    check(not LOCK.is_symlink() and not QUEUE.is_symlink() and not AUDIT.is_symlink(),
          "unsafe_queue_state_link")
    with LOCK.open("a+") as f:
        fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.action=="produce":out=produce()
        elif args.action=="work":out=work()
        else:
            d=items()
            out={"status":"read_only_queue_status","revision":d["revision"],
                 "tally":aggregate(d["rows"])}
    print(LABEL+json.dumps(out,sort_keys=True,separators=(",",":")),flush=True)
if __name__=="__main__":
    try:main()
    except Exception as error:
        reason=str(error) if isinstance(error,Refusal) else "unexpected_worker_failure"
        print(LABEL+json.dumps({"status":"refused","reason":reason,
           "camera_changed":False,"originals_modified":False,
           "manual_reviews_changed":False},sort_keys=True),flush=True)
        raise SystemExit(1)
