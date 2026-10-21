#!/usr/bin/env python3
"""V236 admission regressions. Fake Android classes and NO phone credentials."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/"S9MigratedAndroidOwnerWriteGatewayV236.java"

ANDROID={
 "android/content/pm/ApplicationInfo.java":
 "package android.content.pm;public class ApplicationInfo {public int uid;}",
 "android/content/Context.java":
 """package android.content;
import android.content.pm.ApplicationInfo;
public class Context {
 public ApplicationInfo info=new ApplicationInfo();
 public String pkg="nl.kalenel.s9migrated";
 public Context getApplicationContext(){return this;}
 public ApplicationInfo getApplicationInfo(){return info;}
 public String getPackageName(){return pkg;}
}""",
 "android/os/Binder.java":
 "package android.os; public class Binder {public static int uid=4123; public static int getCallingUid(){return uid;}}",
 "android/os/Process.java":
 "package android.os; public class Process {public static final int SHELL_UID=2000; public static int uid=4123; public static int myUid(){return uid;}}",
}

STUBS=r"""
package nl.kalenel.s9offline;
import android.content.Context;
import java.io.File;
import java.io.IOException;
import java.util.Collection;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

class S9MigratedCompanionBootReadinessV229 {
 static int reads=0;
 static final class Assessment {
  public int approvedSourceCount=6;
  public long trustedSourceGeneration=1L,trustedLedgerSequence=0L;
  public String trustedLedgerHeadSha256=Fixture.rep('0',64);
 }
 static Assessment inspectExistingOnly(Context c,File f,long gen,String sha)
      throws IOException {
  reads++;
  if(gen!=1L || !Fixture.rep('a',64).equals(sha))
    throw new IOException("bad_enrollment");
  return new Assessment();
 }
}
class S9MigratedManifestKeyCustodyV227 {
 static int opened=0;
 static final class Existing {
  public File privateFilesDir=new File("/unused/app/private");
  public SecretKey internalCheckpoint=new SecretKeySpec(new byte[32],"HmacSHA256");
  public SecretKey microSdJournal=new SecretKeySpec(new byte[32],"HmacSHA256");
  public S9MigratedSealedSourceManifestV216.Verified verifyAlreadyEnrolled(long g)
       throws IOException{return new S9MigratedSealedSourceManifestV216.Verified();}
 }
 static Existing openExisting(Context c)throws IOException{
  opened++;return new Existing();
 }
}
class S9MigratedSealedSourceManifestV216 {
 static final class Verified {}
}
class S9MigratedApprovedSixDigestV230 {
 static void requireSealedManifestEqualsEnrollment(
   S9MigratedSealedSourceManifestV216.Verified v,String d)throws IOException {}
}
class S9MigratedDualStoreCommitV197 implements AutoCloseable {
 interface AuthorizedSource {
  boolean approved(String a,String n,String h,long b)throws IOException;
 }
 static final class TrustedSnapshot {
  public long trustedSequence=0L;
  public String trustedHeadSha256=Fixture.rep('0',64);
 }
 S9MigratedDualStoreCommitV197(File app,File sd,SecretKey a,SecretKey b){}
 TrustedSnapshot currentDecisions(Collection<String> names) {
  return new TrustedSnapshot();
 }
 public void close(){}
}
class S9MigratedSignedActionV198 implements AutoCloseable {
 static final class Verified {}
 S9MigratedSignedActionV198(SecretKey k){}
 public void close(){}
}
class S9MigratedSignedCommitGateV201 {
 interface IndependentUserApproval {
  boolean permits(S9MigratedSignedActionV198.Verified verified)throws IOException;
 }
 S9MigratedSignedCommitGateV201(
  S9MigratedSignedActionV198 v,S9MigratedDualStoreCommitV197 j,
  S9MigratedDualStoreCommitV197.AuthorizedSource source,
  IndependentUserApproval approval){}
}
class S9MigratedPostcommitV232 {
 S9MigratedPostcommitV232(
  S9MigratedSignedCommitGateV201 a,S9MigratedDualStoreCommitV197 j){}
}
class S9MigratedBoundActionReceiptV234 {
 static int commits=0;
 static byte[] executeAfterIndependentAuthentication(
  byte[] wire,long now,String challenge,
  S9MigratedSealedSourceManifestV216.Verified original,String approved,
  S9MigratedPostcommitV232 a,S9MigratedDualStoreCommitV197 b){
  commits++;return new byte[]{1};
 }
}
public final class Fixture {
 static int auth=0,anchor=0,clock=0,approval=0,physical=0;
 static String rep(char c,int len) {
  char[] chars=new char[len];java.util.Arrays.fill(chars,c);return new String(chars);
 }
 interface Task {void run()throws Exception;}
 static void blocked(Task task,String reason)throws Exception {
  try {task.run();throw new AssertionError("FAIL_OPEN_"+reason);}
  catch(IOException expected){}
 }
 static final android.content.Context context=new android.content.Context();
 static final String challenge=rep('d',32);
 static final File sd=new File("/synthetic/companion-app-only/sd-ledger");
 static final byte[] wire="synthetic_not_signed".getBytes("US-ASCII");
 static S9MigratedAndroidOwnerWriteGatewayV236.IndependentlyAnchoredEnrollment
       anchored(final boolean valid) {
  return new S9MigratedAndroidOwnerWriteGatewayV236.IndependentlyAnchoredEnrollment(){
   public String approvedSixOriginalPreimageSha256(){anchor++;return valid?rep('a',64):"attacker"; }
   public long minimumSourceGeneration(){return 1L;}
  };
 }
 static S9MigratedAndroidOwnerWriteGatewayV236.AuthenticatedInAppOwner
       owner(final boolean valid) {
  return new S9MigratedAndroidOwnerWriteGatewayV236.AuthenticatedInAppOwner(){
   public boolean authenticatesOwnerSession(String p,int u,String nonce) {
    auth++;return valid && p.equals("nl.kalenel.s9migrated") &&
      u==4123 && challenge.equals(nonce);
   }
   public boolean explicitlyPermitsSignedMetadataAction(
       S9MigratedSignedActionV198.Verified intent){
    approval++;return false;
   }
  };
 }
 static S9MigratedAndroidOwnerWriteGatewayV236.LiveOriginalVerifier original=
  (a,n,h,b)->{physical++;return false;};
 static S9MigratedAndroidOwnerWriteGatewayV236.IndependentlyTrustedPhoneClock
  timer=(()->{clock++;return -1L;});
 static void invoke(boolean authAllowed,boolean validAnchor)throws Exception {
  S9MigratedAndroidOwnerWriteGatewayV236.commitExistingOnly(
    context,sd,wire,challenge,anchored(validAnchor),owner(authAllowed),
    original,timer);
 }
 public static void main(String[] args)throws Exception {
  context.info.uid=4123;
  android.os.Binder.uid=8123;
  blocked(()->invoke(true,true),"foreign_caller");
  if(auth!=0 || anchor!=0)throw new AssertionError("foreign_reached_owner");
  android.os.Binder.uid=4123;
  context.pkg="nl.kalenel.s9security";
  blocked(()->invoke(true,true),"camera2_wrong_app");
  context.pkg="nl.kalenel.s9migrated";
  android.os.Process.uid=2000;context.info.uid=2000;
  android.os.Binder.uid=2000;
  blocked(()->invoke(true,true),"adb_shell");
  android.os.Process.uid=4123;context.info.uid=4123;
  android.os.Binder.uid=4123;
  blocked(()->S9MigratedAndroidOwnerWriteGatewayV236.commitExistingOnly(
    context,sd,wire,"browser-claim",anchored(true),owner(true),original,timer),
    "challenge_not_auth");
  blocked(()->invoke(false,true),"no_authenticated_owner");
  if(anchor!=0 || S9MigratedCompanionBootReadinessV229.reads!=0)
     throw new AssertionError("preauth_reached_enrollment");
  blocked(()->invoke(true,false),"missing_independent_source_anchor");
  if(S9MigratedCompanionBootReadinessV229.reads!=0)
     throw new AssertionError("malformed_anchor_reached_journal");
  blocked(()->invoke(true,true),"invalid_phone_clock");
  if(clock!=1 || S9MigratedManifestKeyCustodyV227.opened!=1 ||
     approval!=0 || physical!=0 || S9MigratedBoundActionReceiptV234.commits!=0)
   throw new AssertionError("bad_clock_or_precondition_leaked_action");
  if(S9MigratedAndroidOwnerWriteGatewayV236.hasExportedTransport() ||
     S9MigratedAndroidOwnerWriteGatewayV236.installsOrGeneratesCredentials() ||
     S9MigratedAndroidOwnerWriteGatewayV236.deletesAnyOriginalMedia() ||
     S9MigratedAndroidOwnerWriteGatewayV236.treatsSignatureAsHumanConsent() ||
     S9MigratedAndroidOwnerWriteGatewayV236.provesHumanPlayback())
    throw new AssertionError("unearned_authority");
  System.out.println("S9_V236_APP_UID_OWNER_ANCHOR_CLOCK_DENIALS_HOST_OK");
 }
}
"""

class Test(unittest.TestCase):
 def test_source_denials(self):
  code=SOURCE.read_text()
  for x in (
   "Binder.getCallingUid()==info.uid","info.uid>Process.SHELL_UID",
   "deviceLocalOwner.authenticatesOwnerSession(","deviceLocalOwner.explicitlyPermitsSignedMetadataAction(",
   "S9MigratedCompanionBootReadinessV229.inspectExistingOnly(",
   "S9MigratedApprovedSixDigestV230.requireSealedManifestEqualsEnrollment(",
   "S9MigratedManifestKeyCustodyV227.openExisting(app)",
   "store.containsAlias(ACTION_ALIAS)","secret.getEncoded()!=null",
   "trustedClock.currentTrustedMillis()",
   "S9MigratedPostcommitV232(","S9MigratedBoundActionReceiptV234",
   "actualOnPhoneSource.checksCurrentPhoneOriginal(",
   "before.trustedSequence==boot.trustedLedgerSequence",
   "installsOrGeneratesCredentials(){return false;}",
   "deletesAnyOriginalMedia(){return false;}"):
   self.assertIn(x,code,x)
  for forbidden in (
   "KeyGenerator","KeyGenParameterSpec","new ServerSocket",
   "HttpServer","Files.delete(","new Intent(","enrollFirstOnly(",
   "android:exported","CameraManager","MediaCodec"):
   self.assertNotIn(forbidden,code,forbidden)
 def test_host_denials_precede_keystore(self):
  with tempfile.TemporaryDirectory(prefix="s9-v236-host-denials-") as root:
   p=Path(root)
   sources=[]
   for name,body in ANDROID.items():
    path=p/name
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(body)
    sources.append(str(path))
   fixture=p/"nl/kalenel/s9offline/Fixture.java"
   fixture.parent.mkdir(parents=True,exist_ok=True)
   fixture.write_text(STUBS)
   sources.extend([str(fixture),str(SOURCE)])
   out=p/"out";out.mkdir()
   compiled=subprocess.run(
    ["javac","-source","8","-target","8","-d",str(out)]+sources,
    capture_output=True,text=True,timeout=40)
   self.assertEqual(compiled.returncode,0,compiled.stderr)
   result=subprocess.run(
    ["java","-cp",str(out),"nl.kalenel.s9offline.Fixture"],
    capture_output=True,text=True,timeout=15)
   self.assertEqual(result.returncode,0,result.stderr)
   self.assertIn("S9_V236_APP_UID_OWNER_ANCHOR_CLOCK_DENIALS_HOST_OK",
                 result.stdout)

if __name__=="__main__":unittest.main(verbosity=2)
