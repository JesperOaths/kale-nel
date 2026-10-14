#!/usr/bin/env python3
"""Guarded fix: prefer a *verified combined* S9 clip in the two Security browsers.

The archive already provides authenticated /new/saved/complete/<original> with
SHA receipts and HTTP ranges. The UI still played /clip/<original>, or exposed
a short pre-roll *alone* before moving to the 4K original. This changes only
the Security HTML viewers, not Camera2, its original 4K files, or SD storage.
"""
from pathlib import Path
import argparse,datetime,hashlib,json,os,re,shutil,subprocess,tempfile,urllib.request

ROOT=Path("/opt/homeassistant/config/www/frontyard-security-new")
FILES=["security-review-v8.html","security-archive-v7.html"]
MARK="S9_VERIFIED_PREPEND_PLAYBACK_20261014"

def replace_once(s,old,new,tag):
    n=s.count(old)
    if n!=1:raise RuntimeError(f"{tag} source drift ({n} matches)")
    return s.replace(old,new,1)

def patch_review(s):
    if MARK in s:return s
    # Distinct motion prelude was exposed as a standalone 0.5-5s clip. Use the
    # existing *verified* single-MP4 route; never play an isolated prelude.
    old="""video.dataset.originalSrc=url;let preFound=false;const prePath='/new/saved/preroll/'+encodeURIComponent(name(rec));if(name(rec).startsWith('motion_')&&r.fetch)try{preFound=(await r.fetch(prePath,{method:'HEAD',cache:'no-store'})).ok}catch(_){}if(state.selected!==name(rec))return;"""
    new="""video.dataset.originalSrc=url;const joinedPath='/new/saved/complete/'+encodeURIComponent(name(rec));let joined=false;if(/^motion_[0-9]{13}\\.mp4$/.test(name(rec))&&r.fetch)try{joined=(await r.fetch(joinedPath,{method:'HEAD',cache:'no-store'})).ok}catch(_){}if(state.selected!==name(rec))return;/* S9_VERIFIED_PREPEND_PLAYBACK_20261014 */"""
    s=replace_once(s,old,new,"review select")
    old="""if(preFound){try{const early=await r.url(prePath);if(state.selected!==name(rec))return;video.dataset.preRoll='true';video.src=early;quality.textContent='Pre-event buffered video · continues into original recording';video.addEventListener('ended',()=>{if(state.activeVideo!==video||video.dataset.preRoll!=='true')return;delete video.dataset.preRoll;video.src=url;video.play().catch(()=>{})},{once:true})}catch(_){video.src=url}}else video.src=url;"""
    new="""if(joined){try{const full=await r.url(joinedPath);if(state.selected!==name(rec))return;video.dataset.combined='true';video.src=full;quality.textContent='Verified single MP4 · pre-event + event'}catch(_){video.src=url;quality.textContent='Original 4K · combined stream unavailable'}}else{video.src=url;quality.textContent='Original 4K · pre-event combination pending or unavailable'}"""
    s=replace_once(s,old,new,"review video")
    s=replace_once(s,
      """(video.dataset.preRoll==='true'?'Pre-event buffered video':'Original video')""",
      """(video.dataset.combined==='true'?'Combined pre-event + event video':'Original video')""",
      "review metadata")
    s=replace_once(s,
      """if(video.dataset.preRoll==='true'){delete video.dataset.preRoll;video.src=url;return}""",
      """if(video.dataset.combined==='true'){delete video.dataset.combined;video.src=url;return}""",
      "review fallback")
    s=replace_once(s,
      """(video.dataset.preRoll==='true'?'Pre-event video':'Original playback')""",
      """(video.dataset.combined==='true'?'Combined pre-event + event':'Original playback')""",
      "review status")
    # Evidence markers are measured against original MP4 timestamps; when a
    # user selects such a marker, switch back to 4K source before seeking.
    s=replace_once(s,
      """if(video.dataset.preRoll==='true'){delete video.dataset.preRoll;video.src=video.dataset.originalSrc;video.load()}""",
      """if(video.dataset.combined==='true'){delete video.dataset.combined;video.src=video.dataset.originalSrc;video.load()}""",
      "review timeline")
    return s

def patch_archive(s):
    if MARK in s:return s
    old="""const src=await a.url('/new/saved/clip/'+encodeURIComponent(n));if(token!==playing)return;v.src=src;v.load();$('playerState').textContent='';"""
    new="""let src=await a.url('/new/saved/clip/'+encodeURIComponent(n));if(token!==playing)return;let complete=false;if(/^motion_[0-9]{13}\\.mp4$/.test(n)&&a.fetch){try{const path='/new/saved/complete/'+encodeURIComponent(n);if((await a.fetch(path,{method:'HEAD',cache:'no-store'})).ok){src=await a.url(path);complete=true}}catch(_){}}if(token!==playing)return;v.src=src;v.load();$('playerState').textContent=complete?'Verified combined video · pre-event + event':'Original 4K · pre-event combined video unavailable';/* S9_VERIFIED_PREPEND_PLAYBACK_20261014 */"""
    s=replace_once(s,old,new,"archive playback")
    return s

def js_check(file_content,filename):
    # Compile the inline scripts with node if available; no HTML tag parser
    # rewrites and no host-side frontend frameworks.
    if not shutil.which("node"):return "node_unavailable"
    scripts=re.findall(r"<script(?:\s[^>]*)?>([\s\S]*?)</script>",file_content)
    if not scripts:raise RuntimeError("No inline scripts found: "+filename)
    for i,script in enumerate(scripts):
        if not script.strip():continue
        with tempfile.NamedTemporaryFile(mode="w",suffix=".js") as f:
            f.write(script);f.flush()
            p=subprocess.run(["node","--check",f.name],capture_output=True,text=True,timeout=12)
        if p.returncode:raise RuntimeError(f"JS syntax failed in {filename} script {i}: {p.stderr[-600:]}")
    return f"node_ok_{len(scripts)}"

def check_media_route():
    name="motion_1791956119933.mp4"
    def get(path):
        with urllib.request.urlopen(urllib.request.Request(
            "http://127.0.0.1:8795/new/saved/"+path+"/"+name,method="HEAD"),timeout=22) as r:
            return r.status,int(r.headers.get("Content-Length","-1")),r.headers.get("Content-Type","")
    complete=get("complete");original=get("clip")
    if complete[0]!=200 or original[0]!=200 or complete[2]!="video/mp4" or original[2]!="video/mp4" or not 150000<complete[1]<original[1]:
        raise RuntimeError(f"Verified joined route not distinct: {complete} vs {original}")
    return {"combined_bytes":complete[1],"original_bytes":original[1]}

def write_atomic(path,content):
    st=path.stat()
    fd,tmp=tempfile.mkstemp(prefix=".s9-prepend-ui-",dir=str(path.parent))
    try:
        with os.fdopen(fd,"wb") as f:
            f.write(content);f.flush();os.fsync(f.fileno())
        os.chmod(tmp,st.st_mode & 0o777)
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def main():
    p=argparse.ArgumentParser();p.add_argument("--apply",action="store_true")
    args=p.parse_args()
    # Fail closed if the working verified merged proxy route is absent.
    media=check_media_route()
    originals={};results={}
    for name in FILES:
        path=ROOT/name;raw=path.read_bytes();s=raw.decode("utf-8")
        updated=patch_review(s) if name.startswith("security-review") else patch_archive(s)
        originals[name]=raw
        results[name]={"changed":updated!=s,"js_check":js_check(updated,name),"before_sha256":hashlib.sha256(raw).hexdigest(),"after_sha256":hashlib.sha256(updated.encode()).hexdigest(),"bytes":len(updated)}
        if MARK not in updated:raise RuntimeError("missing marker")
    print("UI_PREPEND_DRY_RUN",json.dumps({"media":media,"files":results}),flush=True)
    if not args.apply:return
    backup=Path("/home/jespern/c720p-home-hub/backups/s9-prepend-playback-ui")/datetime.datetime.now().strftime("%Y%m%dT%H%M%SZ")
    backup.mkdir(parents=True)
    applied=[]
    try:
        for name in FILES:
            p=ROOT/name;shutil.copy2(p,backup/name)
            text=patch_review(originals[name].decode()) if name.startswith("security-review") else patch_archive(originals[name].decode())
            write_atomic(p,text.encode());applied.append(name)
        for name in FILES:
            p=ROOT/name;raw=p.read_bytes()
            if hashlib.sha256(raw).hexdigest()!=results[name]["after_sha256"]:raise RuntimeError(name+" write digest mismatch")
            url="http://127.0.0.1:8123/local/frontyard-security-new/"+name
            with urllib.request.urlopen(url,timeout=12) as response:served=response.read()
            if hashlib.sha256(served).hexdigest()!=hashlib.sha256(raw).hexdigest():
                raise RuntimeError(name+" served asset mismatch")
        check_media_route()
        print("UI_PREPEND_DEPLOYED",json.dumps({"backup":str(backup),"files":results,"media":media}),flush=True)
    except Exception:
        for name in applied:
            write_atomic(ROOT/name,originals[name])
        print("UI_PREPEND_ROLLED_BACK",json.dumps({"backup":str(backup)}),flush=True)
        raise

if __name__=="__main__":main()
