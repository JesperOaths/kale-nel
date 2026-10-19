#!/usr/bin/env python3
"""Guarded C720P install for PRIVATE, review-only face suggestions.

Does not install S9+ models, alter Camera2, rewrite a clip, or approve people.
Only adds one module and a small authenticated archive-route hook.
"""
import argparse,datetime,hashlib,json,os,re,shutil,stat,subprocess,tempfile,time,urllib.request
from pathlib import Path
HOME=Path("/home/jespern/c720p-home-hub")
PROXY=HOME/"bin/s9_sd_proxy_extension.py"
MODULE=HOME/"bin/s9_automatic_person_review.py"
BACK=HOME/"backups/security-automatic-person-v63"
SHA_REF="ad7d1c668df4cc2c6fc297f9ed951a8670647615"
SOURCE="ops/c720p/s9-person-ml-v1/s9_automatic_person_review.py"
HOOK=" import s9_manual_recording_links\n s9_manual_recording_links.install(H,rows)\n"
NEW=HOOK+" import s9_automatic_person_review\n s9_automatic_person_review.install(H,rows)\n"
SERVICE="c720p-drive-security-archive.service"
def sha(b):return hashlib.sha256(b).hexdigest()
def fetch(path):
 uri="https://raw.githubusercontent.com/JesperOaths/kale-nel/"+SHA_REF+"/"+path
 with urllib.request.urlopen(uri,timeout=30) as r:return r.read(200001)
def atom(path,b,st):
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(dir=path.parent,prefix=".security-auto-person-")
 try:
  with os.fdopen(fd,"wb") as out:out.write(b);out.flush();os.fsync(out.fileno())
  os.chmod(tmp,stat.S_IMODE(st.st_mode) if st else 0o644)
  if st:
   try:os.chown(tmp,st.st_uid,st.st_gid)
   except PermissionError:pass
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def cmd(*args):
 return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
       text=True,timeout=90,check=True)
def api():
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/automatic-person",timeout=8) as response:
  doc=json.loads(response.read(700001))
 if (doc.get("ok") is not True or doc.get("automatic_assignments") is not False
     or doc.get("human_approval_required") is not True or
     doc.get("face_vectors_exported") is not False):
  raise RuntimeError("unsafe_automatic_person_response")
 return {"status":doc.get("status"),"suggestions":len(doc.get("items",[]))}
def main():
 p=argparse.ArgumentParser();p.add_argument("--apply",action="store_true")
 args=p.parse_args()
 if shutil.disk_usage(HOME).free<24*1024*1024:raise RuntimeError("low_disk")
 if PROXY.is_symlink() or not PROXY.is_file() or MODULE.is_symlink():
  raise RuntimeError("unexpected_existing_proxy_or_symlink")
 old=PROXY.read_bytes();old_stat=PROXY.stat()
 previous=MODULE.read_bytes() if MODULE.is_file() else None
 module_stat=MODULE.stat() if MODULE.is_file() else None
 content=fetch(SOURCE)
 if not 3500<len(content)<200000 or b"def install(H,sd_names):" not in content:
  raise RuntimeError("invalid_source")
 raw=old.decode()
 if NEW in raw:new_proxy=old
 elif raw.count(HOOK)==1:new_proxy=raw.replace(HOOK,NEW,1).encode()
 else:raise RuntimeError("unknown_proxy_hook_source")
 if not args.apply:
  print("SECURITY_AUTO_PERSON_BACKEND_PREFLIGHT "+json.dumps({
   "source_sha256":sha(content),"proxy_change":new_proxy!=old,
   "no_recordings_changed":True},sort_keys=True),flush=True);return
 backup=BACK/datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 backup.mkdir(parents=True,mode=0o700,exist_ok=False)
 (backup/"proxy-original.py").write_bytes(old)
 if previous is not None:(backup/"module-original.py").write_bytes(previous)
 for entry in backup.iterdir():os.chmod(entry,0o600)
 touched=[]
 try:
  if PROXY.read_bytes()!=old or (MODULE.read_bytes() if MODULE.is_file() else None)!=previous:
   raise RuntimeError("concurrent_proxy_edit")
  if previous!=content:atom(MODULE,content,module_stat);touched.append("module")
  if new_proxy!=old:atom(PROXY,new_proxy,old_stat);touched.append("proxy")
  cmd("python3","-m","py_compile",str(PROXY),str(MODULE))
  cmd("systemctl","--user","restart",SERVICE)
  result=None
  for _ in range(15):
   try:result=api();break
   except Exception:time.sleep(1)
  if result is None:raise RuntimeError("new_private_api_not_ready")
  if sha(PROXY.read_bytes())!=sha(new_proxy) or sha(MODULE.read_bytes())!=sha(content):
   raise RuntimeError("installed_backend_hash_mismatch")
  print("SECURITY_AUTO_PERSON_BACKEND_VERIFIED "+json.dumps({
   "backend":result,"source_sha256":sha(content),"changed":touched,
   "rollback":str(backup),"camera_modified":False,
   "originals_modified":False,"human_decisions_modified":False},sort_keys=True),flush=True)
 except BaseException:
  if "proxy" in touched:atom(PROXY,old,old_stat)
  if "module" in touched:
   if previous is None:MODULE.unlink(missing_ok=True)
   else:atom(MODULE,previous,module_stat)
  try:cmd("systemctl","--user","restart",SERVICE)
  except Exception:print("SECURITY_AUTO_PERSON_BACKEND_RESTORE_REQUIRES_ATTENTION",flush=True)
  raise
if __name__=="__main__":main()
