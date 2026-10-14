#!/usr/bin/env python3
from pathlib import Path
import hashlib,json,os,shutil,subprocess,zipfile
H=Path('/home/jespern/c720p-home-hub')
W=Path('/tmp/s9-joined-preroll-v1')
T=H/'build/s9-onphone-prepended-mp4-v1b'
CERT='0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5'
def sha(b):return hashlib.sha256(b).hexdigest()
def run(a,cwd=None,timeout=85):
 p=subprocess.run(a,cwd=cwd,text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError(str(a[:3])+p.stderr[-850:])
 return p.stdout
def main():
 src=W/'unsigned.apk';j=W/'exceptions-common.jar'
 if not src.is_file() or sha(j.read_bytes())!='1cad0fb4dfa01755a014331b5ed199281d2c3fab5aca5c9d7abd0b41d0ec3f7b':
  raise RuntimeError('missing_pinned_dependency_or_base')
 with zipfile.ZipFile(src) as z:
  orig=sha(z.read('classes.dex'))
  models={n:sha(z.read('assets/'+n)) for n in ('detect.tflite','face_embedding.tflite','labelmap.txt')}
  if 'classes2.dex' in z.namelist():raise RuntimeError('already_inserted')
 dex=W/'common-dex';dex.mkdir(exist_ok=True)
 sdk=max(Path('/usr/lib/android-sdk/platforms').glob('*/android.jar'))
 run(['d8','--min-api','26','--lib',str(sdk),'--output',str(dex),str(j)])
 (dex/'classes.dex').rename(dex/'classes2.dex')
 unsigned=W/'unsigned-v1b.apk';shutil.copy2(src,unsigned)
 run(['aapt','add',str(unsigned),'classes2.dex'],cwd=dex)
 key=Path('/home/jespern/.config/s9-native-security-sign')
 signed=W/'signed-v1b.apk'
 run(['apksigner','sign','--ks',str(key/'key.jks'),'--ks-key-alias','s9security',
      '--ks-pass','file:'+str(key/'pass'),'--out',str(signed),str(unsigned)])
 if CERT not in run(['apksigner','verify','--print-certs',str(signed)]):raise RuntimeError('signer_changed')
 with zipfile.ZipFile(signed) as z:
  if sha(z.read('classes.dex'))!=orig or len(z.read('classes2.dex'))<3000:raise RuntimeError('dex_corrupt')
  if any(sha(z.read('assets/'+n))!=v for n,v in models.items()):raise RuntimeError('model_changed')
 T.mkdir(mode=0o700,parents=True,exist_ok=True)
 target=T/'s9-prepended-v1b.apk'
 if target.exists() and sha(target.read_bytes())!=sha(signed.read_bytes()):raise RuntimeError('existing_artifact_differs')
 if not target.exists():
  tmp=T/'.partial';shutil.copy2(signed,tmp);os.replace(tmp,target)
 details={'apk':str(target),'sha256':sha(target.read_bytes()),'signer_sha256':CERT,
  'model_sha256':models,'bytes':target.stat().st_size,'status':'signed_not_installed'}
 (T/'release.json').write_text(json.dumps(details,indent=2)+'\n')
 print('FFMPEGKIT_RUNTIME_DEX_FIX_SIGNED',json.dumps(details,sort_keys=True),flush=True)
if __name__=='__main__':main()
