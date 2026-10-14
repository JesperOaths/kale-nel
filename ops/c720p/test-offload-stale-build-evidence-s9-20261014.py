#!/usr/bin/env python3
import ast,unittest
from pathlib import Path
code=Path(__file__).with_name('offload-stale-build-evidence-s9-20261014.py').read_text()
class Tests(unittest.TestCase):
 def test_compiles(self):ast.parse(code)
 def test_preserves_all_original_media(self):
  for marker in ("C720P_S9_OFFLOAD_VERIFIED","remote_exists(final)",
    "digest_remote(part)!=expect","digest_remote(final)!=expect",
    "shutil.rmtree(p)","str(p).startswith('/tmp/s9-')","time.time()-p.stat().st_mtime<4*3600",
    "temperature_c","garden_person_gate_ready","sd_free_bytes",
    "recordings_deleted':False","camera_apk_modified':False"):
   self.assertIn(marker,code,marker)
  for bad in ("Security4K","/new/api/sd/delete","adb('install'",
    "adb('shell','rm'","/opt/homeassistant/config","/home/jespern/c720p-home-hub/backups",
    "camera_stop","systemctl stop","docker image prune"):
   self.assertNotIn(bad,code,bad)
 def test_verification_precedes_unlink(self):
  self.assertLess(code.index("if digest_remote(final)!=expect:raise RuntimeError('final_archive_readback_mismatch')"),
                 code.index("p.unlink()\n  return {'name':p.name,'result':'verified_offload'"))
  self.assertLess(code.index("if digest_remote(final)!=expect:raise RuntimeError('tar_final_sha256_mismatch')"),
                 code.index("shutil.rmtree(p)"))
if __name__=='__main__':unittest.main(verbosity=2)
