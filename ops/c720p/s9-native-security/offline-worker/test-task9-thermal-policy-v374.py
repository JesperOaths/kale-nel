#!/usr/bin/env python3
"""Offline checks for the previously installed 40C policy; no device access."""
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

queue = load('thermal_v304', HERE.parent / 's9_priority_rescan_feedback_v304.py')
qualification = load('thermal_v372', HERE / 's9_phone_memory_qualification_v372.py')

def status(**changes):
    value = dict(ok=True, mode='watching', native_4k_enabled=True,
                 continuous_4k_ready=True, continuous_4k_buffered_ms=6500,
                 continuous_4k_dropped_output_frames=0, temperature_c=40.0)
    value.update(changes)
    return value

def guard(document, memory_mib=900, disk_mib=850):
    reply = io.BytesIO(json.dumps(document).encode())
    with patch.object(queue.urllib.request, 'urlopen', return_value=reply), \
         patch.object(queue.Path, 'read_text', return_value=f'MemAvailable: {memory_mib * 1024} kB\n'), \
         patch.object(queue.shutil, 'disk_usage', return_value=SimpleNamespace(free=disk_mib * 1024**2)):
        return queue.camera_guard()

class ThermalPolicy(unittest.TestCase):
    def test_existing_40c_boundary_is_inclusive(self):
        for temperature in (34.5, 37.7, 39.99, 40.0):
            with self.subTest(temperature=temperature):
                document = status(temperature_c=temperature)
                self.assertEqual(guard(document), document)
                self.assertTrue(qualification.camera(document)['camera_and_exclusion_ok'])

    def test_hot_missing_and_invalid_temperature_fail_closed(self):
        for temperature in (40.0001, 40.5, 42.0, 0, -1, None, True, '39', float('nan'), float('inf')):
            with self.subTest(temperature=temperature):
                document = status(temperature_c=temperature)
                with self.assertRaises(queue.Refusal):
                    guard(document)
                self.assertFalse(qualification.camera(document)['camera_four_k_ready'])
        document = status()
        del document['temperature_c']
        with self.assertRaises(queue.Refusal):
            guard(document)
        self.assertFalse(qualification.camera(document)['camera_four_k_ready'])

    def test_all_recording_and_worker_exclusions_remain_enforced(self):
        for key in ('recording_active', 'recording_in_progress', 'face_backfill_queued',
                    'appearance_backfill_queued', 'historical_import_queued',
                    'movement_4k_backfill_queued', 'garden_archive_triage_queued'):
            with self.subTest(exclusion=key):
                document = status(**{key: True})
                with self.assertRaises(queue.Refusal):
                    guard(document)
                result = qualification.camera(document)
                self.assertFalse(result['camera_and_exclusion_ok'])
                self.assertIn(key, result['active_exclusions'])

    def test_4k_ready_buffer_and_zero_drop_guards_remain_enforced(self):
        for change in ({'ok': False}, {'mode': 'recording'}, {'native_4k_enabled': False},
                       {'continuous_4k_ready': False}, {'continuous_4k_buffered_ms': 6499},
                       {'continuous_4k_dropped_output_frames': 1}):
            with self.subTest(change=change):
                document = status(**change)
                with self.assertRaises(queue.Refusal):
                    guard(document)
                self.assertFalse(qualification.camera(document)['camera_four_k_ready'])

    def test_900_mib_hub_memory_floor_is_preserved(self):
        self.assertTrue(guard(status(), memory_mib=900)['ok'])
        with self.assertRaisesRegex(queue.Refusal, 'hub_memory_reserve_below_900_mib'):
            guard(status(), memory_mib=899)

    def test_850_mib_root_disk_floor_is_preserved(self):
        self.assertTrue(guard(status(), disk_mib=850)['ok'])
        with self.assertRaisesRegex(queue.Refusal, 'hub_disk_reserve_below_850_mib'):
            guard(status(), disk_mib=849)

if __name__ == '__main__':
    unittest.main()
