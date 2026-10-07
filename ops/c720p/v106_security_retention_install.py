#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import urllib.request,shutil,datetime,re,subprocess,json,time,os,py_compile

HOME=Path("/home/jespern");BASE=HOME/"c720p-home-hub";WWW=Path("/opt/homeassistant/config/www")
BIN=BASE/"bin";UNIT=HOME/".config/systemd/user"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S");BACK=HOME/"c720p-backups"/f"security-retention-v106-{STAMP}";BACK.mkdir(parents=True,exist_ok=True)
TRIM=BIN/"c720p-archive-quota-trim-v869.py";RET=BIN/"c720p-drive-value-retention.py";THUMB=BIN/"c720p-saved-thumbnailer-v106.py";SERVER=BIN/"c720p-drive-security-archive.py";UI=WWW/"c720p-drive-saved.html";SURV=WWW/"c720p-surveillance.html"

def backup(p):
    p=Path(p)
    if p.exists():shutil.copy2(p,BACK/(p.name+".before"))
def fetch(url):
    req=urllib.request.Request(url,headers={"User-Agent":"c720p-v106"})
    with urllib.request.urlopen(req,timeout=30) as r:return r.read()
def install(url,dst):
    backup(dst);data=fetch(url);Path(dst).write_bytes(data);Path(dst).chmod(0o755);py_compile.compile(str(dst),doraise=True)

install("https://raw.githubusercontent.com/JesperOaths/kale-nel/ba683aa57c50a7164042a382eecc42793f896d57/ops/c720p/v106_local_retention.py",TRIM)
install("https://raw.githubusercontent.com/JesperOaths/kale-nel/71b838672623ddbcfe223dd861bea725ff548e95/ops/c720p/v106_drive_retention.py",RET)
install("https://raw.githubusercontent.com/JesperOaths/kale-nel/b901090ae88274f69920502c9b78ff3e7ff36d7c/ops/c720p/v106_saved_thumbnailer.py",THUMB)

# Saved archive listing must reconcile remote Drive deletions on every user refresh,
# not serve a 5-minute-stale inventory.
backup(SERVER);ss=SERVER.read_text()
ss=re.sub(r"REMOTE_INV_TTL\s*=\s*\d+","REMOTE_INV_TTL=30",ss)
ss,n=re.subn(r"def reconcile_remote\(cam\):\n names=remote_inventory\(cam\)", "def reconcile_remote(cam,force=False):\n names=remote_inventory(cam,force)",ss,count=1)
if n==0 and "def reconcile_remote(cam,force=False):" not in ss:raise SystemExit("archive_reconcile_anchor_missing")
ss=ss.replace("if ok:reconcile_remote(cam)\n   for x in sorted(items(cam)", "if ok:reconcile_remote(cam,True)\n   for x in sorted(items(cam)",1)
SERVER.write_text(ss);py_compile.compile(str(SERVER),doraise=True)

# Upgrade Saved Clips UI: filter tombstones immediately and prefer motion-aware
# three-frame strips generated from the clip. Existing snapshot remains fallback.
backup(UI);s=UI.read_text()
# Only real, verified remote clips are eligible to render.
s=s.replace("events=Array.isArray(d.events)?d.events:[];",
            "events=(Array.isArray(d.events)?d.events:[]).filter(e=>e&&(!e.state||e.state==='verified'));",1)
# Fix the old Delete button payload mismatch: server expects remote_name.
s=s.replace("JSON.stringify({name:e.remote_name})","JSON.stringify({remote_name:e.remote_name})")

old_badges=re.search(r"function badges\(e\)\{.*?\}\nasync function selectClip",s,re.S)
if old_badges:
    rep=r'''function badges(e){const st=String(e.person_status||''),p=pct(e.person_confidence),h=pct(e.highlight_score);let a=[];if(st==='confirmed_person')a.push('<span class="thumbBadge person protected">Confirmed Person · Protected</span>');else if(st==='likely_person')a.push('<span class="thumbBadge person">Likely Person'+(p!=null?' '+p+'%':'')+'</span>');else if(p!=null)a.push('<span class="thumbBadge person">Person '+p+'%</span>');else a.push('<span class="thumbBadge motion">Motion</span>');if(h!=null)a.push('<span class="thumbBadge">Highlight '+h+'%</span>');return a.join('')}
async function selectClip'''
    s=s[:old_badges.start()]+rep+s[old_badges.end():]

start=s.find("async function loadThumb(el,e){")
end=s.find("\nlet observer=null;",start)
if start<0 or end<0:raise SystemExit("saved_thumb_function_anchor_missing")
thumb_js=r'''let savedThumbManifest=null;
async function thumbManifest(){if(savedThumbManifest)return savedThumbManifest;try{const r=await fetch('/local/c720p-saved-thumbs/manifest.json?t='+Date.now(),{cache:'no-store'});savedThumbManifest=await r.json()}catch(_){savedThumbManifest={items:{}}}return savedThumbManifest}
async function loadThumb(el,e){
 const wrap=el.querySelector('.thumbWrap');if(!wrap||wrap.dataset.loaded)return;wrap.dataset.loaded='1';
 let src='';
 try{
  const m=await thumbManifest(),rec=m?.items?.[String(e.remote_name||'')];
  if(rec?.url)src=rec.url+'?v='+Math.floor(Number(rec.generated_at||0));
 }catch(_){}
 if(!src&&e.snapshot_name){try{src=await u('/'+backend+'/saved/snap/'+encodeURIComponent(e.snapshot_name))}catch(_){}}
 if(!src){wrap.querySelector('.thumbUnavailable').textContent='Preview is being generated';return}
 const img=new Image();img.className='thumb';img.alt='Three moments from camera clip '+String(e.clip_no||'');img.decoding='async';
 img.onload=()=>{wrap.classList.add('loaded');const m=wrap.querySelector('.thumbUnavailable');if(m)m.remove()};
 img.onerror=async()=>{if(e.snapshot_name&&!src.includes('/saved/snap/')){try{img.src=await u('/'+backend+'/saved/snap/'+encodeURIComponent(e.snapshot_name));return}catch(_){}}const m=wrap.querySelector('.thumbUnavailable');if(m)m.textContent='Preview unavailable'};
 img.src=src;wrap.prepend(img);
}'''
s=s[:start]+thumb_js+s[end:]

extra_css='''<style id="C720P_SAVED_RETENTION_V106">
.thumbBadge.protected{background:rgba(20,83,45,.9)!important;border-color:rgba(74,222,128,.55)!important;color:#d7ffe3!important}
.clip[data-confirmed-person="1"]{border-color:rgba(74,222,128,.28)!important;box-shadow:inset 0 0 0 1px rgba(74,222,128,.05)!important}
</style>'''
if "C720P_SAVED_RETENTION_V106" not in s:s=s.replace("</head>",extra_css+"\n</head>",1)
# Mark protected cards visually.
s=s.replace("const el=document.createElement('article');el.className='clip';",
            "const el=document.createElement('article');el.className='clip';if(String(e.person_status||'')==='confirmed_person')el.dataset.confirmedPerson='1';",1)
# Periodically reconcile remotely deleted clips while the page remains open.
auto='''<script id="C720P_SAVED_RECONCILE_V106">setInterval(()=>{try{if(document.visibilityState==='visible'&&typeof load==='function'){if(typeof savedThumbManifest!=='undefined')savedThumbManifest=null;load()}}catch(_){}},60000);</script>'''
if "C720P_SAVED_RECONCILE_V106" not in s:s=s.replace("</body>",auto+"\n</body>",1)
UI.write_text(s)

# Thumbnail worker timer.
svc=UNIT/"c720p-saved-thumbnailer-v106.service";tim=UNIT/"c720p-saved-thumbnailer-v106.timer"
for p in (svc,tim):backup(p)
svc.write_text("""[Unit]\nDescription=C720P saved clip representative thumbnail generator\nAfter=c720p-drive-security-archive.service network-online.target\n[Service]\nType=oneshot\nEnvironment=C720P_THUMB_LIMIT=18\nExecStart=/usr/bin/python3 /home/jespern/c720p-home-hub/bin/c720p-saved-thumbnailer-v106.py\nNice=10\nIOSchedulingClass=best-effort\nIOSchedulingPriority=7\n""")
tim.write_text("""[Unit]\nDescription=C720P saved clip thumbnail refresh\n[Timer]\nOnBootSec=5min\nOnUnitActiveSec=20min\nRandomizedDelaySec=90\nPersistent=true\n[Install]\nWantedBy=timers.target\n""")

# Cache bust Security -> Saved Clips iframe.
backup(SURV);sv=SURV.read_text()
sv=re.sub(r"/local/c720p-drive-saved\.html\?camera=camera&v=[^\"']+","/local/c720p-drive-saved.html?camera=camera&v=SAVED_RETENTION_V106_20261007",sv)
SURV.write_text(sv)

subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=20)
subprocess.run(["systemctl","--user","enable","--now",tim.name],check=True,timeout=30)
subprocess.run(["systemctl","--user","restart","c720p-drive-security-archive.service"],check=True,timeout=45)

# Reconcile before retention, then apply conservative local + Drive policies.
for url in ["http://127.0.0.1:8795/new/api/saved?t="+str(time.time())]:
    try:urllib.request.urlopen(url,timeout=60).read()
    except Exception:pass
runs={}
for name,cmd,timeout in [
 ("local_retention",["python3",str(TRIM)],120),
 ("drive_retention",["python3",str(RET)],180),
 ("thumbs",["env","C720P_THUMB_LIMIT=36","python3",str(THUMB)],600),
]:
    r=subprocess.run(cmd,text=True,capture_output=True,timeout=timeout);runs[name]={"rc":r.returncode,"stdout":r.stdout[-12000:],"stderr":r.stderr[-3000:]}
    if r.returncode:raise SystemExit(name+"_failed:"+r.stderr[-1000:])

subprocess.run(["systemctl","--user","restart","c720p-home-hub-kiosk.service"],check=False,timeout=25)

print(json.dumps({"ok":True,"version":"v106","backup":str(BACK),"runs":runs},indent=2))
