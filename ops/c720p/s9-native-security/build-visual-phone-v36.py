"""Build only; preserve the exact unified-v11 recorder, manifest and model assets."""
from pathlib import Path
import argparse,hashlib,io,json,os,shutil,subprocess,tempfile,urllib.request,zipfile
BASE=Path('/home/jespern/c720p-home-hub')
BASE_APK=BASE/'build/s9-unified-4k-person-v11/s9-unified-4k-person-v11.apk'
BASE_SHA='096b01e69bf0bd6a7c14391403bf6dac2f413eea5151f747ac5a678db18a9451'
CERT='0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5'
def sha(blob):return hashlib.sha256(blob).hexdigest()
def run(args,timeout=180):
 p=subprocess.run(args,text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError(p.stderr[-4000:]+p.stdout[-1200:])
 return p.stdout
def build(stage):
 if sha(BASE_APK.read_bytes())!=BASE_SHA:raise RuntimeError('baseline_changed')
 if shutil.disk_usage(BASE).free<210*1024**2 or shutil.disk_usage('/tmp').free<500*1024**2:raise RuntimeError('insufficient_rollback_and_build_space')
 proof=json.loads((stage/'source-sha256.json').read_text());src=stage/'src/nl/kalenel/s9security'
 for name,digest in proof.items():
  if sha((src/name).read_bytes())!=digest:raise RuntimeError('source_changed')
 android=max(Path('/usr/lib/android-sdk/platforms').glob('*/android.jar'))
 key=Path('/home/jespern/.config/s9-native-security-sign')
 expected=json.loads((BASE/'build/s9-unified-4k-person-v11/release.json').read_text())['tensorflow_dependencies']
 with tempfile.TemporaryDirectory(dir='/tmp',prefix='s9-visual-v36-') as temp:
  scratch=Path(temp);jars=[]
  from concurrent.futures import ThreadPoolExecutor
  def dependency(part):
   receipt=expected[part];jar=stage/(part+'.jar')
   if jar.exists() and sha(jar.read_bytes())==receipt['classes_jar_sha256']:return jar
   with urllib.request.urlopen('https://repo.maven.apache.org/maven2/org/tensorflow/'+part+'/2.14.0/'+part+'-2.14.0.aar',timeout=40) as response:aar=response.read(16000001)
   if sha(aar)!=receipt['sha256']:raise RuntimeError('dependency_digest_changed')
   raw=zipfile.ZipFile(io.BytesIO(aar)).read('classes.jar')
   if sha(raw)!=receipt['classes_jar_sha256']:raise RuntimeError('dependency_classes_changed')
   jar.write_bytes(raw);return jar
  with ThreadPoolExecutor(max_workers=4) as pool:jars=list(pool.map(dependency,expected))
  classes=scratch/'classes';classes.mkdir();cp=os.pathsep.join(map(str,[android,*jars]))
  run(['javac','-source','8','-target','8','-cp',cp,'-d',str(classes),*map(str,src.glob('*.java'))])
  testclasses=scratch/'testclasses';testclasses.mkdir()
  run(['javac','-source','8','-target','8','-cp',str(classes),'-d',str(testclasses),str(stage/'VisualTrackCountTest.java'),str(stage/'AnonymousClipTracksTest.java')])
  checks=[]
  for name in ('VisualTrackCountTest','AnonymousClipTracksTest'):
   result=run(['java','-cp',os.pathsep.join(map(str,[classes,testclasses])),'nl.kalenel.s9security.'+name]);print(result,flush=True);checks.append(result.strip())
  dex=scratch/'dex';dex.mkdir()
  run(['d8','--min-api','26','--lib',str(android),'--output',str(dex),*map(str,classes.rglob('*.class')),*map(str,jars)],240)
  unsigned=scratch/'unsigned.apk';retained={}
  with zipfile.ZipFile(BASE_APK) as old,zipfile.ZipFile(unsigned,'w') as new:
   for member in old.infolist():
    name=member.filename
    if name.startswith('META-INF/') or name.startswith('classes') and name.endswith('.dex'):continue
    raw=old.read(name);new.writestr(member,raw);retained[name]=sha(raw)
   for p in dex.glob('classes*.dex'):new.writestr(p.name,p.read_bytes())
  aligned=scratch/'aligned.apk';run(['zipalign','-f','4',str(unsigned),str(aligned)])
  signed=scratch/'signed.apk';run(['apksigner','sign','--ks',str(key/'key.jks'),'--ks-key-alias','s9security','--ks-pass','file:'+str(key/'pass'),'--out',str(signed),str(aligned)])
  if CERT not in run(['apksigner','verify','--print-certs',str(signed)]):raise RuntimeError('signer_changed')
  with zipfile.ZipFile(signed) as apk:
   if any(sha(apk.read(n))!=v for n,v in retained.items()):raise RuntimeError('asset_or_manifest_changed')
  out=BASE/'build/s9-visual-attributes-v36';out.mkdir(mode=0o700,exist_ok=True)
  dest=out/'s9-visual-attributes-v36.apk';shutil.copy2(signed,dest)
  receipt={'apk':str(dest),'sha256':sha(dest.read_bytes()),'baseline_sha256':BASE_SHA,'signer':CERT,'sources':proof,
   'recorder_base_source':'ae547c163909940047a74fcada4a367a0cb972e1','assets_manifest_libraries_unchanged':True,
   'identity_matching':False,'checks':checks,'installed':False,
   'allowed_installed_sha256':[BASE_SHA,'db7141cd22e756549ae77120bfcbb60c42ba381ab49ed84d8a3a452e7693d3d5']}
  (out/'release.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({k:v for k,v in receipt.items() if k!='sources'}),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('stage',type=Path);build(p.parse_args().stage)
