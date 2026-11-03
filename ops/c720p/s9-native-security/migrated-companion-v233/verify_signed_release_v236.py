#!/usr/bin/env python3
"""Read-only signed-release gate for a future independently approved certificate.

No keys, signer generation, APK install, first enrollment, source trust approval
or network/phone access. A verified APK cert STILL requires separate owner review.
"""
import argparse,hashlib,json,re,subprocess,zipfile
from pathlib import Path
import prepare_enrollment_review_v235 as review

CERT_PATTERN=re.compile(r"^Signer #([0-9]+) certificate SHA-256 digest: ([0-9a-fA-F]{64})$",re.M)
def fail_if(cond,reason):
 if cond:raise ValueError(reason)
def cmd(*args):
 p=subprocess.run(list(map(str,args)),capture_output=True,text=True,timeout=20)
 if p.returncode!=0:raise ValueError("apk_or_manifest_tool_rejected")
 return p.stdout
def verify_signed(apk_path,public_cert,verified_preview):
 apk=Path(apk_path)
 preview=json.loads(Path(verified_preview).read_text())
 fail_if(not apk.is_file() or apk.stat().st_size>20_000_000,"signed_apk_missing_or_unbounded")
 fail_if(preview.get("schema")!="s9_companion_unsigned_build_receipt_v234","missing_signed_source_build_receipt")
 fail_if(preview.get("installed") is not False or preview.get("enrolled") is not False,
         "unexpected_preview_activation_claim")
 badging=cmd("aapt","dump","badging",apk)
 fail_if("package: name='nl.kalenel.s9migrated'" not in badging,
         "dedicated_package_name_invalid")
 fail_if("sdkVersion:'29'" not in badging or "targetSdkVersion:'28'" not in badging,
         "package_sdk_contract_changed")
 with zipfile.ZipFile(apk) as z:
  names=set(z.namelist())
  fail_if("classes.dex" not in names or "AndroidManifest.xml" not in names,
          "signed_apk_missing_dex_manifest")
  dex=z.read("classes.dex")
  fail_if(hashlib.sha256(dex).hexdigest()!=preview.get("dex_sha256"),
          "signed_artifact_bytecode_diverged_from_pin")
  fail_if(b"wire_decimal_leading_zero_" not in dex,
          "corrected_canonical_parser_missing")
 cert=review.cert_fingerprint(public_cert)
 signs=cmd("apksigner","verify","--min-sdk-version","29",
           "--print-certs",apk)
 matches=CERT_PATTERN.findall(signs)
 fail_if(len(matches)!=1 or matches[0][0]!="1" or matches[0][1].lower()!=cert,
         "unapproved_or_multiple_signer_certificates")
 return {"schema":"s9_companion_signed_release_prefight_v236",
   "signed_apk_sha256":hashlib.sha256(apk.read_bytes()).hexdigest(),
   "signed_apk_bytes":apk.stat().st_size,
   "signer_certificate_sha256":cert,
   "checked_parser_source_sha256":preview["parser_sha256"],
   "checked_dex_sha256":preview["dex_sha256"],
   "package":"nl.kalenel.s9migrated",
   "signature_cryptographically_valid":True,
   "signer_owner_authority_verified":False,
   "independent_source_enrollment_approved":False,
   "device_package_installed":False,"app_keys_enrolled":False,
   "remote_metadata_actions_operational":False,
   "human_release_approval_required":True}
def main():
 p=argparse.ArgumentParser()
 p.add_argument("--signed-apk",type=Path,required=True)
 p.add_argument("--public-signer-cert",type=Path,required=True)
 p.add_argument("--unsigned-build-receipt",type=Path,required=True)
 p.add_argument("--out",type=Path,required=True)
 args=p.parse_args()
 result=verify_signed(args.signed_apk,args.public_signer_cert,args.unsigned_build_receipt)
 if args.out.exists():raise ValueError("receipt_must_not_overwrite")
 with args.out.open("x") as f:
  f.write(json.dumps(result,sort_keys=True,indent=2)+"\n")
 args.out.chmod(0o600)
 print("SIGNATURE_AND_BYTECODE_VERIFIED_NOT_APPROVED",
       result["signed_apk_sha256"],result["signer_certificate_sha256"])
if __name__=="__main__":main()
