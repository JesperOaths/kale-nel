#!/usr/bin/env python3
"""Deploy Drive thumbnail loading only after its visible card enters the DOM.

On some browser/tab lifecycle paths requestAnimationFrame is deferred, so
creating previews against detached nodes produced img elements without src.
Always append details to the live document before the first Drive card, then
append each card before invoking its preview loader. Backup and verify both
live HTML and its iframe/script cache versions. Never changes Drive media.
"""
from __future__ import annotations
import datetime,hashlib,json,os,pathlib,urllib.request,sys
ROOT=pathlib.Path("/opt/homeassistant/config/www")
HTML=ROOT/"frontyard-security-new/security-archive-v7.html"
HUB=ROOT/"frontyard-security-new/security-hub-v30.js"
SHELL=ROOT/"c720p-surveillance.html"
BACK=pathlib.Path("/home/jespern/c720p-home-hub/backups/drive-thumbnails-mount-v2")
MARK=b"DRIVE_THUMBNAILS_MOUNTED_BEFORE_FETCH_V2"
def sha(v):return hashlib.sha256(v).hexdigest()
def apply_patches():
 source=HTML.read_bytes()
 sep=b"\r\n" if b"\r\n" in source else b"\n"
 changes={}
 def put_once(data,old,new,filename):
  if data.count(old)!=1:raise RuntimeError(filename+":expected_one_anchor_"+str(data.count(old)))
  return data.replace(old,new,1)
 # The preview loader must no longer run while the card is still detached.
 source=put_once(source,
  b"btn.addEventListener('click',()=>playDrive(r));drivePreview(img,r);",
  b"btn.addEventListener('click',()=>playDrive(r));",
  "driveCard")
 source=put_once(source,
  b"const populate=()=>{if(loadedCards)return;loadedCards=true;for(const r of groups.get(d))cards.append(driveCard(r))};",
  b"const populate=()=>{if(loadedCards)return;loadedCards=true;for(const r of groups.get(d)){const card=driveCard(r);cards.append(card);const img=card.querySelector('.picture img');if(img)drivePreview(img,r)}};",
  "drivePopulate")
 old=(b" if(details.open)populate();"+sep+
      b"  details.addEventListener('toggle',()=>{if(details.open){driveOpenDays.add(d);populate()}else driveOpenDays.delete(d)});"+sep+
      b"  target.append(details);")
 # The actual layout may use two spaces for these lines: normalize exact
 # snippet based on the known ordered code rather than wholesale reformat.
 if source.count(old)!=1:
  old=(b"  if(details.open)populate();"+sep+
      b"  details.addEventListener('toggle',()=>{if(details.open){driveOpenDays.add(d);populate()}else driveOpenDays.delete(d)});"+sep+
      b"  target.append(details);")
 new=(b"  // DRIVE_THUMBNAILS_MOUNTED_BEFORE_FETCH_V2: connect details before images."+sep+
      b"  target.append(details);"+sep+
      b"  if(details.open)populate();"+sep+
      b"  details.addEventListener('toggle',()=>{if(details.open){driveOpenDays.add(d);populate()}else driveOpenDays.delete(d)});")
 source=put_once(source,old,new,"driveDetailsMount")
 source=put_once(source,
  b" // DRIVE_PREVIEW_DOM_ATTACH_FIX_V1: wait for card insertion before checking isConnected."+sep+
  b" requestAnimationFrame(fetchPreview);",
  b" // The caller has now inserted this card into the connected Drive timeline."+sep+
  b" fetchPreview();",
  "drivePreviewLifecycle")
 changes[HTML]=source
 h=HUB.read_bytes()
 h=put_once(h,b"security-archive-v7.html?v=drive-thumb-dom-v1&",
            b"security-archive-v7.html?v=drive-thumb-mount-v2&","iframeVersion")
 changes[HUB]=h
 s=SHELL.read_bytes()
 s=put_once(s,b"security-hub-v30.js?v=drive-thumb-dom-v1-20261014",
             b"security-hub-v30.js?v=drive-thumb-mount-v2-20261014","shellVersion")
 changes[SHELL]=s
 return changes
def main():
 for p in (HTML,HUB,SHELL):
  if not p.is_file() or p.is_symlink():raise RuntimeError("missing_or_symlink_"+p.name)
 current={p:p.read_bytes() for p in (HTML,HUB,SHELL)}
 if MARK in current[HTML]:
  print(json.dumps({"installed":True,"already":True,"hash":sha(current[HTML])}));return 0
 updated=apply_patches()
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 folder=BACK/stamp;folder.mkdir(parents=True,exist_ok=False)
 for p,old in current.items():
  fd=os.open(folder/(p.name+".before"),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,"wb") as f:f.write(old);f.flush();os.fsync(f.fileno())
 installed=[]
 try:
  for p,blob in updated.items():
   temp=p.with_name("."+p.name+".drive-thumb-v2.tmp")
   try:
    with temp.open("wb") as f:f.write(blob);f.flush();os.fsync(f.fileno())
    temp.chmod(p.stat().st_mode&0o777)
    os.replace(temp,p)
    if p.read_bytes()!=blob:raise RuntimeError("readback_mismatch_"+p.name)
    installed.append(p)
   finally:
    if temp.exists():temp.unlink()
  for p,blob in updated.items():
   u="http://127.0.0.1:8123/local/"+str(p.relative_to(ROOT))+"?verify="+stamp
   with urllib.request.urlopen(u,timeout=12) as response:
    served=response.read(180000)
    if response.status!=200 or served!=blob:raise RuntimeError("HA_http_readback_mismatch_"+p.name)
  print(json.dumps({"ok":True,"version":"DRIVE_THUMBNAILS_MOUNTED_BEFORE_FETCH_V2",
    "deployed_sha256":{p.name:sha(blob) for p,blob in updated.items()},
    "backup":str(folder),"http_readback":True,
    "original_drive_media_modified":False},sort_keys=True))
  return 0
 except Exception:
  for p in reversed(installed):p.write_bytes(current[p])
  raise
if __name__=="__main__":sys.exit(main())
