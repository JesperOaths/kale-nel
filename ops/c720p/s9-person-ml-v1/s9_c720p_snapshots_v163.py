"""Private, bounded playback of SHA-verified migrated C720P JPEGs on S9+.

This is an 8795 handler mounted behind the existing authenticated 8794 relay.
No public listener, no index/Save/Delete modification, no local fallback deletion.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import stat
import subprocess
import time
import urllib.parse

REPORT=Path("/home/jespern/c720p-home-hub/state/c720p-s9-snapshots-v162.json")
MP4_REPORT=Path("/home/jespern/c720p-home-hub/state/c720p-s9-imported-v2.json")
SCHEMA="c720p_s9_snapshots_v162"
MP4_SCHEMA="c720p_s9_verified_import_v2"
S9_ROOT="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/C720PMigratedSnapshots"
MP4_ROOT="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/C720PMigrated"
SERIAL="192.168.178.250:5555"
JPEG=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]jpg\Z")
MP4=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]mp4\Z")
SHA=re.compile(r"[a-f0-9]{64}\Z")
MAX_IMAGE=5_000_000
MAX_ROWS=5000
ROUTE=re.compile(r"/new/saved/c720p-migrated/snap/([A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]jpg)\Z")

def private_json(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("private_proof_unavailable")
    st=path.stat()
    if (stat.S_IMODE(st.st_mode)&0o077 or not 30<st.st_size<2_000_000):
        raise ValueError("private_proof_untrusted")
    d=json.loads(path.read_bytes())
    if not isinstance(d,dict) or not isinstance(d.get("records"),dict):
        raise ValueError("invalid_proof_structure")
    return d

def read_proof(snapshot_source=None,mp4_source=None):
    snap=private_json(Path(snapshot_source or REPORT))
    mp4=private_json(Path(mp4_source or MP4_REPORT))
    if snap.get("schema_version")!=SCHEMA or mp4.get("schema_version")!=MP4_SCHEMA:
        raise ValueError("manifest_schema_mismatch")
    srows=snap["records"];mrows=mp4["records"]
    if (not 1<=len(srows)<=MAX_ROWS or len(srows)!=len(mrows)):
        raise ValueError("manifest_coverage_mismatch")
    verified={}
    used=set()
    for name,entry in srows.items():
        if (not isinstance(name,str) or not JPEG.fullmatch(name) or ".." in name
                or not isinstance(entry,dict)
                or entry.get("sd_path")!=S9_ROOT+"/"+name
                or type(entry.get("bytes")) is not int
                or not 1000<=entry["bytes"]<=MAX_IMAGE
                or not isinstance(entry.get("sha256"),str)
                or not SHA.fullmatch(entry["sha256"])):
            raise ValueError("untrusted_jpeg_proof")
        clip=entry.get("clip")
        if (not isinstance(clip,str) or not MP4.fullmatch(clip) or ".." in clip
                or clip in used):
            raise ValueError("untrusted_source_clip")
        ref=mrows.get(clip)
        if (not isinstance(ref,dict) or ref.get("sd_path")!=MP4_ROOT+"/"+clip
                or ref.get("indexed") is not True
                or not isinstance(ref.get("sha256"),str)
                or not SHA.fullmatch(ref["sha256"])
                or ref["sha256"]!=entry.get("clip_sha256")):
            raise ValueError("source_mp4_provenance_mismatch")
        used.add(clip)
        verified[name]={"sha256":entry["sha256"],"bytes":entry["bytes"]}
    if used!=set(mrows):raise ValueError("snapshot_source_coverage_incomplete")
    return verified

def read_phone_jpeg(name,expected,sha):
    """Read at most expected+1 bytes; do not stream unverified evidence."""
    if not JPEG.fullmatch(name) or not 1000<=expected<=MAX_IMAGE or not SHA.fullmatch(sha):
        raise ValueError("untrusted_jpeg_request")
    target=S9_ROOT+"/"+name
    proc=subprocess.Popen(["adb","-s",SERIAL,"exec-out","cat",target],
                          stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    body=bytearray()
    try:
        deadline=time.monotonic()+22
        with selectors.DefaultSelector() as sel:
            sel.register(proc.stdout,selectors.EVENT_READ)
            while True:
                remaining=deadline-time.monotonic()
                if remaining<=0 or not sel.select(remaining):
                    raise ValueError("phone_snapshot_timeout")
                chunk=os.read(proc.stdout.fileno(),min(65536,expected+1-len(body)))
                if not chunk:break
                body.extend(chunk)
                if len(body)>expected:raise ValueError("oversized_phone_snapshot")
        if proc.wait(timeout=3)!=0:
            raise ValueError("phone_snapshot_read_failed")
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.stdout.close()
        try:proc.wait(timeout=2)
        except subprocess.TimeoutExpired:pass
    raw=bytes(body)
    if (len(raw)!=expected or not raw.startswith(b"\xff\xd8\xff")
        or not raw.endswith(b"\xff\xd9")
        or hashlib.sha256(raw).hexdigest()!=sha):
        raise ValueError("phone_snapshot_integrity_failure")
    return raw

def install(H):
    previous=H.go
    def go(self):
        url=urllib.parse.urlsplit(self.path)
        if not url.path.startswith("/new/saved/c720p-migrated/snap/"):
            return previous(self)
        match=ROUTE.fullmatch(url.path)
        if (not match or url.query or self.command not in ("GET","HEAD")
                or self.headers.get("Range")):
            self.js(400,{"ok":False,"error":"invalid_migrated_snapshot_request"})
            return
        name=match.group(1)
        try:
            proof=read_proof()
        except (OSError,ValueError,TypeError,KeyError):
            self.js(503,{"ok":False,"error":"verified_snapshots_unavailable"})
            return
        item=proof.get(name)
        if item is None:
            self.js(404,{"ok":False,"error":"snapshot_not_in_verified_import"})
            return
        try:
            jpeg=read_phone_jpeg(name,item["bytes"],item["sha256"])
        except (OSError,ValueError,subprocess.SubprocessError):
            self.js(503,{"ok":False,"error":"phone_snapshot_unavailable"})
            return
        self.send_response(200)
        self.send_header("Content-Type","image/jpeg")
        self.send_header("Content-Length",str(len(jpeg)))
        self.send_header("Cache-Control","private,no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.end_headers()
        if self.command=="GET":
            self.wfile.write(jpeg)
    H.go=go
