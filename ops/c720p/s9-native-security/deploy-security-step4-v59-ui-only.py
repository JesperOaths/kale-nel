#!/usr/bin/env python3
"""Guarded UI-only Step 4 release on the actual C720P Security tab.

Fetch only the source-pinned People JS; preserve existing HTML and routes,
changing just cache tokens. Transactional backups, guarded preimage, HTTP
readback and original-media inventory checks. No Android, camera, ML,
manual assignment, or media writes.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import urllib.request

SOURCE_NEW = "eaf8a58f1c733dbc9109348725669917eab1bb5b"
SOURCE_BASE = "4c1024582fa418256ce34bbcaabeaad868c12cbf"
PREFIX = "https://raw.githubusercontent.com/JesperOaths/kale-nel/"
SOURCENAME = "ops/c720p/s9-native-security/security-people-v45.js"
ROOT = Path("/opt/homeassistant/config/www/frontyard-security-new")
DEST = {
    "js": ROOT / "security-people-v45.js",
    "people": ROOT / "security-people-v50.html",
    "hub": ROOT / "security-hub-v30.js",
    "entry": ROOT / "security-hub-v30.html",
    "shell": Path("/opt/homeassistant/config/www/c720p-surveillance.html"),
}
BACK = Path("/home/jespern/c720p-home-hub/backups/security-step4-v59-ui-only")
OLD = "security-visible-route-v58-20261018"
NEW = "security-step4-v59-20261019"
JS_OLD = "security-face-review-v58-20261018"
JS_NEW = "security-step4-v59-20261019"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def get(url, limit=200000):
    with urllib.request.urlopen(url, timeout=35) as response:
        if response.status != 200:
            raise RuntimeError("HTTP source unavailable")
        data = response.read(limit + 1)
    if len(data) < 80 or len(data) > limit:
        raise RuntimeError("unexpected bounded HTTP response")
    return data


def originals():
    data = json.loads(get("http://127.0.0.1:8795/new/api/saved", 1600000))
    if data.get("archive_mode") != "S9-microSD-only":
        raise RuntimeError("S9 archive mode invalid")
    names = [v.get("clip_no") for v in data.get("events", []) if isinstance(v, dict)]
    if len(names) < 70 or len(names) != len(set(names)):
        raise RuntimeError("invalid or incomplete original archive")
    return set(names)


def replace_exact(data, before, after, label):
    old = before.encode()
    new = after.encode()
    if old not in data:
        if new in data:
            return data
        raise RuntimeError("unexpected " + label + " preimage")
    return data.replace(old, new)


def routes(prior):
    out = {}
    out["people"] = replace_exact(
        prior["people"], "security-people-v45.js?v=" + JS_OLD,
        "security-people-v45.js?v=" + JS_NEW, "people JS cache tag")
    out["hub"] = replace_exact(
        prior["hub"], "security-people-v50.html?v=" + OLD,
        "security-people-v50.html?v=" + NEW, "hub People iframe")
    out["entry"] = replace_exact(
        prior["entry"], "security-hub-v30.js?v=" + OLD,
        "security-hub-v30.js?v=" + NEW, "entry JS")
    for marker in ("security-people-v50.html", "security-hub-v30.js",
                   "security-hub-v30.html"):
        before = marker + "?v=" + OLD
        after = marker + "?v=" + NEW
        # Outer shell has historically used more than one legitimate route;
        # reject unknown versions rather than deleting unrelated markup.
        if before.encode() in prior["shell"] or after.encode() in prior["shell"]:
            out["shell"] = replace_exact(
                out.get("shell", prior["shell"]), before, after, "shell " + marker)
    if "shell" not in out or out["shell"] == prior["shell"]:
        raise RuntimeError("shell cache routing could not be updated")
    return out


def write_atomic(path, data, old_stat):
    fd, tmp = tempfile.mkstemp(prefix=".step4-v59-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, stat.S_IMODE(old_stat.st_mode))
        try:
            os.chown(tmp, old_stat.st_uid, old_stat.st_gid)
        except PermissionError:
            pass
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    if shutil.disk_usage(ROOT).free < 32 * 1024 * 1024:
        raise RuntimeError("insufficient disk safety margin")
    before_originals = originals()
    old_js = get(PREFIX + SOURCE_BASE + "/" + SOURCENAME)
    new_js = get(PREFIX + SOURCE_NEW + "/" + SOURCENAME)
    for key in (b"function folderApprovedSDClips(", b"folderAssignmentCount(",
                b"if(item?.source==='drive')return null;",
                b"const clips=folderApprovedSDClips(state.folder);",
                b"function manualLink("):
        if key not in new_js:
            raise RuntimeError("source invariant absent")
    prior = {}
    for key, path in DEST.items():
        if path.is_symlink() or not path.is_file():
            raise RuntimeError("unexpected missing/symlink target " + key)
        raw = path.read_bytes()
        if not 100 < len(raw) < 900000:
            raise RuntimeError("invalid target size " + key)
        prior[key] = (raw, path.stat())
    if prior["js"][0] not in (old_js, new_js):
        raise RuntimeError("live People JS differs from authorized V58 preimage")
    out = routes({key: value[0] for key, value in prior.items()})
    out["js"] = new_js
    if b"security-people-v45.js" not in out["people"]:
        raise RuntimeError("People iframe lost JS route")
    if args.dry_run:
        print("STEP4_V59_UI_DRY_RUN_PASS " + json.dumps({
            "old_source": SOURCE_BASE, "new_source": SOURCE_NEW,
            "originals": len(before_originals), "only_files": list(DEST),
            "source_sha256": sha(new_js), "media_changed": False
        }), flush=True)
        return
    BACK.mkdir(parents=True, exist_ok=True)
    os.chmod(BACK, 0o700)
    folder = BACK / dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    folder.mkdir(mode=0o700)
    for key, (raw, _) in prior.items():
        saved = folder / (key + "-previous")
        saved.write_bytes(raw)
        os.chmod(saved, 0o600)
        if saved.read_bytes() != raw:
            raise RuntimeError("failed backup verification")
    changed = []
    try:
        for key, path in DEST.items():
            raw, meta = prior[key]
            if out[key] == raw:
                continue
            if path.read_bytes() != raw:
                raise RuntimeError("concurrent UI update on " + key)
            write_atomic(path, out[key], meta)
            changed.append(key)
        served = {}
        for key, path in DEST.items():
            if path.read_bytes() != out[key]:
                raise RuntimeError("disk hash readback mismatch " + key)
            relative = ("local/" if key == "shell" else
                        "local/frontyard-security-new/") + path.name
            actual = get("http://127.0.0.1:8123/" + relative +
                         "?v=" + NEW, 950000)
            if sha(actual) != sha(out[key]):
                raise RuntimeError("HA HTTP readback mismatch " + key)
            served[key] = sha(actual)[:16]
        after_originals = originals()
        if not before_originals.issubset(after_originals):
            raise RuntimeError("original S9 media index shrank")
        print("STEP4_V59_UI_DEPLOY_VERIFIED " + json.dumps({
            "source_ref": SOURCE_NEW,
            "source_sha256": sha(new_js),
            "originals_before": len(before_originals),
            "originals_after": len(after_originals),
            "files_changed": changed,
            "http_sha16": served,
            "rollback": str(folder),
            "camera_changed": False, "review_decisions_changed": False,
            "videos_changed": False, "automatic_identity_enabled": False
        }), flush=True)
    except BaseException:
        for key in reversed(changed):
            try:
                raw, meta = prior[key]
                write_atomic(DEST[key], raw, meta)
            except Exception:
                print("STEP4_V59_MANUAL_RESTORE_REQUIRED " + key, flush=True)
        print("STEP4_V59_DEPLOY_ROLLED_BACK", flush=True)
        raise


if __name__ == "__main__":
    main()
