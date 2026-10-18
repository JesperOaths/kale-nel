#!/usr/bin/env python3
"""Maintenance regressions using synthetic metadata; no camera media or writes."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT/(name+'.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class CancellationTests(unittest.TestCase):
    def test_cancelled_requests_close_connection_without_hiding_real_errors(self):
        quiet = module('quiet_http_disconnect_v1')
        for error in [BrokenPipeError(), ConnectionResetError()]:
            class Handler:
                def handle(self): raise error
            quiet.install(Handler)
            wrapped = Handler.handle
            quiet.install(Handler)
            self.assertIs(Handler.handle, wrapped)
            instance = Handler()
            instance.handle()
            self.assertTrue(instance.close_connection)
        class Handler:
            def handle(self): raise ValueError('real fault')
        quiet.install(Handler)
        with self.assertRaises(ValueError): Handler().handle()

    def playback(self):
        spec = importlib.util.spec_from_file_location('playback', ROOT/'s9_hub_playback.py')
        p = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = p
        spec.loader.exec_module(p)
        p.JANITOR = object()
        return p

    def test_playback_cancel_does_not_attempt_second_error_response(self):
        p = self.playback()
        for error in [BrokenPipeError(), ConnectionResetError()]:
            class Handler:
                path = '/new/saved/clip/motion_1792338420826.mp4?playback=prepare'
                def handle(self): return self.go()
                def go(self): return 'previous'
                def js(self, code, value):
                    self.responses.append(code)
                    raise error
            with patch.dict(sys.modules, {'s9_rgb_video_playback_v1': SimpleNamespace(install=Mock()),
                                         's9_visual_review_v36': SimpleNamespace(install=Mock())}), \
                 patch.object(p, 'source', return_value={}), patch.object(p, 'prepare', return_value={}):
                p.install(Handler, lambda: {})
                h = Handler();h.responses = [];h.handle()
                self.assertEqual(h.responses, [200])
                self.assertTrue(h.close_connection)

    def test_real_source_failure_still_returns_503_and_other_routes_delegate(self):
        p = self.playback()
        class Handler:
            path = '/new/saved/clip/motion_1792338420826.mp4?playback=prepare'
            def handle(self): return self.go()
            def go(self): return 'previous'
            def js(self, code, value): self.response = (code, value)
        with patch.dict(sys.modules, {'s9_rgb_video_playback_v1': SimpleNamespace(install=Mock()),
                                     's9_visual_review_v36': SimpleNamespace(install=Mock())}), \
             patch.object(p, 'source', side_effect=ValueError('bad source')):
            p.install(Handler, lambda: {})
            h = Handler();h.handle()
            self.assertEqual(h.response[0], 503)
            h.path = '/unrelated'
            self.assertEqual(h.handle(), 'previous')


class CoverageTests(unittest.TestCase):
    def test_current_api_contracts_and_manual_counts(self):
        q = module('s9_evidence_quality_watchdog_v1')
        calls = []
        def read(port, route):
            calls.append((port, route))
            if route == '/status': return {'ok': True, 'native_4k_enabled': True, 'mode': 'watching'}
            if route == '/new/api/saved': return {'events': []}
            if route == '/new/api/visual-review?limit=1': return {'folders': [{}, {}], 'pending_views': 17}
            return {'source_changed_since_analysis': False, 'supported_face_candidates': 3}
        with tempfile.TemporaryDirectory() as folder, patch.object(q, 'OUT', Path(folder)/'report.json'), \
             patch.object(q, 'read', side_effect=read):
            data = q.audit()
            self.assertEqual(data['confirmed_profiles'], 2)
            self.assertEqual(data['unassigned_appearances'], 17)
            self.assertEqual(data['face_supported_candidates'], 3)
            self.assertEqual(q.OUT.stat().st_mode & 0o777, 0o600)
        self.assertFalse(any(port == 8794 or 'person-folders' in route for port, route in calls))

    def test_stale_quality_does_not_become_a_current_count(self):
        q = module('s9_evidence_quality_watchdog_v1')
        def read(port, route):
            if route == '/status': return {}
            if route == '/new/api/saved': return {'events': []}
            if route.startswith('/new/api/visual-review'): return {'folders': [], 'pending_views': 0}
            return {'source_changed_since_analysis': True, 'supported_face_candidates': 999}
        with tempfile.TemporaryDirectory() as folder, patch.object(q, 'OUT', Path(folder)/'report.json'), \
             patch.object(q, 'read', side_effect=read):
            self.assertIsNone(q.audit()['face_supported_candidates'])


class RetentionTests(unittest.TestCase):
    def run_target(self, exists=True, active=False, body='{"ok":true,"recording":false}', curl_rc=0):
        with tempfile.TemporaryDirectory() as folder:
            src = Path(folder)/'recorder.py'
            if exists: src.write_text('raise RuntimeError("must not be imported during dry run")')
            env = dict(os.environ, TEST_BODY=body, TEST_CURL_RC=str(curl_rc), TEST_SERVICE_RC='0' if active else '3')
            command = '''source "$1" --dry-run
curl(){ printf '%s' "$TEST_BODY"; return "$TEST_CURL_RC"; }
systemctl(){ return "$TEST_SERVICE_RC"; }
run_one test 123 /bin/false "$2" test.service
'''
            return subprocess.run(['bash', '-c', command, 'test', str(ROOT/'c720p-security-value-retention.sh'), str(src)],
                                  capture_output=True, text=True, env=env)

    def test_missing_retired_source_skips_but_missing_active_source_fails(self):
        self.assertIn('SKIP_RETIRED_SOURCE', self.run_target(exists=False).stdout)
        self.assertEqual(self.run_target(exists=False, active=True).returncode, 1)

    def test_recording_and_unknown_health_always_skip(self):
        for body, rc in [('not json', 0), ('{"ok":true}', 0), ('{"ok":false,"recording":false}', 0),
                         ('{"ok":true,"recording":0}', 0), ('{"ok":true,"recording":false}', 7)]:
            with self.subTest(body=body, rc=rc):
                self.assertIn('SKIP_HEALTH_UNAVAILABLE', self.run_target(body=body, curl_rc=rc).stdout)
        self.assertIn('SKIP_RECORDING', self.run_target(body='{"ok":true,"recording":true}').stdout)

    def test_dry_run_never_imports_recorder_even_when_idle(self):
        result = self.run_target()
        self.assertEqual(result.returncode, 0)
        self.assertIn('DRY_RUN_IDLE', result.stdout)


class LegacyScanTests(unittest.TestCase):
    def setUp(self):
        self.clean = module('c720p-person-no-person-clean-v126')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.clip = Path(self.temp.name)/'test.mp4'
        self.clip.write_bytes(b'original')

    def row(self):
        return {'model': 'current', 'person_status': 'uncertain', 'person_fullscan_at': 'now',
                'person_fullscan_samples': 12,
                'person_fullscan_source_signature': self.clean.source_signature(self.clip, 'model-inputs')}

    def test_completed_uncertain_scan_is_reused_and_next_candidate_can_progress(self):
        self.assertFalse(self.clean.needs_scan(self.row(), self.clip, 'current', 'model-inputs'))
        self.assertTrue(self.clean.needs_scan({}, self.clip, 'current', 'model-inputs'))

    def test_changed_clip_detector_or_explicit_force_rechecks(self):
        row = self.row()
        self.assertTrue(self.clean.needs_scan(row, self.clip, 'current', 'changed-model-inputs'))
        self.assertTrue(self.clean.needs_scan(row, self.clip, 'new-model', 'model-inputs'))
        self.assertTrue(self.clean.needs_scan(row, self.clip, 'current', 'model-inputs', force=True))
        self.clip.write_bytes(b'new original')
        self.assertTrue(self.clean.needs_scan(row, self.clip, 'current', 'model-inputs'))

    def test_incomplete_scans_retry_and_confirmed_statuses_remain_protected(self):
        row = self.row();row['person_fullscan_samples'] = 0
        self.assertTrue(self.clean.needs_scan(row, self.clip, 'current', 'model-inputs'))
        row = self.row();row['person_status'] = 'confirmed_person'
        self.assertFalse(self.clean.needs_scan(row, self.clip, 'current', 'model-inputs', force=True))


if __name__ == '__main__': unittest.main()
