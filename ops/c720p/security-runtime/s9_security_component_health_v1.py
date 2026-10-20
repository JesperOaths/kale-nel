"""Project existing private reports into bounded, read-only component health.

No network, subprocess, media, model or review access. Report freshness is
separate from capture health, analysis coverage and historical timing proof.
"""
import datetime as dt
import json
import math
import os
from pathlib import Path
import stat

STATE = Path('/home/jespern/c720p-home-hub/state')
VERSION = 'security_component_health_v1'
SPECS = {
    'infrastructure': ('security-health-diagnostics-v1.json', 'schema_version',
        'c720p_s9_security_health_v1', 'generated_at_utc', 1800, 32768),
    'evidence': ('s9-recognition-evidence-health.json', 'schema',
        's9_evidence_coverage_v1', 'updated_utc', 1800, 200000),
    'saved_timing': ('s9-7s-native-saved-timing-proof-v1.json', 'schema_version',
        's9_native_saved_prefix_quiet_hold_proof_v1', 'checked_at_utc', 10800, 1000000),
}
FIELDS = {
    'infrastructure': ('root_available_bytes', 'root_total_bytes', 'ntp_synchronized',
        'external_clock_minus_hub_seconds', 'original_digest_matches',
        'original_digest_mismatches', 'original_integrity_coverage_complete', 'originals_indexed'),
    'evidence': ('recordings_indexed', 'tracked_observations', 'observations_with_colour',
        'observations_with_direction', 'observations_with_measured_posture',
        'observations_with_measured_gait_cadence', 'face_supported_candidates', 'unassigned_appearances'),
    'saved_timing': ('reported_complete', 'paired_recordings',
        'joint_same_recording_required', 'full_frame_decode_verified'),
}


class InvalidReport(ValueError):
    pass


def integer(value, maximum=10000000):
    if type(value) is not int or not 0 <= value <= maximum:
        raise InvalidReport('invalid_count')
    return value


def boolean(value):
    if type(value) is not bool:
        raise InvalidReport('invalid_boolean')
    return value


def number_or_none(value):
    if value is None:
        return None
    if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 86400:
        raise InvalidReport('invalid_clock_offset')
    return value


def timestamp(value):
    if not isinstance(value, str) or len(value) > 64:
        raise InvalidReport('invalid_timestamp')
    try:
        parsed = dt.datetime.fromisoformat(value)
    except ValueError:
        raise InvalidReport('invalid_timestamp') from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise InvalidReport('naive_timestamp')
    return parsed.astimezone(dt.timezone.utc)


def read_report(root, name, limit):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise InvalidReport('unsafe_report_directory')
    path = root / name
    # Every filename is fixed by SPECS, never caller-controlled.
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
                 | getattr(os, 'O_NONBLOCK', 0))
    with os.fdopen(fd, 'rb') as source:
        before = os.fstat(source.fileno())
        if path.is_symlink() or not stat.S_ISREG(before.st_mode) or not 2 < before.st_size <= limit:
            raise InvalidReport('unsafe_or_oversize_report')
        raw = source.read(limit + 1)
        after = os.fstat(source.fileno())
        if (len(raw) > limit or before.st_size != after.st_size
                or before.st_mtime_ns != after.st_mtime_ns):
            raise InvalidReport('report_changed_during_read')
    try:
        report = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(InvalidReport('nonfinite_json')))
    except (ValueError, UnicodeError, RecursionError):
        raise InvalidReport('invalid_json') from None
    if not isinstance(report, dict):
        raise InvalidReport('invalid_report')
    return report


def infrastructure(report):
    values = report.get('checks')
    if not isinstance(values, dict):
        raise InvalidReport('missing_checks')
    free = integer(values.get('root_available_bytes'), 10**15)
    total = integer(values.get('root_total_bytes'), 10**15)
    if total == 0 or free > total:
        raise InvalidReport('invalid_storage')
    indexed = integer(values.get('s9_catalog_recordings'))
    matches = integer(values.get('original_digest_matches'))
    mismatches = integer(values.get('original_digest_mismatches'))
    covered = boolean(values.get('original_integrity_coverage_complete'))
    if covered and (matches != indexed or mismatches != 0 or indexed == 0):
        raise InvalidReport('contradictory_integrity')
    return {'root_available_bytes': free, 'root_total_bytes': total,
        'ntp_synchronized': boolean(values.get('ntp_synchronized')),
        'external_clock_minus_hub_seconds': number_or_none(values.get('external_clock_minus_hub_seconds')),
        'original_digest_matches': matches, 'original_digest_mismatches': mismatches,
        'original_integrity_coverage_complete': covered, 'originals_indexed': indexed}


def evidence(report):
    result = {}
    for key in FIELDS['evidence']:
        value = report.get(key)
        # These producers explicitly use null when the source is not current.
        if value is None and key in ('face_supported_candidates', 'unassigned_appearances'):
            result[key] = None
        else:
            result[key] = integer(value)
    return result


def saved_timing(report):
    complete = boolean(report.get('complete'))
    joint = report.get('joint_same_recording_required')
    paired = report.get('joint_prefix_and_tail_count')
    # Older receipts lacked a joint-sample contract. Their success must not
    # become a verified timing claim, even if they report complete:true.
    qualified = (joint is True and type(paired) is int and 0 <= paired <= 10000000
                 and report.get('freshness_guard_active') is True
                 and (not complete or paired >= 3))
    return {'reported_complete': complete if qualified else None,
        'paired_recordings': integer(paired) if qualified else None,
        'joint_same_recording_required': joint if type(joint) is bool else None,
        'full_frame_decode_verified': (report.get('full_frame_decode_verified')
            if type(report.get('full_frame_decode_verified')) is bool else None)}


PROJECTORS = {'infrastructure': infrastructure, 'evidence': evidence, 'saved_timing': saved_timing}


def build(root=STATE, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError('aware_observation_time_required')
    now = now.astimezone(dt.timezone.utc)
    components = {}
    for key, (name, schema_key, schema, clock_key, maximum_age, limit) in SPECS.items():
        item = {'status': 'unavailable', 'age_seconds': None, 'updated_at_utc': None,
                **dict.fromkeys(FIELDS[key])}
        try:
            report = read_report(root, name, limit)
            if report.get(schema_key) != schema:
                raise InvalidReport('unknown_schema')
            updated = timestamp(report.get(clock_key))
            age = (now - updated).total_seconds()
            if age < -180:
                raise InvalidReport('future_timestamp')
            projected = PROJECTORS[key](report)
            item.update(projected, status='current' if age <= maximum_age else 'stale',
                        age_seconds=max(0, round(age)), updated_at_utc=updated.isoformat())
        except (OSError, InvalidReport, TypeError, OverflowError):
            # No raw path, error, recording name, person ID or arbitrary report
            # content can leave this reader. Missing data is never a zero count.
            pass
        components[key] = item
    return {'ok': True, 'schema_version': VERSION, 'observed_at_utc': now.isoformat(),
        'components': components, 'read_only': True, 'media_read': False,
        'manual_reviews_modified': False, 'workers_started': False,
        'rendered_playback_verified': False}
