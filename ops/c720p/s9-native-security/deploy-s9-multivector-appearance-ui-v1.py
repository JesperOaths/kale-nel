#!/usr/bin/env python3
"""Guarded UI-only activation of verified S9+ OSNet+HSV appearance scores.

Preserves the existing legacy HSV appearance search, full live DOM, Camera2,
4K recording, user-reviewed folders and case actions. No service restarts.
Reads only new human-review-only authenticated /new/api/appearance-multivector.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import urllib.request

SITE=Path("/opt/homeassistant/config/www/frontyard-security-new")
UI=SITE/"security-face-folders-v22.html"
BACKUP=Path("/home/jespern/c720p-home-hub/backups/s9-multivector-appearance-ui-v1")
HOST="http://127.0.0.1:8795"
SERVED="http://127.0.0.1:8123/local/frontyard-security-new/security-face-folders-v22.html"
MODEL_SHA="ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d"
MARKER="S9_MULTIVECTOR_APPEARANCE_UI_V1"

JS=r"""
// S9_MULTIVECTOR_APPEARANCE_UI_V1: S9+ computes, this page only reviews.
async function runVerifiedMultiVectorAppearance(clip,zone,run,status,host,button){
 if(!clipOK.test(clip)||!state.sd.some(r=>r.clip_no===clip)){
  status.textContent='Choose a verified S9+ recording first.';return;
 }
 if(zone){
  status.textContent='For combined appearance ranking, set Scene area to Any mapped zone. Scene filters are available in HSV colour mode.';return;
 }
 status.textContent='Comparing verified person crops on the S9+…';
 button.disabled=true;
 try{
  const response=await get('/new/api/appearance-multivector?'+new URLSearchParams({clip}).toString());
  if(run!==state.appearanceRequest||state.view!=='appearance')return;
  if(response.ok!==true||response.appearance_only!==true||
   response.verified_same_person!==false||response.human_review_required!==true||
   response.identity_probability!==false||response.automatic_person_assignments!==0||
   response.model_sha256!=='ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d'||
   response.reference_source!=='s9_sd'||response.reference_clip!==clip||
   !Array.isArray(response.results)||response.results.length>5)
   throw Error('Unverified S9+ appearance response');
  const known=new Map(state.sd.filter(r=>clipOK.test(String(r.clip_no||'')))
   .map(r=>[r.clip_no,r]));
  const accepted=response.results.filter(hit=>hit&&
   hit.source==='s9_sd'&&hit.appearance_only===true&&
   hit.verified_same_person===false&&hit.human_review_required===true&&
   hit.auto_assignment===false&&hit.clip_name!==clip&&known.has(hit.clip_name)&&
   ['visual_75_color_25','structural_70_visual_30'].includes(hit.method)&&
   typeof hit.similarity_percent==='number'&&Number.isFinite(hit.similarity_percent)&&
   hit.similarity_percent>=0&&hit.similarity_percent<=100&&
   typeof hit.similarity==='number'&&Number.isFinite(hit.similarity)&&
   Math.abs(hit.similarity*100-hit.similarity_percent)<0.02);
  const coverage=Number(response.coverage?.real_person_crops||0);
  status.textContent=accepted.length+' provisional appearance comparison'+
   (accepted.length===1?'':'s')+' · '+coverage+
   ' verified person crops currently indexed · not identity likelihood.'+
   (!accepted.length?' No compatible indexed person crops for this reference.':'');
  for(const hit of accepted){
   const entry=item('sd',known.get(hit.clip_name));
   const card=el('article','record'),pic=el('div','record-preview'),
    body=el('div','record-body'),open=el('button','','Review original clip');
   pic.append(el('span','','S9+ recorded evidence'));
   const method=hit.method==='visual_75_color_25'
     ?'75% OSNet appearance + 25% clothing HSV'
     :'70% aligned-face descriptor + 30% OSNet appearance';
   body.append(el('strong','',stamp(entry)),
    el('small','','Appearance similarity: '+hit.similarity_percent.toFixed(1)+'% · '+method),
    el('small','','Provisional visual comparison; not a probability of the same person'),
    el('small','','Same-person status: not verified; human review required'));
   open.type='button';open.addEventListener('click',()=>openClip(entry));body.append(open);
   body.append(saveCaseButton(entry));
   card.append(pic,body);host.append(card);signedPicture(pic,entry);
  }
 }catch(_){
  if(run!==state.appearanceRequest)return;
  status.textContent='No verified S9+ appearance vectors available for this recording, or the private comparison service is unavailable. Choose HSV colour mode to search the wider archive.';
 }finally{if(run===state.appearanceRequest)button.disabled=false}
}
"""


def digest(blob):return hashlib.sha256(blob).hexdigest()


def fetch(uri,maxsize=5000000):
    with urllib.request.urlopen(uri,timeout=24) as response:
        if response.status!=200:raise RuntimeError("HTTP asset unavailable")
        data=response.read(maxsize+1)
    if len(data)>maxsize:raise RuntimeError("HTTP response size invalid")
    return data


def sub_once(source,old,new):
    if source.count(old)!=1:raise RuntimeError("Unexpected live UI source anchor")
    return source.replace(old,new,1)


def patch_html(old):
    source=old.decode("utf-8")
    if MARKER in source:
        if (source.count(MARKER)!=1
            or "runVerifiedMultiVectorAppearance" not in source
            or "value=\"osnet_hsv\"" not in source):
            raise RuntimeError("Partially installed multivector UI")
        return old,0
    source=sub_once(source,
      '<option value="upper_clothing">Upper clothing colour</option>',
      '<option value="osnet_hsv" selected>OSNet + clothing colour (verified person crops)</option><option value="upper_clothing">Upper clothing colour</option>')
    source=sub_once(source,
      'async function runAppearanceSearch(){',
      JS+'\nasync function runAppearanceSearch(){')
    source=sub_once(source,
      ' host.replaceChildren();\n if(!clipOK.test(clip)',
      " host.replaceChildren();\n if(category==='osnet_hsv'){\n  await runVerifiedMultiVectorAppearance(clip,zone,run,status,host,button);return;\n }\n if(!clipOK.test(clip)")
    source=sub_once(source,
      '<button id="appearanceGo" type="button">Find similar colours</button>',
      '<button id="appearanceGo" type="button">Compare appearance</button>')
    # Replace only a very specific note string, otherwise retain existing copy.
    old_note='Compare upper- or lower-clothing colours from existing S9+ recordings using the on-phone HSV index. No facial features, biometric templates or identity probability are used.'
    new_note='Use verified on-phone OSNet person-crop vectors plus clothing colour for indexed recordings, or select legacy upper/lower HSV colour comparison for wider coverage. Neither is an identity probability, and no recordings are assigned automatically.'
    if old_note in source:source=sub_once(source,old_note,new_note)
    result=source.encode("utf-8")
    for marker in ('id="appearanceResults"','id="caseFolders"',
                   'id="browseGrid"',"saveCaseButton(entry)",
                   '/new/api/appearance-search?',MARKER,
                   '/new/api/appearance-multivector?', 'verified_same_person===false'):
        if marker not in source:raise RuntimeError("Missing core feature after patch: "+marker)
    if 'innerHTML=' in source and 'innerHTML=' not in old.decode("utf-8"):
        raise RuntimeError("New unsafe DOM rendering")
    if abs(len(result)-len(old))>10500:
        raise RuntimeError("UI patch changed too many bytes")
    return result,1


def atom(path,payload,st):
    fd,tmp=tempfile.mkstemp(prefix=".s9-multivector-ui-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as f:
            f.write(payload);f.flush();os.fsync(f.fileno())
        os.chmod(tmp,stat.S_IMODE(st.st_mode))
        try:os.chown(tmp,st.st_uid,st.st_gid)
        except PermissionError:pass
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)


def catalog():
    doc=json.loads(fetch(HOST+"/new/api/saved"))
    if doc.get("archive_mode")!="S9-microSD-only":raise RuntimeError("Live SD archive missing")
    clips={x.get("clip_no") for x in doc.get("events",[]) if isinstance(x,dict)}
    if len(clips)<150:raise RuntimeError("Insufficient verified SD originals")
    return clips


def api_check():
    u=HOST+"/new/api/appearance-multivector"
    # The endpoint may reject a missing reference, but that rejection must be
    # handled by the existing authenticated relay, not open raw embeddings.
    try:
        with urllib.request.urlopen(u+"?clip=motion_1000000000000.mp4",timeout=15) as r:
            doc=json.loads(r.read(20000))
        if doc.get("ok") is True:raise RuntimeError("Unknown reference unexpectedly indexable")
    except urllib.error.HTTPError as e:
        if e.code!=404:raise RuntimeError("Private API unavailable")
    # Probe a real reference from the source-qualified map without disclosing it.
    m=Path("/home/jespern/c720p-home-hub/state/s9-multivector-crop-map-v1.json")
    doc=json.loads(m.read_text())
    clip=doc["rows"][0]["clip"]
    response=json.loads(fetch(u+"?clip="+clip,200000))
    if (response.get("ok") is not True
        or response.get("appearance_only") is not True
        or response.get("verified_same_person") is not False
        or response.get("identity_probability") is not False
        or response.get("human_review_required") is not True
        or response.get("model_sha256")!=MODEL_SHA
        or not isinstance(response.get("results"),list)
        or not response["results"]):
        raise RuntimeError("Model-backed route not verified")
    return len(response["results"]),response.get("coverage",{}).get("real_person_crops")


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--apply",action="store_true")
    args=ap.parse_args()
    if not UI.is_file() or UI.is_symlink():raise RuntimeError("Unsafe live HA HTML")
    old=UI.read_bytes();owner=UI.stat()
    patched,changed=patch_html(old)
    originals=catalog()
    references,crops=api_check()
    report={"patched":bool(changed),"old_sha256":digest(old),
            "new_sha256":digest(patched),"live_sd_originals":len(originals),
            "verified_ranked_comparisons":references,
            "verified_person_crops":crops,"camera_changed":False,
            "review_decisions_changed":False,"recordings_changed":False}
    print("S9_MULTIVECTOR_APPEARANCE_UI_PREFLIGHT "+json.dumps(report),flush=True)
    if not args.apply:return
    if not changed:
        served=fetch(SERVED+"?mv="+digest(patched)[:16],120000)
        if digest(served)!=digest(patched):
            raise RuntimeError("Installed HTML not being served")
        print("S9_MULTIVECTOR_APPEARANCE_UI_LIVE_VERIFIED "+
              json.dumps({**report,"already":True}),flush=True)
        return
    BACKUP.mkdir(parents=True,mode=0o700,exist_ok=True)
    file=BACKUP/(dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")+".html")
    with file.open("xb") as f:f.write(old);f.flush();os.fsync(f.fileno())
    os.chmod(file,0o600)
    if file.read_bytes()!=old or UI.read_bytes()!=old:
        raise RuntimeError("UI preimage changed or backup failed")
    try:
        atom(UI,patched,owner)
        if UI.read_bytes()!=patched:raise RuntimeError("UI atom readback differs")
        served=fetch(SERVED+"?mv="+digest(patched)[:16],120000)
        if digest(served)!=digest(patched):
            raise RuntimeError("Home Assistant served a different UI version")
        after=catalog()
        if not originals.issubset(after):
            raise RuntimeError("One or more existing SD archive entries disappeared")
        api_check()
        print("S9_MULTIVECTOR_APPEARANCE_UI_LIVE_VERIFIED "+json.dumps({
            **report,"backup":str(file),"served_sha256":digest(served),
            "unchanged_recordings":len(after),"archival_invariants_passed":True,
            "camera_apk_changed":False,"archive_service_restarted":False}),flush=True)
    except BaseException:
        try:atom(UI,old,owner)
        except Exception:print("S9_MULTIVECTOR_UI_MANUAL_ROLLBACK_REQUIRED",flush=True)
        print("S9_MULTIVECTOR_APPEARANCE_UI_ROLLED_BACK",flush=True)
        raise


if __name__=="__main__":
    main()
