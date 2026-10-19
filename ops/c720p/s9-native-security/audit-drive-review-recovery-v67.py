#!/usr/bin/env python3
"""Read-only forensic reconciliation of historic Drive and current person decisions.

Output contains counts ONLY, never people, clip filenames, images, hashes of
private clip IDs, video contents, folder IDs or review payloads.
"""
import collections
import hashlib
import json
import os
from pathlib import Path

BASE=Path('/home/jespern/c720p-home-hub')
STATE=BASE/'state'
OLD=STATE/'s9-manually-verified-visitors.json'
OLD_AUDIT=STATE/'s9-manually-verified-visitors-audit.jsonl'
NEW=STATE/'s9-manual-recording-links-v1.json'
NEW_AUDIT=STATE/'s9-manual-recording-links-v1.audit.jsonl'
INDEX=STATE/'drive-security-archive.json'
FILES=(OLD,OLD_AUDIT,NEW,NEW_AUDIT,INDEX)
MAX_BYTES=6_000_000

def load(path, fallback):
    if path.is_symlink():raise RuntimeError('unsafe_symlink')
    if not path.exists():return fallback
    if not path.is_file() or path.stat().st_size>MAX_BYTES:raise RuntimeError('unsafe_state_file')
    value=json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value,type(fallback)):raise RuntimeError('invalid_state_format')
    return value

def audit(path):
    if path.is_symlink():raise RuntimeError('unsafe_audit_symlink')
    if not path.exists():return []
    if path.stat().st_size>MAX_BYTES:raise RuntimeError('audit_too_large')
    rows=[]
    for line in path.read_text(encoding='utf-8').splitlines():
        item=json.loads(line)
        if isinstance(item,dict):rows.append(item)
    return rows

def snapshot(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size>MAX_BYTES:return None
    try:
        val=json.loads(path.read_text(encoding='utf-8'))
        if isinstance(val,dict):return val
    except (ValueError,OSError,UnicodeError):return None

def main():
    idx=load(INDEX,{})
    verified={}
    for row in idx.get('items',[]):
        if not isinstance(row,dict) or row.get('state')!='verified':continue
        camera,name=row.get('camera'),row.get('remote_name')
        if camera not in ('new','s3') or not isinstance(name,str):continue
        key=hashlib.sha256((camera+'\\0'+name).encode()).hexdigest()
        verified[key]=(camera,name)
    garden_names={name for camera,name in verified.values() if camera=='new'}
    new=load(NEW,{'revision':0,'items':{}})
    current=new.get('items',{})
    if not isinstance(current,dict):raise RuntimeError('bad_new_registry')
    old=load(OLD,{'links':{},'visitors':{}})
    links=old.get('links',{})
    visitors=old.get('visitors',{})
    if not isinstance(links,dict) or not isinstance(visitors,dict):raise RuntimeError('bad_old_registry')
    old_history=audit(OLD_AUDIT)
    new_history=audit(NEW_AUDIT)
    old_active={key:who for key,who in links.items()
        if key in verified and isinstance(who,str) and who in visitors}
    prior_reviewed={key:who for key,who in old_active.items() if verified[key][0]=='new'}
    current_drive={key[6:]:entry for key,entry in current.items() if
        isinstance(key,str) and key.startswith('drive:') and isinstance(entry,dict)}
    assigned_current={name:entry for name,entry in current_drive.items() if entry.get('folder')}
    missing_from_modern={key:who for key,who in prior_reviewed.items()
        if verified[key][1] not in assigned_current}
    audits=collections.Counter(str(x.get('action','unknown')) for x in new_history)
    old_actions=collections.Counter(str(x.get('action','unknown')) for x in old_history)
    restored_audit={}
    for row in old_history:
        key=row.get('clip_id') or row.get('key')
        if isinstance(key,str) and key in verified:
            restored_audit[key]=row
    backup_stats=collections.Counter()
    backup_candidates=[]
    for root,dirs,files in os.walk(BASE/'backups',followlinks=False):
        dirs[:]=[n for n in dirs if not (Path(root)/n).is_symlink()]
        if len(backup_candidates)>=100:break
        for n in files:
            if n not in (NEW.name, OLD.name):continue
            p=Path(root)/n
            obj=snapshot(p)
            if obj is None:continue
            links_obj=obj.get('items' if n==NEW.name else 'links',{})
            if not isinstance(links_obj,dict):continue
            candidate=sum(1 for key,v in links_obj.items()
                if isinstance(v,dict) and v.get('folder') and key.startswith('drive:')) if n==NEW.name else len(links_obj)
            backup_candidates.append((n,candidate))
    for basename,count in backup_candidates:
        backup_stats[('new' if basename==NEW.name else 'legacy')+'_snapshots']+=1
        if count:backup_stats[('new' if basename==NEW.name else 'legacy')+'_nonempty']+=1
    result={
        'status':'read_only',
        'verified_historical_main':len(garden_names),
        'current_revision':new.get('revision'),
        'current_total_entries':len(current),
        'current_drive_entries':len(current_drive),
        'current_drive_assigned':len(assigned_current),
        'current_drive_missing_from_catalog':sum(k not in garden_names for k in assigned_current),
        'historical_visitors_total':len(visitors),
        'historical_links_total':len(links),
        'historical_link_verified_main':len(prior_reviewed),
        'historical_link_verified_other_camera':len(old_active)-len(prior_reviewed),
        'historical_main_links_absent_from_new_person_folders':len(missing_from_modern),
        'legacy_audit_entries':len(old_history),
        'legacy_actions':dict(old_actions),
        'legacy_audit_verified_keys':len(restored_audit),
        'current_audit_entries':len(new_history),
        'current_actions':dict(audits),
        'private_backup_summary':dict(backup_stats),
        'auto_assignments_created':0,
        'media_files_accessed':0,
        'review_files_modified':0,
    }
    print('DRIVE_REVIEW_RECOVERY_V67 '+json.dumps(result,sort_keys=True),flush=True)

if __name__=='__main__':main()
