#!/usr/bin/env python3
"""Offline trust-boundary and observation-only cleanup tests; no device use."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

BASE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('v304_loader_tests',BASE.parent/'s9_priority_rescan_feedback_v304.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)

class RuntimeFixture:
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.paths={}
        for name in ('runner','coordinator','observer'):
            filename={'runner':'s9_phone_gap_runner_v371.py',
                      'coordinator':'s9_phone_gap_coordinator_v371.py',
                      'observer':'s9_phone_first_peak_observer_v373.py'}[name]
            self.paths[name]=self.root/filename
            shutil.copyfile(BASE/filename,self.paths[name])
            self.paths[name].chmod(0o600)
        self.release=self.root/'release.json'
        self.doc={'schema':'task9_phone_first_enrolled_release_v371','active':True,
            'authorization_basis':'user_explicit_guarded_task9_20261021',
            'camera2_apk_unchanged':True,'approval_record':'synthetic protected runtime fixture',
            'phone_frame_jar_sha256':'a'*64,'min_phone_mem_available_kib':1536*1024,
            'min_phone_sd_free_bytes':20*1024**3,'protected_runtime_reserve_kib':512*1024,
            'source_reader':'s9_source_current_priority_reader_v369',
            'consumer':'s9_anonymous_quality_consumption_v361'}
        for name,path in self.paths.items():
            self.doc[name+'_sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
        self.write_release()
        for name,path in [('PHONE_RELEASE',self.release),('PHONE_RUNNER',self.paths['runner']),
                          ('PHONE_COORDINATOR',self.paths['coordinator']),('PHONE_OBSERVER',self.paths['observer'])]:
            p=patch.object(v,name,path);p.start();self.addCleanup(p.stop)
    def write_release(self):
        self.release.write_text(json.dumps(self.doc));self.release.chmod(0o600)

class ProtectedRuntimeTests(RuntimeFixture,unittest.TestCase):
    def test_valid_exact_sources_load_without_any_hardware(self):
        runner,cfg=v.load_phone_runtime()
        self.assertEqual(cfg,self.doc)
        self.assertEqual(runner.frames.MODEL_SHA,v.MODEL_SHA)
        self.assertIsNotNone(runner.observer)
    def test_any_tampered_module_is_rejected_before_any_execution(self):
        for name in self.paths:
            with self.subTest(name=name):
                path=self.paths[name];raw=path.read_bytes()
                marker=self.root/('executed-'+name)
                path.write_text('from pathlib import Path\nPath('+repr(str(marker))+').touch()\n'+raw.decode())
                with self.assertRaisesRegex(v.Refusal,'hash_not_approved'):
                    v.load_phone_runtime()
                self.assertFalse(marker.exists())
                path.write_bytes(raw)
    def test_unapproved_release_refuses_before_execution(self):
        self.doc['active']=False;self.write_release()
        with self.assertRaisesRegex(v.Refusal,'release_not_approved'):
            v.load_phone_runtime()
    def test_manifest_mode_symlink_and_hardlink_refused(self):
        self.release.chmod(0o644)
        with self.assertRaises(v.Refusal):v.load_phone_runtime()
        self.release.chmod(0o600)
        link=self.root/'link';link.symlink_to(self.release)
        with patch.object(v,'PHONE_RELEASE',link),self.assertRaises(v.Refusal):
            v.load_phone_runtime()
        link.unlink();os.link(self.release,link)
        with self.assertRaises(v.Refusal):v.load_phone_runtime()
    def test_poisoned_coordinator_import_cache_is_ignored(self):
        poisoned=types.ModuleType('s9_phone_gap_coordinator_v371')
        poisoned.MODEL_SHA='unapproved'
        with patch.dict(sys.modules,{'s9_phone_gap_coordinator_v371':poisoned}):
            runner,_=v.load_phone_runtime()
        self.assertIsNot(runner.frames,poisoned)
        self.assertEqual(runner.frames.MODEL_SHA,v.MODEL_SHA)
    def test_path_substitution_after_fd_read_does_not_execute_replacement(self):
        original=v.protected_phone_bytes
        for name,target in self.paths.items():
            with self.subTest(module=name):
                before=target.read_bytes();marker=self.root/('replacement-executed-'+name)
                def read(path,*args,**kwargs):
                    raw=original(path,*args,**kwargs)
                    if path==target:
                        path.write_text('from pathlib import Path\nPath('+repr(str(marker))+').touch()\n')
                    return raw
                with patch.object(v,'protected_phone_bytes',side_effect=read):
                    runner,_=v.load_phone_runtime()
                self.assertFalse(marker.exists())
                self.assertEqual(runner.frames.MODEL_SHA,v.MODEL_SHA)
                target.write_bytes(before)
    def test_runtime_policy_uses_verified_release_not_second_path_read(self):
        original=v.protected_phone_bytes
        def read(path,*args,**kwargs):
            raw=original(path,*args,**kwargs)
            if path==self.paths['runner']:
                self.release.write_text('{}')
            return raw
        with patch.object(v,'protected_phone_bytes',side_effect=read):
            _,cfg=v.load_phone_runtime()
        self.assertEqual(cfg,self.doc)

class ObserveOnlyCleanupTests(RuntimeFixture,unittest.TestCase):
    def exercise_cleanup(self,states):
        runner,release=v.load_phone_runtime()
        row={'clip_no':'motion_1792095266692.mp4','source':'s9_original_4k_microsd',
            'source_bytes':48831739,'source_sha256':'a'*64,'media_revision':'b'*64,
            'model_sha256':runner.frames.MODEL_SHA,
            'native_pass':'s9_onphone_36_samples_overlapping_tiles_v5',
            'required_analysis':runner.frames.ANALYSIS,'priority_reason':'no_indexed_image'}
        expected=runner.observer.required_args(row['clip_no'],row['source_sha256'],row['source_bytes'],row['media_revision'],2000)
        calls=[];remaining=iter(states)
        def adb(*args,**kwargs):
            calls.append(args)
            if args==('shell','ps -A -o PID,ARGS'):
                state=next(remaining)
                if isinstance(state,Exception):raise state
                if state=='absent':return 'PID ARGS\n1234 /system/bin/nl.kalenel.s9security\n'
                if state=='bad':return 'unsupported ps format'
                return 'PID ARGS\n4321 app_process /system/bin '+' '.join(expected)+'\n'
            if args==('shell','cat /proc/4321/stat'):
                return '4321 (app_process) '+' '.join(['S']+['0']*18+['10020']+['0']*5)
            if args==('shell','cat /proc/4321/cmdline'):return 'app_process /system/bin '+' '.join(expected)
            if args==('shell','cat /proc/4321/status'):return 'VmRSS: 250000 kB\nVmHWM: 330000 kB\n'
            if args==('shell','cat /proc/meminfo'):return 'MemAvailable: 2300000 kB\n'
            if args==('shell','pidof nl.kalenel.s9security'):return '1234'
            raise AssertionError('unexpected non-observation command: '+repr(args))
        def supervise(**kwargs):
            kwargs['cleanup_remote'](None,expected,False)
            return runner.PREFIX+'{"schema":"synthetic"}',{'sample_count':1,'worker_vm_hwm_peak_kib':330000}
        try:
            with patch.object(runner,'adb',side_effect=adb),patch.object(runner.observer,'supervise',side_effect=supervise):
                result=runner.phone_probe(row,2000,60,release,recorder_pid='1234',camera_guard=lambda:None)
            return result,calls
        finally:
            self.assertFalse(any('kill' in str(args) for args in calls),'Android signal command attempted')
    def test_two_absence_reads_and_same_recorder_accept_cleanup(self):
        result,calls=self.exercise_cleanup(['absent','absent'])
        self.assertEqual(result['schema'],'synthetic')
        self.assertEqual(sum(args==('shell','ps -A -o PID,ARGS') for args in calls),2)
    def test_live_worker_refuses_without_signaling(self):
        with self.assertRaisesRegex(Exception,'remote_phone_worker_not_yet_gone'):
            self.exercise_cleanup(['present'])
    def test_second_observation_failure_cannot_qualify(self):
        with self.assertRaises(Exception):self.exercise_cleanup(['absent','bad'])
    def test_disconnect_after_first_absence_cannot_qualify(self):
        with self.assertRaises(Exception):self.exercise_cleanup(['absent',OSError('synthetic disconnect')])

class InflightFenceTests(RuntimeFixture,unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.marker=self.root/'private-state'/'phone-inflight-v374.json'
        self.runner,self.release_cfg=v.load_phone_runtime()
        self.row={'clip_no':'motion_1792095266692.mp4','source':'s9_original_4k_microsd',
            'source_bytes':48831739,'source_sha256':'a'*64,'media_revision':'b'*64,
            'model_sha256':self.runner.frames.MODEL_SHA,
            'native_pass':'s9_onphone_36_samples_overlapping_tiles_v5',
            'required_analysis':self.runner.frames.ANALYSIS,'priority_reason':'no_indexed_image'}
    def test_marker_is_private_and_prevents_second_begin(self):
        payload=self.runner.begin_inflight(self.marker,self.row,2000)
        self.assertEqual(self.marker.stat().st_mode&0o777,0o600)
        self.assertEqual(self.marker.parent.stat().st_mode&0o777,0o700)
        with self.assertRaises(self.runner.frames.Deferred):
            self.runner.begin_inflight(self.marker,self.row,2000)
        self.assertEqual(self.marker.read_bytes(),payload)
    def test_direct_probe_without_fence_cannot_launch_real_transport(self):
        def monitor(**kw):
            return kw['start'](kw['argv'],stdout=None,stderr=None,text=True)
        with patch.object(self.runner.observer,'supervise',side_effect=monitor),\
             patch.object(self.runner.subprocess,'Popen') as launch:
            with self.assertRaisesRegex(self.runner.frames.Deferred,'durable_inflight_fence'):
                self.runner.phone_probe(self.row,2000,60,self.release_cfg,
                    recorder_pid='1234',camera_guard=lambda:None)
        launch.assert_not_called()
    def test_unknown_attempt_blocks_readiness_before_any_phone_read(self):
        self.runner.begin_inflight(self.marker,self.row,2000)
        with patch.object(self.runner,'INFLIGHT',self.marker),patch.object(self.runner,'adb') as adb:
            with self.assertRaisesRegex(self.runner.frames.Deferred,'reconciliation'):
                self.runner.phone_readiness(self.release_cfg)
            adb.assert_not_called()
    def test_monitor_failure_leaves_durable_fence(self):
        with patch.object(self.runner.observer,'supervise',side_effect=self.runner.observer.Unqualified('synthetic timeout')):
            with self.assertRaises(self.runner.frames.Deferred):
                self.runner.phone_probe(self.row,2000,60,self.release_cfg,
                    recorder_pid='1234',camera_guard=lambda:None,_inflight_path=self.marker)
        self.assertTrue(self.marker.is_file())
        with patch.object(self.runner,'INFLIGHT',self.marker):
            with self.assertRaises(self.runner.frames.Deferred):self.runner.ensure_no_inflight()
    def test_normal_verified_completion_clears_own_fence_and_enrolls_watchdog_budget(self):
        called=[]
        def monitor(**kw):
            self.assertTrue(self.marker.is_file(),'fence absent before launch')
            called.append(kw)
            return self.runner.PREFIX+'{"schema":"synthetic"}',{'sample_count':1,'worker_vm_hwm_peak_kib':330000}
        with patch.object(self.runner.observer,'supervise',side_effect=monitor):
            self.runner.phone_probe(self.row,2000,60,self.release_cfg,
                recorder_pid='1234',camera_guard=lambda:None,_inflight_path=self.marker)
        self.assertFalse(self.marker.exists())
        self.assertGreater(called[0]['frame_budget_seconds'],0)
        self.assertLessEqual(called[0]['frame_budget_seconds'],60)
        self.assertIn('export TASK9_FRAME_BUDGET_MS=',called[0]['argv'][-1])
    def test_failed_completion_cannot_clear_changed_fence(self):
        payload=self.runner.begin_inflight(self.marker,self.row,2000)
        self.marker.write_bytes(payload.replace(b'2000',b'6000'))
        with self.assertRaisesRegex(self.runner.frames.Deferred,'marker_changed'):
            self.runner.finish_inflight(self.marker,payload)
        self.assertTrue(self.marker.exists())
    def test_watchdog_budget_recomputed_at_actual_launch_after_guard(self):
        now=[0.0];launches=[]
        def monitor(**kw):
            now[0]=10.0
            kw['start'](kw['argv'],stdout=None,stderr=None,text=True)
            return self.runner.PREFIX+'{"schema":"synthetic"}',{'sample_count':1,'worker_vm_hwm_peak_kib':330000}
        def launch(argv,**kwargs):launches.append(argv);return object()
        with patch.object(self.runner.time,'monotonic',side_effect=lambda:now[0]),\
             patch.object(self.runner.observer,'supervise',side_effect=monitor),\
             patch.object(self.runner.subprocess,'Popen',side_effect=launch):
            self.runner.phone_probe(self.row,2000,60,self.release_cfg,
                recorder_pid='1234',camera_guard=lambda:None,_inflight_path=self.marker)
        self.assertIn('export TASK9_FRAME_BUDGET_MS=50000;',launches[0][-1])

class CallbackBudgetTests(RuntimeFixture,unittest.TestCase):
    def test_expired_adb_budget_does_not_start_command(self):
        runner,_=v.load_phone_runtime()
        with patch.object(runner.time,'monotonic',return_value=10),patch.object(runner,'adb') as adb:
            with self.assertRaises(runner.frames.Deferred):
                runner.timed_adb('get-state',deadline=10)
            adb.assert_not_called()
    def test_adb_timeout_clamped_and_late_response_rejected(self):
        runner,_=v.load_phone_runtime()
        with patch.object(runner.time,'monotonic',side_effect=[10.,12.]),\
             patch.object(runner,'adb',return_value='device') as adb:
            with self.assertRaises(runner.frames.Deferred):
                runner.timed_adb('get-state',deadline=11,timeout=8)
            self.assertEqual(adb.call_args.kwargs['timeout'],1)
    def test_camera_guard_expired_budget_refuses_before_http(self):
        with patch.object(v.time,'monotonic',return_value=10),patch.object(v.urllib.request,'urlopen') as http:
            with self.assertRaisesRegex(v.Refusal,'budget_exhausted'):
                v.camera_guard(deadline=10)
            http.assert_not_called()
    def test_camera_guard_late_http_response_is_rejected(self):
        response=types.SimpleNamespace(read=lambda cap:b'{}')
        class Context:
            def __enter__(self):return response
            def __exit__(self,*args):return False
        with patch.object(v.time,'monotonic',side_effect=[10.,12.]),\
             patch.object(v.urllib.request,'urlopen',return_value=Context()) as http:
            with self.assertRaisesRegex(v.Refusal,'budget_exhausted'):
                v.camera_guard(deadline=11)
            self.assertEqual(http.call_args.kwargs['timeout'],1)

if __name__=='__main__':unittest.main()
