#!/usr/bin/env python3
"""Static source-only admission tests. No production Android hardware or keys."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parent
GATE=ROOT/"S9MigratedAndroidOwnerReadGatewayV235.java"
PACKAGE=ROOT.parent/"migrated-companion-v233"/"AndroidManifest.xml"
class SourceContract(unittest.TestCase):
 def test_dedicated_app_uid_and_auth(self):
  s=GATE.read_text()
  for required in (
    'PACKAGE="nl.kalenel.s9migrated"',
    'info.uid==Process.myUid()',
    'Binder.getCallingUid()==info.uid',
    'info.uid>Process.SHELL_UID',
    'ownerSession.authorizesExistingStateRead(',
    '"read_gateway_independent_owner_auth_denied"',
    'trustedEnrollment.approvedSixOriginalPreimageSha256()',
    'trustedEnrollment.minimumSourceGeneration()',
    'minimumGeneration==1L',
    'S9MigratedCompanionBootReadinessV229.inspectExistingOnly(',
    'S9MigratedApprovedSixDigestV230.requireSealedManifestEqualsEnrollment(',
    'S9MigratedReadOnlyStateV225.readForAuthenticatedOwner(',
    'S9MigratedReadOnlyStateEnvelopeV229.encodeVerified(',
    'snapshot.journalSequence==boot.trustedLedgerSequence',
    'same(snapshot.journalHeadSha256,boot.trustedLedgerHeadSha256)',
    'saved+deleted+unknown==6',
    'hasHttpTransport(){return false;}',
    'provisionsKeysOrEnrollment(){return false;}',
    'authorizesSignedMutations(){return false;}',
    'provesMediaAvailableOrViewed(){return false;}'):
   self.assertIn(required,s,required)
 def test_no_network_install_provision_original_mutation(self):
  s=GATE.read_text()
  for forbidden in (
    'KeyGenerator','KeyGenParameterSpec','new ServerSocket',
    'HttpURLConnection','HttpServer','ServerSocket(',
    'Files.delete(','.delete()', 'Files.write(', 'new URL(',
    'getSharedPreferences(', 'getExternalStoragePublicDirectory',
    'openFileOutput(', 'enrollFirstOnly(', 'new Intent(',
    'CameraService','MediaCodec','requestPermissions('):
   self.assertNotIn(forbidden,s,forbidden)
 def test_production_unsigned_scaffold_unchanged(self):
  self.assertTrue(PACKAGE.is_file())
  xml=PACKAGE.read_text()
  self.assertIn('package="nl.kalenel.s9migrated"',xml)
  for forbidden in ('<activity ','<service ','<receiver ','<provider ',
                    'android:exported="true"'):
   self.assertNotIn(forbidden,xml)
if __name__=='__main__':unittest.main(verbosity=2)
