#!/usr/bin/env python3
"""Offline static acceptance for unsigned, non-exported, unenrolled APK scaffold."""
from pathlib import Path
import json,re,unittest
HERE=Path(__file__).resolve().parent
class Tests(unittest.TestCase):
 def test_pinned_source_inventory(self):
  data=json.loads((HERE/'source-pins.json').read_text())
  self.assertEqual(data['revision'],'f3d5c00006d5147f1cff08e02c70c367e81533bb')
  rows=data['files']
  self.assertEqual(len(rows),20)
  self.assertEqual(len({r['name'] for r in rows}),len(rows))
  for r in rows:
   self.assertRegex(r['name'],r'^S9Migrated[A-Za-z0-9]+V[0-9]+$')
   self.assertRegex(r['sha256'],r'^[a-f0-9]{64}$')
   self.assertEqual(r['pinned_ref'],data['revision'])
   self.assertGreater(r['bytes'],500)
  for mandatory in ('S9MigratedCompanionBootReadinessV229',
        'S9MigratedThreeKeyEnrollmentV227','S9MigratedApprovedSixDigestV230',
        'S9MigratedSignedActionV198','S9MigratedSignedCommitGateV201',
        'S9MigratedDualStoreCommitV197','S9MigratedActionWireV231',
        'S9MigratedPostcommitV232'):
   self.assertIn(mandatory,{r['name'] for r in rows})
 def test_no_exported_runtime_or_production_signer(self):
  xml=(HERE/'AndroidManifest.xml').read_text()
  self.assertIn('package="nl.kalenel.s9migrated"',xml)
  self.assertIn('android:minSdkVersion="29"',xml)
  self.assertIn('android:targetSdkVersion="28"',xml)
  for safe in ('android:allowBackup="false"','android:debuggable="false"',
      'android:usesCleartextTraffic="false"'):
   self.assertIn(safe,xml)
  for unsafe in ('<activity ','<service ','<receiver ','<provider ',
       'android:exported="true"','android.permission.CAMERA',
       'android.permission.INTERNET','android:sharedUserId'):
   self.assertNotIn(unsafe,xml)
  script=(HERE/'build_unsigned.py').read_text()
  for safe in ('hashlib.sha256(raw).hexdigest()==row["sha256"]',
     'unprivileged-v233-','apksigner','verify',
     'unauthorized_signing_identity_present'):
   self.assertIn(safe,script)
  for unsafe in ('adb install','apksigner sign','keytool -genkey',
                 'pm grant','enrollFirstOnly('):
   self.assertNotIn(unsafe,script)
 def test_readme_never_claims_acceptance(self):
  doc=(HERE/'README.md').read_text()
  for s in ('owner or explicitly delegated release administrator',
     'NONEXPORTABLE','physical phone reboot',
     'no operational Android component','48 historically unbound'):
   self.assertIn(s.lower(),doc.lower())
if __name__=='__main__':unittest.main(verbosity=2)
