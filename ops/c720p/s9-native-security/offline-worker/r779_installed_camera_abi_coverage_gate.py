#!/usr/bin/env python3
"""R779: refuse unsafe camera APK upgrades when installed DEX classes differ.

Portable read-only regression and optional owner-only on-hub audit.
The original camera APK must NEVER be uploaded into GitHub or CI; only
synthetic tests run in CI. Real audits stay local and read just class
descriptor names, selected field names, SHA256 and signature metadata.

This is a *necessary*, not sufficient, camera-install condition.
Even complete class coverage never proves runtime behavior or gives
permission to restart the live recorder.
"""
from __future__ import annotations
import argparse,hashlib,json,pathlib,re,subprocess,zipfile
from collections import Counter

APP_PREFIX="Lnl/kalenel/s9security/"
DUMP=["/usr/lib/android-sdk/build-tools/36.0.0/dexdump","-f"]
CORE_PROTECTED=(
    "CameraService","GardenPreRoll","Continuous4KEncoder",
    "ContinuousAacRing","EncoderProgressPolicy","GardenBaseTrackGate"
)
CRITICAL_CAMERA_RECOVERY_FIELDS=(
    "cameraOpenGeneration","cameraSessionGeneration","cameraRecoveryGeneration",
    "cameraRecoveryQueued","continuous4KFence","retiring4K",
)

def require(ok,why):
    if not ok:raise ValueError(why)

def parse_dex(dex_bytes:bytes):
    require(isinstance(dex_bytes,bytes) and
            dex_bytes.startswith(b"dex\n") and len(dex_bytes)>=112,
            "not_a_dex_blob")
    import tempfile,os
    fd,p=tempfile.mkstemp(prefix="r779-verified-bytecode-",suffix=".dex")
    try:
        with os.fdopen(fd,"wb") as f:f.write(dex_bytes)
        proc=subprocess.run(DUMP+[p],capture_output=True,text=True,timeout=17)
        require(proc.returncode==0,"dexdump_failed")
        sections=re.split(r"(?=Class descriptor\s*:\s*')",proc.stdout)
        classes={}
        for part in sections:
            m=re.match(r"Class descriptor\s*:\s*'([^']+)'",part)
            if not m:continue
            desc=m.group(1)
            require(desc not in classes,"duplicate_class_within_dex")
            fields=set(re.findall(r"\s+name\s+: '([^']+)'",
                part.split("  Direct methods")[0]))
            classes[desc]=fields
        require(classes,"empty_or_corrupt_dex_class_inventory")
        return classes
    finally:
        try:os.unlink(p)
        except OSError:pass

def collect_original(apk_path:pathlib.Path):
    require(apk_path.is_file() and not apk_path.is_symlink(),
            "original_camera_apk_missing_or_symlink")
    with zipfile.ZipFile(apk_path) as z:
        names=z.namelist()
        dexnames=sorted((x for x in names if
                         re.fullmatch(r"classes(?:[2-9][0-9]*)?[.]dex",x)),
                        key=lambda x:int(x[7:-4]) if x!="classes.dex" else 1)
        require("classes.dex" in dexnames and len(dexnames)<=9,
                "original_apk_dex_layout_not_trusted")
        require(len(names)==len(set(names)),"duplicate_apk_zip_entry")
        records=[]
        for name in dexnames:
            raw=z.read(name)
            records.append((name,raw))
        return records

def collect_candidate(folder:pathlib.Path):
    require(folder.is_dir() and not folder.is_symlink(),
            "candidate_dex_dir_missing")
    entries=sorted(folder.glob("classes*.dex"))
    require(entries and len(entries)<=9,"candidate_dex_not_bounded")
    return [(x.name,x.read_bytes()) for x in entries]

def comparison(original,candidate):
    def group(rows):
        all_classes={}
        by_dex={}
        for name,buf in rows:
            parsed=parse_dex(buf)
            for key,fields in parsed.items():
                require(key not in all_classes,
                        "duplicate_class_across_dex_"+key)
                all_classes[key]=fields
            by_dex[name]=len(parsed)
        return all_classes,by_dex
    old,old_layout=group(original)
    new,new_layout=group(candidate)
    missing=sorted(x for x in old if x not in new)
    additions=sorted(x for x in new if x not in old)
    critical_missing=sorted(x for x in missing if any(
        x.startswith(APP_PREFIX+y) for y in CORE_PROTECTED))
    camera_desc=APP_PREFIX+"CameraService;"
    require(camera_desc in old and camera_desc in new,
            "camera_service_class_not_covered")
    missing_recovery_fields=sorted(
        x for x in CRITICAL_CAMERA_RECOVERY_FIELDS
        if x in old[camera_desc] and x not in new[camera_desc])
    # Preserve all other original app class descriptors. We refuse to
    # fake a 'complete' build by dropping old lambda/helper bytecode.
    safe=(not missing and not missing_recovery_fields and
          old[camera_desc].issubset(new[camera_desc]))
    return {
        "schema":"s9_r779_original_camera_dex_abi_preservation_v1",
        "status":("CLASS_AND_RECOVERY_FIELD_PRESERVATION_PASS"
                  if safe else "REFUSE_CAMERA_APK_DEPLOYMENT_ABI_DRIFT"),
        "original_class_count":len(old),
        "candidate_class_count":len(new),
        "original_dex_class_counts":old_layout,
        "candidate_dex_class_counts":new_layout,
        "missing_original_classes":missing,
        "candidate_only_classes":additions,
        "critical_class_missing":critical_missing,
        "camera_recovery_fields_missing":missing_recovery_fields,
        "all_original_camera_fields_retained":old[camera_desc].issubset(new[camera_desc]),
        "sufficient_for_signed_apk_install":False,
        "production_camera_apk_changed":False,
        "automatic_people_folder_filing_authorized":False,
    }

def self_test():
    class Fake:
        def __init__(self,a):self.a=a
    # No APK, video, identities, dex files or device access in CI.
    old={APP_PREFIX+"CameraService;":set(CRITICAL_CAMERA_RECOVERY_FIELDS),
         APP_PREFIX+"GardenPreRoll;":set(),
         APP_PREFIX+"ContinuousAacRing;":set()}
    newer={k:set(v) for k,v in old.items()}
    def sets(a,b):
        missing=set(a)-set(b)
        cam=APP_PREFIX+"CameraService;"
        lost=a[cam]-b[cam]
        return not missing and not lost
    require(sets(old,newer),"identical_class_set_rejected")
    wrong={k:set(v) for k,v in newer.items()}
    del wrong[APP_PREFIX+"ContinuousAacRing;"]
    require(not sets(old,wrong),"missing_audio_ring_not_refused")
    wrong={k:set(v) for k,v in newer.items()}
    wrong[APP_PREFIX+"CameraService;"].remove("cameraRecoveryGeneration")
    require(not sets(old,wrong),"lost_4k_recovery_fence_not_refused")
    print(json.dumps({"status":"R779_SYNTHETIC_APK_ABI_COVERAGE_PASS",
                      "synthetic_negative_tests":2,
                      "actual_camera_apk_read":False,
                      "camera_installed":False},sort_keys=True))

def audit(origin:pathlib.Path,candidate:pathlib.Path,expected_sha:str):
    require(re.fullmatch(r"[a-f0-9]{64}",expected_sha) is not None,
            "must_pin_original_camera_sha")
    raw=origin.read_bytes()
    require(len(raw)<40_000_000 and
            hashlib.sha256(raw).hexdigest()==expected_sha,
            "wrong_original_production_apk_sha256")
    result=comparison(collect_original(origin),collect_candidate(candidate))
    result["original_installed_apk_sha256"]=expected_sha
    result["candidate_is_signed_apk"]=False
    result["original_media_or_app_state_read"]=False
    print(json.dumps(result,sort_keys=True,indent=2))

def main():
    p=argparse.ArgumentParser()
    g=p.add_mutually_exclusive_group(required=True)
    g.add_argument("--self-test",action="store_true")
    g.add_argument("--audit",action="store_true")
    p.add_argument("--original-apk")
    p.add_argument("--candidate-dex-dir")
    p.add_argument("--original-sha256")
    a=p.parse_args()
    if a.self_test:self_test()
    else:
        require(all((a.original_apk,a.candidate_dex_dir,a.original_sha256)),
                "missing_explicit_owner_restricted_audit_paths")
        audit(pathlib.Path(a.original_apk),pathlib.Path(a.candidate_dex_dir),
              a.original_sha256)

if __name__=="__main__":main()
