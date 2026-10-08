#!/usr/bin/env python3
from __future__ import annotations
import datetime, json, pathlib, py_compile, shutil, subprocess, time

HOME=pathlib.Path("/home/jespern")
SCRIPT=HOME/"c720p-home-hub/bin/c720p-tag-presence-daemon.py"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP=HOME/"c720p-backups"/f"tag-presence-hcitool-v4-{STAMP}"
BACKUP.mkdir(parents=True,exist_ok=True)
shutil.copy2(SCRIPT,BACKUP/(SCRIPT.name+".before"))

daemon=r'''#!/usr/bin/env python3
import json, os, re, select, signal, subprocess, sys, time
from pathlib import Path

BASE=Path('/home/jespern/c720p-home-hub')
STATE=BASE/'state/c720p-tag-presence.json'
PUBLIC=Path('/opt/homeassistant/config/www/c720p-tag-presence.json')
LOG=BASE/'logs/c720p-tag-presence.log'
TAGS={
 'tag_a': {'name':'FnR 6ACTAG7R','seed_mac':'D2:CF:0C:64:83:EC'},
 'tag_b': {'name':'FnR 6ATAG72R','seed_mac':'D5:4B:35:3E:88:8B'},
}
LINE_RE=re.compile(r'^([0-9A-F:]{17})\s+(.+)$',re.I)
running=True
child=None

def log(msg):
    LOG.parent.mkdir(parents=True,exist_ok=True)
    line=f"{time.strftime('%Y-%m-%dT%H:%M:%S%z')} {msg}"
    with LOG.open('a') as f:f.write(line+'\n')
    print(line,flush=True)

def load_previous():
    try:return json.loads(STATE.read_text())
    except Exception:return {}

def atomic(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(obj,indent=2,sort_keys=True)+'\n')
    os.replace(tmp,path)

def cleanup_hcitool():
    subprocess.run(
        ['docker','exec','homeassistant','sh','-lc',
         "pkill -INT -f 'hcitool lescan' >/dev/null 2>&1 || true"],
        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=8)

def stop(signum=None,frame=None):
    global running,child
    running=False
    if child and child.poll() is None:
        try: child.terminate()
        except Exception: pass
    try: cleanup_hcitool()
    except Exception: pass

def initial_tags():
    old=load_previous()
    oldtags=old.get('tags') or {}
    out={}
    for key,cfg in TAGS.items():
        prev=oldtags.get(key) or {}
        last=int(prev.get('last_seen') or 0)
        out[key]={
          'name':cfg['name'],
          'mac':str(prev.get('mac') or cfg['seed_mac']).upper(),
          'last_seen':last,
          'best_rssi':prev.get('best_rssi'),
          'observed_once':bool(last),
        }
    return out

def publish(tags,start_ts,last_any,scanner_ok,reason=''):
    now=int(time.time())
    obj={
      'version':'c720p-tag-presence-v4-hcitool',
      'updated_at':now,
      'scanner_ok':bool(scanner_ok),
      'scanner_reason':reason,
      'monitor_uptime_seconds':now-int(start_ts),
      'last_any_ble_event':int(last_any or 0),
      'tags':{},
    }
    for key,t in tags.items():
        age=(now-int(t['last_seen'])) if t.get('last_seen') else None
        rec={
          'name':t['name'],'mac':t['mac'],
          'last_seen':int(t.get('last_seen') or 0),
          'age_seconds':age,
          'best_rssi':t.get('best_rssi'),
          'observed_once':bool(t.get('observed_once')),
        }
        obj['tags'][key]=rec
        for field,val in rec.items():
            obj[f'{key}_{field}']=val
    atomic(STATE,obj)
    atomic(PUBLIC,obj)

def main():
    global child
    signal.signal(signal.SIGTERM,stop); signal.signal(signal.SIGINT,stop)
    tags=initial_tags()
    start=time.time(); last_any=0.0
    publish(tags,start,last_any,False,'starting_hcitool')
    cleanup_hcitool()
    cmd=[
      'docker','exec','homeassistant','sh','-lc',
      'exec stdbuf -oL -eL hcitool lescan --duplicates'
    ]
    log('START privileged continuous LE scan via Home Assistant container')
    child=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                           text=True,bufsize=1)
    next_publish=time.monotonic()+2
    while running:
        if child.poll() is not None:
            publish(tags,start,last_any,False,'hcitool_exited')
            log('EXIT hcitool rc='+str(child.returncode))
            return 20
        ready,_,_=select.select([child.stdout],[],[],1.0)
        if ready:
            raw=child.stdout.readline()
            if raw:
                line=raw.strip()
                m=LINE_RE.match(line)
                if m:
                    mac=m.group(1).upper(); rest=m.group(2).strip()
                    last_any=time.time()
                    for key,cfg in TAGS.items():
                        t=tags[key]
                        name_match=cfg['name'].lower() in rest.lower()
                        mac_match=mac in {cfg['seed_mac'].upper(),str(t.get('mac') or '').upper()}
                        if name_match:
                            if t.get('mac') != mac:
                                log(f"ROTATE {key} {t['name']} {t.get('mac')} -> {mac}")
                            t['mac']=mac
                            mac_match=True
                        if name_match or mac_match:
                            was_seen=t.get('observed_once')
                            t['last_seen']=int(time.time())
                            t['observed_once']=True
                            if not was_seen:
                                log(f"LEARNED {key} {t['name']} mac={mac}")
        nowm=time.monotonic()
        if nowm>=next_publish:
            age_any=(time.time()-last_any) if last_any else None
            healthy=child.poll() is None and (
                (age_any is not None and age_any<120) or time.time()-start<30)
            reason='active_hcitool' if healthy else 'no_ble_events'
            publish(tags,start,last_any,healthy,reason)
            next_publish=nowm+5
    publish(tags,start,last_any,False,'stopped')
    return 0

if __name__=='__main__':
    raise SystemExit(main())
'''
SCRIPT.write_text(daemon)
SCRIPT.chmod(0o755)
py_compile.compile(str(SCRIPT),doraise=True)
subprocess.run(['systemctl','--user','restart','c720p-tag-presence.service'],check=True,timeout=30)
time.sleep(28)
state={}
try: state=json.loads(pathlib.Path('/opt/homeassistant/config/www/c720p-tag-presence.json').read_text())
except Exception as e: state={'error':str(e)}
svc=subprocess.run(['systemctl','--user','show','c720p-tag-presence.service',
                    '-p','ActiveState','-p','SubState','-p','MainPID','-p','NRestarts'],
                   text=True,capture_output=True,timeout=10).stdout.strip()
log=subprocess.run(['tail','-50',str(BASE if False else HOME/'c720p-home-hub/logs/c720p-tag-presence.log')],
                   text=True,capture_output=True,timeout=10).stdout
print(json.dumps({
  'ok':True,
  'version':'tag-presence-v4-hcitool',
  'backup':str(BACKUP),
  'service':svc,
  'state':state,
  'recent_log':log,
},indent=2))
