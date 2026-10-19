#!/usr/bin/env python3
"""V62->V63 guarded Automatic Person UI update with no media or review writes."""
import argparse,datetime,difflib,hashlib,json,os,shutil,stat,tempfile,urllib.request
from pathlib import Path
BASE=Path("/opt/homeassistant/config/www")
ROOT=BASE/"frontyard-security-new"
ASSETS={"js":ROOT/"security-people-v45.js","people":ROOT/"security-people-v50.html",
        "hub":ROOT/"security-hub-v30.js","entry":ROOT/"security-hub-v30.html",
        "shell":BASE/"c720p-surveillance.html"}
BACK=Path("/home/jespern/c720p-home-hub/backups/security-automatic-person-v63-ui")
BEFORE="03dd2a481fbebe59ced441352e43edc07eba506e"
AFTER="ad7d1c668df4cc2c6fc297f9ed951a8670647615"
ACTIVE_V62_SHA="fd3524816384d53470ad6edd81acff0a61b452267b0dfa2be756307d47d18b47"
TAG_OLD="security-people-v62-20261019"
TAG_NEW="security-automatic-person-v63-20261019"
ROOT_SRC="ops/c720p/s9-native-security/"
def sha(data):return hashlib.sha256(data).hexdigest()
def get(uri,limit=250000):
 with urllib.request.urlopen(uri,timeout=30) as response:raw=response.read(limit+1)
 if not 60<len(raw)<=limit:raise RuntimeError("remote_response_size_invalid")
 return raw
def src(ref,name):
 return get("https://raw.githubusercontent.com/JesperOaths/kale-nel/"+ref+"/"+ROOT_SRC+name)
def original_count():
 doc=json.loads(get("http://127.0.0.1:8795/new/api/saved",4200000))
 if doc.get("archive_mode")!="S9-microSD-only":raise RuntimeError("wrong_archive")
 rows=doc.get("events",[])
 names={row.get("clip_no") for row in rows if isinstance(row,dict)}
 if len(names)<100 or len(names)!=len(rows):raise RuntimeError("invalid_archive")
 return names
def add_diffs(live,old,new):
 """Apply only anchored source changes; preserve all newer live V62 features."""
 a=old.decode().splitlines(keepends=True)
 b=new.decode().splitlines(keepends=True)
 text=live.decode()
 edits=0
 ops=difflib.SequenceMatcher(a=a,b=b,autojunk=False).get_opcodes()
 for kind,i,j,k,l in ops:
  if kind=="equal":continue
  # 2 unchanged adjacent lines on each side. Never blindly edit an unknown
  # live page or replace a whole file from historical source.
  before="".join(a[max(0,i-2):i])
  oldfrag="".join(a[i:j])
  after="".join(a[j:j+2])
  marker=before+oldfrag+after
  replacement=before+"".join(b[k:l])+after
  if not marker or text.count(marker)!=1:raise RuntimeError("unknown_live_patch_context_"+str(edits))
  text=text.replace(marker,replacement,1)
  edits+=1
 if not 2<=edits<=35:raise RuntimeError("unexpected_diff_quantity")
 return text.encode(),edits
def replace_one(text,old,new):
 if text.count(old)!=1 or old==new:raise RuntimeError("unknown_live_patch_anchor")
 return text.replace(old,new,1)
def patch_main_js(live,old,new):
 # Replace narrowly identified feature hooks, never an entire historical JS.
 # V62 has newer features than either reference source.
 text=live.decode()
 patches=[
  ("archiveToken:0};","archiveToken:0,automaticRows:[],automaticRevision:0,automaticStatus:'loading',automaticToken:0,automaticBusy:false};"),
  ("if(state.pane==='clothing')searchClothingMatches();",
   "if(state.pane==='clothing')searchClothingMatches();\n if(state.pane==='automatic')fetchAutomatic();"),
  ("selectPane(pane);loadView();if(pane==='people'||pane==='clothing'||pane==='review')fetchFaces();",
   "selectPane(pane);loadView();if(['people','clothing','review','automatic'].includes(pane))fetchFaces();\n if(pane==='automatic')fetchAutomatic();"),
  ("['overview','review','people','clothing','folderView']",
   "['overview','review','people','clothing','automatic','folderView']"),
  ("if(state.pane==='clothing')renderClothing();",
   "if(state.pane==='clothing')renderClothing();\n if(state.pane==='automatic')renderAutomatic();"),
  ("$('refreshClothing').addEventListener('click',()=>searchClothingMatches(true));",
   "$('refreshClothing').addEventListener('click',()=>searchClothingMatches(true));\n$('refreshAutomatic').addEventListener('click',()=>fetchAutomatic());"),
  ("state.clothingToken++;state.clothingBusy=false;state.archiveToken=0;",
   "state.clothingToken++;state.clothingBusy=false;state.archiveToken=0;\n state.automaticRows=[];state.automaticStatus='loading';state.automaticToken++;"),
  (" loadView();\n fetchFaces();\n});",
   " loadView();\n fetchFaces();\n if(state.pane==='automatic')fetchAutomatic();\n});")
 ]
 for before,after in patches:
  if before not in old.decode() or after not in new.decode():
   raise RuntimeError("not_a_pinned_v63_source_change")
  text=replace_one(text,before,after)
 start=new.index(b"const autoId=")
 end=new.index(b"function renderClothing(){",start)
 new_block=new[start:end].decode()
 if "async function denyAutomatic(" not in new_block:raise RuntimeError("invalid_new_auto_code")
 text=replace_one(text,"function renderClothing(){",new_block+"function renderClothing(){")
 return text.encode(),len(patches)+1
def patch_main_html(live,old,new):
 text=live.decode()
 before='<button type="button" data-pane="review" aria-selected="false">Review recordings <span id="reviewTabCount"></span></button>'
 auto='<button type="button" data-pane="automatic" aria-selected="false">Automatic Person <span id="automaticTabCount"></span></button>'
 if before not in old.decode() or auto not in new.decode():raise RuntimeError("missing_reference_auto_nav")
 text=replace_one(text,before,before+"\n "+auto)
 a=new.decode()
 css=a[a.index(".auto-person-folders{"):a.index("</style>",a.index(".auto-person-folders{"))]
 section=a[a.index('<section id="automatic"'):a.index('<section id="people"',a.index('<section id="automatic"'))]
 if "automaticFolders" not in section:raise RuntimeError("missing_new_proposal_section")
 text=replace_one(text,"</style>",css+"</style>")
 text=replace_one(text,'<section id="people"',section+'<section id="people"')
 return text.encode(),3
def atom(path,data,meta):
 fd,tmp=tempfile.mkstemp(prefix=".security-auto-ui-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chmod(tmp,stat.S_IMODE(meta.st_mode))
  try:os.chown(tmp,meta.st_uid,meta.st_gid)
  except PermissionError:pass
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def patched_ui(js,html):
 if sha(js)!=ACTIVE_V62_SHA:raise RuntimeError("unexpected_active_v62_js_preimage")
 new_js,js_edits=patch_main_js(js,src(BEFORE,"security-people-v45.js"),
                                     src(AFTER,"security-people-v45.js"))
 new_html,html_edits=patch_main_html(html,src(BEFORE,"security-people-v45.html"),
                                         src(AFTER,"security-people-v45.html"))
 if not (b"function renderAutomatic()" in new_js and
         b"async function denyAutomatic(" in new_js and
         b"async function approveAutomatic(" in new_js and
         b'data-pane="automatic"' in new_html and
         b'id="automaticFolders"' in new_html and
         b"faceFetchError" in new_js and
         b"approvedFolderContext" in new_js):
  raise RuntimeError("lost_existing_people_features")
 return new_js,new_html,js_edits,html_edits
def main():
 parser=argparse.ArgumentParser();parser.add_argument("--apply",action="store_true")
 args=parser.parse_args()
 if shutil.disk_usage(BASE).free<24*1024*1024:raise RuntimeError("low_disk")
 before=original_count();existing={}
 for key,path in ASSETS.items():
  if path.is_symlink() or not path.is_file():raise RuntimeError("unsafe_target_"+key)
  existing[key]=(path.read_bytes(),path.stat())
 js,html,ne,nm=patched_ui(existing["js"][0],existing["people"][0])
 desired={"js":js,"people":html}
 for key in ("people","hub","entry","shell"):
  data=desired.get(key,existing[key][0])
  if TAG_OLD.encode() not in data:raise RuntimeError("unknown_active_v62_route_"+key)
  desired[key]=data.replace(TAG_OLD.encode(),TAG_NEW.encode())
 if not args.apply:
  print("SECURITY_AUTO_PERSON_UI_PREFLIGHT "+json.dumps({
   "recordings":len(before),"js_edits":ne,"html_edits":nm,
   "new_js_sha256":sha(js),"originals_touched":False},sort_keys=True),flush=True);return
 folder=BACK/datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 folder.mkdir(parents=True,mode=0o700,exist_ok=False)
 for key,(raw,_) in existing.items():
  p=folder/(key+"-previous");p.write_bytes(raw);os.chmod(p,0o600)
  if sha(p.read_bytes())!=sha(raw):raise RuntimeError("backup_mismatch")
 changed=[]
 try:
  for key,path in ASSETS.items():
   old,meta=existing[key]
   if path.read_bytes()!=old:raise RuntimeError("concurrent_site_edit")
   if desired[key]!=old:atom(path,desired[key],meta);changed.append(key)
  served={}
  for key,path in ASSETS.items():
   uri="http://127.0.0.1:8123/local/"+path.relative_to(BASE).as_posix()+"?v="+TAG_NEW
   got=get(uri,1000000)
   if sha(got)!=sha(desired[key]):raise RuntimeError("served_hash_invalid_"+key)
   served[key]=sha(got)[:16]
  after=original_count()
  if not before.issubset(after):raise RuntimeError("recording_inventory_shrank")
  print("SECURITY_AUTO_PERSON_V63_UI_DEPLOY_VERIFIED "+json.dumps({
   "originals_before":len(before),"originals_after":len(after),
   "changed":changed,"served":served,"backup":str(folder),
   "reviews_changed":False,"camera_changed":False},sort_keys=True),flush=True)
 except BaseException:
  for key in reversed(changed):
   try:atom(ASSETS[key],*existing[key])
   except Exception:print("SECURITY_AUTO_UI_MANUAL_RESTORE_REQUIRED_"+key,flush=True)
  raise
if __name__=="__main__":main()
