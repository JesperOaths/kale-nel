#!/usr/bin/env python3
"""Offline tests of S21 discovery and the safe native watchdog recovery gate."""
import importlib.util
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

spec=importlib.util.spec_from_file_location(
    "tunerush_s21_recovery",Path(__file__).with_name("s21_recovery.py"))
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def test_discovery():
    # IPv6 announcements, wrong phone model, wrong serial, and an unrelated
    # network must never redirect the real multiplayer gateway.
    sample="""=;wlp1s0;IPv6;adb-TEST-SERIAL-42-BGAadW;_adb-tls-connect._tcp;local;Android-3.local;fe80::1;46339;"v=1" "name=SM-G991B"
=;wlp1s0;IPv4;adb-OTHERPHONE-BGAadW;_adb-tls-connect._tcp;local;Android-1.local;192.168.178.250;5555;"name=SM-G965F"
=;wlp1s0;IPv4;adb-TEST-SERIAL-42-BGAadW;_adb-tls-connect._tcp;local;Android-2.local;10.0.0.2;46339;"name=SM-G991B"
=;wlp1s0;IPv4;adb-TEST-SERIAL-42-BGAadW;_adb-tls-connect._tcp;local;Android-3.local;192.168.178.217;46339;"v=1" "name=SM-G991B"
"""
    with patch.object(m,"expected_serial",return_value="TEST-SERIAL-42"), \
         patch.object(m,"run",return_value=SimpleNamespace(stdout=sample,returncode=0)):
        assert m.discover()==("192.168.178.217",46339)
    with patch.object(m,"expected_serial",return_value="ANOTHER-DEVICE"), \
         patch.object(m,"run",return_value=SimpleNamespace(stdout=sample,returncode=0)):
        assert m.discover() is None
    print("S21_IPV4_ADB_DISCOVERY_IDENTITY_PASS")

def test_health_split_response():
    # Real S21 may write status-line/headers and JSON in separate packets.
    class FakeConnection:
        def __init__(self,port):
            self.port=port
            self.messages=[b"HTTP/1.0 200 OK\r\nContent-Type: application/json\r\n\r\n",
                ('{"service":"tunerush-s21-'+
                 ('solo' if port==8797 else 'multiplayer')+
                 '","ready":true}').encode()]
        def __enter__(self):return self
        def __exit__(self,*args):return False
        def settimeout(self,seconds):pass
        def sendall(self,data):
            assert b"GET /api/health" in data
        def recv(self,size):
            return self.messages.pop(0) if self.messages else b""
    def fake_connect(address,timeout=3):
        return FakeConnection(address[1])
    with patch.object(m.socket,"create_connection",side_effect=fake_connect):
        assert m.healthy("192.168.178.217") is True
    print("S21_HTTP_SPLIT_PACKET_HEALTH_PASS")

if __name__=="__main__":
    test_discovery()
    test_health_split_response()
