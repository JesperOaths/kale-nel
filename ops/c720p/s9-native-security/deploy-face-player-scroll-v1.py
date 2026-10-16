#!/usr/bin/env python3
"""Surgically repair People & Faces modal scrolling on the live C720P.

Only add/replace the two scoped dialog CSS blocks. Preserve the site's
existing HA iframe scroll-boundary CSS, authentication, archive metadata,
camera pipeline, and original videos. SHA-pin repository sources, back up
changed HTML, perform atomic writes, validate, and roll back on error.
"""
import argparse
import datetime as dt
import hashlib
import os
import re
import stat
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path("/opt/homeassistant/config/www/frontyard-security-new")
BACKUP = Path("/home/jespern/c720p-home-hub/backups/face-player-scroll-v1")
GITHUB = "https://raw.githubusercontent.com/JesperOaths/kale-nel/"
SRC = "ops/c720p/s9-native-security/"
MARK = 's9-face-player-scroll-v1'
SOURCES = (
    ("security-face-folders-v22.html", "viewer"),
    ("face-appearances.html.txt", "playerDialog"),
)
TARGETS = (
    ("security-face-folders-v22.html", "viewer"),
    # The live People & Faces V40 template uses #viewer. The legacy template
    # held #playerDialog; detect the currently installed identifier at runtime.
    ("face-appearances.html", "viewer"),
)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def extract_style(source, marker=MARK):
    pattern = r'<style id="' + re.escape(marker) + r'">(?s:.*?)</style>'
    found = re.findall(pattern, source)
    if len(found) != 1:
        raise RuntimeError("missing_or_duplicate_player_layout_style")
    style = found[0]
    for marker_text in ("position:fixed!important", "overflow-y:auto!important", "max-height:calc(100dvh - 24px)!important"):
        if marker_text not in style:
            raise RuntimeError("unsafe_player_layout_style:" + marker_text)
    return style


def patch(source, style, dialog_id):
    if source.count("</head>") != 1 or source.count("</body>") != 1:
        raise RuntimeError("html_structure_unrecognized")
    if source.count('id="' + dialog_id + '"') != 1 or source.count("controls playsinline") < 1:
        raise RuntimeError("video_dialog_contract_missing")
    pattern = r'<style id="' + re.escape(MARK) + r'">(?s:.*?)</style>'
    original = re.findall(pattern, source)
    if len(original) > 1:
        raise RuntimeError("duplicate_installed_player_style")
    if original:
        updated = re.sub(pattern, lambda _: style, source, count=1)
    else:
        updated = source.replace("</head>", style + "\n</head>", 1)
    if updated.count('<style id="' + MARK + '">') != 1 or updated.count('id="' + dialog_id + '"') != 1:
        raise RuntimeError("post_patch_validation_failed")
    return updated


def atomic_write(path, data, info):
    fd, tmp = tempfile.mkstemp(prefix=".player-scroll-", suffix=".html", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(tmp, stat.S_IMODE(info.st_mode))
        try:
            os.chown(tmp, info.st_uid, info.st_gid)
        except PermissionError:
            pass
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def self_test():
    for source_file, dialog_id in SOURCES:
        source = (Path(__file__).resolve().parent / source_file).read_text()
        style = extract_style(source)
        # Model the live boundary rule: modal scrolling must not erase it.
        base = source.replace(style, "").replace(
            "</head>", '<style id="s9-security-scroll-boundaries-v12">html{overflow:hidden!important}</style>\n</head>', 1)
        patched = patch(base, style, dialog_id)
        assert patched.count(MARK) == 1
        assert "s9-security-scroll-boundaries-v12" in patched
        assert patched == patch(patched, style, dialog_id)
        assert "overflow-y:auto!important" in patched
        if dialog_id == "playerDialog":
            # Simulate the newer V40 People & Faces page, which renamed the
            # dialog and its heading but still uses native video controls.
            live_style = style.replace("#playerDialog", "#viewer").replace(
                "#viewer .modal-head", "#viewer header")
            simulated = base.replace('id="playerDialog"', 'id="viewer"').replace(
                '<div class="modal-head">', '<header>').replace('</strong><button', '</strong><button')
            assert patch(simulated, live_style, "viewer").count(MARK) == 1
    print("FACE_PLAYER_SCROLL_V1_SELF_TEST_PASS", flush=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ref")
    p.add_argument("--face-sha")
    p.add_argument("--timeline-sha")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args()
    if args.self_test:
        self_test()
        return
    if not re.fullmatch(r"[a-f0-9]{40}", args.ref or ""):
        raise RuntimeError("invalid_source_commit")
    for check in (args.face_sha, args.timeline_sha):
        if not re.fullmatch(r"[a-f0-9]{64}", check or ""):
            raise RuntimeError("invalid_source_digest")

    expected = (args.face_sha, args.timeline_sha)
    updated = {}
    original = {}
    metadata = {}
    for i, ((filename, dialog_id), (target_file, target_dialog)) in enumerate(zip(SOURCES, TARGETS)):
        url = GITHUB + args.ref + "/" + SRC + filename
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read(130000)
        if sha(data) != expected[i]:
            raise RuntimeError("source_checksum_invalid:" + filename)
        style = extract_style(data.decode("utf-8"))
        target = ROOT / target_file
        if not target.is_file() or target.is_symlink():
            raise RuntimeError("missing_or_linked_live_view:" + target_file)
        original[target] = target.read_bytes()
        metadata[target] = target.stat()
        if not (5000 <= len(original[target]) <= 250000):
            raise RuntimeError("unexpected_live_view_size:" + target_file)
        live = original[target].decode("utf-8")
        # A newer deployed V40 face view is intentionally not replaced by the
        # repository's earlier template. Adapt only the scoped CSS selector.
        live_id = target_dialog
        if target_file == "face-appearances.html" and 'id="playerDialog"' in live:
            live_id = "playerDialog"
        if live_id != dialog_id:
            style = style.replace("#" + dialog_id, "#" + live_id)
            # V40 uses a native <header> rather than the legacy modal-head div.
            if 'class="modal-head"' not in live:
                style = style.replace("#" + live_id + " .modal-head",
                                      "#" + live_id + " header")
        modified = patch(live, style, live_id).encode("utf-8")
        updated[target] = modified

    changed = [path for path in updated if updated[path] != original[path]]
    if not changed:
        print("FACE_PLAYER_SCROLL_V1_VERIFIED already_installed=true", flush=True)
        return
    BACKUP.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(BACKUP, 0o700)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    folder = BACKUP / stamp
    folder.mkdir(mode=0o700)
    for target in changed:
        dest = folder / target.name
        dest.write_bytes(original[target])
        os.chmod(dest, 0o600)
        if sha(dest.read_bytes()) != sha(original[target]):
            raise RuntimeError("backup_checksum_invalid:" + target.name)

    written = []
    try:
        for target in changed:
            if target.read_bytes() != original[target]:
                raise RuntimeError("concurrent_view_change:" + target.name)
            atomic_write(target, updated[target], metadata[target])
            written.append(target)
            if sha(target.read_bytes()) != sha(updated[target]):
                raise RuntimeError("installed_view_checksum_invalid:" + target.name)
        for target in updated:
            if target.read_bytes().count(b's9-face-player-scroll-v1') != 1:
                raise RuntimeError("missing_final_marker:" + target.name)
    except Exception:
        for target in reversed(written):
            atomic_write(target, original[target], metadata[target])
        raise
    print("FACE_PLAYER_SCROLL_V1_VERIFIED updated=" + ",".join(x.name for x in changed) +
          " backup=" + str(folder), flush=True)


if __name__ == "__main__":
    main()
