#!/usr/bin/env python3
"""Guarded UI-only, no camera/recording/review change: edit people on saved clips."""
import argparse
import datetime as dt
import importlib.util
import json
from pathlib import Path
import re
import stat

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("v108_security_helpers",ROOT/"deploy-security-filing-v65.py")
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
PATH="ops/c720p/s9-native-security/security-people-v45.js"
EXPECTED_LIVE_JS="bf04bc14fe9d5c78de22be487a913dd1d3a080741ace2a5b03665d7474b12046"
TAG="security-edit-saved-group-v108-20261019"
FILES={k:b.ASSETS[k] for k in ("js","people","hub","entry","shell")}
START=" if(item.decision==='approved'){\n  if(state.folder)tools.append(control('↩ Return to review queue',"
END=" }else if(['rejected','skipped'].includes(item.decision)){"
MUST_RETAIN=("assign_many","addApprovalPerson","fetchAutomatic","searchClothingMatches",
             "addReviewedOsnetMatches","approvedFolderContext","chosenPortrait",
             "representativeReviewedImage","fetchLegacySkipped")

def patch_js(live,new_source):
    if live.count(START)!=1 or new_source.count(" if(item.decision==='approved'){")<1:
        raise RuntimeError("approved_review_actions_changed")
    old=b.block(live,START,END)
    edited=b.block(new_source," if(item.decision==='approved'){",END)
    if "＋ Edit people" not in edited or "Return to review queue" not in edited:
        raise RuntimeError("source_lost_review_actions")
    patched=b.one(live,old,edited)
    if not all(marker in patched for marker in MUST_RETAIN):
        raise RuntimeError("existing_security_function_lost")
    if patched.count("＋ Edit people")!=1:
        raise RuntimeError("duplicate_or_missing_edit_action")
    return patched

def state_files():
    output={}
    for name,path in FILES.items():
        if path.is_symlink() or not path.is_file() or path.stat().st_size>8_000_000:
            raise RuntimeError("unsafe_security_file_"+name)
        output[name]=(path.read_bytes(),stat.S_IMODE(path.stat().st_mode))
    return output

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--ref",required=True)
    parser.add_argument("--apply",action="store_true")
    a=parser.parse_args()
    if not re.fullmatch("[0-9a-f]{40}",a.ref):raise RuntimeError("immutable_source_required")
    existing=state_files()
    live=b.sha(existing["js"][0])
    if live!=EXPECTED_LIVE_JS:
        raise RuntimeError("live_security_js_changed_since_review")
    before=b.inventory()
    reviews=b.reviews()
    source=b.src(a.ref,PATH)
    updated=patch_js(existing["js"][0].decode(),source).encode()
    b.check_js(updated)
    b.TAG=TAG
    changed={"js":updated}
    changed["people"]=b.cache(existing["people"][0].decode(),"security-people-v45.js")
    for name,asset in (("hub","security-people-v50.html"),("entry","security-hub-v30.js")):
        changed[name]=b.cache(existing[name][0].decode(),asset)
    shell=existing["shell"][0].decode()
    count=0
    for asset in ("security-people-v50.html","security-hub-v30.js","security-hub-v30.html"):
        if asset+"?v=" in shell:
            shell=b.cache(shell,asset).decode()
            count+=1
    if count==0:raise RuntimeError("unknown_ui_shell_route")
    changed["shell"]=shell.encode()
    if reviews!=b.reviews():raise RuntimeError("unexpected_review_changes")
    if any(not before[k]<=b.inventory()[k] for k in before):
        raise RuntimeError("preflight_originals_changed")
    print("SECURITY_SAVED_GROUP_V108_PREFLIGHT "+json.dumps({
        "apply":a.apply,"live_js_sha256":live,
        "new_js_sha256":b.sha(changed["js"]),
        "source_counts":{k:len(v) for k,v in before.items()},
        "review_files_unchanged":True}),flush=True)
    if not a.apply:return
    backup=b.BASE/"backups/security-saved-group-v108"/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup.mkdir(parents=True,mode=0o700,exist_ok=False)
    for name,(value,mode) in existing.items():
        b.atom(backup/(name+"-previous"),value,0o600)
    touched=[]
    try:
        for name,path in FILES.items():
            if path.read_bytes()!=existing[name][0]:
                raise RuntimeError("concurrent_security_ui_edit_"+name)
            b.atom(path,changed[name],existing[name][1]);touched.append(name)
        for name,path in FILES.items():
            url="http://127.0.0.1:8123/local/"+path.relative_to(b.WWW).as_posix()+"?v="+TAG
            if b.sha(b.read(url,8_000_000))!=b.sha(changed[name]):
                raise RuntimeError("served_security_asset_mismatch_"+name)
        after=b.inventory()
        if any(not before[k]<=after[k] for k in before):raise RuntimeError("original_video_inventory_changed")
        if reviews!=b.reviews():raise RuntimeError("manual_or_auto_person_review_changed")
        print("SECURITY_SAVED_GROUP_V108_DEPLOY_VERIFIED "+json.dumps({
            "camera_apk_modified":False,"recordings_modified":False,
            "review_files_unchanged":True,"direct_edit_action_live":True,
            "source_counts":{k:len(v) for k,v in after.items()},
            "js_sha256":b.sha(changed["js"]),"backup":str(backup)}),flush=True)
    except BaseException:
        for name in reversed(touched):
            b.atom(FILES[name],*existing[name])
        print("SECURITY_SAVED_GROUP_V108_ROLLED_BACK",flush=True)
        raise

if __name__=="__main__":main()
