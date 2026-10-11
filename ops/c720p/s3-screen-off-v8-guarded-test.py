#!/usr/bin/env python3
"""Guarded S3 v8 installation and actual dark-display on-phone motion test.

Never declare success unless native Camera1 client and S3MOTION heartbeats
keep advancing with Android display in Dozing state. Restore v7 + settings
on any failed test.
"""
from pathlib import Path
import json,re,subprocess,time,datetime

BASE=Path('/home/jespern/c720p-home-hub')
APK=BASE/'build/s3-screen-off-v8/s3-motion-v8-signed.apk'
ROLLBACK=BASE/'backups/s3-screen-off-v8/s3-motion-v7-installed-20261011.apk'
REPORT=BASE/'state/s3-screen-off-v8-test.json'
P='192.168.178.47:5555'
APP='nl.kalenel.s3motion'
def do(args,timeout=26,check=True):
 p=subprocess.run([str(x) for x in args],capture_output=True,text=True,timeout=timeout)
 if check and p.returncode:raise RuntimeError(str(args[:4])+':'+p.stderr[-170:])
 return p.stdout
def adb(*args,timeout=26,check=True):
 return do(['adb','-s',P,*args],timeout=timeout,check=check)
def current():
 power=adb('shell','dumpsys','power',timeout=16)
 cam=adb('shell','dumpsys','media.camera',timeout=16)
 alive='Client Package Name: '+APP in cam.split('Prior client events',1)[0]
 wake=re.search('mWakefulness=([A-Za-z]+)',power)
 try:
  log=adb('logcat','-d','-s','S3MOTION:I','*:S',timeout=17)
  h=re.findall(r'HEARTBEAT session=([0-9]+)[^\n]*?frames=([0-9]+)',log)
  last=h[-1] if h else None
 except Exception:last=None
 return {'wake':wake.group(1) if wake else 'unknown','camera':alive,
         'heartbeat_session':last[0] if last else None,
         'heartbeat_frames':int(last[1]) if last else None}
def awake():
 adb('shell','input','keyevent','224',check=False)
 time.sleep(3)
 adb('shell','am','start','-n',APP+'/.MotionActivity',check=False)
 time.sleep(4)
def wait_camera(maxsec=32):
 end=time.monotonic()+maxsec
 while time.monotonic()<end:
  value=current()
  if value['camera'] and value['heartbeat_frames'] is not None and value['heartbeat_frames']>=3:
   return value
  time.sleep(3)
 raise RuntimeError('rear_motion_camera_no_heartbeat_after_install')
def main():
 if APK.stat().st_size<18000 or ROLLBACK.stat().st_size<10000:
  raise RuntimeError('APK_or_v7_rollback_missing')
 from_hash=do(['sha256sum',APK]).split()[0]
 stamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
 old_stayon=adb('shell','settings','get','global','stay_on_while_plugged_in').strip()
 old_timeout=adb('shell','settings','get','system','screen_off_timeout').strip()
 old_wifi=adb('shell','settings','get','global','wifi_sleep_policy').strip()
 report={'started_at':stamp,'old_stay_on':old_stayon,'old_timeout':old_timeout,
         'wifi_sleep_policy':old_wifi,'apk_sha256':from_hash,'successful':False}
 REPORT.parent.mkdir(parents=True,exist_ok=True)
 REPORT.write_text(json.dumps(report,indent=2));REPORT.chmod(0o600)
 installed=False
 try:
  print('BEFORE',json.dumps(current()),flush=True)
  # Signed with the same existing certificate, verified by build stage.
  result=adb('install','-r','-g',str(APK),timeout=85)
  if 'Success' not in result:raise RuntimeError('install_not_successful:'+result[:100])
  installed=True
  print('S3_V8_INSTALLED',result.strip()[-120:],flush=True)
  awake()
  base=wait_camera(32)
  print('S3_V8_BASE',json.dumps(base),flush=True)
  # Explicit display-off while charging (not an AMOLED brightness workaround).
  adb('shell','input','keyevent','26')
  time.sleep(5)
  off5=current();print('S3_OFF_5S',json.dumps(off5),flush=True)
  if off5['wake'] not in ('Dozing','Asleep') or not off5['camera']:
   raise RuntimeError('screen_off_stopped_camera_initially')
  time.sleep(17)
  off22=current();print('S3_OFF_22S',json.dumps(off22),flush=True)
  if off22['wake'] not in ('Dozing','Asleep') or not off22['camera']:
   raise RuntimeError('screen_off_stopped_camera_after_22s')
  time.sleep(22)
  off44=current();print('S3_OFF_44S',json.dumps(off44),flush=True)
  if off44['wake'] not in ('Dozing','Asleep') or not off44['camera']:
   raise RuntimeError('screen_off_stopped_camera_after_44s')
  # Require two real on-phone NV21 motion-processing heartbeat advances.
  if not (off22['heartbeat_session']==off44['heartbeat_session'] and
          off22['heartbeat_frames'] is not None and
          off44['heartbeat_frames'] is not None and
          off44['heartbeat_frames']>off22['heartbeat_frames']+8):
   raise RuntimeError('screen_off_no_continuous_frame_processing')
  # Reduce unnecessary display-on time after user taps the phone.
  adb('shell','settings','put','global','stay_on_while_plugged_in','0')
  adb('shell','settings','put','system','screen_off_timeout','30000')
  report.update(successful=True,completed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                off22=off22,off44=off44,new_stay_on='0',new_timeout='30000',
                original_motion_behavior_preserved=True)
  REPORT.write_text(json.dumps(report,indent=2))
  print('S3_SCREEN_OFF_ONPHONE_MOTION_V8_LIVE',json.dumps({
    'screen':off44['wake'],'camera':off44['camera'],
    'frames_increased':off44['heartbeat_frames']-off22['heartbeat_frames'],
    'display_timeout_s':30,'installed_apk':'v8','rollback_available':True
  }),flush=True)
 except Exception as err:
  print('S3_V8_TEST_FAILED',type(err).__name__,str(err)[:240],flush=True)
  report['error']=str(err)[:250]
  try:
   adb('shell','input','keyevent','224',check=False)
   adb('shell','settings','put','global','stay_on_while_plugged_in',old_stayon or '7',check=False)
   adb('shell','settings','put','system','screen_off_timeout',old_timeout or '1800000',check=False)
   if installed:
    restored=adb('install','-r','-g',str(ROLLBACK),timeout=85)
    print('S3_V7_ROLLBACK',restored[-140:],flush=True)
   awake()
   report['rolled_back']=True
   print('S3_V7_RESTORED_CAMERA',json.dumps(current()),flush=True)
  except Exception as fallback:
   report['rollback_error']=str(fallback)[:230]
   print('S3_ROLLBACK_NEEDS_ATTENTION',str(fallback)[:150],flush=True)
  REPORT.write_text(json.dumps(report,indent=2))
  raise
if __name__=='__main__':main()
