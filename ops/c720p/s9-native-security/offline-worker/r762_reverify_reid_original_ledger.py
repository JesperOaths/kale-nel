#!/usr/bin/env python3
"""R762: bounded camera-priority on-S9 SHA refresh of research original files.

Updates ONLY the existing standalone original SHA evidence ledger after
verifying exact original bytes ON S9+ against a current catalog source SHA.
No video/frame transfer, decoding, identity matching, folder labels or model
work. Never deletes originals. No new schedule/service. Compatible with the
existing ledger writer's fcntl lock and JSON schema.

An exact private ledger backup is made once before any refresh; all changes
are atomic, 0600 and confined to the same 756-source evidence JSON.
"""
from __future__ import annotations
import argparse,datetime as dt,fcntl,hashlib,json,os,re,subprocess,tempfile,time
from pathlib import Path

import r758_capture_day_leakage_audit as audit
import s9_reid_capture_admission_v742 as admission

ROOT=Path("/home/jespern/c720p-home-hub/state")
LEDGER=ROOT/"s9-original-hash-ledger-v1.json"
BACKUP=ROOT/"s9-original-hash-ledger-v1.json.before-r762-20261120"
LOCK=LEDGER.with_suffix(".lock")
PHONE="192.168.178.250:5555"
SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
FULL_SHA=re.compile(r"[a-f0-9]{64}\Z")
RECHECK=14*86400
MAX_SECONDS=28

def need(good,reason):
    if not good:raise ValueError(reason)

def json_bytes(x):
    return (json.dumps(x,sort_keys=True,separators=(",",":"))+"\n").encode()

def sha(data):
    return hashlib.sha256(data).hexdigest()

def verified_plan(catalog,ledger,rows,now):
    need(catalog.get("schema_version")=="s9_native_archive_catalog_v1" and
         ledger.get("schema_version")=="s9-original-hash-ledger-v1",
         "unrecognized_catalog_or_ledger")
    bysha={}
    for name,rec in catalog.get("records",{}).items():
        if not audit.CLIP.fullmatch(name):continue
        manifest=rec.get("manifest",{})
        original=manifest.get("sha256")
        need(audit.metadata.sha_valid(original),"invalid_catalog_sha")
        need(original not in bysha,"duplicate_original_source_sha")
        bysha[original]=(name,rec)
    research={x["source_sha256"]:x["source_version"] for x in rows}
    need(0<len(research)<=300,"untrusted_research_source_count")
    due=[]
    all_verified=0
    for digest,version in sorted(research.items()):
        need(digest in bysha,"missing_research_original_from_current_catalog")
        name,entry=bysha[digest]
        need(entry.get("version")==version and
             entry.get("manifest",{}).get("name")==name and
             entry.get("manifest",{}).get("bytes")==entry.get("bytes"),
             "research_source_revision_not_current")
        record=ledger.get("checks",{}).get(name,{})
        need(record.get("catalog_version")==version and
             record.get("original_sha256_matches") is True,
             "previously_failed_or_missing_source_proof_requires_independent_investigation")
        checked=record.get("checked_epoch")
        need(type(checked) in (int,float) and checked>=0 and checked<=now+120,
             "invalid_integrity_ledger_timestamp")
        all_verified+=1
        if now-checked>RECHECK:
            need(1_000_000<=entry.get("bytes",0)<=240_000_000,
                 "unbounded_original_media_size")
            due.append((checked,digest,name,entry))
    due.sort(key=lambda x:(x[0],x[1]))
    return due,all_verified

def camera_safe():
    s=admission.camera_status();p=admission.phone_status()
    problems=admission.inspect_camera(s)+admission.inspect_phone(p)
    age=s.get("person_last_accepted_motion_age_ms")
    if type(age) is not int or age<90000:
        problems.append("recent_person_motion_priority")
    if s.get("capture_segment_continuation_pending") is not False:
        problems.append("pending_capture_segment")
    return s,p,problems

def phone_hash(name,sha_expected,seconds=16):
    need(audit.CLIP.fullmatch(name) and FULL_SHA.fullmatch(sha_expected),
         "untrusted_original_source_name_or_sha")
    path=SD+"/"+name
    command="nice -n 19 sha256sum "+path
    p=subprocess.Popen(["adb","-s",PHONE,"shell",command],
                       stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    started=time.monotonic();bad=[]
    while p.poll() is None and time.monotonic()-started<seconds:
        try:
            _,_,camera_faults=camera_safe()
            if camera_faults:
                bad=camera_faults
                p.terminate()
                break
        except (OSError,ValueError,TimeoutError,Exception) as e:
            bad=["camera_status_unavailable_"+type(e).__name__]
            p.terminate()
            break
        time.sleep(.28)
    if p.poll() is None:
        bad.append("source_hash_deadline_exceeded")
        p.terminate()
    try:out,err=p.communicate(timeout=3)
    except subprocess.TimeoutExpired:
        p.kill();out,err=p.communicate(timeout=3)
    if bad:return None,"capture_priority"
    if p.returncode!=0:return None,"s9_sha256_failed"
    fields=out.strip().split()
    if len(fields)!=2 or fields[1]!=path or FULL_SHA.fullmatch(fields[0]) is None:
        return None,"untrusted_hash_output"
    return fields[0]==sha_expected,None

def one_time_backup():
    need(LEDGER.is_file() and not LEDGER.is_symlink() and
         100<LEDGER.stat().st_size<1024*1024,
         "original_ledger_missing_or_unsafe")
    raw=LEDGER.read_bytes()
    need(json.loads(raw).get("schema_version")=="s9-original-hash-ledger-v1",
         "existing_ledger_schema_bad")
    if BACKUP.exists():
        need(BACKUP.is_file() and not BACKUP.is_symlink() and
             100<BACKUP.stat().st_size<1024*1024,
             "existing_backup_invalid")
        return sha(BACKUP.read_bytes())
    fd=os.open(BACKUP,os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o600)
    with os.fdopen(fd,"wb") as f:
        f.write(raw);f.flush();os.fsync(f.fileno())
    need(BACKUP.read_bytes()==raw,"backup_verification_failed")
    return sha(raw)

def save(ledger,catalog_count,now):
    checks=ledger["checks"]
    ledger.update({
        "last_check_utc":dt.datetime.fromtimestamp(now,dt.timezone.utc).isoformat(),
        "checked_matching":sum(x.get("original_sha256_matches") is True for x in checks.values()),
        "mismatches_needing_review":sum(x.get("original_sha256_matches") is False for x in checks.values()),
        "phone_catalog_recordings":catalog_count,
        "originals_modified":False,
        "review_decisions_modified":False,
        "videos_transferred_to_hub":False,
        "automatic_quarantine":False,
    })
    raw=json_bytes(ledger)
    need(len(raw)<1024*1024,"updated_ledger_too_large")
    fd,tmp=tempfile.mkstemp(prefix=".s9-r762-verified-original-",dir=ROOT)
    try:
        with os.fdopen(fd,"wb") as f:
            f.write(raw);f.flush();os.fsync(f.fileno())
        os.chmod(tmp,0o600)
        need(not LEDGER.is_symlink(),"ledger_destination_symlink")
        os.replace(tmp,LEDGER)
        dir_fd=os.open(ROOT,os.O_RDONLY)
        try:os.fsync(dir_fd)
        finally:os.close(dir_fd)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def run(max_items,dry):
    need(type(max_items) is int and 1<=max_items<=8,
         "bounded_item_count_required")
    with LOCK.open("a+") as control:
        try:fcntl.flock(control,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"status":"REFUSED_EXISTING_LEDGER_WORKER_ACTIVE"}))
            return
        now=time.time()
        catalog=audit.load_json(audit.CATALOG,now,audit.MAX_CATALOG_AGE_SEC)
        summary=audit.load_json(audit.SUMMARY,now,audit.MAX_CATALOG_AGE_SEC)
        need(summary.get("catalog_snapshot_id")==catalog.get("snapshot_id") and
             summary.get("camera_4k_healthy_before_and_after") is True,
             "untrusted_camera_catalog_snapshot")
        ledger=audit.load_json(LEDGER)
        rows=audit.phone_rows()
        due,total=verified_plan(catalog,ledger,rows,now)
        if dry:
            print(json.dumps({
                "status":"R762_READ_ONLY_DRY_RUN",
                "research_original_sources":total,
                "research_sources_older_than_14d":len(due),
                "bounded_next_phone_checks":min(max_items,len(due)),
                "production_ledger_mutated":False,
                "identities_read":0},sort_keys=True))
            return
        if not due:
            print(json.dumps({"status":"R762_ALREADY_CURRENT",
                "research_sources":total,
                "source_hashes_checked_this_run":0},sort_keys=True))
            return
        before,pb,errors=camera_safe()
        if errors:
            print(json.dumps({"status":"R762_REFUSED_CAMERA_PRIORITY",
                "reasons":errors,"source_hashes_checked_this_run":0},sort_keys=True))
            return
        backup_sha=one_time_backup()
        successes=0;mismatch=False;reason=None
        started=time.monotonic()
        for timestamp,digest,name,entry in due[:max_items]:
            if time.monotonic()-started>MAX_SECONDS:
                reason="bounded_run_time_reached"
                break
            b,phone,issues=camera_safe()
            if issues:reason="camera_became_busy_or_unhealthy";break
            observed,error=phone_hash(name,digest)
            after,phone_after,issues=camera_safe()
            if error or issues or phone["recorder_pid"]!=phone_after["recorder_pid"] or (
                    after["preroll_dropped_frames"]!=b["preroll_dropped_frames"]):
                reason=error or "camera_continuity_changed";break
            now_updated=time.time()
            ledger["checks"][name]={
                "catalog_version":entry["version"],
                "checked_epoch":now_updated,
                "original_sha256_matches":observed,
            }
            successes+=bool(observed)
            if not observed:
                mismatch=True;reason="SOURCE_SHA_MISMATCH_DO_NOT_USE";break
        if successes or mismatch:
            save(ledger,len(catalog["records"]),time.time())
        print(json.dumps({
            "status":"R762_SOURCE_SHA_MISMATCH_STOP" if mismatch else
                     ("R762_INTERRUPTED_SAFELY" if reason else
                      "R762_REFRESHED_RESEARCH_SOURCES"),
            "research_sources":total,
            "overdue_before":len(due),
            "source_hashes_refreshed":successes,
            "overdue_estimated_remaining":len(due)-successes,
            "camera_priority_interrupt_reason":reason,
            "ledger_backup_sha256_prefix":backup_sha[:16],
            "originals_modified":False,
            "identity_labels_read":0,
            "video_bytes_exported":0,
            "new_scheduled_tasks":0,
            "automatic_people_folder_filing_enabled":False,
        },sort_keys=True))

def test():
    a,b="a"*64,"b"*64
    first="motion_1794900000000.mp4"
    second="motion_1794986400000.mp4"
    def e(n,h):
        return {"version":h,"bytes":40_000_000,
                "manifest":{"name":n,"sha256":h,"bytes":40_000_000}}
    catalog={"schema_version":"s9_native_archive_catalog_v1",
             "records":{first:e(first,a),second:e(second,b)}}
    now=1795120000.0
    ledger={"schema_version":"s9-original-hash-ledger-v1",
            "checks":{first:{"catalog_version":a,"original_sha256_matches":True,
                              "checked_epoch":now-16*86400},
                      second:{"catalog_version":b,"original_sha256_matches":True,
                               "checked_epoch":now-200}}}
    rows=[{"source_sha256":a,"source_version":a},
          {"source_sha256":b,"source_version":b}]
    due,total=verified_plan(catalog,ledger,rows,now)
    need(total==2 and len(due)==1 and due[0][1]==a,
         "stale_source_priority_selection_bad")
    corrupted={**ledger,"checks":dict(ledger["checks"])}
    corrupted["checks"][first]={**corrupted["checks"][first],
                                 "catalog_version":b}
    try:verified_plan(catalog,corrupted,rows,now)
    except ValueError:pass
    else:raise AssertionError("wrong_catalog_version_passed")
    corrupted["checks"][first]={**ledger["checks"][first],
                                 "original_sha256_matches":False}
    try:verified_plan(catalog,corrupted,rows,now)
    except ValueError:pass
    else:raise AssertionError("previous_mismatch_auto_promotion")
    print(json.dumps({"status":"R762_SYNTHETIC_BOUNDED_DIGEST_GATE_PASS",
                      "cases":3,"video_bytes_copied":0,
                      "people_assignments":0},sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    g=p.add_mutually_exclusive_group(required=True)
    g.add_argument("--self-test",action="store_true")
    g.add_argument("--dry-run",action="store_true")
    g.add_argument("--refresh",action="store_true")
    p.add_argument("--max-items",type=int,default=6)
    a=p.parse_args()
    if a.self_test:test()
    else:run(a.max_items,a.dry_run)

if __name__=="__main__":
    main()
