#!/usr/bin/env python3
"""Read-only S9+ Camera2 FPS diagnosis. Never decodes/stores images on C720P.

Usage: python3 check-s9-camera-fps.py --seconds 10
Captures only timing/byte-count metadata. No APK changes or camera restarts.
"""
import argparse
import json
import statistics
import time
import urllib.request

PHONE_STATUS='http://127.0.0.1:18808/status'
PHONE_MJPEG='http://127.0.0.1:18808/mjpeg'
HUB_MJPEG='http://127.0.0.1:8794/new/live.mjpg'
FRAME_BOUNDARY=b'--frame\r\n'

def status():
    with urllib.request.urlopen(PHONE_STATUS,timeout=7) as stream:
        if stream.status!=200:raise RuntimeError('camera_http_status')
        raw=stream.read(32769)
    if len(raw)>32768:raise ValueError('status_too_large')
    data=json.loads(raw)
    if data.get('ok') is not True:raise RuntimeError('phone_camera_not_ready')
    return data

def count_stream(url,seconds=7):
    if not 3<=seconds<=25:raise ValueError('bounded_benchmark_duration_required')
    stamps=[]
    bytes_received=0
    with urllib.request.urlopen(url,timeout=seconds+12) as stream:
        if stream.status!=200 or 'multipart/x-mixed-replace' not in stream.headers.get('Content-Type',''):
            raise RuntimeError('camera_stream_not_multipart')
        begin=time.monotonic();tail=b''
        while time.monotonic()-begin<seconds:
            blob=stream.read(2048)
            if not blob:break
            bytes_received+=len(blob)
            joined=tail+blob
            n=joined.count(FRAME_BOUNDARY)
            if n:stamps.extend([time.monotonic()]*n)
            tail=joined[-(len(FRAME_BOUNDARY)-1):]
        elapsed=time.monotonic()-begin
    diffs=[b-a for a,b in zip(stamps,stamps[1:]) if b>a]
    return {'frames':len(stamps),'seconds':round(elapsed,2),
            'fps':round(len(stamps)/max(elapsed,.01),2),
            'median_frame_gap_ms':round(statistics.median(diffs)*1000,1) if diffs else None,
            'jpeg_bytes_received':bytes_received}

def diagnosis(sensor_fps,yuv_fps,exposure_ms):
    if sensor_fps is None:return 'sensor_metadata_not_available'
    if sensor_fps<21 and exposure_ms is not None and exposure_ms>=43:
        return 'nighttime_exposure_likely_limits_physical_sensor_fps'
    if sensor_fps>=23 and yuv_fps<.75*sensor_fps:
        return 'YUV_callback_processing_or_frame_drop_suspected'
    if sensor_fps<21:return 'sensor_hardware_or_auto_exposure_limit_needs_investigation'
    return 'sensor_and_YUV_rates_consistent'

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--seconds',type=int,default=8)
    args=p.parse_args()
    if not 3<=args.seconds<=25:p.error('seconds must be between 3 and 25')
    begin=status()
    start=time.monotonic()
    phone=count_stream(PHONE_MJPEG,args.seconds)
    elapsed=time.monotonic()-start
    end=status()
    sensor=end.get('sensor_result_fps')
    callback=(int(end.get('frames') or 0)-int(begin.get('frames') or 0))/max(elapsed,.1)
    metadata=(int(end.get('sensor_capture_result_frames') or 0)-
              int(begin.get('sensor_capture_result_frames') or 0))/max(elapsed,.1)
    report={
      'phone_mode':end.get('mode'),
      'phone_temp_c':end.get('temperature_c'),
      '4k_recording_enabled':end.get('native_4k_enabled'),
      'preview_jpeg_async':end.get('preview_jpeg_async'),
      'phone_mjpeg':phone,
      'yuv_callback_fps':round(callback,2),
      'camera_capture_result_callback_fps':round(metadata,2),
      'sensor_timestamp_fps':sensor,
      'sensor_ae_exposure_ms':end.get('sensor_exposure_ms'),
      'sensor_ae_frame_duration_ms':end.get('sensor_frame_duration_ms'),
      'sensor_ae_state':end.get('sensor_ae_state'),
      'sensor_iso':end.get('sensor_iso'),
      'sensor_ae_target_fps_range':[end.get('sensor_ae_target_fps_min'),
                                    end.get('sensor_ae_target_fps_max')],
      'source_is_phone':True,
      'decoded_frames_on_hub':0,
      'causal_diagnosis':diagnosis(sensor,callback,end.get('sensor_exposure_ms')),
    }
    print('S9_PHONE_NATIVE_CAMERA_FPS_DIAGNOSIS '+json.dumps(report,separators=(',',':')))

if __name__=='__main__':
    main()
