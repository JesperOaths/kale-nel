"""Fetch the pinned public MoveNet asset into the isolated staging area only."""
import hashlib,json,os,tempfile,urllib.request
from pathlib import Path
SOURCE='https://tfhub.dev/google/lite-model/movenet/singlepose/lightning/tflite/int8/4?lite-format=tflite'
EXPECTED='cd7cc22fa946e5d146a7b98d496853e1923e22828d3972d579973f27f91bb105'
OUT=Path('/tmp/s9-pose-v31-model')
def main():
 OUT.mkdir(mode=0o700,parents=True,exist_ok=True)
 with urllib.request.urlopen(SOURCE,timeout=60) as r:raw=r.read(10000001)
 if len(raw)!=2894840 or raw[4:8]!=b'TFL3' or hashlib.sha256(raw).hexdigest()!=EXPECTED:raise RuntimeError('unexpected_model_bytes')
 fd,tmp=tempfile.mkstemp(dir=OUT,prefix='.pose-')
 try:
  with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
  os.replace(tmp,OUT/'person_pose.tflite')
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
 (OUT/'person_pose.sha256').write_text(EXPECTED+'\n')
 (OUT/'source.json').write_text(json.dumps({'source':SOURCE,'sha256':EXPECTED,'bytes':len(raw),'purpose':'offline_projected_pose_measurements_not_identity'},indent=2)+'\n')
 print('PINNED_POSE_MODEL_STAGED',EXPECTED)
if __name__=='__main__':main()
