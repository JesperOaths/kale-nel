#!/usr/bin/env python3
"""R742 read-only S9+ camera admission for isolated offline model experiments.
Does not start inference, write identity labels, decode media, change services,
add tasks, or alter camera configuration. Commands: --self-test, --observe.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import time
import urllib.request

URL = "http://127.0.0.1:18808/status"
PHONE = "192.168.178.250:5555"
TEMP_MAX_C = 39.0
MEM_MIN_KIB = 1_400_000
SD_MIN_BYTES = 3 * 1024 ** 3

def number(value):
    return float(value) if type(value) in (int, float) and math.isfinite(value) else None

def count(value):
    return value if type(value) is int and value >= 0 else None

def inspect_camera(s):
    if not isinstance(s, dict):
        return ["camera_status_unavailable"]
    fail = []
    for key in ("ok", "native_4k_enabled"):
        if s.get(key) is not True:
            fail.append(key + "_not_true")
    # The continuous encoder is OPTIONAL. An explicit 'control_disabled'
    # fallback selects native 4K MediaRecorder plus a separate AVC preroll.
    # Readiness on one branch cannot stand in for readiness on the other.
    if s.get("continuous_4k_ready") is True:
        buffered = count(s.get("continuous_4k_buffered_ms"))
        if buffered is None or buffered < 5000:
            fail.append("continuous_4k_buffer_under_5s")
        drops = count(s.get("continuous_4k_dropped_output_frames"))
        if drops is None or drops != 0:
            fail.append("4k_output_drops_not_zero")
    else:
        if s.get("continuous_4k_last_result") != "fallback_control_disabled":
            fail.append("unverified_4k_fallback_reason")
        if s.get("continuous_4k_production_persisted") is not False:
            fail.append("4k_persistence_state_unverified")
        if s.get("preroll_ready") is not True:
            fail.append("legacy_preroll_not_ready")
        buffered = count(s.get("preroll_buffered_ms"))
        if buffered is None or buffered < 5000:
            fail.append("legacy_avc_preroll_under_5s")
        dropped = count(s.get("preroll_dropped_frames"))
        if dropped is None or dropped != 0:
            fail.append("legacy_avc_preroll_drops_not_zero")
        version = s.get("preroll_version")
        if type(version) is not str or not version.startswith("s9_on_phone_avc_memory_ring_"):
            fail.append("legacy_avc_preroll_unrecognized_version")
        encoded = count(s.get("preroll_encoded_frames"))
        if encoded is None or encoded < 100:
            fail.append("legacy_avc_preroll_unverified_encoder")
        if count(s.get("continuous_4k_dropped_output_frames")) != 0:
            fail.append("inactive_4k_output_drops_not_zero")
    if s.get("mode") != "watching":
        fail.append("camera_not_idle_watching")
    fps = number(s.get("sensor_result_fps"))
    if fps is None or fps < 29.0:
        fail.append("sensor_under_29fps_or_unverified")
    for key in ("last_frame_age_ms", "sensor_capture_result_age_ms"):
        n = count(s.get(key))
        if n is None or n > 750:
            fail.append(key + "_stale_or_invalid")
    temp = number(s.get("temperature_c"))
    if temp is None or not 0 <= temp < TEMP_MAX_C:
        fail.append("phone_camera_temperature_out_of_range")
    sd = count(s.get("sd_free_bytes"))
    if sd is None or sd < SD_MIN_BYTES:
        fail.append("phone_microsd_below_3gib")
    exposure = number(s.get("sensor_exposure_ms"))
    if exposure is None or not 0 <= exposure <= 34.0:
        fail.append("exposure_not_30fps_compatible")
    return fail

def inspect_phone(d):
    if not isinstance(d, dict):
        return ["phone_telemetry_unavailable"]
    fail = []
    if type(d.get("recorder_pid")) is not int or d["recorder_pid"] < 1:
        fail.append("recorder_pid_unavailable")
    mem = count(d.get("memory_available_kib"))
    if mem is None or mem < MEM_MIN_KIB:
        fail.append("phone_memory_below_1_4gib")
    t = number(d.get("battery_temp_c"))
    if t is None or not 0 <= t < TEMP_MAX_C:
        fail.append("phone_battery_temperature_out_of_range")
    return fail

def inspect_pair(a, b, pa, pb):
    fail = inspect_camera(a) + inspect_camera(b) + inspect_phone(pa) + inspect_phone(pb)
    if isinstance(a, dict) and isinstance(b, dict):
        x = count(a.get("sensor_capture_result_frames"))
        y = count(b.get("sensor_capture_result_frames"))
        if x is None or y is None or y <= x:
            fail.append("no_new_sensor_frames_between_checks")
        x = count(a.get("frames"))
        y = count(b.get("frames"))
        if x is not None and y is not None and y <= x:
            fail.append("camera_frame_counter_not_progressing")
        if a.get("continuous_4k_ready") is not True and b.get("continuous_4k_ready") is not True:
            x = count(a.get("preroll_encoded_frames"))
            y = count(b.get("preroll_encoded_frames"))
            if x is None or y is None or y <= x:
                fail.append("legacy_avc_encoder_frames_not_progressing")
        if a.get("continuous_4k_ready") is not b.get("continuous_4k_ready"):
            fail.append("4k_capture_mode_changed_between_samples")
    if isinstance(pa, dict) and isinstance(pb, dict) and pa.get("recorder_pid") != pb.get("recorder_pid"):
        fail.append("camera_process_changed")
    return sorted(set(fail))

def camera_status():
    req = urllib.request.Request(URL, headers={"Cache-Control": "no-store"})
    with urllib.request.urlopen(req, timeout=4) as response:
        if response.status != 200:
            raise RuntimeError("camera_http_non_200")
        raw = response.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("camera_health_json_too_large")
    return json.loads(raw)

def phone_status():
    cmd = "pidof nl.kalenel.s9security; awk '/MemAvailable:/{print $2}' /proc/meminfo; dumpsys battery | awk '/temperature:/{print $2}'"
    p = subprocess.run(["adb", "-s", PHONE, "shell", cmd], capture_output=True,
                       text=True, timeout=12, check=True)
    lines = [x.strip() for x in p.stdout.splitlines() if x.strip()]
    if len(lines) != 3:
        raise ValueError("Unexpected phone telemetry shape")
    pid, mem, decic = (int(x) for x in lines)
    return {"recorder_pid": pid, "memory_available_kib": mem,
            "battery_temp_c": decic / 10.0}

def public_fields(camera, phone):
    keys = ("ok", "mode", "native_4k_enabled", "continuous_4k_ready",
            "continuous_4k_buffered_ms", "continuous_4k_last_result",
            "continuous_4k_production_persisted", "preroll_ready",
            "preroll_buffered_ms", "preroll_dropped_frames",
            "preroll_encoded_frames", "preroll_version", "sensor_result_fps",
            "sensor_exposure_ms", "continuous_4k_dropped_output_frames",
            "sensor_capture_result_age_ms", "last_frame_age_ms",
            "temperature_c", "night_mode")
    return {"camera": {k: camera.get(k) for k in keys}, "phone": phone}

def self_test():
    base = {"ok": True, "mode": "watching", "native_4k_enabled": True,
            "continuous_4k_ready": True, "preroll_ready": True,
            "sensor_result_fps": 30.0, "last_frame_age_ms": 13,
            "sensor_capture_result_age_ms": 11, "continuous_4k_buffered_ms": 7000,
            "continuous_4k_dropped_output_frames": 0, "temperature_c": 34.0,
            "sd_free_bytes": 10 * 1024 ** 3, "sensor_exposure_ms": 30.0,
            "sensor_capture_result_frames": 1000, "frames": 1000,
            "preroll_buffered_ms": 7000, "preroll_dropped_frames": 0,
            "preroll_encoded_frames": 1000,
            "preroll_version": "s9_on_phone_avc_memory_ring_keyframe_5s_v4",
            "continuous_4k_production_persisted": False,
            "continuous_4k_last_result": "fallback_control_disabled"}
    phone = {"recorder_pid": 777, "memory_available_kib": 2200000,
             "battery_temp_c": 34.0}
    after = dict(base, sensor_capture_result_frames=1060, frames=1060,
                 preroll_encoded_frames=1060)
    assert not inspect_pair(base, after, phone, phone)
    legacy = dict(base, continuous_4k_ready=False, continuous_4k_buffered_ms=0)
    legacy_after = dict(legacy, sensor_capture_result_frames=1060, frames=1060,
                        preroll_encoded_frames=1060)
    assert not inspect_pair(legacy, legacy_after, phone, phone)
    assert "legacy_avc_encoder_frames_not_progressing" in inspect_pair(
        legacy, dict(legacy_after, preroll_encoded_frames=1000), phone, phone)
    faults = [
        ("continuous_4k_buffered_ms", 0, "continuous_4k_buffer_under_5s"),
        ("sensor_result_fps", 10.0, "sensor_under_29fps_or_unverified"),
        ("sensor_result_fps", float("nan"), "sensor_under_29fps_or_unverified"),
        ("sensor_exposure_ms", 100.0, "exposure_not_30fps_compatible"),
        ("continuous_4k_dropped_output_frames", 1, "4k_output_drops_not_zero"),
        ("continuous_4k_dropped_output_frames", True, "4k_output_drops_not_zero"),
        ("temperature_c", 39.1, "phone_camera_temperature_out_of_range"),
        ("mode", "recording", "camera_not_idle_watching"),
        ("sensor_capture_result_age_ms", 100000, "sensor_capture_result_age_ms_stale_or_invalid"),
        ("last_frame_age_ms", 100000, "last_frame_age_ms_stale_or_invalid"),
        ("sd_free_bytes", 0, "phone_microsd_below_3gib")
    ]
    for key, value, reason in faults:
        assert reason in inspect_camera(dict(base, **{key: value})), key
    legacy_faults = [
        ("continuous_4k_last_result", "fallback_codec_error", "unverified_4k_fallback_reason"),
        ("continuous_4k_production_persisted", True, "4k_persistence_state_unverified"),
        ("preroll_ready", False, "legacy_preroll_not_ready"),
        ("preroll_buffered_ms", 0, "legacy_avc_preroll_under_5s"),
        ("preroll_dropped_frames", 1, "legacy_avc_preroll_drops_not_zero"),
        ("preroll_version", "unknown", "legacy_avc_preroll_unrecognized_version"),
        ("preroll_encoded_frames", 0, "legacy_avc_preroll_unverified_encoder")
    ]
    for key, value, reason in legacy_faults:
        assert reason in inspect_camera(dict(legacy, **{key: value})), key
    assert "no_new_sensor_frames_between_checks" in inspect_pair(base, base, phone, phone)
    assert "camera_process_changed" in inspect_pair(base, after, phone, dict(phone, recorder_pid=778))
    assert "phone_battery_temperature_out_of_range" in inspect_phone(dict(phone, battery_temp_c=39.5))
    assert "phone_memory_below_1_4gib" in inspect_phone(dict(phone, memory_available_kib=500000))
    print(json.dumps({"status": "R742_CAPTURE_GUARD_SELF_TEST_PASS",
                      "synthetic_fault_cases": len(faults) + len(legacy_faults) + 6,
                      "camera_touched": False, "inference_executed": False,
                      "people_assigned": 0}))

def observe():
    before, phone_before = camera_status(), phone_status()
    time.sleep(2.0)
    after, phone_after = camera_status(), phone_status()
    failures = inspect_pair(before, after, phone_before, phone_after)
    print(json.dumps({
        "schema": "s9_reid_capture_admission_v742",
        "result": "PASS_OBSERVATION_ONLY" if not failures else "REFUSE_MODEL_ADMISSION",
        "reasons": failures, "before": public_fields(before, phone_before),
        "after": public_fields(after, phone_after),
        "camera_capture_branch": "continuous_4k_ring" if after.get("continuous_4k_ready") is True else "legacy_4k_recorder_with_avc_preroll",
        "native_4k_event_recording_proved_in_this_observation": False,
        "sensor_frames_delta": (after["sensor_capture_result_frames"] -
                                before["sensor_capture_result_frames"])
            if type(after.get("sensor_capture_result_frames")) is int and
               type(before.get("sensor_capture_result_frames")) is int else None,
        "inference_executed": False, "camera_modified": False,
        "recordings_modified": False, "people_assigned": 0
    }, sort_keys=True))
    return int(bool(failures))

def main():
    parser = argparse.ArgumentParser()
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--self-test", action="store_true")
    selection.add_argument("--observe", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    return observe()

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, subprocess.SubprocessError, RuntimeError) as exc:
        print(json.dumps({"schema": "s9_reid_capture_admission_v742",
                          "result": "REFUSE_MODEL_ADMISSION",
                          "reason": "health_source_unavailable_or_invalid",
                          "error_type": type(exc).__name__,
                          "camera_modified": False, "people_assigned": 0}))
        raise SystemExit(3)
