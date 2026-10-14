#!/usr/bin/env python3
"""Package and sign compiled full-timeline S9+ 4K-safe Camera2 APK."""
from pathlib import Path
import json,subprocess,zipfile,hashlib,shutil,os,re
WORK=Path('/tmp/s9-joined-preroll-v1')
HOME=Path('/home/jespern/c720p-home-hub')
ORIG=HOME/'build/s9-native-security/s9-native-security.apk'
OUT=HOME/'build/s9-onphone-prepended-mp4-v1'
CERT='0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5'
def sha(b):return hashlib.sha256(b).hexdigest()
def call(args,cwd=None,timeout=85):
 p=subprocess.run(args,cwd=cwd,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError(str(args[:3])+p.stderr[-1000:])
 return p.stdout
def cert(p):
 t=call(['apksigner','verify','--print-certs',str(p)],timeout=28)
 r=re.search('certificate SHA-256 digest: ([a-f0-9]{64})',t)
 return r.group(1) if r else ''
def main():
 stage=WORK/'stage';s=json.loads((WORK/'build-result.json').read_text())
 if not s['compiled'] or cert(ORIG)!=CERT:raise RuntimeError('base_or_compilation_not_verified')
 if shutil.disk_usage(str(HOME)).free<150000000:raise RuntimeError('system_disk_too_full')
 sdk=max(Path('/usr/lib/android-sdk/platforms').glob('*/android.jar'))
 dex=stage/'dex';pkg=stage/'pkg'
 libs=sorted((pkg/'lib/arm64-v8a').glob('*.so'))
 if len(libs)<10 or not (pkg/'lib/arm64-v8a/libffmpegkit.so').is_file():
  raise RuntimeError('onphone_libs_missing')
 base={}
 with zipfile.ZipFile(ORIG) as z:
  for name in ('detect.tflite','face_embedding.tflite','labelmap.txt'):
   base[name]=sha(z.read('assets/'+name))
   if not (stage/'assets'/name).is_file() or sha((stage/'assets'/name).read_bytes())!=base[name]:
    raise RuntimeError('model_integrity_failure')
 unsigned=WORK/'unsigned.apk'
 if unsigned.exists():unsigned.unlink()
 call(['aapt','package','-f','-M',str(stage/'AndroidManifest.xml'),
   '-I',str(sdk),'-A',str(stage/'assets'),'-F',str(unsigned)])
 for file in sorted(dex.glob('classes*.dex')):
  call(['aapt','add',str(unsigned),file.name],cwd=dex)
 call(['aapt','add',str(unsigned),
   *['lib/arm64-v8a/'+f.name for f in libs]],cwd=pkg,timeout=100)
 signed=WORK/'s9-prepended-v1.apk'
 if signed.exists():signed.unlink()
 key=Path('/home/jespern/.config/s9-native-security-sign')
 call(['apksigner','sign','--ks',str(key/'key.jks'),
   '--ks-key-alias','s9security','--ks-pass','file:'+str(key/'pass'),
   '--out',str(signed),str(unsigned)],timeout=90)
 if cert(signed)!=CERT:raise RuntimeError('signer_mismatch')
 if not 15000000<signed.stat().st_size<65000000:raise RuntimeError('apk_size_invalid')
 with zipfile.ZipFile(signed) as z:
  for n,digest in base.items():
   if sha(z.read('assets/'+n))!=digest:raise RuntimeError('signed_asset_changed')
  if 'lib/arm64-v8a/libffmpegkit.so' not in z.namelist():raise RuntimeError('missing_ffmpegkit')
 OUT.mkdir(parents=True,exist_ok=True,mode=0o700)
 final=OUT/'s9-prepended-v1.apk'
 if final.exists() and sha(final.read_bytes())!=sha(signed.read_bytes()):
  raise RuntimeError('existing_output_conflict')
 if not final.exists():
  partial=OUT/'.partial-apk';shutil.copy2(signed,partial);os.replace(partial,final)
 data={'commit':s['commit'],'apk':str(final),'sha256':sha(final.read_bytes()),
  'bytes':final.stat().st_size,'signer_sha256':CERT,'model_sha256':base,
  'codec':'h264_mediacodec','join': 'onphone_ffmpegkit_720p30',
  'original_4k_preserved':True,'status':'signed_not_installed',
  'abi':'arm64-v8a','libs':len(libs)}
 (OUT/'release.json').write_text(json.dumps(data,indent=2)+'\n')
 print('S9_PREPENDED_VIDEO_APK_SIGNED_STAGED',json.dumps(data,sort_keys=True),flush=True)
if __name__=='__main__':main()
