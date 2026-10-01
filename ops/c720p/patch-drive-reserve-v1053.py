#!/usr/bin/env python3
from __future__ import annotations

import pathlib
import py_compile
import shutil
import time

HOME = pathlib.Path("/home/jespern")
TARGET = HOME / "c720p-home-hub/bin/c720p-drive-security-upload.py"
MARKER = "# C720P_DRIVE_PER_UPLOAD_RESERVE_V1053"

text = TARGET.read_text(encoding="utf-8")
if MARKER in text:
    py_compile.compile(str(TARGET), doraise=True)
    print("PATCH=ALREADY_APPLIED")
    print("VERSION=v1053")
    raise SystemExit(0)

stamp = time.strftime("%Y%m%d_%H%M%S")
backup_dir = HOME / f"c720p-backups/v1053-drive-reserve-{stamp}"
backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(TARGET, backup_dir / TARGET.name)

old1 = "failures=[]; quota_blocked=False; quota_until=0"
new1 = "failures=[]; quota_blocked=False; quota_until=0; reserve_blocked=False; reserve_block_details={}"
if old1 not in text:
    raise SystemExit("PATCH_ABORT=anchor1_missing")
text = text.replace(old1, new1, 1)

old2 = """   upload_src,archive_meta=archive_derivative(cam,src,reason)
   suffix='_archive720p12.mp4' if archive_meta.get('archive_transcoded') else '_'+src.name
"""
new2 = """   upload_src,archive_meta=archive_derivative(cam,src,reason)
   # C720P_DRIVE_PER_UPLOAD_RESERVE_V1053
   # Protect the configured Drive free-space reserve for every individual upload,
   # not only once at service start. Include the full source-quality clip plus a
   # small allowance for its thumbnail/accounting drift.
   reserve_now=int(float(c.get('reserve_free_gb',2.0))*1024*1024*1024)
   free_now=drive_free_bytes(c)
   candidate_bytes=int(upload_src.stat().st_size)
   safety_margin_bytes=32*1024*1024
   required_free=reserve_now+candidate_bytes+safety_margin_bytes
   if free_now is not None and free_now < required_free:
    reserve_blocked=True
    reserve_block_details={'status':'low_space_for_candidate','updated_at':time.time(),
      'drive_free_bytes':free_now,'reserve_bytes':reserve_now,'candidate_bytes':candidate_bytes,
      'safety_margin_bytes':safety_margin_bytes,'required_free_bytes':required_free,
      'pending_camera':cam,'pending_clip':src.name,'selection_reason':reason}
    atomic(UPSTATE,reserve_block_details)
    log(f'DRIVE_UPLOAD=DEFER_RESERVE free_gb={free_now/1073741824:.3f} reserve_gb={reserve_now/1073741824:.3f} candidate_mb={candidate_bytes/1048576:.1f} margin_mb={safety_margin_bytes/1048576:.0f} clip={src.name}')
    break
   suffix='_archive720p12.mp4' if archive_meta.get('archive_transcoded') else '_'+src.name
"""
if old2 not in text:
    raise SystemExit("PATCH_ABORT=anchor2_missing")
text = text.replace(old2, new2, 1)

old3 = """ d=idx(); verified=sum(1 for x in d.get('items',[]) if x.get('state')=='verified')
 if quota_blocked:
"""
new3 = """ d=idx(); verified=sum(1 for x in d.get('items',[]) if x.get('state')=='verified')
 if reserve_blocked:
  log(f'DRIVE_UPLOAD=LOW_SPACE_FOR_CANDIDATE verified={verified} free_bytes={reserve_block_details.get("drive_free_bytes")} required_free_bytes={reserve_block_details.get("required_free_bytes")}')
  return 0
 if quota_blocked:
"""
if old3 not in text:
    raise SystemExit("PATCH_ABORT=anchor3_missing")
text = text.replace(old3, new3, 1)

TARGET.write_text(text, encoding="utf-8")
py_compile.compile(str(TARGET), doraise=True)

print("PATCH=APPLIED")
print("VERSION=v1053")
print(f"BACKUP={backup_dir}")
print("PER_UPLOAD_RESERVE=1")
print("RESERVE_MARGIN_MB=32")
print("SOURCE_1080P_UNCHANGED=1")
