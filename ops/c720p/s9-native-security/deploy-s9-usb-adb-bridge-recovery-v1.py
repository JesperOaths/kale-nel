#!/usr/bin/env python3
"""Safely add exact-S9+ USB recovery to the existing C720P bridge service.

Keeps existing timer cadence and the same TCP forward. This does not enable
USB debugging without user authorization or change any camera recording.
"""
from pathlib import Path
import datetime,os,stat,subprocess,tempfile,urllib.request

HOME=Path('/home/jespern')
DIR=HOME/'.config/systemd/user'
UNIT=DIR/'c720p-s9-native-camera-bridge.service'
DROP=DIR/'c720p-s9-native-camera-bridge.service.d/20-recover-authorized-s9-usb.conf'
BIN=HOME/'c720p-home-hub/bin/recover-authorized-s9-adb-from-usb-v1.py'
BACK=HOME/'c720p-home-hub/backups/s9-adb-bridge-usb-recovery-v1'
URL='https://raw.githubusercontent.com/JesperOaths/kale-nel/d74e132220892ff8244d9b9c909bdceaefb34cba/ops/c720p/s9-native-security/recover-authorized-s9-adb-from-usb-v1.py'
OVERRIDE='''[Service]
ExecStart=
ExecStart=/usr/bin/python3 /home/jespern/c720p-home-hub/bin/recover-authorized-s9-adb-from-usb-v1.py
TimeoutStartSec=75
'''
def call(*a):
 x=subprocess.run(a,capture_output=True,text=True,timeout=17)
 if x.returncode:raise RuntimeError('command_failed_'+str(a[:3])+x.stderr[-300:])
 return x.stdout
def atomic(path,raw,mode):
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,temp=tempfile.mkstemp(prefix='.s9-bridge-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
  os.chmod(temp,mode);os.replace(temp,path)
 finally:
  if os.path.exists(temp):os.unlink(temp)
def main():
 if not UNIT.is_file() or UNIT.is_symlink():
  raise RuntimeError('unit_missing')
 content=UNIT.read_text()
 if 'ExecStart=/usr/bin/adb connect 192.168.178.250:5555' not in content or (
    'forward tcp:18808 tcp:8808' not in content):
  raise RuntimeError('unexpected_existing_s9_bridge')
 with urllib.request.urlopen(URL,timeout=28) as r:script=r.read(6000)
 if not (script.startswith(b'#!/usr/bin/env python3') and
         b'MODEL="SM-G965F"' in script and
         b'tcp:18808' in script):
  raise RuntimeError('unexpected_recovery_script')
 compile(script.decode(),str(BIN),'exec')
 BACK.mkdir(mode=0o700,parents=True,exist_ok=True)
 folder=BACK/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 folder.mkdir(mode=0o700)
 old={p:(p.read_bytes() if p.is_file() else None) for p in (BIN,DROP)}
 for p,data in old.items():
  if data is not None:(folder/p.name).write_bytes(data)
 touched=[]
 try:
  atomic(BIN,script,0o700);touched.append(BIN)
  atomic(DROP,OVERRIDE.encode(),0o644);touched.append(DROP)
  call('systemctl','--user','daemon-reload')
  changed=call('systemctl','--user','show','-p','ExecStart',
    'c720p-s9-native-camera-bridge.service')
  if str(BIN) not in changed:raise RuntimeError('dropin_not_loaded')
  print('S9_USB_WIFI_RECONNECT_READY',
   {'script':str(BIN),'service_dropin':str(DROP),
    'usb_model_restricted':True,'current_camera_unchanged':True,
    'original_unit_untouched':True,'backup':str(folder)},flush=True)
 except BaseException:
  for p in reversed(touched):
   if old[p] is None:
    if p.exists():p.unlink()
   else:atomic(p,old[p],0o700 if p==BIN else 0o644)
  try:call('systemctl','--user','daemon-reload')
  except Exception:pass
  raise
if __name__=='__main__':main()
