#!/usr/bin/env python3
"""Package signed S9+ garden person v8 in tmpfs; never touch current build/APK.

Preserves original COCO and face models byte-for-byte, the native libs,
AndroidManifest, application id and signing certificate. Needs a separate
guarded cutover after successful compilation and offline gate regression.
"""
import argparse,hashlib,json,os
from pathlib import Path
import re,shutil,stat,subprocess,tempfile,urllib.request,zipfile

BASE=Path("/home/jespern/c720p-home-hub")
ORIG=BASE/"build/s9-native-security"
DEPS=BASE/"build/s9-person-ml-v1/deps"
OUT=BASE/"build/s9-person-evidence-v31"
JAVA=Path("src/nl/kalenel/s9security")
MERGE=Path('/tmp/s9-joined-preroll-v1')
BASELINE=BASE/'build/s9-onphone-prepended-mp4-v1c/s9-prepended-v1c.apk'
BASELINE_SHA='2175c265d63875340cb40eb97f5143f33f745bb949662afe263f3136a98ae3d0'
MODIFIED=["CameraService.java","ClipClassifier.java","GardenPersonTrackGate.java"]
EXPECTED_CERT="0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5"
def sha(raw):return hashlib.sha256(raw).hexdigest()
def fetch(ref,rel):
 if not re.fullmatch("[a-f0-9]{40}",ref):raise RuntimeError("untrusted_release_ref")
 with urllib.request.urlopen(f"https://raw.githubusercontent.com/JesperOaths/kale-nel/{ref}/ops/c720p/s9-native-security/{rel}",timeout=42) as r:
  raw=r.read(180000)
 if not 100<len(raw)<180000:raise RuntimeError("source_download_invalid_"+rel)
 return raw
def run(args,timeout=110,cwd=None):
 result=subprocess.run(args,cwd=cwd,capture_output=True,text=True,timeout=timeout)
 if result.returncode:
  raise RuntimeError("build_step_failed:"+str(args[:2])+" "+result.stderr[-950:]+result.stdout[-400:])
 return result.stdout.strip()
def cert(apk):
 txt=run(["apksigner","verify","--print-certs",str(apk)],25)
 m=re.search(r"certificate SHA-256 digest: ([a-f0-9]{64})",txt)
 return m.group(1) if m else ""
def source(ref,path):
 raw=fetch(ref,str(JAVA/path))
 if path=="CameraService.java" and b"garden_person_sentinel_checks" not in raw:
  raise RuntimeError("v8_sentinel_source_missing")
 if path=="ClipClassifier.java" and b"detectGardenPeopleMultiscale" not in raw:
  raise RuntimeError("v8_garden_tile_source_missing")
 return raw
def main():
 arg=argparse.ArgumentParser();arg.add_argument("--commit",required=True);arg.add_argument("--sources",type=Path,required=True);opts=arg.parse_args()
 if not re.fullmatch("[a-f0-9]{40}",opts.commit):raise RuntimeError("bad_commit")
 # Compilation runs in tmpfs. Persistent growth is a single <=20 MiB APK;
 # retain >=170 MiB after packaging plus the separate cutover's backup guard.
 if shutil.disk_usage(str(BASE)).free<190*1024*1024:
  raise RuntimeError("hub_root_disk_too_full_for_safe_signed_artifact")
 if shutil.disk_usage("/tmp").free<400*1024*1024:
  raise RuntimeError("temporary_ramdisk_too_small")
 if not (ORIG/"s9-native-security.apk").is_file():raise RuntimeError("original_apk_missing")
 originalCert=cert(ORIG/"s9-native-security.apk")
 if originalCert!=EXPECTED_CERT:raise RuntimeError("signer_does_not_match_deployed_baseline")
 androids=sorted(Path("/usr/lib/android-sdk/platforms").glob("*/android.jar"))
 if not androids:raise RuntimeError("android_sdk_missing")
 sdk=androids[-1]
 jars=[DEPS/(name+".jar") for name in ["tensorflow-lite","tensorflow-lite-api",
                                    "tensorflow-lite-gpu","tensorflow-lite-gpu-api"]]
 jars += [MERGE/'kit-classes.jar',MERGE/'exceptions.jar']
 if any(not f.is_file() for f in jars):raise RuntimeError("TFLite_dependency_missing")
 if not BASELINE.is_file() or sha(BASELINE.read_bytes())!=BASELINE_SHA or cert(BASELINE)!=EXPECTED_CERT:
  raise RuntimeError('verified_complete_video_baseline_missing')
 with zipfile.ZipFile(BASELINE) as baseline:
  retained={n:sha(baseline.read(n)) for n in baseline.namelist()
            if n.startswith('lib/') or n in ('AndroidManifest.xml','classes2.dex')}
  if len(retained)<14:raise RuntimeError('complete_video_native_libraries_missing')
  if sha(baseline.read('classes2.dex'))!='da1ce6d5f025a01f6883474480b80fa65dd0eb51c5d222df8a760a611858be71':
   raise RuntimeError('support_dex_changed')
 assets=("detect.tflite","face_embedding.tflite","labelmap.txt")
 with zipfile.ZipFile(ORIG/"s9-native-security.apk") as original:
  assetHashes={}
  for name in assets:
   data=original.read("assets/"+name)
   file=ORIG/"assets"/name
   if not file.is_file() or sha(data)!=sha(file.read_bytes()):
    raise RuntimeError("installed_asset_snapshot_mismatch_"+name)
   assetHashes[name]=sha(data)
 key=Path("/home/jespern/.config/s9-native-security-sign")
 if not (key/"key.jks").is_file() or not (key/"pass").is_file():
  raise RuntimeError("existing_signing_key_missing")
 if not (OUT.exists() is False or OUT.is_dir()):raise RuntimeError("output_unsafe")
 # Download only changed classes once, pinned to the PR commit.
 changed={p.name:p.read_bytes() for p in (opts.sources/JAVA).glob("*.java")}
 if not {"PersonPoseReview.java","PersonMotionMetrics.java","S9FaceGeometry.java"}.issubset(changed):raise RuntimeError("v31_sources_missing")
 attestation=json.loads((opts.sources/"source-sha256.json").read_text())
 for name,body in changed.items():
  if sha(body)!=attestation[str(JAVA/name)]:raise RuntimeError("source_sha_mismatch_"+name)
 tests=(opts.sources/"tests/GardenPersonTrackGateTest.java").read_bytes()
 with tempfile.TemporaryDirectory(prefix="s9-person-v8-build-",dir="/tmp") as td:
  stage=Path(td)/"native"
  shutil.copytree(ORIG,stage)
  for name,body in changed.items():
   (stage/JAVA/name).write_bytes(body)
  (stage/".source-commit").write_text(opts.commit+"\n")
  for name in ("person_pose.tflite","person_pose.sha256"):
   shutil.copy2(Path("/tmp/s9-pose-v31-model")/name,stage/"assets"/name)
  if sha((stage/"assets/person_pose.tflite").read_bytes())!="cd7cc22fa946e5d146a7b98d496853e1923e22828d3972d579973f27f91bb105":raise RuntimeError("pose_model_sha_mismatch")
  classes=stage/"classes"
  shutil.rmtree(classes);classes.mkdir()
  classpath=os.pathsep.join(map(str,[sdk,*jars,MERGE/'exceptions-common.jar']))
  run(["javac","-source","8","-target","8","-cp",classpath,
       "-d",str(classes),*map(str,sorted((stage/JAVA).glob("*.java")))],125)
  for name in MODIFIED:
   if not (classes/"nl/kalenel/s9security"/name.replace(".java",".class")).is_file():
    raise RuntimeError("missing_new_compiled_class_"+name)
  testFile=Path(td)/"GardenPersonTrackGateTest.java";testFile.write_bytes(tests)
  run(["javac","-source","8","-target","8","-cp",str(classes),
       "-d",str(classes),str(testFile)],40)
  tested=run(["java","-cp",str(classes),"nl.kalenel.s9security.GardenPersonTrackGateTest"],40)
  if "S9_HYBRID_PERSON_GATE_V8_PASS" not in tested:
   raise RuntimeError("gate_unit_test_invalid")
  poseTest=Path(td)/"PersonMotionMetricsTest.java";poseTest.write_bytes((opts.sources/"tests/PersonMotionMetricsTest.java").read_bytes())
  run(["javac","-source","8","-target","8","-cp",str(classes),"-d",str(classes),str(poseTest)],40)
  poseTested=run(["java","-cp",str(classes),"nl.kalenel.s9security.PersonMotionMetricsTest"],40)
  print(poseTested,flush=True)
  (stage/".compiled-commit").write_text(opts.commit+"\n")
  # The two model files and saved face classifier are exactly those already
  # verified from the signed production APK; never replace with new downloads.
  for name,expected in assetHashes.items():
   if sha((stage/"assets"/name).read_bytes())!=expected:
    raise RuntimeError("model_asset_mutated_"+name)
  dex=stage/"dex";dex.mkdir(exist_ok=True)
  (dex/"classes.dex").unlink(missing_ok=True)
  run(["d8","--min-api","26","--lib",str(sdk),"--output",str(dex),
       *map(str,sorted((classes/"nl/kalenel/s9security").glob("*.class"))),
       *map(str,jars)],150)
  if not (dex/"classes.dex").is_file():raise RuntimeError("dex_missing")
  unsigned=stage/"unsigned.apk"
  with zipfile.ZipFile(BASELINE) as baseline,zipfile.ZipFile(unsigned,'w') as output:
   for member in baseline.infolist():
    if member.filename.startswith('META-INF/'):continue
    output.writestr(member,(dex/'classes.dex').read_bytes() if member.filename=='classes.dex' else baseline.read(member.filename))
   for name in ('person_pose.tflite','person_pose.sha256'):
    output.write(stage/'assets'/name,'assets/'+name)
  aligned=stage/'aligned.apk'
  run(['zipalign','-f','4',str(unsigned),str(aligned)],60)
  signed=Path(td)/"s9-person-evidence-v31.apk"
  run(["apksigner","sign","--ks",str(key/"key.jks"),
       "--ks-key-alias","s9security","--ks-pass","file:"+str(key/"pass"),
       "--out",str(signed),str(aligned)],85)
  if cert(signed)!=EXPECTED_CERT:raise RuntimeError("apk_signing_identity_changed")
  if not 18*1024*1024<signed.stat().st_size<28*1024*1024:
   raise RuntimeError("apk_bad_size")
  with zipfile.ZipFile(signed) as z:
   for name,expected in assetHashes.items():
    if sha(z.read("assets/"+name))!=expected:
     raise RuntimeError("signed_asset_does_not_match_"+name)
   if len(z.read("classes.dex"))<20000:raise RuntimeError("empty_dex")
   if any(sha(z.read(n))!=expected for n,expected in retained.items()):
    raise RuntimeError('complete_video_support_asset_changed')
   if not all(marker in z.read('classes.dex') for marker in (b'archive_recovery_queued',b'person_evidence_version',b'preroll_prepend_halted_after_failures')):
    raise RuntimeError('combined_release_features_missing')
  # An atomic 10MB artifact is the only persistent new build; never modify
  # current 4K camera binaries, model files or production source tree.
  OUT.mkdir(mode=0o700,parents=True,exist_ok=True)
  dst=OUT/("s9-person-evidence-v31-"+opts.commit[:12]+".apk")
  if dst.exists():
   if sha(dst.read_bytes())!=sha(signed.read_bytes()):
    raise RuntimeError("existing_signed_artifact_differs")
  else:
   tmp=OUT/".s9-person-evidence-v31.apk.partial"
   shutil.copy2(signed,tmp)
   if sha(tmp.read_bytes())!=sha(signed.read_bytes()):raise RuntimeError("copy_hash_mismatch")
   os.replace(tmp,dst)
  meta={"commit":opts.commit,"apk":str(dst),"sha256":sha(dst.read_bytes()),
        "bytes":dst.stat().st_size,"signer_sha256":EXPECTED_CERT,
        "model_sha256":assetHashes,"java_test":tested,"complete_video_baseline_sha256":BASELINE_SHA,"retained_native_and_support_sha256":retained,
        "pose_model_sha256":"cd7cc22fa946e5d146a7b98d496853e1923e22828d3972d579973f27f91bb105","pose_test":poseTested,"source_sha256":attestation,"install_performed":False,"staged_original_apk_unchanged":True}
  manifest=OUT/"release.json";manifest.write_text(json.dumps(meta,indent=2)+"\n")
  os.chmod(dst,0o600);os.chmod(manifest,0o600)
  print("PERSON_EVIDENCE_V31_SIGNED_STAGED",json.dumps(meta,sort_keys=True),flush=True)
if __name__=="__main__":main()
