#!/usr/bin/env python3
"""Bounded, independent original-4K detection benchmark for extraction gaps.

Read original frames over the existing private phone Range API. No recordings,
manifests, crops or decisions are changed. Only detection/quality metadata is
saved; decoded media stays in memory. This is an offline benchmark, not a new
live camera loop. A detector non-hit never establishes absence of a face.
"""
import argparse
import base64
import fcntl
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import subprocess
import time

MODULE = Path(__file__).resolve().parents[1] / 's9-person-ml-v1/s9_evidence_quality_v1.py'
spec = importlib.util.spec_from_file_location('evidence', MODULE)
q = importlib.util.module_from_spec(spec)
spec.loader.exec_module(q)
VERSION = 's9_original4k_independent_gap_benchmark_v1'


def sample_times(duration, count=5):
    if not q.integer(duration, 1000, 180000) or not q.integer(count, 3, 9):
        raise ValueError('unsupported_benchmark_samples')
    return [int(duration*(2*i+1)/(2*count)) for i in range(count)]


def overlap(a, b):
    left, top = max(a[0], b[0]), max(a[1], b[1])
    right, bottom = min(a[0]+a[2], b[0]+b[2]), min(a[1]+a[3], b[1]+b[3])
    area = max(0, right-left)*max(0, bottom-top)
    return area / max(1, a[2]*a[3]+b[2]*b[3]-area)


def detect_native(screen, image):
    cv = screen.cv
    height, width = image.shape[:2]
    if (width, height) != (3840, 2160):
        raise ValueError('source_not_original_4k')
    # Full scene plus six overlapping native-pixel tiles. Small faces are not
    # confined to a full-frame downscale. Return original-frame geometry.
    tiles = [(0, 0, width, height)]
    tiles += [(x, y, 1664, 1280) for y in (0, 880) for x in (0, 1088, 2176)]
    output = []
    for x0, y0, w, h in tiles:
        iw = 1280 if w == width else 832
        ih = int(round(h*iw/w/32))*32
        screen.net.setInputSize((iw, ih))
        _, found = screen.net.detect(cv.resize(image[y0:y0+h, x0:x0+w], (iw, ih)))
        if found is None:
            continue
        for face in found:
            if not screen.np.isfinite(face).all():
                raise ValueError('invalid_detector_geometry')
            confidence = float(face[-1])
            if confidence < .9:
                continue
            x, y, bw, bh = [float(n) for n in face[:4]]
            x, y, bw, bh = x0+x*w/iw, y0+y*h/ih, bw*w/iw, bh*h/ih
            eye = math.hypot(float(face[4]-face[6])*w/iw, float(face[5]-face[7])*h/ih)
            if eye < 8 or min(bw, bh) < 18:
                continue
            left, top = max(0, int(x)), max(0, int(y))
            right, bottom = min(width, int(math.ceil(x+bw))), min(height, int(math.ceil(y+bh)))
            if right <= left or bottom <= top:
                continue
            output.append({'native_face_box_xywh': [left, top, right-left, bottom-top],
                           'native_eye_span_px': round(eye, 2),
                           'secondary_face_score': round(confidence, 4)})
    output.sort(key=lambda item: -item['secondary_face_score'])
    deduplicated = []
    for candidate in output:
        if all(overlap(candidate['native_face_box_xywh'], old['native_face_box_xywh']) < .35
               for old in deduplicated):
            deduplicated.append(candidate)
    return deduplicated[:3]


def frame(screen, clip, at):
    if not q.CLIP.fullmatch(clip) or not q.integer(at, 0, 180000):
        raise ValueError('invalid_original_frame_request')
    command = ['nice', '-n', '15', 'ffmpeg', '-nostdin', '-v', 'error', '-threads', '1',
               '-rw_timeout', '15000000', '-ss', str(at/1000), '-i',
               'http://127.0.0.1:18808/clip/'+clip, '-frames:v', '1', '-threads', '1',
               '-f', 'rawvideo', '-pix_fmt', 'bgr24', 'pipe:1']
    result = subprocess.run(command, capture_output=True, timeout=45)
    if result.returncode or len(result.stdout) != 3840*2160*3:
        raise ValueError('original_4k_frame_decode_failed')
    return screen.np.frombuffer(result.stdout, dtype=screen.np.uint8).reshape(2160, 3840, 3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--budget-seconds', type=int, default=780)
    parser.add_argument('--max-recordings', type=int, default=20)
    parser.add_argument('--frames-per-recording', type=int, default=5)
    parser.add_argument('--contact-sheet', action='store_true')
    args = parser.parse_args()
    if not (30 <= args.budget_seconds <= 840 and 1 <= args.max_recordings <= 30
            and 3 <= args.frames_per_recording <= 9):
        raise ValueError('unbounded_original_benchmark')
    os.nice(15)
    lock = (q.STATE/'worker.lock').open('a+')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    screen = q.FaceScreen(q.STATE/'yunet-2023mar.onnx')
    archive = json.loads(q.fetch('http://127.0.0.1:8795/new/api/saved', 6000000))
    events = q.validate_sources(archive)
    gaps = sorted([event for event in events if not event['face_candidates']], key=lambda e: e['clip_no'])
    selected = gaps[:args.max_recordings]
    report_file = q.STATE/'original-gap-benchmark.json'
    try:
        old = json.loads(report_file.read_text())
        cache = {r['clip_no']: r for r in old['recordings']} if old.get('analysis_version') == VERSION else {}
    except (OSError, ValueError, KeyError):
        cache = {}
    output = []
    contacts = []
    deadline = time.monotonic()+args.budget_seconds
    for number, event in enumerate(selected):
        clip = event['clip_no']
        times = sample_times(event['duration_ms'], args.frames_per_recording)
        record = {'clip_no': clip, 'duration_ms': event['duration_ms'], 'samples': []}
        prior = cache.get(clip, {})
        completed = {s['time_ms']: s for s in prior.get('samples', []) if s.get('state') == 'decoded'}
        for at in times:
            if at in completed and not args.contact_sheet:
                record['samples'].append(completed[at])
                continue
            if time.monotonic() > deadline or not q.camera_healthy():
                break
            try:
                image = frame(screen, clip, at)
                candidates = detect_native(screen, image)
                record['samples'].append({'time_ms': at, 'state': 'decoded',
                    'original_resolution': [3840, 2160], 'face_candidates': candidates})
                if args.contact_sheet and len(contacts) < 100:
                    preview = screen.cv.resize(image, (128, 72))
                    screen.cv.putText(preview, str(number+1)+':'+str(round(at/1000, 1)),
                        (2, 13), screen.cv.FONT_HERSHEY_SIMPLEX, .32, (255, 255, 255), 1)
                    contacts.append(preview)
            except (OSError, ValueError, subprocess.SubprocessError):
                record['samples'].append({'time_ms': at, 'state': 'source_frame_unavailable', 'face_candidates': []})
        output.append(record)
        report = {'analysis_version': VERSION, 'detector_model_sha256': q.MODEL_SHA,
                  'generated_at': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
                  'original_archive_recordings': len(events), 'zero_crop_recordings': len(gaps),
                  'selected_recordings': len(selected), 'recordings': output,
                  'sampling_is_not_full_video_ground_truth': True,
                  'identity_inference_performed': False, 'original_recordings_modified': False,
                  'review_decisions_modified': False, 'media_written_to_hub': False}
        q.atomic_json(report_file, report)
        print('GAP_RECORDING', json.dumps(record), flush=True)
        if time.monotonic() > deadline:
            break
    print('GAP_BENCHMARK', json.dumps({'recordings': len(output),
        'decoded_original_frames': sum(s['state'] == 'decoded' for r in output for s in r['samples']),
        'source_frame_errors': sum(s['state'] != 'decoded' for r in output for s in r['samples']),
        'independent_supported_face_observations': sum(len(s['face_candidates']) for r in output for s in r['samples'])}), flush=True)
    if contacts:
        columns = args.frames_per_recording
        rows = math.ceil(len(contacts)/columns)
        sheet = screen.np.zeros((72*rows, 128*columns, 3), dtype=screen.np.uint8)
        for i, image in enumerate(contacts):
            sheet[(i//columns)*72:(i//columns+1)*72, (i%columns)*128:(i%columns+1)*128] = image
        # Diagnostic sheets may be requested in small batches; stay below the
        # administrative job stdout bound. Originals are never persisted here.
        for quality in (50, 35, 20, 10):
            ok, encoded = screen.cv.imencode('.jpg', sheet, [screen.cv.IMWRITE_JPEG_QUALITY, quality])
            if ok and len(encoded) < 26000:
                print('CONTACT_SHEET', base64.b64encode(encoded).decode(), flush=True)
                break


if __name__ == '__main__':
    main()
