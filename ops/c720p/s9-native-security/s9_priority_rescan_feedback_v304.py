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
import stat
import tempfile
import time
import urllib.request
import urllib.error

HOME=Path("/home/jespern/c720p-home-hub")
STATE=HOME/"state/s9-priority-rescan-v304"
QUEUE=STATE/"queue.json"
LOCK=STATE/"queue.lock"
AUDIT=STATE/"transitions.jsonl"
def retired_dir():return STATE/"retired"
REPORT=HOME/"state/s9-evidence-quality-v1/report.json"
SECONDARY=HOME/"state/s9-evidence-quality-v1/original-gap-benchmark.json"
ARCHIVE=HOME/"state/s9-standalone-archive-catalog-v1.json"
EVIDENCE=HOME/"bin/s9_evidence_quality_v1.py"
ANONYMOUS_CONSUMER=HOME/"bin/s9_anonymous_evidence_consumer_v361.py"
SCAN=HOME/"bin/rescan-original4k-face-gaps-v1.py"
CAMERA="http://127.0.0.1:18808/status"
CROSS_LOCK=HOME/"state/s9-v3-archive-backfill.lock"
IMAGE_LOCK=HOME/"state/s9-evidence-quality-v1/worker.lock"
MODEL=HOME/"state/s9-evidence-quality-v1/yunet-2023mar.onnx"
MODEL_SHA="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
NATIVE="s9_onphone_36_samples_overlapping_tiles_v5"
ANALYSIS="s9_original4k_independent_gap_benchmark_v1"
SCHEMA="s9_priority_rescan_feedback_v304"
NAME=re.compile(r"motion_[0-9]{13}\.mp4\Z")
HEX=re.compile(r"[a-f0-9]{64}\Z")
MAX_ATTEMPTS=3
MAX_TRANSIENT_DEFERRALS=8
LIMIT=340
# Private immutable per-ID history is bounded. On exhaustion, defer admission
# instead of silently dropping audit provenance or overwriting originals.
MAX_RETIRED_ROWS=4096
MAX_RETIRED_BYTES=16*1024*1024
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
      "attempts":0,"deferrals":0,"next_attempt_at":0,"lease_until":0,
      "last_reason":("awaiting_independent_original_4k_rescan" if reason=="no_indexed_image"
         else "same_yunet_model_cannot_validate_its_own_non_detection"),
      "outcome":None}
def aggregate(rows):
    tally={x:0 for x in ("pending","processing","completed","rejected","blocked","dead_letter")}
    for item in rows:tally[item["status"]]=tally.get(item["status"],0)+1
    return tally
def retirement_budget(rows):
    """Preflight immutable provenance growth; fail closed on unsafe private state."""
    if not rows:
        return True
    root=retired_dir()
    check(not root.is_symlink(),"unsafe_retired_directory")
    count=total=0
    known=set()
    if root.exists():
        directory=root.stat()
        check(stat.S_ISDIR(directory.st_mode) and
              directory.st_uid==os.getuid() and not directory.st_mode&0o077,
              "retired_provenance_directory_not_private")
        for leaf in root.iterdir():
            check(not leaf.is_symlink(),"retired_provenance_symlink_refused")
            metadata=leaf.stat()
            check(stat.S_ISREG(metadata.st_mode) and
                  metadata.st_uid==os.getuid() and
                  metadata.st_nlink==1 and not metadata.st_mode&0o077,
                  "retired_provenance_file_not_private")
            total+=metadata.st_size
            if HEX.fullmatch(leaf.stem) and leaf.suffix==".json":
                check(20<metadata.st_size<20000,
                      "retired_provenance_file_unbounded")
                count+=1
                known.add(leaf.stem)
            else:
                # Crash-leftover atomic temporary files can have 0 bytes.
                # Account for them without deleting provenance on restart.
                check(leaf.name.startswith(".rescan-v304-"),
                      "unexpected_private_retirement_entry")
    future=set()
    for row in rows:
        key=row.get("id")
        check(isinstance(key,str) and HEX.fullmatch(key),
              "invalid_archived_task_identifier")
        if key in known or key in future:
            continue
        future.add(key)
        payload={"schema":"s9_priority_retired_provenance_v1",
                 "id":key,"final":row,"retired_at":now()}
        size=len(json.dumps(payload,separators=(",",":"),sort_keys=True,
                            allow_nan=False).encode())
        check(20<size<20000,"retired_provenance_row_unbounded")
        total+=size
        count+=1
    return count<=MAX_RETIRED_ROWS and total<=MAX_RETIRED_BYTES

def retire_obsolete(rows, relevant, pressure_ids=frozenset()):
    """Durably archive obsolete terminal IDs before freeing live queue slots.

    A current completed row remains active for the evidence reader. Only
    current BLOCKED same-YuNet model negatives may be parked under runnable
    admission pressure. They remain immutable private 0600 audit records;
    unrelated terminal rows are archived only when obsolete.
    """
    rows=list(rows)
    candidates=[row for row in rows if not (
        (row["id"] in relevant and row["id"] not in pressure_ids) or
        row["status"] not in ("rejected","completed","blocked","dead_letter"))]
    check(retirement_budget(candidates),
          "retired_provenance_capacity_deferred")
    retained=[];count=0
    for row in rows:
        if (row["id"] in relevant and row["id"] not in pressure_ids) or row["status"] not in (
                "rejected","completed","blocked","dead_letter"):
            retained.append(row);continue
        key=row["id"]
        check(isinstance(key,str) and HEX.fullmatch(key),
              "invalid_archived_task_identifier")
        retired_dir().mkdir(mode=0o700,parents=True,exist_ok=True)
        check(not retired_dir().is_symlink(),"unsafe_retired_directory")
        directory=retired_dir().stat()
        check(stat.S_ISDIR(directory.st_mode) and
              directory.st_uid==os.getuid() and
              not directory.st_mode&0o077,
              "retired_provenance_directory_not_private")
        dest=retired_dir()/(key+".json")
        payload={"schema":"s9_priority_retired_provenance_v1",
                 "id":key,"final":row,"retired_at":now()}
        if dest.exists() or dest.is_symlink():
            check(not dest.is_symlink(),"retired_provenance_symlink_refused")
            status=dest.stat()
            check(stat.S_ISREG(status.st_mode) and
                  status.st_uid==os.getuid() and
                  status.st_nlink==1 and not status.st_mode&0o077,
                  "retired_provenance_file_not_private")
            old=safe_doc(dest,20000)
            check(old.get("schema")==payload["schema"] and
                  old.get("id")==key and old.get("final")==row,
                  "retired_provenance_conflict")
        else:
            atomic(dest,payload)
        count+=1
    return retained,count

def retired_proof(approved, allow_priority_reclassification=False):
    """Validate immutable past provenance; detect bounded reason reclassification."""
    key=approved["id"]
    check(isinstance(key,str) and HEX.fullmatch(key),"invalid_retired_source_id")
    root=retired_dir()
    dest=root/(key+".json")
    if not dest.exists() and not dest.is_symlink():return False
    check(not root.is_symlink() and root.is_dir(),
          "unsafe_retired_directory")
    directory=root.stat()
    check(stat.S_ISDIR(directory.st_mode) and directory.st_uid==os.getuid()
          and not directory.st_mode&0o077,
          "retired_provenance_directory_not_private")
    check(not dest.is_symlink(),"retired_provenance_symlink_refused")
    meta=dest.stat()
    check(stat.S_ISREG(meta.st_mode) and meta.st_uid==os.getuid()
          and meta.st_nlink==1 and not meta.st_mode&0o077,
          "retired_provenance_file_not_private")
    body=safe_doc(dest,20000)
    past=body.get("final")
    check(body.get("schema")=="s9_priority_retired_provenance_v1"
          and body.get("id")==key and isinstance(past,dict)
          and past.get("id")==key
          and past.get("status") in ("rejected","completed","blocked","dead_letter")
          and all(past.get(field)==approved.get(field)
                  for field in ("clip_no","source_sha256","source_bytes",
                                "media_revision","native_pass","model_sha256",
                                "required_analysis")),
          "retired_provenance_changed_or_untrusted")
    if past.get("priority_reason") != approved.get("priority_reason"):
        check(past.get("priority_reason") in
              ("no_indexed_image","secondary_detector_has_no_supported_face"),
              "retired_provenance_changed_or_untrusted")
        if allow_priority_reclassification:
            return "priority_reason_changed"
        raise Refusal("retired_provenance_changed_or_untrusted")
    return True

def qualify_reason_transition(row, byid):
    """Reclassify a stable original once per reason, never reuse an audit ID.

    Legacy task IDs predate a priority-reason component. Keep their existing
    IDs valid unless the *same* immutable source/model switches between the
    two supported reasons; then derive a stable one-time reason-specific ID.
    This prevents a securely retired same-YuNet blocker from suppressing a
    later genuinely runnable no-crop priority at identical MP4 revision.
    """
    original_key=row["id"]
    current=byid.get(original_key)
    if current is not None:
        check(all(current.get(field)==row.get(field) for field in
              ("clip_no","source_sha256","source_bytes","media_revision",
               "native_pass","model_sha256","required_analysis")),
              "queue_source_provenance_conflict")
        if current.get("priority_reason")==row["priority_reason"]:
            return row
        check(current.get("priority_reason") in
              ("no_indexed_image","secondary_detector_has_no_supported_face"),
              "queue_priority_reason_untrusted")
    elif retired_proof(row,allow_priority_reclassification=True) != "priority_reason_changed":
        return row
    result=dict(row)
    result["id"]=hashlib.sha256((
        "reclassified_priority_v1|"+original_key+"|"+row["priority_reason"]
    ).encode()).hexdigest()
    result["legacy_source_key"]=original_key
    return result

def park_same_model_blockers(byid,relevant,fresh):
    """Never let a full permanently-blocked queue starve a runnable original."""
    # Obsolete terminal rows will already retire in this same atomic update;
    # do not park additional current blockers unnecessarily.
    retiring=sum(row["id"] not in relevant and row.get("status") in
                 ("rejected","completed","blocked","dead_letter")
                 for row in byid.values())
    available=LIMIT-len(byid)+retiring
    runnable=sum(row["priority_reason"]=="no_indexed_image" for row in fresh)
    needed=max(0,runnable-available)
    if not needed:return frozenset()
    candidates=sorted(row["id"] for row in byid.values()
       if row["id"] in relevant
       and row.get("status")=="blocked"
       and row.get("priority_reason")=="secondary_detector_has_no_supported_face"
       and row.get("last_reason")=="same_yunet_model_cannot_validate_its_own_non_detection"
       and row.get("outcome") is None)
    return frozenset(candidates[:needed])

def produce():
    report,priorities,cat=source()
    doc=items()
    byid={x["id"]:x for x in doc["rows"]}
    check(len(byid)==len(doc["rows"]),"duplicate_existing_task_ids")
    relevant=set()
    approved=[]
    for item in priorities:
        if item.get("targeted_rescan_priority") is not True:continue
        name=item.get("clip_no")
        row=qualify_reason_transition(
            validate_priority(item,cat["records"].get(name)),byid)
        relevant.add(row["id"])
        approved.append(row)
    changed=0
    for key,row in byid.items():
        if key not in relevant and row["status"] in ("pending","processing","blocked"):
            row["status"]="rejected"
            row["last_reason"]="source_revision_or_priority_no_longer_current"
            row["lease_until"]=0
            changed+=1
    fresh=[item for item in approved if item["id"] not in byid
           and not retired_proof(item)]
    pressure=park_same_model_blockers(byid,relevant,fresh)
    try:
        retained,retired=retire_obsolete(byid.values(),relevant,pressure)
    except Refusal as exc:
        if str(exc)!="retired_provenance_capacity_deferred":
            raise
        # Capacity exhaustion must not mutate the durable queue, discard
        # historical provenance, or repeatedly admit work it cannot store.
        durable=items()
        return {"status":"retired_provenance_capacity_deferred",
                "revision":durable["revision"],"new_admissions":0,
                "invalidated":0,"retired_with_provenance":0,
                "parked_same_model_blocked":0,
                "capacity_deferred":len(fresh),
                "tally":aggregate(durable["rows"])}
    byid={x["id"]:x for x in retained}
    added=0;deferred=0
    # Prioritize runnable work. The same immutable original/model/source ID
    # never receives a second admission; unsupported model misses stay blocked.
    for row in sorted(approved,key=lambda x:(
           x["priority_reason"]!="no_indexed_image",x["id"])):
        key=row["id"]
        if key in byid or retired_proof(row):continue
        if len(byid)>=LIMIT:
            deferred+=1
            continue
        byid[key]=row;added+=1
    if added or changed or retired:
        doc["revision"]+=1
        doc["rows"]=sorted(byid.values(),key=lambda x:(
            x["priority_reason"]!="no_indexed_image",x["id"]))
        atomic(QUEUE,doc)
        journal("producer_persisted","qualified_originals_from_private_catalog")
    return {"status":"qualified_priority_produced","revision":doc["revision"],
            "new_admissions":added,"invalidated":changed,
            "retired_with_provenance":retired,"parked_same_model_blocked":len(pressure),
            "capacity_deferred":deferred,
            "tally":aggregate(doc["rows"])}
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
       "source_sha256_verified_before_processing":False,
       "source_sha256_bound_to_private_catalog_before_processing":True,
       "queue_revision":doc["revision"]+1,"human_review_required":True,
       "identity_inference_performed":False,
       "original_recordings_modified":False,
       "review_decisions_modified":False}
    atomic(SECONDARY,new)
    return new
def consumer_visible(record):
    """Verify this exact revision is served by the ACTUAL Evidence Quality API.

    Reading/writing our own report file is insufficient downstream feedback.
    These are secondary face-content observations, never person identities.
    """
    with urllib.request.urlopen(
            "http://127.0.0.1:8795/new/api/evidence-quality",timeout=12) as response:
        check(response.status==200,"secondary_consumer_http_failed")
        data=response.read(6000001)
    check(len(data)<=6000000,"secondary_consumer_payload_unbounded")
    doc=json.loads(data)
    gap=doc.get("original_gap_benchmark")
    check(doc.get("ok") is True and isinstance(gap,dict)
          and gap.get("analysis_version")==ANALYSIS
          and gap.get("detector_model_sha256")==MODEL_SHA,
          "secondary_consumer_not_reading_current_report")
    # A matching filename/revision in an unqualified reader is just an echo.
    # The live consumer must prove it applied its original-catalog/queue
    # attestation and revocation gate before a queue task can be completed.
    check(gap.get("source_binding_status")=="source_qualified_active_queue_only"
          and type(gap.get("source_bound_records_visible")) is int
          and gap["source_bound_records_visible"]>=1
          and type(gap.get("source_bound_records_not_current")) is int
          and gap["source_bound_records_not_current"]>=0
          and gap.get("original_recordings_modified") is False
          and gap.get("identity_inference_performed") is False,
          "secondary_consumer_source_attestation_unavailable")
    records=gap.get("recordings")
    # Exact equality also rejects swapped/missing frame evidence under a
    # valid original SHA; merely matching the source revision is insufficient.
    check(isinstance(records,list) and any(
          item==record for item in records if isinstance(item,dict)),
          "source_bound_secondary_result_not_visible")
    # A qualified GET is not a completed *downstream* consumption. Invoke
    # V361 against a fresh native source view before acknowledging this task.
    # V361 independently reopens and hashes catalog, queue and latest quality
    # priorities before/after admission; never accept an old cached 200.
    q=load_module(EVIDENCE,"s9_evidence_quality_v1")
    consumer=load_module(ANONYMOUS_CONSUMER,
                         "s9_anonymous_evidence_consumer_v361")
    check(q.MODEL_SHA==MODEL_SHA and
          consumer.SCHEMA=="s9_anonymous_quality_consumption_v361",
          "anonymous_consumer_model_or_schema_mismatch")
    # The pinned reader module is the authority; prevent a Python import
    # shadowing it in the V361 module's global quality reference.
    consumer.quality=q
    saved=json.loads(q.fetch("http://127.0.0.1:8795/new/api/saved",6000000))
    native=q.validate_sources(saved)
    current={item["clip_no"]:item for item in native}
    check(len(current)==len(native),"anonymous_consumer_native_duplicate")
    status,receipt=consumer.consume(doc,current,record["clip_no"])
    if status==410:
        raise Refusal("anonymous_consumer_source_or_priority_revoked")
    check(status==200 and isinstance(receipt,dict),
          "anonymous_consumer_revalidation_unavailable")
    check(receipt.get("ok") is True and
          receipt.get("schema_version")==consumer.SCHEMA and
          receipt.get("source_binding_status")==
              "revalidated_original_and_queue_at_consumption" and
          receipt.get("eligibility")=="anonymous_quality_manual_review_only" and
          receipt.get("clip_no")==record["clip_no"] and
          receipt.get("source_sha256")==record["source_sha256"] and
          receipt.get("source_bytes")==record["source_bytes"] and
          receipt.get("source_revision")==record["source_revision"] and
          receipt.get("model_sha256")==record["model_sha256"] and
          receipt.get("analysis_version")==record["analysis_version"] and
          receipt.get("sample_count")==3 and
          receipt.get("sample_times_ms")==[x["time_ms"] for x in record["samples"]] and
          isinstance(receipt.get("evidence_revision_sha256"),str) and
          HEX.fullmatch(receipt["evidence_revision_sha256"]) and
          receipt.get("human_review_required") is True and
          receipt.get("verified_same_person") is False and
          receipt.get("pose_gait_measured") is False and
          receipt.get("appearance_evidence_eligible") is False and
          receipt.get("automatic_person_assignments")==0 and
          receipt.get("originals_modified") is False and
          receipt.get("review_decisions_modified") is False,
          "anonymous_consumer_receipt_inconsistent")
    # Never persist the precompletion SHA in the queue: the queue's own
    # processing -> completed transition necessarily changes its fingerprint.
    # Future consumers MUST request a fresh revision after completion.
    return True

def recover_expired_leases(doc, timestamp):
    """Durably recover a crashed worker even when no task can start."""
    recovered=0
    for row in doc["rows"]:
        if row["status"]!="processing" or row.get("lease_until",0)>=timestamp:
            continue
        attempts=row.get("attempts")
        check(type(attempts) is int and 0<=attempts<=MAX_ATTEMPTS,
              "expired_lease_attempt_count_invalid")
        row["status"]="pending" if attempts<MAX_ATTEMPTS else "dead_letter"
        row["last_reason"]="previous_worker_lease_expired"
        row["lease_until"]=0
        # Never hot-loop on expired reservations.
        row["next_attempt_at"]=timestamp+min(6*3600,60*2**max(0,attempts-1))
        recovered+=1
    if recovered:
        doc["revision"]+=1
        atomic(QUEUE,doc)
        journal("lease_recovered","expired_worker_recovery_persisted")
    return recovered

def work():
    doc=items()
    recovered=recover_expired_leases(doc,now())
    candidate=next((row for row in doc["rows"]
         if row["status"]=="pending"
         and row.get("next_attempt_at",0)<=now()),None)
    if candidate is None:
        return {"status":"no_runnable_originals","revision":doc["revision"],
           "leases_recovered":recovered,"tally":aggregate(doc["rows"])}
    # Acquire source/camera locks BEFORE taking a lease.
    check(CROSS_LOCK.is_file() and not CROSS_LOCK.is_symlink(),
          "s9_shared_backfill_lock_unavailable")
    check(IMAGE_LOCK.is_file() and not IMAGE_LOCK.is_symlink(),
          "evidence_quality_worker_lock_unavailable")
    with CROSS_LOCK.open("r") as c, IMAGE_LOCK.open("r") as image_lock:
        try:fcntl.flock(c,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise Refusal("s9_backfill_worker_busy") from None
        try:fcntl.flock(image_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise Refusal("evidence_quality_worker_busy") from None
        # A missing V361 backend contract cannot be repaired by decoding
        # the same original again. Refuse BEFORE hardware work/lease mutation.
        # Rescan resumes naturally when the independently installed module is
        # present and the existing thermal/idle/root gates pass.
        check(ANONYMOUS_CONSUMER.is_file() and
              not ANONYMOUS_CONSUMER.is_symlink() and
              100<ANONYMOUS_CONSUMER.stat().st_size<100000,
              "anonymous_consumer_unavailable_before_scan")
        camera_guard()
        candidate["status"]="processing";candidate["attempts"]+=1
        candidate["lease_until"]=now()+240
        candidate["last_reason"]="bounded_original_4k_rescan_started"
        doc["revision"]+=1
        atomic(QUEUE,doc);journal("processing","source_and_model_pinned")
        try:
            evidence=evaluate_one(candidate)
            publish(evidence,doc)
            consumer_visible(evidence)
            candidate["outcome"]={
              "sampled_frames":len(evidence["samples"]),
              "supported_face_observations":sum(len(x["face_candidates"])
                     for x in evidence["samples"]),
              "source_revision":candidate["media_revision"],
              "model_sha256":MODEL_SHA,
              "verified_secondary_report":True,
              "consumer_visibility_confirmed":True,
              "anonymous_v361_live_consumed_before_completion":True,
              "anonymous_v361_schema":"s9_anonymous_quality_consumption_v361"}
            candidate["status"]="completed"
            candidate["deferrals"]=0
            candidate["last_reason"]="verified_secondary_original_gap_evidence_published"
        except Exception as err:
            # Always retain prior human-reviewed/original evidence. A model
            # miss is not a negative-person or negative-identity decision.
            cause=str(err) if isinstance(err,Refusal) else "analysis_failed_or_unavailable"
            if cause in ("original_no_longer_eligible","source_changed_during_rescan",
                "source_revision_changed_after_analysis","model_version_changed_since_admission",
                "anonymous_consumer_source_or_priority_revoked"):
                candidate["status"]="rejected"
            elif (cause in ("camera_battery_thermal_recording_or_worker_exclusion",
                            "secondary_consumer_source_attestation_unavailable",
                            "secondary_consumer_not_reading_current_report",
                            "anonymous_consumer_revalidation_unavailable",
                            "anonymous_consumer_model_or_schema_mismatch",
                            "approved_worker_unavailable")
                  or isinstance(err,(urllib.error.URLError,TimeoutError,ConnectionError))):
                candidate["status"]="pending";candidate["attempts"]-=1
                candidate["deferrals"]=candidate.get("deferrals",0)+1
                if cause=="analysis_failed_or_unavailable":
                    cause="temporary_source_or_consumer_transport_unavailable"
                if candidate["deferrals"]>=MAX_TRANSIENT_DEFERRALS:
                    candidate["status"]="blocked"
                    cause="repeated_transient_dependency_unavailable"
            elif candidate["attempts"]>=MAX_ATTEMPTS:
                candidate["status"]="dead_letter"
            else:
                candidate["status"]="pending"
            candidate["last_reason"]=cause
            if candidate["status"]=="pending":
                backoff=(candidate["deferrals"]-1 if candidate.get("deferrals",0)
                         else candidate["attempts"]-1)
                candidate["next_attempt_at"]=now()+min(6*3600,60*2**max(0,backoff))
            else:
                candidate["next_attempt_at"]=0
        candidate["lease_until"]=0
        if candidate["status"]!="completed":
            candidate["outcome"]=None
        doc["revision"]+=1
        atomic(QUEUE,doc);journal(candidate["status"],candidate["last_reason"])
    return {"status":candidate["status"],"revision":doc["revision"],
         "attempts":candidate["attempts"],"tally":aggregate(doc["rows"]),
         "verified_secondary":bool((candidate.get("outcome") or {}).get("verified_secondary_report")),
         "consumer_visibility_confirmed":bool((candidate.get("outcome") or {}).get("consumer_visibility_confirmed"))}
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
