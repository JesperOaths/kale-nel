#!/usr/bin/env python3
"""Stage narrow continuity fixes against current Security UI, never deploy it.

Reads the four current assets, validates exact anchors and prepares all changes
before writing an explicitly separate output directory. Unknown or partly
applied source fails closed. The caller owns fresh-source/hash, backups, cache
versioning and guarded production deployment. No camera or review API calls.
"""
import argparse
import hashlib
import json
from pathlib import Path

VERSION = "security_ui_continuity_v1"
FILES = ("security-people-v45.js", "security-archive-v7.html",
         "security-review-v8.html", "security-hub-v30.js")

OLD_CATEGORY = """const category=r=>{const g=String(r.person_event_category||r.scene_category||'').toLowerCase(),tags=Array.isArray(r.content_categories)?r.content_categories.map(String):[];
if(g.includes('person')||Number(r.person_count)>0)return 'Person';
if(g.includes('animal')||tags.includes('animal'))return 'Animal';
if(g.includes('vehicle')||tags.includes('vehicle'))return 'Vehicle';return 'Motion'};"""
NEW_CATEGORY = """// SECURITY_UI_CATEGORY_CONTINUITY_V1: model evidence is not a confirmed person.
const category=r=>{const g=String(r.person_event_category||r.scene_category||'').toLowerCase(),tags=Array.isArray(r.content_categories)?r.content_categories.map(x=>String(x).toLowerCase()):[];
const labels={one_person:'Person candidate',multiple_people:'People candidates',single_person_repeated_candidate:'Person candidate',multiple_people_candidate:'People candidates',possible_group_needs_frame_review:'Possible people · review',possible_person_below_standard_threshold:'Possible person · review',single_frame_person_candidate:'Possible person · review'};
if(Object.prototype.hasOwnProperty.call(labels,g))return labels[g];
if(g!=='no_person_model_detection'&&Number(r.person_count)>0)return Number(r.person_count)>1?'People candidates':'Person candidate';
if(g.includes('animal')||tags.includes('animal'))return 'Animal';
if(g.includes('vehicle')||tags.includes('vehicle'))return 'Vehicle';return g==='no_person_model_detection'?'Motion · person unconfirmed':'Motion'};"""

RECOVERY_RESOLVER = """// SECURITY_UI_RECOVERY_RELAY_CONTINUITY_V1: use the existing authenticated parent.
function recoveryRelay(){
 for(const context of [window,window.parent]){
  try{const api=context.C720PSecureRelay;
   if(typeof api?.fetch==='function'&&typeof api?.url==='function')return api;
  }catch(_){}
 }
 return null;
}
"""
NATIVE_DIAGNOSTICS = """// SECURITY_UI_NATIVE_CAPTURE_CONTINUITY_V1: preference and readiness are separate.
function nativeCaptureDiagnostics(d){
 const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
 return [
  ['Native recording',d.native_4k_enabled===true?'4K enabled':d.native_4k_enabled===false?'4K disabled':'Not reported'],
  ['4K capture readiness',d.continuous_4k_ready===true?'Ready':d.continuous_4k_ready===false?'Not ready':'Not reported'],
  ['4K buffer',finite(d.continuous_4k_buffered_ms)?(d.continuous_4k_buffered_ms/1000).toFixed(1)+' seconds':'Not reported'],
  ['Dropped 4K output frames',finite(d.continuous_4k_dropped_output_frames)&&Number.isSafeInteger(d.continuous_4k_dropped_output_frames)?String(d.continuous_4k_dropped_output_frames):'Not reported']
 ];
}
"""
OLD_NATIVE_ROW = "['Native recording',d.native_4k_enabled===true?'4K enabled':d.native_4k_enabled===false?'4K disabled':'Not reported']"


def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise ValueError("unexpected_" + label + "_anchor")
    return text.replace(old, new, 1)


def patch_people(text):
    start = text.index("function renderFolder(){")
    end = text.index("function facesInRecording(", start)
    body = text[start:end]
    old = " const clips=folderApprovedSDClips(state.folder);\n const faceMatches=state.faceList.filter"
    new = " const clips=folderApprovedSDClips(state.folder);\n const uniqueFaceCrops=new Set();\n const faceMatches=state.faceList.filter"
    if new in body:
        if body.count("const uniqueFaceCrops=new Set();") != 1:
            raise ValueError("duplicate_folder_face_deduplicator")
        return text
    if "uniqueFaceCrops" not in body or "const uniqueFaceCrops" in body:
        raise ValueError("unexpected_folder_face_deduplicator")
    return text[:start] + replace_once(body, old, new, "folder_faces") + text[end:]


def patch_archive(text):
    if NEW_CATEGORY in text:
        return text
    if "SECURITY_UI_CATEGORY_CONTINUITY_V1" in text:
        raise ValueError("partial_archive_category_fix")
    return replace_once(text, OLD_CATEGORY, NEW_CATEGORY, "archive_category")


def patch_recovery(text):
    opening = '<script id="s9-aux-recovery-ui">'
    if text.count(opening) != 1:
        raise ValueError("unexpected_recovery_script")
    start = text.index(opening) + len(opening)
    end = text.index("</script>", start)
    script = text[start:end]
    old = "const relay=window.C720PSecureRelay;"
    new = "const relay=recoveryRelay();"
    if RECOVERY_RESOLVER in script:
        if old in script or script.count(new) != 2:
            raise ValueError("partial_recovery_relay_fix")
        return text
    if "recoveryRelay" in script or script.count(old) != 2:
        raise ValueError("unexpected_recovery_relay_contract")
    script = replace_once(script, "function stop(){", RECOVERY_RESOLVER + "function stop(){", "recovery_resolver")
    script = script.replace(old, new)
    return text[:start] + script + text[end:]


def patch_hub(text):
    if NATIVE_DIAGNOSTICS not in text:
        if "nativeCaptureDiagnostics" in text:
            raise ValueError("partial_native_diagnostics_fix")
        text = replace_once(text, "function diagnostics(){", NATIVE_DIAGNOSTICS + "function diagnostics(){", "native_diagnostics")
        # The helper contains the same row. Replace only the actual UI row.
        anchor = "const rows=[['Recorder',d.camera_mode||'Not available']," + OLD_NATIVE_ROW
        text = replace_once(text, anchor, "const rows=[['Recorder',d.camera_mode||'Not available'],...nativeCaptureDiagnostics(d)", "native_diagnostics_rows")
    elif text.count("...nativeCaptureDiagnostics(d)") != 1:
        raise ValueError("partial_native_diagnostics_rows")
    old_label = "const labels={zoom:['Zoom','Camera magnification'],"
    new_label = "const labels={night_mode:['Sensor night mode','Native camera night policy'],zoom:['Zoom','Camera magnification'],"
    if new_label not in text:
        if "night_mode:" in text:
            raise ValueError("unexpected_night_mode_labels")
        text = replace_once(text, old_label, new_label, "night_mode_labels")
    old_display = "function display(key,value){if(key==='zoom')"
    new_display = "function display(key,value){if(key==='night_mode')return ({auto:'Automatic',on:'On',off:'Off'})[value]||String(value);if(key==='zoom')"
    if new_display not in text:
        if "key==='night_mode'" in text:
            raise ValueError("unexpected_night_mode_display")
        text = replace_once(text, old_display, new_display, "night_mode_display")
    return text


PATCHERS = dict(zip(FILES, (patch_people, patch_archive, patch_recovery, patch_hub)))


def patch_asset(name, text):
    newline = "\r\n" if "\r\n" in text else "\n"
    normalized = text.replace("\r\n", "\n")
    result = PATCHERS[name](normalized)
    if PATCHERS[name](result) != result:
        raise ValueError("non_idempotent_" + name)
    return result.replace("\n", newline)


def stage(source_root, output_dir=None):
    source_root = Path(source_root).resolve(strict=True)
    if output_dir is not None:
        output_dir = Path(output_dir).resolve()
        if (output_dir == source_root or output_dir in source_root.parents
                or source_root in output_dir.parents):
            raise ValueError("output_must_be_separate_from_source")
    prepared, result = {}, {"version": VERSION, "files": {}}
    for name in FILES:
        source = source_root / name
        if source.is_symlink() or not source.is_file():
            raise ValueError("invalid_source_asset_" + name)
        before = source.read_bytes()
        after = patch_asset(name, before.decode("utf-8")).encode("utf-8")
        prepared[name] = after
        result["files"][name] = {"before_sha256": hashlib.sha256(before).hexdigest(),
                                 "after_sha256": hashlib.sha256(after).hexdigest(),
                                 "changed": before != after}
    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        # No overwrite: a caller must review/discard an earlier stage explicitly.
        for name in (*FILES, "ui-continuity-manifest.json"):
            if (output_dir / name).exists():
                raise ValueError("stage_output_already_exists_" + name)
        for name, content in prepared.items():
            with (output_dir / name).open("xb") as target:
                target.write(content)
        with (output_dir / "ui-continuity-manifest.json").open("x", encoding="utf-8") as target:
            json.dump(result, target, indent=2)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    print(json.dumps(stage(args.source_root, args.output_dir), indent=2))


if __name__ == "__main__":
    main()
