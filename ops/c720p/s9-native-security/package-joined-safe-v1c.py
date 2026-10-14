#!/usr/bin/env python3
"""Build S9+ joined pre-motion video v1c, preserving prior verified APK assets.

Replace the existing primary dex only; preserve the pinned verified smart-common
secondary dex, models, manifest, and ARM64 JNI libraries. Never install here.
"""
from pathlib import Path
import hashlib,io,json,os,shutil,subprocess,tempfile,zipfile
HOME=Path("/home/jespern/c720p-home-hub")
W=Path("/tmp/s9-joined-preroll-v1")
INPUT=HOME/"build/s9-onphone-prepended-mp4-v1b/s9-prepended-v1b.apk"
PROOF=W/"javac-proof"
TARGET=HOME/"build/s9-onphone-prepended-mp4-v1c"
KEY=Path("/home/jespern/.config/s9-native-security-sign")
SIGNER="0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5"
VERSION="s9_onphone_event_prepend_transcode_v1"
def sha(data):return hashlib.sha256(data).hexdigest()
def run(a,timeout=180):
 p=subprocess.run(a,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError("failed "+str(a[:4])+" "+p.stderr[-1700:])
 return p.stdout
def verify_cert(p):
 out=run(["apksigner","verify","--print-certs",str(p)],timeout=25)
 if SIGNER not in out:raise RuntimeError("signer_changed")
def main():
 if not INPUT.is_file() or not (PROOF/"nl/kalenel/s9security/GardenJoinedClip.class").is_file():
  raise RuntimeError("prior_verified_artifact_or_compiled_classes_missing")
 verify_cert(INPUT)
 with zipfile.ZipFile(INPUT) as z:
  priorDex=sha(z.read("classes.dex"))
  previousSecond=sha(z.read("classes2.dex"))
  originals={n:sha(z.read("assets/"+n)) for n in ("detect.tflite","face_embedding.tflite","labelmap.txt")}
  originalMeta={n:sha(z.read(n)) for n in z.namelist() if n.startswith("lib/arm64-v8a/") or n=="AndroidManifest.xml"}
 if len(originalMeta)<10:raise RuntimeError("baseline_jni_contract_missing")
 SDK=max(Path("/usr/lib/android-sdk/platforms").glob("*/android.jar"))
 DEPS=HOME/"build/s9-person-ml-v1/deps"
 libs=[DEPS/(n+".jar") for n in ("tensorflow-lite","tensorflow-lite-api","tensorflow-lite-gpu","tensorflow-lite-gpu-api")]
 libs += [W/"kit-classes.jar",W/"exceptions.jar"]
 if any(not f.is_file() for f in libs):raise RuntimeError("missing_pinned_jar")
 dexdir=W/"v1c-dex";dexdir.mkdir(exist_ok=True)
 for f in dexdir.glob("*.dex"):f.unlink()
 args=["d8","--min-api","26","--lib",str(SDK),"--output",str(dexdir),
       *map(str,PROOF.rglob("*.class")),*map(str,libs)]
 run(args,timeout=330)
 dexes=sorted(dexdir.glob("classes*.dex"))
 if len(dexes)!=1 or dexes[0].stat().st_size<200000:raise RuntimeError("unexpected_dex_outputs")
 newDex=dexes[0].read_bytes()
 with tempfile.TemporaryDirectory(prefix="s9-prepended-v1c-",dir="/tmp") as folder:
  temp=Path(folder)
  altered=temp/"unsigned.apk"
  with zipfile.ZipFile(INPUT) as original,zipfile.ZipFile(altered,"w") as output:
   for member in original.infolist():
    if member.filename.startswith("META-INF/") and (
     member.filename.endswith((".SF",".RSA",".DSA",".EC")) or
     member.filename=="MANIFEST.MF"):
     continue
    data=newDex if member.filename=="classes.dex" else original.read(member.filename)
    output.writestr(member,data)
  aligned=temp/"aligned.apk"
  run(["zipalign","-f","4",str(altered),str(aligned)],timeout=60)
  signed=temp/"signed.apk"
  run(["apksigner","sign","--ks",str(KEY/"key.jks"),
    "--ks-key-alias","s9security","--ks-pass","file:"+str(KEY/"pass"),
    "--out",str(signed),str(aligned)],timeout=80)
  verify_cert(signed)
  with zipfile.ZipFile(signed) as z:
   if sha(z.read("classes2.dex"))!=previousSecond:raise RuntimeError("support_dex_changed")
   if sha(z.read("classes.dex"))==priorDex:raise RuntimeError("updated_camera_code_not_included")
   if any(sha(z.read("assets/"+n))!=v for n,v in originals.items()):
    raise RuntimeError("models_changed")
   if any(sha(z.read(n))!=v for n,v in originalMeta.items()):
    raise RuntimeError("native_libraries_or_manifest_changed")
   if b"preroll_prepend_halted_after_failures" not in z.read("classes.dex"):
    raise RuntimeError("new_safeguard_status_missing")
  TARGET.mkdir(parents=True,mode=0o700,exist_ok=True)
  p=TARGET/"s9-prepended-v1c.apk"
  data=signed.read_bytes()
  if p.exists() and sha(p.read_bytes())!=sha(data):
   raise RuntimeError("existing_v1c_artifact_mismatch")
  if not p.exists():
   intermediate=TARGET/".release-partial";intermediate.write_bytes(data);os.replace(intermediate,p)
  result={"apk":str(p),"sha256":sha(data),"bytes":len(data),
    "signer_sha256":SIGNER,"model_sha256":originals,"jni_count":len(originalMeta),
    "original_common_dex_sha256":previousSecond,
    "source_commit":"3b928406fcf9f3c47025a1cc03b99d6c3059d93d",
    "source_class_count":len(list(PROOF.rglob("*.class"))),
    "version":VERSION,"original_4k_preserved":True,
    "circuit_breaker_consecutive_errors":3,"status":"signed_not_installed"}
  (TARGET/"release.json").write_text(json.dumps(result,indent=2)+"\n")
  print("S9_MERGED_EVENT_V1C_SIGNED_STAGED",json.dumps(result,sort_keys=True),flush=True)
if __name__=="__main__":main()
