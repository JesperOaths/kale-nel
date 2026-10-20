#!/usr/bin/env python3
"""Guarded one-shot disposable S9 AndroidKeyStore test. Never production keys."""
import fcntl,importlib.util,json,os,re,subprocess,secrets,shutil,tempfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
GUARD=HERE/"probe-s9-app-process-noimage-v166.py"
MAN=HERE/"s9-keystore-probe-v219/AndroidManifest.xml"
SRC=HERE/"s9-keystore-probe-v219/KeyProbe.java"
PACKAGE="nl.kalenel.s9keyprobev219"
ACTION=PACKAGE+".CHECK"
TAG="S9_KEYSTORE_PROBE_V219"
MARK="S9_KEYSTORE_PHYSICAL_V219 "
RESULT=re.compile(
 r"PROBE_RESULT pass=(true|false) preexisting_alias=(true|false)"
 r" created_two_test_keys=(true|false) nonexportable=(true|false)"
 r" stable_mac=(true|false) keys_distinct=(true|false)"
 r" test_aliases_removed=(true|false)"
 r" production_aliases_modified=false camera_or_media_touched=false")
class Stop(Exception):pass
def require(ok,reason):
 if not ok:raise Stop(reason)
def run(args,timeout=35,cwd=None):
 try:p=subprocess.run(args,cwd=cwd,capture_output=True,text=True,timeout=timeout)
 except (OSError,subprocess.TimeoutExpired):raise Stop("bounded_command_failure") from None
 require(p.returncode==0,"bounded_command_failure")
 return p
def import_guard():
 require(GUARD.is_file() and not GUARD.is_symlink(),"camera_guard_unavailable")
 spec=importlib.util.spec_from_file_location("s9_v219_guard",str(GUARD))
 g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
 return g
def installed(g):
 p=g.adb("shell","pm list packages "+PACKAGE,seconds=12)
 require(p.returncode==0,"app_package_state_untrusted")
 return "package:"+PACKAGE in p.stdout.splitlines()
def build(g,folder):
 require(shutil.disk_usage("/").free>=850*1048576,"hub_reserve_low")
 for file in (MAN,SRC):
  require(file.is_file() and not file.is_symlink() and
          200<file.stat().st_size<8500,"probe_source_untrusted")
 txt=SRC.read_text();xml=MAN.read_text()
 for bad in ("CameraManager","MediaCodec","FileInputStream","FileOutputStream",
             "HttpServer","new Socket(","getExternalFilesDir","System.loadLibrary"):
  require(bad not in txt,"unsafe_probe_capability")
 for bad in ("uses-permission","android.permission.CAMERA","android.permission.INTERNET"):
  require(bad not in xml,"probe_manifest_has_permission")
 require(g.AND_JAR.is_file(),"android_sdk_missing")
 classes=folder/"classes";classes.mkdir()
 dex=folder/"dex";dex.mkdir()
 run(["javac","-source","8","-target","8","-cp",str(g.AND_JAR),"-d",
      str(classes),str(SRC)],timeout=35)
 objects=list(classes.rglob("*.class"))
 require(len(objects)==1,"unexpected_probe_compilation")
 run(["d8","--min-api","28","--lib",str(g.AND_JAR),
      "--output",str(dex),str(objects[0])],timeout=45)
 unsigned=folder/"unsigned.apk"
 run(["aapt","package","-f","-M",str(MAN),"-I",str(g.AND_JAR),
      "-F",str(unsigned)],timeout=30)
 run(["aapt","add",str(unsigned),"classes.dex"],cwd=str(dex),timeout=12)
 pw=secrets.token_urlsafe(24);ks=folder/"disposable.jks"
 run(["keytool","-genkeypair","-noprompt","-alias","temp219","-keyalg","RSA",
      "-keysize","2048","-validity","1","-dname","CN=Disposable Keystore Check",
      "-keystore",str(ks),"-storepass",pw,"-keypass",pw],timeout=38)
 apk=folder/"disposable-keystore-probe.apk"
 run(["apksigner","sign","--ks",str(ks),"--ks-key-alias","temp219",
      "--ks-pass","pass:"+pw,"--key-pass","pass:"+pw,
      "--out",str(apk),str(unsigned)],timeout=35)
 run(["apksigner","verify",str(apk)],timeout=20)
 require(1000<apk.stat().st_size<1000000,"probe_apk_size_drift")
 return apk
def one_time(g,apk):
 was_present=installed(g)
 require(not was_present,"preexisting_package_protected")
 try:
  # Even partial install must trigger scoped cleanup.
  p=g.adb("install","-g",str(apk),seconds=42)
  require(p.returncode==0 and "Success" in p.stdout,
          "disposable_install_failed")
  require(installed(g),"disposable_install_not_confirmed")
  g.current_camera()
  p=g.adb("shell","am broadcast -a "+ACTION+" -n "+PACKAGE+"/.KeyProbe",seconds=22)
  require(p.returncode==0,"test_broadcast_failed")
  p=g.adb("shell","logcat -d -v brief -s "+TAG+":I '*:S'",seconds=15)
  require(p.returncode==0,"test_aggregate_log_missing")
  lines=[line for line in p.stdout.splitlines() if TAG in line and "PROBE_RESULT " in line]
  require(1<=len(lines)<=20,"test_aggregate_count_untrusted")
  matched=RESULT.search(lines[-1])
  require(matched is not None,"test_aggregate_schema_invalid")
  flags=[v=="true" for v in matched.groups()]
  return dict(zip(("test_pass","preexisting_alias","created_two_test_keys",
       "nonexportable","stable_mac","keys_distinct","test_aliases_removed"),flags))
 finally:
  # Never uninstall a preexisting package; this unique probe was proven absent.
  if not was_present and installed(g):
   p=g.adb("uninstall",PACKAGE,seconds=30)
   require(p.returncode==0 and "Success" in p.stdout and not installed(g),
           "disposable_package_cleanup_not_verified")
def conduct(g):
 require(g.LOCK.is_file() and not g.LOCK.is_symlink(),"shared_worker_lock_missing")
 with g.LOCK.open("r") as locked:
  try:fcntl.flock(locked,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise Stop("another_camera_worker_busy") from None
  before=g.current_camera()
  require(before["temperature_c"]<=35.0,"camera_not_cool")
  require(g.must_adb("shell","getprop ro.product.model")==g.MODEL,
          "wrong_phone_model")
  require(g.must_adb("shell","getprop ro.build.version.sdk")=="29",
          "not_android_10")
  pid=g.must_adb("shell","pidof nl.kalenel.s9security")
  require(bool(g.PID.fullmatch(pid)),"camera_pid_untrusted")
  require(not installed(g),"prior_disposable_probe_protected")
  with tempfile.TemporaryDirectory(prefix="s9-keystore-v219-") as tmp:
   apk=build(g,Path(tmp))
   g.current_camera()
   flags=one_time(g,apk)
  after=g.current_camera()
  require(g.must_adb("shell","pidof nl.kalenel.s9security")==pid,
          "camera_pid_changed")
  require(not installed(g),"disposable_package_left_installed")
  return {'status':('physical_ephemeral_keystore_verified' if flags['test_pass']
      and flags['test_aliases_removed'] and not flags['preexisting_alias']
      else 'physical_ephemeral_keystore_not_verified'),
      **flags,'camera_temp_before_c':before['temperature_c'],
      'camera_temp_after_c':after['temperature_c'],
      'camera_pid_unchanged':True,'disposable_app_uninstalled':True,
      'production_aliases_modified':False,'camera_media_touched':False}
def main():
 try:output=conduct(import_guard())
 except Exception as err:
  allowed={'camera_guard_unavailable','hub_reserve_low','probe_source_untrusted',
   'unsafe_probe_capability','probe_manifest_has_permission','android_sdk_missing',
   'unexpected_probe_compilation','bounded_command_failure','probe_apk_size_drift',
   'app_package_state_untrusted','preexisting_package_protected',
   'disposable_install_failed','disposable_install_not_confirmed',
   'test_broadcast_failed','test_aggregate_log_missing','test_aggregate_count_untrusted',
   'test_aggregate_schema_invalid','disposable_package_cleanup_not_verified',
   'shared_worker_lock_missing','another_camera_worker_busy','camera_not_cool',
   'wrong_phone_model','not_android_10','camera_pid_untrusted',
   'prior_disposable_probe_protected','camera_pid_changed',
   'disposable_package_left_installed','native_4k_pipeline_unhealthy',
   'native_4k_temperature_guard','native_4k_buffer_not_ready',
   'native_4k_recording_in_progress','s9_background_work_queued'}
  code=str(err)
  output={'status':'deferred_or_failed',
     'reason':code if code in allowed else 'bounded_probe_failed',
     'production_aliases_modified':False,'camera_media_touched':False}
 print(MARK+json.dumps(output,sort_keys=True,separators=(',',':')),flush=True)
 if output['status']!='physical_ephemeral_keystore_verified':raise SystemExit(1)
if __name__=='__main__':main()
