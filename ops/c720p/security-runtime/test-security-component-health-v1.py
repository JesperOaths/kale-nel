#!/usr/bin/env python3
"""Network-free contracts for the existing-report Security health reader.

Only synthetic JSON beneath a TemporaryDirectory is accessed. Set
C720P_TEST_TMPDIR on Windows when the default temporary directory is restricted.
"""
import ast
import copy
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
SOURCE = HERE / 's9_security_component_health_v1.py'
SPEC = importlib.util.spec_from_file_location('component_health', SOURCE)
health = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(health)

NOW = dt.datetime(2026, 10, 20, 18, 20, tzinfo=dt.timezone.utc)
FILES = {
    'infrastructure': 'security-health-diagnostics-v1.json',
    'evidence': 's9-recognition-evidence-health.json',
    'saved_timing': 's9-7s-native-saved-timing-proof-v1.json',
}
CLOCKS = {'infrastructure': 'generated_at_utc', 'evidence': 'updated_utc',
          'saved_timing': 'checked_at_utc'}


def documents():
    stamp = (NOW - dt.timedelta(seconds=60)).isoformat()
    return {
        'infrastructure': {
            'schema_version': 'c720p_s9_security_health_v1',
            'generated_at_utc': stamp, 'overall_status': 'warning',
            'checks': {
                'root_available_bytes': 886878208, 'root_total_bytes': 22406131712,
                'ntp_synchronized': False, 'external_clock_minus_hub_seconds': 93.5,
                's9_catalog_recordings': 289, 'original_digest_matches': 289,
                'original_digest_mismatches': 0, 'original_integrity_coverage_complete': True,
            },
            'issues': [{'code': 'c720p_ntp_unsynchronized', 'severity': 'warning'}],
        },
        'evidence': {
            'schema': 's9_evidence_coverage_v1', 'updated_utc': stamp,
            'recordings_indexed': 289, 'tracked_observations': 358,
            'observations_with_colour': 232, 'observations_with_direction': 27,
            'observations_with_measured_posture': 0,
            'observations_with_measured_gait_cadence': 0,
            'face_supported_candidates': 30, 'unassigned_appearances': 178,
            'confirmed_profiles': 26,
        },
        'saved_timing': {
            'schema_version': 's9_native_saved_prefix_quiet_hold_proof_v1',
            'checked_at_utc': stamp, 'complete': True, 'eligible_count': 3,
            'joint_same_recording_required': True, 'joint_prefix_and_tail_count': 3,
            'freshness_guard_active': True, 'full_frame_decode_verified': False,
        },
    }


class ComponentHealthContracts(unittest.TestCase):
    def setUp(self):
        base = os.environ.get('C720P_TEST_TMPDIR')
        if base:
            Path(base).mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='component-health-', dir=base)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.docs = documents()
        self.write_all()

    def write(self, component, value=None):
        document = self.docs[component] if value is None else value
        path = self.root / FILES[component]
        path.write_text(json.dumps(document), encoding='utf-8')
        path.chmod(0o600)

    def write_all(self):
        for component in FILES:
            self.write(component)

    def build(self):
        return health.build(self.root, NOW)

    def component(self, name):
        return self.build()['components'][name]

    def unavailable(self, name):
        result = self.component(name)
        self.assertEqual(result['status'], 'unavailable')
        self.assertIsNone(result['age_seconds'])
        self.assertIsNone(result['updated_at_utc'])
        for key, value in result.items():
            if key != 'status':
                self.assertIsNone(value, key)

    def test_real_file_projection_keeps_warnings_and_distinct_measurements(self):
        result = self.build()
        self.assertEqual(result['schema_version'], 'security_component_health_v1')
        self.assertEqual(set(result['components']), set(FILES))
        infra = result['components']['infrastructure']
        self.assertEqual(infra, {
            'status': 'current', 'age_seconds': 60,
            'updated_at_utc': (NOW - dt.timedelta(seconds=60)).isoformat(),
            'root_available_bytes': 886878208, 'root_total_bytes': 22406131712,
            'ntp_synchronized': False, 'external_clock_minus_hub_seconds': 93.5,
            'original_digest_matches': 289, 'original_digest_mismatches': 0,
            'original_integrity_coverage_complete': True, 'originals_indexed': 289,
        })
        evidence = result['components']['evidence']
        self.assertEqual(evidence['face_supported_candidates'], 30)
        self.assertEqual(evidence['tracked_observations'], 358)
        self.assertEqual(evidence['observations_with_measured_posture'], 0)
        self.assertNotIn('confirmed_profiles', evidence)
        timing = result['components']['saved_timing']
        self.assertTrue(timing['reported_complete'])
        self.assertEqual(timing['paired_recordings'], 3)
        self.assertFalse(timing['full_frame_decode_verified'])
        self.assertFalse(result['rendered_playback_verified'])

    def test_missing_one_source_never_erases_other_sources_or_invents_zero(self):
        (self.root / FILES['infrastructure']).unlink()
        self.unavailable('infrastructure')
        self.assertEqual(self.component('evidence')['status'], 'current')
        self.assertEqual(self.component('saved_timing')['paired_recordings'], 3)

    def test_missing_directory_yields_unavailable_components(self):
        result = health.build(self.root / 'not-created', NOW)
        self.assertTrue(all(x['status'] == 'unavailable' for x in result['components'].values()))

    def test_wrong_schema_cannot_be_projected_by_shape_alone(self):
        for component, key in (('infrastructure', 'schema_version'),
                               ('evidence', 'schema'), ('saved_timing', 'schema_version')):
            with self.subTest(component=component):
                document = copy.deepcopy(self.docs[component])
                document[key] = 'unreviewed_v999'
                self.write(component, document)
                self.unavailable(component)
                self.write(component)

    def test_malformed_utf8_json_and_nonobjects_are_unavailable(self):
        path = self.root / FILES['evidence']
        for raw in (b'not-json', b'{"bad":', b'\xff\xff\xff', b'[1,2,3]', b'"some text"'):
            with self.subTest(raw=raw):
                path.write_bytes(raw)
                self.unavailable('evidence')

    def test_nonfinite_json_constants_and_overflowed_clock_are_rejected(self):
        for value in (float('nan'), float('inf'), float('-inf')):
            with self.subTest(value=value):
                document = copy.deepcopy(self.docs['infrastructure'])
                document['checks']['external_clock_minus_hub_seconds'] = value
                self.write('infrastructure', document)
                self.unavailable('infrastructure')
        document = json.dumps(self.docs['infrastructure']).replace('93.5', '1e999')
        (self.root / FILES['infrastructure']).write_text(document, encoding='utf-8')
        self.unavailable('infrastructure')

    def test_stale_sources_keep_historical_values_and_their_individual_age(self):
        for component, age in (('infrastructure', 1801), ('evidence', 1801),
                               ('saved_timing', 10801)):
            with self.subTest(component=component):
                document = copy.deepcopy(self.docs[component])
                document[CLOCKS[component]] = (NOW - dt.timedelta(seconds=age)).isoformat()
                self.write(component, document)
                item = self.component(component)
                self.assertEqual(item['status'], 'stale')
                self.assertEqual(item['age_seconds'], age)
                if component == 'saved_timing':
                    self.assertTrue(item['reported_complete'])
                    self.assertEqual(item['paired_recordings'], 3)
                    self.assertFalse(item['full_frame_decode_verified'])
                    self.assertFalse(self.build()['rendered_playback_verified'])
                self.write(component)

    def test_freshness_boundaries_and_small_future_skew_are_explicit(self):
        for seconds, status, age in ((-1800, 'current', 1800), (-1801, 'stale', 1801),
                                    (180, 'current', 0)):
            with self.subTest(seconds=seconds):
                document = copy.deepcopy(self.docs['infrastructure'])
                document['generated_at_utc'] = (NOW + dt.timedelta(seconds=seconds)).isoformat()
                self.write('infrastructure', document)
                self.assertEqual(self.component('infrastructure')['status'], status)
                self.assertEqual(self.component('infrastructure')['age_seconds'], age)

    def test_far_future_naive_missing_and_bad_source_clocks_are_unavailable(self):
        for component in FILES:
            for clock in ((NOW + dt.timedelta(seconds=181)).isoformat(),
                          NOW.replace(tzinfo=None).isoformat(), None, 'not-a-clock'):
                with self.subTest(component=component, clock=clock):
                    document = copy.deepcopy(self.docs[component])
                    document[CLOCKS[component]] = clock
                    self.write(component, document)
                    self.unavailable(component)
            self.write(component)

    def test_naive_observer_clock_refuses_before_any_report_access(self):
        with patch.object(health, 'read_report') as read:
            with self.assertRaisesRegex(ValueError, 'aware_observation_time_required'):
                health.build(self.root, NOW.replace(tzinfo=None))
            read.assert_not_called()

    def test_timezone_offsets_are_normalized_to_utc(self):
        document = copy.deepcopy(self.docs['evidence'])
        document['updated_utc'] = (NOW - dt.timedelta(seconds=60)).astimezone(
            dt.timezone(dt.timedelta(hours=2))).isoformat()
        self.write('evidence', document)
        self.assertEqual(self.component('evidence')['age_seconds'], 60)
        self.assertTrue(self.component('evidence')['updated_at_utc'].endswith('+00:00'))

    def test_actual_oversize_file_is_not_parsed_as_a_report(self):
        path = self.root / FILES['infrastructure']
        path.write_bytes(b'{' + b' ' * 32768 + b'}')
        self.unavailable('infrastructure')

    def test_deep_json_is_unavailable_instead_of_crashing_other_components(self):
        path = self.root / FILES['evidence']
        path.write_text('[' * 2000 + '0' + ']' * 2000, encoding='utf-8')
        self.unavailable('evidence')
        self.assertEqual(self.component('infrastructure')['status'], 'current')

    @unittest.skipUnless(hasattr(os, 'mkfifo') and hasattr(signal, 'SIGALRM'),
                         'POSIX FIFO and bounded signal alarm required')
    def test_named_pipe_is_refused_without_waiting_for_a_writer(self):
        path = self.root / FILES['infrastructure']
        path.unlink()
        os.mkfifo(path, 0o600)
        def expired(signum, frame):
            raise AssertionError('reader blocked on a non-regular report file')
        previous = signal.signal(signal.SIGALRM, expired)
        signal.alarm(2)
        try:
            self.unavailable('infrastructure')
            self.assertEqual(self.component('evidence')['status'], 'current')
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, previous)

    def test_actual_file_symlink_is_refused(self):
        path = self.root / FILES['infrastructure']
        retained = self.root / 'source-private.json'
        path.rename(retained)
        try:
            path.symlink_to(retained)
        except (OSError, NotImplementedError) as exc:
            self.skipTest('OS does not permit creating test symlinks: ' + type(exc).__name__)
        self.unavailable('infrastructure')
        self.assertTrue(retained.is_file())

    def test_actual_report_directory_symlink_is_refused(self):
        alias = self.root / 'directory-alias'
        try:
            alias.symlink_to(self.root, target_is_directory=True)
        except (OSError, NotImplementedError) as exc:
            self.skipTest('OS does not permit creating test symlinks: ' + type(exc).__name__)
        result = health.build(alias, NOW)
        self.assertTrue(all(x['status'] == 'unavailable' for x in result['components'].values()))

    def test_boolean_or_negative_counts_are_never_treated_as_measurements(self):
        for component, location, key in (
                ('infrastructure', 'checks', 'original_digest_matches'),
                ('evidence', None, 'tracked_observations')):
            for invalid in (True, False, -1, 1.5, '289', 10000001):
                with self.subTest(component=component, invalid=invalid):
                    document = copy.deepcopy(self.docs[component])
                    target = document[location] if location else document
                    target[key] = invalid
                    self.write(component, document)
                    self.unavailable(component)
            self.write(component)

    def test_nullable_evidence_remains_unknown_not_zero(self):
        document = copy.deepcopy(self.docs['evidence'])
        document['face_supported_candidates'] = None
        document['unassigned_appearances'] = None
        self.write('evidence', document)
        item = self.component('evidence')
        self.assertEqual(item['status'], 'current')
        self.assertIsNone(item['face_supported_candidates'])
        self.assertIsNone(item['unassigned_appearances'])

    def test_storage_boolean_flags_and_integrity_contradictions_are_rejected(self):
        for changes in (
            {'root_available_bytes': 22406131713}, {'root_total_bytes': 0},
            {'root_available_bytes': True}, {'ntp_synchronized': 1},
            {'original_digest_mismatches': 1}, {'original_digest_matches': 288},
            {'s9_catalog_recordings': 0, 'original_digest_matches': 0},
        ):
            with self.subTest(changes=changes):
                document = copy.deepcopy(self.docs['infrastructure'])
                document['checks'].update(changes)
                self.write('infrastructure', document)
                self.unavailable('infrastructure')

    def test_incomplete_integrity_and_unknown_clock_are_preserved_without_greenwashing(self):
        document = copy.deepcopy(self.docs['infrastructure'])
        document['checks'].update(original_digest_matches=280,
            original_integrity_coverage_complete=False, external_clock_minus_hub_seconds=None)
        self.write('infrastructure', document)
        item = self.component('infrastructure')
        self.assertEqual(item['status'], 'current')
        self.assertEqual(item['original_digest_matches'], 280)
        self.assertFalse(item['original_integrity_coverage_complete'])
        self.assertIsNone(item['external_clock_minus_hub_seconds'])

    def test_legacy_or_unfresh_completed_timing_receipt_is_not_promoted(self):
        for remove in ('joint_same_recording_required', 'joint_prefix_and_tail_count',
                       'freshness_guard_active'):
            with self.subTest(remove=remove):
                document = copy.deepcopy(self.docs['saved_timing'])
                document.pop(remove)
                self.write('saved_timing', document)
                item = self.component('saved_timing')
                self.assertIsNone(item['reported_complete'])
                self.assertIsNone(item['paired_recordings'])
        document = copy.deepcopy(self.docs['saved_timing'])
        document['freshness_guard_active'] = False
        self.write('saved_timing', document)
        self.assertIsNone(self.component('saved_timing')['reported_complete'])

    def test_completed_timing_requires_three_actual_integer_joint_samples(self):
        for count in (0, 1, 2, True, False, -1, '3', 3.0, 10000001):
            with self.subTest(count=count):
                document = copy.deepcopy(self.docs['saved_timing'])
                document['joint_prefix_and_tail_count'] = count
                self.write('saved_timing', document)
                self.assertIsNot(self.component('saved_timing')['reported_complete'], True)

    def test_pending_qualified_timing_reports_progress_without_claiming_success(self):
        document = copy.deepcopy(self.docs['saved_timing'])
        document['complete'] = False
        document['joint_prefix_and_tail_count'] = 2
        self.write('saved_timing', document)
        item = self.component('saved_timing')
        self.assertIs(item['reported_complete'], False)
        self.assertEqual(item['paired_recordings'], 2)
        self.assertFalse(item['full_frame_decode_verified'])

    def test_private_or_arbitrary_report_fields_never_leave_projection(self):
        secret = 'PRIVATE_SENTINEL_clip_person_face_auth_model_path'
        for component in FILES:
            document = copy.deepcopy(self.docs[component])
            document.update(private_name=secret, person_id=secret,
                face_embedding=[1, 2, 3], recording_path=secret, auth_secret=secret,
                arbitrary_error={'message': secret}, references=[{'sha256': secret}])
            if component == 'infrastructure':
                document['checks']['private_field'] = secret
                document['issues'] = [{'code': secret, 'severity': secret}]
            self.write(component, document)
        raw = json.dumps(self.build(), allow_nan=False)
        self.assertNotIn(secret, raw)
        for name in ('private_name', 'face_embedding', 'recording_path', 'auth_secret', 'references'):
            self.assertNotIn(name, raw)

    def test_reader_does_not_write_reports_or_access_unlisted_private_files(self):
        private = self.root / 'private-person-review-do-not-open.json'
        private.write_text('not valid JSON and never a health input', encoding='utf-8')
        before = {p.name: p.read_bytes() for p in self.root.iterdir()}
        original_open = os.open
        opened = []
        def recording_open(path, flags, *args, **kwargs):
            opened.append(Path(path).name)
            self.assertEqual(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC), 0)
            return original_open(path, flags, *args, **kwargs)
        with patch.object(health.os, 'open', side_effect=recording_open):
            result = self.build()
        self.assertCountEqual(opened, list(FILES.values()))
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.root.iterdir()})
        for key in ('media_read', 'manual_reviews_modified', 'workers_started', 'rendered_playback_verified'):
            self.assertIs(result[key], False)
        self.assertIs(result['read_only'], True)

    def test_module_has_no_network_camera_model_media_or_process_interfaces(self):
        tree = ast.parse(SOURCE.read_text(encoding='utf-8-sig'))
        imports = {node.names[0].name.split('.')[0] for node in ast.walk(tree)
                   if isinstance(node, ast.Import)}
        imports.update(node.module.split('.')[0] for node in ast.walk(tree)
                       if isinstance(node, ast.ImportFrom))
        self.assertFalse(imports & {'urllib', 'http', 'socket', 'subprocess', 'sqlite3',
            'cv2', 'PIL', 'tensorflow', 'onnxruntime'})
        functions = {node.name for node in ast.walk(tree)
                     if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
        self.assertFalse(functions & {'camera', 'adb', 'infer', 'decode', 'record',
            'launch_camera', 'write_report', 'atomic_write', 'start_worker'})


if __name__ == '__main__':
    unittest.main()
