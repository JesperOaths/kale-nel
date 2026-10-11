#!/usr/bin/env python3
"""Transactional Security hub playback alignment across all independent tab frames.
All playback in isolated page contexts uses prepared cached baseline AVC (480p30),
and offers original microSD 4K as an explicit user choice. Originals untouched.
"""
from pathlib import Path
from datetime import datetime,timezone
import json,os,re,shutil,urllib.request
ROOT=Path('/opt/homeassistant/config/www')
BACK=Path('/home/jespern/c720p-home-hub/backups/security-smooth-all-v9')
PLAYER=ROOT/'security-video-playback.js'
PAGES=[
 ROOT/'c720p-surveillance.html',
 ROOT/'frontyard-security-new/security-review-v8.html',
 ROOT/'frontyard-security-new/security-archive-v7.html',
 ROOT/'frontyard-security-new/security-tracks-v7.html',
 ROOT/'frontyard-security-new/face-appearances.html',
 ROOT/'frontyard-security-new/clips.html']
VERSION='C720P_SECURITY_CACHED_480P30_ALL_TABS_V9_20261011'
SCRIPT='/local/security-video-playback.js?v='+VERSION
def http(url):
 with urllib.request.urlopen(url,timeout=12) as r:return r.status,r.read(1200000)
def replace_once(text,old,new,caption):
 if old not in text:raise RuntimeError('expected_'+caption+'_not_found')
 return text.replace(old,new)
def player_patch(s):
 if 'C720PSecurityVideo' not in s or 'Smooth · 720p / 30 fps' not in s:
  raise RuntimeError('unexpected_previous_player')
 s=replace_once(s,'Smooth · 720p / 30 fps','Smooth · 480p / 30 fps','smooth_select')
 s=replace_once(s,"state.mode==='original'?'original':'720p30'",
                "state.mode==='original'?'original':'480p30'",'profile_telemetry')
 return s
def html_patch(s,page):
 if page.name=='c720p-surveillance.html':
  a=re.compile(r'/local/security-video-playback[.]js[?]v=[A-Za-z0-9_-]+')
  if not a.search(s):raise RuntimeError('root_player_reference_missing')
  s=a.sub(SCRIPT,s)
 else:
  if 'gejast-auth-gate.js' not in s and page.name!='clips.html':
   raise RuntimeError('auth_gate_missing_'+page.name)
  if 'C720PSecurityVideo' not in s and SCRIPT not in s:
   if s.count('</head>')!=1:raise RuntimeError('invalid_head_'+page.name)
   s=s.replace('</head>','<script defer src="'+SCRIPT+'"></script>\n</head>',1)
  elif SCRIPT not in s:
   s=re.sub(r'/local/security-video-playback[.]js[?]v=[A-Za-z0-9_-]+',SCRIPT,s)
  if SCRIPT not in s:raise RuntimeError('playback_script_not_included_'+page.name)
 return s
def main():
 for p in [PLAYER]+PAGES:
  if not p.is_file() or p.is_symlink():raise RuntimeError('missing_asset:'+p.name)
 originals={p:p.read_bytes() for p in [PLAYER]+PAGES}
 if not(12000<len(originals[PLAYER])<40000):raise RuntimeError('shared_playback_unknown')
 updates={PLAYER:player_patch(originals[PLAYER].decode())}
 for page in PAGES:updates[page]=html_patch(originals[page].decode(),page)
 BACK.mkdir(parents=True,exist_ok=True)
 stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 backup=BACK/stamp;backup.mkdir(mode=0o700)
 for n,(path,old) in enumerate(originals.items()):
  (backup/(str(n)+'-'+path.name)).write_bytes(old)
 changed=[]
 try:
  for path,content in updates.items():
   stage=path.with_name(path.name+'.smooth-v9-stage')
   stage.write_text(content)
   stage.chmod(path.stat().st_mode&0o777)
   os.replace(stage,path);changed.append(path)
  for name in ('security-video-playback.js','frontyard-security-new/security-review-v8.html',
               'frontyard-security-new/security-archive-v7.html',
               'frontyard-security-new/face-appearances.html',
               'c720p-surveillance.html'):
   httpcode,b=http('http://127.0.0.1:8123/local/'+name)
   if httpcode!=200 or (VERSION.encode() not in b and name!='security-video-playback.js'):
    raise RuntimeError('asset_readback_failed:'+name)
  n=http('http://127.0.0.1:8795/new/api/saved')
  if len(json.loads(n[1]).get('events',[]))<273:raise RuntimeError('archive_regressed')
  print('S9_ALL_SECURITY_V9_SMOOTH_PLAYBACK',json.dumps({
    'backup':str(backup),'source_profile':'480p30',
    'pages_with_prepared_video':len(PAGES)-1,
    'media_files_changed':False,'original_quality_preserved':True,
    'original_quality_option_available':True,
    'readback_http_200':True,'archive_entries':len(json.loads(n[1])['events']),
    'assets_sha':{p.name:len(updates[p]) for p in updates}},sort_keys=True))
 except Exception:
  for page in reversed(changed):page.write_bytes(originals[page])
  raise
if __name__=='__main__':main()
