"""Restore existing LiteRT libraries and checksum-pinned public OpenCV models."""
import hashlib,json,os,tarfile,tempfile,urllib.request
from pathlib import Path
BASE=Path('/home/jespern/c720p-home-hub');ROOT=Path('/tmp/people-v33-runtime')
MODELS={'yunet.onnx':('face_detection_yunet/face_detection_yunet_2023mar.onnx',232589,'8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'),
 'reid.onnx':('person_reid_youtureid/person_reid_youtu_2021nov.onnx',106878407,'0579683334d4b9440221606dcb461656dd0dc64143b18f48faedaced9b4f580d')}
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as source:
  while chunk:=source.read(1048576):h.update(chunk)
 return h.hexdigest()
def main():
 ROOT.mkdir(mode=0o700,exist_ok=True)
 library=ROOT/'venv/lib/python3.13/site-packages'
 if not (library/'ai_edge_litert').exists():
  archive=Path('/tmp/s9-v31-benchmark-cache-backup/benchmark-venv.tar.gz')
  assert digest(archive)=='0c4204d5da8225771542286f7d2899380eb6d99fafa907230cee058bc6332484'
  with tarfile.open(archive) as tar:
   members=[m for m in tar if m.name.startswith('venv/lib/python3.13/site-packages/') and (m.isfile() or m.isdir())]
   for member in members:assert (ROOT/member.name).resolve().is_relative_to(ROOT.resolve())
   tar.extractall(ROOT,members=members,filter='data')
 for name,(remote,size,expected) in MODELS.items():
  path=ROOT/name
  if path.exists() and path.stat().st_size==size and digest(path)==expected:continue
  fd,tmp=tempfile.mkstemp(dir=ROOT,prefix='.public-model-');written=0;h=hashlib.sha256()
  try:
   with os.fdopen(fd,'wb') as out,urllib.request.urlopen('https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/'+remote,timeout=45) as response:
    while chunk:=response.read(1048576):
     written+=len(chunk);assert written<=size;h.update(chunk);out.write(chunk)
    out.flush();os.fsync(out.fileno())
   assert written==size and h.hexdigest()==expected
   os.chmod(tmp,0o600);os.replace(tmp,path)
  finally:
   if os.path.exists(tmp):os.unlink(tmp)
  print('PUBLIC_MODEL_VERIFIED',name,flush=True)
 paths={'detector':BASE/'person-detector/model/yolov5n-v7.0.onnx','face_embedding':BASE/'build/s9-face-model-evaluation/face_embedding.tflite','pose':Path('/tmp/s9-pose-v31-model/person_pose.tflite'),**{k:ROOT/k for k in MODELS}}
 manifest={name:{'path':str(path),'sha256':digest(path)} for name,path in paths.items()}
 assert manifest['pose']['sha256']=='cd7cc22fa946e5d146a7b98d496853e1923e22828d3972d579973f27f91bb105'
 (ROOT/'models.json').write_text(json.dumps(manifest,indent=2));os.chmod(ROOT/'models.json',0o600)
 print('VERIFIED_PEOPLE_RUNTIME_READY',flush=True)
if __name__=='__main__':main()
