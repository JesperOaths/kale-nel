#!/usr/bin/env python3
"""Build optional Samsung HTS FUNCTION short IR variant on Galaxy S5 safely.
The original codes are untouched. Deploy requires --install and checks signing
certificate parity, device serial, and keeps a restorable original APK.
"""
import os,sys,re,json,shutil,subprocess,time,hashlib
from pathlib import Path
P=Path("/home/jespern/s5-ir-bridge-manual")
OUT=Path("/home/jespern/c720p-home-hub/build/s5-ir-function-short-v129")
BACK=Path("/home/jespern/c720p-backups/s5-ir-function-short-v129-"+time.strftime("%Y%m%d_%H%M%S"))
MARK="C720P_S5_FUNCTION_SHORT_IR_V129"
TARGET="[fd00::1:7a4b:87ff:fe80:eee0]:5555"
SERIAL="993e96d0"
def run(args,timeout=60,cwd=None,check=True):
 r=subprocess.run(args,capture_output=True,text=True,timeout=timeout,cwd=cwd)
 if check and r.returncode:raise RuntimeError(f"{args}: {r.stdout[-900:]} {r.stderr[-1500:]}")
 return r
def find(name):
 p=shutil.which(name)
 if p:return p
 for root in ['/usr/lib/android-sdk','/opt/android-sdk',os.path.expanduser('~/Android/Sdk')]:
  for pp in Path(root).rglob(name) if Path(root).exists() else []:
   if pp.is_file():return str(pp)
 raise RuntimeError('missing '+name)
def jar():
 a=[]
 for root in ['/usr/lib/android-sdk','/opt/android-sdk',os.path.expanduser('~/Android/Sdk')]:
  p=Path(root)
  if p.exists():a+=list(p.glob('platforms/*/android.jar'))
 assert a,"Android SDK platform absent"
 return str(sorted(a,key=lambda x:int(re.search(r'android-(\d+)',str(x)).group(1)) if re.search(r'android-(\d+)',str(x)) else 0)[-1])
def fingerprint(apk):
 txt=run([find('apksigner'),'verify','--print-certs',str(apk)],timeout=30).stdout
 m=re.search(r'Signer #1 certificate SHA-256 digest: ([\da-fA-F]+)',txt)
 if not m:raise RuntimeError('could not read signing certificate '+txt[-700:])
 return m.group(1).lower()
ANDROID_JAR=jar()
OUT.mkdir(parents=True,exist_ok=True)
W=OUT
shutil.copy2(P/'AndroidManifest.xml',W/'AndroidManifest.xml')
if (W/'res').exists():shutil.rmtree(W/'res')
shutil.copytree(P/'res',W/'res')
if (W/'src').exists():shutil.rmtree(W/'src')
shutil.copytree(P/'src',W/'src')
source=W/'src/com/bruis/s5irbridge/IrReceiver.java'
t=source.read_text()
assert MARK not in t
loc=re.search(r'(?m)^\s*CODES\.put\("function", new Code\(38000, new int\[\]\{[^\n]+\}\)\);',t)
assert loc,'function command not found'
insert='''
        // C720P_S5_FUNCTION_SHORT_IR_V129
        // Optional 68-duration single NEC frame: same exact FUNCTION
        // waveform/address as original, but with no subsequent repeats.
        CODES.put("function_short", new Code(
            CODES.get("function").frequency,
            java.util.Arrays.copyOf(CODES.get("function").pattern, 68)));
'''
t=t[:loc.end()]+insert+t[loc.end():]
source.write_text(t)
(W/'build/classes').mkdir(parents=True,exist_ok=True)
(W/'build/dex').mkdir(parents=True,exist_ok=True)
for f in (W/'build/classes').rglob("*.class"):f.unlink()
files=sorted(str(f) for f in (W/'src').rglob('*.java'))
run(['javac','-source','1.8','-target','1.8','-bootclasspath',ANDROID_JAR,'-d',str(W/'build/classes'),*files],timeout=85)
run(['jar','cf',str(W/'build/classes.jar'),'-C',str(W/'build/classes'),'.'],timeout=25)
run([find('d8'),'--min-api','19','--lib',ANDROID_JAR,'--output',str(W/'build/dex'),str(W/'build/classes.jar')],timeout=65)
run([find('aapt'),'package','-f','-M',str(W/'AndroidManifest.xml'),'-S',str(W/'res'),'-I',ANDROID_JAR,'-F',str(W/'build/unsigned.apk')],timeout=45)
run(['jar','uf',str(W/'build/unsigned.apk'),'-C',str(W/'build/dex'),'classes.dex'],timeout=40)
run([find('zipalign'),'-f','4',str(W/'build/unsigned.apk'),str(W/'build/aligned.apk')],timeout=25)
key=Path("/home/jespern/.android/s5-ir-bridge-debug.keystore")
assert key.exists(),"Existing same package debug key absent; refuse replacement"
apk=W/'build/s5-ir-bridge-v129.apk'
run([find('apksigner'),'sign','--ks',str(key),'--ks-pass','pass:android','--key-pass','pass:android','--out',str(apk),str(W/'build/aligned.apk')],timeout=55)
sig=fingerprint(apk)
assert apk.stat().st_size>12000
ident=run(['adb','-s',TARGET,'shell','getprop','ro.serialno'],timeout=12).stdout.strip()
model=run(['adb','-s',TARGET,'shell','getprop','ro.product.model'],timeout=12).stdout.strip()
assert ident==SERIAL and model=="SM-G900F",(ident,model)
paths=run(['adb','-s',TARGET,'shell','pm','path','com.bruis.s5irbridge'],timeout=15).stdout.strip().splitlines()
paths=[s.split('package:',1)[1] for s in paths if s.startswith('package:') and s.endswith('base.apk')]
assert len(paths)==1,paths
BACK.mkdir(parents=True,exist_ok=False)
previous=BACK/'s5-ir-bridge-before.apk'
run(['adb','-s',TARGET,'pull',paths[0],str(previous)],timeout=50)
prev_sig=fingerprint(previous)
assert sig==prev_sig,'Certificate mismatch: no install'
result={'ok':True,'signed_cert_match':True,'new_bytes':apk.stat().st_size,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest()[:16],'backup':str(previous),'target_serial':ident,'command_added':'function_short','original_IR_commands_unchanged':True,'installed':False}
if '--install' in sys.argv:
 try:
  run(['adb','-s',TARGET,'install','-r',str(apk)],timeout=90)
  result['installed']=True
  cmd=['adb','-s',TARGET,'shell','am','broadcast',
       '-n','com.bruis.s5irbridge/.IrReceiver',
       '-a','com.bruis.s5irbridge.SEND','--es','device','ht-e6500','--es','command','function_short']
  sent=run(cmd,timeout=18)
  result['broadcast_result']=sent.stdout.strip()[-400:]
  logs=run(['adb','-s',TARGET,'logcat','-d','-v','time','-s','S5IRBridge:I','*:S'],timeout=25).stdout
  found=any('Sent verified command=function_short' in line for line in logs.splitlines())
  result['short_ir_hardware_logged']=found
  if not found:raise RuntimeError("short IR not logged after install; rolling back")
 except BaseException:
  run(['adb','-s',TARGET,'install','-r',str(previous)],timeout=90)
  result['rolled_back']=True
  raise
print(json.dumps(result,indent=2))
