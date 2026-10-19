#!/usr/bin/env python3
"""Build and run immutable phone-side uniform HSV32 + pretrained OSNet rankings V2.

All 512D biometric/appearance feature vectors stay on the private S9+ worker.
The hub receives only provenance mapping: source-qualified crop SHA->filename.
V1 ranking output is never opened for write or deleted.
"""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import zipfile

PHONE="192.168.178.250:5555"
ROOT="/data/local/tmp/s9_worker"
STATE=Path("/home/jespern/c720p-home-hub/state/s9-multivector-crop-map-v2.json")
ANDROID=os.environ.get("S9_ANDROID_SDK_JAR","/usr/lib/android-sdk/platforms/android-36/android.jar")
VISUAL="ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d"
HEX=re.compile(r"[a-f0-9]{64}\Z")
SCHEMA="s9_uniform_upper_torso_hsv32_v2"


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


def source_inventory():
    helper=Path(__file__).with_name("backfill-s9-hsv32-uniform-v2.py")
    spec=importlib.util.spec_from_file_location("s9_v2_uniform_catalog",helper)
    module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module
    spec.loader.exec_module(module)
    rows=module.inventory()
    if len(rows)!=57 or Counter(x["cohort"] for x in rows)!={"v40":51,"approved_new":6}:
        raise RuntimeError("Unexpected verified v2 person-crop cohort")
    for row in rows:
        module.safe_visual(row["key"],row["crop_sha256"])
        hsv=module.phone_json(ROOT+"/features/"+row["key"]+"-hsv-v2.json")
        values=hsv.get("upper_hsv32")
        if (hsv.get("schema")!=SCHEMA
            or hsv.get("source_qualified_key")!=row["key"]
            or hsv.get("crop_sha256")!=row["crop_sha256"]
            or not isinstance(values,list) or len(values)!=32
            or abs(sum(values)-1)>0.0001
            or hsv.get("human_review_required") is not True):
            raise RuntimeError("Real phone uniform histogram incomplete")
    return rows


def compile_ranker(base):
    for name in ("S9AppearanceRankingWorkerV2.java","PhoneOfflineSimilarity.java"):
        if not Path(__file__).with_name(name).is_file():
            raise RuntimeError("V2 scoring source missing: "+name)
    if not Path(ANDROID).is_file():
        raise RuntimeError("C720P Android SDK unavailable")
    classes=base/"classes";classes.mkdir()
    exec_local(["javac","-source","8","-target","8","-cp",ANDROID,
       "-d",str(classes),
       str(Path(__file__).with_name("S9AppearanceRankingWorkerV2.java")),
       str(Path(__file__).with_name("PhoneOfflineSimilarity.java"))],90)
    dex=base/"dex";dex.mkdir()
    compiled=list(classes.rglob("*.class"))
    if len(compiled)<3:raise RuntimeError("Missing phone ranking comparator classes")
    exec_local(["d8","--min-api","28","--output",str(dex),
                *[str(p) for p in compiled]],100)
    jar=base/"s9-ranking-v2-worker.jar"
    with zipfile.ZipFile(jar,"w",zipfile.ZIP_DEFLATED) as archive:
        archive.write(dex/"classes.dex","classes.dex")
    if not 1000<jar.stat().st_size<300000:
        raise RuntimeError("Unexpected v2 DEX size")
    return jar


def existing_sha(path):
    result=subprocess.run(["adb","-s",PHONE,"shell","test -s "+path],
                          capture_output=True,text=True,timeout=15)
    if result.returncode==0:
        return phone("shell","sha256sum "+path,timeout=30).split()[0]
    return None


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


def write_private_map(data):
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


def run():
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply",action="store_true")
    args=parser.parse_args()
    rows=source_inventory()
    print("S9_V2_MULTIVECTOR_RANKING_PREFLIGHT "+json.dumps({
        "uniform_real_person_crop_records":len(rows),
        "cohorts":dict(Counter(x["cohort"] for x in rows)),
        "model_sha256":VISUAL,
        "new_rankings_written":False,
        "old_rankings_modified":False}),flush=True)
    if not args.apply:return
    camera=phone("shell","pidof nl.kalenel.s9security",timeout=17)
    if not re.fullmatch(r"[0-9 ]+",camera):
        raise RuntimeError("Camera2 PID baseline unavailable")
    old={name:existing_sha(ROOT+"/"+name) for name in
         ("rank-input-v1.jsonl","rankings-v1.json")}
    if not all(old.values()):raise RuntimeError("Immutable v1 phone index unavailable")
    entries=[{"key":x["key"],"aligned_face_verified":False} for x in rows]
    private_map={"schema":"s9_multivector_source_map_v2",
                 "visual_model_sha256":VISUAL,
                 "color_histogram_schema":SCHEMA,
                 "people_assigned_automatically":0,
                 "rows":[{"key":x["key"],"clip":x["clip"],"source":"s9_sd",
                          "crop_sha256":x["crop_sha256"],"cohort":x["cohort"]}
                         for x in rows]}
    mapping=(json.dumps(private_map,sort_keys=True,separators=(",",":"))+"\n").encode()
    with tempfile.TemporaryDirectory(prefix="s9-multivector-v2-") as temp:
        work=Path(temp)
        jar=compile_ranker(work)
        inp=work/"rank-input-v2.jsonl"
        inp.write_text("".join(json.dumps(row,separators=(",",":"))+"\n"
                               for row in entries),encoding="utf-8")
        stage(ROOT+"/s9-ranking-v2-worker.jar",jar)
        stage(ROOT+"/rank-input-v2.jsonl",inp)
    result=phone("shell","export CLASSPATH="+ROOT+"/s9-ranking-v2-worker.jar; "+
           "app_process /system/bin nl.kalenel.s9offline.S9AppearanceRankingWorkerV2 "+
           ROOT+"/rank-input-v2.jsonl "+ROOT+"/rankings-v2.json",timeout=165)
    if "S9_APPEARANCE_RANKINGS_ON_PHONE_VERIFIED" not in result:
        raise RuntimeError("Phone v2 ranking worker did not verify")
    data=phone("exec-out","cat",ROOT+"/rankings-v2.json",timeout=28)
    score=json.loads(data)
    if (score.get("schema")!="s9_appearance_rankings_v2"
        or score.get("model_sha256")!=VISUAL
        or score.get("color_histogram_schema")!=SCHEMA
        or score.get("identity_probabilities") is not False
        or score.get("automatically_assigned_people")!=0
        or score.get("human_review_required") is not True
        or score.get("count")!=len(rows)
        or not isinstance(score.get("rankings"),list)
        or len(score["rankings"])!=len(rows)):
        raise RuntimeError("Phone V2 index integrity checks failed")
    known={x["key"] for x in rows};num=0
    for row in score["rankings"]:
        if row.get("reference_key") not in known:
            raise RuntimeError("Phone v2 index contains foreign source reference")
        hits=row.get("similar_appearance_only")
        if not isinstance(hits,list) or len(hits)>5:
            raise RuntimeError("Phone v2 ranked entries invalid")
        for hit in hits:
            if (hit.get("candidate_key") not in known
                or hit.get("human_review_required") is not True
                or hit.get("verified_same_person") is not False
                or hit.get("method")!="visual_75_color_25"):
                raise RuntimeError("Unverified/unknown phone v2 comparison")
            num+=1
    if phone("shell","pidof nl.kalenel.s9security",timeout=17)!=camera:
        raise RuntimeError("Live camera PID changed")
    if any(existing_sha(ROOT+"/"+k)!=v for k,v in old.items()):
        raise RuntimeError("Existing v1 ranked index changed during v2 run")
    write_private_map(mapping)
    print("S9_V2_MODEL_BACKED_RANKINGS_PRODUCED "+json.dumps({
        "verified_uniform_crop_records":len(rows),
        "appearance_comparisons":num,
        "phone_rankings_sha256":existing_sha(ROOT+"/rankings-v2.json"),
        "private_hub_map_sha256":digest(mapping),
        "v1_index_sha256_unchanged":True,
        "camera_apk_changed":False,"recordings_changed":False,
        "manual_reviews_changed":False,"identity_probabilities":False}),flush=True)


if __name__=="__main__":run()
