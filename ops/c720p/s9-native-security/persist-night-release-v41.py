"""Preserve compact durable release receipts; APK and rollback also retained by operator."""
from pathlib import Path
import hashlib,json,shutil,zipfile
base=Path('/home/jespern/c720p-home-hub');scratch=Path('/tmp/s9-night-detection-v41')
release=json.loads((scratch/'release.json').read_text());deployment=json.loads((scratch/'deployment.json').read_text())
assert release['sha256']==deployment['apk_sha256']=='cb46726931e46cd40088188d05828f0ac1e8f15cc68f3ab6077c12e5b14ce1bf'
assert hashlib.sha256(Path(deployment['rollback']).read_bytes()).hexdigest()==deployment['baseline_sha256']
assert hashlib.sha256(Path(release['apk']).read_bytes()).hexdigest()==release['sha256']
out=base/'build/s9-night-detection-v41';out.mkdir(mode=0o700,parents=True,exist_ok=True)
for name in ('release.json','deployment.json'):shutil.copy2(scratch/name,out/name)
proof=json.loads(Path('/tmp/night-phone-v41-stage/source-sha256.json').read_text());assert proof==release['sources']
shutil.copy2('/tmp/night-phone-v41-stage/source-sha256.json',out/'source-sha256.json')
stage=Path('/tmp/night-phone-v41-stage');src=stage/'src/nl/kalenel/s9security'
archive=out/'exact-release-source.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for name,digest in proof.items():
  p=src/name;assert hashlib.sha256(p.read_bytes()).hexdigest()==digest;z.write(p,p.relative_to(stage))
 for p in [stage/'source-sha256.json',*stage.glob('*Test.java'),*stage.glob('*.py')]:z.write(p,p.relative_to(stage))
(out/'source-archive.json').write_text(json.dumps({'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'file':str(archive),'sources':len(proof)},indent=2))
print(json.dumps({'durable_receipts':str(out),'rollback_sha256':deployment['baseline_sha256'],'installed_sha256':release['sha256']}))
