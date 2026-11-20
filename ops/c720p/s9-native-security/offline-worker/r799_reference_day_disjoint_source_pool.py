#!/usr/bin/env python3
"""R799 historical, unlabelled source-only retrospective research pool.

No identity inference, people labels, faces, crops or video bytes transferred
to C720P. Keeps original SHA and source name exclusively in a local 0600
private candidate manifest, not GitHub or public UI.

Qualified source means SHA-ledger/catalog agreement AND capture day
independence against all current research reference sources in BOTH
Europe/Amsterdam and UTC. Research-plan source originals are excluded.
This *cannot* establish prospective person known/unknown truth, disjoint
persons/outfits, real-model accuracy or unknown FAR; those flags remain false.

Optional --spotcheck 3 hashes 3 diverse originals ON THE PHONE with
lowest-priority SHA computation and a live-camera safety guard.
"""
from __future__ import annotations
import argparse,datetime as dt,hashlib,json,os,pathlib,subprocess,time
from collections import defaultdict
import r758_capture_day_leakage_audit as split

PHONE=split.PHONE
ROOT="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
DEST=pathlib.Path("/home/jespern/c720p-home-hub/staging/recognition-r744-ain-small-model-assets-20261120")
MAX_SOURCE_BYTES=240_000_000
APK="nl.kalenel.s9security"

def need(ok,why):
    if not ok:raise ValueError(why)

def pool(catalog,ledger,rows,by_source,now):
    need(type(catalog) is dict and type(ledger) is dict and
         type(rows) is list and type(by_source) is dict,
         "invalid_source_catalog_or_plan")
    refs={r["source_sha256"] for r in rows if r.get("role")=="reference"}
    research={r["source_sha256"] for r in rows}
    need(refs and research and refs<=set(by_source),
         "reference_source_version_verification_required")
    ref_days_l={by_source[s]["capture_day_local"] for s in refs}
    ref_days_u={by_source[s]["capture_day_utc"] for s in refs}
    selected=[];seen=set();excluded_research=0;excluded_days=0
    stale=0
    for name,rec in sorted(catalog["records"].items()):
        if not split.CLIP.fullmatch(name):continue
        sha=rec.get("manifest",{}).get("sha256")
        need(split.metadata.sha_valid(sha) and sha not in seen,
             "duplicate_or_invalid_original_sha")
        seen.add(sha)
        manifest=rec["manifest"]
        need(manifest.get("name")==name and
             manifest.get("sha256")==sha and
             manifest.get("bytes")==rec.get("bytes") and
             manifest.get("width")==3840 and
             manifest.get("height")==2160 and
             type(rec.get("bytes")) is int and
             100_000<=rec["bytes"]<=MAX_SOURCE_BYTES,
             "source_catalog_full4k_manifest_inconsistent")
        day_l=split.source_day(name,split.AMSTERDAM)
        day_u=split.source_day(name,split.UTC)
        if day_l in ref_days_l or day_u in ref_days_u:
            excluded_days+=1;continue
        if sha in research:
            excluded_research+=1;continue
        proof=ledger["checks"].get(name)
        need(type(proof) is dict and
             proof.get("original_sha256_matches") is True and
             proof.get("catalog_version")==rec["version"] and
             split.metadata.sha_valid(rec["version"]),
             "source_sha_ledger_not_proven_for_candidate")
        age=now-proof.get("checked_epoch",-1e30)
        need(type(age) in (int,float) and 0<=age<365*86400,
             "invalid_or_future_recheck_time")
        fresh=age<=14*86400
        stale+=int(not fresh)
        selected.append({
          "original_name":name,"original_sha256":sha,
          "catalog_version":rec["version"],
          "bytes":rec["bytes"],"local_day":day_l,"utc_day":day_u,
          "ledger_recheck_fresh_14d":fresh,
          "historical_source_only_no_identity_label":True,
          "prospective_person_truth_validated":False})
    need(selected,"zero_independent_day_sources")
    return {
        "schema":"s9_r799_historical_originals_day_disjoint_unlabelled_pool_v1",
        "total_current_catalog_originals":len(catalog["records"]),
        "research_reference_original_sha_count":len(refs),
        "research_reference_capture_days_local":len(ref_days_l),
        "research_reference_capture_days_utc":len(ref_days_u),
        "historical_source_day_disjoint_unlabelled_candidates":len(selected),
        "candidate_capture_days_local":len({v["local_day"] for v in selected}),
        "candidate_capture_days_utc":len({v["utc_day"] for v in selected}),
        "candidate_ledger_checked_older_than_14d":stale,
        "candidate_ledger_checked_within_14d":len(selected)-stale,
        "excluded_research_originals_on_candidate_days":excluded_research,
        "excluded_reference_capture_days_originals":excluded_days,
        "selected":selected,
        "identity_or_embeddings_loaded":0,
        "recordings_original_pixels_transferred":0,
        "verified_known_person_test_labels":0,
        "verified_unknown_person_test_labels":0,
        "automated_folder_filing_authorized":False,
    }

def safe_status():
    import urllib.request
    with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=3) as x:
        s=json.loads(x.read(500_000))
    p=subprocess.run(["adb","-s",PHONE,"shell","pidof "+APK],
                      capture_output=True,text=True,timeout=7)
    need(p.returncode==0 and p.stdout.strip().isdigit(),
         "production_camera_process_not_running")
    need(s.get("mode")=="watching" and s.get("preroll_ready") is True and
         s.get("sensor_result_fps",0)>=29 and s.get("sensor_result_fps",0)<=31 and
         s.get("temperature_c",99)<38 and
         s.get("preroll_dropped_frames")==0 and s.get("failed")==0 and
         not s.get("last_error"),"camera_not_safely_watching")
    return p.stdout.strip()

def spotcheck(doc,n):
    need(n in (0,3),"source_only_spotcheck_count_must_be_zero_or_three")
    if not n:return []
    days=defaultdict(list)
    for v in doc["selected"]:
        if 10_000_000<=v["bytes"]<=65_000_000:
            days[v["local_day"]].append(v)
    date_list=sorted(days)
    need(len(date_list)>=3,"independent_capture_days_not_available")
    indexes=sorted(set([0,len(date_list)//2,len(date_list)-1]))
    need(len(indexes)==3,"source_day_selection_wrong")
    chosen=[min(days[date_list[i]],key=lambda x:x["bytes"]) for i in indexes]
    results=[]
    pid=safe_status()
    for v in chosen:
        need(safe_status()==pid,"recording_process_changed_before_sha")
        name=v["original_name"]
        need(split.CLIP.fullmatch(name),"unexpected_video_filename")
        command="nice -n 19 sha256sum "+ROOT+"/"+name
        proc=subprocess.run(["adb","-s",PHONE,"shell",command],
                             capture_output=True,text=True,timeout=24)
        need(proc.returncode==0 and
             len(proc.stdout.split())>=2 and
             proc.stdout.split()[0]==v["original_sha256"],
             "original_source_physical_sha_mismatch")
        need(safe_status()==pid,"production_camera_health_changed_during_sha")
        results.append({"capture_day":v["local_day"],
                        "source_sha256":v["original_sha256"],
                        "source_bytes":v["bytes"],
                        "phone_sha_reverified_now":True,
                        "live_capture_priority_preserved":True})
    return results

def synth():
    import copy
    sha=["%064x"%i for i in range(1,6)]
    t=dt.datetime(2026,11,18,12,tzinfo=dt.timezone.utc)
    names=[
        "motion_"+str(int((t+dt.timedelta(days=i)).timestamp()*1000))+".mp4"
        for i in range(5)]
    def record(n,i):
        return {"version":sha[i],"bytes":20_000_000,
                "manifest":{"name":n,"sha256":sha[i],
                            "bytes":20_000_000,"width":3840,"height":2160}}
    records={n:record(n,i) for i,n in enumerate(names)}
    catalog={"records":records}
    clock=t.timestamp()+5*86400+100
    ledger={"checks":{n:{"original_sha256_matches":True,
                          "catalog_version":sha[i],
                          "checked_epoch":clock-100}
                      for i,n in enumerate(names)}}
    rows=[{"role":"reference","source_sha256":sha[0]},
          {"role":"heldout","source_sha256":sha[1]}]
    by={sha[0]:{"capture_day_local":"2026-11-18",
               "capture_day_utc":"2026-11-18"}}
    r=pool(catalog,ledger,rows,by,clock)
    need(r["historical_source_day_disjoint_unlabelled_candidates"]==3
         and r["excluded_research_originals_on_candidate_days"]==1
         and r["verified_known_person_test_labels"]==0,
         "cross_date_unlabelled_source_selection_wrong")
    rejected=0
    variations=[
        ("bad_ledger",lambda c,l: l["checks"][names[3]].update(
            original_sha256_matches=False)),
        ("bad_geometry",lambda c,l: c["records"][names[2]]["manifest"].update(
            width=640)),
        ("duplicate_sha",lambda c,l: c["records"][names[4]]["manifest"].update(
            sha256=sha[2])),
        ("version_not_bound",lambda c,l: l["checks"][names[4]].update(
            catalog_version=sha[0])),
        ("untrusted_bytes",lambda c,l: c["records"][names[4]].update(
            bytes=300_000_000)),
    ]
    for name,mutate in variations:
        c,l=copy.deepcopy(catalog),copy.deepcopy(ledger)
        mutate(c,l)
        try:pool(c,l,rows,by,clock)
        except (ValueError,KeyError):rejected+=1
        else:raise AssertionError("unsafe_candidate_source_accepted_"+name)
    need(rejected==len(variations),"not_all_negative_cases_refused")
    print(json.dumps({
        "result":"R799_HISTORICAL_SOURCE_DAY_POOL_SYNTHETIC_PASS",
        "negative_cases":rejected,
        "source_capture_date_disjointness_local_and_utc_required":True,
        "existing_source_provenance_verified":True,
        "historical_source_labels_promoted":False,
        "new_scheduled_tasks_created":0,
        "auto_filing_authorized":False},sort_keys=True))

def audit(n):
    now=time.time()
    cat=split.load_json(split.CATALOG,now,3600)
    summary=split.load_json(split.SUMMARY,now,3600)
    ledger=split.load_json(split.LEDGER)
    rows=split.phone_rows()
    by=split.validate_catalog(cat,summary,ledger,rows,now)
    doc=pool(cat,ledger,rows,by,now)
    checked=spotcheck(doc,n)
    doc["phone_sha_spotchecks_current_camera_process"]=checked
    doc["source_only_curation_historical_not_prospective"]=True
    doc["owner_verified_independent_known_and_unknown_truth_available"]=False
    doc["captured_at_utc"]=dt.datetime.now(dt.timezone.utc).isoformat()
    DEST.mkdir(exist_ok=True)
    filename=DEST/("r799_private_unlabelled_day_disjoint_originals_"+
        dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".json")
    raw=(json.dumps(doc,indent=2,sort_keys=True)+"\n").encode()
    need(len(raw)<450_000,"private_manifest_not_bounded")
    f=os.open(filename,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
    with os.fdopen(f,"wb") as out:
        out.write(raw);out.flush();os.fsync(out.fileno())
    summary={k:v for k,v in doc.items() if k not in
             ("selected","phone_sha_spotchecks_current_camera_process")}
    summary["phone_sha_spotchecks_now"]=len(checked)
    summary["spotchecked_capture_days_distinct"]=len(
        {x["capture_day"] for x in checked})
    summary["private_manifest_source_rows"]=len(doc["selected"])
    summary["private_manifest_sha256"]=hashlib.sha256(raw).hexdigest()
    print(json.dumps(summary,sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    m=p.add_mutually_exclusive_group(required=True)
    m.add_argument("--self-test",action="store_true")
    m.add_argument("--audit-live",action="store_true")
    p.add_argument("--spotcheck",type=int,default=0)
    args=p.parse_args()
    if args.self_test:
        need(args.spotcheck==0,"self_test_must_not_reach_phone")
        synth()
    else:audit(args.spotcheck)
if __name__=="__main__":main()
