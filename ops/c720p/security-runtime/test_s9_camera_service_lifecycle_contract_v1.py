#!/usr/bin/env python3
"""Source-level contract checks only; no Android device, network or camera control."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
JAVA=ROOT/"s9-native-security/src/nl/kalenel/s9security/CameraService.java"
ACTIVITY=ROOT/"s9-native-security/src/nl/kalenel/s9security/CameraActivity.java"
RUNBOOK=Path(__file__).with_name("S9_BRIDGE_TRANSPORT_CONTROL_ACCEPTANCE.md")

class ServiceContract(unittest.TestCase):
    def test_stop_uses_async_handler_and_does_not_require_pid_exit(self):
        a=ACTIVITY.read_text()
        c=JAVA.read_text()
        self.assertIn('i.setAction("STOP");startForegroundService(i)',a)
        stop=c.index('if(intent!=null&&"STOP".equals(intent.getAction()))')
        shutdown_post=c.index('cameraHandler.post(new Runnable(){public void run(){shutdown();}})',stop)
        immediate_return=c.index('return START_NOT_STICKY;',stop)
        self.assertLess(stop,shutdown_post)
        self.assertLess(shutdown_post,immediate_return)
        self.assertIn("PID need not exit",RUNBOOK.read_text())

    def test_stop_closes_api_before_stopself(self):
        c=JAVA.read_text()
        shutdown=c[c.index("private void shutdown()"):c.index("@Override public void onDestroy()")]
        self.assertLess(shutdown.index("apiSocket.close()"),shutdown.index("stopForeground(true);stopSelf()"))
        self.assertIn("FINALIZE_ACTIVE_RECORDING_ON_SHUTDOWN",shutdown)

    def test_start_must_not_race_running_old_instance(self):
        c=JAVA.read_text()
        self.assertIn('if(running){Log.i(TAG,"Already running mode="+mode);return START_STICKY;}',c)
        a=ACTIVITY.read_text()
        self.assertIn('i.putExtra("enable_native_camera",true)',a)
        self.assertIn("Do not send START while service teardown is",RUNBOOK.read_text())

    def test_runbook_does_not_claim_usb_required_or_pid_proof(self):
        s=RUNBOOK.read_text()
        self.assertIn("USB is OPTIONAL",s)
        self.assertIn("USB is not established as necessary",s)
        self.assertIn("app-PID disappearance",s)
        self.assertIn("API unavailable while the mapping is listed",s)
        self.assertIn("before issuing STOP",s) if "before issuing STOP" in s else self.assertIn("before STOP",s)

if __name__=="__main__":
    unittest.main(verbosity=2)
