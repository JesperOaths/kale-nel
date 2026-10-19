"""Pure, fail-closed transforms; deployment separately guards exact live bytes."""
MARKER = "SECURITY_TRANSPORT_CONTINUITY_V1"
HOOK = "import s9_visual_review_v36\ns9_visual_review_v36.install(H,external=True)"
IMPORT = "\n# " + MARKER + "\nimport s9_continuity_relay_v1\ns9_continuity_relay_v1.install(H)"


def patch_relay(source):
    if MARKER in source:
        if source.count(IMPORT) != 1:
            raise ValueError("unexpected_existing_continuity_hook")
        return source
    if source.count(HOOK) != 1 or "def authorized(self)" not in source or "def origin_ok(self)" not in source:
        raise ValueError("relay_auth_or_hook_changed")
    old = "X-S9-Verified-People-Intent,X-S9-Visual-Review-Intent'"
    new = "X-S9-Verified-People-Intent,X-S9-Visual-Review-Intent,X-S9-Automatic-Person-Intent'"
    if source.count(old) != 1:
        raise ValueError("relay_preflight_contract_changed")
    result = source.replace(old, new).replace(HOOK, HOOK + IMPORT)
    compile(result, "c720p-lan-camera-relay.py", "exec")
    return result


def patch_status(source):
    marker = "# SECURITY_NATIVE_CAPTURE_TELEMETRY_V1"
    fields = '''      # SECURITY_NATIVE_CAPTURE_TELEMETRY_V1
      "native_4k_enabled":phone.get("native_4k_enabled") if type(phone.get("native_4k_enabled")) is bool else None,
      "continuous_4k_ready":phone.get("continuous_4k_ready") if type(phone.get("continuous_4k_ready")) is bool else None,
      "continuous_4k_buffered_ms":_sensor_value(phone.get("continuous_4k_buffered_ms"),0,120000),
      "continuous_4k_dropped_output_frames":_sensor_value(phone.get("continuous_4k_dropped_output_frames"),0,1000000000),
'''
    if marker in source:
        if source.count(fields) != 1:
            raise ValueError("unexpected_existing_native_telemetry")
        return source
    if any(('"' + key + '":') in source for key in ("native_4k_enabled", "continuous_4k_ready")):
        raise ValueError("native_telemetry_already_changed")
    anchor = '      "camera_mode":phone["mode"],"camera_temperature_c":phone.get("temperature_c"),'
    if source.count(anchor) != 1:
        raise ValueError("status_output_contract_changed")
    result = source.replace(anchor, fields + anchor)
    compile(result, "s9_phone_garden_status.py", "exec")
    return result
