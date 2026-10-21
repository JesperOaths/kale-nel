#!/usr/bin/env python3
"""V251 only remove group-write from already-known, agent-owned Drive service
configuration after a prior read-only lstat confirmed mode 0664. Never open
OAuth config contents, video bytes or manual reviews. Fail closed on drift.
"""
import argparse
import json
import os
import stat
from pathlib import Path

CONFIG=Path("/home/jespern/c720p-home-hub/config/drive-security-archive.json")
MARK="TASK21_DRIVE_SERVICE_CONFIG_V251_VERIFIED "

def tighten(config=CONFIG):
    parent=config.parent
    if parent.is_symlink() or config.is_symlink():
        raise RuntimeError("unsafe_symlink")
    root=parent.stat()
    if (not stat.S_ISDIR(root.st_mode) or root.st_uid!=os.geteuid()
        or root.st_mode&0o022):
        raise RuntimeError("unsafe_parent")
    before=config.stat()
    if (not stat.S_ISREG(before.st_mode) or before.st_nlink!=1
        or before.st_uid!=os.geteuid() or not 10<before.st_size<=100000
        or before.st_mode&0o002
        or stat.S_IMODE(before.st_mode) not in (0o600,0o644,0o664)):
        raise RuntimeError("untrusted_service_config_metadata")
    original_mode=stat.S_IMODE(before.st_mode)
    desired=original_mode & ~stat.S_IWGRP
    fd=os.open(config,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        opened=os.fstat(fd)
        if (before.st_dev, before.st_ino,before.st_size,before.st_mtime_ns,
            original_mode)!=(opened.st_dev,opened.st_ino,opened.st_size,
            opened.st_mtime_ns,stat.S_IMODE(opened.st_mode)):
            raise RuntimeError("service_config_changed_before_mode_change")
        if desired!=original_mode:
            # fchmod the admitted inode, not pathname after potential
            # replacement. The agent retains owner read+write permission.
            os.fchmod(fd,desired)
            os.fsync(fd)
        after_fd=os.fstat(fd)
        after_path=config.stat()
        if ((after_fd.st_dev,after_fd.st_ino,after_fd.st_size,after_fd.st_mtime_ns,
              stat.S_IMODE(after_fd.st_mode)) !=
            (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,desired) or
            (after_path.st_dev,after_path.st_ino,after_path.st_size,
              after_path.st_mtime_ns,stat.S_IMODE(after_path.st_mode))!=
            (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,desired)):
            raise RuntimeError("service_config_changed_after_mode_change")
    finally:
        os.close(fd)
    return {"existing_agent_uid_preserved":True,
      "config_inode_size_mtime_unchanged":True,
      "group_write_removed":True,
      "result_mode_safe":desired in (0o600,0o644),
      "no_config_contents_read":True,"no_oauth_secrets_logged":True,
      "no_review_or_original_media_changes":True,
      "source_bytes_read":0,"review_decisions_modified":False,
      "permissions_only_tightened":True}
if __name__=="__main__":
    cli=argparse.ArgumentParser();cli.add_argument("--apply",action="store_true")
    args=cli.parse_args()
    if not args.apply:
        print("TASK21_DRIVE_SERVICE_CONFIG_V251_PREVIEW "+
              json.dumps({"read_only":True,"requires_explicit_apply":True},sort_keys=True))
    else:
        try:print(MARK+json.dumps(tighten(),sort_keys=True))
        except Exception:
            print("TASK21_DRIVE_SERVICE_CONFIG_V251_NOT_VERIFIED "+
                  json.dumps({"failed_closed":True,"review_content_not_modified":True},sort_keys=True))
            raise SystemExit(1)
