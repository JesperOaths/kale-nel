#!/usr/bin/env python3
"""Scratch-only release and guarded rollback tests; no HA/service/network IO."""
import contextlib
import copy
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location('ui_release',HERE/'deploy-security-ui-release-v1.py')
release=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.stack=contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.base=Path(self.stack.enter_context(tempfile.TemporaryDirectory(dir=os.environ.get('C720P_TEST_TMPDIR'))))
        self.stage=self.base/'stage';self.stage.mkdir()
        self.targets={name:self.base/'config/www'/name if name=='c720p-surveillance.html'
                      else self.base/'config/www/frontyard-security-new'/name for name in release.NAMES}
        self.dashboard=self.base/'config/.storage/lovelace.c720p_hub'
        self.backups=self.base/'config/.security-ui-release-backups'
        for key,value in [('TARGETS',self.targets),('DASHBOARD',self.dashboard),('BACKUPS',self.backups)]:
            self.stack.enter_context(mock.patch.object(release,key,value))
        self.stack.enter_context(mock.patch.object(release,'sync_directory'))
        # Production runs on POSIX. Windows scratch tests exercise real replace
        # while emulating POSIX permission/owner reporting only.
        if os.name=='nt':
            self.stack.enter_context(mock.patch.object(release.os,'fchmod',lambda fd,mode:None,create=True))
            self.stack.enter_context(mock.patch.object(release.os,'getuid',lambda:0,create=True))
            self.stack.enter_context(mock.patch.object(release.os,'getgid',lambda:0,create=True))
            self.stack.enter_context(mock.patch.object(release.stat,'S_IMODE',lambda value:0o700 if stat.S_ISDIR(value) else 0o600))
        files=[]
        for name,target in self.targets.items():
            target.parent.mkdir(parents=True,exist_ok=True)
            before=('before '+name).encode();after=('after '+name).encode()
            target.write_bytes(before);(self.stage/name).write_bytes(after)
            files.append({'target':str(target),'staged':name,'before_sha256':release.sha(before),'after_sha256':release.sha(after)})
        self.manifest={'release':release.cache.RELEASE,'files':files}
        (self.stage/'manifest.json').write_bytes(release.encoded(self.manifest))
        self.dashboard.parent.mkdir(parents=True)
        self.doc={'version':1,'data':{'config':{'views':[
            {'path':'home','cards':[{'type':'iframe','url':'/local/unrelated.html?v=keep'}]},
            {'path':'front-yard-security','cards':[{'type':'iframe','url':release.cache.ENTRY+'?v=old'}]}]}}}
        self.dashboard.write_bytes(release.encoded(self.doc))
        self.before={str(p):p.read_bytes() for p in [*self.targets.values(),self.dashboard]}

    def digest(self):
        plan,_=release.prepare(self.stage)
        return release.sha(release.encoded(plan))

    def test_preflight_is_read_only_and_deterministic(self):
        first=self.digest();self.assertEqual(first,self.digest())
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.before,{str(p):p.read_bytes() for p in [*self.targets.values(),self.dashboard]})
        plan,_=release.prepare(self.stage)
        self.assertEqual(len(plan['files']),8)
        self.assertEqual(plan['dashboard_changed_paths'],[['data','config','views',1,'cards',0,'url']])

    def test_hash_and_allowlist_guards_refuse_source_drift(self):
        expected=self.digest()
        self.targets['security-hub-v30.js'].write_bytes(b'independent concurrent change')
        with self.assertRaisesRegex(RuntimeError,'concurrent_live_edit'):
            release.apply(self.stage,expected)
        self.assertFalse(self.backups.exists())
        self.targets['security-hub-v30.js'].write_bytes(self.before[str(self.targets['security-hub-v30.js'])])
        (self.stage/'security-hub-v30.js').write_bytes(b'unreviewed stage change')
        with self.assertRaisesRegex(RuntimeError,'staged_asset_changed'):
            self.digest()

    def test_changed_dashboard_invalidates_reviewed_plan_before_writes(self):
        expected=self.digest()
        changed=copy.deepcopy(self.doc);changed['data']['config']['views'][0]['title']='Other chat changed this'
        self.dashboard.write_bytes(release.encoded(changed))
        with self.assertRaisesRegex(RuntimeError,'release_plan_changed'):
            release.apply(self.stage,expected)
        self.assertFalse(self.backups.exists())

    def test_manifest_allowlist_rejects_foreign_or_duplicate_target(self):
        for kind in ('foreign','duplicate'):
            bad=copy.deepcopy(self.manifest)
            if kind=='foreign':bad['files'][0]['target']=str(self.base/'config/www/unrelated-owner.html')
            else:bad['files'][-1]=copy.deepcopy(bad['files'][0])
            (self.stage/'manifest.json').write_bytes(release.encoded(bad))
            with self.subTest(kind=kind):
                with self.assertRaisesRegex(RuntimeError,'unsafe_or_duplicate_release_target'):
                    self.digest()
                self.assertFalse(self.backups.exists())

    def test_apply_receipt_private_backups_and_explicit_guarded_rollback(self):
        result=release.apply(self.stage,self.digest())
        self.assertEqual(result['state'],'files_applied_restart_pending')
        self.assertFalse(result['services_restarted'])
        backup=Path(result['backup'])
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode),0o700)
        self.assertEqual(stat.S_IMODE(Path(result['receipt']).stat().st_mode),0o600)
        self.assertEqual(json.loads(self.dashboard.read_bytes()),release.cache.patch_dashboard(self.doc))
        for name,target in self.targets.items():
            self.assertEqual(target.read_bytes(),(self.stage/name).read_bytes())
            self.assertEqual((backup/name).read_bytes(),self.before[str(target)])
        rolled=release.rollback(result['receipt'])
        self.assertFalse(rolled['concurrent_conflicts_preserved'])
        self.assertEqual(self.before,{str(p):p.read_bytes() for p in [*self.targets.values(),self.dashboard]})

    def test_rollback_keeps_concurrent_edits_and_does_not_flag_already_before(self):
        result=release.apply(self.stage,self.digest())
        concurrent=self.targets['security-people-v45.js'];concurrent.write_bytes(b'newer owner code')
        untouched=self.targets['security-hub-v30.html'];untouched.write_bytes(self.before[str(untouched)])
        rolled=release.rollback(result['receipt'])
        self.assertEqual(rolled['concurrent_conflicts_preserved'],[str(concurrent)])
        self.assertEqual(concurrent.read_bytes(),b'newer owner code')
        self.assertEqual(untouched.read_bytes(),self.before[str(untouched)])

    def test_post_replace_directory_fsync_failure_restores_attempted_file(self):
        fired=[]
        def fail_once_after_replace(parent):
            if parent==self.dashboard.parent and not fired:
                fired.append(True)
                self.assertNotEqual(self.dashboard.read_bytes(),self.before[str(self.dashboard)])
                raise OSError('synthetic post-replace directory fsync failure')
        with mock.patch.object(release,'sync_directory',side_effect=fail_once_after_replace):
            with self.assertRaisesRegex(OSError,'post-replace'):
                release.apply(self.stage,self.digest())
        self.assertTrue(fired)
        self.assertEqual(self.before,{str(p):p.read_bytes() for p in [*self.targets.values(),self.dashboard]})
        receipt=json.loads(next(self.backups.glob('*/receipt.json')).read_bytes())
        self.assertEqual(receipt['state'],'apply_failed_code_rollback')
        self.assertIn(str(self.dashboard),receipt['restored'])
        self.assertFalse(receipt['concurrent_conflicts_preserved'])


if __name__=='__main__':unittest.main()
