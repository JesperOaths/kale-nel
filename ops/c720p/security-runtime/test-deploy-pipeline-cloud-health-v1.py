import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

s=importlib.util.spec_from_file_location('cloud_deploy',Path(__file__).with_name('deploy-pipeline-cloud-health-v1.py'))
d=importlib.util.module_from_spec(s);s.loader.exec_module(d)
CODE=b'SCHEMA="security_pipeline_cloud_health_v1"\ndef patch_publisher(s):return s.replace("version=1","version=2")\n'


@unittest.skipIf(os.name=='nt','POSIX installer metadata')
class Tests(unittest.TestCase):
    def case(self,mode):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);stage=root/'stage';stage.mkdir();(root/'bin').mkdir();(root/'state').mkdir()
            publisher=root/'bin/publisher.py';publisher.write_bytes(b'version=1\n');publisher.chmod(0o600)
            helper=root/'bin/s9_pipeline_cloud_health_v1.py'
            component=root/'bin/component.py';component.write_bytes(b'component=1\n');component.chmod(0o600)
            (stage/helper.name).write_bytes(CODE);(stage/helper.name).chmod(0o600)
            args=['deploy','--apply','--publisher-sha256',d.sha(publisher.read_bytes()),
                  '--helper-sha256',d.sha(CODE),'--component-sha256',d.sha(component.read_bytes())]
            def run(argv,**kw):
                if 'is-active' in argv:return types.SimpleNamespace(returncode=3)
                if mode=='concurrent':publisher.write_bytes(b'version=3\n')
                (root/'state/c720p-cloud-health-report.json').write_text(json.dumps({'post_ok':True,
                    'post_status':200,'security_pipeline':{'schema_version':'security_pipeline_cloud_health_v1','components':{}}}))
                return types.SimpleNamespace(returncode=1 if mode=='failure' else 0)
            with contextlib.ExitStack() as stack:
                for k,v in dict(ROOT=root,PUBLISHER=publisher,HELPER=helper,COMPONENT=component,__file__=str(stage/'deploy.py')).items():
                    stack.enter_context(patch.object(d,k,v))
                stack.enter_context(patch.object(d,'capture',return_value={}))
                stack.enter_context(patch.object(d.subprocess,'run',side_effect=run))
                stack.enter_context(patch('sys.argv',args))
                stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                if mode=='ok':d.main()
                else:
                    with self.assertRaises(RuntimeError):d.main()
            if mode=='ok':
                self.assertEqual(publisher.read_bytes(),b'version=2\n')
                self.assertTrue(helper.exists())
                self.assertEqual(len(list(root.glob('backups/**/receipt.json'))),1)
            elif mode=='failure':
                self.assertEqual(publisher.read_bytes(),b'version=1\n');self.assertFalse(helper.exists())
            else:
                self.assertEqual(publisher.read_bytes(),b'version=3\n');self.assertTrue(helper.exists())

    def test_successful_existing_sink_publication(self):self.case('ok')
    def test_failed_publication_restores_original_publisher(self):self.case('failure')
    def test_concurrent_newer_publisher_not_rolled_back(self):self.case('concurrent')


if __name__=='__main__':unittest.main()
