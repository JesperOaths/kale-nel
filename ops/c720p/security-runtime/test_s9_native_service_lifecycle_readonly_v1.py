#!/usr/bin/env python3
"""Offline state table for S9 service lifecycle; no device accesses."""
import importlib.util
from pathlib import Path
import unittest

PATH=Path(__file__).with_name("s9-native-service-lifecycle-readonly-v1.py")
spec=importlib.util.spec_from_file_location("s9lifecycle",PATH)
subject=importlib.util.module_from_spec(spec)
spec.loader.exec_module(subject)

class Lifecycle(unittest.TestCase):
    def classify(self,adb,forward,service,http):
        return subject.classify(adb,forward,service,http)

    def test_absent_wireless_adb_is_transport_not_service(self):
        self.assertEqual(self.classify(False,False,None,None),"adb_transport_unavailable")

    def test_adb_alive_forward_missing_is_distinct(self):
        self.assertEqual(self.classify(True,False,None,None),
                         "adb_connected_forward_missing_or_wrong_owner")

    def test_service_registered_http_absent_is_not_adb_loss(self):
        self.assertEqual(self.classify(True,True,True,None),
                         "native_service_registered_endpoint_unavailable")

    def test_service_gone_http_absent_can_be_expected_shutdown(self):
        self.assertEqual(self.classify(True,True,False,None),
                         "native_service_not_registered_endpoint_absent_expected")

    def test_http_present_but_service_gone_inconsistent(self):
        self.assertEqual(self.classify(True,True,False,{"mode":"watching"}),
                         "native_service_absent_but_endpoint_present_inconsistent")

    def test_no_service_state_means_no_control(self):
        self.assertEqual(self.classify(True,True,None,None),
                         "service_state_unknown_do_not_control")

    def test_transition_modes_are_not_completion(self):
        for name in ("opening","starting","stopping"):
            self.assertEqual(self.classify(True,True,True,{"mode":name}),
                             "camera_service_transition_in_progress")

    def test_live_sensor_but_no_4k_is_not_ready(self):
        self.assertEqual(self.classify(True,True,True,{"mode":"watching",
                          "continuous_4k_ready":False,"continuous_4k_buffered_ms":0}),
                         "camera_watching_native_4k_unavailable")

    def test_native_4k_requires_actual_buffer(self):
        self.assertEqual(self.classify(True,True,True,{"mode":"watching",
                          "continuous_4k_ready":True,"continuous_4k_buffered_ms":0}),
                         "camera_watching_native_4k_unavailable")
        self.assertEqual(self.classify(True,True,True,{"mode":"watching",
                          "continuous_4k_ready":True,"continuous_4k_buffered_ms":16000}),
                         "camera_watching_native_4k_buffering")

    def test_recording_never_interrupt(self):
        self.assertEqual(self.classify(True,True,True,{"mode":"recording"}),
                         "camera_recording_do_not_interrupt")

    def test_no_stop_start_tap_or_reconnect_in_source(self):
        source=PATH.read_text()
        for forbidden in ("input tap","am force-stop","am startservice",
                          "startForegroundService(","adb connect","adb tcpip",
                          "kill-server","--remove-all"):
            self.assertNotIn(forbidden,source)

if __name__=="__main__":
    unittest.main(verbosity=2)
