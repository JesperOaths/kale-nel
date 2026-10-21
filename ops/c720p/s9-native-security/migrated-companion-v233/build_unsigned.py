#!/usr/bin/env python3
"""Compile an UNENROLLED unsigned S9 companion library APK. Never install/sign."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

HERE=Path(__file__).resolve().parent
PINS=json.loads((HERE/"source-pins.json").read_text())
MANIFEST=HERE/"AndroidManifest.xml"
EXPECTED_PACKAGE="nl.kalenel.s9migrated"

def require(condition,why):
    if not condition:raise RuntimeError(why)

def run(*cmd,cwd=None):
    p=subprocess.run(list(map(str,cmd)),cwd=cwd,text=True,
                     stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=100)
    if p.returncode:raise RuntimeError("build_step_failed_"+str(cmd[0])+": "+p.stderr[-1000:])
    return p.stdout

def main():
    sdk=Path(os.environ.get("ANDROID_HOME","/usr/lib/android-sdk"))
    jar=sdk/"platforms/android-36/android.jar"
    require(jar.is_file(),"android36_sdk_required")
    require(PINS["revision"]=="f3d5c00006d5147f1cff08e02c70c367e81533bb",
            "pinned_source_revision_changed")
    require(len(PINS["files"])==20,"pinned_source_inventory_incomplete")
    xml=MANIFEST.read_text()
    for token in ('package="nl.kalenel.s9migrated"','android:allowBackup="false"',
                  'android:debuggable="false"','android:usesCleartextTraffic="false"',
                  'android:minSdkVersion="29"','android:targetSdkVersion="28"'):
        require(token in xml,"untrusted_companion_manifest")
    for forbidden in ("<activity ","<service ","<receiver ","<provider ","android:exported=\"true\""):
        require(forbidden not in xml,"component_must_remain_unexported")
    base=Path(os.environ.get("S9_COMPANION_STAGING_DIR",str(HERE/"private-build")))
    base.mkdir(mode=0o700,parents=True,exist_ok=True)
    base.chmod(0o700)
    with tempfile.TemporaryDirectory(prefix="unprivileged-v233-",dir=base) as tmpdir:
        tmp=Path(tmpdir)
        src=tmp/"sources";src.mkdir(mode=0o700)
        classes=tmp/"classes";classes.mkdir(mode=0o700)
        dex=tmp/"dex";dex.mkdir(mode=0o700)
        for row in PINS["files"]:
            name=row["name"]
            require(name.startswith("S9Migrated") and name.replace("_","").isalnum(),
                    "unexpected_source_name")
            url=("https://raw.githubusercontent.com/JesperOaths/kale-nel/"
                 +PINS["revision"]+"/ops/c720p/s9-native-security/offline-worker/"
                 +name+".java")
            local=os.environ.get("S9_COMPANION_PINNED_SOURCE_DIR")
            if local:
                candidate=Path(local)/(name+".java")
                require(candidate.is_file() and not candidate.is_symlink(),
                        "untrusted_local_source_path")
                raw=candidate.read_bytes()
            else:
                with urllib.request.urlopen(url,timeout=20) as r:
                    raw=r.read(200001)
            require(len(raw)==row["bytes"] and len(raw)<=200000
                    and hashlib.sha256(raw).hexdigest()==row["sha256"]
                    and raw.startswith(b"package nl.kalenel.s9offline;"),
                    "pinned_java_hash_mismatch")
            (src/(name+".java")).write_bytes(raw)
        run("javac","-source","8","-target","8","-cp",jar,"-d",classes,
            *sorted(src.glob("*.java")))
        run("d8","--min-api","29","--lib",jar,"--output",dex,
            *sorted(classes.rglob("*.class")))
        unsigned=tmp/"unsigned.apk"
        run("aapt","package","-f","-M",MANIFEST,"-I",jar,"-F",unsigned)
        run("aapt","add",unsigned,"classes.dex",cwd=dex)
        aligned=tmp/"aligned.apk"
        run("zipalign","-f","4",unsigned,aligned)
        badging=run("aapt","dump","badging",aligned)
        require("package: name='nl.kalenel.s9migrated'" in badging,
                "companion_package_mismatch")
        require("targetSdkVersion:'28'" in badging and "sdkVersion:'29'" in badging,
                "companion_sdk_mismatch")
        with zipfile.ZipFile(aligned) as z:
            require(set(z.namelist())=={"AndroidManifest.xml","classes.dex"},
                    "unexpected_apk_payload")
        # Intentionally no signing identity exists here. It MUST remain unsigned.
        verify=subprocess.run(["apksigner","verify","--min-sdk-version","29",
                    str(aligned)],capture_output=True,timeout=20)
        require(verify.returncode!=0,"unauthorized_signing_identity_present")
        digest=hashlib.sha256(aligned.read_bytes()).hexdigest()
        output=base/"s9-migrated-companion-unenrolled-unsigned.apk"
        if output.exists():
            require(hashlib.sha256(output.read_bytes()).hexdigest()==digest,
                    "existing_companion_artifact_differs")
        else:
            with output.open("xb") as f:
                os.fchmod(f.fileno(),0o600)
                f.write(aligned.read_bytes());f.flush();os.fsync(f.fileno())
        print("S9_COMPANION_V233_UNSIGNED_ONLY",digest,output.stat().st_size,
              "sources",len(PINS["files"]),"no_installed_service",True)

if __name__=="__main__":main()
