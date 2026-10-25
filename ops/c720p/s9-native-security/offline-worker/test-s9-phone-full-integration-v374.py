#!/usr/bin/env python3
"""Real runner/coordinator/observer integration; only transport is simulated.

No device, video, model, network endpoint or production path is accessed.
"""
import importlib.util
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

BASE=Path(__file__).resolve().parent
sys.path.insert(0,str(BASE))
import s9_phone_gap_runner_v371 as m

class FullIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.root.chmod(0o700)
        self.fence=self.root/'inflight.json'
        self.row=dict(clip_no='motion_1792095266692.mp4',
            source='s9_original_4k_microsd',source_bytes=48831739,
            source_sha256='a'*64,media_revision='b'*64,
            model_sha256=m.frames.MODEL_SHA,
            native_pass='s9_onphone_36_samples_overlapping_tiles_v5',
            required_analysis=m.frames.ANALYSIS,priority_reason='no_indexed_image',
            attempts=1,status='processing',lease_until=int(time.time())+240)
        self.cfg=dict(min_phone_mem_available_kib=1536*1024,
            protected_runtime_reserve_kib=512*1024,
            min_phone_sd_free_bytes=20*1024**3,phone_frame_jar_sha256='c'*64)
        self.target=dict(face_deep_review_version=self.row['native_pass'],
                         face_candidates=[],duration_ms=12000)
        self.calls=[]
        self.launches=[]
        self.active=None
        self.fail_on_launch=None
        self.fast_exit=False
        self.keep_remote=False
        self.bad_receipt=False
        self.revoke_after=None
        self.guards=0
        self.sources=0
        self.worker=types.SimpleNamespace(camera_guard=self.guard,source=self.source,
            NATIVE=self.row['native_pass'],MODEL_SHA=m.frames.MODEL_SHA)
        self.patches=[patch.object(m,'INFLIGHT',self.fence),
                      patch.object(m,'adb',side_effect=self.adb),
                      patch.object(m.subprocess,'Popen',side_effect=self.start)]
        for p in self.patches:p.start();self.addCleanup(p.stop)
        # Compile the actual corrected observer with only Popen replaced.
        # Its supervise(), snapshots, identity and memory checks remain real.
        observer=types.ModuleType('actual_integration_observer')
        with patch.object(subprocess,'Popen',self.start):
            raw=(BASE/'s9_phone_first_peak_observer_v373.py').read_bytes()
            exec(compile(raw,str(BASE/'s9_phone_first_peak_observer_v373.py'),'exec'),observer.__dict__)
        self.patches.append(patch.object(m,'observer',observer))
        self.patches[-1].start();self.addCleanup(self.patches[-1].stop)

    def guard(self,*args,**kwargs):self.guards+=1

    def source(self):
        self.sources+=1
        good=self.revoke_after is None or self.sources<self.revoke_after
        row=self.row
        priority=dict(clip_no=row['clip_no'],targeted_rescan_priority=good,
            native_face_pass_complete=True,extraction_status='no_indexed_image')
        record=dict(version=row['media_revision'],bytes=row['source_bytes'],
            manifest=dict(sha256=row['source_sha256'],bytes=row['source_bytes']))
        return {},[priority],{'records':{row['clip_no']:record}}

    def receipt(self,requested):
        row=self.row
        return dict(schema=m.frames.SCHEMA,source=row['source'],clip_no=row['clip_no'],
            source_sha256=('d'*64 if self.bad_receipt else row['source_sha256']),
            source_bytes=row['source_bytes'],source_revision=row['media_revision'],
            model_sha256=row['model_sha256'],duration_ms=12000,one_frame_only=True,
            host_attestation_required=True,eligible_to_publish=False,
            frame_requested_not_actual_pts=False,originals_modified=False,
            review_decisions_modified=False,automatic_person_assignments=0,
            sample=dict(requested_time_ms=requested,time_ms=requested+32,state='decoded',
                original_resolution=[3840,2160],decoded_pts_verified=True,
                pts_source='mediacodec_output_buffer_info',face_candidates=[]))

    def start(self,argv,**kwargs):
        self.launches.append(argv)
        self.assertTrue(self.fence.is_file(),'durable fence must precede launch')
        if self.fail_on_launch==len(self.launches):raise OSError('synthetic transport interruption')
        words=shlex.split(argv[-1]);at=words.index(m.PHONE_CLASS)
        expected=tuple(words[at:]);self.assertEqual(len(expected),7)
        self.assertRegex(argv[-1],r'TASK9_FRAME_BUDGET_MS=[0-9]+')
        outer=self
        class Proc:
            returncode=None
            calls=0
            def communicate(self,timeout):
                self.calls+=1
                if self.calls==1 and not outer.fast_exit:
                    outer.active=expected
                    raise subprocess.TimeoutExpired(argv,timeout)
                self.returncode=0
                if not outer.keep_remote:outer.active=None
                return m.PREFIX+json.dumps(outer.receipt(int(expected[-1]))),''
            def poll(self):return self.returncode
            def terminate(self):self.returncode=-15
            def kill(self):self.returncode=-9
        return Proc()

    def adb(self,*args,**kwargs):
        self.calls.append((args,kwargs))
        if args==('get-state',):return 'device'
        command=args[1]
        if command.startswith('pidof '):return '5789'
        if command=='cat /proc/meminfo':return 'MemAvailable: 2300000 kB\n'
        if command.startswith('df -k '):return 'Filesystem Size Used Available Use%\nsd 90000000 1000 60000000 1%\n'
        if command.startswith('sha256sum '):return self.cfg['phone_frame_jar_sha256']+'  '+m.PHONE_JAR
        if command=='ps -A -o PID,ARGS':
            return 'PID ARGS\n5789 nl.kalenel.s9security\n'+(
                '4321 app_process /system/bin '+' '.join(self.active)+'\n' if self.active else '')
        if command=='cat /proc/4321/stat':
            return '4321 (app_process) '+' '.join(['S']+['0']*18+['10020']+['0']*5)
        if command=='cat /proc/4321/cmdline':return 'app_process /system/bin '+' '.join(self.active)
        if command=='cat /proc/4321/status':return 'VmRSS: 250000 kB\nVmHWM: 330000 kB\n'
        raise AssertionError('unexpected transport command: '+repr(args))

    def run_pipeline(self):
        return m.run(self.row,self.target,worker=self.worker,quality=None,
                     release_path=self.root/'not-read.json',_verified_release=self.cfg)

    def test_real_three_frame_pipeline_all_or_nothing(self):
        result=self.run_pipeline()
        self.assertEqual([s['time_ms'] for s in result['samples']],[2032,6032,10032])
        self.assertEqual(len(self.launches),3)
        self.assertGreater(self.sources,3)
        self.assertFalse(self.fence.exists())

    def test_second_launch_interruption_retains_fence_and_blocks_retry(self):
        self.fail_on_launch=2
        with self.assertRaises(m.frames.Deferred):self.run_pipeline()
        self.assertTrue(self.fence.exists())
        count=len(self.launches)
        with self.assertRaises(m.frames.Deferred):self.run_pipeline()
        self.assertEqual(len(self.launches),count)

    def test_early_host_exit_cannot_publish_or_retry(self):
        self.fast_exit=True
        with self.assertRaises(m.frames.Deferred):self.run_pipeline()
        self.assertTrue(self.fence.exists())
        self.assertEqual(len(self.launches),1)
        with self.assertRaises(m.frames.Deferred):self.run_pipeline()
        self.assertEqual(len(self.launches),1)

    def test_surviving_remote_worker_never_receives_signal(self):
        self.keep_remote=True
        with self.assertRaises(m.frames.Deferred):self.run_pipeline()
        self.assertTrue(self.fence.exists())
        self.assertFalse(any('kill' in str(args) for args,_ in self.calls))
        with self.assertRaises(m.frames.Deferred):self.run_pipeline()
        self.assertEqual(len(self.launches),1)

    def test_wrong_source_receipt_is_rejected_by_real_coordinator(self):
        self.bad_receipt=True
        with self.assertRaises(m.frames.Revoked):self.run_pipeline()
        self.assertEqual(len(self.launches),1)

    def test_priority_revoked_after_first_frame_returns_no_record(self):
        self.revoke_after=2
        with self.assertRaises(m.frames.Revoked):self.run_pipeline()
        self.assertEqual(len(self.launches),1)

if __name__=='__main__':unittest.main()
