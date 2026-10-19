#!/usr/bin/env python3
"""Stage color metadata and execute standalone S9+ appearance-only ranking.

All 512-D vectors stay in private S9+ worker files. C720P only relays V40
per-crop 32-bin histogram metadata and receives redacted audit counts.
No identity, folder assignment, recording rewrite or Camera2 interaction.
"""
import argparse,hashlib,importlib.util,json,math,os
from pathlib import Path
import re,subprocess,sys,tempfile,zipfile

PHONE="192.168.178.250:5555"
WORKER="/data/local/tmp/s9_worker"
ANDROID_JAR="/usr/lib/android-sdk/platforms/android-36/android.jar"


def run(args,timeout=90):
    resp=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
    if resp.returncode:
        raise RuntimeError("Command failed: "+args[0]+" "+resp.stderr[-300:])
    return resp.stdout.strip()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def catalog():
    source=Path(__file__).with_name("backfill-v40-person-rois-on-s9.py")
    spec=importlib.util.spec_from_file_location("v40_backfill",source)
    module=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=module
    spec.loader.exec_module(module)
    events=module.catalog_items()
    qualified=module.planned(events,module.record_index())
    crop_lookup={x["crop_sha256"]:x for x in qualified}
    result=[]
    for item in events:
        crop=item.get("full_crop")
        if not isinstance(crop,dict):continue
        entry=crop_lookup.get(crop.get("sha256"))
        if entry is None:continue
        hsv=item.get("upper_hsv32")
        if (not isinstance(hsv,list) or len(hsv)!=32
            or not all(isinstance(x,(int,float)) and math.isfinite(x) and x>=0
                       for x in hsv)):
            raise RuntimeError("Missing genuine 32-bin clothing histogram")
        if entry["source"]!="s9_sd":
            # Do not quietly reclassify historical/unknown source clips.
            raise RuntimeError("Unresolved source for detector crop")
        result.append({"key":entry["source_key"],"upper_hsv32":hsv,
                       "aligned_face_verified":False})
    if len(result)!=len(qualified) or len(result)<2 or len(result)>200:
        raise RuntimeError("Incomplete source-qualified visual corpus")
    if len({x["key"] for x in result})!=len(result):
        raise RuntimeError("Duplicate source keys in appearance corpus")
    return result


def build(temp):
    source=Path(__file__).with_name("S9AppearanceRankingWorker.java")
    cosine=Path(__file__).with_name("PhoneOfflineSimilarity.java")
    if not source.is_file() or not cosine.is_file():
        raise RuntimeError("Standalone Java source missing")
    if not Path(ANDROID_JAR).is_file():
        raise RuntimeError("Android SDK missing")
    classes=temp/"classes";classes.mkdir()
    run(["javac","-source","8","-target","8","-cp",ANDROID_JAR,
         "-d",str(classes),str(source),str(cosine)],70)
    dex=temp/"dex";dex.mkdir()
    run(["d8","--min-api","29","--output",str(dex),
         *[str(x) for x in classes.rglob("*.class")]],70)
    jar=temp/"s9-rank-worker.jar"
    with zipfile.ZipFile(jar,"w",zipfile.ZIP_DEFLATED) as z:
        z.write(dex/"classes.dex","classes.dex")
    if not 1000<jar.stat().st_size<500000:
        raise RuntimeError("Invalid Android DEX ranking file")
    return jar


def install_and_run(jar,rows):
    input_path=WORKER+"/rank-input-v1.jsonl"
    output_path=WORKER+"/rankings-v1.json"
    remote_jar=WORKER+"/s9-ranking-worker.jar"
    status=run(["adb","-s",PHONE,"shell",
                "pidof nl.kalenel.s9security"],15)
    if not re.fullmatch("[0-9 ]+",status):
        raise RuntimeError("Camera baseline unavailable")
    if subprocess.run(["adb","-s",PHONE,"shell","test -e "+output_path],
                      capture_output=True,timeout=15).returncode==0:
        raise RuntimeError("Previous ranking output exists; never overwrite")
    with tempfile.TemporaryDirectory(prefix="s9-rank-input-") as path:
        file=Path(path)/"rank-input-v1.jsonl"
        file.write_text("".join(json.dumps(x,separators=(",",":"))+"\n"
                        for x in rows),encoding="utf-8")
        transfers=((jar,remote_jar),(file,input_path))
        for local,remote in transfers:
            partial=remote+".pending"
            run(["adb","-s",PHONE,"push",str(local),partial],40)
            digest=run(["adb","-s",PHONE,"shell","sha256sum "+partial],30).split()[0]
            if digest!=sha(local):
                raise RuntimeError("Phone metadata/DEX transfer hash mismatch")
            run(["adb","-s",PHONE,"shell",
                 "mv "+partial+" "+remote+"; chmod 600 "+remote],20)
    cmd=("export CLASSPATH="+remote_jar+"; app_process /system/bin "
         "nl.kalenel.s9offline.S9AppearanceRankingWorker "
         +input_path+" "+output_path)
    result=run(["adb","-s",PHONE,"shell",cmd],130)
    if "S9_APPEARANCE_RANKINGS_ON_PHONE_VERIFIED" not in result:
        raise RuntimeError("Phone did not confirm private ranking output")
    raw=run(["adb","-s",PHONE,"exec-out","cat",output_path],25)
    output=json.loads(raw)
    if (output.get("schema")!="s9_appearance_rankings_v1"
        or output.get("count")!=len(rows)
        or len(output.get("rankings",[]))!=len(rows)
        or output.get("identity_probabilities") is not False
        or output.get("automatically_assigned_people")!=0):
        raise RuntimeError("Phone ranking result schema validation failed")
    values=[]
    for ref in output["rankings"]:
        for item in ref["similar_appearance_only"]:
            if (item.get("verified_same_person") is not False
                or item.get("human_review_required") is not True
                or item.get("method") not in ("visual_75_color_25",
                    "structural_70_visual_30")):
                raise RuntimeError("Ranking result made unsupported identity claim")
            score=item.get("appearance_similarity_percent")
            if not isinstance(score,(int,float)) or not 0<=score<=100:
                raise RuntimeError("Ranking score out of bounds")
            values.append(score)
    after=run(["adb","-s",PHONE,"shell",
               "pidof nl.kalenel.s9security"],15)
    if after!=status:
        raise RuntimeError("Camera process changed during ranking")
    print("S9_REAL_APPEARANCE_RANKINGS_VERIFIED "+json.dumps({
        "records":len(rows),"comparisons_returned":len(values),
        "score_min":round(min(values),2) if values else None,
        "score_max":round(max(values),2) if values else None,
        "model":"pretrained_osnet_512d_plus_hsv32",
        "structural_vectors_claimed":0,
        "ranking_computed_on":"s9_plus",
        "human_review_required":True,
        "identity_probability":False,
        "live_ui_activated":False,
        "camera_unchanged":True}),flush=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--run",action="store_true")
    args=parser.parse_args()
    rows=catalog()
    if not args.run:
        print("S9_APPEARANCE_RANKINGS_DRY_RUN "+json.dumps({
            "full_person_crops":len(rows),
            "color_histogram_bins":32,
            "phone_rankings_written":False,
            "human_review_required":True}),flush=True)
        return
    with tempfile.TemporaryDirectory(prefix="s9-rank-java-") as temp:
        jar=build(Path(temp))
        install_and_run(jar,rows)


if __name__=="__main__":main()
