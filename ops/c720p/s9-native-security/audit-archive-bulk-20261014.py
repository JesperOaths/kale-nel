#!/usr/bin/env python3
"""Read-only check S9 microSD filename and cached-index consistency; no MP4 reads."""
import json, pathlib, subprocess,urllib.request,os
root='/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K'
names=['motion_1791644935505.mp4','motion_1791645546063.mp4',
 'motion_1791648587810.mp4','motion_1791800303864.mp4','motion_1791801832062.mp4']
phone='192.168.178.250:5555'
def adb(*args):
 try:
  r=subprocess.run(['adb','-s',phone,'shell',*args],capture_output=True,text=True,timeout=10)
  return {'code':r.returncode,'output':r.stdout.strip()[:150],'error':r.stderr.strip()[:140]}
 except Exception as e:return {'error':type(e).__name__}
data=json.load(urllib.request.urlopen('http://127.0.0.1:8794/new/api/saved',timeout=8))
indexed={str(x.get('clip_no') or x.get('remote_name') or x.get('name')):x for x in data.get('events',[])}
for name in names:
 rec=indexed.get(name)
 print('PRESENCE',name,'in_catalog',bool(rec),
  'size',rec.get('size') if rec else None,'verified',rec.get('sd_verified') if rec else None,
  'stat',adb('stat','-c','%s',root+'/'+name))
print('PHONE_FOLDER',adb('ls','-ld',root))
print('CATALOG_COUNT',len(indexed))
path=pathlib.Path('/opt/homeassistant/config/www/frontyard-security-new/security-archive-v7.html')
s=path.read_text()
for term in ['archive-review-v32.js','archive-card-actions-v1.js','</head>']:
 i=s.index(term) if term in s else -1
 print('HTML_REFERENCE',term,repr(s[max(0,i-120):i+200]) if i>=0 else 'absent')
# Disk targets by file name and size only; do not inspect or delete unknown content.
for base in ('/tmp','/home/jespern/c720p-home-hub/build','/home/jespern/c720p-home-hub/backups'):
 rows=[]
 try:
  for x in pathlib.Path(base).iterdir():
   if x.is_symlink():continue
   st=x.stat()
   rows.append((int(st.st_size),x.name,'dir' if x.is_dir() else 'file'))
 except OSError:pass
 print('DISK_TOP_LEVEL',base,sorted(rows,reverse=True)[:14])
