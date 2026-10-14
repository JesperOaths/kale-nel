"""Guarded direct S9+ upgrade with exact v11 rollback and capture checks."""
from pathlib import Path
import datetime,hashlib,json,shutil,subprocess,time,urllib.request
BASE=Path('/home/jespern/c720p-home-hub');PHONE='192.168.178.250:5555';PACKAGE='nl.kalenel.s9security'
BUILD=BASE/'build/s9-visual-attributes-v36'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def adb(*parts,timeout=45):
 p=subprocess.run(['adb','-s',PHONE,*parts],capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('adb_failed:'+p.stderr[-200:])
 return p.stdout.strip()
def status():
 with urllib.request.urlopen('http://127.0.0.1:18808/status',timeout=12) as response:return json.load(response)
def healthy(s):
 return (s.get('ok') and s.get('mode')=='watching' and s.get('native_4k_enabled') and
  s.get('continuous_4k_production_persisted') and s.get('continuous_4k_ready') and
  s.get('continuous_4k_buffered_ms',0)>=4400 and s.get('continuous_4k_dropped_output_frames')==0 and
  not s.get('continuous_4k_error') and s.get('garden_person_gate_backend')=='gpu' and
  s.get('motion_detector')=='person_spatiotemporal_transport_v9' and s.get('person_post_motion_hold_ms')==10000 and
  0<s.get('temperature_c',100)<37 and 0<=s.get('last_frame_age_ms',9999)<1500)
def launch():
 adb('shell','am','start','-n',PACKAGE+'/.CameraActivity','--ez','enable_native_camera','true')
 adb('forward','tcp:18808','tcp:8808')
def wait_health(version=None):
 for n in range(65):
  time.sleep(2)
  try:
   s=status()
   if healthy(s) and (version is None or s.get('visual_review_version')==version):return s
  except Exception:pass
 raise RuntimeError('capture_health_not_verified')
def main():
 release=json.loads((BUILD/'release.json').read_text());apk=Path(release['apk'])
 if sha(apk)!=release['sha256'] or not release['assets_manifest_libraries_unchanged']:raise RuntimeError('release_integrity_failed')
 if adb('shell','getprop','ro.product.model')!='SM-G965F':raise RuntimeError('wrong_phone')
 current=adb('shell','pm','path',PACKAGE)
 paths=[p.removeprefix('package:') for p in current.splitlines() if p.endswith('/base.apk')]
 if len(paths)!=1:raise RuntimeError('installed_apk_not_unique')
 actual=adb('shell','sha256sum',paths[0]).split()[0]
 if actual==release['sha256']:print('ALREADY_INSTALLED',flush=True);return
 if actual not in release.get('allowed_installed_sha256',[release['baseline_sha256']]):raise RuntimeError('newer_or_unexpected_phone_release_refuse_overwrite')
 if shutil.disk_usage(BASE).free<205*1024**2:raise RuntimeError('insufficient_rollback_space')
 started=time.monotonic();stable=None
 while time.monotonic()-started<240:
  s=status()
  if healthy(s) and not s.get('visual_review_busy'):
   count=s.get('recorded')
   if stable is None or stable[1]!=count:stable=(time.monotonic(),count)
   if time.monotonic()-stable[0]>15:break
  else:stable=None
  time.sleep(2)
 else:raise RuntimeError('no_safe_idle_window')
 back=BASE/'backups/s9-visual-attributes-v36';back.mkdir(mode=0o700,parents=True,exist_ok=True)
 rollback=back/('before-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.apk')
 adb('pull',paths[0],str(rollback),timeout=100)
 if sha(rollback)!=actual:raise RuntimeError('rollback_digest_mismatch')
 before=status()
 if not healthy(before) or before.get('recorded')!=s.get('recorded'):raise RuntimeError('capture_became_active')
 changed=False
 try:
  adb('shell','am','force-stop',PACKAGE);changed=True
  if 'Success' not in adb('install','-r','-g',str(apk),timeout=180):raise RuntimeError('install_not_confirmed')
  launch();s=wait_health('original_4k_visual_attributes_v36')
  checks=[]
  for n in range(6):
   time.sleep(5);s=status()
   if s.get('mode')=='watching' and not healthy(s):raise RuntimeError('capture_regression')
   checks.append({k:s.get(k) for k in ('mode','temperature_c','sensor_result_fps','continuous_4k_dropped_output_frames','garden_person_gate_errors')})
  installed=adb('shell','pm','path',PACKAGE).removeprefix('package:')
  if adb('shell','sha256sum',installed).split()[0]!=release['sha256']:raise RuntimeError('installed_digest_mismatch')
  receipt={'ok':True,'deployed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'apk_sha256':release['sha256'],
   'rollback':str(rollback),'baseline_sha256':actual,'live_checks':checks,'recorder_timing':'unified_v11_unchanged',
   'visual_review_version':s.get('visual_review_version'),'identity_matching':False}
  (BUILD/'deployment.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt),flush=True)
 except BaseException:
  if changed:
   adb('shell','am','force-stop',PACKAGE)
   if 'Success' not in adb('install','-r','-g',str(rollback),timeout=180):raise RuntimeError('rollback_install_failed')
   launch();wait_health();print('RESTORED_VERIFIED_V11',flush=True)
  raise
if __name__=='__main__':main()
