#!/usr/bin/env python3
"""A static contract for non-destructive C720P disk cleanup."""
from pathlib import Path
import ast,unittest
code=Path(__file__).with_name('safe-disk-relief-20261014.py').read_text()
class Safe(unittest.TestCase):
 def test_compiles(self):ast.parse(code)
 def test_preserves_user_data(self):
  for token in ("nonmedia_relief_v1","free_before_mb","free_after_mb",
     "backups_deleted':False","video_deleted':False","models_deleted':False",
     "services_stopped':False","chromium-headless","/tmp/adb.1000.log",
     "shutil.rmtree(p)","log_tail_preserved"):
   self.assertIn(token,code)
  for banned in ('/storage/9C33-6BBD','c720p-home-hub/backups','/opt/homeassistant/config',
                 'rm -rf','systemctl stop','docker image prune',
                 'find / -delete','/home/jespern/c720p-backups'):
   self.assertNotIn(banned,code)
if __name__=='__main__':unittest.main(verbosity=2)
