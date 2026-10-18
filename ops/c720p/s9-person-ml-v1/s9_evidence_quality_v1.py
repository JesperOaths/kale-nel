"""Independent face-content screening, native crop quality and event evidence.

The HTTP reader uses only the standard library. OpenCV is loaded only by the
bounded, low-priority offline worker; images remain in memory. No recognition,
embeddings, cross-clip associations, source writes or review decisions.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import tempfile
import time
import urllib.parse
import urllib.request

VERSION = 's9_evidence_quality_v1'
MODEL_SHA = '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'
MODEL_URL = ('https://media.githubusercontent.com/media/opencv/opencv_zoo/main/'
             'models/face_detection_yunet/face_detection_yunet_2023mar.onnx')
ROOT = Path('/home/jespern/c720p-home-hub')
STATE = ROOT / 'state/s9-evidence-quality-v1'
REPORT = STATE / 'report.json'
CLIP = re.compile(r'motion_[0-9]{13}[.]mp4')
SNAP = re.compile(r'motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg')
DIGEST = re.compile(r'[a-f0-9]{64}')


def fetch(url, limit):
    with urllib.request.urlopen(url, timeout=25) as response:
        if response.status != 200:
            raise ValueError('source_http_unavailable')
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('bounded_read_exceeded')
    return data


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def finite(value, low, high):
    return (type(value) in (int, float) and math.isfinite(value)
            and low <= value <= high)


def validate_sources(archive):
    if archive.get('archive_mode') != 'S9-microSD-only':
        raise ValueError('wrong_original_archive')
    events = archive.get('events')
    if not isinstance(events, list) or not 1 <= len(events) <= 5000:
        raise ValueError('invalid_original_list')
    seen = set()
    for event in events:
        name = event.get('clip_no') if isinstance(event, dict) else None
        if not isinstance(name, str) or not CLIP.fullmatch(name) or name in seen:
            raise ValueError('invalid_or_duplicate_original')
        seen.add(name)
        duration = event.get('duration_ms')
        if not integer(duration, 1000, 180000):
            raise ValueError('invalid_original_duration')
        faces = event.get('face_candidates')
        if not isinstance(faces, list) or len(faces) > 16:
            raise ValueError('invalid_candidate_list')
        snapshots = set()
        for face in faces:
            if not isinstance(face, dict):
                raise ValueError('invalid_candidate')
            snap = face.get('snapshot_name')
            if (not isinstance(snap, str) or not SNAP.fullmatch(snap)
                    or not snap.startswith(name[:-4] + '__') or snap in snapshots
                    or not integer(face.get('snapshot_size'), 512, 2200000)
                    or not isinstance(face.get('snapshot_sha256'), str)
                    or not DIGEST.fullmatch(face['snapshot_sha256'])
                    or not integer(face.get('time_ms'), 0, duration)):
                raise ValueError('invalid_image_provenance')
            snapshots.add(snap)
    return events


def image_key(face):
    return hashlib.sha256(json.dumps([face['snapshot_name'], face['snapshot_sha256'],
        face['snapshot_size'], face['time_ms']], separators=(',', ':')).encode()).hexdigest()


def diverse_best(images, limit=3):
    """Rank supported face candidates, retaining distinct source times."""
    supported = [item for item in images
                 if item.get('content_status') == 'secondary_detector_supported_face']
    supported.sort(key=lambda item: (-item['quality_score'], item['time_ms'], item['snapshot_name']))
    selected = []
    for item in supported:
        if all(abs(item['time_ms'] - old['time_ms']) >= 1000 for old in selected):
            selected.append(item)
        if len(selected) == limit:
            break
    return [item['snapshot_name'] for item in selected]


def event_evidence(event):
    """Sample observations are neither continuous dwell time nor a headcount."""
    hits, samples = event.get('person_detected_frames_050'), event.get('sampled_frames')
    measured = integer(samples, 1, 32) and integer(hits, 0, samples)
    windows = []
    tracks = event.get('person_tracks', [])
    if isinstance(tracks, list):
        for track in tracks[:32]:
            if not isinstance(track, dict):
                continue
            start, end, count = (track.get('first_sample_ms'), track.get('last_sample_ms'),
                                 track.get('sample_count'))
            if (integer(start, 0, event['duration_ms'])
                    and integer(end, start, event['duration_ms']) and integer(count, 3, 1000)):
                windows.append({'first_observation_ms': start, 'last_observation_ms': end,
                                'supporting_samples': count})
    return {'person_sample_count': samples if measured else None,
            'person_positive_samples': hits if measured else None,
            'sample_observation_status': ('not_measured' if not measured else
                'repeated_person_candidate' if hits >= 2 else
                'single_sample_person_candidate' if hits == 1 else
                'no_person_detection_in_samples'),
            'corroborated_observation_windows': windows,
            'continuous_dwell_time_ms': None, 'zone_presence_status': 'not_measured',
            'physical_speed_status': 'not_measured', 'people_count_status': 'not_established'}


def build_report(archive, measurements, content_audit=None):
    events = validate_sources(archive)
    records = []
    totals = {'indexed_images': 0, 'images_measured': 0, 'supported_face_candidates': 0,
              'unconfirmed_image_candidates': 0, 'image_errors': 0, 'pending_images': 0}
    for event in events:
        images = []
        for face in event['face_candidates']:
            totals['indexed_images'] += 1
            value = measurements.get(image_key(face))
            if value is None:
                totals['pending_images'] += 1
                continue
            item = dict(value, snapshot_name=face['snapshot_name'], time_ms=face['time_ms'],
                        snapshot_sha256=face['snapshot_sha256'], snapshot_size=face['snapshot_size'])
            images.append(item)
            totals['images_measured'] += 1
            status = item['content_status']
            totals['supported_face_candidates' if status == 'secondary_detector_supported_face'
                   else 'image_errors' if status == 'image_unavailable'
                   else 'unconfirmed_image_candidates'] += 1
        selected = diverse_best(images)
        reason = ('no_indexed_image' if not event['face_candidates'] else
                  'awaiting_image_screening' if len(images) != len(event['face_candidates']) else
                  'secondary_detector_has_no_supported_face' if not selected else
                  'supported_face_evidence_available')
        records.append({'clip_no': event['clip_no'], 'duration_ms': event['duration_ms'],
                        'original_url': '/new/saved/clip/' + event['clip_no'],
                        'best_supported_snapshots': selected, 'images': images,
                        'extraction_status': reason,
                        'targeted_rescan_priority': reason in (
                            'no_indexed_image', 'secondary_detector_has_no_supported_face'),
                        'event_evidence': event_evidence(event)})
    audit = content_audit if isinstance(content_audit, dict) else {}
    supported_keys = {image_key(face) for event in events for face in event['face_candidates']
                      if measurements.get(image_key(face), {}).get('content_status') == 'secondary_detector_supported_face'}
    audited = [audit[key] for key in supported_keys if key in audit]
    benchmark = {'selection': 'all_secondary_supported_candidates',
                 'supported_candidates_visually_reviewed': len(audited),
                 'visible_face_labels': audited.count('visible_face'),
                 'not_a_face_labels': audited.count('not_a_face'),
                 'uncertain_labels': audited.count('uncertain'),
                 'full_archive_recall_measured': False}
    return {'analysis_version': VERSION, 'detector_model_sha256': MODEL_SHA,
            'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'original_recordings': len(events), **totals, 'recordings': records,
            'content_benchmark': benchmark,
            'model_scores_are_not_calibrated_probabilities': True,
            'secondary_non_detection_does_not_prove_no_face': True,
            'sampled_frames_do_not_establish_absence_or_continuous_dwell': True,
            'identity_inference_performed': False, 'source_images_modified': False,
            'original_recordings_modified': False, 'review_decisions_modified': False}


def atomic_json(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.evidence-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as out:
            json.dump(value, out, separators=(',', ':'), allow_nan=False)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def camera_healthy():
    status = json.loads(fetch('http://127.0.0.1:18808/status', 180000))
    return (status.get('ok') is True and status.get('mode') == 'watching'
            and status.get('continuous_4k_ready') is True
            and status.get('continuous_4k_dropped_output_frames') == 0
            and finite(status.get('temperature_c'), 0, 41))


class FaceScreen:
    def __init__(self, model):
        # Optional existing local runtime, never loaded by the relay process.
        import cv2
        import numpy
        if hashlib.sha256(model.read_bytes()).hexdigest() != MODEL_SHA:
            raise ValueError('face_detector_model_checksum_mismatch')
        cv2.setNumThreads(1)
        self.cv, self.np = cv2, numpy
        self.net = cv2.FaceDetectorYN.create(str(model), '', (320, 320), .6, .3, 500)

    def measure(self, data):
        cv, np = self.cv, self.np
        image = cv.imdecode(np.frombuffer(data, np.uint8), cv.IMREAD_COLOR)
        if image is None or not 70 <= image.shape[0] == image.shape[1] <= 4096:
            raise ValueError('invalid_native_square_crop')
        side = image.shape[0]
        self.net.setInputSize((320, 320))
        _, faces = self.net.detect(cv.resize(image, (320, 320)))
        face = max(faces, key=lambda item: float(item[-1])) if faces is not None else None
        score, eye, box = 0.0, None, None
        quality_image = image
        if face is not None:
            if not np.isfinite(face).all():
                raise ValueError('nonfinite_detector_output')
            scale = side / 320.0
            score = float(face[-1])
            eye = math.hypot(float(face[4]-face[6]), float(face[5]-face[7])) * scale
            x, y, w, h = [float(n) * scale for n in face[:4]]
            x0, y0 = max(0, int(x)), max(0, int(y))
            x1, y1 = min(side, int(math.ceil(x+w))), min(side, int(math.ceil(y+h)))
            if x1 > x0 and y1 > y0:
                box = [x0, y0, x1-x0, y1-y0]
                quality_image = image[y0:y1, x0:x1]
        gray = cv.cvtColor(cv.resize(quality_image, (64, 64)), cv.COLOR_BGR2GRAY)
        mean = float(gray.mean())
        sharpness = float(cv.Laplacian(gray, cv.CV_64F).var())
        dark, bright = float((gray < 16).mean()), float((gray > 239).mean())
        supported = score >= .9 and eye is not None and eye >= 8 and box is not None
        quality = (min(1, (eye or 0)/24) * .45 + min(1, sharpness/400) * .35
                   + (1-min(1, dark+bright)) * .2) * 100
        return {'content_status': 'secondary_detector_supported_face' if supported else
                    'secondary_detector_uncertain' if score >= .6 else 'no_secondary_face_confirmation',
                'secondary_face_score': round(score, 4), 'native_crop_side_px': side,
                'native_face_box_xywh': box, 'native_eye_span_px': round(eye, 2) if eye is not None else None,
                'mean_luminance': round(mean, 2), 'normalized_sharpness': round(sharpness, 2),
                'dark_pixel_fraction': round(dark, 4), 'bright_pixel_fraction': round(bright, 4),
                'quality_score': round(quality, 2),
                'quality_score_is_not_face_presence_or_identity_probability': True}


def install(handler_class, phone_rows):
    previous = handler_class.go

    def go(handler):
        if urllib.parse.urlsplit(handler.path).path != '/new/api/evidence-quality':
            return previous(handler)
        try:
            if REPORT.is_symlink() or REPORT.stat().st_size > 6000000:
                raise ValueError('invalid_report_file')
            report = json.loads(REPORT.read_text())
            if report.get('analysis_version') != VERSION or report.get('detector_model_sha256') != MODEL_SHA:
                raise ValueError('incompatible_analysis_report')
            current = phone_rows()
            output = []
            for record in report['recordings']:
                source = current.get(record['clip_no'])
                if source is None:
                    continue
                allowed = {f.get('snapshot_name'): f.get('snapshot_sha256')
                           for f in source.get('face_candidates', []) if isinstance(f, dict)}
                record = dict(record)
                record['images'] = [f for f in record['images']
                    if f['snapshot_name'] in allowed and allowed[f['snapshot_name']] == f['snapshot_sha256']]
                present = {f['snapshot_name'] for f in record['images']}
                record['best_supported_snapshots'] = [n for n in record['best_supported_snapshots'] if n in present]
                output.append(record)
            report = dict(report, recordings=output, current_original_recordings=len(current),
                          pending_new_recordings=len(set(current)-{r['clip_no'] for r in output}),
                          totals_describe_generated_snapshot=True)
            report['currently_matching_image_references'] = sum(len(r['images']) for r in output)
            report['source_changed_since_analysis'] = (
                report['currently_matching_image_references'] != report['images_measured']
                or len(current) != report['original_recordings'])
            gap_path = STATE/'original-gap-benchmark.json'
            if gap_path.is_file() and not gap_path.is_symlink() and gap_path.stat().st_size < 1000000:
                gap = json.loads(gap_path.read_text())
                if gap.get('detector_model_sha256') == MODEL_SHA:
                    report['original_gap_benchmark'] = dict(gap, recordings=[
                        row for row in gap.get('recordings', []) if row.get('clip_no') in current])
            handler.js(200, dict(report, ok=True))
        except (OSError, ValueError, TypeError, KeyError):
            handler.js(200, {'ok': True, 'analysis_version': VERSION, 'state': 'not_yet_available'})

    handler_class.go = go


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--budget-seconds', type=int, default=540)
    args = parser.parse_args()
    if not 15 <= args.budget_seconds <= 840:
        raise ValueError('invalid_bounded_worker_budget')
    os.nice(15)
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = (STATE / 'worker.lock').open('a+')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    model = STATE / 'yunet-2023mar.onnx'
    if model.is_symlink():
        raise ValueError('unexpected_model_symlink')
    if not model.exists():
        data = fetch(MODEL_URL, 232589)
        if len(data) != 232589 or hashlib.sha256(data).hexdigest() != MODEL_SHA:
            raise ValueError('face_detector_model_checksum_mismatch')
        model.write_bytes(data)
        model.chmod(0o600)
    cache_file = STATE / 'measurements.json'
    try:
        if cache_file.is_symlink() or cache_file.stat().st_size > 6000000:
            raise ValueError('invalid_measurement_cache')
        old = json.loads(cache_file.read_text())
        cache = old['images'] if old.get('analysis_version') == VERSION and old.get('detector_model_sha256') == MODEL_SHA else {}
    except (OSError, ValueError, KeyError, TypeError):
        cache = {}
    archive = json.loads(fetch('http://127.0.0.1:8795/new/api/saved', 6000000))
    events = validate_sources(archive)
    screen = FaceScreen(model)
    deadline = time.monotonic() + args.budget_seconds
    for event in events:
        if time.monotonic() > deadline or not camera_healthy():
            break
        for face in event['face_candidates']:
            key = image_key(face)
            if key in cache and cache[key].get('content_status') != 'image_unavailable':
                continue
            if time.monotonic() > deadline:
                break
            try:
                data = fetch('http://127.0.0.1:8795/new/saved/face/' + face['snapshot_name'], 2200000)
                if len(data) != face['snapshot_size'] or hashlib.sha256(data).hexdigest() != face['snapshot_sha256']:
                    raise ValueError('image_provenance_mismatch')
                cache[key] = screen.measure(data)
            except (OSError, ValueError, RuntimeError):
                cache[key] = {'content_status': 'image_unavailable', 'quality_score': 0}
        atomic_json(cache_file, {'analysis_version': VERSION, 'detector_model_sha256': MODEL_SHA, 'images': cache})
    try:
        audit = json.loads((STATE/'content-benchmark.json').read_text())
        audit_labels = audit['image_labels'] if audit.get('detector_model_sha256') == MODEL_SHA else {}
    except (OSError, ValueError, TypeError, KeyError):
        audit_labels = {}
    report = build_report(archive, cache, audit_labels)
    atomic_json(REPORT, report)
    print('S9_EVIDENCE_QUALITY', json.dumps({key: value for key, value in report.items() if key != 'recordings'}), flush=True)


if __name__ == '__main__':
    main()
