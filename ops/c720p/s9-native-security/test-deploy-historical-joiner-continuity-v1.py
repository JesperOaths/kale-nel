import contextlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('joiner_deploy',Path(__file__).with_name('deploy-historical-joiner-continuity-v1.py'))
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
CODE=b'''import contextlib
def safe(s):return True
def reserves():return True
def patch_worker(source):return source.replace('version=1','version=2')
def patch_retry_worker(source):return source.replace('version=1','version=2')
@contextlib.contextmanager
def exclusion():yield
'''


@unittest.skipIf(os.name=='nt','POSIX installer metadata and fsync')
class Tests(unittest.TestCase):
    def run_case(self,mode):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);stage=root/'stage';stage.mkdir();(root/'bin').mkdir()
            worker=root/'bin/s9-complete-worker-v1.py';worker.write_bytes(b'version=1\n');worker.chmod(0o600)
            helper=root/'bin'/d.NAME
            upgrading=mode.startswith('upgrade')
            if upgrading:helper.write_bytes(b'# previous helper\n');helper.chmod(0o600)
            staged=stage/d.NAME;staged.write_bytes(CODE);staged.chmod(0o600)
            args=['deploy','--apply','--expected-worker-sha256',d.sha(worker.read_bytes()),'--helper-sha256',d.sha(CODE)]
            if upgrading:args+=['--retry-policy','--expected-helper-sha256',d.sha(helper.read_bytes())]
            def command(argv,**kw):
                if argv[0]=='systemctl':return types.SimpleNamespace(returncode=3)
                if mode=='concurrent':worker.write_bytes(b'version=3\n')
                failed=mode in ('failed','upgrade-failed')
                return types.SimpleNamespace(returncode=1 if failed else 0,
                    stdout='' if failed else 'JOINER_DRY_RUN {"eligible":0,"existing_complete":3}\n')
            with contextlib.ExitStack() as stack:
                for k,v in dict(ROOT=root,WORKER=worker,HELPER=helper,__file__=str(stage/'deploy.py')).items():
                    stack.enter_context(patch.object(d,k,v))
                stack.enter_context(patch.object(d,'camera',return_value={}))
                stack.enter_context(patch.object(d,'originals',return_value={'original':(10000,'sha')}))
                stack.enter_context(patch.object(d,'reviews',return_value={'reviews':'unchanged'}))
                stack.enter_context(patch.object(d.subprocess,'run',side_effect=command))
                stack.enter_context(patch('sys.argv',args))
                stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                if mode in ('ok','upgrade-ok'):d.main()
                else:
                    with self.assertRaises(RuntimeError):d.main()
            if mode in ('ok','upgrade-ok'):
                self.assertEqual(worker.read_bytes(),b'version=2\n');self.assertEqual(helper.read_bytes(),CODE)
                self.assertEqual(len(list(root.glob('backups/**/receipt.json'))),1)
            elif mode in ('failed','upgrade-failed'):
                self.assertEqual(worker.read_bytes(),b'version=1\n')
                if upgrading:self.assertEqual(helper.read_bytes(),b'# previous helper\n')
                else:self.assertFalse(helper.exists())
            else:
                self.assertEqual(worker.read_bytes(),b'version=3\n');self.assertTrue(helper.exists())

    def test_verified_dry_run_receipt(self):self.run_case('ok')
    def test_dry_run_failure_restores_exact_worker(self):self.run_case('failed')
    def test_concurrent_source_preserved_with_helper(self):self.run_case('concurrent')
    def test_retry_policy_upgrade_preserves_previous_helper_backup(self):self.run_case('upgrade-ok')
    def test_failed_retry_upgrade_restores_worker_and_previous_helper(self):self.run_case('upgrade-failed')


if __name__=='__main__':unittest.main()
