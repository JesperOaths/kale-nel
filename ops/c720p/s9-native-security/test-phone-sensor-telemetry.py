#!/usr/bin/env python3
"""Regression tests: S9+ sensor exposure and frame-rate metadata are read-only."""
import importlib.util
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parent
SOURCE=ROOT/'src/nl/kalenel/s9security/CameraService.java'
ADAPTER=ROOT.parent/'s9-person-ml-v1/s9_phone_garden_status.py'
UI=ROOT/'patch-security-sensor-timing-ui.py'

def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class Tests(unittest.TestCase):
    def test_capture_metadata_does_not_force_30fps_or_affect_records(self):
        text=SOURCE.read_text()
        self.assertIn('new CameraCaptureSession.CaptureCallback()',text)
        self.assertIn('CaptureResult.SENSOR_EXPOSURE_TIME',text)
        self.assertIn('CaptureResult.SENSOR_FRAME_DURATION',text)
        self.assertIn('CaptureResult.SENSOR_TIMESTAMP',text)
        self.assertIn('CaptureResult.CONTROL_AE_TARGET_FPS_RANGE',text)
        self.assertIn('CaptureResult.CONTROL_AE_STATE',text)
        self.assertIn('CaptureResult.SENSOR_SENSITIVITY',text)
        self.assertIn('s.setRepeatingRequest(r.build(),sensorTelemetry,cameraHandler)',text)
        self.assertIn('s.setRepeatingRequest(b.build(),sensorTelemetry,cameraHandler)',text)
        self.assertEqual(text.count('session.setRepeatingRequest(activeCameraRequest.build(),sensorTelemetry,cameraHandler)'),2)
        for key in ('sensor_result_fps','sensor_exposure_ms','sensor_frame_duration_ms',
                    'sensor_iso','sensor_ae_state','sensor_ae_target_fps_min',
                    'sensor_ae_target_fps_max','sensor_lowlight_long_exposure'):
            self.assertIn('d.put("'+key+'"',text)
        self.assertNotIn('builder.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE',text)
        for invariant in ('recorder.setVideoSize(3840,2160)',
                          'recorder.setVideoFrameRate(30)',
                          'recorder.setVideoEncodingBitRate(36000000)',
                          'PhoneMediaRange.handle(in,out,line,folder)',
                          'garden_roi_gpu_person_gate_v1',
                          'COOLDOWN_MS=12000',
                          'PreviewJpeg.encode(copied,58)'):
            self.assertIn(invariant,text)

    def test_optional_phone_sensor_metadata_is_safe(self):
        mod=load(ADAPTER,'sensor_status_adapter')
        sample={"ok":True,"mode":"watching",
                "motion_detector":"garden_roi_gpu_person_gate_v1",
                "last_frame_age_ms":45,"garden_person_gate_checked":0,
                "garden_person_gate_matches":0,"garden_person_gate_rejected":0}
        old=mod.from_phone(sample,now_ms=123000)
        self.assertIsNone(old["camera_sensor"]["fps"])
        self.assertIsNone(old["camera_sensor"]["exposure_ms"])
        with_telemetry=dict(sample,
            sensor_result_fps=14.4,sensor_exposure_ms=62.5,
            sensor_frame_duration_ms=66.7,sensor_iso=1400,
            sensor_ae_state="converged",
            sensor_ae_target_fps_min=15,sensor_ae_target_fps_max=30,
            sensor_capture_result_age_ms=77,sensor_lowlight_long_exposure=True)
        result=mod.from_phone(with_telemetry,now_ms=123100)
        self.assertEqual(result["camera_sensor"]["fps"],14.4)
        self.assertEqual(result["camera_sensor"]["exposure_ms"],62.5)
        self.assertTrue(result["camera_sensor"]["long_exposure"])
        malicious=mod.from_phone({**with_telemetry,
            "sensor_ae_state":"<script>alert(1)</script>",
            "sensor_result_fps":99999},now_ms=123200)
        self.assertIsNone(malicious["camera_sensor"]["fps"])
        self.assertEqual(malicious["camera_sensor"]["ae_state"],"unknown")

    def test_live_tab_only_with_existing_signed_relay(self):
        mod=load(UI,'s9_live_telemetry_patch')
        page=('<html><head></head><body>'
              '<div id="panel-live"><div class="c720p-s9-live-only">'
              '<img id="cameraLive"></div></div>'
              '<!-- s9-live-scroll-and-frame-fps-v1 -->'
              '<!-- S9_SECURITY_LIVE_V4_AUTHENTICATED_MJPEG_FETCH_FALLBACK -->'
              '<div id="panel-saved"></div></body></html>')
        update=mod.patch(page)
        self.assertEqual(mod.patch(update),update)
        self.assertIn('/new/api/live-person-watch',update)
        self.assertIn('window.C720PSecureRelay.fetch',update)
        self.assertIn('sensor.exposure_ms',update)
        self.assertIn('sensor.fps',update)
        self.assertNotIn('http://127.0.0.1:18808',update)
        self.assertIn('<div id="panel-saved"></div>',update)
        with self.assertRaises(ValueError):
            mod.patch('<html><body></body></html>')

if __name__=='__main__':
    unittest.main(verbosity=2)
