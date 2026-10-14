#!/usr/bin/env python3
"""Guarded on-phone S9+ single-joined-MP4 deployment with automatic APK rollback."""
from pathlib import Path
import hashlib,json,re,subprocess,time,urllib.request,zipfile,datetime
HOME=Path('/home/jespern/c720p-home-hub')
NEW=HOME/'build/s9-onphone-prepended-mp4-v1'
BACK=HOME/'backups/s9-onphone-prepend-v1'
PHONE='192.168.178.250:5555'
CERT='0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5'
def run(args,timeout=65,check=True):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if check and p.returncode:raise RuntimeError('command_failed '+str(args[:4])+' '+p.stderr[-250:])
 return p.stdout
def adb(*a,timeout=55):return run(['adb','-s',PHONE,*a],timeout)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def signer(p):
 s=run(['apksigner','verify','--print-certs',str(p)],35)
 m=re.search('certificate SHA-256 digest: ([a-f0-9]{64})',s)
 return m.group(1) if m else ''
def models(p):
 with zipfile.ZipFile(p) as z:
  return {n:hashlib.sha256(z.read('assets/'+n)).hexdigest()
   for n in ('detect.tflite','face_embedding.tflite','labelmap.txt')}
def status():
 with urllib.request.urlopen('http://127.0.0.1:18808/status',timeout=13) as r:return json.load(r)
def healthy(j):
 return j.get('ok') is True and j.get('native_4k_enabled') is True and (
  j.get('mode') in ('watching','recording')) and j.get('garden_person_gate_backend')=='gpu' and (
  j.get('temperature_c',999)<37) and j.get('last_frame_age_ms',9999)<2500
def launch():
 adb('shell','am','force-stop','nl.kalenel.s9security',timeout=20)
 adb('shell','am','start','-n','nl.kalenel.s9security/.CameraActivity',
     '--ez','enable_native_camera','true',timeout=35)
def wait(new_version,limit=90):
 until=time.monotonic()+limit;latest={}
 while time.monotonic()<until:
  try:
   latest=status()
   if healthy(latest) and latest.get('frames',0)>45 and latest.get('preroll_ready') is True:
    if not new_version:return latest
    if latest.get('preroll_prepend_version')=='s9_onphone_event_prepend_transcode_v1' and (
        latest.get('preroll_prepend_enabled') is True):
     return latest
  except Exception:pass
  time.sleep(2)
 raise RuntimeError('phone_live_validation_failed '+str({
  k:latest.get(k) for k in ('mode','preroll_prepend_version','preroll_ready',
  'preroll_prepend_errors','temperature_c','last_error')}))
def main():
 release=json.loads((NEW/'release.json').read_text())
 signed=Path(release['apk'])
 if not signed.is_file() or sha(signed)!=release['sha256'] or (
  signer(signed)!=CERT or release['signer_sha256']!=CERT):
  raise RuntimeError('release_integrity_or_signer')
 adb('forward','tcp:18808','tcp:8808',timeout=20)
 old=None;changed=False
 try:
  # Prefer waiting for a natural idle; never stop an active 4K recording.
  eligible=None
  for n in range(23):
   j=status()
   if healthy(j) and j.get('mode')=='watching' and j.get('temperature_c',999)<35:
    eligible=j;break
   time.sleep(3)
  if eligible is None:raise RuntimeError('camera_not_safely_idle')
  path=adb('shell','pm','path','nl.kalenel.s9security',timeout=18).strip()
  match=re.search(r'package:(/[^\s]+base[.]apk)',path)
  if not match:raise RuntimeError('installed_apk_unavailable')
  BACK.mkdir(mode=0o700,parents=True,exist_ok=True)
  old=BACK/('before-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.apk')
  adb('pull',match.group(1),str(old),timeout=100)
  if not 8_000_000<old.stat().st_size<40_000_000 or signer(old)!=CERT or models(old)!=models(signed):
   raise RuntimeError('unable_to_restore_old_app_or_models_differ')
  time.sleep(2)
  j=status()
  if j.get('mode')!='watching' or not healthy(j):raise RuntimeError('recording_started_before_upgrade')
  print('VERIFIED_PREPEND_ROLLBACK',str(old),flush=True)
  changed=True
  adb('shell','am','force-stop','nl.kalenel.s9security',timeout=22)
  result=adb('install','-r','-g',str(signed),timeout=175)
  if 'Success' not in result:raise RuntimeError('apk_install_unconfirmed')
  launch()
  good=wait(True,100)
  print('S9_PREPENDED_APK_LIVE',json.dumps({
   'version':good.get('preroll_prepend_version'),'mode':good.get('mode'),
   'gpu':good.get('garden_person_gate_backend'),'4k_original':good.get('native_4k_enabled'),
   'temp_c':good.get('temperature_c'),'prebuffer_ms':good.get('preroll_buffered_ms'),
   'merges':good.get('preroll_prepend_merged'),'merger_errors':good.get('preroll_prepend_errors'),
   'old_apk':str(old),'signed_sha':release['sha256']},sort_keys=True),flush=True)
 except BaseException as err:
  print('PREPEND_UPGRADE_ERROR',type(err).__name__,str(err)[:500],flush=True)
  if changed and old and old.exists():
   try:
    adb('shell','am','force-stop','nl.kalenel.s9security',timeout=20)
    if 'Success' not in adb('install','-r','-g',str(old),timeout=180):
     raise RuntimeError('rollback_install_failed')
    launch();j=wait(False,90)
    print('S9_ORIGINAL_4K_ROLLBACK_VERIFIED',j.get('mode'),flush=True)
   except Exception as rollback:
    print('S9_ROLLBACK_MANUAL_ATTENTION',str(rollback)[:280],flush=True)
  raise
 finally:
  # Keep existing long-lived ADB local forward in place for authenticated HA.
  pass
if __name__=='__main__':main()
