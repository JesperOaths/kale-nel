#!/usr/bin/env python3
"""Version the live Drive Archive iframe and security-shell JS after thumbnail fix.

Home Assistant /local assets have 31-day HTTP max-age, so changing the HTML
alone leaves some user browsers on cached versions. This changes only
the relevant versioned URLs, preserving all other script and tab behavior.
"""
import datetime,hashlib,json,os,pathlib,urllib.request,sys
ROOT=pathlib.Path("/opt/homeassistant/config/www")
JS=ROOT/"frontyard-security-new/security-hub-v30.js"
SHELL=ROOT/"c720p-surveillance.html"
BACK=pathlib.Path("/home/jespern/c720p-home-hub/backups/drive-thumbnails-cache-v1")
CHANGES={
 JS:(b"'security-archive-v7.html?'",b"'security-archive-v7.html?v=drive-thumb-dom-v1&'"),
 SHELL:(b"security-hub-v30.js?v=archive-review-v32-20261014",
        b"security-hub-v30.js?v=drive-thumb-dom-v1-20261014"),
}
def main():
 original={}
 for p,(old,new) in CHANGES.items():
  if not p.is_file() or p.is_symlink():raise RuntimeError("asset_missing")
  data=p.read_bytes()
  if data.count(new)==1:
   original[p]=None
   continue
  if data.count(old)!=1:raise RuntimeError("unknown_asset_version")
  original[p]=data
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 BACK.mkdir(parents=True,exist_ok=True)
 changed=[]
 try:
  for p,(old,new) in CHANGES.items():
   data=original[p]
   if data is None:continue
   backup=BACK/(stamp+"-"+p.name+".original")
   fd=os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
   with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
   tmp=p.with_name("."+p.name+".thumbfix.tmp")
   updated=data.replace(old,new,1)
   try:
    tmp.write_bytes(updated);tmp.chmod(p.stat().st_mode&0o777);os.replace(tmp,p)
   finally:
    if tmp.exists():tmp.unlink()
   if p.read_bytes()!=updated:raise RuntimeError("file_readback_failed")
   changed.append(p)
  for p,(_,new) in CHANGES.items():
   u="http://127.0.0.1:8123/local/"+str(p.relative_to(ROOT))
   q="&verify="+stamp if b"?" in new else "?verify="+stamp
   with urllib.request.urlopen(u+q,timeout=12) as response:
    body=response.read(180000)
    if response.status!=200 or new not in body:
     raise RuntimeError("web_asset_serve_failed")
  print(json.dumps({"ok":True,"changed":[str(p) for p in changed],"cache_bust_verified":True,
    "notes":"Versioned Archive iframe and security-shell script; no service restarts or clip changes"}))
 except Exception:
  for p in changed:
   if original[p] is not None:p.write_bytes(original[p])
  raise
if __name__=="__main__":sys.exit(main())
