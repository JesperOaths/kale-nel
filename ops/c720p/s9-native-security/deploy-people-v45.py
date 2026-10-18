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

WWW=Path("/opt/homeassistant/config/www")
ROOT=WWW/"frontyard-security-new"
DEST={
 "html":ROOT/"security-people-v45.html",
 "js":ROOT/"security-people-v45.js",
 "tracks":ROOT/"security-tracks-v7.html",
 "shell":WWW/"c720p-surveillance.html",
 "hub":ROOT/"security-hub-v30.js",
 "entry":ROOT/"security-hub-v30.html",
}
ORIG={
 "html":"ops/c720p/s9-native-security/security-people-v45.html",
 "js":"ops/c720p/s9-native-security/security-people-v45.js",
 "tracks":"ops/c720p/s9-native-security/security-tracks-v7.html",
}
BACK=Path("/home/jespern/c720p-home-hub/backups/s9-people-v45-real-route")
PEOPLE_QUERY="s9pf-v51-active-hub-route-20261018"
TRACKS_QUERY="s9-v51-active-tracks-20261018"
ENTRY_OLD="security-hub-v30.js?v=people-faces-v49-folder-first-20261018"
ENTRY_MID="security-hub-v30.js?v=people-faces-v50-visible-route-20261018"
ENTRY_NEW="security-hub-v30.js?v=people-faces-v51-active-hub-route-20261018"
LEGACY_PEOPLE=re.compile(r"security-people-v33\.html(?:\?v=[A-Za-z0-9._-]+&)?")
TRACKS_ENTRY=re.compile(r"const TRACKS=(['\"])/local/frontyard-security-new/security-tracks-v7\.html(?:\?[^'\"]*)?\1;")
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
  else:
   for phrase in (b'data-summary-view="people"',b'data-summary-view="review"',b'data-summary-view="excluded"',b'data-view="excluded"',b"function selectView(view)"):
    if phrase not in b:raise RuntimeError("tracks_navigation_contract_missing")
  out[k]=b
 hub=prior["hub"][0].decode("utf-8")
 shell=prior["shell"][0].decode("utf-8") if prior["shell"][0] else ""
 entry=prior["entry"][0].decode("utf-8")
 if MARK not in hub:raise RuntimeError("expected_existing_v45_hub")
 active_shell=("s9v7-root-script" in shell and "s9v5-command-script" in shell)
 print("S9_SECURITY_ROUTE_DISCOVERY "+json.dumps({
  "shell_has_old_v7_scripts":active_shell,
  "shell_faces_iframe":"s9FacesGalleryFrame" in shell,
  "shell_tracks_url":"security-tracks-v7.html" in shell,
  "hub_people_legacy":"security-people-v33.html" in hub,
  "hub_people_v45":"security-people-v45.html" in hub,
  "hub_tracks_url":"security-tracks-v7.html" in hub}),flush=True)
 if MARK not in entry:raise RuntimeError("expected_existing_v45_entry")
 # Normalize both the legacy V33 route shown in the screenshots and
 # the V49 route from the previous failed-to-display deployment.
 def upgrade_faces_route(src):
  src=LEGACY_PEOPLE.sub("security-people-v45.html?v="+PEOPLE_QUERY+"&",src)
  v45=re.compile(r"security-people-v45\.html\?v=[A-Za-z0-9._-]+&")
  src=v45.sub("security-people-v45.html?v="+PEOPLE_QUERY+"&",src)
  return src
 hub=upgrade_faces_route(hub)
 shell=upgrade_faces_route(shell)
 if "security-people-v45.html?" not in hub:
  raise RuntimeError("no_known_people_navigation_route")
 def patch_tracks_route(match):
  return "const TRACKS='"+"/local/frontyard-security-new/security-tracks-v7.html?v="+TRACKS_QUERY+"';"
 track_urls=0
 if active_shell:
  shell,track_urls=TRACKS_ENTRY.subn(patch_tracks_route,shell)
  if track_urls!=1:raise RuntimeError("active_shell_tracks_iframe_route_not_found_"+str(track_urls))
 hub_tracks_re=re.compile(r"security-tracks-v7\.html(?:\?v=[A-Za-z0-9._-]+)?")
 hub,hub_track_urls=hub_tracks_re.subn("security-tracks-v7.html?v="+TRACKS_QUERY,hub)
 if track_urls+hub_track_urls==0:
  raise RuntimeError("no_active_tracks_navigation_url")
 if "security-people-v33.html" in hub or "security-people-v33.html" in shell:
  raise RuntimeError("legacy_people_frame_still_referenced")
 if ENTRY_OLD in entry:
  entry=update(entry,ENTRY_OLD,ENTRY_NEW,"entry")
 elif ENTRY_MID in entry:
  entry=update(entry,ENTRY_MID,ENTRY_NEW,"entry")
 elif ENTRY_NEW not in entry:
  raise RuntimeError("unknown_entry_script_version")
 out["hub"]=hub.encode("utf-8")
 out["shell"]=shell.encode("utf-8")
 out["entry"]=entry.encode("utf-8")
 # Verify the actual selectors used by the screenshot's sidebar route, not
 # merely that an unused secondary V45 page was written to disk.
 if "security-people-v45.html?v="+PEOPLE_QUERY not in hub:
  raise RuntimeError("visible_people_route_not_updated")
 if active_shell and 's9FacesGalleryFrame' not in shell:
  raise RuntimeError("legacy_shell_faces_iframe_not_present")
 if "security-people-v33.html" in shell:
  raise RuntimeError("live_faces_iframe_uses_old_page")
 if "security-tracks-v7.html?v="+TRACKS_QUERY not in hub and not (active_shell and "security-tracks-v7.html?v="+TRACKS_QUERY in shell):
  raise RuntimeError("visible_tracks_route_not_updated")
 if args.dry_run:
  print("S9_PEOPLE_V45_LIVE_ROUTE_DRY_RUN_PASS "+json.dumps({
   "source_ref":args.ref,"originals":len(old_clips),
   "routes_patched":['hub','shell','entry'],"new_media_written":False,
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
   prefix="/local/" if k=="shell" else "/local/frontyard-security-new/"
   url="http://127.0.0.1:8123"+prefix+path.name+"?version="+args.ref[:12]
   b=get(url,850000 if k=="shell" else 220000)
   if digest(b)!=digest(out[k]):raise RuntimeError("HA_not_serving_new_version_"+k)
   served[k]=digest(b)[:16]
  if b"security-people-v33.html" in out["hub"] or b"security-people-v33.html" in out["shell"]:
   raise RuntimeError("legacy_frame_in_deployed_files")
  new_clips=archive()
  if not old_clips.issubset(new_clips):raise RuntimeError("archive_records_disappeared")
  print("S9_PEOPLE_FACES_V45_ACTUAL_HUB_DEPLOY_VERIFIED "+json.dumps({
   "served_route":"security-hub-v30.html -> security-hub-v30.js -> security-people-v45.html -> security-people-v45.js",
   "source_ref":args.ref,"clip_count":len(new_clips),
   "served_sha16":served,"rollback":str(folder),"original_videos_modified":False,
   "camera_modified":False,"existing_approvals_modified":False,
   "visible_people_route_verified":True,"visible_tracks_route_verified":True,
   "active_shell":active_shell,"updated_hub_tracks_routes":hub_track_urls,"updated_shell_tracks_routes":track_urls,
   "clip_scoped_step3_review_enabled":True,"tracks_navigation_enabled":True,"automatic_identity_grouping_enabled":False}),flush=True)
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
