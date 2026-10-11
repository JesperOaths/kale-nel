#!/usr/bin/env python3
"""Bust HA's 31-day /local/ HTML cache for Security child pages.

Changes only versioned *navigation URLs*, never media, recorder or network auth.
Guarded expected-source anchors; atomic backup and independent HTTP readback.
"""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,os,shutil,urllib.request
FILE=Path('/opt/homeassistant/config/www/c720p-surveillance.html')
BACK=Path('/home/jespern/c720p-home-hub/backups/security-v9-cache')
TOKEN='S9_SECURITY_SMOOTH_ALL_V9_20261011'
REPLACEMENTS=(
 ("const TODAY='/local/frontyard-security-new/security-review-v8.html?mode=today';",
  "const TODAY='/local/frontyard-security-new/security-review-v8.html?mode=today&v="+TOKEN+"';"),
 ("const EVIDENCE='/local/frontyard-security-new/security-review-v8.html?mode=evidence';",
  "const EVIDENCE='/local/frontyard-security-new/security-review-v8.html?mode=evidence&v="+TOKEN+"';"),
 ("const TRACKS='/local/frontyard-security-new/security-tracks-v7.html';",
  "const TRACKS='/local/frontyard-security-new/security-tracks-v7.html?v="+TOKEN+"';"),
 ("const ARCHIVE='/local/frontyard-security-new/security-archive-v7.html?v=drive-archive-v10';",
  "const ARCHIVE='/local/frontyard-security-new/security-archive-v7.html?v="+TOKEN+"';"),
 ('data-src="/local/frontyard-security-new/face-appearances.html"',
  'data-src="/local/frontyard-security-new/face-appearances.html?v='+TOKEN+'"'))
def get(url):
 with urllib.request.urlopen(url,timeout=12) as r:return r.status,r.read(1500000)
def main():
 if not FILE.is_file() or FILE.is_symlink():raise RuntimeError('security_home_missing')
 before=FILE.read_bytes()
 text=before.decode()
 if 's9v8-tabs-script' not in text or 's9v7-root-script' not in text:
  raise RuntimeError('security_navigation_unknown')
 for old,new in REPLACEMENTS:
  if new in text:continue
  if text.count(old)!=1:raise RuntimeError('expected_navigation_anchor_changed:'+old[:23])
  text=text.replace(old,new,1)
 if text==before.decode():
  print('S9_SECURITY_CACHE_V9_ALREADY_CURRENT');return
 BACK.mkdir(parents=True,exist_ok=True)
 backup=BACK/('c720p-surveillance-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.html')
 shutil.copy2(FILE,backup)
 stage=FILE.with_name(FILE.name+'.cache-v9-stage')
 stage.write_text(text);stage.chmod(FILE.stat().st_mode&0o777)
 if hashlib.sha256(FILE.read_bytes()).digest()!=hashlib.sha256(before).digest():
  stage.unlink(missing_ok=True);raise RuntimeError('concurrent_root_page_update')
 try:
  os.replace(stage,FILE)
  url='http://127.0.0.1:8123/local/c720p-surveillance.html?v='+TOKEN
  status,response=get(url)
  if status!=200 or TOKEN.encode() not in response or response!=FILE.read_bytes():
   raise RuntimeError('HA_cache_navigation_readback_failed')
  paths=[
   'frontyard-security-new/security-review-v8.html?mode=evidence&v='+TOKEN,
   'frontyard-security-new/security-archive-v7.html?v='+TOKEN,
   'frontyard-security-new/security-tracks-v7.html?v='+TOKEN,
   'frontyard-security-new/face-appearances.html?v='+TOKEN]
  checks={}
  for path in paths:
   code,body=get('http://127.0.0.1:8123/local/'+path)
   checks[path]={'http':code,'has_smooth_player_import':b'C720P_SECURITY_CACHED_480P30_ALL_TABS_V9_20261011' in body}
   if code!=200 or not checks[path]['has_smooth_player_import']:
    raise RuntimeError('child_page_not_current:'+path)
  print('S9_SECURITY_V9_CACHE_BUST_PRODUCTION',json.dumps({
   'backup':str(backup),'version':TOKEN,'nav_paths':len(REPLACEMENTS),
   'children_fresh':checks,'original_recordings_changed':False},sort_keys=True))
 except Exception:
  FILE.write_bytes(before)
  raise
if __name__=='__main__':main()
