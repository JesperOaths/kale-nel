#!/usr/bin/env python3
"""Read-only audit of C720P pressure and duplicate S9+ processing. No media access."""
from pathlib import Path
import subprocess,json,urllib.request
def run(a,timeout=15):
 try:
  p=subprocess.run(a,capture_output=True,text=True,timeout=timeout)
  return {'rc':p.returncode,'out':p.stdout[:12000],'err':p.stderr[-200:]}
 except Exception as e:return {'error':type(e).__name__}
# Focused follow-up: identify high-RSS Python/chromium owners before changing services.
for pid in (2171173,3382983,1749396,1749205,2756808,2265796,2269048,2171453):
 p=Path('/proc')/str(pid)
 try:
  command=(p/'cmdline').read_bytes().replace(b'\\0',b' ').decode(errors='replace')
  stat=(p/'status').read_text().splitlines()
  identity=[x.strip() for x in stat if x.startswith(('Name:','VmRSS:','VmSwap:'))]
  print('PROCESS_OWNER',pid,'command',command[:260],'stats',identity)
 except OSError:pass
print('DIR_SIZES',run(['du','-sh','/tmp','/var/log','/var/cache','/home/jespern/.cache',
  '/home/jespern/c720p-home-hub','/home/jespern/c720p-backups','/opt/homeassistant',
  '/home/jespern/.local','/home/jespern/.config','/var/lib/docker'],22))
print('TMP_TOP_DIRS',run(['du','-sh','/tmp/s9-*','/tmp/c720p-*','/tmp/pytest-*'],15))
print('DISK',run(['df','-h','/']))
print('DISK_INODES',run(['df','-i','/']))
print('MEMORY',run(['free','-m']))
print('SWAP',run(['swapon','--show','--bytes']))
print('TOP_RSS',run(['ps','-eo','pid,comm,rss,%cpu,etime','--sort=-rss']))

# For large processes expose only program/script basenames and cgroup identity,
# never command-line flags, tokens, passwords or process environments.
rows=run(['ps','-eo','pid,rss,comm','--sort=-rss']).get('out','').splitlines()[1:18]
for row in rows:
 parts=row.strip().split(None,2)
 if len(parts)!=3:continue
 pid,ram,comm=parts
 try:
  args=[x.decode('utf-8','replace') for x in (Path('/proc')/pid/'cmdline').read_bytes().split(b'\\0') if x]
  scripts=[Path(a).name for a in args[1:] if a.endswith(('.py','.jar','.sh'))]
  group=(Path('/proc')/pid/'cgroup').read_text(errors='replace')
  scope='docker' if 'docker' in group else 'user' if 'user.slice' in group else 'system'
  print('LARGE_PROCESS',pid,ram,comm,'script',scripts[:2],'scope',scope)
 except (OSError,UnicodeError):pass
print('TMP_SIZE_BREAKDOWN',run(['bash','-lc',"du -sm /tmp/* 2>/dev/null | sort -nr | head -25"],timeout=20))
print('JOURNAL_STORAGE',run(['journalctl','--disk-usage'],timeout=12))
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
