#!/usr/bin/env python3
"""Source-only fail-closed checks for isolated Android auxiliary probe."""
import re
from pathlib import Path
import unittest
S=Path(__file__).with_name("AuxiliaryMediaProbe.java").read_text()
class Tests(unittest.TestCase):
 def test_bounded_and_isolated(self):
  for phrase in ('MAX_FILES=12','MAX_LIST=20000','MAX_ROWS=700',
                 'MediaExtractor','reader.readSampleData(buf,0)',
                 'reader.release();','new File(ARCHIVE)',
                 'Files.isSymbolicLink','total_unpaired_auxiliary_files',
                 'files_modified",false','video_decoded",false'):
   self.assertIn(phrase,S)
  for forbidden in ('.delete(','.renameTo(','.mkdirs(','.createNewFile(',
                    'MediaRecorder','CameraManager','MediaCodec','MediaMuxer',
                    'FileOutputStream','FileWriter','adb shell rm'):
   self.assertNotIn(forbidden,S)
 def test_extracts_only_unpaired_and_sorted(self):
  self.assertIn('!originalNames.contains(primary(name))',S)
  self.assertIn('candidates.sort(Comparator.comparing(File::getName))',S)
  self.assertIn('offset+limit',S)
  self.assertIn('limit>MAX_FILES',S)
 def test_exact_basename_shapes(self):
  originals={'motion_1792000000000.mp4'}
  kinds={'preroll':r'motion_[0-9]{13}\.mp4\.preroll\.mp4',
         'complete':r'motion_[0-9]{13}\.mp4\.complete\.mp4',
         'partial':r'motion_[0-9]{13}\.mp4\.complete\.partial\.mp4'}
  entries=['motion_1792000000000.mp4.preroll.mp4',
           'motion_1792000003000.mp4.preroll.mp4',
           'motion_1792000006000.mp4.complete.mp4',
           'motion_1792000009000.mp4.complete.partial.mp4',
           '../motion_1792000009000.mp4.complete.mp4']
  selected=[]
  for name in entries:
   role=next((r for r,p in kinds.items() if re.fullmatch(p,name)),"")
   if role:
    suffix={'preroll':'.preroll.mp4','complete':'.complete.mp4',
            'partial':'.complete.partial.mp4'}[role]
    if name[:-len(suffix)] not in originals:selected.append(role)
  self.assertEqual(sorted(selected),['complete','partial','preroll'])
 def test_reporting_is_not_proof_of_full_playability(self):
  self.assertIn('NOT proof that every video frame is decodable',S)
  self.assertIn('compressed_video_samples_read',S)
  self.assertIn('extractor_unavailable_or_incomplete',S)
if __name__=="__main__":unittest.main(verbosity=2)
