#!/usr/bin/env python3
"""Offline bridge recovery guard tests. Never connect to a real Android device."""
import importlib.util
from pathlib import Path
import unittest
from unittest import mock

FILE=Path(__file__).with_name("recover-authorized-s9-adb-from-usb-v1.py")
def load():
    spec=importlib.util.spec_from_file_location("bridge_guard_test_subject",FILE)
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def reply(*args,**kwargs):
    if args[-1]=="get-state":
        return 0,"device",""
    if args[-2:]==("getprop","ro.product.model"):
        return 0,"SM-G965F",""
    if args[-2:]==("getprop","ro.serialno"):
        return 0,"27bb603837047ece",""
    if args[-2:]==("forward","--list"):
        return 0,"192.168.178.250:5555 tcp:18808 tcp:8808",""
    if args[-2:]==("tcp:18808","tcp:8808"):
        return 0,"",""
    if args[:1]==("connect",):
        return 0,"connected",""
    raise AssertionError(args)

class BridgeGuard(unittest.TestCase):
    def test_exact_identity_and_current_forward(self):
        mod=load()
        with mock.patch.object(mod,"call",side_effect=reply):
            self.assertTrue(mod.live())
            self.assertTrue(mod.forward())

    def test_wrong_serial_never_admitted(self):
        mod=load()
        def wrong(*args,**kw):
            if args[-2:]==("getprop","ro.serialno"):
                return 0,"OTHER_DEVICE",""
            return reply(*args,**kw)
        with mock.patch.object(mod,"call",side_effect=wrong):
            self.assertFalse(mod.live())
            self.assertFalse(mod.identity("USB_OTHER"))

    def test_wrong_model_never_admitted(self):
        mod=load()
        def wrong(*args,**kw):
            if args[-2:]==("getprop","ro.product.model"):
                return 0,"SM-G900F",""
            return reply(*args,**kw)
        with mock.patch.object(mod,"call",side_effect=wrong):
            self.assertFalse(mod.live())

    def test_misdirected_forward_not_reported_success(self):
        mod=load()
        def wrong(*args,**kw):
            if args[-2:]==("forward","--list"):
                return 0,"192.168.178.250:5555 tcp:18808 tcp:8080",""
            return reply(*args,**kw)
        with mock.patch.object(mod,"call",side_effect=wrong):
            self.assertFalse(mod.forward())

    def test_wifi_first_needs_no_usb_fallback_when_verified(self):
        mod=load()
        calls=[]
        def capture(*args,**kwargs):
            calls.append(args)
            return reply(*args,**kwargs)
        with mock.patch.object(mod,"call",side_effect=capture):
            self.assertEqual(mod.main(),0)
        self.assertFalse(any(args[:1]==("devices",) for args in calls))
        self.assertFalse(any("tcpip" in args for args in calls))
        self.assertTrue(any(args[-2:]==("getprop","ro.serialno") for args in calls))

if __name__=="__main__":
    unittest.main(verbosity=2)
