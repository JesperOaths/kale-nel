#!/usr/bin/env python3
"""Read-only scoped health + archive action incident inspection. No media reads or writes."""
from pathlib import Path
import json,subprocess,urllib.request,re
def run(args,seconds=12):
 try:
  p=subprocess.run(args,capture_output=True,text=True,timeout=seconds)
  return {'rc':p.returncode,'out':p.stdout[:2200],'err':p.stderr[-250:]}
 except Exception as e:return {'error':type(e).__name__}
def http(path):
 try:
  with urllib.request.urlopen(path,timeout=6) as f:return json.load(f)
 except Exception as e:return {'unavailable':type(e).__name__}
roots=[Path('/opt/homeassistant/config/www/frontyard-security-new'),
 Path('/opt/homeassistant/config/www'),Path('/home/jespern/c720p-home-hub/bin')]
queries=['Select all shown','Select verified','Clear selection','More actions...',
 'Delete selected','Verify person','retained or not confirmed','phone_or_media_unavailable']
candidates=[]
for root in roots:
 for p in (root.glob('*.html') if root.name=='www' else root.glob('*')):
  if p.suffix not in ('.html','.js','.py') or not p.is_file() or p.is_symlink():continue
  try:
   if p.stat().st_size>1200000:continue
   s=p.read_text(errors='replace')
  except Exception:continue
  hits=[k for k in queries if k in s]
  if hits:candidates.append((p,s,hits))
print('MATCHED_ARCHIVE_SOURCES',[(str(p),len(s),hits) for p,s,hits in candidates][:22])
for p,s,hits in candidates[:5]:
 print('SOURCE',p)
 for term in ['Select all shown','Delete selected','Verify person','phone_or_media_unavailable','retained or not confirmed','JSON.parse']:
  at=s.find(term)
  if at>=0:print('NEAR',term,repr(s[max(0,at-420):at+1020]))
for p,raw,hits in candidates:
 if p.name=='archive-review-v32.js':
  print('REVIEW_V32_SOURCE_BEGIN')
  print(raw)
  print('REVIEW_V32_SOURCE_END')
  break
print('PHONE_STATUS',{key:http('http://127.0.0.1:18808/status').get(key) for key in (
 'ok','mode','motion_detector','temperature_c','garden_person_gate_ready',
 'garden_person_gate_backend','continuous_4k_production_persisted','continuous_4k_ready',
 'continuous_4k_last_result','continuous_4k_buffered_ms','preroll_ready','sd_free_bytes',
 'garden_person_transport_conflicts_total','person_post_motion_hold_ms')})
for path in ['http://127.0.0.1:8794/new/api/saved','http://127.0.0.1:8795/new/api/saved']:
 obj=http(path)
 print('CATALOG',{ 'route':path,'keys':list(obj)[:15] if isinstance(obj,dict) else [],
                'count':len(obj.get('events',[])) if isinstance(obj,dict) else None,
                'error':obj.get('unavailable') if isinstance(obj,dict) else None})
print('C720P_DISK',run(['df','-h','/']))
print('C720P_MEMORY',run(['free','-m']))
print('LARGE_DIRS',run(['du','-sh','/var/lib/docker','/var/cache','/tmp',
 '/home/jespern/c720p-home-hub/build','/home/jespern/c720p-home-hub/backups']))
print('TIMERS',run(['systemctl','--user','list-timers','--all','--no-pager'],20)['out'][-1800:])
print('V9_TIMER',run(['systemctl','--user','is-active','s9-pedestrian-v9-cool-idle.timer']))
print('POSTMOTION_TIMER',run(['systemctl','--user','is-active','c720p-s9-postmotion-v7r2-cutover.timer']))
print('PHONE_ADB',run(['adb','devices']))
print('PHONE_DISK',run(['adb','-s','192.168.178.250:5555','shell','df','-h','/storage/9C33-6BBD'],10))
