#!/usr/bin/env python3
"""Source-level contracts for the S9+ Camera2 non-blocking preview pipeline.

The Android SDK workflow compiles both Java classes; these tests additionally
ensure the camera callback cannot synchronously JPEG-encode or use closed Image.
"""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parent
SRC=ROOT/"src/nl/kalenel/s9security"

class Tests(unittest.TestCase):
 def test_nonblocking_camera_callback_preserves_full_quality_recording(self):
  c=(SRC/"CameraService.java").read_text()
  region=c[c.index("preview.setOnImageAvailableListener("):c.index("},cameraHandler);",c.index("preview.setOnImageAvailableListener("))]
  self.assertIn("PreviewJpeg.snapshot(frame)",region)
  self.assertIn("jpegEncoder.execute(new Runnable()",region)
  self.assertIn("PreviewJpeg.encode(copied,58)",region)
  self.assertIn("jpegBusy=true",region)
  self.assertIn("finally{jpegBusy=false;}",region)
  self.assertNotIn("PreviewJpeg.encode(frame,",region)
  self.assertIn("if(frame!=null)frame.close()",region)
  self.assertIn('Thread.NORM_PRIORITY-2',c)
  self.assertIn('jpegEncoder.shutdownNow()',c)
  self.assertIn('preview_jpeg_worker_errors',c)
  self.assertIn('preview_jpeg_async',c)
  for essential in ('recorder.setVideoSize(3840,2160)',
                    'recorder.setVideoFrameRate(30)',
                    'recorder.setVideoEncodingBitRate(36000000)',
                    'PhoneMediaRange.handle(in,out,line,folder)',
                    'garden_roi_gpu_person_gate_v1',
                    'COOLDOWN_MS=12000',
                    'temperature()<415',
                    'gardenPersonGateBusy',
                    'reviewer.shutdown()'):
   self.assertIn(essential,c)

 def test_yuv_plane_copy_and_native_encode_is_on_phone(self):
  s=(SRC/"PreviewJpeg.java").read_text()
  for expected in ('class Snapshot','getPlanes()','getRowStride()',
                   'getPixelStride()','buffer.get(planes[n])',
                   'ImageFormat.YUV_420_888','YuvImage(',
                   'ImageFormat.NV21','new Rect(0,0,width,height)',
                   'image.compressToJpeg','at(s,2,y,x)','at(s,1,y,x)'):
   self.assertIn(expected,s)
  self.assertNotIn('Bitmap.createBitmap',s)
  self.assertNotIn('new int[w*h]',s)
  self.assertIn('encode(snapshot(frame),quality)',s)

if __name__=="__main__":
 unittest.main(verbosity=2)
