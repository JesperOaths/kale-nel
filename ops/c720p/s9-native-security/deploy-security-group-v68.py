#!/usr/bin/env python3
"""Fail-closed V68 group review deployment atop exact live V66 Security release.

No APK, video, review registry or biometric record is modified. The original
V66 UI contains phone-side OSNet/model additions absent from the editable JS:
apply only explicitly bounded, test-replayed source replacements.
"""
import argparse
import datetime as dt
import importlib.util
import json
from pathlib import Path
import re
import stat
spec=importlib.util.spec_from_file_location(
    'security_deploy_helpers', Path(__file__).with_name('deploy-security-filing-v65.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)

LIVE_JS='9b2aa1dded79085c24e107489a47120b75c0d07245856411007a402060d3b909'
V66_SHA='962b15b04cf3f130e568ba4d014ce5c06533b80f'
TAG='security-group-filing-v68-20261019'
ASSETS={k:b.ASSETS[k] for k in ('js','people','hub','entry','shell','backend','relay')}
BACKEND_SOURCE='ops/c720p/s9-person-ml-v1/s9_manual_recording_links.py'
PEOPLE_SOURCE='ops/c720p/s9-native-security/security-people-v45.js'
HTML_SOURCE='ops/c720p/s9-native-security/security-people-v45.html'
SAFETY_FEATURES=('fetchAutomatic','addReviewedOsnetMatches','approvedFolderContext',
    'fetchLegacySkipped','searchClothingMatches','continuous','faceFetchError',
    'fetchExtraLinks','automaticPortrait','folderApprovedSDClips')

def transplant(live,source,old_start,new_start,end):
    orig=b.block(live,old_start,end)
    replacement=b.block(source,new_start,end)
    return live if orig==replacement else b.one(live,orig,replacement)

def patch_js(raw,source):
    t=raw.decode()
    t=transplant(t,source,'function assignedFolder(item){',
                 'function assignedFolders(item){','function reviewDecision(item){')
    # Group selection/complete overlay and saved people counts together.
    t=transplant(t,source,'async function manualLink(item,folder,reviewAction=null){',
                 'async function manualLink(item,folder,reviewAction=null){','function imageFor(')
    t=transplant(t,source,'function openApproval(item){',
                 'function openApproval(item){','function dismiss(item){')
    t=transplant(t,source,'function profileRow(f){',
                 'function representativeReviewedImage(f){','function groupRows(')
    t=transplant(t,source,'function renderPeople(){',
                 'function renderPeople(){','async function searchClothingMatches(')
    t=transplant(t,source,'function renderFolder(){',
                 'function renderFolder(){','function facesInRecording(')
    t=transplant(t,source,"$('approvalForm').addEventListener('submit'",
                 "$('approvalForm').addEventListener('submit'","$('folderForm').addEventListener('submit'")
    old="$('approvalFolder').addEventListener('change',()=>{$('newLabel').hidden=!!$('approvalFolder').value});"
    new=old+"\n$('approvalAddPerson').addEventListener('click',()=>addApprovalPerson());"
    t=b.one(t,old,new)
    t=b.one(t,"const recheck=saved.reduce((n,x)=>n+num(x.approvals_needing_person_recheck),0);",
            "const recheck=0; // The archived human approval remains final.")
    t=b.one(t,"const flagged=savedFolders().filter(f=>num(f.approvals_needing_person_recheck)>0);",
            "const flagged=[]; // No recurrent mandatory human rechecks.")
    if t.count('function assignedFolders(item){')!=1 or t.count('function addApprovalPerson(')!=1:
        raise RuntimeError('group_assignment_patch_incomplete')
    if any(marker not in t for marker in SAFETY_FEATURES):
        raise RuntimeError('existing_security_feature_disappeared')
    if "async function searchClothingMatches(" not in t:
        raise RuntimeError('outfit_comparison_disappeared')
    return t.encode()

def patch_html(raw):
    t=raw.decode()
    marker='  <label id="newLabel">New person name<input id="approvalLabel" maxlength="100" placeholder="e.g. Regular visitor" /></label>'
    addition=('\n  <div id="approvalMorePeople" class="approval-more-people" aria-label="Additional people in this recording"></div>'
      '\n  <button id="approvalAddPerson" type="button" class="secondary">+ Add another person</button>')
    if "id=\"approvalAddPerson\"" in t:
        raise RuntimeError('concurrent_people_modal_change')
    t=b.one(t,marker,marker+addition)
    style=('.approval-more-people{display:grid;gap:9px;margin-top:8px}\n'
        '.approval-extra-row{display:flex;gap:8px;align-items:center}\n'
        '.approval-extra-row select{min-width:0;flex:1;max-width:100%}\n'
        '.approval-extra-row button{flex:none}\n'
        '#approvalAddPerson{width:100%;text-align:left;margin-top:8px;min-height:38px}\n')
    if t.count('</style>')!=1:raise RuntimeError('people_styles_changed')
    t=t.replace('</style>',style+'</style>',1)
    return t.encode()

def patch_relay(raw):
    t=raw.decode()
    part=b.block(t,"  if path=='/new/api/s9-manual-recording-links':",
                    "  parts=path.strip('/').split('/')")
    updated=b.one(part,"('assign','return_to_queue','skip','reject')",
                  "('assign','assign_many','return_to_queue','skip','reject')")
    if 'X-S9-Manual-Link-Intent' not in updated or 'Origin' not in updated:
        raise RuntimeError('auth_boundary_disappeared')
    return b.one(t,part,updated).encode()

def assets_to_load():
    result={}
    for key,path in ASSETS.items():
        if not path.is_file() or path.is_symlink() or path.stat().st_size>8_000_000:
            raise RuntimeError('unsafe_live_asset_'+key)
        result[key]=(path.read_bytes(),stat.S_IMODE(path.stat().st_mode))
    return result

def serve_matches(known):
    for key in ('js','people','hub','entry','shell'):
        path=ASSETS[key]
        url='http://127.0.0.1:8123/local/'+path.relative_to(b.WWW).as_posix()+'?v='+TAG
        served=b.read(url,8_000_000)
        if b.sha(served)!=b.sha(known[key]):
            raise RuntimeError('served_ui_mismatch_'+key)

def protect_inventory(before):
    after=b.inventory()
    if any(not before[k]<=after[k] for k in before):
        raise RuntimeError('original_inventory_changed')
    return {key:len(values) for key,values in after.items()}

def check_many_relay():
    """Use a deliberately nonexistent verified source: 404, NEVER a state write."""
    import urllib.error
    import urllib.request
    for port in (8794,8795):
        body=json.dumps({'action':'assign_many','source':'drive',
          'name':'__missing_group_probe__.mp4','folder':'G_invalid_probe',
          'folders':['G_invalid_probe','G_second_probe'],
          'revision':-1,'human_confirmed':True}).encode()
        req=urllib.request.Request('http://127.0.0.1:'+str(port)+'/new/api/s9-manual-recording-links',
          data=body,headers={'Origin':'http://127.0.0.1:8123',
          'Sec-Fetch-Site':'same-site' if port==8794 else 'same-origin',
          'Content-Type':'application/json','X-S9-Manual-Link-Intent':'manual-original-review-links-v1'})
        try:
            rsp=urllib.request.urlopen(req,timeout=15)
        except urllib.error.HTTPError as exc:
            rsp=exc
        with rsp:
            outcome=json.load(rsp)
            if rsp.status!=404 or outcome.get('error')!='source_not_in_verified_archive':
                raise RuntimeError('group_relay_validation_failed_'+str(port))

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--ref',required=True)
    p.add_argument('--apply',action='store_true')
    args=p.parse_args()
    if not re.fullmatch(r'[a-f0-9]{40}',args.ref):
        raise RuntimeError('immutable_commit_required')
    installed=assets_to_load()
    current=b.sha(installed['js'][0])
    expected_backend=b.src(V66_SHA,BACKEND_SOURCE).encode()
    # Only the exact audited V66 build can be upgraded. Concurrent changes do
    # not trigger an implicit "fix"; they require a new reviewed deployment.
    if current!=LIVE_JS:raise RuntimeError('concurrent_people_ui_update')
    if b.sha(installed['backend'][0])!=b.sha(expected_backend):
        raise RuntimeError('concurrent_manual_links_backend_update')
    before=b.inventory()
    reviews=b.reviews()
    src_js=b.src(args.ref,PEOPLE_SOURCE)
    backend=b.src(args.ref,BACKEND_SOURCE).encode()
    compile(backend,'s9_manual_recording_links_v68.py','exec')
    desired={'js':patch_js(installed['js'][0],src_js),
             'backend':backend,
             'people':patch_html(installed['people'][0]),
             'relay':patch_relay(installed['relay'][0])}
    b.check_js(desired['js'])
    b.TAG=TAG
    for key,asset in [('hub','security-people-v50.html'),
                      ('entry','security-hub-v30.js')]:
        desired[key]=b.cache(installed[key][0].decode(),asset)
    # The people page loads JS directly; stamp that route exactly once.
    desired['people']=b.cache(desired['people'].decode(),'security-people-v45.js')
    shell=installed['shell'][0].decode()
    stamped=0
    for asset in ('security-people-v50.html','security-hub-v30.js','security-hub-v30.html'):
        if asset+'?v=' in shell:
            shell=b.cache(shell,asset).decode()
            stamped+=1
    if stamped==0:raise RuntimeError('shell_route_not_found')
    desired['shell']=shell.encode()
    if b.sha(desired['js'])==LIVE_JS:raise RuntimeError('group_js_patch_not_applied')
    counts=protect_inventory(before)
    if reviews!=b.reviews():raise RuntimeError('unexpected_review_write_in_preflight')
    print('SECURITY_GROUP_V68_PREFLIGHT '+json.dumps({'apply':args.apply,
      'live_js_sha256':current,'target_js_sha256':b.sha(desired['js']),
      'archive_originals':counts,'review_registry_unchanged':True}),flush=True)
    if not args.apply:return
    backup=b.BASE/'backups/security-group-v68'/dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(parents=True,mode=0o700,exist_ok=False)
    for key,(content,mode) in installed.items():
        b.atom(backup/(key+'-previous'),content,0o600)
    touched=[]
    try:
        for key,path in ASSETS.items():
            if path.read_bytes()!=installed[key][0]:
                raise RuntimeError('concurrent_asset_update_'+key)
            b.atom(path,desired[key],installed[key][1])
            touched.append(key)
        b.restart()
        check_many_relay()
        serve_matches(desired)
        counts=protect_inventory(before)
        if reviews!=b.reviews():raise RuntimeError('review_registry_changed')
        if b.sha(ASSETS['js'].read_bytes())!=b.sha(desired['js']):
            raise RuntimeError('js_not_installed')
        print('SECURITY_GROUP_V68_DEPLOY_VERIFIED '+json.dumps({
          'archive_originals':counts,'js_sha256':b.sha(desired['js']),
          'metadata_writes':0,'review_files_unchanged':True,
          'backup':str(backup),'relay_assign_many_verified':True}),flush=True)
    except BaseException:
        for key in reversed(touched):
            b.atom(ASSETS[key],*installed[key])
        b.restart()
        print('SECURITY_GROUP_V68_ROLLED_BACK',flush=True)
        raise

if __name__=='__main__':main()
