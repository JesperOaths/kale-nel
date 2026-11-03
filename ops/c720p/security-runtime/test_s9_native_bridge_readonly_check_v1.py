#!/usr/bin/env python3
"""Offline tests for bounded S9 bridge diagnostics; never contacts a phone."""
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest import mock

PATH=Path(__file__).with_name("s9-native-bridge-readonly-check-v1.py")

def load():
    spec=importlib.util.spec_from_file_location("bridge_diagnostic_test",PATH)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def frame(n):
    return {"ok":True,"mode":"watching","recorder":"camera2_3840x2160_h264",
            "frames":n,"last_frame_age_ms":15,
            "continuous_4k_ready":False,"continuous_4k_buffered_ms":0}

class BridgeDiagnosticTests(unittest.TestCase):
    def make_calls(self,m,*,forward=True,after=True,model=True,first=100,second=150):
        responses=[
            "device",
            "SM-G965F" if model else "unknown-device",
            m.EXPECTED_SERIAL,
            m.DEVICE+" "+m.FORWARD if forward else "other tcp:18808 tcp:8808",
            "device" if after else "offline",
            m.EXPECTED_SERIAL,
            m.DEVICE+" "+m.FORWARD,
        ]
        status=[frame(first),frame(second)]
        return (mock.patch.object(m,"adb",side_effect=lambda *args:responses.pop(0)),
                mock.patch.object(m,"camera_status",side_effect=lambda:status.pop(0)),
                mock.patch.object(m.time,"sleep",return_value=None))

    def test_two_fresh_statuses_do_not_authorize_controls(self):
        m=load()
        a,b,c=self.make_calls(m)
        with a,b,c:
            output=m.check(interval_seconds=2)
        self.assertTrue(output["transport_probe_passed"])
        self.assertEqual(output["frames_advanced"],50)
        self.assertFalse(output["control_transaction_accepted"])
        self.assertFalse(output["transport_reserved"])
        self.assertFalse(output["continuous_4k_ready"])

    def test_first_forward_missing_fails_closed(self):
        m=load()
        a,b,c=self.make_calls(m,forward=False)
        with a,b,c:
            with self.assertRaisesRegex(m.NotReady,"forward_missing"):
                m.check()

    def test_second_adb_transport_loss_is_rejected(self):
        m=load()
        a,b,c=self.make_calls(m,after=False)
        with a,b,c:
            with self.assertRaisesRegex(m.NotReady,"transport_lost"):
                m.check()

    def test_stale_frames_rejected_even_after_two_http_200(self):
        m=load()
        a,b,c=self.make_calls(m,first=150,second=150)
        with a,b,c:
            with self.assertRaisesRegex(m.NotReady,"stale_or_frames_stalled"):
                m.check()

    def test_mismatched_model_rejected(self):
        m=load()
        a,b,c=self.make_calls(m,model=False)
        with a,b,c:
            with self.assertRaisesRegex(m.NotReady,"model_mismatch"):
                m.check()

    def test_api_refused_but_adb_and_forward_present_is_not_transport_loss(self):
        m=load()
        def observed(*args):
            if args==("-s",m.DEVICE,"get-state"):return "device"
            if args==("-s",m.DEVICE,"shell","getprop","ro.serialno"):return m.EXPECTED_SERIAL
            if args==("forward","--list"):return m.DEVICE+" "+m.FORWARD
            raise AssertionError(args)
        with mock.patch.object(m,"adb",side_effect=observed), \
             mock.patch.object(m,"camera_status",side_effect=m.NotReady("bridge_status_unavailable")):
            with self.assertRaisesRegex(m.NotReady,"recorder_api_unavailable_but_adb_and_forward_listed"):
                m.status_with_transport_attribution()

    def test_api_refused_and_phone_transport_lost_are_distinct(self):
        m=load()
        with mock.patch.object(m,"adb",return_value="offline"), \
             mock.patch.object(m,"camera_status",side_effect=m.NotReady("bridge_status_unavailable")):
            with self.assertRaisesRegex(m.NotReady,"adb_transport_unavailable_after_recorder_api_failure"):
                m.status_with_transport_attribution()

    def test_api_refused_and_forward_disappeared_are_distinct(self):
        m=load()
        def observed(*args):
            if args==("-s",m.DEVICE,"get-state"):return "device"
            if args==("-s",m.DEVICE,"shell","getprop","ro.serialno"):return m.EXPECTED_SERIAL
            if args==("forward","--list"):return ""
            raise AssertionError(args)
        with mock.patch.object(m,"adb",side_effect=observed), \
             mock.patch.object(m,"camera_status",side_effect=m.NotReady("bridge_status_unavailable")):
            with self.assertRaisesRegex(m.NotReady,"adb_forward_missing_after_recorder_api_failure"):
                m.status_with_transport_attribution()

    def test_nontransport_camera_mode_failure_not_mislabeled(self):
        m=load()
        with mock.patch.object(m,"adb",side_effect=AssertionError("no ADB needed")), \
             mock.patch.object(m,"camera_status",side_effect=m.NotReady("native_camera_not_watching")):
            with self.assertRaisesRegex(m.NotReady,"native_camera_not_watching"):
                m.status_with_transport_attribution()

    def test_initial_serial_mismatch_blocks_even_if_model_matches(self):
        m=load()
        responses=["device",m.EXPECTED_MODEL,"wrong-serial"]
        with mock.patch.object(m,"adb",side_effect=lambda *a:responses.pop(0)):
            with self.assertRaisesRegex(m.NotReady,"s9_serial_mismatch"):
                m.check(interval_seconds=0)

    def test_serial_changes_between_samples_blocks(self):
        m=load()
        responses=[
            "device",m.EXPECTED_MODEL,m.EXPECTED_SERIAL,
            m.DEVICE+" "+m.FORWARD,"device","changed-serial"
        ]
        with mock.patch.object(m,"adb",side_effect=lambda *a:responses.pop(0)), \
             mock.patch.object(m,"camera_status",side_effect=[frame(100),frame(200)]), \
             mock.patch.object(m.time,"sleep",return_value=None):
            with self.assertRaisesRegex(m.NotReady,"serial_changed"):
                m.check(interval_seconds=0)

    def test_api_refusal_with_wrong_serial_is_not_api_only(self):
        m=load()
        def observed(*args):
            if args==("-s",m.DEVICE,"get-state"):return "device"
            if args==("-s",m.DEVICE,"shell","getprop","ro.serialno"):return "wrong-serial"
            raise AssertionError(args)
        with mock.patch.object(m,"adb",side_effect=observed), \
             mock.patch.object(m,"camera_status",side_effect=m.NotReady("bridge_status_unavailable")):
            with self.assertRaisesRegex(m.NotReady,"serial_mismatch_after"):
                m.status_with_transport_attribution()

    def test_no_side_effecting_control_path(self):
        source=PATH.read_text()
        self.assertNotIn("am force-stop",source)
        self.assertNotIn("am start",source)
        self.assertNotIn("am stop",source)
        self.assertNotIn("adb connect",source)
        self.assertNotIn("adb tcpip",source)
        self.assertNotIn("forward tcp:",source)
        self.assertNotIn("POST /control",source)
        self.assertNotIn("kill-server",source)

if __name__=="__main__":
    unittest.main(verbosity=2)
