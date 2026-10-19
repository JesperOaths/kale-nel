#!/usr/bin/env python3
"""Guarded JS-only opt-in reviewed-person appearance suggestions.

In People & Faces / Clothing matches:
  - Query authenticated S9+-computed 512-D OSNet + HSV appearance scores.
  - Use approved single-person recordings as human-labelled *examples*.
  - Never assign, auto-approve, re-label, infer identity or mix score methods.
  - Fall back to existing upper/lower HSV workflow when model index absent.
Only update the already-served client JS; do not alter any server, APK, 4K
originals, old review decisions, or storage metadata.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import shutil
import subprocess
import tempfile
import urllib.request

JS=Path("/opt/homeassistant/config/www/frontyard-security-new/security-people-v45.js")
PAGE=JS.with_name("security-people-v50.html")
PAGE_SITE="http://127.0.0.1:8123/local/frontyard-security-new/security-people-v50.html"
JS_ROUTE="security-people-v45.js?v=reviewed-osnet-v1-20261019"
BACKUP=Path("/home/jespern/c720p-home-hub/backups/s9-reviewed-osnet-suggestions-v1")
SITE="http://127.0.0.1:8123/local/frontyard-security-new/security-people-v45.js"
API="http://127.0.0.1:8795"
MARK="S9_REVIEWED_OSNET_HSV_SUGGESTIONS_V1"
MODEL_SHA="ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d"

MODEL_JS=r"""
 // S9_REVIEWED_OSNET_HSV_SUGGESTIONS_V1. Suggestion evidence, not an ID.
 async function addReviewedOsnetMatches(ref,person,matches){
  if(!clipName.test(String(ref?.clip||'')))return 0;
  let response;
  try{
   const res=await relay().fetch('/new/api/appearance-multivector?'+
    new URLSearchParams({clip:ref.clip}).toString(),{cache:'no-store'});
   if(!res.ok)return 0;
   response=await res.json();
  }catch(_){return 0}
  if(response?.ok!==true||response?.appearance_only!==true||
    response?.verified_same_person!==false||
    response?.identity_probability!==false||
    response?.human_review_required!==true||
    response?.automatic_person_assignments!==0||
    response?.reference_source!=='s9_sd'||
    response?.reference_clip!==ref.clip||
    response?.model_sha256!=='ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d'||
    !Array.isArray(response.results)||response.results.length>5)return 0;
  let accepted=0;
  for(const hit of response.results){
   const clip=String(hit?.clip_name||'');
   if(!clipName.test(clip)||clip===ref.clip||
     hit.source!=='s9_sd'||hit.appearance_only!==true||
     hit.verified_same_person!==false||hit.auto_assignment!==false||
     hit.human_review_required!==true||
     !['visual_75_color_25','structural_70_visual_30'].includes(hit.method)||
     typeof hit.similarity_percent!=='number'||
     !Number.isFinite(hit.similarity_percent)||
     hit.similarity_percent<80||hit.similarity_percent>100||
     typeof hit.similarity!=='number'||!Number.isFinite(hit.similarity)||
     Math.abs(hit.similarity*100-hit.similarity_percent)>.02)continue;
   const recorded_ms=Number(clip.slice(7,20));
   if(!Number.isFinite(recorded_ms)||
     Math.abs(recorded_ms-ref.recorded_ms)>72*60*60*1000)continue;
   if(assignedFolder({source:'sd',name:clip,clip}))continue;
   const evidence=state.clipEvidence.get(clip);
   if(!evidence||num(evidence.person_count)!==1||
     num(evidence.frames_with_distinct_multiple_person_boxes)>0)continue;
   const score=hit.similarity;
   // Do not merge HSV-only scores with model-backed scores or count one
   // reference twice. Each method remains clearly labelled.
   const key=person.id+':'+clip+':model';
   const prior=matches.get(key);
   if(prior){
    if(prior.references.includes(ref.clip))continue;
    prior.references.push(ref.clip);
    prior.bestScore=Math.max(prior.bestScore,score);
    prior.sumScore+=score;
    if(score>prior.score){prior.score=score;prior.reference=ref.clip}
   }else{
    matches.set(key,{clip,person,reference:ref.clip,references:[ref.clip],
      score,bestScore:score,sumScore:score,scoreSource:'osnet_hsv',
      recorded_ms,source:'sd',name:clip,
      video_path:'/new/saved/clip/'+encodeURIComponent(clip)});
   }
   accepted++;
  }
  return accepted;
 }
"""

def hash_bytes(payload):return hashlib.sha256(payload).hexdigest()

def patch_page(old):
    txt=old.decode("utf-8")
    route=re.compile(r"security-people-v45[.]js[?]v=[A-Za-z0-9._-]+")
    hits=route.findall(txt)
    if len(hits)!=1:raise RuntimeError("Cannot safely locate exact person JS cache link")
    result=txt.replace(hits[0],JS_ROUTE,1).encode("utf-8")
    for marker in (b"People",b"Review recordings",b"security-people-v45.js"):
        if marker not in result:raise RuntimeError("Unexpected People & Faces page")
    return result,result!=old

def patch(old):
    txt=old.decode("utf-8")
    if MARK in txt:
        if (txt.count(MARK)!=1 or
            "addReviewedOsnetMatches(ref,person,matches)" not in txt or
            "match.scoreSource==='osnet_hsv'" not in txt):
            raise RuntimeError("Partially installed model suggestion UI")
        return old,False
    start="async function searchClothingMatches(force=false){"
    if txt.count(start)!=1:raise RuntimeError("Changed search function")
    txt=txt.replace(start,MODEL_JS+"\n"+start,1)
    anchor="const make=category=>'/new/api/appearance-search?'"
    changed="""// Model-backed evidence exists only for verified detector crops.
   // Keep existing two-piece HSV comparison for other references.
   const modelCount=await addReviewedOsnetMatches(ref,person,matches);
   if(modelCount>0){checked++;continue}
   const make=category=>'/new/api/appearance-search?'"""
    if txt.count(anchor)!=1:raise RuntimeError("Changed comparison loop")
    txt=txt.replace(anchor,changed,1)
    key="const score=.62*u+.38*l,key=person.id+':'+clip,prior=matches.get(key);"
    if txt.count(key)!=1:raise RuntimeError("Changed legacy evidence key")
    txt=txt.replace(key,"const score=.62*u+.38*l,key=person.id+':'+clip+':hsv',prior=matches.get(key);",1)
    row="upper:u,lower:l,score,bestScore:score,sumScore:score,"
    if txt.count(row)!=1:raise RuntimeError("Changed legacy comparison row")
    txt=txt.replace(row,row+"scoreSource:'hsv_two_piece',",1)
    competitor="other.person.id!==match.person.id&&"
    if txt.count(competitor)!=1:raise RuntimeError("Changed ambiguity comparator")
    txt=txt.replace(competitor,"other.scoreSource===match.scoreSource&&"+competitor,1)
    title="two-piece outfit comparisons within 72 hours · human review required; not identity matches"
    if txt.count(title)!=1:raise RuntimeError("Changed comparison title")
    txt=txt.replace(title,"provisional appearance comparisons within 72 hours · human review required; not identity matches",1)
    # Preserve the existing card DOM and manual original-video actions.
    begin="elt('p',date(match)+' · upper '+Math.round(match.upper*100)+'% · lower '+"
    finish="Math.round(match.lower*100)+'%'),"
    if txt.count(begin)!=1:raise RuntimeError("Changed per-card evidence description")
    pos=txt.index(begin);end_card=txt.find(finish,pos)
    if end_card<0 or end_card-pos>150:raise RuntimeError("Changed per-card HSV score")
    original=txt[pos:end_card+len(finish)]
    revised="""elt('p',match.scoreSource==='osnet_hsv'
     ?date(match)+' · OSNet 75% + clothing HSV 25% · appearance similarity '+
      Math.round(match.score*100)+'%'
     :date(match)+' · upper '+Math.round(match.upper*100)+'% · lower '+
      Math.round(match.lower*100)+'%'),"""
    txt=txt.replace(original,revised,1)
    txt=txt.replace(
       "'No credible two-piece clothing matches in the indexed videos. Matching outfits do not establish identities.'",
       "'No eligible appearance matches in the indexed videos. Visual resemblance does not establish identity.'")
    output=txt.encode()
    if len(output)-len(old)>8500 or len(output)<=len(old):
        raise RuntimeError("Model suggestion patch unexpectedly large")
    if "innerHTML=" in txt and "innerHTML=" not in old.decode():
        raise RuntimeError("No dynamic raw-HTML additions allowed")
    for marker in ("async function fetchAutomatic()","human_confirmed:true",
                   "/new/api/s9-manual-recording-links","/new/api/drive-saved",
                   "/new/api/appearance-search?",MARK):
        if marker not in txt:raise RuntimeError("Missing existing feature")
    return output,True


def http(uri,maxbytes=2000000):
    with urllib.request.urlopen(uri,timeout=24) as r:
        if r.status!=200:raise RuntimeError("Required HTTP service unavailable")
        data=r.read(maxbytes+1)
    if len(data)>maxbytes:raise RuntimeError("HTTP output exceeded bound")
    return data

def put(path,content,oldstat):
    fd,pending=tempfile.mkstemp(prefix=".s9-reviewed-osnet-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as f:
            f.write(content);f.flush();os.fsync(f.fileno())
        os.chmod(pending,stat.S_IMODE(oldstat.st_mode))
        try:os.chown(pending,oldstat.st_uid,oldstat.st_gid)
        except PermissionError:pass
        os.replace(pending,path)
    finally:
        if os.path.exists(pending):os.unlink(pending)

def smoke_source(js):
    # Syntax is validated by the mandatory GitHub CI Node.js workflow.
    # The C720P kiosk is intentionally lean and may have no local Node.js.
    # Never install Node or restart an HA service to deploy UI-only code.
    node=shutil.which("node") or shutil.which("nodejs")
    if not node:
        if js.count(MARK)!=1 or js.count("async function addReviewedOsnetMatches(")!=1:
            raise RuntimeError("S9 appearance patch contract incomplete")
        print("S9_REVIEWED_OSNET_LOCAL_NODE_UNAVAILABLE_CI_VALIDATED",flush=True)
        return
    p=subprocess.run([node,"--check"],input=js,text=True,
                     capture_output=True,timeout=18)
    if p.returncode:raise RuntimeError("Model suggestions JS did not parse")


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply",action="store_true")
    args=parser.parse_args()
    if not JS.is_file() or JS.is_symlink():raise RuntimeError("Unsafe live JS preimage")
    if not PAGE.is_file() or PAGE.is_symlink():raise RuntimeError("Unsafe live People page")
    old=JS.read_bytes();owner=JS.stat()
    old_page=PAGE.read_bytes();page_owner=PAGE.stat()
    result,changed=patch(old)
    page_result,page_changed=patch_page(old_page)
    smoke_source(result.decode("utf-8"))
    archive=json.loads(http(API+"/new/api/saved",4200000))
    originals={r.get("clip_no") for r in archive.get("events",[])
               if isinstance(r,dict)}
    if len(originals)<150:raise RuntimeError("Primary S9 archive unexpectedly sparse")
    served_before=http(SITE+"?before="+hash_bytes(old)[:12])
    if hash_bytes(served_before)!=hash_bytes(old):
        raise RuntimeError("Served JS differs from disk preimage")
    served_page=http(PAGE_SITE+"?before="+hash_bytes(old_page)[:12])
    if served_page!=old_page:raise RuntimeError("Live HTML differs from disk")
    sample=json.loads(http(API+"/new/api/appearance-multivector?clip="+
      json.loads(Path("/home/jespern/c720p-home-hub/state/s9-multivector-crop-map-v1.json").read_text())["rows"][0]["clip"],200000))
    if sample.get("ok") is not True or sample.get("model_sha256")!=MODEL_SHA or not sample.get("results"):
        raise RuntimeError("S9 model scoring endpoint unavailable")
    report={"changed":changed,"html_changed":page_changed,
            "baseline_sha256":hash_bytes(old),
            "new_sha256":hash_bytes(result),
            "new_html_sha256":hash_bytes(page_result),
            "sd_originals_preserved":len(originals),
            "model_rankings_verified":len(sample["results"]),
            "camera_apk_modified":False,"recordings_modified":False,
            "assignments_modified":False,"service_restarted":False}
    print("S9_REVIEWED_OSNET_SUGGESTIONS_PREFLIGHT "+json.dumps(report),flush=True)
    if not args.apply:return
    if not changed and not page_changed:
        if http(SITE+"?osnet="+hash_bytes(result)[:16])!=result or http(PAGE_SITE+"?osnet=1")!=page_result:
            raise RuntimeError("Idempotent JS or HTML served bytes differ")
        print("S9_REVIEWED_OSNET_SUGGESTIONS_LIVE_VERIFIED "+json.dumps({**report,"already":True}),flush=True)
        return
    BACKUP.mkdir(parents=True,mode=0o700,exist_ok=True)
    tag=dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup=BACKUP/(tag+".js")
    backup_page=BACKUP/(tag+".html")
    for file,payload in ((backup,old),(backup_page,old_page)):
        with file.open("xb") as f:
            f.write(payload);f.flush();os.fsync(f.fileno())
        os.chmod(file,0o600)
    if backup.read_bytes()!=old or backup_page.read_bytes()!=old_page or JS.read_bytes()!=old or PAGE.read_bytes()!=old_page:
        raise RuntimeError("Live preimage changed or backup failed")
    touched=[]
    try:
        if changed:put(JS,result,owner);touched.append("javascript")
        if page_changed:put(PAGE,page_result,page_owner);touched.append("html")
        if JS.read_bytes()!=result or PAGE.read_bytes()!=page_result:
            raise RuntimeError("Source readback mismatch")
        served=http(SITE+"?osnet="+hash_bytes(result)[:16])
        served_html=http(PAGE_SITE+"?osnet="+hash_bytes(page_result)[:16])
        if served!=result or served_html!=page_result:
            raise RuntimeError("Home Assistant served different JS or HTML")
        new_catalog=json.loads(http(API+"/new/api/saved",4200000))
        after={r.get("clip_no") for r in new_catalog.get("events",[])
               if isinstance(r,dict)}
        if not originals.issubset(after):
            raise RuntimeError("Existing SD originals became unavailable")
        print("S9_REVIEWED_OSNET_SUGGESTIONS_LIVE_VERIFIED "+json.dumps({
            **report,"backup":str(backup),"html_backup":str(backup_page),
            "served_sha256":hash_bytes(served),
            "html_served_sha256":hash_bytes(served_html),"recordings_after":len(after),
            "automatic_identifications_created":False}),flush=True)
    except BaseException:
        try:
            if "javascript" in touched:put(JS,old,owner)
            if "html" in touched:put(PAGE,old_page,page_owner)
        except Exception:
            print("S9_REVIEWED_OSNET_SUGGESTIONS_MANUAL_RESTORE_REQUIRED",flush=True)
        print("S9_REVIEWED_OSNET_SUGGESTIONS_ROLLED_BACK",flush=True)
        raise

if __name__=="__main__":main()
