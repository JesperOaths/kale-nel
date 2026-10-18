#!/usr/bin/env python3
"""Provenance, ranking and honest sampled-event semantics; no private media."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

PATH = Path(__file__).resolve().parents[1] / 's9-person-ml-v1/s9_evidence_quality_v1.py'
spec = importlib.util.spec_from_file_location('quality', PATH)
q = importlib.util.module_from_spec(spec)
spec.loader.exec_module(q)


def source():
    clip = 'motion_1792338420826.mp4'
    return {'archive_mode': 'S9-microSD-only', 'events': [{
        'clip_no': clip, 'duration_ms': 16000, 'sampled_frames': 9,
        'face_deep_review_version': q.NATIVE_PASS,
        'person_detected_frames_050': 3, 'person_tracks': [],
        'face_candidates': [{'snapshot_name': clip[:-4] + '__pending_1__5034_0.jpg',
            'snapshot_sha256': 'a'*64, 'snapshot_size': 1500, 'time_ms': 5034}]}]}


class QualityTests(unittest.TestCase):
    def test_new_recording_waiting_for_native_pass_is_not_a_completed_extraction_gap(self):
        archive = source()
        archive['events'][0].update(face_deep_review_version=None, face_candidates=[])
        report = q.build_report(archive, {})
        row = report['recordings'][0]
        self.assertEqual(row['extraction_status'], 'awaiting_native_face_pass')
        self.assertFalse(row['targeted_rescan_priority'])
        self.assertFalse(row['native_face_pass_complete'])

    def test_no_false_face_claim_from_valid_jpeg_reference(self):
        archive = source()
        value = {'content_status': 'no_secondary_face_confirmation', 'quality_score': 99}
        report = q.build_report(archive, {q.image_key(archive['events'][0]['face_candidates'][0]): value})
        self.assertEqual(report['supported_face_candidates'], 0)
        self.assertEqual(report['unconfirmed_image_candidates'], 1)
        self.assertEqual(report['recordings'][0]['best_supported_snapshots'], [])
        self.assertTrue(report['recordings'][0]['targeted_rescan_priority'])

    def test_good_face_outranks_sharp_background_and_retains_source_time(self):
        images = [dict(content_status='no_secondary_face_confirmation', quality_score=100,
                       snapshot_name='background', time_ms=10),
                  dict(content_status='secondary_detector_supported_face', quality_score=65,
                       snapshot_name='face-a', time_ms=2000),
                  dict(content_status='secondary_detector_supported_face', quality_score=90,
                       snapshot_name='face-b', time_ms=2200),
                  dict(content_status='secondary_detector_supported_face', quality_score=70,
                       snapshot_name='face-c', time_ms=7000)]
        self.assertEqual(q.diverse_best(images), ['face-b', 'face-c'])

    def test_cache_key_changes_with_digest_size_or_time(self):
        face = source()['events'][0]['face_candidates'][0]
        key = q.image_key(face)
        for field, value in [('snapshot_sha256', 'b'*64), ('snapshot_size', 1600), ('time_ms', 8000)]:
            self.assertNotEqual(key, q.image_key(dict(face, **{field: value})))

    def test_invalid_provenance_and_path_traversal_rejected(self):
        for changes in ({'snapshot_name': '../../private.jpg'}, {'snapshot_sha256': 'bad'},
                        {'time_ms': 17000}, {'snapshot_size': True}, {'time_ms': True},
                        {'snapshot_name': 'motion_1792338420827__pending_1__5034_0.jpg'}):
            archive = source()
            archive['events'][0]['face_candidates'][0].update(changes)
            with self.assertRaises(ValueError):
                q.validate_sources(archive)

    def test_duplicate_recordings_and_image_references_rejected(self):
        archive = source()
        archive['events'].append(copy.deepcopy(archive['events'][0]))
        with self.assertRaises(ValueError):
            q.validate_sources(archive)
        archive = source()
        archive['events'][0]['face_candidates'] *= 2
        with self.assertRaises(ValueError):
            q.validate_sources(archive)

    def test_sample_windows_do_not_become_continuous_dwell_or_people_count(self):
        event = source()['events'][0]
        event['person_tracks'] = [{'first_sample_ms': 1000, 'last_sample_ms': 12000, 'sample_count': 3}]
        evidence = q.event_evidence(event)
        self.assertEqual(evidence['corroborated_observation_windows'][0]['last_observation_ms'], 12000)
        self.assertIsNone(evidence['continuous_dwell_time_ms'])
        self.assertEqual(evidence['people_count_status'], 'not_established')
        self.assertEqual(evidence['zone_presence_status'], 'not_measured')

    def test_absence_in_samples_is_not_absence_in_recording(self):
        archive = source()
        archive['events'][0]['person_detected_frames_050'] = 0
        report = q.build_report(archive, {})
        self.assertTrue(report['sampled_frames_do_not_establish_absence_or_continuous_dwell'])
        self.assertEqual(report['recordings'][0]['event_evidence']['sample_observation_status'],
                         'no_person_detection_in_samples')
        self.assertEqual(report['pending_images'], 1)

    def test_source_metadata_and_review_decisions_not_mutated(self):
        archive = source()
        archive['events'][0]['review_decision'] = 'keep'
        original = copy.deepcopy(archive)
        report = q.build_report(archive, {})
        self.assertEqual(archive, original)
        encoded = json.dumps(report)
        for field in ('embedding', 'person_id', 'candidate_name', 'review_decision'):
            self.assertNotIn('"' + field + '"', encoded)

    def test_content_benchmark_is_bound_to_current_source_digest(self):
        archive = source()
        key = q.image_key(archive['events'][0]['face_candidates'][0])
        measurements = {key: {'content_status': 'secondary_detector_supported_face', 'quality_score': 80}}
        report = q.build_report(archive, measurements, {key: 'visible_face'})
        self.assertEqual(report['content_benchmark']['visible_face_labels'], 1)
        self.assertFalse(report['content_benchmark']['full_archive_recall_measured'])
        archive['events'][0]['face_candidates'][0]['snapshot_sha256'] = 'b'*64
        changed = q.build_report(archive, measurements, {key: 'visible_face'})
        self.assertEqual(changed['content_benchmark']['visible_face_labels'], 0)

    def test_activity_uses_amsterdam_six_to_six_days_and_counts_clips(self):
        archive = source()
        # 03:30 UTC = 05:30 Amsterdam in October: belongs to previous 06:00 day.
        at = __import__('datetime').datetime(2026, 10, 18, 3, 30,
            tzinfo=__import__('datetime').timezone.utc)
        clip = 'motion_'+str(int(at.timestamp()*1000))+'.mp4'
        archive['events'][0].update(clip_no=clip, face_candidates=[])
        report = q.build_report(archive, {})
        activity = report['activity_analysis']
        day = activity['day_hour_activity'][0]
        self.assertEqual(day['day_start_date'], '2026-10-17')
        self.assertEqual(next(h for h in day['hours'] if h['hour'] == 5)['recordings'], 1)
        self.assertIsNone(activity['observation_coverage_hours'])
        self.assertTrue(activity['zero_recordings_does_not_prove_no_activity'])

    def test_heatmap_totals_and_duration_quantiles_match_actual_recordings(self):
        report = q.build_report(source(), {})
        activity = report['activity_analysis']
        self.assertEqual(sum(h['recordings'] for d in activity['day_hour_activity'] for h in d['hours']), 1)
        self.assertEqual(activity['duration_seconds']['median'], 16)
        self.assertEqual(activity['duration_seconds']['total_recorded_video'], 16)

    def test_atomic_report_is_private_and_nan_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'report.json'
            q.atomic_json(path, {'ok': True})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(ValueError):
                q.atomic_json(path, {'bad': float('nan')})
            self.assertEqual(json.loads(path.read_text()), {'ok': True})

    def test_http_reader_does_not_load_opencv_or_serve_deleted_evidence(self):
        class Handler:
            path = '/new/api/evidence-quality'
            def go(self): return 'previous'
            def js(self, code, data): self.result = (code, data)
        archive = source()
        f = archive['events'][0]['face_candidates'][0]
        report = q.build_report(archive, {q.image_key(f): {
            'content_status': 'secondary_detector_supported_face', 'quality_score': 80}})
        original = q.REPORT
        try:
            with tempfile.TemporaryDirectory() as folder:
                q.REPORT = Path(folder)/'report.json'
                q.atomic_json(q.REPORT, report)
                q.install(Handler, lambda: {archive['events'][0]['clip_no']: {'face_candidates': []}})
                handler = Handler()
                handler.go()
                row = handler.result[1]['recordings'][0]
                self.assertEqual(row['images'], [])
                self.assertEqual(row['best_supported_snapshots'], [])
                self.assertTrue(handler.result[1]['source_changed_since_analysis'])
                handler.path = '/unchanged'
                self.assertEqual(handler.go(), 'previous')
        finally:
            q.REPORT = original


class IncrementalWorkerTests(unittest.TestCase):
    def test_fully_cached_archive_needs_no_phone_model_download_or_cache_write(self):
        events = source()['events']
        face = events[0]['face_candidates'][0]
        cache = {q.image_key(face): {'content_status': 'no_secondary_face_confirmation'}}
        with patch.object(q, 'camera_healthy') as health, patch.object(q, 'load_screen') as model, \
             patch.object(q, 'fetch') as fetch, patch.object(q, 'atomic_json') as checkpoint:
            stats = q.measure_pending(events * 174, cache, Path('cache'), Path('model'), float('inf'))
        health.assert_not_called()
        model.assert_not_called()
        fetch.assert_not_called()
        checkpoint.assert_not_called()
        self.assertEqual(stats['state'], 'complete')
        self.assertEqual(stats['images_attempted'], 0)
        self.assertFalse(stats['detector_loaded'])

    def test_new_image_checked_once_and_transient_errors_retried(self):
        events = source()['events']
        data = b'x' * 1500
        face = events[0]['face_candidates'][0]
        face['snapshot_sha256'] = hashlib.sha256(data).hexdigest()
        key = q.image_key(face)
        cache = {key: {'content_status': 'image_unavailable', 'quality_score': 0}}
        screen = Mock()
        screen.measure.return_value = {'content_status': 'secondary_detector_supported_face', 'quality_score': 80}
        with patch.object(q, 'camera_healthy', return_value=True) as health, \
             patch.object(q, 'load_screen', return_value=screen) as model, \
             patch.object(q, 'fetch', return_value=data), patch.object(q, 'atomic_json') as checkpoint:
            stats = q.measure_pending(events, cache, Path('cache'), Path('model'), float('inf'))
        health.assert_called_once()
        model.assert_called_once()
        checkpoint.assert_called_once()
        self.assertEqual(cache[key]['content_status'], 'secondary_detector_supported_face')
        self.assertEqual(stats['images_attempted'], 1)

    def test_camera_busy_or_unavailable_preserves_existing_cache_and_defers(self):
        for health_result in [False]:
            cache = {}
            with patch.object(q, 'camera_healthy', return_value=health_result), \
                 patch.object(q, 'load_screen') as model, patch.object(q, 'fetch') as fetch, \
                 patch.object(q, 'atomic_json') as checkpoint:
                stats = q.measure_pending(source()['events'], cache, Path('cache'), Path('model'), float('inf'))
            self.assertEqual(cache, {})
            self.assertEqual(stats['state'], 'deferred_camera_not_idle_or_healthy')
            model.assert_not_called()
            fetch.assert_not_called()
            checkpoint.assert_not_called()

    def test_budget_expired_skips_phone_and_model(self):
        with patch.object(q, 'camera_healthy') as health, patch.object(q, 'load_screen') as model:
            stats = q.measure_pending(source()['events'], {}, Path('cache'), Path('model'), -1)
        health.assert_not_called()
        model.assert_not_called()
        self.assertEqual(stats['state'], 'budget_exhausted')

    def test_digest_mismatch_never_reaches_detector_and_remains_retryable(self):
        screen = Mock()
        cache = {}
        with patch.object(q, 'camera_healthy', return_value=True), \
             patch.object(q, 'load_screen', return_value=screen), \
             patch.object(q, 'fetch', return_value=b'x' * 1500), patch.object(q, 'atomic_json'):
            stats = q.measure_pending(source()['events'], cache, Path('cache'), Path('model'), float('inf'))
        screen.measure.assert_not_called()
        self.assertEqual(stats['image_errors'], 1)
        self.assertEqual(next(iter(cache.values()))['content_status'], 'image_unavailable')

    def test_missing_or_invalid_phone_status_defers_without_exception(self):
        with patch.object(q, 'fetch', side_effect=TimeoutError()):
            self.assertFalse(q.camera_healthy())
        for body in [b'[]', b'not json', b'null']:
            with patch.object(q, 'fetch', return_value=body):
                self.assertFalse(q.camera_healthy())


class GapBenchmarkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).with_name('rescan-original4k-face-gaps-v1.py')
        spec = importlib.util.spec_from_file_location('gaps', path)
        cls.gaps = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.gaps)

    def test_original_samples_cover_full_duration_and_stay_in_bounds(self):
        for duration in [1000, 16000, 180000]:
            values = self.gaps.sample_times(duration, 5)
            self.assertEqual(len(set(values)), 5)
            self.assertTrue(all(0 <= value < duration for value in values))
            self.assertLess(values[0], duration/5)
            self.assertGreater(values[-1], duration*.8)

    def test_frame_budget_and_unknown_duration_are_rejected(self):
        for duration, count in [(0, 5), (True, 5), (200000, 5), (16000, 100)]:
            with self.assertRaises(ValueError):
                self.gaps.sample_times(duration, count)

    def test_overlapping_tiles_deduplicate_same_frame_geometry(self):
        self.assertEqual(self.gaps.overlap([0, 0, 20, 20], [0, 0, 20, 20]), 1)
        self.assertEqual(self.gaps.overlap([0, 0, 20, 20], [40, 40, 20, 20]), 0)
        self.assertGreater(self.gaps.overlap([0, 0, 20, 20], [1, 1, 20, 20]), .8)


if __name__ == '__main__':
    unittest.main()

