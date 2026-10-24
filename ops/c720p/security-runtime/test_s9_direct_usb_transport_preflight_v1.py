#!/usr/bin/env python3
"""No-device tests for the direct S9 USB preflight."""
import importlib.util
from pathlib import Path
import unittest
from unittest import mock

PATH=Path(__file__).with_name("s9-direct-usb-transport-preflight-v1.py")
def load():
    spec=importlib.util.spec_from_file_location("usb_test_subject",PATH)
    x=importlib.util.module_from_spec(spec);spec.loader.exec_module(x);return x

def frame(n):
    return {"ok":True,"recorder":"camera2_3840x2160_h264","mode":"watching",
            "last_frame_age_ms":15,"frames":n,
            "continuous_4k_ready":False,"continuous_4k_buffered_ms":0}

class TestUSB(unittest.TestCase):
    def test_wifi_target_cannot_masquerade_as_usb(self):
        x=load()
        with mock.patch.object(x,"cmd",return_value=
                "List of devices attached\n192.168.178.250:5555 device product:star2lte"):
            with self.assertRaisesRegex(x.NotReady,"authorized_s9_usb_required"):
                x.pinned_usb()

    def test_other_usb_model_never_selected(self):
        x=load()
        def fake(*args,**kw):
            if args[:2]==("devices","-l"):
                return "List of devices attached\nS5SERIAL device\n"
            if args[-2:]==("getprop","ro.product.model"):return "SM-G900F"
            raise AssertionError(args)
        with mock.patch.object(x,"cmd",side_effect=fake):
            with self.assertRaisesRegex(x.NotReady,"authorized_s9_usb_required"):
                x.pinned_usb()

    def test_ambiguous_s9_usb_refused(self):
        x=load()
        def fake(*args,**kw):
            if args[:2]==("devices","-l"):return "List of devices attached\nSERIAL1 device\nSERIAL2 device"
            return "SM-G965F"
        with mock.patch.object(x,"cmd",side_effect=fake):
            with self.assertRaisesRegex(x.NotReady,"authorized_s9_usb_required"):
                x.pinned_usb()

    def test_forward_prepare_never_rebinds_other_owner(self):
        x=load();calls=[]
        def fake(*args,**kw):
            calls.append(args)
            if args==("forward","--list"):return "ANOTHER_SERIAL tcp:18809 tcp:8808"
            if args==("-s","USB_1","get-state"):return "device"
            raise AssertionError(args)
        with mock.patch.object(x,"pinned_usb",return_value="USB_1"),mock.patch.object(x,"cmd",side_effect=fake):
            with self.assertRaisesRegex(x.NotReady,"already_owned"):
                x.inspect(prepare=True)
        self.assertFalse(any("forward" in args and "--no-rebind" in args for args in calls))

    def test_preparation_checks_exact_serial_and_disallows_controls(self):
        x=load();calls=[];count=[0]
        def fake(*args,**kw):
            calls.append(args)
            if args==("-s","USB_1","get-state"):return "device"
            if args==("forward","--list"):
                count[0]+=1
                return "" if count[0]==1 else "USB_1 tcp:18809 tcp:8808"
            if args==("-s","USB_1","forward","--no-rebind","tcp:18809","tcp:8808"):return ""
            raise AssertionError(args)
        with mock.patch.object(x,"pinned_usb",return_value="USB_1"),mock.patch.object(x,"cmd",side_effect=fake),mock.patch.object(x,"status",side_effect=[frame(100),frame(162)]),mock.patch.object(x.time,"sleep"):
            out=x.inspect(prepare=True)
        self.assertTrue(out["preflight_passed"])
        self.assertFalse(out["control_transaction_authorized"])
        self.assertFalse(out["transport_lease_held"])
        self.assertFalse(out["camera_maintenance_performed"])
        self.assertIn(("-s","USB_1","forward","--no-rebind","tcp:18809","tcp:8808"),calls)
        self.assertNotIn(("tcpip","5555"),calls)

    def test_readonly_check_never_establishes_forward(self):
        x=load();calls=[]
        def fake(*args,**kw):
            calls.append(args)
            if args==("-s","USB_1","get-state"):return "device"
            if args==("forward","--list"):return "USB_1 tcp:18809 tcp:8808"
            raise AssertionError(args)
        with mock.patch.object(x,"pinned_usb",return_value="USB_1"),mock.patch.object(x,"cmd",side_effect=fake),mock.patch.object(x,"status",side_effect=[frame(100),frame(162)]),mock.patch.object(x.time,"sleep"):
            out=x.inspect(prepare=False)
        self.assertEqual(out["frames_advanced"],62)
        self.assertFalse(any("--no-rebind" in call for call in calls))

if __name__=="__main__":
    unittest.main(verbosity=2)
