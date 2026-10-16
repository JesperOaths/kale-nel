"""Reproduce the exact night release from the verified v11 source, never the working recorder."""
import argparse,hashlib,importlib.util,json,shutil,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent
TESTS=('VisualTrackCountTest','AnonymousClipTracksTest','TemporalReviewTest','DetectionReviewV38Test','SmallPeopleV39Test','VisualReviewQueueDeviceTest','GardenPersonTrackGateTest','NightDetectionV41Test')
def stage(destination):
 src=destination/'src/nl/kalenel/s9security';src.mkdir(parents=True,exist_ok=False)
 baseline=json.loads((HERE/'visual-phone-v36-base-sources.json').read_text())
 for name,digest in baseline['sources'].items():
  raw=subprocess.check_output(['git','show',baseline['ref']+':ops/c720p/s9-native-security/src/nl/kalenel/s9security/'+name],cwd=HERE)
  assert hashlib.sha256(raw).hexdigest()==digest,'baseline_source_changed'
  (src/name).write_bytes(raw)
 spec=importlib.util.spec_from_file_location('night',HERE/'prepare-night-phone-v41.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.prepare(destination)
 for name in TESTS:shutil.copy2(HERE/'tests'/f'{name}.java',destination/f'{name}.java')
 for name in ('build-night-phone-v41.py','deploy-night-phone-v41.py','verify-night-device-tests-v41.py'):shutil.copy2(HERE/name,destination/name)
 proof=json.loads((destination/'source-sha256.json').read_text());assert len(proof)==28
 for name in ('Continuous4KEncoder.java','Encoded4KRing.java'):
  assert proof[name]==baseline['sources'][name],'recorder_changed'
 print(json.dumps({'fresh_sources':len(proof),'recorder_unchanged':True,'test_suites':len(TESTS)}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('destination',type=Path);stage(p.parse_args().destination)
