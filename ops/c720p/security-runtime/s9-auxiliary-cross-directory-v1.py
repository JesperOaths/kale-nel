#!/usr/bin/env python3
"""Read-only S9 auxiliary evidence cross-directory provenance scan.

Uses existing C720P ADB connection; never opens, decodes, copies, moves,
quarantines or deletes any MP4. Filename-only classification, not a verdict
on media integrity, recoverability, person identity or retention eligibility.
"""
import json
from pathlib import Path
import re
import subprocess

SERIAL="192.168.178.250:5555"
ROOT="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files"
ACTIVE=ROOT+"/Security4K"
QUARANTINE=ROOT+"/Security4K_quarantine_garden_review"
STATE=Path("/home/jespern/c720p-home-hub/state")
ORIGINAL=re.compile(r"motion_[0-9]{13}[.]mp4$")
ROLES={"preroll":re.compile(r"(motion_[0-9]{13}[.]mp4)[.]preroll[.]mp4$"),
       "complete":re.compile(r"(motion_[0-9]{13}[.]mp4)[.]complete[.]mp4$"),
       "partial":re.compile(r"(motion_[0-9]{13}[.]mp4)[.]complete[.]partial[.]mp4$")}
AUDIT=re.compile(r"purge-[0-9]{8}T[0-9]{6}Z[.]json$")
class Unavailable(RuntimeError):pass

def names(directory,runner=subprocess.run):
    if directory not in (ACTIVE,QUARANTINE):raise ValueError("directory_not_allowed")
    r=runner(["adb","-s",SERIAL,"shell","ls","-1A",directory],
             capture_output=True,timeout=25,check=False)
    if r.returncode or len(r.stdout)>2000000:raise Unavailable("directory_inaccessible")
    values=r.stdout.decode("utf8","strict").splitlines()
    if len(values)>20000 or len(values)!=len(set(values)) or any(
       x in (".","..") or "/" in x or "\\x00" in x for x in values):
        raise Unavailable("invalid_listing")
    return set(values)

def verified(state=STATE):
    path=state/"s9-standalone-archive-catalog-v1.json"
    if not path.is_file() or path.is_symlink() or path.stat().st_size>16000000:
        raise Unavailable("trusted_catalog_missing")
    raw=json.loads(path.read_text())
    records=raw.get("records")
    if not isinstance(records,dict) or len(records)>2000 or any(
        ORIGINAL.fullmatch(k) is None for k in records):
        raise Unavailable("invalid_catalog_names")
    return set(records)

def previous_deletions(state=STATE):
    root=state/"s9-permanent-empty-clip-purge"
    if not root.exists():return set(),False
    if root.is_symlink() or not root.is_dir():raise Unavailable("unsafe_history")
    candidates=[x for x in root.iterdir() if AUDIT.fullmatch(x.name)]
    if len(candidates)>500:raise Unavailable("unbounded_history")
    deleted=set()
    for path in candidates:
        if path.is_symlink() or not path.is_file() or path.stat().st_size>8000000:
            raise Unavailable("unsafe_history_file")
        data=json.loads(path.read_text())
        rows=data.get("records")
        if not isinstance(rows,list) or len(rows)>2000:raise Unavailable("invalid_history")
        for row in rows:
            if not isinstance(row,dict):raise Unavailable("invalid_history_row")
            if row.get("status")=="deleted":
                clip=row.get("clip")
                if not isinstance(clip,str) or not ORIGINAL.fullmatch(clip):
                    raise Unavailable("invalid_history_filename")
                deleted.add(clip)
    return deleted,True

def reconcile(verified_set,active,quarantine,deleted,history_ok):
    here={n for n in active if ORIGINAL.fullmatch(n)}
    held={n for n in quarantine if ORIGINAL.fullmatch(n)}
    if not verified_set<=here:raise Unavailable("missing_verified_original")
    if len(here)>2000 or len(held)>20000:raise Unavailable("unbounded_originals")
    report={"schema_version":"s9_auxiliary_cross_directory_v1",
      "verified_active":len(verified_set),"active_originals":len(here),
      "quarantine_originals":len(held),"both_locations":len(here&held),
      "historical_deleted_names":len(deleted),"history_accessible":history_ok,
      "read_only":True,"media_bytes_read":False,"media_changed":False,
      "filename_presence_is_not_video_or_person_integrity":True}
    for role,pattern in ROLES.items():
        bases={match.group(1) for n in active if (match:=pattern.fullmatch(n))}
        active_set=bases&here
        quarantine_set=(bases-here)&held
        history_set=(bases-here-held)&deleted
        unknown=bases-here-held-deleted
        values={"companion_files":len(bases),"original_active":len(active_set),
                "original_quarantined":len(quarantine_set),
                "only_historical_deletion_record":len(history_set),
                "original_unlocated":len(unknown)}
        if sum(values[k] for k in ("original_active","original_quarantined",
             "only_historical_deletion_record","original_unlocated"))!=len(bases):
            raise Unavailable("role_reconciliation_failed")
        report[role]=values
    return report

def main():
    active=names(ACTIVE)
    quarantine=names(QUARANTINE)
    deleted,available=previous_deletions()
    report=reconcile(verified(),active,quarantine,deleted,available)
    print("S9_AUXILIARY_CROSS_DIRECTORY_READONLY "+json.dumps(report,sort_keys=True))
if __name__=="__main__":main()
