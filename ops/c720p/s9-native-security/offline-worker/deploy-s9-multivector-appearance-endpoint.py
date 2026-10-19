#!/usr/bin/env python3
"""Guarded authenticated read-only route for S9+ computed multivector scores.

No classifier, identity, video, phone APK, microSD or review-state mutations.
Backups and atomic local file writes; archive proxy restart only after dryrun.
"""
import argparse,datetime,hashlib,json,os,re,shutil,stat,subprocess,tempfile,time
from pathlib import Path
from urllib.parse import quote
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
PROXY=HOME/"bin/s9_sd_proxy_extension.py"
MODULE=HOME/"bin/s9_multivector_appearance_api.py"
MAPPING=HOME/"state/s9-multivector-crop-map-v1.json"
BACK=HOME/"backups/s9-multivector-endpoint-v1"
REF="01b8cc194739d38c4f1e8a0617472d3e1e2828f3"
REMOTE="ops/c720p/s9-person-ml-v1/s9_multivector_appearance_api.py"
HOOK=" import s9_automatic_person_review\n s9_automatic_person_review.install(H,rows)\n"
NEW=HOOK+" import s9_multivector_appearance_api\n s9_multivector_appearance_api.install(H)\n"
VISUAL_SHA="ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d"
CLIP=re.compile(r"motion_[0-9]{13}[.]mp4\Z")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url,limit):
    with urllib.request.urlopen(url,timeout=25) as r:
        if r.status!=200:raise RuntimeError("Source unavailable")
        raw=r.read(limit+1)
    if len(raw)>limit:raise RuntimeError("Input size exceeded bound")
    return raw


def mapping():
    base="http://127.0.0.1:8795"
    sd=json.loads(fetch(base+"/new/api/saved",5000000))
    clips=set()
    for item in sd.get("events",[]):
        for field in ("clip_no","remote_name"):
            name=item.get(field)
            if isinstance(name,str) and CLIP.fullmatch(name):
                clips.add(name)
    if len(clips)<30:raise RuntimeError("Source SD catalog too small")
    doc=json.loads(fetch(base+
      "/new/api/visual-review?workflow=clip_folders_v40&tab=all&offset=0&limit=100",
      6000000))
    rows=[]
    found=set()
    for item in doc.get("items",[]):
        clip=item.get("clip")
        crop=item.get("full_crop")
        if clip not in clips or not isinstance(crop,dict):
            continue
        crop_sha=crop.get("sha256")
        if not isinstance(crop_sha,str) or not re.fullmatch(r"[a-f0-9]{64}",crop_sha):
            continue
        key=sha(("\0".join(("s9_sd",clip,crop_sha))).encode())
        if key in found:continue
        found.add(key)
        rows.append({"key":key,"clip":clip,"source":"s9_sd"})
    if len(rows)!=doc.get("total") or not 2<=len(rows)<=200:
        raise RuntimeError("Incomplete full-person-crop source verification")
    result={"schema":"s9_v40_multivector_map_v1",
            "visual_model_sha256":VISUAL_SHA,
            "rows":rows,
            "identities_verified":False,"auto_assignment":False}
    return json.dumps(result,sort_keys=True,separators=(",",":")).encode(),rows


def atomic(path,content,existing_stat):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix=".s9-appearance-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as f:
            f.write(content);f.flush();os.fsync(f.fileno())
        os.chmod(tmp,stat.S_IMODE(existing_stat.st_mode) if existing_stat
                 else 0o600)
        if existing_stat:
            try:os.chown(tmp,existing_stat.st_uid,existing_stat.st_gid)
            except PermissionError:pass
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)


def cmd(*argv):
    p=subprocess.run(argv,capture_output=True,text=True,timeout=65)
    if p.returncode:raise RuntimeError("Command failed "+argv[0]+": "+p.stderr[-240:])
    return p.stdout.strip()


def audit(clip):
    u="http://127.0.0.1:8795/new/api/appearance-multivector?clip="+quote(clip,safe="")
    doc=json.loads(fetch(u,140000))
    if (doc.get("ok") is not True or doc.get("appearance_only") is not True
        or doc.get("verified_same_person") is not False
        or doc.get("human_review_required") is not True
        or doc.get("automatic_person_assignments")!=0
        or doc.get("model_sha256")!=VISUAL_SHA
        or doc.get("coverage",{}).get("real_person_crops")<2
        or not isinstance(doc.get("results"),list)):
        raise RuntimeError("Untrusted live multi-vector API")
    if not doc["results"]:raise RuntimeError("No actual S9 ranked matches")
    for row in doc["results"]:
        if (row.get("source")!="s9_sd" or
            row.get("appearance_only") is not True or
            row.get("verified_same_person") is not False or
            type(row.get("similarity_percent")) not in (float,int)):
            raise RuntimeError("Unsafe rank response")
    return {"results":len(doc["results"]),
            "coverage":doc["coverage"].get("real_person_crops"),
            "metric":doc.get("metric")}


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--apply",action="store_true")
    args=ap.parse_args()
    if shutil.disk_usage(HOME).free<40*1024*1024:
        raise RuntimeError("C720P disk reserve below safety threshold")
    for p in (PROXY,MODULE,MAPPING):
        if p.is_symlink():raise RuntimeError("Unsafe proxy/module/map symlink")
    if not PROXY.is_file():raise RuntimeError("Missing live archive proxy")
    original=PROXY.read_bytes();prior_stat=PROXY.stat()
    before={key:(p.read_bytes() if p.is_file() else None,
                 p.stat() if p.is_file() else None)
            for key,p in (("module",MODULE),("map",MAPPING))}
    blob=fetch("https://raw.githubusercontent.com/JesperOaths/kale-nel/"+
               REF+"/"+REMOTE,170000)
    if b"def install(H):" not in blob or b"appearance_only" not in blob:
        raise RuntimeError("Unverified private route source")
    map_bytes,rows=mapping()
    before_sd=json.loads(fetch("http://127.0.0.1:8795/new/api/saved",5000000))
    original_names={x.get("remote_name") or x.get("clip_no") for x in before_sd.get("events",[])
                    if isinstance(x,dict)}
    if len(original_names)<100:raise RuntimeError("Pre-release originals incomplete")
    txt=original.decode("utf-8")
    if NEW in txt:new_proxy=original
    elif txt.count(HOOK)==1:new_proxy=txt.replace(HOOK,NEW,1).encode()
    else:raise RuntimeError("Live proxy hook changed unexpectedly")
    print("S9_MULTIVECTOR_API_GUARDED_PREFLIGHT "+json.dumps({
        "source_qualified_crops":len(rows),
        "proxy_change":new_proxy!=original,"module_sha256":sha(blob),
        "no_camera_or_recording_writes":True}),flush=True)
    if not args.apply:return
    backup=BACK/datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup.mkdir(parents=True,mode=0o700,exist_ok=False)
    (backup/"proxy-original.py").write_bytes(original)
    for name,(content,_) in before.items():
        if content is not None:(backup/(name+"-original")).write_bytes(content)
    for f in backup.iterdir():os.chmod(f,0o600)
    touched=[]
    try:
        if PROXY.read_bytes()!=original:raise RuntimeError("Concurrent proxy update")
        for key,path,new_bytes in (("module",MODULE,blob),("map",MAPPING,map_bytes)):
            old,metadata=before[key]
            if old!=new_bytes:
                atomic(path,new_bytes,metadata);touched.append(key)
        if new_proxy!=original:
            atomic(PROXY,new_proxy,prior_stat);touched.append("proxy")
        cmd("python3","-m","py_compile",str(PROXY),str(MODULE))
        cmd("systemctl","--user","restart","c720p-drive-security-archive.service")
        health=None
        for i in range(15):
            try:
                health=audit(rows[0]["clip"]);break
            except (OSError,ValueError,RuntimeError):
                time.sleep(1)
        if health is None:raise RuntimeError("Live archive appearance route not ready")
        after_sd=json.loads(fetch("http://127.0.0.1:8795/new/api/saved",5000000))
        after_names={x.get("remote_name") or x.get("clip_no") for x in after_sd.get("events",[])
                     if isinstance(x,dict)}
        if not original_names.issubset(after_names):
            raise RuntimeError("Existing S9 archive index shrank after proxy restart")
        if PROXY.read_bytes()!=new_proxy or MODULE.read_bytes()!=blob or MAPPING.read_bytes()!=map_bytes:
            raise RuntimeError("Live route file integrity mismatch")
        print("S9_MULTIVECTOR_APPEARANCE_LIVE_API_VERIFIED "+json.dumps({
            "health":health,"rollback":str(backup),
            "originals_before":len(original_names),
            "originals_after":len(after_names),
            "files_changed":touched,
            "phone_did_scoring":True,
            "raw_vectors_exposed":False,
            "camera_apk_modified":False,
            "videos_modified":False,
            "human_reviews_modified":False}),flush=True)
    except BaseException:
        if "proxy" in touched:atomic(PROXY,original,prior_stat)
        for key,path in (("module",MODULE),("map",MAPPING)):
            if key not in touched:continue
            old,metadata=before[key]
            if old is None:path.unlink(missing_ok=True)
            else:atomic(path,old,metadata)
        try:cmd("systemctl","--user","restart","c720p-drive-security-archive.service")
        except Exception:print("S9_MULTIVECTOR_ROLLBACK_NEEDS_MANUAL_RESTART",flush=True)
        print("S9_MULTIVECTOR_API_ROLLED_BACK",flush=True)
        raise


if __name__=="__main__":
    main()
