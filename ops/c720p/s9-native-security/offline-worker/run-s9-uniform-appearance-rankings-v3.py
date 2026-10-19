#!/usr/bin/env python3
"""Build and run immutable phone-side uniform HSV32 + pretrained OSNet rankings V2.

All 512D biometric/appearance feature vectors stay on the private S9+ worker.
The hub receives only provenance mapping: source-qualified crop SHA->filename.
V1 ranking output is never opened for write or deleted.
"""
import argparse
import fcntl
from collections import Counter
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import zipfile
import urllib.request

PHONE="192.168.178.250:5555"
ROOT="/data/local/tmp/s9_worker"
STATE_DIR=Path("/home/jespern/c720p-home-hub/state")
BASELINE_V2_MAP=STATE_DIR/"s9-multivector-crop-map-v2.json"
ANDROID=os.environ.get("S9_ANDROID_SDK_JAR","/usr/lib/android-sdk/platforms/android-36/android.jar")
VISUAL="ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d"
HEX=re.compile(r"[a-f0-9]{64}\Z")
SCHEMA="s9_uniform_upper_torso_hsv32_v2"
CAPTURE_STATUS="http://127.0.0.1:18808/status"
MAX_RANK_START_TEMP_C=39.5



def digest(content):return hashlib.sha256(content).hexdigest()


def phone(*args,timeout=70,required=True):
    proc=subprocess.run(["adb","-s",PHONE,*args],capture_output=True,
                        text=True,timeout=timeout)
    if required and proc.returncode:
        raise RuntimeError("Phone action failed "+str(proc.returncode)+": "+
                           proc.stderr[-210:])
    return proc.stdout.strip()


def exec_local(args,timeout=100):
    result=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
    if result.returncode:
        raise RuntimeError("Local tool "+args[0]+" failed: "+result.stderr[-240:])
    return result.stdout.strip()


def verified_ready_subset(module,inventory):
    """Include only complete on-phone descriptor pairs; never synthesize data.

    Missing histogram files are pending backfill, not corrupt records. A
    nonempty malformed histogram or 512D sidecar still fails closed. Original
    V2 baseline retention is checked independently before any index writes.
    """
    if not isinstance(inventory,list) or len(inventory)>400:
        raise RuntimeError("Unbounded source-qualified crop inventory")
    ready=[]
    for row in inventory:
        if not isinstance(row,dict):
            raise RuntimeError("Invalid source inventory record")
        key=row.get("key");crop=row.get("crop_sha256")
        if (not isinstance(key,str) or not HEX.fullmatch(key)
            or not isinstance(crop,str) or not HEX.fullmatch(crop)
            or row.get("cohort") not in ("v40","approved_new","archive_unassigned")):
            raise RuntimeError("Invalid source qualified descriptor provenance")
        hsv_path=ROOT+"/features/"+key+"-hsv-v2.json"
        if not module.remote_exists(hsv_path):
            continue
        # The 76-crop inventory may contain a new V40 HSV32 descriptor
        # whose OSNet 512-D companion has not been completed yet. Confirm
        # ABSENCE via the transport-safe remote_exists check; never mistake
        # it for a corrupt present file or allow it to satisfy the 57
        # immutable V2 references. A future cool-window backfill may fill
        # the missing visual descriptor without overwriting existing HSV.
        visual_path=ROOT+"/features/"+key+"-visual.json"
        if not module.remote_exists(visual_path):
            continue
        module.safe_visual(key,crop)
        hsv=module.phone_json(hsv_path)
        values=hsv.get("upper_hsv32")
        if (hsv.get("schema")!=SCHEMA
            or hsv.get("source_qualified_key")!=key
            or hsv.get("crop_sha256")!=crop
            or hsv.get("method")!="hue8_saturation2_value2_center_torso_v2"
            or hsv.get("verified_same_person") is not False
            or hsv.get("identity_probability") is not False
            or not isinstance(values,list) or len(values)!=32
            or not all(type(x) in (float,int) and math.isfinite(x) and 0<=x<=1
                       for x in values)
            or abs(sum(values)-1)>0.0001
            or hsv.get("human_review_required") is not True):
            raise RuntimeError("Malformed existing real phone uniform HSV32 descriptor")
        visual_sha=existing_sha(ROOT+"/features/"+key+"-visual.json")
        hsv_sha=existing_sha(hsv_path)
        if (not isinstance(visual_sha,str) or not HEX.fullmatch(visual_sha)
            or not isinstance(hsv_sha,str) or not HEX.fullmatch(hsv_sha)):
            raise RuntimeError("Unverified source descriptor digest")
        complete=dict(row)
        complete["visual_sidecar_sha256"]=visual_sha
        complete["hsv_sidecar_sha256"]=hsv_sha
        ready.append(complete)
    return ready


def source_inventory():
    helper=Path(__file__).with_name("backfill-s9-hsv32-uniform-v2.py")
    spec=importlib.util.spec_from_file_location("s9_v2_uniform_catalog",helper)
    module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module
    spec.loader.exec_module(module)
    all_rows=module.inventory(include_unreviewed=True)
    rows=verified_ready_subset(module,all_rows)
    cohort=Counter(x["cohort"] for x in rows)
    if (not 58<=len(rows)<=400 or cohort["v40"]<51
        or cohort["approved_new"]<6
        or sum(cohort.values())!=len(rows)
        or any(x not in {"v40","approved_new","archive_unassigned"} for x in cohort)):
        raise RuntimeError("V3 requires complete original V2 references plus one extra real descriptor")
    return rows


def verified_v2_baseline(rows):
    """V3 must include every original V2 crop key, SHA and source identity."""
    if (BASELINE_V2_MAP.is_symlink() or not BASELINE_V2_MAP.is_file()
        or not 128<=BASELINE_V2_MAP.stat().st_size<=600000):
        raise RuntimeError("Immutable V2 reference map unavailable")
    data=BASELINE_V2_MAP.read_bytes()
    doc=json.loads(data)
    old=doc.get("rows")
    if (doc.get("schema")!="s9_multivector_source_map_v2"
        or doc.get("visual_model_sha256")!=VISUAL
        or doc.get("color_histogram_schema")!=SCHEMA
        or doc.get("people_assigned_automatically")!=0
        or not isinstance(old,list) or len(old)!=57
        or Counter(x.get("cohort") for x in old if isinstance(x,dict))!={"v40":51,"approved_new":6}):
        raise RuntimeError("Invalid historical V2 reference baseline")
    current={x["key"]:x for x in rows}
    seen=set()
    for item in old:
        if not isinstance(item,dict):
            raise RuntimeError("Malformed V2 baseline row")
        key=item.get("key")
        if (not isinstance(key,str) or not HEX.fullmatch(key)
            or item.get("source")!="s9_sd" or key in seen):
            raise RuntimeError("Invalid immutable V2 source key")
        seen.add(key)
        row=current.get(key)
        if (not isinstance(row,dict)
            or any(row.get(attr)!=item.get(attr)
                   for attr in ("clip","crop_sha256","cohort"))
            or item.get("cohort") not in ("v40","approved_new")):
            raise RuntimeError("Missing or altered original V2 source reference")
    return digest(data)


def compile_ranker(base):
    for name in ("S9AppearanceRankingWorkerV3.java","PhoneOfflineSimilarity.java"):
        if not Path(__file__).with_name(name).is_file():
            raise RuntimeError("V2 scoring source missing: "+name)
    if not Path(ANDROID).is_file():
        raise RuntimeError("C720P Android SDK unavailable")
    classes=base/"classes";classes.mkdir()
    exec_local(["javac","-source","8","-target","8","-cp",ANDROID,
       "-d",str(classes),
       str(Path(__file__).with_name("S9AppearanceRankingWorkerV3.java")),
       str(Path(__file__).with_name("PhoneOfflineSimilarity.java"))],90)
    dex=base/"dex";dex.mkdir()
    compiled=list(classes.rglob("*.class"))
    if len(compiled)<3:raise RuntimeError("Missing phone ranking comparator classes")
    exec_local(["d8","--min-api","28","--output",str(dex),
                *[str(p) for p in compiled]],100)
    jar=base/"s9-ranking-v3-400-worker.jar"
    # Deterministic archive to permit repeatable append-only snapshot staging.
    info=zipfile.ZipInfo("classes.dex",date_time=(1980,1,1,0,0,0))
    info.compress_type=zipfile.ZIP_DEFLATED
    info.external_attr=(0o600<<16)
    with zipfile.ZipFile(jar,"w") as archive:
        archive.writestr(info,(dex/"classes.dex").read_bytes())
    if not 1000<jar.stat().st_size<300000:
        raise RuntimeError("Unexpected v2 DEX size")
    return jar


def capture_rank_safe():
    """Only run private O(N²) ranking when live continuous-4K capture is safe."""
    with urllib.request.urlopen(CAPTURE_STATUS,timeout=12) as response:
        if response.status!=200:
            raise RuntimeError("capture_status_unavailable")
        content=response.read(150001)
    if len(content)>150000:
        raise RuntimeError("capture_status_unbounded")
    data=json.loads(content)
    if not isinstance(data,dict):raise RuntimeError("capture_status_untrusted")
    temp=data.get("temperature_c")
    if type(temp) not in (int,float) or not math.isfinite(temp):
        raise RuntimeError("capture_temperature_untrusted")
    if temp>MAX_RANK_START_TEMP_C:
        raise RuntimeError("capture_too_warm_for_ranker")
    if (data.get("ok") is not True
        or data.get("mode")!="watching"
        or data.get("native_4k_enabled") is not True
        or data.get("continuous_4k_production_persisted") is not True
        or data.get("continuous_4k_ready") is not True
        or data.get("preroll_version")!="continuous_native_4k_h264_ring_v1"
        or type(data.get("continuous_4k_buffered_ms")) is not int
        or data["continuous_4k_buffered_ms"]<5000
        or data.get("continuous_4k_dropped_output_frames")!=0
        or bool(data.get("continuous_4k_error"))
        or any(data.get(k) is True for k in
           ("face_backfill_queued","historical_import_queued",
            "movement_4k_backfill_queued","appearance_backfill_queued",
            "garden_archive_triage_queued"))):
        raise RuntimeError("capture_not_idle_4k_ring_healthy")
    # Do not confuse the separate inactive GardenPreRoll with the 4K ring.
    return data


def phone_temperature_c():
    response=phone("shell","dumpsys battery",timeout=18)
    match=re.search(r"temperature:\s*(\d+)",response)
    if match is None:raise RuntimeError("S9+ battery temperature missing")
    measured=int(match.group(1))/10
    if measured>MAX_RANK_START_TEMP_C:raise RuntimeError("S9+ above cool ranking temperature; no run")
    return measured


def existing_sha(path):
    result=subprocess.run(["adb","-s",PHONE,"shell","test -s "+path],
                          capture_output=True,text=True,timeout=15)
    if result.returncode==1 and not result.stderr.strip():
        return None
    if result.returncode!=0:
        raise RuntimeError("S9 ranker sidecar presence indeterminate")
    fields=phone("shell","sha256sum "+path,timeout=30).split()
    if len(fields)<2 or not HEX.fullmatch(fields[0]):
        raise RuntimeError("S9 ranker sidecar checksum malformed")
    return fields[0]


def stage(remote,local):
    data=local.read_bytes()
    want=digest(data)
    current=existing_sha(remote)
    if current is not None:
        if current!=want:
            raise RuntimeError("Private versioned artifact differs, never overwrite")
        return False
    tmp=remote+".pending"
    phone("push",str(local),tmp,timeout=65)
    if existing_sha(tmp)!=want:
        raise RuntimeError("S9 worker artifact SHA mismatch")
    phone("shell","mv "+tmp+" "+remote+"; chmod 600 "+remote,timeout=25)
    if existing_sha(remote)!=want:
        raise RuntimeError("S9 final staged artifact checksum mismatch")
    return True


def write_private_map(data,corpus_id):
    STATE=STATE_DIR/("s9-multivector-crop-map-v3-"+corpus_id+".json")
    if STATE.is_symlink():raise RuntimeError("Provenance map symlink")
    if STATE.exists():
        if digest(STATE.read_bytes())!=digest(data):
            raise RuntimeError("Existing v2 source map differs, refusing overwrite")
        return False
    STATE.parent.mkdir(parents=True,exist_ok=True)
    fd,path=tempfile.mkstemp(prefix=".s9-v2-map-",dir=STATE.parent)
    try:
        with os.fdopen(fd,"wb") as output:
            output.write(data);output.flush();os.fsync(output.fileno())
        os.chmod(path,0o600)
        os.replace(path,STATE)
    finally:
        if os.path.exists(path):os.unlink(path)
    return True


def publish_verified_active(corpus_id,index_sha,map_sha,records):
    """Promote only completed snapshots; historical v1/v2 maps stay immutable."""
    if not re.fullmatch(r"[a-f0-9]{16}",corpus_id):
        raise RuntimeError("Invalid content-addressed v3 corpus ID")
    if not all(HEX.fullmatch(x) for x in (index_sha,map_sha)):
        raise RuntimeError("Missing v3 ranking or mapping checksum")
    if not 58<=records<=400:
        raise RuntimeError("Active v3 reference count outside audited range")
    pointer=STATE_DIR/"s9-multivector-v3-active.json"
    lock=STATE_DIR/"s9-multivector-v3-active.lock"
    doc={"schema":"s9_appearance_v3_active_v1",
         "corpus_id":corpus_id,"map_sha256":map_sha,
         "rankings_sha256":index_sha,"verified_crops":records,
         "automatic_person_assignments":0,
         "human_review_required":True}
    data=(json.dumps(doc,sort_keys=True,separators=(",",":"))+"\n").encode()
    STATE_DIR.mkdir(parents=True,exist_ok=True)
    if pointer.is_symlink() or lock.is_symlink():
        raise RuntimeError("Unsafe active v3 pointer/lock symlink")
    fd=os.open(lock,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"rb") as guard:
        fcntl.flock(guard,fcntl.LOCK_EX)
        previous=pointer.read_bytes() if pointer.exists() else None
        if previous is not None:
            try:older=json.loads(previous)
            except Exception as e:raise RuntimeError("Corrupt existing v3 pointer") from e
            if (older.get("schema")!="s9_appearance_v3_active_v1"
                or older.get("human_review_required") is not True
                or older.get("automatic_person_assignments")!=0
                or type(older.get("verified_crops")) is not int
                or older["verified_crops"]>records):
                raise RuntimeError("Unsafe/regressive existing active v3 pointer")
            if older["verified_crops"]==records and previous!=data:
                raise RuntimeError("Same-size v3 corpus changed: manual review required")
            if previous==data:return False
            oldid=older.get("corpus_id","")
            if not re.fullmatch(r"[a-f0-9]{16}",oldid):
                raise RuntimeError("Old corpus ID invalid")
            history=STATE_DIR/("s9-multivector-v3-retired-"+oldid+
                               "-"+digest(previous)[:16]+".json")
            if history.is_symlink():raise RuntimeError("Retired pointer symlink")
            if not history.exists():
                with history.open("xb") as writer:
                    writer.write(previous);writer.flush();os.fsync(writer.fileno())
                os.chmod(history,0o600)
            elif history.read_bytes()!=previous:
                raise RuntimeError("Retired pointer changed unexpectedly")
        fdtmp,staged=tempfile.mkstemp(prefix=".s9-v3-active-",dir=STATE_DIR)
        try:
            with os.fdopen(fdtmp,"wb") as writer:
                writer.write(data);writer.flush();os.fsync(writer.fileno())
            os.chmod(staged,0o600)
            os.replace(staged,pointer)
        finally:
            if os.path.exists(staged):os.unlink(staged)
        return True


def run():
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply",action="store_true")
    args=parser.parse_args()
    if not args.apply:
        return rank(args)
    # Same nonblocking global serialization used by the HSV32 and archive
    # workers. Unlike dry-run, an applied ranker holds this lock through the
    # source read, phone DEX, index validation and active pointer promotion.
    STATE_DIR.mkdir(parents=True,exist_ok=True)
    lock=STATE_DIR/"s9-v3-archive-backfill.lock"
    if lock.is_symlink():raise RuntimeError("Untrusted archive lock")
    fd=os.open(lock,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            # Another source-qualified phone worker owns this cool window.
            # No crop, phone model or ranking write has occurred yet.
            print("S9_V3_RANKER_DEFERRED "+json.dumps({
                "reason":"shared_archive_worker_busy",
                "rankings_published":False,
                "automatic_person_assignments":0,
                "originals_modified":False,
                "manual_reviews_modified":False}),flush=True)
            raise SystemExit(75)
        capture_rank_safe()
        phone_temperature_c()
        return rank(args)
    finally:
        os.close(fd)


def rank(args):
    rows=source_inventory()
    baseline_sha=verified_v2_baseline(rows)
    print("S9_V3_MULTIVECTOR_RANKING_PREFLIGHT "+json.dumps({
        "uniform_real_person_crop_records":len(rows),
        "cohorts":dict(Counter(x["cohort"] for x in rows)),
        "model_sha256":VISUAL,
        "v2_reference_baseline_preserved":True,
        "missing_descriptors_can_be_deferred":True,
        "new_rankings_written":False,
        "old_rankings_modified":False}),flush=True)
    if not args.apply:return
    capture_rank_safe()
    camera=phone("shell","pidof nl.kalenel.s9security",timeout=17)
    if not re.fullmatch(r"[0-9 ]+",camera):
        raise RuntimeError("Camera2 PID baseline unavailable")
    thermal_initial=phone_temperature_c()
    old={name:existing_sha(ROOT+"/"+name) for name in
         ("rank-input-v1.jsonl","rankings-v1.json",
          "rank-input-v2.jsonl","rankings-v2.json")}
    if not all(old.values()):raise RuntimeError("Immutable v1/v2 phone indices unavailable")
    entries=[{"key":x["key"],"aligned_face_verified":False,
              "visual_sidecar_sha256":x["visual_sidecar_sha256"],
              "hsv_sidecar_sha256":x["hsv_sidecar_sha256"]} for x in rows]
    private_map={"schema":"s9_multivector_source_map_v3",
                 "v2_baseline_source_map_sha256":baseline_sha,
                 "visual_model_sha256":VISUAL,
                 "color_histogram_schema":SCHEMA,
                 "people_assigned_automatically":0,
                 "rows":[{"key":x["key"],"clip":x["clip"],"source":"s9_sd",
                          "crop_sha256":x["crop_sha256"],"cohort":x["cohort"],
                          "visual_sidecar_sha256":x["visual_sidecar_sha256"],
                          "hsv_sidecar_sha256":x["hsv_sidecar_sha256"]}
                         for x in rows]}
    with tempfile.TemporaryDirectory(prefix="s9-multivector-v3-") as temp:
        work=Path(temp)
        jar=compile_ranker(work)
        inp=work/"rank-input-v3.jsonl"
        inp.write_text("".join(json.dumps(row,separators=(",",":"))+"\n"
                               for row in entries),encoding="utf-8")
        corpus_id=digest(inp.read_bytes())[:16]
        private_map["corpus_id"]=corpus_id
        mapping=(json.dumps(private_map,sort_keys=True,separators=(",",":"))+"\n").encode()
        input_remote=ROOT+"/rank-input-v3-"+corpus_id+".jsonl"
        output_remote=ROOT+"/rankings-v3-"+corpus_id+".json"
        stage(ROOT+"/s9-ranking-v3-400-worker.jar",jar)
        stage(input_remote,inp)
    if existing_sha(output_remote) is None:
        result=phone("shell","export CLASSPATH="+ROOT+"/s9-ranking-v3-400-worker.jar; "+
            "app_process /system/bin nl.kalenel.s9offline.S9AppearanceRankingWorkerV3 "+
            input_remote+" "+output_remote,timeout=165)
        if "S9_APPEARANCE_RANKINGS_ON_PHONE_VERIFIED" not in result:
            raise RuntimeError("Phone v3 ranking worker did not verify")
    data=phone("exec-out","cat",output_remote,timeout=28)
    score=json.loads(data)
    if (score.get("schema")!="s9_appearance_rankings_v3"
        or score.get("model_sha256")!=VISUAL
        or score.get("color_histogram_schema")!=SCHEMA
        or score.get("identity_probabilities") is not False
        or score.get("automatically_assigned_people")!=0
        or score.get("human_review_required") is not True
        or score.get("corpus_id")!=corpus_id
        or score.get("count")!=len(rows)
        or not isinstance(score.get("rankings"),list)
        or len(score["rankings"])!=len(rows)):
        raise RuntimeError("Phone V3 index integrity checks failed")
    known={x["key"] for x in rows};num=0
    for row in score["rankings"]:
        if row.get("reference_key") not in known:
            raise RuntimeError("Phone V3 index contains foreign source reference")
        hits=row.get("similar_appearance_only")
        if not isinstance(hits,list) or len(hits)>5:
            raise RuntimeError("Phone V3 ranked entries invalid")
        for hit in hits:
            if (hit.get("candidate_key") not in known
                or hit.get("human_review_required") is not True
                or hit.get("verified_same_person") is not False
                or hit.get("method")!="visual_75_color_25"):
                raise RuntimeError("Unverified/unknown phone V3 comparison")
            num+=1
    if phone("shell","pidof nl.kalenel.s9security",timeout=17)!=camera:
        raise RuntimeError("Live camera PID changed")
    thermal_after=phone_temperature_c()
    capture_rank_safe()
    if any(existing_sha(ROOT+"/"+k)!=v for k,v in old.items()):
        raise RuntimeError("Existing v1/v2 ranked indices changed during v3 run")
    write_private_map(mapping,corpus_id)
    current_index_sha=existing_sha(output_remote)
    capture_rank_safe()
    if not current_index_sha or not HEX.fullmatch(current_index_sha):
        raise RuntimeError("Phone ranking digest unavailable at pointer promotion")
    phone_temperature_c()
    activated=publish_verified_active(
        corpus_id,current_index_sha,digest(mapping),len(rows))
    print("S9_V3_MODEL_BACKED_RANKINGS_PRODUCED "+json.dumps({
        "corpus_id":corpus_id,
        "index_path":output_remote,
        "active_v3_published":activated,
        "verified_uniform_crop_records":len(rows),
        "appearance_comparisons":num,
        "phone_rankings_sha256":existing_sha(output_remote),
        "thermal_initial_c":thermal_initial,
        "thermal_after_c":thermal_after,
        "private_hub_map_sha256":digest(mapping),
        "v1_v2_indices_sha256_unchanged":True,
        "camera_apk_changed":False,"recordings_changed":False,
        "manual_reviews_changed":False,"identity_probabilities":False}),flush=True)


if __name__=="__main__":run()
