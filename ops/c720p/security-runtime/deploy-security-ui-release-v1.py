#!/usr/bin/env python3
"""Guarded file-only UI/cache release INSIDE the Home Assistant container.

Default preflight reads only. Root owns docker cp/exec and a later HA restart.
No HTTP, camera operation, service restart, review write or credentials needed.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile

import security_cache_release_v1 as cache

WEB = Path('/config/www')
DASHBOARD = Path('/config/.storage/lovelace.c720p_hub')
BACKUPS = Path('/config/.security-ui-release-backups')
NAMES = ('c720p-surveillance.html', 'security-hub-v30.html', 'security-hub-v30.js',
         'security-people-v50.html', 'security-people-v45.js', 'security-review-v8.html',
         's9-night-visibility-v1.js')
TARGETS = {name: WEB/name if name == 'c720p-surveillance.html' else WEB/'frontyard-security-new'/name
           for name in NAMES}
SCHEMA = 'security_ui_release_plan_v1'
SHA = re.compile(r'[a-f0-9]{64}\Z')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n').encode('utf-8')


def read_regular(path, limit=3_000_000):
    if path.is_symlink() or not path.is_file():
        raise RuntimeError('not_regular_file:' + path.name)
    metadata = path.stat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > limit:
        raise RuntimeError('unbounded_file:' + path.name)
    raw = path.read_bytes()
    if len(raw) > limit:
        raise RuntimeError('unbounded_file:' + path.name)
    return raw, {'mode': stat.S_IMODE(metadata.st_mode), 'uid': metadata.st_uid, 'gid': metadata.st_gid}


def differences(before, after, path=()):
    if type(before) is not type(after):
        return [path]
    if isinstance(before, dict):
        if before.keys() != after.keys():
            return [path]
        return [p for key in before for p in differences(before[key], after[key], path+(key,))]
    if isinstance(before, list):
        if len(before) != len(after):
            return [path]
        return [p for i, (a, b) in enumerate(zip(before, after)) for p in differences(a, b, path+(i,))]
    return [] if before == after else [path]


def dashboard_bytes(raw, release_key=cache.RELEASE):
    cache.validate_release(release_key)
    before = json.loads(raw)
    after = cache.patch_dashboard(before, release=release_key)
    changed = differences(before, after)
    if changed:
        if len(changed) != 1:
            raise RuntimeError('dashboard_changed_beyond_one_value')
        path = changed[0]
        prefix = ('data', 'config', 'views')
        if path[:3] != prefix or len(path) < 7 or path[4] != 'cards' or path[-1] != 'url':
            raise RuntimeError('unexpected_dashboard_change_path')
        view = before['data']['config']['views'][path[3]]
        if view.get('path') != cache.SECURITY_VIEW_PATH:
            raise RuntimeError('wrong_dashboard_view_changed')
        old, new = before, after
        for key in path:
            old, new = old[key], new[key]
        if new != cache.release_url(old, cache.ENTRY, release=release_key):
            raise RuntimeError('unexpected_dashboard_url_change')
        return encoded(after), [list(path)]
    # An already released dashboard retains its exact original serialization.
    return raw, []


def prepare(stage, release_key=cache.RELEASE):
    cache.validate_release(release_key)
    stage = Path(stage).resolve(strict=True)
    if not stage.is_dir():
        raise RuntimeError('invalid_stage_directory')
    manifest_raw, _ = read_regular(stage/'manifest.json', 100_000)
    manifest = json.loads(manifest_raw)
    if (not isinstance(manifest, dict) or manifest.get('release') != release_key
            or not isinstance(manifest.get('files'), list) or len(manifest['files']) != len(NAMES)):
        raise RuntimeError('invalid_release_manifest')
    prepared, entries = {}, []
    for item in manifest['files']:
        if not isinstance(item, dict) or set(item) != {'target','staged','before_sha256','after_sha256'}:
            raise RuntimeError('invalid_manifest_entry')
        name = item['staged']
        if name not in TARGETS or item['target'] != str(TARGETS[name]) or name in prepared:
            raise RuntimeError('unsafe_or_duplicate_release_target')
        if any(not isinstance(item[k], str) or not SHA.fullmatch(item[k]) for k in ('before_sha256','after_sha256')):
            raise RuntimeError('invalid_manifest_hash')
        source, _ = read_regular(stage/name)
        if sha(source) != item['after_sha256']:
            raise RuntimeError('staged_asset_changed:' + name)
        old, metadata = read_regular(TARGETS[name])
        if sha(old) not in (item['before_sha256'], item['after_sha256']):
            raise RuntimeError('concurrent_live_edit:' + name)
        prepared[name] = {'path':TARGETS[name], 'old':old, 'new':source, 'metadata':metadata}
        entries.append({'target':str(TARGETS[name]), 'backup_name':name,
                        'before_sha256':sha(old), 'after_sha256':sha(source),
                        'changed':old != source, 'metadata':metadata})
    if set(prepared) != set(NAMES):
        raise RuntimeError('missing_release_target')
    old, metadata = read_regular(DASHBOARD)
    new, paths = dashboard_bytes(old, release_key)
    prepared[DASHBOARD.name] = {'path':DASHBOARD, 'old':old, 'new':new, 'metadata':metadata}
    entries.append({'target':str(DASHBOARD), 'backup_name':DASHBOARD.name,
                    'before_sha256':sha(old), 'after_sha256':sha(new),
                    'changed':old != new, 'metadata':metadata})
    plan = {'schema':SCHEMA, 'release':release_key, 'manifest_sha256':sha(manifest_raw),
            'deployer_sha256':sha(Path(__file__).read_bytes()),
            'cache_helper_sha256':sha(Path(cache.__file__).read_bytes()),
            'files':sorted(entries, key=lambda x:x['target']), 'dashboard_changed_paths':paths,
            'services_restarted':False, 'restart_required_after_apply':any(x['changed'] for x in entries)}
    return plan, prepared


def sync_directory(path):
    flags = getattr(os, 'O_DIRECTORY', 0)
    fd = os.open(path, os.O_RDONLY | flags)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic(path, raw, metadata):
    fd, temporary = tempfile.mkstemp(prefix='.security-ui-release-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as target:
            if hasattr(os, 'fchown'):
                os.fchown(target.fileno(), metadata['uid'], metadata['gid'])
            os.fchmod(target.fileno(), metadata['mode'])
            target.write(raw)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def private_write(path, raw):
    # Every receipt/backup is private, independent of the live asset's mode.
    atomic(path, raw, {'mode':0o600, 'uid':os.getuid(), 'gid':os.getgid()})


def current_matches(entry, expected):
    try:
        raw, metadata = read_regular(Path(entry['target']))
        return sha(raw) == expected and metadata == entry['metadata']
    except (OSError, RuntimeError):
        return False


def rollback_entries(entries, backup):
    restored, conflicts = [], []
    for entry in reversed(entries):
        if not entry['changed']:
            continue
        if current_matches(entry, entry['before_sha256']):
            continue
        if not current_matches(entry, entry['after_sha256']):
            conflicts.append(entry['target'])
            continue
        original, _ = read_regular(backup/entry['backup_name'])
        if sha(original) != entry['before_sha256']:
            raise RuntimeError('rollback_backup_changed:' + entry['backup_name'])
        atomic(Path(entry['target']), original, entry['metadata'])
        restored.append(entry['target'])
    return restored, conflicts


def apply(stage, expected_plan_sha256, release_key=cache.RELEASE):
    plan, prepared = prepare(stage, release_key)
    digest = sha(encoded(plan))
    if digest != expected_plan_sha256:
        raise RuntimeError('release_plan_changed')
    changed = [e for e in plan['files'] if e['changed']]
    if not changed:
        return {'release':release_key, 'state':'already_applied', 'plan_sha256':digest,
                'services_restarted':False, 'restart_required':False}
    if BACKUPS.is_symlink():
        raise RuntimeError('unsafe_backup_root')
    BACKUPS.mkdir(mode=0o700, exist_ok=True)
    if stat.S_IMODE(BACKUPS.stat().st_mode) != 0o700:
        raise RuntimeError('backup_root_not_private')
    backup = BACKUPS/dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(mode=0o700)
    for entry in changed:
        item = prepared[entry['backup_name']]
        if not current_matches(entry, entry['before_sha256']):
            raise RuntimeError('concurrent_edit_before_backup:' + item['path'].name)
        private_write(backup/entry['backup_name'], item['old'])
    private_write(backup/'plan.json', encoded(plan))
    receipt = {'schema':SCHEMA, 'release':release_key, 'state':'prepared',
               'created_at_utc':dt.datetime.now(dt.timezone.utc).isoformat(),
               'plan_sha256':digest, 'backup':str(backup), 'files':plan['files'],
               'dashboard_changed_paths':plan['dashboard_changed_paths'],
               'services_restarted':False, 'restart_required':True}
    receipt_path = backup/'receipt.json'
    private_write(receipt_path, encoded(receipt))
    touched = []
    try:
        for entry in changed:
            item = prepared[entry['backup_name']]
            if not current_matches(entry, entry['before_sha256']):
                raise RuntimeError('concurrent_edit_before_write:' + item['path'].name)
            touched.append(entry)
            atomic(item['path'], item['new'], item['metadata'])
        for entry in plan['files']:
            if not current_matches(entry, entry['after_sha256']):
                raise RuntimeError('source_changed_after_apply:' + entry['backup_name'])
        receipt['state'] = 'files_applied_restart_pending'
        private_write(receipt_path, encoded(receipt))
        return dict(receipt, receipt=str(receipt_path))
    except Exception:
        restored, conflicts = rollback_entries(touched, backup)
        receipt.update(state='apply_failed_code_rollback', restored=restored, concurrent_conflicts_preserved=conflicts)
        private_write(receipt_path, encoded(receipt))
        raise


def rollback(receipt_path, release_key=cache.RELEASE):
    cache.validate_release(release_key)
    receipt_path = Path(receipt_path)
    resolved = receipt_path.resolve(strict=True)
    if (receipt_path.is_symlink() or resolved.name != 'receipt.json'
            or BACKUPS.resolve() not in resolved.parents or resolved.parent.parent != BACKUPS.resolve()):
        raise RuntimeError('unsafe_rollback_receipt_path')
    receipt_raw, _ = read_regular(resolved)
    if stat.S_IMODE(resolved.stat().st_mode) != 0o600 or stat.S_IMODE(resolved.parent.stat().st_mode) != 0o700:
        raise RuntimeError('rollback_receipt_not_private')
    receipt = json.loads(receipt_raw)
    plan_raw, _ = read_regular(resolved.parent/'plan.json')
    plan = json.loads(plan_raw)
    if (receipt.get('schema') != SCHEMA or receipt.get('release') != release_key
            or plan.get('schema') != SCHEMA or plan.get('release') != release_key
            or receipt.get('backup') != str(resolved.parent)
            or sha(encoded(plan)) != receipt.get('plan_sha256') or receipt.get('files') != plan.get('files')):
        raise RuntimeError('rollback_receipt_contract_changed')
    allowed = {str(p):n for n,p in TARGETS.items()} | {str(DASHBOARD):DASHBOARD.name}
    if len(plan['files']) != len(allowed) or {e['target'] for e in plan['files']} != set(allowed):
        raise RuntimeError('invalid_rollback_target_set')
    for entry in plan['files']:
        if entry.get('backup_name') != allowed.get(entry.get('target')):
            raise RuntimeError('unsafe_rollback_backup_name')
    restored, conflicts = rollback_entries(plan['files'], resolved.parent)
    receipt.update(state='code_rollback_restart_pending', restored=restored,
                   concurrent_conflicts_preserved=conflicts, services_restarted=False,
                   restart_required=bool(restored))
    private_write(resolved, encoded(receipt))
    return dict(receipt, receipt=str(resolved))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', type=Path)
    parser.add_argument('--release', default=cache.RELEASE,
                        help='Explicit reviewed release/cache key; defaults to the original continuity release')
    parser.add_argument('--expected-plan-sha256')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--rollback', type=Path)
    args = parser.parse_args()
    cache.validate_release(args.release)
    if args.rollback:
        if args.stage or args.apply or args.expected_plan_sha256:
            parser.error('--rollback cannot be combined with stage/apply')
        result = rollback(args.rollback, args.release)
        print(json.dumps(result, sort_keys=True))
        return 2 if result['concurrent_conflicts_preserved'] else 0
    if not args.stage:
        parser.error('--stage is required')
    plan, _ = prepare(args.stage, args.release)
    digest = sha(encoded(plan))
    if not args.apply:
        print(json.dumps({'plan_sha256':digest, 'plan':plan}, sort_keys=True))
        return 0
    if not args.expected_plan_sha256 or not SHA.fullmatch(args.expected_plan_sha256):
        parser.error('--apply requires the reviewed --expected-plan-sha256')
    print(json.dumps(apply(args.stage, args.expected_plan_sha256, args.release), sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
