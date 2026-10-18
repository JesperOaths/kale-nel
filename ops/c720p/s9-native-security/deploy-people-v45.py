#!/usr/bin/env python3
"""Safely install independent People & Faces V45 on the *actual* HA Security tab.

Immutable Git commit source, transactional disk backups, verified HTTP readback,
and exact route version bump. Does NOT touch S9 APK, 4K media, scan indices,
people approvals, private review API, or the movement detector.
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

ROOT=Path("/opt/homeassistant/config/www/frontyard-security-new")
DEST={
 "html":ROOT/"security-people-v45.html",
 "js":ROOT/"security-people-v45.js",
 "people50":ROOT/"security-people-v50.html",
 "tracks50":ROOT/"security-tracks-v50.html",
 "legacy":ROOT/"security-people-v33.html",
 "shell":Path("/opt/homeassistant/config/www/c720p-surveillance.html"),
 "tracks":ROOT/"security-tracks-v7.html",
 "review":ROOT/"security-review-v8.html",
 "archive":ROOT/"security-archive-v7.html",
 "hub":ROOT/"security-hub-v30.js",
 "entry":ROOT/"security-hub-v30.html",
}
ORIG={
 "html":"ops/c720p/s9-native-security/security-people-v45.html",
 "js":"ops/c720p/s9-native-security/security-people-v45.js",
 "tracks":"ops/c720p/s9-native-security/security-tracks-v7.html",
 "review":"ops/c720p/s9-native-security/security-review-v8.html",
 "archive":"ops/c720p/s9-native-security/security-archive-v7.html",
}
BACK=Path("/home/jespern/c720p-home-hub/backups/s9-people-v45-real-route")
OLD="security-people-v45.html?v=s9pf-v49-folder-first-20261018&"
NEW="security-people-v50.html?v=security-visible-route-v53-20261018&"
ENTRY_OLD="security-hub-v30.js?v=people-faces-v49-folder-first-20261018"
ENTRY_NEW="security-hub-v30.js?v=security-visible-route-v53-20261018"
MARK="s9-people-v45-real-route"
def digest(b):return hashlib.sha256(b).hexdigest()
def get(url,limit=220000):
 with urllib.request.urlopen(url,timeout=35) as r:
  if r.status!=200:raise RuntimeError("source_http_unavailable")
  b=r.read(limit+1)
 if not 70<len(b)<=limit:raise RuntimeError("http_bounded_read_invalid")
 return b
def archive():
 data=json.loads(get("http://127.0.0.1:8795/new/api/saved",1500000))
 if data.get("archive_mode")!="S9-microSD-only":raise RuntimeError("archive_mode_invalid")
 names={e.get("clip_no") for e in data.get("events",[]) if isinstance(e,dict)}
 if len(names)<70:raise RuntimeError("archive_missing_unsafe_to_deploy")
 return names
def update(source,old,new,tag):
 if source.count(old)!=1:raise RuntimeError("unexpected_live_route_"+tag+"_"+str(source.count(old)))
 return source.replace(old,new)
def atom(path,body,prior):
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,name=tempfile.mkstemp(prefix=".s9-pf-v45-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:
   f.write(body);f.flush();os.fsync(f.fileno())
  os.chmod(name,stat.S_IMODE(prior.st_mode) if prior else 0o644)
  if prior:
   try:os.chown(name,prior.st_uid,prior.st_gid)
   except PermissionError:pass
  os.replace(name,path)
 finally:
  if os.path.exists(name):os.unlink(name)
def main():
 p=argparse.ArgumentParser()
 p.add_argument("--ref",required=True)
 p.add_argument("--dry-run",action="store_true")
 args=p.parse_args()
 if not re.fullmatch("[a-f0-9]{40}",args.ref):raise RuntimeError("immutable_sha_required")
 old_clips=archive()
 prior={}
 for k,path in DEST.items():
  if path.is_symlink():raise RuntimeError("symlink_refused_"+k)
  b=path.read_bytes() if path.exists() else None
  prior[k]=(b,path.stat() if b is not None else None)
 if prior["hub"][0] is None or prior["entry"][0] is None:
  raise RuntimeError("live_hub_files_missing")
 out={}
 for k,source in ORIG.items():
  b=get("https://raw.githubusercontent.com/JesperOaths/kale-nel/"+args.ref+"/"+source)
  if k=="html":
   for phrase in (b'id="reviewPreview"',b'id="snapshotViewer"',b'id="snapshotImage"',b'id="snapshotPlay"',b'id="personScanProgress"',b'id="faceScanProgress"',b'id="facePhotoStatus"',b'id="reviewAlerts"',b'id="folderRecheck"',b'id="savedPreview"',b'id="faceGrid"',
                  b'id="approvalConfirmed"',b'id="faceGrouping"',b'id="faceSearch"',b'id="snapshotPrev"',b'id="snapshotNext"',b"security-people-v45.js",b"step3-evidence"):
    if phrase not in b:raise RuntimeError("html_interface_contract_missing")
  elif k=="js":
   for phrase in (b"clip_folders_v40",b"manual-attributes-v36",
                  b"human_confirmed:true",b"loadView()",b"fetchFaces()",b"inspectFaceSnapshot(f)",b"facesInRecording(clip)",b"step3ClipEvidence(item)"):
    if phrase not in b:raise RuntimeError("js_review_contract_missing")
  elif k=="tracks":
   for phrase in (b'data-summary-view="people"',b'data-summary-view="review"',b'data-summary-view="excluded"',b'data-view="excluded"',b"function selectView(view)"):
    if phrase not in b:raise RuntimeError("tracks_navigation_contract_missing")
  elif k in ("review","archive") and b"<html" not in b:
   raise RuntimeError("security_view_source_invalid_"+k)
  out[k]=b

 # Use fresh filenames to prevent Firefox or a cached iframe from reusing an
 # older HTML document even when Home Assistant has already updated the file.
 people_v50=out["html"].replace(
  b"security-people-v45.js?v=v53-20261018-face-blob",
  b"security-people-v45.js?v=security-face-review-v53-20261018")
 if people_v50==out["html"]:raise RuntimeError("people_js_version_contract_missing")
 out["people50"]=people_v50
 out["tracks50"]=out["tracks"]
 # The old V33 page is still requested by some older shell frames. Redirect
 # it to the maintained page instead of leaving two different UIs available.
 legacy_bytes=prior["legacy"][0]
 if legacy_bytes is None:raise RuntimeError("legacy_people_page_missing")
 legacy_text=legacy_bytes.decode("utf-8","replace").lower()
 legacy_known=(("people" in legacy_text and "folder" in legacy_text) or
               "security-people-v45.html" in legacy_text or
               "security-people-v50.html" in legacy_text)
 print("S9_LEGACY_ROUTE_DISCOVERY "+json.dumps({
  "known_people_page":legacy_known,
  "has_folder_script":"people-folders" in legacy_text,
  "has_pf_navigation":"pfnav" in legacy_text,
  "is_existing_v50_redirect":"security-people-v50.html" in legacy_text,
  "html_bytes":len(legacy_bytes)}),flush=True)
 # Unrecognized stub/redirect at the exact V33 path is preserved unchanged.
 # The currently served navigation is updated to the new V50 filenames below.
 # Do not overwrite a file merely because its historical name ends in V33.
 out["legacy"]=(
  '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  '<meta name="robots" content="noindex,nofollow">'
  '<meta http-equiv="Cache-Control" content="no-store">'
  '<meta http-equiv="refresh" content="0;url=security-people-v50.html?v=security-visible-route-v53-20261018">'
  '<title>Opening People &amp; Faces</title></head><body>'
  '<p>Opening <a href="security-people-v50.html?v=security-visible-route-v53-20261018">People &amp; Faces</a>...</p>'
  '<script>location.replace("security-people-v50.html?v=security-visible-route-v53-20261018")</script>'
  '</body></html>').encode()
 if not legacy_known:
  out["legacy"]=legacy_bytes
 hub=prior["hub"][0].decode("utf-8")
 if MARK not in hub:raise RuntimeError("expected_existing_v45_hub")
 if NEW not in hub:
  hub,n=re.subn(r"security-people-v(?:45|50)[.]html[?]v=[A-Za-z0-9._-]+&",NEW,hub)
  if n!=1:raise RuntimeError("unrecognized_people_hub_route_"+str(n))
 if "security-tracks-v50.html?v=security-visible-route-v53-20261018&" not in hub:
  hub,n=re.subn(r"security-tracks-v(?:7|50)[.]html[?](?:v=[A-Za-z0-9._-]+&)?",
                "security-tracks-v50.html?v=security-visible-route-v53-20261018&",hub)
  if n!=1:raise RuntimeError("unrecognized_tracks_hub_route_"+str(n))
 hub=re.sub(r"security-review-v8[.]html[?]mode=evidence(?:&v=[A-Za-z0-9._-]+)?&",
            "security-review-v8.html?mode=evidence&v=security-analytics-v53-20261018&",hub)
 hub=re.sub(r"security-archive-v7[.]html(?:[?]v=[A-Za-z0-9._-]+)?&",
            "security-archive-v7.html?v=security-archive-grid-v53-20261018&",hub)
 out["hub"]=hub.encode("utf-8")
 entry=prior["entry"][0].decode("utf-8")
 if MARK not in entry:raise RuntimeError("expected_existing_v45_entry")
 if ENTRY_NEW not in entry:
  entry,n=re.subn(
    r"security-hub-v30[.]js[?]v=(?:people-faces-v49-folder-first|people-faces-v50-route-correction|people-faces-v50-visible-route|security-visible-route-v50|security-visible-route-v51|security-visible-route-v52)-20261018",
    ENTRY_NEW,entry)
  if n!=1:raise RuntimeError("unrecognized_hub_entry_route_"+str(n))
 out["entry"]=entry.encode("utf-8")
 shell=prior["shell"][0].decode("utf-8")
 # Rewrite both the older direct-iframe references and hub references.
 # Do not require speculative outer-shell marker strings.
 shell,nold=re.subn(
  r"security-people-v33[.]html(?:[?]v=[A-Za-z0-9._-]+)?",
  "security-people-v50.html?v=security-visible-route-v53-20261018",shell)
 shell,nprevious=re.subn(
  r"security-people-v(?:45|50)[.]html[?]v=[A-Za-z0-9._-]+",
  "security-people-v50.html?v=security-visible-route-v53-20261018",shell)
 shell,ntracks=re.subn(
  r"security-tracks-v(?:7|50)[.]html(?:[?]v=[A-Za-z0-9._-]+)?",
  "security-tracks-v50.html?v=security-visible-route-v53-20261018",shell)
 updated,count=re.subn(
  r"(security-hub-v30[.](?:js|html))(?:[?]v=[A-Za-z0-9._-]+)?",
  lambda m:m.group(1)+"?v=security-visible-route-v53-20261018",
  shell)
 updated=re.sub(r"security-review-v8[.]html[?]mode=evidence(?:&v=[A-Za-z0-9._-]+)?",
            "security-review-v8.html?mode=evidence&v=security-analytics-v53-20261018",updated)
 updated=re.sub(r"security-archive-v7[.]html(?:[?]v=[A-Za-z0-9._-]+)?",
            "security-archive-v7.html?v=security-archive-grid-v53-20261018",updated)
 out["shell"]=updated.encode("utf-8")
 if OLD.encode() in out["hub"] or ENTRY_OLD.encode() in out["entry"]:
  raise RuntimeError("old_route_retained_in_staged_assets")
 if args.dry_run:
  print("S9_PEOPLE_V45_LIVE_ROUTE_DRY_RUN_PASS "+json.dumps({
   "source_ref":args.ref,"originals":len(old_clips),
   "routes_patched":['hub','entry','legacy','shell','tracks50'],"new_media_written":False,
   "assets":{k:len(v) for k,v in out.items()}}),flush=True)
  return
 BACK.mkdir(parents=True,exist_ok=True);os.chmod(BACK,0o700)
 name=dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 folder=BACK/name;folder.mkdir(mode=0o700)
 for k,(b,_) in prior.items():
  if b is not None:
   save=folder/(k+"-previous")
   save.write_bytes(b);os.chmod(save,0o600)
   if save.read_bytes()!=b:raise RuntimeError("backup_not_verified_"+k)
 changed=[]
 try:
  for k,path in DEST.items():
   b,owner=prior[k]
   if b==out[k]:continue
   if (path.read_bytes() if path.exists() else None)!=b:
    raise RuntimeError("concurrent_local_edit_"+k)
   atom(path,out[k],owner);changed.append(k)
  for k,path in DEST.items():
   if digest(path.read_bytes())!=digest(out[k]):
    raise RuntimeError("installed_readback_invalid_"+k)
  served={}
  for k,path in DEST.items():
   relative=("local/"+path.name if k=="shell" else "local/frontyard-security-new/"+path.name)
   url="http://127.0.0.1:8123/"+relative+"?version="+args.ref[:12]
   b=get(url,850000 if k=="shell" else 220000)
   if digest(b)!=digest(out[k]):raise RuntimeError("HA_not_serving_new_version_"+k)
   served[k]=digest(b)[:16]
  if OLD.encode() in out["hub"] or (ENTRY_OLD+'"').encode() in out["entry"]:
   raise RuntimeError("old_route_retained")
  new_clips=archive()
  if not old_clips.issubset(new_clips):raise RuntimeError("archive_records_disappeared")
  print("S9_PEOPLE_FACES_V45_ACTUAL_HUB_DEPLOY_VERIFIED "+json.dumps({
   "served_route":"security-hub-v30.html -> security-hub-v30.js -> security-people-v50.html -> security-people-v45.js",
   "source_ref":args.ref,"clip_count":len(new_clips),
   "served_sha16":served,"rollback":str(folder),"original_videos_modified":False,
   "camera_modified":False,"existing_approvals_modified":False,
   "clip_scoped_step3_review_enabled":True,"tracks_navigation_enabled":True,"legacy_route_redirected":legacy_known,"legacy_unknown_preserved":not legacy_known,"fresh_iframe_assets_installed":True,"evidence_archive_ui_updated":True,"automatic_identity_grouping_enabled":False}),flush=True)
 except BaseException:
  for k in reversed(changed):
   path=DEST[k];b,owner=prior[k]
   try:
    if b is None:path.unlink(missing_ok=True)
    else:atom(path,b,owner)
   except Exception:print("S9_PEOPLE_V45_MANUAL_RESTORE_REQUIRED_"+k,flush=True)
  print("S9_PEOPLE_V45_DEPLOY_ROLLED_BACK",flush=True)
  raise
if __name__=="__main__":main()
