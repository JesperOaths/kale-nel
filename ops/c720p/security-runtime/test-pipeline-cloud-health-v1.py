import contextlib
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import s9_pipeline_cloud_health_v1 as h
s=importlib.util.spec_from_file_location('component_fixture',HERE/'test-security-component-health-v1.py')
f=importlib.util.module_from_spec(s);s.loader.exec_module(f)


class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=os.environ.get('C720P_TEST_TMPDIR'))
        self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.now=f.NOW
        for k,d in f.documents().items():self.write(f.FILES[k],d)
        self.queue={'schema':'s9_priority_rescan_feedback_v304','revision':11,
            'rows':[{'status':'blocked','clip_no':'PRIVATE_CLIP','person':'PRIVATE_PERSON'},
                    {'status':'completed','outcome':{'secret':'PRIVATE_TOKEN'}}]}
        self.write('s9-priority-rescan-v304/queue.json',self.queue)
        self.write('s9-manual-recording-links-v1.json',{'version':1,'revision':39,
            'items':{'PRIVATE_RECORDING':{'folder':'PRIVATE_PERSON'}}})
        self.s3={'checked_at_utc':self.now.isoformat(),'healthy':True,
                 'motion_analysis_active':True,'motion_health_verified':False,
                 'privacy_adb_port_closed_recently':True,'image':'PRIVATE_IMAGE'}
        self.write('s3-motion-health.json',self.s3)

    def write(self,p,d):
        path=self.root/p;path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(d));path.chmod(0o600)

    def test_real_producer_schemas_are_aggregated_without_private_fields(self):
        d=h.build(self.root,self.now);raw=json.dumps(d)
        self.assertNotIn('PRIVATE_',raw)
        self.assertEqual(d['rescan']['blocked'],1)
        self.assertEqual(d['rescan']['completed'],1)
        self.assertIsNone(d['rescan']['results_current_source_verified'])
        self.assertEqual(d['manual_binding']['without_reported_binding'],1)
        self.assertFalse(d['all_pipeline_paths_verified'])
        self.assertFalse(d['media_read']);self.assertFalse(d['workers_started'])

    def test_privacy_closed_s3_never_becomes_camera_health_pass(self):
        d=h.build(self.root,self.now)
        self.assertIsNone(d['s3']['healthy']);self.assertIsNone(d['s3']['motion_analysis_active'])
        self.assertIn('s3_motion_unverified',d['warnings'])

    def test_one_missing_report_does_not_hide_other_components(self):
        (self.root/'s9-priority-rescan-v304/queue.json').unlink()
        d=h.build(self.root,self.now)
        self.assertEqual(d['rescan'],{'state':'unavailable'})
        self.assertEqual(d['components']['infrastructure']['status'],'current')
        self.assertEqual(d['manual_binding']['decisions'],1)

    def test_bad_count_or_schema_is_unknown_not_zero_success(self):
        for change in ({'revision':True},{'rows':[{'status':'invented'}]},{'schema':'other'}):
            self.write('s9-priority-rescan-v304/queue.json',dict(self.queue,**change))
            self.assertEqual(h.build(self.root,self.now)['rescan'],{'state':'unavailable'})

    def test_duplicate_keys_and_nonfinite_json_rejected(self):
        p=self.root/'s9-priority-rescan-v304/queue.json'
        for text in ('{"revision":1,"revision":2}','{"a":NaN}'):
            p.write_text(text)
            self.assertEqual(h.build(self.root,self.now)['rescan'],{'state':'unavailable'})

    def test_stale_and_future_s3_reports_remain_distinct(self):
        self.write('s3-motion-health.json',dict(self.s3,checked_at_utc=(self.now-dt.timedelta(hours=2)).isoformat()))
        self.assertEqual(h.build(self.root,self.now)['s3']['state'],'stale')
        self.write('s3-motion-health.json',dict(self.s3,checked_at_utc=(self.now+dt.timedelta(hours=2)).isoformat()))
        self.assertEqual(h.build(self.root,self.now)['s3']['state'],'unavailable')

    @unittest.skipIf(os.name=='nt','POSIX symlink/FIFO')
    def test_symlink_directory_and_fifo_refused_without_blocking(self):
        p=self.root/'s9-priority-rescan-v304/queue.json';p.unlink();os.mkfifo(p,0o600)
        self.assertEqual(h.build(self.root,self.now)['rescan'],{'state':'unavailable'})
        p.unlink();p.parent.rmdir();p.parent.symlink_to(self.root)
        self.assertEqual(h.build(self.root,self.now)['rescan'],{'state':'unavailable'})

    def test_patch_is_additive_and_unavailable_projection_does_not_break_publisher(self):
        source='TOKEN="UNCHANGED"\ndef person_summary():return {}\ndef main():\n    return {\n      \'person_detection\':person_summary(),\n    }\n'
        after=h.patch_publisher(source)
        self.assertIn('TOKEN="UNCHANGED"',after)
        namespace={};exec(compile(after,'synthetic-publisher','exec'),namespace)
        with patch.object(h,'build',side_effect=RuntimeError('PRIVATE_ERROR')):
            d=namespace['main']()
        self.assertEqual(d['person_detection'],{})
        self.assertEqual(d['security_pipeline']['status'],'unavailable')
        self.assertNotIn('PRIVATE_ERROR',json.dumps(d))
        with self.assertRaises(ValueError):h.patch_publisher(after)


if __name__=='__main__':unittest.main()
