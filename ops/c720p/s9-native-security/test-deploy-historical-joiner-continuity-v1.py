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
            staged=stage/d.NAME;staged.write_bytes(CODE);staged.chmod(0o600)
            args=['deploy','--apply','--expected-worker-sha256',d.sha(worker.read_bytes()),'--helper-sha256',d.sha(CODE)]
            def command(argv,**kw):
                if argv[0]=='systemctl':return types.SimpleNamespace(returncode=3)
                if mode=='concurrent':worker.write_bytes(b'version=3\n')
                return types.SimpleNamespace(returncode=1 if mode=='failed' else 0,
                    stdout='' if mode=='failed' else 'JOINER_DRY_RUN {"eligible":0,"existing_complete":3}\n')
            with contextlib.ExitStack() as stack:
                for k,v in dict(ROOT=root,WORKER=worker,HELPER=helper,__file__=str(stage/'deploy.py')).items():
                    stack.enter_context(patch.object(d,k,v))
                stack.enter_context(patch.object(d,'camera',return_value={}))
                stack.enter_context(patch.object(d,'originals',return_value={'original':(10000,'sha')}))
                stack.enter_context(patch.object(d,'reviews',return_value={'reviews':'unchanged'}))
                stack.enter_context(patch.object(d.subprocess,'run',side_effect=command))
                stack.enter_context(patch('sys.argv',args))
                stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                if mode=='ok':d.main()
                else:
                    with self.assertRaises(RuntimeError):d.main()
            if mode=='ok':
                self.assertEqual(worker.read_bytes(),b'version=2\n');self.assertEqual(helper.read_bytes(),CODE)
                self.assertEqual(len(list(root.glob('backups/**/receipt.json'))),1)
            elif mode=='failed':
                self.assertEqual(worker.read_bytes(),b'version=1\n');self.assertFalse(helper.exists())
            else:
                self.assertEqual(worker.read_bytes(),b'version=3\n');self.assertTrue(helper.exists())

    def test_verified_dry_run_receipt(self):self.run_case('ok')
    def test_dry_run_failure_restores_exact_worker(self):self.run_case('failed')
    def test_concurrent_source_preserved_with_helper(self):self.run_case('concurrent')


if __name__=='__main__':unittest.main()
