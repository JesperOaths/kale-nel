#!/usr/bin/env python3
"""Read-only retirement eligibility audit for C720P clips copied to S9+.

Does not delete, move, copy, save, approve, or mark media eligible for pruning.
Presence in the S9 import manifest and working playback are not, by themselves,
permission to retire C720P's original recording or its saved state.
Only aggregate counters and fixed reason codes appear in output.
"""
import hashlib
import json
import re
import stat
import subprocess
import urllib.request
from pathlib import Path

WEB = Path("/opt/homeassistant/config/www/frontyard-security-new")
SOURCE = Path("/home/jespern/c720p-security-camera-new/c720p-frontyard-security-new.py")
MANIFEST = Path("/home/jespern/c720p-home-hub/state/c720p-s9-imported-v2.json")
SD = "/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/C720PMigrated"
CLIPS = WEB / "clips"
INDEX = WEB / "index.html"
SCRIPT = WEB / "c720p-migrated-index-playback-v1.js"
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]mp4\Z")
SCHEMA = "c720p_s9_verified_import_v2"
MAX_RECORDS = 5000
MAX_SIZE = 900 * 1024 ** 2
SOURCE_INDEX_BRIDGE = "c720p-migrated-index-playback-v1.js"
WEB_INDEX_BRIDGE = "c720p-migrated-index-playback-v1.js"
JS_MARKER = "C720PSecureRelay"
SAVE = "if parsed.path == '/save':"
DELETE = "if parsed.path == '/delete':"
LIVE = "if parsed.path == '/live.mjpg':"

# Explicitly no retirement-capable generator revision has yet been approved.
# Adding markers without a separately reviewed exact revision is NOT sufficient.
APPROVED_RETIREMENT_GENERATOR_SHA256 = frozenset()


def safe_file(path, *, size_limit):
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("unsafe_required_file")
    st = path.stat()
    if not 0 < st.st_size <= size_limit:
        raise RuntimeError("untrusted_required_file_size")
    return st


def manifest_rows(path=MANIFEST):
    st = safe_file(path, size_limit=2_000_000)
    if stat.S_IMODE(st.st_mode) & 0o077:
        raise RuntimeError("private_manifest_permissions_unsafe")
    doc = json.loads(path.read_bytes())
    if (not isinstance(doc, dict) or doc.get("schema_version") != SCHEMA
            or not isinstance(doc.get("records"), dict)
            or not 1 <= len(doc["records"]) <= MAX_RECORDS):
        raise RuntimeError("invalid_migration_manifest")
    found = {}
    for name, row in doc["records"].items():
        if (not isinstance(name, str) or not NAME.fullmatch(name)
                or ".." in name or not isinstance(row, dict)
                or row.get("sd_path") != SD + "/" + name
                or not isinstance(row.get("sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", row["sha256"])
                or type(row.get("bytes")) is not int
                or not 10_000 <= row["bytes"] <= MAX_SIZE
                or type(row.get("indexed")) is not bool):
            raise RuntimeError("unsafe_migration_manifest_entry")
        found[name] = row
    return found


def local_inventory(folder=CLIPS):
    if folder.is_symlink() or not folder.is_dir():
        raise RuntimeError("unsafe_local_clips_folder")
    found = {}
    for path in folder.iterdir():
        if not NAME.fullmatch(path.name) or ".." in path.name:
            continue
        if path.is_symlink() or not path.is_file() or path.parent.resolve() != folder.resolve():
            raise RuntimeError("unsafe_local_clip")
        st = path.stat()
        if not 10_000 <= st.st_size <= MAX_SIZE:
            raise RuntimeError("unsafe_local_clip_size")
        found[path.name] = st.st_size
    return found


def legacy_actions(source):
    if any(source.count(x) != 1 for x in (SAVE, DELETE, LIVE)):
        raise RuntimeError("legacy_action_boundaries_unknown")
    save = source.split(SAVE, 1)[1].split(DELETE, 1)[0]
    delete = source.split(DELETE, 1)[1].split(LIVE, 1)[0]
    return {
        "save_writes_local_index": "e['saved'] = True" in save
            and "save_index(events)" in save,
        "delete_unlinks_local_files": "(ROOT / rel).unlink()" in delete
            and "save_index(keep, replace=True)" in delete,
        "source_generator_bridge": SOURCE_INDEX_BRIDGE in source,
    }


def unit_active(name):
    result = subprocess.run(
        ["systemctl", "--user", "is-active", name],
        capture_output=True, text=True, timeout=8, check=False)
    return result.returncode == 0 and result.stdout.strip() == "active"


def camera_healthy():
    try:
        with urllib.request.urlopen("http://127.0.0.1:18808/status", timeout=9) as reply:
            data = json.loads(reply.read(90_001))
        t = data.get("temperature_c")
        return (data.get("ok") is True and data.get("mode") == "watching"
                and data.get("continuous_4k_ready") is True
                and data.get("continuous_4k_dropped_output_frames") == 0
                and type(t) in (int, float) and 0 < t <= 39.5)
    except (OSError, ValueError, TypeError):
        return False


def assess(rows, local, actions, *, generator_sha, bridges, guard, camera):
    overlap = set(rows).intersection(local)
    size_matches = sum(local[name] == rows[name]["bytes"] for name in overlap)
    known_local = sum(size for size in local.values())
    old_actions = (actions["save_writes_local_index"]
                   or actions["delete_unlinks_local_files"])
    authorized_generator = generator_sha in APPROVED_RETIREMENT_GENERATOR_SHA256
    # Treat approved retention behavior, actual on-phone SHA verification, and
    # S9-side saved/delete semantics as independent proofs. This audit does not
    # produce the latter proofs, and therefore CANNOT approve a deletion.
    blockers = []
    if old_actions or not authorized_generator:
        blockers.append("legacy_save_delete_retirement_not_approved")
    if not bridges or not guard:
        blockers.append("generated_index_or_watcher_unverified")
    if not camera:
        blockers.append("native_4k_health_unverified")
    if len(rows) != len(local) or size_matches != len(local):
        blockers.append("local_import_inventory_or_size_mismatch")
    if not all(x["indexed"] for x in rows.values()):
        blockers.append("unindexed_migrated_recording")
    blockers.extend(("phone_source_hash_revalidation_not_in_this_audit",
                     "remote_save_delete_and_fallback_retirement_unverified"))
    return {
        "state": "blocked",
        "eligible_for_local_removal": False,
        "retention_required": True,
        "read_only": True,
        "original_videos_modified": False,
        "review_decisions_modified": False,
        "local_video_count": len(local),
        "local_video_bytes": known_local,
        "import_manifest_count": len(rows),
        "manifest_bytes": sum(row["bytes"] for row in rows.values()),
        "local_manifest_overlap_count": len(overlap),
        "matching_size_count": size_matches,
        "save_writes_local_index": actions["save_writes_local_index"],
        "delete_unlinks_local_files": actions["delete_unlinks_local_files"],
        "generated_index_bridge_served": bridges,
        "generation_guard_active": guard,
        "native_4k_healthy": camera,
        "blockers": sorted(set(blockers)),
    }


def run():
    safe_file(SOURCE, size_limit=500_000)
    source = SOURCE.read_text()
    generator_sha = hashlib.sha256(source.encode()).hexdigest()
    actions = legacy_actions(source)
    safe_file(INDEX, size_limit=500_000)
    safe_file(SCRIPT, size_limit=100_000)
    bridges = (actions["source_generator_bridge"]
               and WEB_INDEX_BRIDGE in INDEX.read_text()
               and JS_MARKER in SCRIPT.read_text())
    rows = manifest_rows()
    local = local_inventory()
    guard = all(unit_active(n) for n in (
        "c720p-legacy-s9-index-bridge-guard-v1.path",
        "c720p-legacy-s9-index-bridge-guard-v1.timer"))
    summary = assess(rows, local, actions, generator_sha=generator_sha,
                     bridges=bridges, guard=guard, camera=camera_healthy())
    print("C720P_S9_MIGRATED_RETIREMENT_V156 " +
          json.dumps(summary, sort_keys=True), flush=True)
    return summary


if __name__ == "__main__":
    run()
