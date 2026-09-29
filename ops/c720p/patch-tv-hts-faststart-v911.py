#!/usr/bin/env python3
from pathlib import Path
import shutil,time,subprocess

HOME=Path("/home/jespern")
HELPER=HOME/"c720p-home-hub/bin/c720p-bluetooth-helper-server.py"
UI=Path("/opt/homeassistant/config/www/c720p-tv-surround.html")
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"v911-tv-hts-faststart-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
for p in (HELPER,UI): shutil.copy2(p,BACK/(p.name+".before"))

s=HELPER.read_text()
a=s.index("def start_pipeline_async(open_music=False):")
b=s.index("\n\nclass Handler",a)
new=r'''def start_pipeline_async(open_music=False):
    global _PIPELINE_RUNNING

    # Reject a known-cold TV before spawning a worker. This prevents the
    # dashboard/API from advertising pipeline_running when no wake transport
    # exists and keeps the button deterministic.
    tv=get_json('/grundig-tv/power-state',timeout=3)
    tv_state=str(tv.get('state') or '').lower()
    if tv_state == 'off':
        payload={
            'ok':False,'state':'TV_COLD_WAKE_UNAVAILABLE',
            'failure':'TV_COLD_WAKE_UNAVAILABLE',
            'cold_wake_unavailable':True,
            'pipeline_running':False,
            'tv_power':'off',
        }
        write_state(payload)
        return 503,payload
    if tv_state not in {'on'}:
        payload={
            'ok':False,'state':'TV_STATE_UNAVAILABLE',
            'failure':'TV_STATE_UNAVAILABLE',
            'pipeline_running':False,
            'tv_power':tv_state or 'unknown',
        }
        write_state(payload)
        return 503,payload

    with _PIPELINE_LOCK:
        if _PIPELINE_RUNNING:
            return 202, {"ok":True,"state":"pipeline_running","already_running":True}
        _PIPELINE_RUNNING=True
        write_state({"ok":True,"state":"pipeline_running","started_at":time.time(),"fast_path":True})
        t=threading.Thread(target=_pipeline_worker,args=(open_music,),daemon=True,name="c720p-media-fast")
        t.start()
        return 202,{"ok":True,"state":"pipeline_started","thread":t.name,"fast_path":True}
'''
s=s[:a]+new+s[b:]
HELPER.write_text(s)

u=UI.read_text()
u=u.replace('data-controls-version="C720P_TV_SURROUND_ACTIONS_V11_FAILFAST_TRUTHFUL"',
            'data-controls-version="C720P_TV_SURROUND_ACTIONS_V12_FASTSTART_TRUTHFUL"')
u=u.replace(
'''  if(!r.ok){S.busyMacro=false;render();status("Could not start media switch");return}''',
'''  if(!r.ok){
    S.busyMacro=false;render();
    const why=r.data&&String(r.data.failure||r.data.state||"");
    status(why?"Media switch stopped: "+why:"Could not start media switch");
    return
  }''')
UI.write_text(u)

subprocess.run(["python3","-m","py_compile",str(HELPER)],check=True)
subprocess.run(["systemctl","--user","restart","c720p-bluetooth-helper.service"],check=True)
time.sleep(1)
print("BACKUP="+str(BACK))
print("RESULT=V911_FASTSTART_PATCHED")
