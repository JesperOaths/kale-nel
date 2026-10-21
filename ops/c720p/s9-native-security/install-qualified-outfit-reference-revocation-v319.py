#!/usr/bin/env python3
"""Guarded additive live C720P JS patch for current manual authority.

Never installs an older source snapshot, rewrites reviews, or touches S9+ media.
Supports already-patched OSNet/HSV UI by replacing only five exact anchors.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import urllib.request

ROOT = Path("/opt/homeassistant/config/www/frontyard-security-new")
JS = ROOT / "security-people-v45.js"
PAGE = ROOT / "security-people-v50.html"
BACKUP = Path("/home/jespern/c720p-home-hub/backups/reference-revocation-v319")
SITE = "http://127.0.0.1:8123/local/frontyard-security-new/"
API = "http://127.0.0.1:8795/new/api/s9-manual-recording-links"
MARK = "QUALIFIED_OUTFIT_REFERENCE_REVOCATION_V319"
ADD = """// QUALIFIED_OUTFIT_REFERENCE_REVOCATION_V319
// Source-qualified latest manual assignments override V40 history.
// Group-filed recordings may never become a named single-person reference.
function qualifiedOutfitReference(item,personId=null){
 if(item?.source!=='sd'||!state.assignedReady||!state.extraLinks)return false;
 const people=assignedFolders(item);
 if(people.length!==1||(personId!==null&&people[0]!==personId))return false;
 const key=assignmentKey(item),explicit=state.extraLinks.items[key];
 if(explicit!==undefined)
  return !!explicit&&typeof explicit==='object'&&explicit.review_status==='assigned';
 return state.legacyAssigned.get(key)===people[0];
}
"""

def sha(b):
    return hashlib.sha256(b).hexdigest()

def read(path):
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("unsafe_or_missing_live_file")
    if not 3000 < path.stat().st_size < 240000:
        raise RuntimeError("unexpected_live_file_size")
    return path.read_bytes(), path.stat()

def replace_once(source, old, new):
    if source.count(old) != 1:
        raise RuntimeError("live_ui_anchor_changed_refusing_older_replacement")
    return source.replace(old, new, 1)

def patch(raw):
    source=raw.decode("utf-8")
    if MARK in source:
        if (source.count(MARK)!=1 or
            "function qualifiedOutfitReference(" not in source or
            "match.references.every(clip=>" not in source or
            "if(!qualifiedOutfitReference(ref))continue;" not in source):
            raise RuntimeError("partial_reference_guard")
        return raw,False
    source=replace_once(source, "function outfitReviewEligible(clip){",
                        ADD+"function outfitReviewEligible(clip){")
    source=replace_once(source,
       "const sources=state.archiveEntries.filter(x=>x.source==='sd'&&assignedFolder(x)&&",
       "const sources=state.archiveEntries.filter(x=>qualifiedOutfitReference(x)&&")
    source=replace_once(source, "for(const ref of sources){",
       "for(const ref of sources){\n  if(!qualifiedOutfitReference(ref))continue;")
    source=replace_once(source,
       "const matches=(state.clothingMatches||[]).filter(match=>outfitReviewEligible(match.clip));",
       """const matches=(state.clothingMatches||[]).filter(match=>
   outfitReviewEligible(match.clip)&&Array.isArray(match.references)&&
   match.references.length>0&&match.references.every(clip=>
     qualifiedOutfitReference({source:'sd',name:clip,clip},match.person.id)));""")
    if "async function fetchAutomatic()" not in source or "async function searchClothingMatches(" not in source:
        raise RuntimeError("existing_person_workflows_missing")
    if len(source)-len(raw)>1500:
        raise RuntimeError("unexpected_patch_size")
    return source.encode(),True

def patch_page(raw):
    source=raw.decode("utf-8")
    existing=re.findall(r"security-people-v45[.]js[?]v=[A-Za-z0-9._-]+",source)
    if len(existing)!=1:
        raise RuntimeError("page_cache_link_unavailable")
    current=existing[0]
    newest="security-people-v45.js?v=qualified-outfit-v319-20261021"
    if current==newest:return raw,False
    return source.replace(current,newest,1).encode(),True

def http(url,limit):
    with urllib.request.urlopen(url,timeout=22) as r:
        if r.status!=200:raise RuntimeError("served_ui_unavailable")
        data=r.read(limit+1)
    if len(data)>limit:raise RuntimeError("oversized_http_response")
    return data

def atom(path,content,oldstat):
    fd,tmp=tempfile.mkstemp(prefix=".reference-revocation-v319-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as f:
            f.write(content);f.flush();os.fsync(f.fileno())
        os.chmod(tmp,stat.S_IMODE(oldstat.st_mode))
        try:os.chown(tmp,oldstat.st_uid,oldstat.st_gid)
        except PermissionError:pass
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply",action="store_true")
    args=parser.parse_args()
    old,js_stat=read(JS);old_page,page_stat=read(PAGE)
    target,js_change=patch(old)
    page_target,page_change=patch_page(old_page)
    status=json.loads(http(API,600000))
    if status.get("manual_links_only") is not True or not isinstance(status.get("items"),dict):
        raise RuntimeError("latest_manual_authority_unavailable")
    served=http(SITE+JS.name+"?before="+sha(old)[:12],240000)
    served_page=http(SITE+PAGE.name+"?before="+sha(old_page)[:12],240000)
    if served!=old or served_page!=old_page:raise RuntimeError("served_ui_source_mismatch")
    node=shutil.which("node") or shutil.which("nodejs")
    if node:
        p=subprocess.run([node,"--check"],input=target,stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE,timeout=15)
        if p.returncode:raise RuntimeError("javascript_syntax_invalid")
    info={"check":"qualified_reference_revocation_v319",
          "live_preimage_sha256":sha(old),"target_sha256":sha(target),
          "changed":js_change,"html_changed":page_change,
          "manual_revision":status.get("revision"),
          "manual_links_count":len(status["items"]),
          "original_media_modified":False,"manual_assignments_modified":False,
          "camera_or_workers_restarted":False}
    print("REFERENCE_REVOCATION_V319_PREFLIGHT "+json.dumps(info,sort_keys=True),flush=True)
    if not args.apply:return
    if not js_change and not page_change:
        print("REFERENCE_REVOCATION_V319_LIVE_VERIFIED "+
              json.dumps({**info,"already":True},sort_keys=True),flush=True)
        return
    BACKUP.mkdir(parents=True,mode=0o700,exist_ok=True)
    tag=dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    paths=[(JS,old,target,js_stat,js_change),(PAGE,old_page,page_target,page_stat,page_change)]
    for f,original,new,metadata,change in paths:
        backup=BACKUP/(tag+"-"+f.name)
        with backup.open("xb") as w:
            w.write(original);w.flush();os.fsync(w.fileno())
        os.chmod(backup,0o600)
        if backup.read_bytes()!=original:raise RuntimeError("backup_parity_failed")
    if JS.read_bytes()!=old or PAGE.read_bytes()!=old_page:
        raise RuntimeError("live_source_changed_before_write")
    touched=[]
    try:
        for f,original,new,metadata,change in paths:
            if change:atom(f,new,metadata);touched.append((f,original,metadata))
        if JS.read_bytes()!=target or PAGE.read_bytes()!=page_target:
            raise RuntimeError("installed_source_mismatch")
        if (http(SITE+JS.name+"?after="+sha(target)[:16],240000)!=target or
            http(SITE+PAGE.name+"?after="+sha(page_target)[:16],240000)!=page_target):
            raise RuntimeError("served_source_mismatch")
        status_after=json.loads(http(API,600000))
        if (status_after.get("manual_links_only") is not True or
            status_after.get("revision")!=status.get("revision")):
            raise RuntimeError("review_source_changed_during_install")
        print("REFERENCE_REVOCATION_V319_LIVE_VERIFIED "+
            json.dumps({**info,"served_sha256":sha(target),
                "html_served_sha256":sha(page_target)},sort_keys=True),flush=True)
    except BaseException:
        for f,original,metadata in reversed(touched):
            try:atom(f,original,metadata)
            except Exception:print("REFERENCE_REVOCATION_RESTORE_REQUIRED",flush=True)
        print("REFERENCE_REVOCATION_V319_ROLLED_BACK",flush=True)
        raise

if __name__=="__main__":main()
