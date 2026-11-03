#!/usr/bin/env python3
"""Deploy an isolated V324 *preview*, never overwrite protected V50/V320.

A preview is not acceptance: actual signed 8794 review-open routes, 8795
canonical writer, full SD/Drive attestor and rendered player must pass before
routing traffic to this page. All changes are atomic and reversible.
"""
import argparse,datetime,json,os,pathlib,shutil,subprocess,tempfile,urllib.request

WEB=pathlib.Path('/opt/homeassistant/config/www/frontyard-security-new')
BACKUPS=pathlib.Path('/home/jespern/c720p-home-hub/backups')
ORIGINAL='security-people-v50.html'
ASSET_OLD='security-people-v320.js'
ASSET_PREVIEW='security-people-v324-preview.js'
ASSET_BROWSER='s9_review_original_browser_v1.js'
HTML_PREVIEW='security-people-v324-preview.html'
HTML_SHA='b796e555e51651286a4ae99da5d27cb5ae03c2be'
JS_OLD_SHA='d9cf5fb73db2ff7ce11da24fb3b2a28bfeac23bb'
PREVIEW_SHA='527226b66f1a17252abec1fa202150b53f2539e4'
BROWSER_SHA='4f4d2bfaaf04f1e73cf068e2df9c8c217869bdeb'
REF='security-people-v320.js?v=people-faces-sorting-v320c-20261021'
SCRIPTS=(
 '<script defer src="/local/frontyard-security-new/s9_review_original_browser_v1.js?v=chat3-review-v2-20261024"></script>\n'
 '<script defer src="/local/frontyard-security-new/security-people-v324-preview.js?v=chat3-review-v324c-20261024"></script>'
)
def blob(path):
 return subprocess.check_output(['git','hash-object',str(path)],text=True).strip()
def build_preview(source):
 if source.count(REF)!=1:raise RuntimeError('protected_v320_reference_changed')
 # The original V50 includes a single script element for V320.
 line='<script defer src="/local/frontyard-security-new/'+REF+'"></script>'
 if source.count(line)!=1:raise RuntimeError('protected_v50_script_drift')
 result=source.replace(line,SCRIPTS)
 if 'security-people-v320.js?v=' in result:raise RuntimeError('live_v320_script_left_in_preview')
 if result.count('s9_review_original_browser_v1.js')!=1 or result.count('security-people-v324-preview.js')!=1:
  raise RuntimeError('duplicate_preview_script')
 return result
def camera_safe_for_inactive_preview(health):
 # A read-only V324 preview does not consume the native 4K encoder. Working
 # real-time fallback+preroll is sufficient; this MUST NOT downgrade native
 # 4K capture acceptance or authorize forward binding.
 if not isinstance(health,dict) or health.get('ok') is not True or health.get('mode')!='watching':
  return False
 if type(health.get('temperature_c')) not in (int,float) or health['temperature_c']>=39:
  return False
 if type(health.get('last_frame_age_ms')) is not int or not 0<=health['last_frame_age_ms']<1500:
  return False
 if health.get('capture_segment_continuation_pending') is not False:return False
 full4k=(health.get('continuous_4k_ready') is True and
         health.get('continuous_4k_dropped_output_frames')==0 and
         not health.get('continuous_4k_error'))
 fallback=(health.get('preroll_ready') is True and
           type(health.get('preroll_buffered_ms')) is int and
           health['preroll_buffered_ms']>=4400 and
           health.get('preroll_dropped_frames')==0 and
           health.get('garden_person_gate_ready') is True)
 return full4k or fallback


def apply(asset_directory):
 asset_directory=pathlib.Path(asset_directory)
 for name,expected in ((ASSET_PREVIEW,PREVIEW_SHA),(ASSET_BROWSER,BROWSER_SHA)):
  p=asset_directory/name
  if p.is_symlink() or not p.is_file() or blob(p)!=expected:
   raise RuntimeError('pinned_preview_asset_unavailable:'+name)
 for name,expected in ((ORIGINAL,HTML_SHA),(ASSET_OLD,JS_OLD_SHA)):
  if blob(WEB/name)!=expected:raise RuntimeError('protected_live_asset_changed:'+name)
 # Opening an inactive HTML file does not require inference; still preserve
 # memory and active 4K readiness and refuse disk exhaustion.
 with open('/proc/meminfo') as f:
  available=int(next(line.split()[1] for line in f if line.startswith('MemAvailable:')))
 if available<360*1024 or shutil.disk_usage('/').free<850*1024*1024:
  raise RuntimeError('resource_guard_deferred')
 with urllib.request.urlopen('http://127.0.0.1:18808/status',timeout=4) as r:
  health=json.load(r)
 if not camera_safe_for_inactive_preview(health):
  raise RuntimeError('camera_guard_deferred')
 html=build_preview((WEB/ORIGINAL).read_text())
 timestamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 backup=BACKUPS/('chat3-v324-inactive-preview-'+timestamp)
 if backup.exists():raise RuntimeError('backup_exists')
 backup.mkdir(parents=True,mode=0o700)
 results=[]
 for name,raw in ((ASSET_PREVIEW,(asset_directory/ASSET_PREVIEW).read_bytes()),
                  (ASSET_BROWSER,(asset_directory/ASSET_BROWSER).read_bytes()),
                  (HTML_PREVIEW,html.encode())):
  out=WEB/name
  if out.is_symlink():raise RuntimeError('unsafe_preview_target')
  if out.is_file():
   shutil.copy2(out,backup/name)
  fd,tmp=tempfile.mkstemp(prefix='.chat3-',dir=WEB)
  try:
   with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
   os.chmod(tmp,0o644);os.replace(tmp,out)
  finally:
   if os.path.exists(tmp):os.unlink(tmp)
  results.append({'asset':name,'git_blob':blob(out),'bytes':len(raw)})
 (backup/'receipt.json').write_text(json.dumps({'inactive_preview_only':True,
   'protected_v50_blob':HTML_SHA,'protected_v320_blob':JS_OLD_SHA,'installed':results},indent=2))
 return results
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--asset-directory');p.add_argument('--apply',action='store_true')
 args=p.parse_args()
 assert blob(WEB/ORIGINAL)==HTML_SHA and blob(WEB/ASSET_OLD)==JS_OLD_SHA
 html=build_preview((WEB/ORIGINAL).read_text())
 if args.apply:
  if not args.asset_directory:raise SystemExit('asset_directory_required')
  print('INACTIVE_PREVIEW_INSTALLED',json.dumps(apply(args.asset_directory)))
 else:print('INACTIVE_PREVIEW_SOURCE_CHECK_OK',len(html),'production_V50_unchanged')
