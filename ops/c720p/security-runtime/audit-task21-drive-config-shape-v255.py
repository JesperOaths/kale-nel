#!/usr/bin/env python3
"""Read-only fixed-path Drive config shape diagnosis, never print values/secrets.

Task21 V253 may refuse drive_worker_config_untrusted even after the service
metadata mode was repaired. This isolates mismatched keys/types without changing
the actual original-byte verifier's strict acceptance policy.
"""
import json
import os
from pathlib import Path
import re
import stat

CONFIG=Path("/home/jespern/c720p-home-hub/config/drive-security-archive.json")
MARK="TASK21_DRIVE_CONFIG_SHAPE_V255 "
def inspect(path=CONFIG):
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("trusted_config_unavailable")
    st=path.stat()
    if (not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or
       st.st_uid!=os.geteuid() or st.st_size<10 or st.st_size>100000 or
       st.st_mode&0o022):
        raise RuntimeError("trusted_config_metadata_refused")
    raw=path.read_bytes()
    if len(raw)!=st.st_size or path.stat().st_mtime_ns!=st.st_mtime_ns:
        raise RuntimeError("trusted_config_changed")
    doc=json.loads(raw)
    if not isinstance(doc,dict):raise RuntimeError("trusted_config_schema_refused")
    folders=doc.get("folders")
    new=folders.get("new") if isinstance(folders,dict) else None
    fid=new.get("id") if isinstance(new,dict) else None
    remote=doc.get("remote")
    binary=doc.get("rclone")
    conf=doc.get("rclone_config")
    flags={
        "folder_new_present":isinstance(new,dict),
        "folder_id_valid":isinstance(fid,str) and 6<=len(fid)<=200,
        "remote_valid":isinstance(remote,str) and bool(re.fullmatch(r"[A-Za-z0-9_-]{1,80}",remote)),
        "rclone_binary_valid":isinstance(binary,str) and os.path.realpath(binary)=="/usr/bin/rclone",
        "rclone_config_field_string":isinstance(conf,str),
        "rclone_config_field_nonempty":isinstance(conf,str) and bool(conf),
        "rclone_config_file_exists":isinstance(conf,str) and Path(conf).is_file() if isinstance(conf,str) else False,
        "schema_refuses":False
    }
    flags["schema_refuses"]=not all(flags[k] for k in (
        "folder_id_valid","remote_valid","rclone_binary_valid",
        "rclone_config_field_string"))
    flags["read_only"]=True
    flags["original_bytes_read"]=0
    flags["manual_decisions_modified"]=0
    flags["historical_backfill"]=False
    return flags
if __name__=="__main__":
    try:print(MARK+json.dumps(inspect(),sort_keys=True),flush=True)
    except Exception as error:
        reason=str(error)
        if reason not in {"trusted_config_unavailable","trusted_config_metadata_refused",
            "trusted_config_changed","trusted_config_schema_refused"}:
            reason="unclassified_no_private_detail"
        print("TASK21_DRIVE_CONFIG_SHAPE_V255_NOT_VERIFIED "+
            json.dumps({"reason":reason,"original_bytes_read":0,
                        "manual_decisions_modified":0},sort_keys=True),flush=True)
        raise SystemExit(1)
