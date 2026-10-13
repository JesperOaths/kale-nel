#!/usr/bin/env python3
"""Stage Android source and compile on-phone S9 complete-video encoder in RAM."""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,urllib.request,zipfile,sys
C=Path('/home/jespern/c720p-home-hub')
ORIG=C/'build/s9-native-security';ROOT=Path('/tmp/s9-joined-preroll-v1')
JAVA=Path('src/nl/kalenel/s9security')
NAMES=['GardenJoinedClip.java','CameraService.java','GardenPreRoll.java','PhoneMediaRange.java','ClipClassifier.java','GardenPersonTrackGate.java']
AAR='dev/ffmpegkit-maintained/ffmpeg-kit-min/8.1.9/ffmpeg-kit-min-8.1.9.aar'
SMART='com/arthenica/smart-exception-java/0.2.1/smart-exception-java-0.2.1.jar'
EXPECTED='bfbdb3fcc53c0583e08624ab1560309d936745fe63e965715017a764aaabdc6f'
def sha(b):return hashlib.sha256(b).hexdigest()
def run(args,timeout=180):
 x=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if x.returncode:raise RuntimeError(str(args[:3])+x.stderr[-900:]+x.stdout[-300:])
 return x.stdout
def get(url,limit):
 with urllib.request.urlopen(url,timeout=90) as r:b=r.read(limit+1)
 if len(b)>limit:raise RuntimeError('response_too_large')
 return b
def main():
 commit=sys.argv[1]
 if not re.fullmatch('[a-f0-9]{40}',commit):raise RuntimeError('commit_not_pinned')
 sdk=max(Path('/usr/lib/android-sdk/platforms').glob('*/android.jar'))
 deps=C/'build/s9-person-ml-v1/deps'
 jars=[deps/(x+'.jar') for x in ('tensorflow-lite','tensorflow-lite-api','tensorflow-lite-gpu','tensorflow-lite-gpu-api')]
 if any(not x.is_file() for x in jars):raise RuntimeError('tflite_missing')
 ROOT.mkdir(mode=0o700,exist_ok=True)
 stage=ROOT/'stage'
 if stage.exists():shutil.rmtree(stage)
 shutil.copytree(ORIG,stage)
 for name in NAMES:
  p=JAVA/name
  data=get('https://raw.githubusercontent.com/JesperOaths/kale-nel/'+commit+'/ops/c720p/s9-native-security/'+str(p),150000)
  (stage/p).write_bytes(data)
 ffaar=ROOT/'kit.aar';smart=ROOT/'exceptions.jar'
 if not ffaar.is_file():ffaar.write_bytes(get('https://repo.maven.apache.org/maven2/'+AAR,24000000))
 if sha(ffaar.read_bytes())!=EXPECTED:raise RuntimeError('ffmpegkit_sha_invalid')
 if not smart.is_file():smart.write_bytes(get('https://repo.maven.apache.org/maven2/'+SMART,100000))
 if sha(smart.read_bytes())!='5b96aaa5f191dedbef72fb0c38f1a2b01807920afc0d92a75a2acd6e0cc7703c':
  raise RuntimeError('smart_java_integrity')
 with zipfile.ZipFile(ffaar) as archive:
  (ROOT/'kit-classes.jar').write_bytes(archive.read('classes.jar'))
  libs=[n for n in archive.namelist() if n.startswith('jni/arm64-v8a/') and n.endswith('.so')]
  pkg=stage/'pkg/lib/arm64-v8a';pkg.mkdir(parents=True,exist_ok=True)
  for n in libs:(pkg/Path(n).name).write_bytes(archive.read(n))
 classes=stage/'classes'
 if classes.exists():shutil.rmtree(classes)
 classes.mkdir()
 src=sorted((stage/JAVA).glob('*.java'))
 cp=os.pathsep.join(map(str,[sdk,*jars,ROOT/'kit-classes.jar',smart]))
 run(['javac','-source','8','-target','8','-cp',cp,'-d',str(classes),*map(str,src)],180)
 if not (classes/'nl/kalenel/s9security/GardenJoinedClip.class').is_file():
  raise RuntimeError('joiner_not_compiled')
 dex=stage/'dex'
 if dex.exists():shutil.rmtree(dex)
 dex.mkdir()
 run(['d8','--min-api','26','--lib',str(sdk),'--output',str(dex),
      *map(str,classes.rglob('*.class')),
      *map(str,[*jars,ROOT/'kit-classes.jar',smart])],240)
 manifest=ROOT/'build-result.json'
 manifest.write_text(json.dumps({'commit':commit,'java_sources':len(src),
  'libs':len(libs),'dexes':len(list(dex.glob('classes*.dex'))),'compiled':True}))
 print('S9_PREROLL_JOIN_JAVA_AND_DEX_COMPILED',manifest.read_text(),flush=True)
if __name__=='__main__':main()
