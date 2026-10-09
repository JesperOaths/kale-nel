#!/usr/bin/env python3
"""Reversible S9 rear-camera 4K encoder proof, not a production setting."""
import datetime,json,pathlib,shutil,sys,time,urllib.request
BASE='http://192.168.178.250:8080'
CTRL='http://127.0.0.1:8793'
CFG=pathlib.Path('/home/jespern/c720p-security-camera-new/frontyard-security-config.json')
def get(url):
 with urllib.request.urlopen(url,timeout=8) as r:return json.load(r)
def put(key,value):
 b=json.dumps({'key':key,'value':value}).encode()
 q=urllib.request.Request(CTRL+'/camera-control',b,headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(q,timeout=12) as r:return json.load(r)
def actual():return get(CTRL+'/camera-controls')['controls']['video_size']['value']
def main():
 cfg=json.loads(CFG.read_text());status=get(CTRL+'/health.json')
 if status.get('recording') or get(BASE+'/status.json').get('video_status',{}).get('enabled'):
  print('4K_DEFER_CAMERA_BUSY');return
 if actual()!='1920x1080':print('4K_UNEXPECTED_EXISTING',actual());return
 backup=CFG.with_name('frontyard-config-before4k-'+datetime.datetime.now().strftime('%Y%m%d%H%M%S')+'.json')
 shutil.copy2(CFG,backup)
 original=cfg['camera_video_size'];oldnormal=(cfg.get('battery_profile_normal') or {}).copy()
 try:
  cfg['camera_video_size']='3840x2160'
  cfg.setdefault('battery_profile_normal',{})['video_size']='3840x2160'
  CFG.write_text(json.dumps(cfg,indent=2)+'\n')
  print('4K_CONTROL',put('video_size','3840x2160'),flush=True)
  time.sleep(4)
  print('4K_ACTIVE',actual(),flush=True)
  if actual()!='3840x2160':
   print('4K_ENCODER_NOT_ACCEPTED');return
  original_files={e['name'] for e in get(BASE+'/list_videos')}
  rec=get(BASE+'/startvideo')
  print('4K_START',rec,flush=True)
  if rec.get('result')!='started':print('4K_RECORDER_REFUSED');return
  try:time.sleep(8)
  finally:print('4K_STOP',get(BASE+'/stopvideo'),flush=True)
  for e in get(BASE+'/list_videos'):
   if e.get('name') not in original_files:print('4K_TEST_FILE',e,flush=True)
 finally:
  shutil.copy2(backup,CFG)
  print('4K_RESTORE',put('video_size',original),flush=True)
  print('4K_FINAL',actual(),flush=True)
if __name__=='__main__':
 try:main()
 except Exception as e:print('4K_TEST_ERROR',type(e).__name__,str(e)[:170],file=sys.stderr);sys.exit(1)
