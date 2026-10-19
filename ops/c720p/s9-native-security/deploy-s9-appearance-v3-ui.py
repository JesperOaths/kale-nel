#!/usr/bin/env python3
"""Non-destructive opt-in V3 appearance mode for the existing HA Security page.

Patches only the inline Appearance Search section in security-face-folders-v22,
without replacing the HTML from git. Works with or without the existing V1
OSNet+HSV patch and retains that patch's code if already present.
Default is --dry-run. --apply requires verified V3 API and preserves a rollback.
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
import urllib.parse
import urllib.request

UI=Path("/opt/homeassistant/config/www/frontyard-security-new/security-face-folders-v22.html")
BACKUP=Path("/home/jespern/c720p-home-hub/backups/s9-appearance-v3-ui")
API="http://127.0.0.1:8795"
SERVED="http://127.0.0.1:8123/local/frontyard-security-new/security-face-folders-v22.html"
MAP=Path("/home/jespern/c720p-home-hub/state")
MARKER="S9_V3_APPEARANCE_SEARCH_UI_20261019"
OPTION='<option value="osnet_hsv_v3">Expanded S9+ V3 · appearance (review only)</option>'
MODE="osnet_hsv_v3"
JS=r"""
// S9_V3_APPEARANCE_SEARCH_UI_20261019 — read-only, never identity confirmation.
async function runV3ArchiveAppearance(clip,zone,run,status,host,button){
 if(!clipOK.test(clip)||!state.sd.some(r=>r.clip_no===clip)){
  status.textContent='Choose an indexed S9+ recording first.';return;
 }
 if(zone){
  status.textContent='For V3 appearance comparisons, choose Any mapped zone. Clothing HSV modes support scene filters.';return;
 }
 status.textContent='Checking the verified S9+ V3 appearance snapshot…';
 button.disabled=true;
 try{
  const doc=await get('/new/api/appearance-multivector-v3?'+new URLSearchParams({clip}).toString());
  if(run!==state.appearanceRequest||state.view!=='appearance')return;
  if(doc?.ok!==true||doc.ranking_schema!=='s9_appearance_rankings_v3'||
     doc.color_histogram_schema!=='s9_uniform_upper_torso_hsv32_v2'||
     !/^[a-f0-9]{16}$/.test(doc.corpus_id||'')||
     doc.appearance_only!==true||doc.verified_same_person!==false||
     doc.identity_probability!==false||doc.automatic_person_assignments!==0||
     doc.human_review_required!==true||
     doc.reference_source!=='s9_sd'||doc.reference_clip!==clip||
     !Array.isArray(doc.results)||doc.results.length>5||
     !Number.isInteger(doc.coverage?.real_person_crops)||
     doc.coverage.real_person_crops<58||doc.coverage.real_person_crops>400)
    throw Error('Unverified S9+ V3 appearance index');
  const known=new Map(state.sd.filter(r=>clipOK.test(String(r.clip_no||'')))
                        .map(r=>[r.clip_no,r]));
  for(const hit of doc.results){
   if(!hit||hit.source!=='s9_sd'||hit.clip_name===clip||
      !clipOK.test(String(hit.clip_name||''))||
      hit.appearance_only!==true||hit.verified_same_person!==false||
      hit.human_review_required!==true||hit.auto_assignment!==false||
      hit.method!=='visual_75_color_25'||
      typeof hit.similarity_percent!=='number'||!Number.isFinite(hit.similarity_percent)||
      hit.similarity_percent<0||hit.similarity_percent>100||
      typeof hit.similarity!=='number'||!Number.isFinite(hit.similarity)||
      Math.abs(hit.similarity*100-hit.similarity_percent)>0.02)
    throw Error('Unsafe V3 appearance match');
  }
  const accepted=doc.results.filter(hit=>known.has(hit.clip_name));
  status.textContent=accepted.length+' provisional V3 appearance comparison'+
    (accepted.length===1?'':'s')+' · '+doc.coverage.real_person_crops+
    ' verified full-person crops · no identity probability or automatic filing'+
    (accepted.length<doc.results.length?' · some originals are not in the current page catalog':'')+
    (!accepted.length?' · no comparable visible recording for this reference':'');
  for(const hit of accepted){
   const entry=item('sd',known.get(hit.clip_name));
   const card=el('article','record'),pic=el('div','record-preview'),
         body=el('div','record-body'),open=el('button','','Review original clip');
   pic.append(el('span','','S9+ original'));
   body.append(el('strong','',stamp(entry)),
      el('small','','Appearance similarity: '+hit.similarity_percent.toFixed(1)+'%'+
         ' · OSNet 75% + uniform torso HSV 25%'),
      el('small','','Provisional comparison only, not same-person probability'),
      el('small','','Person identity not verified · manual review required'));
   open.type='button';open.addEventListener('click',()=>openClip(entry));body.append(open);
   body.append(saveCaseButton(entry));
   card.append(pic,body);host.append(card);signedPicture(pic,entry);
  }
 }catch(e){
  if(run!==state.appearanceRequest||state.view!=='appearance')return;
  const notReady=/Status (404|503)/.test(String(e?.message||''));
  status.textContent=notReady
   ?'V3 has not indexed this clip or its verified snapshot is unavailable. Use existing OSNet V1 or HSV clothing mode meanwhile.'
   :'V3 comparison verification failed. Existing V1 and HSV clothing searches are unchanged.';
 }finally{if(run===state.appearanceRequest)button.disabled=false}
}
"""

def sha(data):return hashlib.sha256(data).hexdigest()
def fetch(url,limit=5000000):
    with urllib.request.urlopen(url,timeout=22) as reply:
        if reply.status!=200:raise RuntimeError("Private authenticated endpoint unavailable")
        raw=reply.read(limit+1)
    if len(raw)>limit:raise RuntimeError("Unexpectedly large read")
    return raw

def patch(original):
    text=original.decode("utf-8")
    if MARKER in text:
        if (text.count(MARKER)!=1 or text.count(OPTION)!=1 or
            text.count("async function runV3ArchiveAppearance(")!=1 or
            text.count("if(category==='osnet_hsv_v3'){")!=1):
            raise RuntimeError("Partially applied V3 UI mode; inspect manually")
        return original,False
    existing="<option value=\"upper_clothing\">Upper clothing colour</option>"
    if text.count(existing)!=1 or "id=\"appearanceCategory\"" not in text:
        raise RuntimeError("Appearance mode dropdown anchor unexpectedly changed")
    text=text.replace(existing,OPTION+existing,1)
    source="async function runAppearanceSearch(){"
    if text.count(source)!=1:raise RuntimeError("Appearance search function anchor changed")
    text=text.replace(source,JS+"\n"+source,1)
    pos=text.index(source)
    mark=" host.replaceChildren();\n"
    location=text.find(mark,pos)
    if location<0 or location-pos>750:
        raise RuntimeError("Appearance result list clearing anchor moved")
    branch=""" host.replaceChildren();
 if(category==='osnet_hsv_v3'){
  await runV3ArchiveAppearance(clip,zone,run,status,host,button);return;
 }
"""
    text=text[:location]+text[location:].replace(mark,branch,1)
    for invariant in ('id="appearanceResults"','id="appearanceGo"',
                      "async function runAppearanceSearch(){",
                      "/new/api/appearance-search?",'id="caseFolders"',
                      "saveCaseButton(entry)","signedPicture(pic,entry)",
                      "runV3ArchiveAppearance(clip,zone,run,status,host,button)"):
        if invariant not in text:
            raise RuntimeError("Required old or new Security feature missing: "+invariant)
    if len(text.encode())-len(original)>6500:
        raise RuntimeError("Unbounded UI patch")
    return text.encode("utf-8"),True

def api_reference():
    pointer=MAP/"s9-multivector-v3-active.json"
    if pointer.is_symlink() or not pointer.is_file():
        raise RuntimeError("Verified V3 index has not been activated")
    doc=json.loads(pointer.read_text())
    corpus=doc.get("corpus_id")
    if not isinstance(corpus,str) or not re.fullmatch(r"[a-f0-9]{16}",corpus):
        raise RuntimeError("Untrusted active V3 corpus ID")
    source=MAP/("s9-multivector-crop-map-v3-"+corpus+".json")
    if source.is_symlink() or not source.is_file():
        raise RuntimeError("Active V3 source map unavailable")
    raw=source.read_bytes()
    if sha(raw)!=doc.get("map_sha256"):raise RuntimeError("Active V3 map SHA mismatch")
    rows=json.loads(raw).get("rows")
    if not isinstance(rows,list) or len(rows)<58 or not isinstance(rows[0],dict):
        raise RuntimeError("V3 source record unavailable")
    clip=rows[0].get("clip")
    if not isinstance(clip,str) or not re.fullmatch(r"motion_[0-9]{13}[.]mp4",clip):
        raise RuntimeError("Invalid verified V3 sample clip")
    return clip

def verify_api(clip):
    url=API+"/new/api/appearance-multivector-v3?"+urllib.parse.urlencode({"clip":clip})
    doc=json.loads(fetch(url,300000))
    if (doc.get("ok") is not True or
        doc.get("ranking_schema")!="s9_appearance_rankings_v3" or
        doc.get("reference_clip")!=clip or
        doc.get("appearance_only") is not True or
        doc.get("identity_probability") is not False or
        doc.get("automatic_person_assignments")!=0 or
        doc.get("human_review_required") is not True or
        doc.get("coverage",{}).get("real_person_crops",0)<58 or
        not isinstance(doc.get("results"),list)):
        raise RuntimeError("No verified live V3 comparison response")
    return int(doc["coverage"]["real_person_crops"])

def save_atomic(where,data,metadata):
    file,tmp=tempfile.mkstemp(prefix=".s9-v3-appearance-",dir=where.parent)
    try:
        with os.fdopen(file,"wb") as fp:
            fp.write(data);fp.flush();os.fsync(fp.fileno())
        os.chmod(tmp,stat.S_IMODE(metadata.st_mode))
        try:os.chown(tmp,metadata.st_uid,metadata.st_gid)
        except PermissionError:pass
        os.replace(tmp,where)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--apply",action="store_true")
    opts=ap.parse_args()
    if UI.is_symlink() or not UI.is_file():
        raise RuntimeError("Existing HA Security page unavailable")
    old=UI.read_bytes();metadata=UI.stat()
    data,changed=patch(old)
    print("S9_APPEARANCE_V3_UI_DRY_RUN "+json.dumps({
        "patched":changed,"before_sha256":sha(old),"after_sha256":sha(data),
        "v1_or_hsv_ui_replaced":False,"camera_apk_modified":False,
        "reviews_modified":False}),flush=True)
    if not opts.apply:return
    sample=api_reference()
    count=verify_api(sample)
    if changed:
        BACKUP.mkdir(mode=0o700,parents=True,exist_ok=True)
        file=BACKUP/(dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")+".html")
        with file.open("xb") as b:
            b.write(old);b.flush();os.fsync(b.fileno())
        os.chmod(file,0o600)
        if UI.read_bytes()!=old or file.read_bytes()!=old:
            raise RuntimeError("Concurrent UI change or backup failure")
    try:
        if changed:save_atomic(UI,data,metadata)
        if UI.read_bytes()!=data:raise RuntimeError("UI changed after V3 patch")
        served=fetch(SERVED+"?appearance_v3_sha="+sha(data)[:16],200000)
        if sha(served)!=sha(data):
            raise RuntimeError("Home Assistant served a different Security page")
        verify_api(sample)
        print("S9_APPEARANCE_V3_UI_LIVE_VERIFIED "+json.dumps({
            "ui_sha256":sha(data),"verified_v3_crops":count,
            "v1_and_hsv_unchanged":True,"recordings_modified":False,
            "camera_apk_modified":False,"human_reviews_modified":False}),flush=True)
    except BaseException:
        if changed:
            try:save_atomic(UI,old,metadata)
            except Exception:print("S9_APPEARANCE_V3_UI_MANUAL_ROLLBACK_REQUIRED",flush=True)
        raise

if __name__=="__main__":main()
