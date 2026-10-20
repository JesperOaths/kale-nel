#!/usr/bin/env python3
"""Only synthetic HMAC key guard and source contract. Never accesses Android keys."""
from pathlib import Path
import subprocess
import tempfile
import unittest
R=Path(__file__).resolve().parent
class Custody(unittest.TestCase):
 def test_independent_keys_host(self):
  with tempfile.TemporaryDirectory(prefix="s9-existing-keys-v202-") as tmp:
   files=[str(R/n) for n in (
       "S9MigratedKeystoreKeyPairGuardV202.java",
       "S9MigratedKeystoreKeyPairGuardTestV202.java")]
   a=subprocess.run(["javac","-source","8","-target","8","-d",tmp,*files],
       capture_output=True,text=True,timeout=30)
   self.assertEqual(a.returncode,0,a.stderr)
   b=subprocess.run(["java","-cp",tmp,
       "nl.kalenel.s9offline.S9MigratedKeystoreKeyPairGuardTestV202"],
       capture_output=True,text=True,timeout=20)
   self.assertEqual(b.returncode,0,b.stderr)
   self.assertEqual(b.stdout.strip(),"S9_EXISTING_KEY_PAIR_GUARD_V202_HOST_OK")
 def test_android_wrapper_never_provisions_or_mutates(self):
  s=(R/"S9MigratedAndroidKeystoreOwnerV202.java").read_text()
  for marker in ('getInstance("AndroidKeyStore")','store.load(null)',
       'store.containsAlias(','getKey(','getEncoded()!=null',
       'requireDistinct(c,j)','trusted_hmac_alias_missing_fail_closed',
       'productionKeysCreated(){return false;}'):
   self.assertIn(marker,s)
  for forbidden in ("KeyGenerator","KeyGenParameterSpec",
       "store.setEntry(","store.deleteEntry(","System.out.",
       "Log.","CameraManager","HttpServer","Files.write(",
       "Files.delete(","getExternalFilesDir("):
   self.assertNotIn(forbidden,s)
if __name__=="__main__":unittest.main(verbosity=2)
