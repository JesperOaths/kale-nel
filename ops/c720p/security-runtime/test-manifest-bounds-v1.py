#!/usr/bin/env python3
"""Rich manifests fit both index paths; oversized/non-object input fails closed."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result)
    return result


class ManifestBoundsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog=load('catalog',ROOT/'s9-person-ml-v1/local-sd-catalog.py')
        cls.fast=load('fast',ROOT/'s9-native-security/fast-recent-s9-clip-index.py')

    def test_current_rich_manifest_and_exact_boundary_are_accepted(self):
        value={'name':'motion_1792058834271.mp4','evidence':'x'*16000}
        raw=json.dumps(value).encode()
        for module in [self.catalog,self.fast]:
            self.assertEqual(module.decode_manifest(raw),value)
            self.assertEqual(module.decode_manifest(raw+b' '*(32768-len(raw))),value)

    def test_oversized_malformed_and_non_object_manifests_rejected(self):
        for module in [self.catalog,self.fast]:
            for raw in [b' '*32769,b'not json',b'[]',b'null']:
                with self.subTest(module=module.__name__,raw=raw[:10]):
                    with self.assertRaises(ValueError):module.decode_manifest(raw)

    def test_new_fast_recording_can_use_a_manifest_larger_than_14kb(self):
        name='motion_1792058834271.mp4';value={'name':name,'evidence':'x'*16000}
        def adb(*args,**kwargs):
            if args[0]=='exec-out' and args[-1].endswith('.verified.json'):
                self.assertGreaterEqual(kwargs['limit'],len(json.dumps(value)))
                return json.dumps(value).encode()
            if args[0]=='shell':return b'200000'
            raise RuntimeError('no thumbnail')
        with patch.object(self.fast,'adb',side_effect=adb), \
             patch.object(self.fast,'row_from_manifest',side_effect=lambda n,m,*a:{'name':n,'value':m}):
            rows=self.fast.new_records({'phone_recordings':[]},[name],object())
        self.assertEqual(rows[0]['value'],value)


if __name__=='__main__':unittest.main()
