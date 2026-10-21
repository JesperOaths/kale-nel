#!/usr/bin/env python3
"""Prepare a human REVIEW REQUEST; cannot attest original bytes or enroll keys.

Never reads real video, sends credentials, installs APKs, mutates journals or
produces a usable owner approval. A source-witness record must be independently
checked against both devices before a human may authorize one-time enrollment.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import ssl
import subprocess

EXPECTED_TOTAL=214181934
NAME=re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,139}\.mp4$")
HEX=re.compile(r"^[0-9a-f]{64}$")
RECEIPT=re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/#-]{5,255}$")
HEADER="S9-MIGRATED-MANIFEST-V216|1|6\n"

def check(flag,message):
    if not flag:raise ValueError(message)

def sha256(raw):
    return hashlib.sha256(raw).hexdigest()

def canonical(preimages):
    check(isinstance(preimages,list) and len(preimages)==6,"six_independent_pairs_required")
    names=set()
    total=0
    entries=[]
    evidence=[]
    for row in preimages:
        check(isinstance(row,dict),"source_row_invalid")
        name=row.get("name")
        check(isinstance(name,str) and bool(NAME.fullmatch(name)) and ".." not in name
              and name not in names,"source_recording_name_invalid_or_duplicate")
        names.add(name)
        original=row.get("c720p_original")
        copied=row.get("s9_copy")
        check(isinstance(original,dict) and isinstance(copied,dict),
              "two_separate_source_witnesses_required")
        for label,rec in (("original",original),("s9_copy",copied)):
            check(isinstance(rec.get("sha256"),str) and
                  bool(HEX.fullmatch(rec["sha256"])),
                  "source_witness_sha256_invalid_"+label)
            check(type(rec.get("bytes")) is int and rec["bytes"]>=10000,
                  "source_witness_size_invalid_"+label)
            check(isinstance(rec.get("receipt_id"),str)
                  and bool(RECEIPT.fullmatch(rec["receipt_id"])),
                  "independent_witness_receipt_required_"+label)
        check(original["sha256"]==copied["sha256"] and
              original["bytes"]==copied["bytes"],
              "cross_device_source_sha_or_bytes_differ")
        total+=original["bytes"]
        entries.append((name,original["sha256"],original["bytes"]))
        evidence.append({"name":name,"original_receipt_id":original["receipt_id"],
          "on_phone_receipt_id":copied["receipt_id"],
          "two_sources_report_equal_sha_size":True,
          "actual_media_bytes_verified_by_this_tool":False})
    check(total==EXPECTED_TOTAL,"historical_six_total_bytes_mismatch")
    body=HEADER+"".join("FILE|%s|%s|%d|1\n"%(n,s,b)
       for n,s,b in sorted(entries))
    return {"generation":1,"rows":[{"name":n,"sha256":s,"bytes":b}
      for n,s,b in sorted(entries)],"total_bytes":total,
      "canonical_preimage_sha256":sha256(body.encode("ascii")),
      "witness_references":sorted(evidence,key=lambda x:x["name"])}

def cert_fingerprint(path):
    data=Path(path).read_bytes()
    check(b"PRIVATE KEY" not in data and b"BEGIN CERTIFICATE" in data,
          "public_certificate_only_no_private_key")
    # This verifies X509 syntax, NOT independent ownership or trust.
    parsed=subprocess.run(["openssl","x509","-inform","PEM","-outform","DER"],
       input=data,capture_output=True,timeout=10)
    check(parsed.returncode==0 and len(parsed.stdout)>100,
          "untrusted_or_malformed_public_x509_certificate")
    return sha256(parsed.stdout)

def review(candidate,apk_path=None,cert_path=None):
    report={"schema":"s9_migrated_enrollment_review_v235",
      "approved":False,"first_enrollment_performed":False,
      "signing_authority_provisioned":False,
      "source_byte_verification_by_this_process":False,
      "camera2_apk_replacement_authorized":False,
      "original_media_removal_authorized":False,
      "human_authorization_required":True,
      "package":"nl.kalenel.s9migrated",
      "three_keys":["checkpoint","journal","source_manifest"],
      "keys_required":"app_UID_local_NONEXPORTABLE_AndroidKeyStore_HmacSHA256",
      "remote_action_signing_key":"separate_hub_owner_approved_domain"}
    if candidate is not None:
        report["six"]=canonical(candidate["rows"])
    else:
        report["six"]=None
    report["unsigned_apk_sha256"]=sha256(Path(apk_path).read_bytes()) if apk_path else None
    report["production_signing_certificate_sha256"]=cert_fingerprint(cert_path) if cert_path else None
    report["ready_for_human_approval"]=False
    report["missing_machine_independent_evidence"]=[
        "independent_c720p_original_media_digest_readback",
        "independent_s9_copied_media_digest_readback",
        "signed_production_apk_and_cert_chain",
        "authorized_app_private_enrollment_and_action_service",
        "physical_reboot_interruption_and_trusted_checkpoint_proof"]
    report["exact_human_approval_text_template"]=(
        "Approve only this independently reviewed generation-1 six-original "
        "manifest SHA-256 {CANONICAL_DIGEST}, these independently verified "
        "original/source receipts, Android companion package "
        "nl.kalenel.s9migrated with APK SHA-256 {FINAL_SIGNED_APK_DIGEST} "
        "and production signing certificate SHA-256 {CERT_FINGERPRINT} "
        "for ONE first enrollment of distinct non-exportable app-private "
        "checkpoint, journal and source HMAC keys. This does not authorize "
        "deleting original media, modifying historic reviews, silently "
        "re-enrolling after interruption or enabling unauthenticated actions.")
    return report

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--sources",type=Path)
    p.add_argument("--unsigned-apk",type=Path)
    p.add_argument("--public-signer-cert",type=Path)
    p.add_argument("--out",type=Path,required=True)
    args=p.parse_args()
    payload=json.loads(args.sources.read_text()) if args.sources else None
    result=review(payload,args.unsigned_apk,args.public_signer_cert)
    content=json.dumps(result,indent=2,sort_keys=True)+"\n"
    args.out.parent.mkdir(parents=True,exist_ok=True)
    with args.out.open("x") as f:
        f.write(content)
    args.out.chmod(0o600)
    print("ENROLLMENT_REVIEW_ONLY",result["approved"],
          "manifest_digest",result["six"]["canonical_preimage_sha256"] if result["six"] else "UNVERIFIED_MISSING",
          "signing_cert",result["production_signing_certificate_sha256"] or "UNAVAILABLE")

if __name__=="__main__":main()
