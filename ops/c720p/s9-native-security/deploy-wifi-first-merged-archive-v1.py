#!/usr/bin/env python3
"""Deploy Wi-Fi-first S9 archive media transport with genuine Wi-Fi proof.
Preserve backups and the working browser/archive. No camera APK modifications.
"""
from pathlib import Path
import hashlib,importlib.util,json,os,subprocess,tempfile,time,urllib.request
ROOT=Path("/home/jespern/c720p-home-hub")
TARGET=ROOT/"bin/s9_merged_archive_stream_v1.py"
URL="https://raw.githubusercontent.com/JesperOaths/kale-nel/cab8db19e243980d777fcb198cfd61d89ed603ca/ops/c720p/s9-native-security/s9_merged_archive_stream_v1.py"
SERIAL="192.168.178.250:5555"
VIDEO="motion_1791934137487.mp4"
EXPECTED="11d13b33f55d252e574f0d431f1a206bbc3b8aab92d52ec08b71699dc2d8e5c1"
FILE="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K/"+VIDEO+".complete.mp4"
def cmd(a,timeout=30):
 p=subprocess.run(a,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError("command_failed "+str(a[:4])+": "+p.stderr[-220:])
 return p.stdout
def video_http():
 url="http://127.0.0.1:8794/new/saved/complete/"+VIDEO
 for j in range(20):
  try:
   with urllib.request.urlopen(urllib.request.Request(url,headers={"Range":"bytes=0-4095"}),timeout=20) as r:
    data=r.read(4096)
    if r.status==206 and data[4:8]==b"ftyp" and len(data)==4096:return True
  except Exception:time.sleep(.55)
 raise RuntimeError("authenticated_combined_playback_check_failed")
def main():
 with urllib.request.urlopen(URL,timeout=35) as r:raw=r.read(20000)
 text=raw.decode()
 if "def adb_phone():" not in text or "192.168.178.250:5555" not in text:
  raise RuntimeError("wifi_peer_contract_missing")
 compile(text,str(TARGET),"exec")
 old=TARGET.read_bytes()
 backup=ROOT/"backups/s9-wifi-first-complete-archive-v1"/str(int(time.time()))
 backup.mkdir(parents=True,mode=0o700,exist_ok=True)
 (backup/TARGET.name).write_bytes(old)
 # Test that the authorized Wi-Fi transport reads a real artifact, independently
 # of the connected USB interface; transfer into RAM, never touch originals.
 model=cmd(["adb","-s",SERIAL,"shell","getprop","ro.product.model"],15).strip()
 if model!="SM-G965F":raise RuntimeError("wifi_peer_model_unexpected")
 target=Path("/tmp")/"s9-wifi-transfer-proof-20261014.mp4"
 try:
  cmd(["adb","-s",SERIAL,"pull",FILE,str(target)],70)
  if hashlib.sha256(target.read_bytes()).hexdigest()!=EXPECTED:
   raise RuntimeError("wifi_byte_transfer_sha_mismatch")
 finally:target.unlink(missing_ok=True)
 fd,p=tempfile.mkstemp(prefix=".s9wifi-",dir=TARGET.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(raw);f.flush();os.fsync(f.fileno())
  os.chmod(p,0o700);os.replace(p,TARGET)
 finally:
  if os.path.exists(p):os.unlink(p)
 try:
  spec=importlib.util.spec_from_file_location("s9wifi_probe",TARGET)
  mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
  if mod.adb_phone()!=SERIAL:raise RuntimeError("helper_still_depends_on_usb")
  cmd(["systemctl","--user","restart","c720p-drive-security-archive.service"],25)
  video_http()
  print("S9_USB_FREE_ARCHIVE_MEDIA_VERIFIED",json.dumps({"adb_wifi":SERIAL,
      "sha256":EXPECTED,"media_http_range_verified":True,"recovery_backup":str(backup),
      "camera_apk_unchanged":True}),flush=True)
 except BaseException:
  TARGET.write_bytes(old)
  try:cmd(["systemctl","--user","restart","c720p-drive-security-archive.service"],25)
  except Exception:pass
  raise
if __name__=="__main__":main()
