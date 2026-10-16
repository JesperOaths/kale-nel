"""Run exact release temporal/queue classes on the physical S9+; no camera data."""
import hashlib,json,subprocess,sys,tempfile,zipfile,os
from pathlib import Path
def run(args):
 result=subprocess.run(args,check=True,capture_output=True,text=True,timeout=120);print(result.stdout.strip(),flush=True);return result.stdout
def main(stage):
 src=stage/'src/nl/kalenel/s9security'
 release=json.loads(Path('/tmp/s9-night-detection-v41/release.json').read_text())
 names=('AnonymousClipTracks.java','ClipReviewSchedule.java','VisualReviewQueue.java','GardenPersonTrackGate.java','GardenCandidateBank.java','NightPersonGate.java','NightScenePolicy.java')
 for name in names:assert hashlib.sha256((src/name).read_bytes()).hexdigest()==release['sources'][name]
 android=max(Path('/usr/lib/android-sdk/platforms').glob('*/android.jar'))
 tests=('VisualTrackCountTest','AnonymousClipTracksTest','TemporalReviewTest','VisualReviewQueueDeviceTest','DetectionReviewV38Test','SmallPeopleV39Test','GardenPersonTrackGateTest','NightDetectionV41Test')
 with tempfile.TemporaryDirectory(dir='/tmp',prefix='temporal-device-tests-') as scratch:
  directory=Path(scratch);classes=directory/'classes';classes.mkdir();dex=directory/'dex';dex.mkdir()
  run(['javac','-source','8','-target','8','-cp',str(android),'-d',str(classes),*[str(src/name) for name in names],*[str(stage/(name+'.java')) for name in tests]])
  run(['d8','--min-api','26','--lib',str(android),'--output',str(dex),*map(str,classes.rglob('*.class'))])
  jar=directory/'tests.jar'
  with zipfile.ZipFile(jar,'w') as archive:
   for path in dex.glob('classes*.dex'):archive.write(path,path.name)
  phone='192.168.178.250:5555';target='/data/local/tmp/s9-night-detection-v41-tests.jar'
  run(['adb','-s',phone,'push',str(jar),target])
  try:
   for name in tests:run(['adb','-s',phone,'shell','CLASSPATH='+target,'app_process','/system/bin','nl.kalenel.s9security.'+name])
  finally:run(['adb','-s',phone,'shell','rm',target])
if __name__=='__main__':main(Path(sys.argv[1]))
