#!/usr/bin/env python3
"""Install only the V8 Security Archive document. No camera/media/service mutations.

Source must be pinned to a Git commit and independently SHA-256 checked.
The previous local document is backed up and automatically restored on failure.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import shutil
import stat
import tempfile
import urllib.request

ROOT = pathlib.Path("/opt/homeassistant/config/www")
TARGET = ROOT / "frontyard-security-new/security-archive-v7.html"
DRIVE_PAGE = ROOT / "c720p-drive-saved.html"
BACKUP_ROOT = pathlib.Path("/home/jespern/c720p-home-hub/backups/security-archive-drive-v8")
REMOTE_PATH = "ops/c720p/s9-native-security/security-archive-v7.html"
URL_PREFIX = "https://raw.githubusercontent.com/JesperOaths/kale-nel/"
LOCAL_URL = "http://127.0.0.1:8123/local/frontyard-security-new/security-archive-v7.html"
SD_URL = "http://127.0.0.1:8795/new/api/saved"

def digest(data):
    return hashlib.sha256(data).hexdigest()

def fetch(url, maximum, timeout=20):
    with urllib.request.urlopen(url, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError("unexpected_http_status")
        payload = response.read(maximum + 1)
    if len(payload) > maximum:
        raise RuntimeError("response_too_large")
    return payload

def validate_html(data):
    if not (9000 <= len(data) <= 100000):
        raise RuntimeError("archive_html_invalid_size")
    s = data.decode("utf-8", "strict")
    for required in (
        'id="s9v7-archive-script"', 'id="driveTab"', 'id="localTab"',
        'id="driveArchiveFrame"', "c720p-drive-saved.html",
        "showSource('drive');", "/new/api/saved", "/new/saved/clip/",
        "C720PSecureRelay", 'GEJAST_PAGE_VERSION=\'v817\''
    ):
        if required not in s:
            raise RuntimeError("archive_contract_missing")
    if s.count("</body>") != 1 or s.count("</head>") != 1:
        raise RuntimeError("archive_document_corrupt")
    if re.search(r'https?://[^"\' ]*(?:googleapis|drive\.google\.com)/',s):
        raise RuntimeError("archive_unsupported_direct_media_route")
    return s

def health():
    with urllib.request.urlopen(SD_URL,timeout=16) as response:
        j=json.load(response)
    if j.get("archive_mode")!="S9-microSD-only" or not isinstance(j.get("events"),list):
        raise RuntimeError("microSD_catalog_failed")
    return len(j["events"])

def published(expected):
    remote=fetch(LOCAL_URL+"?v=drive-v8",100000,timeout=15)
    if digest(remote)!=expected:
        raise RuntimeError("home_assistant_archive_not_updated")
    return len(remote)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--ref",required=True)
    ap.add_argument("--sha256",required=True)
    args=ap.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}",args.ref):
        raise RuntimeError("invalid_source_commit")
    if not re.fullmatch(r"[a-f0-9]{64}",args.sha256):
        raise RuntimeError("invalid_source_digest")
    if TARGET.is_symlink() or not TARGET.is_file() or DRIVE_PAGE.is_symlink() or not DRIVE_PAGE.is_file():
        raise RuntimeError("unrecognized_existing_archive")
    old=TARGET.read_bytes()
    if b'id="s9v7-archive-script"' not in old:
        raise RuntimeError("unexpected_archive_version")
    legacy=DRIVE_PAGE.read_text(encoding="utf-8")
    if "C720PSecureRelay" not in legacy or "/api/saved" not in legacy:
        raise RuntimeError("historical_drive_browser_contract_missing")
    sd_before=health()
    remote=fetch(URL_PREFIX+args.ref+"/"+REMOTE_PATH,100000)
    validate_html(remote)
    if digest(remote)!=args.sha256:
        raise RuntimeError("source_checksum_mismatch")
    if old==remote:
        print("ARCHIVE_DRIVE_V8_ALREADY_INSTALLED "+json.dumps({
            "sha256":args.sha256,"http_bytes":published(args.sha256),
            "sd_clips":sd_before,"drive_browser_preserved":True,
            "media_changed":False}),flush=True)
        return
    BACKUP_ROOT.mkdir(parents=True,exist_ok=True)
    os.chmod(BACKUP_ROOT,0o700)
    folder=BACKUP_ROOT/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    folder.mkdir(mode=0o700)
    old_file=folder/"archive-before-v8.html"
    old_file.write_bytes(old)
    os.chmod(old_file,0o600)
    if digest(old_file.read_bytes())!=digest(old):
        raise RuntimeError("rollback_backup_verification_failed")
    info=TARGET.stat()
    changed=False
    try:
        fd,tmp=tempfile.mkstemp(prefix=".archive-v8-",suffix=".html",dir=TARGET.parent)
        try:
            with os.fdopen(fd,"wb") as handle:
                handle.write(remote)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(tmp,stat.S_IMODE(info.st_mode))
            if hasattr(os,"chown"):
                try:os.chown(tmp,info.st_uid,info.st_gid)
                except PermissionError:pass
            if digest(pathlib.Path(tmp).read_bytes())!=args.sha256:
                raise RuntimeError("staged_hash_mismatch")
            os.replace(tmp,TARGET)
            changed=True
        finally:
            if os.path.exists(tmp):os.unlink(tmp)
        if digest(TARGET.read_bytes())!=args.sha256:
            raise RuntimeError("installed_hash_mismatch")
        live_bytes=published(args.sha256)
        sd_after=health()
        if sd_after < sd_before:
            raise RuntimeError("microSD_record_count_dropped")
        if DRIVE_PAGE.read_text(encoding="utf-8")!=legacy:
            raise RuntimeError("historical_drive_browser_modified")
        print("ARCHIVE_DRIVE_V8_DEPLOYED "+json.dumps({
          "sha256":args.sha256,"backup":str(old_file),"http_bytes":live_bytes,
          "sd_before":sd_before,"sd_after":sd_after,
          "drive_browser_preserved":True,"media_changed":False,
          "camera_changed":False}),flush=True)
    except BaseException:
        if changed:
            fd,tmp=tempfile.mkstemp(prefix=".archive-v8-rollback-",suffix=".html",dir=TARGET.parent)
            try:
                with os.fdopen(fd,"wb") as handle:handle.write(old)
                os.chmod(tmp,stat.S_IMODE(info.st_mode))
                try:os.chown(tmp,info.st_uid,info.st_gid)
                except PermissionError:pass
                os.replace(tmp,TARGET)
            finally:
                if os.path.exists(tmp):os.unlink(tmp)
            print("ARCHIVE_DRIVE_V8_ROLLED_BACK "+str(old_file),flush=True)
        raise

if __name__=="__main__":
    main()
