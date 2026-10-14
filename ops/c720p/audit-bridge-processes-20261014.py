#!/usr/bin/env python3
"""Read-only audit of C720P pressure and duplicate S9+ processing. No media access."""
from pathlib import Path
import subprocess,json,urllib.request
def run(a,timeout=15):
 try:
  p=subprocess.run(a,capture_output=True,text=True,timeout=timeout)
  return {'rc':p.returncode,'out':p.stdout[:12000],'err':p.stderr[-200:]}
 except Exception as e:return {'error':type(e).__name__}
print('DISK',run(['df','-h','/']))
print('DISK_INODES',run(['df','-i','/']))
print('MEMORY',run(['free','-m']))
print('SWAP',run(['swapon','--show','--bytes']))
print('TOP_RSS',run(['ps','-eo','pid,comm,rss,%cpu,etime','--sort=-rss']))
print('ROOTLESS_DOCKER_DF',run(['docker','system','df'],timeout=12))
print('DOCKER_MEMORY',run(['docker','stats','--no-stream','--format','{{.Name}} {{.MemUsage}} {{.CPUPerc}}'],timeout=17))
services=run(['systemctl','--user','list-units','--type=service','--state=running','--no-legend','--no-pager'])
names=[]
for row in services.get('out','').splitlines():
 name=row.split()[0] if row.split() else ''
 if name.endswith('.service') and any(t in name.lower() for t in
 ('s9','archive','drive','thumb','camera','security','face','motion','gpu','clip','video')):
  names.append(name)
print('ACTIVE_RELEVANT_SERVICES',names)
for name in names[:35]:
 data=run(['systemctl','--user','show',name,'-p','MemoryCurrent','-p','MainPID','-p','CPUUsageNSec'],timeout=8)
 print('SERVICE_MEMORY',name,data.get('out','').strip().replace('\n',' '))
print('TOP_TEMP_FILES',run(['find','/tmp','-maxdepth','1','-type','f','-size','+10M','-printf','%s %f\n'],timeout=12))
for name in ('s9-pedestrian-v9-cool-idle','c720p-s9-postmotion-v7r2-cutover'):
 print('TIMER',name,run(['systemctl','--user','is-active',name+'.timer']))
if Path('/home/jespern/c720p-home-hub/build/s9-pedestrian-v9-cool-idle/result.json').is_file():
 p=Path('/home/jespern/c720p-home-hub/build/s9-pedestrian-v9-cool-idle/result.json')
 d=json.loads(p.read_text());print('V9_RETRY_RESULT',{k:d.get(k) for k in ('event','timestamp','sha')})
try:
 d=json.load(urllib.request.urlopen('http://127.0.0.1:18808/status',timeout=7))
 print('PHONE_STATE',{k:d.get(k) for k in
 ('mode','motion_detector','temperature_c','continuous_4k_ready',
  'continuous_4k_last_result','continuous_4k_production_persisted','preroll_ready',
  'person_post_motion_hold_ms','garden_person_gate_backend')})
except Exception as e:print('PHONE_STATE_ERROR',type(e).__name__)
