#!/usr/bin/env python3
from pathlib import Path
import datetime, re, shutil, subprocess

HOME=Path("/home/jespern")
WWW=Path("/opt/homeassistant/config/www")
UI=WWW/"c720p-drive-saved.html"
SURV=WWW/"c720p-surveillance.html"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"security-thumbnail-ui-v115-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
for p in (UI,SURV):
    if p.exists():shutil.copy2(p,BACK/(p.name+".before"))

u=UI.read_text()

old="""  events=(Array.isArray(d.events)?d.events:[]).filter(e=>e&&(!e.state||e.state==='verified'));$('count').textContent=events.length+' saved';
  const list=$('list');list.replaceChildren();"""
new="""  events=(Array.isArray(d.events)?d.events:[]).filter(e=>e&&(!e.state||e.state==='verified'));
  let ready=0;try{const mm=await thumbManifest();ready=events.reduce((n,e)=>n+(mm?.items?.[String(e.remote_name||'')]?.url?1:0),0)}catch(_){}
  $('count').textContent=events.length+' saved · '+ready+' previews ready'+(ready<events.length?' · '+(events.length-ready)+' generating':'');
  const list=$('list');list.replaceChildren();"""
if old in u:
    u=u.replace(old,new,1)
elif "previews ready" not in u:
    raise SystemExit("COUNT_ANCHOR_NOT_FOUND")

u=u.replace("$('refresh').onclick=load;load();",
            "$('refresh').onclick=()=>{savedThumbManifest=null;load()};load();",1)

if "C720P_SAVED_THUMB_UI_V115" not in u:
    u=u.replace("</head>",'<meta name="c720p-saved-thumb-ui-build" content="C720P_SAVED_THUMB_UI_V115">\\n</head>',1)
UI.write_text(u)

sv=SURV.read_text()
sv=re.sub(
    r'/local/c720p-drive-saved\.html\?camera=camera&v=[^"\']+',
    '/local/c720p-drive-saved.html?camera=camera&v=SAVED_THUMB_UI_V115_20261007',
    sv
)
SURV.write_text(sv)

subprocess.run(["systemctl","--user","restart","c720p-home-hub-kiosk.service"],check=False,timeout=25)

text=UI.read_text()
print("UI_V115="+str("C720P_SAVED_THUMB_UI_V115" in text))
print("READY_COUNTER="+str("previews ready" in text))
print("REFRESH_RELOADS_MANIFEST="+str("$('refresh').onclick=()=>{savedThumbManifest=null;load()};" in text))
print("BACKUP="+str(BACK))
