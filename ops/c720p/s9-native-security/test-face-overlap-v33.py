#!/usr/bin/env python3
"""V33 source-contract checks for non-destructive 4K face-rescue improvements."""
from pathlib import Path
import math,re,unittest

ROOT=Path(__file__).resolve().parent
java=(ROOT/"src/nl/kalenel/s9security/S9FaceReview.java").read_text()
cls=(ROOT/"src/nl/kalenel/s9security/ClipClassifier.java").read_text()
cat=(ROOT.parent/"s9-person-ml-v1/local-sd-catalog.py").read_text()
VERSION="s9_onphone_36_samples_overlapping_tiles_v5"
OLD="s9_onphone_36_samples_person_or_tile_v4"

class Overlapping4KFaceTiles(unittest.TestCase):
 def test_12_person_anchors_and_24_overlapping_tile_fallback_frames(self):
  assert 'for(int i=0;i<36;i++)' in cls
  assert 'if(i%3==0)' in cls
  scope=cls.split('public synchronized boolean deepFaceReview(',1)[1].split('writeJson(new File(folder,name+".verified.json"),manifest)',1)[0]
  assert 'faces.sampleSceneTile(frame,at/1000,(i%2)!=0);' in scope
  assert 'faces.sampleSceneTile(frame,at/1000,(i/3)%2!=0);' in scope
  assert 'faces.sample(frame,at/1000,null);' not in scope
  assert 'tiledFallbacks++;' in scope
  self.assertEqual(sum(i%3!=0 for i in range(36)),24)
  self.assertEqual(sum(i%3!=0 and i%2==0 for i in range(36)),12)
  self.assertEqual(sum(i%3!=0 and i%2!=0 for i in range(36)),12)
 def test_tile_center_overlap_and_no_native_4k_upscale(self):
  assert "Math.ceil(width*.60)" in java
  assert "int x=right?width-w:0;" in java
  assert "sample(tile,ms,null);" in java
  assert "Bitmap.createBitmap(frame,x,0,w,frame.getHeight())" in java
  for width in (1920,3840):
   w=math.ceil(width*.60)
   assert width-w < w
   assert width-w <= width//2 <= w
   assert min(w,width-(width-w))==w
 def test_existing_snapshot_and_identity_safeguards(self):
  assert VERSION in cls
  assert 'manifest.optInt("face_snapshots_saved",0)>0' in cls
  assert 'fingerprint.equalsIgnoreCase(digest(mp4))' in cls
  assert 'writeJson(new File(folder,name+".verified.json"),manifest)' in cls
  assert "JSONObject match=assign(emb)" in java
  assert "shadow=null" in java
  assert "if(!reliableForEmbedding)" in java
  assert OLD in cat and VERSION in cat
  assert "face_shadow_vectors_persisted" in java
  assert "face_shadow_matches_created" in java
 def test_scope_and_bounds(self):
  assert 'if(decoded==0)throw new IOException("face_deep_zero_decoded_frames")' in cls
  assert 'new S9FaceReview(app,folder,name,48)' in cls
  assert 'if(frame==null||frame.getWidth()<400||frame.getHeight()<200)return' in java
  assert 'frames>=frameLimit||captures.length()>=MAX_CAPTURES' in java
  for invalid in ("Files.delete(","mp4.delete()","mp4.renameTo(","outputVideos.add("):
   self.assertNotIn(invalid,cls.split('public synchronized boolean deepFaceReview(',1)[1].split('backfillMovementEvidence',1)[0])

if __name__=="__main__":unittest.main(verbosity=2)
